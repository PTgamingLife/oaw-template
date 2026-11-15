// Pure check of Aprico's /settings reply (no Deno or network APIs, unit-tested with Node).
import { validateConfig, type Config } from './logic.ts';
import { notifySettings, ownerNotify, reminders, thresholds } from './health.ts';

export type HealthChange = {
  thresholds: ReturnType<typeof thresholds>;
  reminders: ReturnType<typeof reminders>;
  notify: ReturnType<typeof ownerNotify>;
  caregivers: { id: string; notify: ReturnType<typeof notifySettings> }[];
};
export type SettingsReply =
  | { kind: 'note' }
  | { kind: 'ask'; summary: string }
  | { kind: 'change'; summary: string; config: Config | null; health: HealthChange | null };

/** Turn Aprico's reply into a safe proposal; null when it cannot be used. */
export function settingsReply(data: any, ids: string[] | null): SettingsReply | null {
  if (data?.kind === 'note') return { kind: 'note' };
  const summary = typeof data?.summary === 'string' ? data.summary.trim().slice(0, 300) : '';
  if (!summary) return null;
  if (data.kind === 'ask') return { kind: 'ask', summary };
  if (data.kind !== 'change') return null;
  try {
    const config = data.config ? validateConfig(data.config) : null;
    const h = ids && data.health ? data.health : null;
    const health = h
      ? {
          thresholds: thresholds(h.thresholds),
          reminders: reminders(h.reminders),
          notify: ownerNotify(h.ownerNotify),
          caregivers: (Array.isArray(h.caregivers) ? h.caregivers : [])
            .filter((c: any) => Number.isInteger(c?.index) && ids![c.index])
            .map((c: any) => ({ id: ids![c.index], notify: notifySettings(c) })),
        }
      : null;
    if (!config && !health) return null;
    return { kind: 'change', summary, config, health };
  } catch {
    return null;
  }
}
