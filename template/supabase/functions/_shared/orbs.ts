// 光球 storage and the 「確認」 step for one OA app. Shapes and checks live in orb-model.ts;
// Aprico's /orb turns the owner's plain words into piece parameters (billed to the owner).
import { listGroups } from './groups.ts';
import {
  cleanOrb,
  cleanParams,
  cleanTemplate,
  FACES,
  defaultOrbs,
  localIssues,
  menuButtons,
  PERSONA_MAX,
  orbReady,
  PIECE_NAME,
  type Issue,
  type Orb,
} from './orb-model.ts';
import { cronJobs } from './orb-logic.ts';
import { DEFAULT_PERSONA } from './persona.ts';
import { PX } from './px.ts';
import { apricoKey, db, env, T } from './store.ts';

export async function loadOrbs(): Promise<Orb[]> {
  const groups = (await listGroups()).map((g) => g.group_id);
  const { data, error } = await db.from(T('orbs')).select('slot,data').order('slot');
  if (error) throw Error('orbs_unavailable');
  const base = defaultOrbs();
  if (!data?.length) {
    // First visit: orb 1 starts lit with the calendar secretary (dark on the health template,
    // which has its own reminders), and its timed pieces are registered right away.
    if (env('TEMPLATE') === 'health') base[0].on = false;
    await db.from(T('orbs')).upsert(base.map((o) => ({ slot: o.slot, data: o })));
    await syncCron(base).catch(() => false);
    return base;
  }
  const saved = new Map(data.map((r: { slot: number; data: unknown }) => [r.slot, r.data]));
  return [1, 2, 3, 4].flatMap((slot) => {
    const row = saved.get(slot);
    if (!row) return slot === 4 ? [] : [base[slot - 1]];
    try {
      return [cleanOrb(row, slot, groups)];
    } catch {
      return slot === 4 ? [] : [{ ...base[slot - 1], on: false, pieces: [], links: [], target: '' }];
    }
  });
}

/** The owner's shared 性格 text; '' when they never edited it (the built-in default applies). */
export async function sharedPersona(): Promise<string> {
  const { data } = await db.from(T('owner')).select('persona').eq('id', 1).maybeSingle();
  return typeof data?.persona === 'string' ? data.persona.slice(0, PERSONA_MAX) : '';
}

async function saveOrb(orb: Orb) {
  const { error } = await db
    .from(T('orbs'))
    .upsert({ slot: orb.slot, data: orb, updated_at: new Date().toISOString() });
  if (error) throw Error('orb_save_failed');
}

/**
 * Register the timed jobs of the lit orbs in this app's database (pg_cron). Returns false
 * when timed jobs are not available there; the orbs still work, only the clock pieces wait.
 */
export async function syncCron(orbs: Orb[]) {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/${PX}-digest`;
  const { error } = await db.rpc(T('cron_sync'), { jobs: cronJobs(orbs), url });
  if (error) console.warn('oaw cron sync failed:', error.code ?? 'unknown');
  return !error;
}

async function view(orbs: Orb[]) {
  return {
    orbs,
    // 性格: the built-in text, and the owner's shared edit ('' = never edited, follows updates).
    persona: { default: DEFAULT_PERSONA, shared: await sharedPersona() },
    buttons: menuButtons(orbs),
    groups: (await listGroups()).map((g, i) => ({ id: g.group_id, name: g.name || `群組 ${i + 1}` })),
  };
}

const slotOf = (v: unknown) => {
  if (![1, 2, 3].includes(v as number)) throw Error('orb_invalid');
  return v as number;
};

/** LIFF actions: orb_list, orb_save (draft), orb_check (AI), orb_toggle. Owner only. */
export async function orbAction(action: string, body: any, requestId: string) {
  const orbs = await loadOrbs();
  if (action === 'orb_list') return view(orbs);
  if (action === 'orb_persona') {
    // Shared 性格: a text saves the owner's edit; null goes back to the built-in default.
    const text = body.text === null ? null : String(body.text ?? '').trim().slice(0, PERSONA_MAX);
    const { error } = await db.from(T('owner')).update({ persona: text || null }).eq('id', 1);
    if (error) throw Error('orb_save_failed');
    return view(orbs);
  }
  const slot = slotOf(body.slot);
  const groups = (await listGroups()).map((g) => g.group_id);
  const at = orbs.findIndex((o) => o.slot === slot);
  const put = async (orb: Orb) => {
    orbs[at] = orb;
    await saveOrb(orb);
  };

  if (action === 'orb_toggle') {
    const orb = orbs[at];
    if (body.on === true && !orbReady(orb, orbs)) throw Error('orb_not_ready');
    await put({ ...orb, on: body.on === true });
    return { ...(await view(orbs)), timed: await syncCron(orbs) };
  }

  const orb = cleanOrb(body.orb, slot, groups);
  if (action === 'orb_save') {
    // A draft: an orb that is no longer complete goes dark until it is confirmed again.
    await put({ ...orb, on: orb.on && orbReady(orb, orbs) });
    return { ...(await view(orbs)), timed: await syncCron(orbs) };
  }
  if (action !== 'orb_check') throw Error('unknown_action');

  let issues: Issue[] = localIssues(orb, orbs);
  let note = '';
  if (!issues.length) {
    const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
    const base = env('APRICO_URL'),
      key = await apricoKey();
    if (!base || !key) throw Error('aprico_not_connected');
    const res = await fetch(`${base}/orb`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        target: orb.target === 'me' ? 'me' : 'group',
        // 顯示介面: the AI picks one layout from this face's list (never anything else).
        ...(orb.face ? { face: orb.face, templates: FACES[orb.face], template: orb.template } : {}),
        // Long-press 調整設定: the owner's request in plain words.
        ...(typeof body.request === 'string' && body.request.trim()
          ? { request: body.request.trim().slice(0, 300) }
          : {}),
        pieces: orb.pieces.map((p) => ({
          id: p.id,
          type: p.type,
          text: p.text,
          ...(typeof answers[p.id] === 'string' && answers[p.id].trim()
            ? { answer: answers[p.id].slice(0, 200) }
            : {}),
        })),
      }),
      signal: AbortSignal.timeout(60000),
    }).catch(() => null);
    if (res?.status === 402) throw Error('points_insufficient');
    if (res?.status === 429) throw Error('rate_limited');
    const data = res?.ok ? await res.json().catch(() => null) : null;
    if (!Array.isArray(data?.pieces)) throw Error('orb_check_failed');
    for (const p of orb.pieces) {
      const got = data.pieces.find((x: any) => x?.id === p.id);
      if (!got) throw Error('orb_check_failed');
      if (typeof got.text === 'string' && got.text.trim()) p.text = got.text.trim().slice(0, 200);
      const question = typeof got.question === 'string' ? got.question.trim().slice(0, 200) : '';
      p.params = question ? null : cleanParams(p.type, got.params);
      if (!p.params)
        issues.push({
          piece: p.id,
          code: 'ask',
          text: question || `「${PIECE_NAME[p.type]}」還缺少必要的資訊，請再說清楚一點。`,
        });
    }
    orb.template = cleanTemplate(orb.face, data.template ?? orb.template);
    note = issues.length || typeof data.note !== 'string' ? '' : data.note.slice(0, 300);
  }
  // Confirming never lights the orb by itself; the owner presses 啟動 (orb_toggle) after this.
  await put({ ...orb, on: orb.on && !issues.length });
  await syncCron(orbs);
  return { ...(await view(orbs)), issues, note, ready: !issues.length };
}
