// 顯示介面 (?view=show&slot=N): the data one orb's page needs. The page can only draw the
// layouts listed in orb-model.ts (FACES); everything here is read from this app's own
// database, limited to the orb's own conversation.
import { pieceOf } from './orb-logic.ts';
import { FACE_NAME, type Orb } from './orb-model.ts';
import { tallyData } from './orb-run.ts';
import { countToday, db, T } from './store.ts';

type Line = Parameters<typeof tallyData>[2];
const taipei = (ms = Date.now()) => new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);

/** This month's expenses of one conversation: total, biggest titles, and the last 7 days. */
async function money(source: string) {
  const month = taipei().slice(0, 7);
  const { data } = await db
    .from(T('records'))
    .select('day,title,amount')
    .eq('kind', 'expense')
    .eq('source_id', source)
    .gte('day', `${month}-01`)
    .order('day', { ascending: true })
    .limit(500);
  const rows = (data ?? []).filter((r: any) => Number.isFinite(r.amount));
  const byTitle = new Map<string, number>();
  for (const r of rows) byTitle.set(r.title, (byTitle.get(r.title) ?? 0) + r.amount);
  const top = [...byTitle.entries()].sort((a, b) => b[1] - a[1]);
  const days = Array.from({ length: 7 }, (_, i) => taipei(Date.now() - (6 - i) * 86400000));
  return {
    month,
    count: rows.length,
    total: rows.reduce((n: number, r: any) => n + r.amount, 0),
    parts: [
      ...top.slice(0, 4).map(([name, amount]) => ({ name, amount })),
      ...(top.length > 4 ? [{ name: '其他', amount: top.slice(4).reduce((n, [, v]) => n + v, 0) }] : []),
    ],
    days: days.map((day) => ({
      day,
      amount: rows.filter((r: any) => r.day === day).reduce((n: number, r: any) => n + r.amount, 0),
    })),
  };
}

async function notes(source: string) {
  const { data } = await db
    .from(T('records'))
    .select('id,kind,day,time,title,amount,done,created_at')
    .eq('source_id', source)
    .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString())
    .order('created_at', { ascending: false })
    .limit(80);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    kind: r.kind,
    day: r.day ?? '',
    time: r.time ?? '',
    title: r.title,
    amount: r.amount ?? null,
    done: r.done === true,
    at: r.created_at,
  }));
}

/**
 * `count: true` runs the 統計 piece now (it uses the owner's AI quota, so it only happens when
 * the owner presses the button, at most 20 times a day).
 */
export async function showData(orb: Orb, owner: string, line: Line, body: any, requestId: string) {
  if (!orb.face) throw Error('orb_no_face');
  const source = orb.target === 'me' ? owner : orb.target;
  const head = { slot: orb.slot, name: orb.name, face: orb.face, faceName: FACE_NAME[orb.face], template: orb.template };
  if (orb.face === 'calendar') return head;
  if (orb.face === 'notes') {
    if (Number.isSafeInteger(body.id) && typeof body.done === 'boolean')
      await db.from(T('records')).update({ done: body.done }).eq('id', body.id).eq('source_id', source).eq('kind', 'todo');
    return { ...head, notes: await notes(source) };
  }
  const piece = orb.target === 'me' ? null : pieceOf(orb, 'stats');
  let tally = null,
    tallyNote = '';
  if (piece && body.count === true) {
    if ((await countToday(`tally:${source}`, 20)) < 0) tallyNote = '今天統計的次數已達上限，明天再試。';
    else {
      const d = await tallyData(piece, source, line, requestId);
      if (d === 'quota') tallyNote = '本月 AI 額度已用完，暫時無法統計。';
      else if (d === 'empty') tallyNote = `目前還沒有人登記${(piece.params as any).subject}。`;
      else if (!d) tallyNote = '暫時無法統計，請稍後再試。';
      else
        tally = {
          count: d.totals.count,
          total: d.totals.total,
          items: d.totals.perItem.map(([name, qty]) => ({ name, qty })),
          people: d.totals.people.map((p) => ({ who: d.nameOf(p.who), lines: p.lines, amount: p.amount })),
        };
    }
  }
  return {
    ...head,
    subject: piece ? String((piece.params as any).subject) : '',
    canCount: Boolean(piece),
    tally,
    tallyNote,
    money: await money(source),
  };
}
