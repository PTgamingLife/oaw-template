// LINE webhook for one OA app. Deployed as `{px}-webhook` with verify_jwt=false;
// every request is authenticated by the LINE signature instead.
import {
  cellMessage,
  postbackCell,
  textIntent,
  validateConfig,
  verifySignature,
} from '../_shared/logic.ts';
import { lineClient, statelessToken } from '../_shared/line.ts';
import {
  askCard,
  exampleCard,
  matchExample,
  noticeCard,
  quotaCard,
} from '../_shared/onboarding.ts';
import { PX } from '../_shared/px.ts';
import {
  apricoKey,
  bindGroup,
  bindOwner,
  connectOwner,
  groupBound,
  env,
  loadConfig,
  onceToday,
  ownerId,
  peekPending,
  saveMessage,
  saveConfig,
  setPending,
  takePending,
  upsertMember,
} from '../_shared/store.ts';

/** Aprico app API: '' = secretary reply, 'design' = config edit proposal. */
async function aprico(route: '' | 'design', body: unknown) {
  const base = env('APRICO_URL'),
    key = await apricoKey(),
    url = base && (route ? `${base}/${route}` : base);
  if (!url || !key) return { status: 503, data: null };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: res.ok ? await res.json() : null };
}

const RECORDED = '晚上 9 點會幫你整理成行程、帳務和待辦。';

/** Groups: the owner says 綁定群組 once; after that every text line is kept for the nightly digest. */
async function handleGroup(event: any, line: ReturnType<typeof lineClient>) {
  if (event.type !== 'message' || event.message?.type !== 'text') return;
  const groupId: string = event.source.groupId ?? event.source.roomId ?? '';
  const userId: string = event.source.userId ?? '';
  if (!groupId) return;
  const owner = await ownerId();
  if (event.message.text.trim() === '綁定群組') {
    if (!owner || userId !== owner) return;
    await bindGroup(groupId);
    await line.reply(event.replyToken, [
      noticeCard(
        '📝 開始記錄這個群組',
        '這個群組裡提到的行程、帳務和待辦，每晚 9 點整理後私訊給你。',
      ),
    ]);
    return;
  }
  if (await groupBound(groupId)) await saveMessage(groupId, userId === owner, event.message.text);
}

