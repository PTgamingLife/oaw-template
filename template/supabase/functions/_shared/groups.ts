// Groups for one OA app: the owner posts announcements to a bound group from the 1:1 chat
// (「發到群組：…」, confirm first), and anyone in a bound group can call the AI with the call
// word (「小秘 整理／行程／記下：…／問題」). Group replies use the reply token (no push quota);
// AI use is billed to the owner's subscription and capped per group per day.
import { digestCard, digestRows } from './digest.ts';
import {
  announcementCard,
  cleanWake,
  groupCommand,
  groupConfirmCard,
  groupHelp,
  groupSendIntent,
  pickGroupMessage,
} from './group-intent.ts';
import { noticeCard, quotaCard } from './onboarding.ts';
import {
  apricoKey,
  bindGroup,
  countToday,
  db,
  env,
  loadConfig,
  markProcessed,
  onceToday,
  pendingMessages,
  saveMessage,
  saveRecords,
  setPending,
  T,
  takePending,
} from './store.ts';

type Line = {
  call: (path: string, body?: unknown, method?: string) => Promise<any>;
  reply: (token: string, messages: unknown[]) => Promise<unknown>;
  push: (to: string, messages: unknown[]) => Promise<unknown>;
};
type Reply = (...messages: unknown[]) => Promise<unknown>;

export async function groupPrefs() {
  const { data } = await db
    .from(T('owner'))
    .select('group_wake,group_daily,group_send_daily')
    .eq('id', 1)
    .maybeSingle();
  const n = (v: unknown, d: number) =>
    Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 200 ? (v as number) : d;
  return {
    wake: cleanWake(data?.group_wake),
    daily: n(data?.group_daily, 30),
    sendDaily: n(data?.group_send_daily, 20),
  };
}

export async function listGroups(): Promise<{ group_id: string; name: string }[]> {
  const { data } = await db
    .from(T('groups'))
    .select('group_id,name,bound_at')
    .order('bound_at', { ascending: true });
  return data ?? [];
}

const taipeiDay = (offset = 0) =>
  new Date(Date.now() + 8 * 3600 * 1000 + offset * 86400000).toISOString().slice(0, 10);

/** Upcoming events (next `days`), of one chat or of every chat. */
export async function upcomingEvents(sourceId: string | null, days = 7) {
  let q = db
    .from(T('records'))
    .select('day,time,title')
    .eq('kind', 'event')
    .gte('day', taipeiDay())
    .lte('day', taipeiDay(days));
  if (sourceId) q = q.eq('source_id', sourceId);
  const { data } = await q.order('day', { ascending: true }).limit(40);
  return (data ?? []) as { day: string; time: string; title: string }[];
}

async function compose(mode: 'polish' | 'write' | 'ask', requestId: string, extra: object) {
  const base = env('APRICO_URL'),
    key = await apricoKey();
  if (!base || !key) return { status: 503, text: '' };
  const res = await fetch(`${base}/compose`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, mode, ...extra }),
    signal: AbortSignal.timeout(30000),
  }).catch(() => null);
  const data = res?.ok ? await res.json().catch(() => null) : null;
  return { status: res?.status ?? 503, text: typeof data?.text === 'string' ? data.text : '' };
}

