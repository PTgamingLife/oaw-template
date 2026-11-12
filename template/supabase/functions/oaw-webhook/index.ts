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
import { askCard, exampleCard, matchExample } from '../_shared/onboarding.ts';
import { PX } from '../_shared/px.ts';
import {
  bindOwner,
  env,
  loadConfig,
  ownerId,
  peekPending,
  saveConfig,
  setPending,
  takePending,
  upsertMember,
} from '../_shared/store.ts';

const text = (t: string) => ({ type: 'text', text: t.slice(0, 5000) });

async function aprico(urlName: string, body: unknown) {
  const url = env(urlName),
    key = env('APRICO_KEY');
  if (!url || !key) return { status: 503, data: null };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: res.ok ? await res.json() : null };
}

async function handle(event: any, line: ReturnType<typeof lineClient>) {
  const userId: string = event.source?.type === 'user' ? event.source.userId : '';
  const replyToken: string = event.replyToken;
  if (!userId || !replyToken) return;
  const config = await loadConfig();
  const reply = (...messages: unknown[]) => line.reply(replyToken, messages);

  if (event.type === 'follow') {
    const profile = await line.profile(userId).catch(() => ({ displayName: '' }));
    await upsertMember(userId, profile.displayName ?? '');
    if (config.welcome) await reply(text(config.welcome));
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
  if (intent.kind === 'bind') {
    if (await bindOwner(userId, intent.code)) {
      // Owner-only menu: 設定我的 AI 秘書 / 設定我的介面 (created during setup).
      await line.linkMenuByName(userId, `${PX}-owner`).catch(() => false);
      await setPending(userId, { onboarding: true });
      await reply(text('已把你設定為這個帳號的管理者。'), askCard());
      return;
    }
    intent = textIntent('', config, owner === userId);
  }

  // Right after binding: answer "what should I help with?" with the closest example.
  if (owner === userId && ((await peekPending(userId)) as any)?.onboarding) {
    await takePending(userId);
    const liff = env('LIFF_URL');
    await reply(
      exampleCard(matchExample(event.message.text), liff ? `${liff}?view=secretary` : ''),
    );
    return;
  }

  switch (intent.kind) {
    case 'cell':
      await reply(cellMessage(config, intent.index));
      return;
    case 'cancel':
      await takePending(userId);
      await reply(text('已取消這次修改。'));
      return;
    case 'apply': {
      const proposal = (await takePending(userId)) as { config?: unknown } | null;
      if (!proposal?.config) {
        await reply(text('目前沒有待套用的修改。'));
        return;
      }
      await saveConfig(validateConfig(proposal.config));
      const liff = env('LIFF_URL');
      await reply(
        text('已套用。' + (liff ? `\n選單有變更的話，請開啟這裡重新發布：${liff}?view=admin` : '')),
      );
      return;
    }
    case 'design': {
      const { status, data } = await aprico('APRICO_DESIGN_URL', {
        requestId: event.webhookEventId,
        request: intent.request.slice(0, 1500),
        config,
      });
      if (status === 402) {
        await reply(text('本月額度已用完，請到 Aprico 加購後再試。'));
        return;
      }
      if (!data?.config || typeof data.summary !== 'string') {
        await reply(text('修改功能目前無法使用，請稍後再試。'));
        return;
      }
      const proposed = validateConfig(data.config);
      await setPending(userId, { config: proposed });
      await reply(text(`${data.summary}\n\n回覆「套用」確認，或回覆「取消」。`));
      return;
    }
    case 'secretary': {
      const { status, data } = await aprico('APRICO_RUNTIME_URL', {
        requestId: event.webhookEventId,
        text: event.message.text.slice(0, 1500),
      });
      if (typeof data?.reply === 'string') {
        await reply(text(data.reply));
        return;
      }
      if (status === 402 && owner && owner !== userId)
        await line
          .push(owner, [text('提醒：本月秘書額度已用完，好友目前只會收到預設回覆。')])
          .catch(() => {});
      await reply(text(config.failure));
      return;
    }
    default:
      await reply(text(config.failure));
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
