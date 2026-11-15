import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { settingsReply } from '../template/supabase/functions/_shared/settings-reply.ts';

const config = JSON.parse(readFileSync('oaw/config.json', 'utf8'));
const health = {
  thresholds: { sysHigh: 150, sysLow: 90, diaHigh: 90, diaLow: 60, gluHigh: 130, gluLow: 70 },
  reminders: [{ time: '08:00', kind: 'measure', label: '早上量血壓' }],
  ownerNotify: { reminders: true, events: true, weekly: false },
  caregivers: [
    { index: 0, alert: true, missed: false, weekly: false },
    { index: 7, alert: false, missed: false, weekly: false },
  ],
};

test('notes and questions pass through', () => {
  assert.deepEqual(settingsReply({ kind: 'note' }, null), { kind: 'note' });
  assert.deepEqual(settingsReply({ kind: 'ask', summary: '要停哪一種？' }, null), {
    kind: 'ask',
    summary: '要停哪一種？',
  });
  assert.equal(settingsReply({ kind: 'ask', summary: '' }, null), null);
});

test('health changes map caregiver indexes back to ids and drop unknown ones', () => {
  const r: any = settingsReply({ kind: 'change', summary: '停週報', config: null, health }, ['Ua']);
  assert.equal(r.kind, 'change');
  assert.equal(r.config, null);
  assert.deepEqual(r.health.notify, { reminders: true, events: true, weekly: false });
  assert.deepEqual(r.health.caregivers, [
    { id: 'Ua', notify: { alert: true, missed: false, weekly: false } },
  ]);
  assert.equal(r.health.thresholds.sysHigh, 150);
});

test('health is ignored outside the health template; bad config is refused', () => {
  const r: any = settingsReply(
    { kind: 'change', summary: '改圓角', config: { ...config, shape: 1 }, health },
    null,
  );
  assert.equal(r.health, null);
  assert.equal(r.config.shape, 1);
  assert.equal(
    settingsReply(
      { kind: 'change', summary: 'x', config: { ...config, grid: 5 }, health: null },
      null,
    ),
    null,
  );
  assert.equal(
    settingsReply({ kind: 'change', summary: 'x', config: null, health: null }, null),
    null,
  );
});