async function handle(event: any, line: ReturnType<typeof lineClient>) {
  if (['group', 'room'].includes(event.source?.type)) return handleGroup(event, line);
  const userId: string = event.source?.type === 'user' ? event.source.userId : '';
  const replyToken: string = event.replyToken;
  if (!userId || !replyToken) return;
  const config = await loadConfig();
  const reply = (...messages: unknown[]) => line.reply(replyToken, messages);

  if (event.type === 'follow') {
    const profile = await line.profile(userId).catch(() => ({ displayName: '' }));
    await upsertMember(userId, profile.displayName ?? '');
    if (config.welcome) await reply(noticeCard(config.oaName || '歡迎', config.welcome));
    return;
  }
  if (event.type === 'postback') {
    const index = postbackCell(String(event.postback?.data ?? ''), config);
    if (index >= 0) await reply(cellMessage(config, index));
    return;
  }
  if (event.type !== 'message' || event.message?.type !== 'text') return;

  const owner = await ownerId();
  let intent = textIntent(event.message.text, config, owner === userId);
  if (intent.kind === 'connect') {
    if (owner && owner !== userId) {
      await reply(noticeCard('無法連接', '這個帳號已經有管理者了。'));
      return;
    }
    const base = env('APRICO_URL');
    const res = base
      ? await fetch(`${base}/connect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: intent.code }),
          signal: AbortSignal.timeout(10000),
        }).catch(() => null)
      : null;
    const key = res?.ok ? (await res.json().catch(() => null))?.key : null;
    if (typeof key !== 'string' || !/^aprico_[a-f0-9]{64}$/.test(key)) {
      await reply(
        noticeCard('連接碼無效', '連接碼可能已過期或用過了，請回 Aprico 官方 LINE 重新取得。'),
      );
      return;
    }
    if (!(await connectOwner(userId, key))) {
      await reply(noticeCard('無法連接', '這個帳號已經有管理者了。'));
      return;
    }
    await line.linkMenuByName(userId, `${PX}-owner`).catch(() => false);
    if (!owner) {
      await setPending(userId, { onboarding: true });
      await reply(
        noticeCard('✅ 連接完成', '你已是這個帳號的管理者，AI 秘書也啟用了。'),
        askCard(),
      );
    } else await reply(noticeCard('✅ 連接完成', 'AI 秘書已重新連接。'));
    return;
  }
  if (intent.kind === 'bind') {
    if (await bindOwner(userId, intent.code)) {
      // Owner-only menu: 設定我的 AI 秘書 / 設定我的介面 (created during setup).
      await line.linkMenuByName(userId, `${PX}-owner`).catch(() => false);
      await setPending(userId, { onboarding: true });
      await reply(noticeCard('✅ 綁定完成', '已把你設定為這個帳號的管理者。'), askCard());
      return;
    }
    intent = textIntent('', config, owner === userId);
  }

  // Right after binding: answer "what should I help with?" with the closest example.
  if (owner === userId && ((await peekPending(userId)) as any)?.onboarding) {
    await takePending(userId);
    const liff = env('LIFF_URL');
    await reply(
      exampleCard(
        matchExample(event.message.text),
        liff ? `${liff}?view=secretary` : '',
        env('PAGES_URL'),
      ),
    );
    return;
  }

  switch (intent.kind) {
    case 'cell':
      await reply(cellMessage(config, intent.index));
      return;
    case 'cancel':
      await takePending(userId);
      await reply(noticeCard('已取消', '這次修改不會套用。'));
      return;
    case 'apply': {
      const proposal = (await takePending(userId)) as { config?: unknown } | null;
      if (!proposal?.config) {
        await reply(noticeCard('沒有待套用的修改', '想調整時，傳「修改：你的需求」給我。'));
        return;
      }
      await saveConfig(validateConfig(proposal.config));
      const liff = env('LIFF_URL');
      await reply(
        noticeCard(
          '✅ 已套用',
          '新的設定已經生效。選單有變更的話，請重新發布選單。',
          liff ? { label: '重新發布選單', uri: `${liff}?view=admin` } : undefined,
        ),
      );
      return;
    }
    case 'design': {
      const { status, data } = await aprico('design', {
        requestId: event.webhookEventId,
        request: intent.request.slice(0, 1500),
        config,
      });
      if (status === 402) {
        await reply(quotaCard(env('APRICO_SUBSCRIBE_URL')));
        return;
      }
      if (status === 429) {
        await reply(noticeCard('請稍等一下', '短時間內的修改太多了，請一分鐘後再試。'));
        return;
      }
      if (!data?.config || typeof data.summary !== 'string') {
        await reply(noticeCard('暫時無法修改', '修改功能目前無法使用，請稍後再試。'));
        return;
      }
      const proposed = validateConfig(data.config);
      await setPending(userId, { config: proposed });
      await reply(
        noticeCard('🎨 修改提案', `${data.summary}\n\n回覆「套用」確認，或回覆「取消」。`),
      );
      return;
    }
    case 'secretary':
    case 'fallback':
      // The owner's own free text is a note for the nightly digest.
      if (owner === userId) {
        await saveMessage(userId, true, event.message.text);
        await reply(noticeCard('📝 已記下', RECORDED));
        return;
      }
      if (intent.kind === 'fallback') {
        await reply(noticeCard(config.oaName || '小提醒', config.failure));
        return;
      }
      {
        const { status, data } = await aprico('', {
          requestId: event.webhookEventId,
          text: event.message.text.slice(0, 1500),
        });
        if (typeof data?.reply === 'string') {
          await reply(noticeCard(config.oaName || 'AI 秘書', data.reply));
          return;
        }
        // Remind the owner at most once a day, not on every friend message.
        if (status === 402 && owner && owner !== userId && (await onceToday('quota')))
          await line
            .push(owner, [
              noticeCard('額度提醒', '本月秘書額度已用完，好友目前只會收到預設回覆。'),
              quotaCard(env('APRICO_SUBSCRIBE_URL')),
            ])
            .catch(() => {});
        await reply(noticeCard(config.oaName || '小提醒', config.failure));
        return;
      }
    default:
      await reply(noticeCard(config.oaName || '小提醒', config.failure));
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('not found', { status: 404 });
  const body = await req.text();
  if (body.length > 1_000_000) return new Response('too large', { status: 413 });
  if (!(await verifySignature(env('LINE_MSG_SECRET'), body, req.headers.get('x-line-signature'))))
    return new Response('unauthorized', { status: 401 });
  let events: any[] = [];
  try {
    events = JSON.parse(body).events ?? [];
  } catch {
    return new Response('bad request', { status: 400 });
  }
  if (!events.length) return new Response('ok'); // LINE "Verify" sends no events.
  const token = await statelessToken(env('LINE_MSG_ID'), env('LINE_MSG_SECRET'));
  const line = lineClient(token);
  for (const event of events.slice(0, 20)) {
    try {
      await handle(event, line);
    } catch (e) {
      console.warn('oaw event failed:', e instanceof Error ? e.message : 'unknown');
    }
  }
  return new Response('ok');
});
