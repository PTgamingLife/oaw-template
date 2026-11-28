// Running the puzzle pieces of a lit orb: 指令 and 統計 words in a conversation, the call word
// of 回答, what gets recorded, and the timed jobs (定時推播 / 提醒 / 統計截止). Pieces are fixed
// building blocks with validated params — nothing the owner or a member types is executed.
import { answerAll, callWord, eventLine, upcomingEvents } from './groups.ts';
import { orbFor, parseJob, pieceOf, tallyText, tallyTotals, windowStart } from './orb-logic.ts';
import { FACE_NAME, type Orb, type Piece } from './orb-model.ts';
import { personaFor } from './persona.ts';
import { studyJob } from './study.ts';
import { noticeCard, quotaCard } from './onboarding.ts';
import { apricoKey, countToday, db, env, onceToday, saveMessage, T } from './store.ts';

type Line = {
  call: (path: string, body?: unknown, method?: string) => Promise<any>;
  reply: (token: string, messages: unknown[]) => Promise<unknown>;
  push: (to: string, messages: unknown[]) => Promise<unknown>;
};
const taipeiDay = (offset = 0) =>
  new Date(Date.now() + 8 * 3600 * 1000 + offset * 86400000).toISOString().slice(0, 10);

async function todos(sourceId: string) {
  const { data } = await db
    .from(T('records'))
    .select('title')
    .eq('kind', 'todo')
    .eq('source_id', sourceId)
    .gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString())
    .order('created_at', { ascending: false })
    .limit(20);
  return (data ?? []).map((t: { title: string }) => `・${t.title}`);
}

/** 行事曆 / 清單 / 摘要 of one conversation as a card; null when `quiet` and there is nothing. */
export async function viewCard(
  show: string,
  sourceId: string,
  quiet = false,
  owner = '',
  page?: { label: string; uri: string },
) {
  // In the owner's own chat the card also opens the page (the orb's 顯示介面, else the calendar).
  const liff = env('LIFF_URL');
  const open =
    owner && sourceId === owner && liff
      ? (page ?? { label: '打開行事曆', uri: `${liff}?view=calendar` })
      : undefined;
  const events = show === 'list' ? [] : (await upcomingEvents(sourceId)).map(eventLine);
  const list = show === 'calendar' ? [] : await todos(sourceId);
  if (quiet && !events.length && !list.length) return null;
  if (show === 'calendar')
    return noticeCard('📅 接下來 7 天', events.length ? events.join('\n') : '接下來 7 天沒有行程。', open);
  if (show === 'list') return noticeCard('✅ 待辦', list.length ? list.join('\n') : '目前沒有待辦。');
  const parts = [
    ...(events.length ? ['📅 行程', ...events] : []),
    ...(list.length ? ['', '✅ 待辦', ...list] : []),
  ];
  return noticeCard('🗂 目前的整理', parts.length ? parts.join('\n').trim() : '目前沒有行程和待辦。', open);
}

/**
 * Count a 統計 piece now: totals plus display names. 'empty' = nobody wrote anything yet,
 * 'quota' = the owner's AI quota is used up, null = it could not be done.
 */
