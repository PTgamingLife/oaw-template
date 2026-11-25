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
import { healthEnabled, healthChat } from '../_shared/health-chat.ts';
import { applyProposal, healthSnapshot, settingsReply } from '../_shared/owner-settings.ts';
import { guardOwner, ownerLocked } from '../_shared/guard.ts';
import { bindNamedGroup, groupPostback, groupText, ownerGroupSend } from '../_shared/groups.ts';
import { loadOrbs, sharedPersona } from '../_shared/orbs.ts';
import { orbClaims, orbFor, pieceOf } from '../_shared/orb-logic.ts';
import { orbText } from '../_shared/orb-run.ts';
import {
  listLinks,
  saveReceived,
  sendConfirmCard,
  sendErrorText,
  sendIntent,
  sendLink,
} from '../_shared/links.ts';
import {
  apricoKey,
  bindOwner,
  connectOwner,
  groupBound,
  env,
  loadConfig,
  onceToday,
  ownerId,
  IMAGE_BASE,
  peekPending,
  saveMessage,
  saveConfig,
  setPending,
  takePending,
  upsertMember,
} from '../_shared/store.ts';

/** Aprico app API: '' = secretary reply, 'design' = config edit, 'settings' = owner message. */
async function aprico(route: '' | 'design' | 'settings' | 'unlock', body: unknown) {
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

/**
 * Groups: the owner says 綁定群組 once; after that every text line is kept for the nightly
 * digest, and anyone there can call the AI with the call word (groups.ts).
 */
async function handleGroup(event: any, line: ReturnType<typeof lineClient>) {
  if (event.type !== 'message' || event.message?.type !== 'text') return;
  const groupId: string = event.source.groupId ?? event.source.roomId ?? '';
  const userId: string = event.source.userId ?? '';
  if (!groupId) return;
  const owner = await ownerId();
  if (['綁定', '綁定群組'].includes(event.message.text.trim())) {
    if (!owner || userId !== owner) return;
    await bindNamedGroup(line, event.source);
    const liff = env('LIFF_URL');
    // Binding only makes the group selectable; what happens here is decided by its orb.
    await line.reply(event.replyToken, [
      noticeCard(
        '✅ 已綁定這個群組',
        '接下來請管理者打開秘書，點一顆光球，在「對話對象」選這個群組，再放上想要的拼圖。光球開啟之前，這裡不會記錄任何內容。',
        liff ? { label: '打開秘書', uri: `${liff}?view=orbs` } : undefined,
      ),
    ]);
    return;
  }
  if (!(await groupBound(groupId))) return;
  const orbs = await loadOrbs().catch(() => []);
  const orb = orbFor(orbs, groupId);
  if (orb) return void (await orbText(event, line, owner, orb, groupId, await sharedPersona()));
  // An orb is set to this group but switched off: nothing runs and nothing is kept.
  if (orbClaims(orbs, groupId)) return;
  await groupText(event, line, owner);
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
  // Emergency lock (set from Aprico): every owner function stops; friends are unaffected.
  const ownerNow = await ownerId();
  if (ownerNow && ownerNow === userId && (await ownerLocked()) === true) {
    await reply(
      noticeCard(
        '🔒 此帳號已鎖定',
        '管理功能已暫停。如果是你本人鎖定的，請到 Aprico 會員中心的「帳號安全」用 GitHub 驗證後解鎖。',
      ),
    );
    return;
  }
  if (event.type === 'postback') {
    const data = String(event.postback?.data ?? '');
    if (ownerNow === userId && data === 'link-send-ok') {
      const p: any = await takePending(userId);
      if (!p?.linkSend)
        return void (await reply(noticeCard('已經過期', '請再傳一次「傳給…：…」。')));
      try {
        const r = await sendLink(p.linkSend.linkId, 'manual', p.linkSend.text);
        return void (await reply(
          noticeCard('✅ 已送出', `已傳給「${p.linkSend.label}」。今天還可以傳 ${r.left} 則。`),
        ));
      } catch (e) {
        return void (await reply(noticeCard('沒有送出', sendErrorText((e as Error).message))));
      }
    }
    if (
      ownerNow === userId &&
      (await groupPostback(data, userId, reply, line, String(event.webhookEventId ?? '')))
    )
      return;
    const saveId = data.match(/^link-save:([0-9a-f-]{36})$/)?.[1];
    if (ownerNow === userId && saveId) {
      const ok = await saveReceived(saveId, userId);
      return void (await reply(
        noticeCard(
          ok ? '📝 已加入今晚整理' : '找不到這則訊息',
          ok ? '晚上會和其他紀錄一起整理。' : '可能已超過 30 天。',
        ),
      ));
    }
    const health = await healthChat(event, userId, ownerNow, line);
    if (health) return void (await reply(health));
    const index = postbackCell(String(event.postback?.data ?? ''), config);
    if (index >= 0) await reply(cellMessage(config, index, IMAGE_BASE));
    return;
  }
  if (event.type !== 'message' || event.message?.type !== 'text') return;

  const owner = await ownerId();
  // 「傳給設計部：…」 to a linked account: confirm first, then seal and send.
  if (owner === userId && /^傳給/.test(event.message.text.trim())) {
    const links = await listLinks().catch(() => []);
    const want = sendIntent(event.message.text, links);
    if (want?.link) {
      await setPending(userId, {
        linkSend: { linkId: want.link.id, label: want.link.peerLabel, text: want.text },
      });
      return void (await reply(sendConfirmCard(want.link.peerLabel, want.text)));
    }
    if (want)
      return void (await reply(
        noticeCard(
          `找不到「${want.asked}」`,
          want.names?.length
            ? `目前連結的帳號：${want.names.join('、')}`
            : '還沒有連結其他帳號。跨帳號連結功能開通中，敬請期待。',
        ),
      ));
  }
  // 領航者版: the owner types the one-time unlock code from Aprico in this chat.
  const unlock = event.message.text.toUpperCase().replace(/[\s-]/g, '');
  if (owner === userId && /^(領航者)?[A-HJ-NP-Z2-9]{12}$/.test(unlock)) {
    const { status, data } = await aprico('unlock', { code: unlock.slice(-12) });
    const liff = env('LIFF_URL');
    await reply(
      data?.plan === 'navigator'
        ? noticeCard(
            '🧭 領航者版已解鎖',
            '現在可以用介面設計中心修改介面、設計卡片，並把設計好的光球發給連結的秘書帳號。',
            liff ? { label: '打開介面設計中心', uri: `${liff}?view=design` } : undefined,
          )
        : noticeCard(
            '解鎖碼無效',
            status === 423
              ? '這個帳號目前鎖定中，請先解鎖。'
              : '解鎖碼不正確、已使用或已過期（7 天內有效）。請向 Aprico 重新索取。',
          ),
    );
    return;
  }
  const orbs = owner === userId ? await loadOrbs().catch(() => []) : [];
  // 「發到群組：…」: an announcement to a bound group, confirmed before it is sent.
  if (
    owner === userId &&
    /^發到/.test(event.message.text.trim()) &&
    (await ownerGroupSend(
      event.message.text,
      userId,
      reply,
      line,
      String(event.webhookEventId ?? ''),
      (g) => (orbClaims(orbs, g) ? Boolean(pieceOf(orbFor(orbs, g), 'announce')) : true),
    ))
  )
    return;
  // The owner's own orb: its 指令 word and 回答 call word are answered before anything else.
  const mine = orbFor(orbs, 'me');
  if (mine && (await orbText(event, line, owner, mine, userId, await sharedPersona()))) return;
  const health = await healthChat(event, userId, owner, line);
  if (health) return void (await reply(health));
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
    if (!healthEnabled()) {
      // 秘書版: no owner-only menu and no questionnaire. The orb page is where everything is.
      // Drop a personal menu left from an older version so the shared four-cell menu shows.
      await line.call(`/v2/bot/user/${userId}/richmenu`, undefined, 'DELETE').catch(() => null);
      await reply(welcomeOwner(owner ? 'AI 秘書已重新連接。' : '你已是這個帳號的管理者，AI 秘書也啟用了。'));
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
      if (!healthEnabled()) {
        await reply(welcomeOwner('已把你設定為這個帳號的管理者。'));
        return;
      }
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
      await reply(cellMessage(config, intent.index, IMAGE_BASE));
      return;
    case 'cancel':
      await takePending(userId);
      await reply(noticeCard('已取消', '這次修改不會套用。'));
      return;
    case 'apply': {
      const liff = env('LIFF_URL');
      try {
        await guardOwner(userId, true);
      } catch (e) {
        const code = (e as Error).message;
        // The proposal stays pending; the PIN page applies it after the PIN is checked.
        await reply(
          code === 'pin_required'
            ? noticeCard(
                '🔐 請輸入 PIN 確認',
                '套用設定前需要你的 PIN。',
                liff ? { label: '輸入 PIN 並套用', uri: `${liff}?view=confirm` } : undefined,
              )
            : noticeCard('暫時無法套用', '目前無法確認帳號狀態，請稍後再回覆「套用」。'),
        );
        return;
      }
      if (!(await applyProposal((await takePending(userId)) as any))) {
        await reply(noticeCard('沒有待套用的修改', '想調整時，傳「修改：你的需求」給我。'));
        return;
      }
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
      await setPending(userId, { config: proposed, summary: data.summary.slice(0, 300) });
      await reply(
        noticeCard('🎨 修改提案', `${data.summary}\n\n回覆「套用」確認，或回覆「取消」。`),
      );
      return;
    }
    case 'secretary':
    case 'fallback':
      // The owner's own free text is a note for the nightly digest.
      if (owner === userId) {
        // Plain words can also be a settings request (「週報不要發給我」); ask Aprico first.
        const snap = await healthSnapshot();
        const { status, data } = await aprico('settings', {
          requestId: event.webhookEventId,
          request: event.message.text.slice(0, 1500),
          config,
          health: snap?.model ?? null,
        });
        const s = status === 200 ? settingsReply(data, snap?.ids ?? null) : null;
        if (s?.kind === 'ask') {
          await reply(noticeCard('想確認一下', s.summary));
          return;
        }
        if (s?.kind === 'change') {
          await setPending(userId, { config: s.config, health: s.health, summary: s.summary });
          await reply(
            noticeCard('⚙️ 設定修改提案', `${s.summary}\n\n回覆「套用」確認，或回覆「取消」。`),
          );
          return;
        }
        // With orbs, the 1:1 chat is only recorded by a lit orb that has a 「紀錄」 piece.
        if (orbClaims(orbs, 'me') && !pieceOf(mine, 'record')) {
          const liff = env('LIFF_URL');
          await reply(
            noticeCard(
              '這則沒有記下',
              mine ? '個人對話的光球沒有「紀錄」拼圖。' : '個人對話的光球目前是關閉的。',
              liff ? { label: '打開我的 AI 秘書', uri: `${liff}?view=orbs` } : undefined,
            ),
          );
          return;
        }
        await saveMessage(userId, true, event.message.text, userId);
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

/** 秘書版: after connecting, one card that opens the orb page. */
function welcomeOwner(text: string) {
  const liff = env('LIFF_URL');
  return noticeCard(
    '✅ 連接完成',
    `${text}\n\n第一顆光球已經幫你開好行事曆秘書：直接跟我說行程，我就會記下來。輸入「行事曆」可以隨時查看。`,
    liff ? { label: '打開秘書', uri: `${liff}?view=orbs` } : undefined,
  );
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
