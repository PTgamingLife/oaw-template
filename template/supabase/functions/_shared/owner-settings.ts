// The owner writes in plain words; Aprico decides whether it is a note or a settings change
// (menu config, and for the health template its notifications, reminders and ranges).
// Nothing changes until the owner replies 套用; every value is validated again here.
import { notifySettings, ownerNotify, reminders, thresholds } from './health.ts';
import type { HealthChange } from './settings-reply.ts';
export { settingsReply } from './settings-reply.ts';
import { db, env, T } from './store.ts';

/** Current health settings for the model; caregivers by index and name, never their LINE id. */
export async function healthSnapshot() {
  if (env('TEMPLATE') !== 'health') return null;
  const [{ data: p }, { data: cg }] = await Promise.all([
    db.from(T('h_profile')).select('*').eq('id', 1).maybeSingle(),
    db
      .from(T('h_caregivers'))
      .select('line_user_id,display_name,notify')
      .eq('status', 'active')
      .order('line_user_id'),
  ]);
  const list = cg ?? [];
  return {
    ids: list.map((c: any) => c.line_user_id as string),
    names: list.map((c: any) => String(c.display_name || '家人')),
    model: {
      thresholds: thresholds(p?.thresholds),
      reminders: reminders(p?.reminders),
      ownerNotify: ownerNotify(p?.notify),
      caregivers: list.map((c: any, index: number) => ({ index, ...notifySettings(c.notify) })),
    },
  };
}

/** Apply a confirmed health change (the menu config is saved by the caller). */
export async function applyHealth(h: HealthChange) {
  await db.from(T('h_profile')).upsert({
    id: 1,
    thresholds: thresholds(h.thresholds),
    reminders: reminders(h.reminders),
    notify: ownerNotify(h.notify),
  });
  for (const c of h.caregivers ?? [])
    if (typeof c?.id === 'string')
      await db
        .from(T('h_caregivers'))
        .update({ notify: notifySettings(c.notify) })
        .eq('line_user_id', c.id);
}
