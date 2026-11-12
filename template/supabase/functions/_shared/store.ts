// Database access for one OA app. Table and secret names carry the app prefix,
// so several OA apps can share one Supabase project.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { PX } from './px.ts';
import { validateConfig, sha256Hex, type Config } from './logic.ts';

const UP = PX.toUpperCase();
export const env = (name: string) => Deno.env.get(`${UP}_${name}`) ?? '';
export const T = (name: string) => `${PX}_${name}`;

export const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export async function loadConfig(): Promise<Config> {
  const { data, error } = await db.from(T('config')).select('data').eq('id', 1).single();
  if (error || !data) throw Error('config_missing');
  return validateConfig(data.data);
}

export async function saveConfig(config: Config) {
  const clean = validateConfig(config);
  const { error } = await db
    .from(T('config'))
    .update({ data: clean, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) throw Error('config_save_failed');
  return clean;
}

export async function ownerId(): Promise<string> {
  const { data } = await db.from(T('owner')).select('line_user_id').eq('id', 1).maybeSingle();
  return data?.line_user_id ?? '';
}

/** Bind the owner with the one-time code from the build page. Returns true on success. */
export async function bindOwner(userId: string, code: string) {
  const { data } = await db
    .from(T('owner'))
    .select('line_user_id,bind_hash,bind_expires')
    .eq('id', 1)
    .maybeSingle();
  if (!data || data.line_user_id || !data.bind_hash) return false;
  if (new Date(data.bind_expires).getTime() < Date.now()) return false;
  if ((await sha256Hex(code)) !== data.bind_hash) return false;
  const { data: updated } = await db
    .from(T('owner'))
    .update({ line_user_id: userId, bind_hash: null, bind_expires: null })
    .eq('id', 1)
    .is('line_user_id', null)
    .select('id');
  return Boolean(updated?.length);
}

export async function upsertMember(userId: string, displayName: string) {
  await db.from(T('members')).upsert(
    { line_user_id: userId, display_name: displayName.slice(0, 100) },
    {
      onConflict: 'line_user_id',
      ignoreDuplicates: false,
    },
  );
}

export async function member(userId: string) {
  const { data } = await db
    .from(T('members'))
    .select('member_no,display_name,joined_at')
    .eq('line_user_id', userId)
    .maybeSingle();
  return data;
}

export async function setPending(userId: string, proposal: unknown) {
  await db
    .from(T('pending'))
    .upsert({ line_user_id: userId, proposal, created_at: new Date().toISOString() });
}

export async function takePending(userId: string) {
  const { data } = await db
    .from(T('pending'))
    .delete()
    .eq('line_user_id', userId)
    .select('proposal,created_at');
  const row = data?.[0];
  // Proposals expire after 30 minutes.
  if (!row || Date.now() - new Date(row.created_at).getTime() > 30 * 60 * 1000) return null;
  return row.proposal;
}