export async function tallyData(piece: Piece, groupId: string, line: Line, requestId: string) {
  const p = piece.params as any;
  const { data } = await db
    .from(T('messages'))
    .select('sender,text,sent_at')
    .eq('source_id', groupId)
    .gte('sent_at', windowStart(p.open))
    .not('sender', 'is', null)
    .order('sent_at', { ascending: true })
    .limit(300);
  const rows: { sender: string; text: string }[] = [];
  let bytes = 0;
  for (const m of data ?? []) {
    bytes += new TextEncoder().encode(m.text).length + 12;
    if (bytes > 9000) break;
    rows.push(m);
  }
  if (!rows.length) return 'empty' as const;
  const labels = new Map<string, string>();
  for (const r of rows) if (!labels.has(r.sender)) labels.set(r.sender, `M${labels.size + 1}`);
  const base = env('APRICO_URL'),
    key = await apricoKey();
  if (!base || !key) return null;
  const res = await fetch(`${base}/tally`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId,
      subject: p.subject,
      items: p.items.map((i: { name: string }) => i.name),
      ...(p.measures?.length
        ? { measures: p.measures.map((m: { name: string; unit: string }) => `${m.name}${m.unit ? ` (${m.unit})` : ''}`) }
        : {}),
      lines: rows.map((r) => ({ who: labels.get(r.sender), text: r.text })),
    }),
    signal: AbortSignal.timeout(60000),
  }).catch(() => null);
  if (res?.status === 402) return 'quota' as const;
  const out = res?.ok ? await res.json().catch(() => null) : null;
  if (!Array.isArray(out?.entries)) return null;
  const totals = tallyTotals(out.entries, p.items, p.dedupe, p.measures?.length ?? 0);
  // Names are looked up here and never sent to Aprico.
  const names = new Map<string, string>();
  if (p.names || out.unclear?.length) {
    const kind = groupId.startsWith('R') ? 'room' : 'group';
    for (const [uid, label] of labels) {
      if (!totals.people.some((x) => x.who === label) && !out.unclear?.some((u: any) => u.who === label))
        continue;
      const prof = await line.call(`/v2/bot/${kind}/${groupId}/member/${uid}`, undefined, 'GET').catch(() => null);
      names.set(label, typeof prof?.displayName === 'string' ? prof.displayName.slice(0, 20) : '');
    }
  }
  const nameOf = (label: string) => names.get(label) || `成員 ${label.slice(1)}`;
  return { totals, nameOf, unclear: (out.unclear ?? []) as { who: string; text: string }[] };
}

/** The same count as a chat card. */
export async function runTally(piece: Piece, groupId: string, line: Line, requestId: string) {
  const p = piece.params as any;
  const title = `🧾 ${p.subject}統計`;
  const d = await tallyData(piece, groupId, line, requestId);
  if (d === 'empty') return noticeCard(title, `目前還沒有人登記${p.subject}。`);
  if (!d || d === 'quota') return d;
  return noticeCard(title, tallyText(d.totals, p.subject, p.names, d.nameOf, d.unclear, p.measures ?? []));
}



/**
 * A text line in a conversation that has a lit orb. Returns true when a piece answered it.
 * `sourceId` is the group id, or the owner's user id for the 1:1 chat.
 */
export async function orbText(
  event: any,
  line: Line,
  owner: string,
  orb: Orb,
  sourceId: string,
  sharedPersona = '',
) {
  const text: string = event.message.text.trim();
  const userId: string = event.source.userId ?? '';
  const reply = (m: unknown) => line.reply(event.replyToken, [m]);
  const rid = String(event.webhookEventId ?? `o${Date.now()}`);
  const command = pieceOf(orb, 'command'),
    stats = orb.target === 'me' ? null : pieceOf(orb, 'stats'),
    answer = pieceOf(orb, 'answer');
  const tally = async () => {
    if ((await countToday(`tally:${sourceId}`, 20)) < 0)
      return void (await reply(noticeCard('🧾 統計', '今天統計的次數已達上限，明天再試。')));
    const card = await runTally(stats!, sourceId, line, `tally-${rid}`);
    if (card === 'quota') {
      await reply(noticeCard('🧾 統計', '本月 AI 額度已用完，暫時無法統計。'));
      if (owner && (await onceToday('quota')))
        await line.push(owner, [quotaCard(env('APRICO_SUBSCRIBE_URL'))]).catch(() => {});
      return;
    }
    await reply(card ?? noticeCard('🧾 統計', '暫時無法統計，請稍後再試。'));
  };
  const style = { persona: personaFor(orb, sharedPersona) };
  const focus = String(pieceOf(orb, 'record')?.params?.topic ?? '');
  // 指令: the cue alone shows this orb's page; the cue followed by a request goes to the AI.
  if (command && text === command.params!.word) {
    const liff = env('LIFF_URL');
    const page =
      orb.face && liff
        ? { label: `打開${FACE_NAME[orb.face]}`, uri: `${liff}?view=show&slot=${orb.slot}` }
        : undefined;
    const show = orb.face === 'calendar' ? 'calendar' : orb.face ? 'summary' : String(command.params!.show);
    if ((orb.face === 'stats' || command.params!.show === 'stats') && stats) await tally();
    else await reply((await viewCard(show, sourceId, false, owner, page))!);
    return true;
  }
  if (stats && text === stats.params!.word) {
    await tally();
    return true;
  }
  if (command && (await callWord(event, line, owner, sourceId, String(command.params!.word), 30, focus, style)))
    return true;
  // 回答: every message gets a reply (short unless a question was asked). Capped per day.
  if (answer) {
    // Keep the line first (also in the 1:1 chat, whose usual save is skipped once we answer).
    if (pieceOf(orb, 'record') || stats)
      await saveMessage(sourceId, userId === owner, event.message.text, userId);
    if (await answerAll(event, line, owner, sourceId, 60, { ...style, brief: true })) return true;
  }
  // Groups: keep the line when this orb records or counts. (The 1:1 chat saves in the webhook.)
  if (orb.target !== 'me' && (pieceOf(orb, 'record') || stats))
    await saveMessage(sourceId, userId === owner, event.message.text, userId);
  return false;
}

