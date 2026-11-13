// Sample data for ?mock=1 on localhost only (screenshots and local checks).
const S = {
  role: 'owner',
  consent: !location.search.includes('consent=0'),
  share: true,
  day: '2026-11-12',
  events: [
    { id: 1, day: '2026-11-14', time: '09:30', title: '心臟科回診' },
    { id: 2, day: '2026-11-20', time: '', title: '抽血檢查（空腹）' },
  ],
  today: [
    { time: '08:00', kind: 'measure', label: '早上量血壓', slot: 0, done: true },
    { time: '08:30', kind: 'med', label: '早餐後吃藥', slot: 1, done: true },
    { time: '20:00', kind: 'med', label: '晚餐後吃藥', slot: 2, done: false },
  ],
  latest: {
    bp: { v1: 128, v2: 82, v3: 72, flagged: false, measured_at: '2026-11-12T00:05:00Z' },
    glucose: { v1: 142, tag: 'fasting', flagged: true, measured_at: '2026-11-11T23:50:00Z' },
    weight: { v1: 61.5, flagged: false, measured_at: '2026-11-10T23:40:00Z' },
  },
  scan: { total: 78, constitution: '氣虛體質', at: '2026-11-09T02:00:00Z' },
  thresholds: { sysHigh: 140, sysLow: 90, diaHigh: 90, diaLow: 60, gluHigh: 130, gluLow: 70 },
  reminders: [
    { time: '08:00', kind: 'measure', label: '早上量血壓' },
    { time: '08:30', kind: 'med', label: '早餐後吃藥' },
    { time: '20:00', kind: 'med', label: '晚餐後吃藥' },
  ],
  caregivers: [
    {
      id: 'U1',
      name: '女兒 小美',
      status: 'active',
      notify: { alert: true, missed: true, weekly: true },
    },
    {
      id: 'U2',
      name: '兒子 阿明',
      status: 'pending',
      notify: { alert: true, missed: true, weekly: true },
    },
  ],
};
const REPORT = {
  score: { total: 78, breakdown: { face: 80, tongue: 74, eye: 79 } },
  constitution: {
    type: '氣虛體質',
    description: '容易疲倦、說話氣短，午後精神較差，舌邊略有齒痕。',
  },
  focus: [
    { issue: '補氣健脾', advice: '三餐定時，多吃山藥、南瓜等溫和食材' },
    { issue: '規律作息', advice: '晚上十一點前入睡，午後可小睡二十分鐘' },
  ],
  dietAdvice: {
    eat: [{ food: '山藥', reason: '健脾益氣，適合容易疲倦的體質' }],
    avoid: { food: '冰品', reason: '寒涼傷脾' },
  },
  acupoints: [{ name: '足三里', location: '膝蓋外側下方四指', effect: '健脾補氣' }],
  lifestyle: ['每天散步三十分鐘，以微微出汗為度'],
};
export async function mockCall(action, extra = {}) {
  await new Promise((r) => setTimeout(r, 150));
  if (location.search.includes('forbidden=1')) throw Error('health_forbidden');
  if (action === 'h_consent') S.consent = true;
  if (action === 'h_done') S.today[extra.slot].done = true;
  if (action === 'h_measure') return { saved: '已記錄', flagged: '' };
  if (action === 'h_invite') return { code: '482913', text: '家人 482913' };
  if (action === 'h_scan') return { report: REPORT };
  return structuredClone(S);
}