export async function aprDigest(requestId: string, messages: unknown[], focus = '', sort = '') {
  const base = env('APRICO_URL'),
    key = await apricoKey();
  if (!base || !key) return { status: 503, digest: null };
  const res = await fetch(`${base}/digest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, messages, ...(focus ? { focus } : {}), ...(sort ? { sort } : {}) }),
    signal: AbortSignal.timeout(60000),
  }).catch(() => null);
  return { status: res?.status ?? 503, digest: res?.ok ? await res.json().catch(() => null) : null };
}

export const fmt = (iso: string) =>
  new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).slice(0, 16);
export const eventLine = (e: { day: string; time: string; title: string }) =>
  `${e.day.slice(5)} ${e.time} ${e.title}`.replace('  ', ' ');

/** Bind a group (owner only), keeping LINE's group name for the owner's list. */
export async function bindNamedGroup(line: Line, source: any) {
  const id = source.groupId ?? source.roomId;
  const summary = source.groupId
    ? await line.call(`/v2/bot/group/${source.groupId}/summary`, undefined, 'GET').catch(() => null)
    : null;
  await bindGroup(id, typeof summary?.groupName === 'string' ? summary.groupName : '');
}

async function memberCount(line: Line, groupId: string) {
  const kind = groupId.startsWith('R') ? 'room' : 'group';
  const r = await line
    .call(`/v2/bot/${kind}/${groupId}/members/count`, undefined, 'GET')
    .catch(() => null);
  return Number(r?.count) || 0;
}

/**
 * A text line in a bound group that no orb is set to (the behaviour before orbs): lines that
 * call the AI are answered, every other line is kept for the nightly digest.
 */
export async function groupText(event: any, line: Line, owner: string) {
  const groupId: string = event.source.groupId ?? event.source.roomId;
  const userId: string = event.source.userId ?? '';
  const prefs = await groupPrefs();
  if (!(await callWord(event, line, owner, groupId, prefs.wake, prefs.daily)))
    await saveMessage(groupId, userId === owner, event.message.text, userId);
}

/**
 * 「小秘 整理／行程／記下：…／問題」 in one conversation (`sourceId` = group id, or the owner's
 * user id for the 1:1 chat). Returns false when the line does not start with the call word.
 * Received text is data, never a command for anything but these read/record actions.
 */
export async function callWord(
  event: any,
  line: Line,
  owner: string,
  sourceId: string,
  wake: string,
  daily: number,
  focus = '',
  style: Style = {},
) {
  const groupId = sourceId;
  const userId: string = event.source.userId ?? '';
  const prefs = { wake, daily };
  const cmd = groupCommand(event.message.text, wake);
  if (!cmd) return false;
  await runCall(cmd, event, line, owner, groupId, userId, prefs, focus, style);
  return true;
}

/** How an AI answer should sound: the 性格 text, and `brief` for the 回答 piece. */
export type Style = { persona?: string; brief?: boolean };

/**
 * 「回答」 piece: answer this message whatever it says (no call word). `daily` caps the AI
 * calls of one conversation per day, because every message costs the owner's quota.
 */
export async function answerAll(
  event: any,
  line: Line,
  owner: string,
  sourceId: string,
  daily: number,
  style: Style,
) {
  const text = String(event.message.text ?? '').trim().slice(0, 500);
  if (!text) return false;
  await runCall({ kind: 'ask', text }, event, line, owner, sourceId, event.source.userId ?? '', { wake: '秘書', daily }, '', style);
  return true;
}

async function runCall(
  cmd: NonNullable<ReturnType<typeof groupCommand>>,
  event: any,
  line: Line,
  owner: string,
  groupId: string,
  userId: string,
  prefs: { wake: string; daily: number },
  focus: string,
  style: Style = {},
) {
  const reply = (...m: unknown[]) => line.reply(event.replyToken, m);
  const title = `🤖 ${prefs.wake}`;
  if (cmd.kind === 'help') return void (await reply(noticeCard(title, groupHelp(prefs.wake))));
  if (cmd.kind === 'events') {
    const events = await upcomingEvents(groupId);
    return void (await reply(
      noticeCard(
        '📅 接下來 7 天',
        events.length ? events.map(eventLine).join('\n') : '接下來 7 天沒有行程。',
      ),
    ));
  }
  if ((await countToday(`grp:${groupId}`, prefs.daily)) < 0)
    return void (await reply(noticeCard(title, `今天在這裡已經叫了 ${prefs.daily} 次，明天再找我喔。`)));
  const quotaOut = async () => {
    await reply(noticeCard(title, '本月 AI 額度已用完，暫時無法處理。'));
    if (owner && (await onceToday('quota')))
      await line
        .push(owner, [
          noticeCard('額度提醒', '本月 AI 額度已用完，AI 功能暫停。'),
          quotaCard(env('APRICO_SUBSCRIBE_URL')),
        ])
        .catch(() => {});
  };
  const rid = String(event.webhookEventId ?? `g${Date.now()}`);

  if (cmd.kind === 'digest' || cmd.kind === 'note') {
    const msgs =
      cmd.kind === 'digest'
        ? await pendingMessages(9000, groupId)
        : [{ id: 0, is_owner: userId === owner, text: cmd.text, sent_at: new Date().toISOString() }];
    if (!msgs.length)
      return void (await reply(noticeCard('🧾 整理', '目前沒有新的對話需要整理。')));
    const { status, digest } = await aprDigest(
      `${cmd.kind}-${rid}`,
      msgs.map((m) => ({ at: fmt(m.sent_at), who: m.is_owner ? 'owner' : 'friend', text: m.text })),
      focus,
    );
    if (status === 402) return void (await quotaOut());
    if (!digest) return void (await reply(noticeCard(title, '暫時無法處理，請稍後再試。')));
    await saveRecords(digestRows(digest, groupId));
    if (cmd.kind === 'digest') await markProcessed(msgs.map((m) => m.id));
    const card = digestCard(digest, '', cmd.kind === 'digest' ? '🧾 整理' : '📝 已記下');
    return void (await reply(
      card ??
        noticeCard(
          title,
          cmd.kind === 'digest' ? '這段對話沒有需要記下的行程、帳務或待辦。' : '沒有找到可以記下的行程或待辦。',
        ),
    ));
  }
  // A question: answer with the recent lines of this group and its upcoming events.
  const { data } = await db
    .from(T('messages'))
    .select('text')
    .eq('source_id', groupId)
    .order('sent_at', { ascending: false })
    .limit(40);
  const lines: string[] = [];
  let bytes = 0;
  for (const m of data ?? []) {
    bytes += new TextEncoder().encode(m.text).length;
    if (bytes > 6000) break;
    lines.unshift(m.text);
  }
  const events = (await upcomingEvents(groupId, 14)).slice(0, 20);
  const { status, text: answer } = await compose('ask', `ask-${rid}`, {
    text: cmd.text,
    lines,
    events,
    ...(style.persona ? { persona: style.persona.slice(0, 800) } : {}),
    ...(style.brief ? { brief: true } : {}),
  });
  if (status === 402) return void (await quotaOut());
  await reply(noticeCard(title, answer || '暫時無法回答，請稍後再試。'));
}

/** The owner's 「發到群組：…」 in the 1:1 chat. Returns false when the text is something else. */
export async function ownerGroupSend(
  text: string,
  userId: string,
  reply: Reply,
  line: Line,
  rid: string,
  allowed?: (groupId: string) => boolean,
) {
  // With orbs, only groups whose lit orb has a 「公告」 piece (or that no orb is set to) take announcements.
  const groups = (await listGroups()).filter((g) => !allowed || allowed(g.group_id));
  const want = groupSendIntent(text, groups);
  if (!want) return false;
  if ('none' in want) {
    await reply(
      noticeCard('還沒有綁定群組', '把這個官方帳號邀進群組，在群組裡輸入「綁定群組」就可以了。'),
    );
    return true;
  }
  if ('missing' in want) {
    await reply(
      noticeCard(`找不到「${want.missing}」`, `目前綁定的群組：${want.names.join('、')}`),
    );
    return true;
  }
  let body = want.text;
  if (want.ai) {
    const events = await upcomingEvents(null, 14);
    const { data } = await db
      .from(T('records'))
      .select('title')
      .eq('kind', 'todo')
      .gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString())
      .order('created_at', { ascending: false })
      .limit(20);
    const r = await compose('write', `write-${rid}`, {
      text: want.text,
      events,
      todos: (data ?? []).map((t: { title: string }) => t.title),
    });
    if (r.status === 402) {
      await reply(quotaCard(env('APRICO_SUBSCRIBE_URL')));
      return true;
    }
    if (!r.text) {
      await reply(noticeCard('暫時無法撰寫', '請稍後再試，或直接寫好內容再發。'));
      return true;
    }
    body = r.text;
  }
  if ('choose' in want) {
    await setPending(userId, {
      groupSend: { text: body, choices: want.choose.map((g) => [g.group_id, g.name]) },
    });
    await reply(pickGroupMessage(want.choose));
    return true;
  }
  await setPending(userId, { groupSend: { text: body, groupId: want.group.group_id, name: want.group.name } });
  await reply(
    groupConfirmCard(want.group.name || '群組', body, await memberCount(line, want.group.group_id)),
  );
  return true;
}

/** Owner postbacks for an announcement: pick / 送出 / 幫我潤飾 / 取消. False when not ours. */
export async function groupPostback(data: string, userId: string, reply: Reply, line: Line, rid: string) {
  if (!/^grp-(pick:\d{1,2}|send|polish|cancel)$/.test(data)) return false;
  const p: any = (await takePending(userId))?.groupSend;
  if (!p) {
    await reply(noticeCard('已經過期', '請再傳一次「發到群組：…」。'));
    return true;
  }
  if (data === 'grp-cancel') {
    await reply(noticeCard('已取消', '這則公告不會發出。'));
    return true;
  }
  if (data.startsWith('grp-pick:')) {
    const choice = p.choices?.[Number(data.slice(9))];
    if (!choice) {
      await reply(noticeCard('已經過期', '請再傳一次「發到群組：…」。'));
      return true;
    }
    p.groupId = choice[0];
    p.name = choice[1];
    delete p.choices;
  }
  if (!p.groupId || !(await listGroups()).some((g) => g.group_id === p.groupId)) {
    await reply(noticeCard('找不到這個群組', '可能已經解除綁定。'));
    return true;
  }
  if (data === 'grp-polish') {
    const r = await compose('polish', `polish-${rid}`, { text: p.text });
    if (r.status === 402) {
      await setPending(userId, { groupSend: p });
      await reply(quotaCard(env('APRICO_SUBSCRIBE_URL')));
      return true;
    }
    if (r.text) p.text = r.text;
  }
  if (data !== 'grp-send') {
    await setPending(userId, { groupSend: p });
    await reply(groupConfirmCard(p.name || '群組', p.text, await memberCount(line, p.groupId)));
    return true;
  }
  const { sendDaily } = await groupPrefs();
  const left = await countToday('grp-send', sendDaily);
  if (left < 0) {
    await reply(noticeCard('今天的公告已達上限', `每天最多發 ${sendDaily} 則，可在「我的群組」調整。`));
    return true;
  }
  const config = await loadConfig();
  try {
    await line.push(p.groupId, [announcementCard(config.oaName, p.text)]);
  } catch {
    await reply(noticeCard('沒有發出', 'LINE 暫時無法送出，可能是本月推播則數已用完。'));
    return true;
  }
  await reply(noticeCard('✅ 已發出', `已發到〈${p.name || '群組'}〉。今天還可以發 ${left} 則。`));
  return true;
}

/** LIFF 「我的群組」: list, save the call word / daily limits / names, unbind. Owner only. */
export async function groupAction(action: string, body: any) {
  if (action === 'group_save') {
    const n = (v: unknown, d: number) => {
      const x = Number(v);
      return Number.isInteger(x) && x >= 1 && x <= 200 ? x : d;
    };
    const wake = cleanWake(body.wake);
    if (typeof body.wake === 'string' && body.wake.trim() !== wake) throw Error('wake_invalid');
    await db
      .from(T('owner'))
      .update({ group_wake: wake, group_daily: n(body.daily, 30), group_send_daily: n(body.sendDaily, 20) })
      .eq('id', 1);
    const names = body.names && typeof body.names === 'object' ? body.names : {};
    for (const g of await listGroups())
      if (typeof names[g.group_id] === 'string')
        await db
          .from(T('groups'))
          .update({ name: names[g.group_id].trim().slice(0, 40) })
          .eq('group_id', g.group_id);
  }
  if (action === 'group_unbind') {
    if (typeof body.groupId !== 'string') throw Error('group_invalid');
    await db.from(T('groups')).delete().eq('group_id', body.groupId);
  }
  const prefs = await groupPrefs();
  return {
    ...prefs,
    groups: (await listGroups()).map((g, i) => ({ id: g.group_id, name: g.name, index: i + 1 })),
  };
}