/** A timed job fired by the database. Returns a short result for the log. */
export async function runJob(name: string, orbs: Orb[], owner: string, line: Line) {
  const job = parseJob(name);
  if (!job || job.kind === 'digest') return 'unknown';
  const orb = orbs.find((o) => o.slot === job.slot && o.on);
  if (job.kind === 'studyq' || job.kind === 'studyr') {
    const on = orb?.target === 'me' && orb.pieces.some((p) => p.id === job.piece && p.type === 'study' && p.params);
    return on && owner ? studyJob(job.kind, owner, line) : 'gone';
  }
  const piece = orb?.pieces.find((p) => p.id === job.piece && p.type === job.kind && p.params);
  if (!orb || !piece || !owner) return 'gone';
  const to = orb.target === 'me' ? owner : orb.target;
  const p = piece.params as any;
  if (job.kind === 'stats') {
    const card = await runTally(piece, to, line, `tally-close-${taipeiDay()}-${orb.slot}-${piece.id}`);
    if (!card || card === 'quota') return 'tally_failed';
    await line.push(owner, [noticeCard('⏰ 統計已截止', '以下是截止時的結果。'), card]);
    return 'sent';
  }
  // 定時提醒 with a fixed sentence: sent as it is, no AI and no quota.
  if (job.kind === 'push' && p.say) {
    await line.push(to, [noticeCard('⏰ 提醒', String(p.say))]);
    return 'sent';
  }
  if (job.kind === 'push' && p.day) {
    const day = taipeiDay(p.day === 'tomorrow' ? 1 : 0);
    const { data } = await db
      .from(T('records'))
      .select('day,time,title')
      .eq('kind', 'event')
      .eq('source_id', to)
      .eq('day', day)
      .order('time', { ascending: true })
      .limit(20);
    if (!data?.length) return 'nothing';
    const label = p.day === 'tomorrow' ? '明天' : '今天';
    await line.push(to, [
      noticeCard(`⏰ ${label}的行程`, data.map((e: any) => `${e.time} ${e.title}`.trim()).join('\n')),
    ]);
    return 'sent';
  }
  const stats = pieceOf(orb, 'stats');
  const card =
    p.show === 'stats' && stats && orb.target !== 'me'
      ? await runTally(stats, to, line, `tally-push-${taipeiDay()}-${orb.slot}-${piece.id}`)
      : await viewCard(p.show === 'stats' ? 'summary' : p.show, to, true, owner);
  // A timed push with nothing to show stays silent instead of sending an empty card every day.
  if (!card) return 'nothing';
  if (card === 'quota') return 'tally_failed';
  await line.push(to, [card]);
  return 'sent';
}

export { orbFor };
