// 行事曆 page (?view=calendar): the owner's recorded events by month, with the chat each one
// came from. Read-only except for removing a wrong entry.
import { listGroups } from './groups.ts';
import { db, ownerId, T } from './store.ts';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function calendarAction(action: string, body: any) {
  if (action === 'cal_delete') {
    if (!Number.isSafeInteger(body.id) || body.id < 1) throw Error('invalid_event');
    await db.from(T('records')).delete().eq('id', body.id).eq('kind', 'event');
  }
  const month: string = MONTH.test(body.month ?? '')
    ? body.month
    : new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const [{ data }, groups, owner] = await Promise.all([
    db
      .from(T('records'))
      .select('id,day,time,title,source_id')
      .eq('kind', 'event')
      .gte('day', first)
      .lt('day', next)
      .order('day', { ascending: true })
      .order('time', { ascending: true })
      .limit(400),
    listGroups(),
    ownerId(),
  ]);
  const names = new Map(groups.map((g, i) => [g.group_id, g.name || `群組 ${i + 1}`]));
  return {
    month,
    events: (data ?? []).map((e: any) => ({
      id: e.id,
      day: e.day,
      time: e.time,
      title: e.title,
      from: !e.source_id || e.source_id === owner ? '個人' : (names.get(e.source_id) ?? '群組'),
    })),
  };
}
