// API for the LIFF page. Deployed as `{px}-api` with verify_jwt=false; every request
// carries a LIFF ID token that is verified with LINE before anything is returned.
import { publicConfig, richMenu } from '../_shared/logic.ts';
import { lineClient, statelessToken, verifyIdToken } from '../_shared/line.ts';
import {
  apricoKey,
  env,
  loadConfig,
  member,
  ownerId,
  peekPending,
  saveConfig,
  takePending,
  upsertMember,
} from '../_shared/store.ts';
import { PX } from '../_shared/px.ts';
import { healthAction } from '../_shared/health-api.ts';
import { guardOwner, pinStatus, setPin, verifyPin } from '../_shared/guard.ts';
import { applyProposal } from '../_shared/owner-settings.ts';
import { groupAction } from '../_shared/groups.ts';
import { orbAction } from '../_shared/orbs.ts';
import { acceptLink, aprLink, createLink, listLinks, pullInbox } from '../_shared/links.ts';
import {
  DEFAULT_SUBSCRIBE_URL,
  EXAMPLES,
  INTERFACE_TEMPLATES,
  MONTHLY_FEE,
  SECRETARY_TEMPLATES,
  TUTORIAL,
} from '../_shared/onboarding.ts';

type Quota = {
  paid: boolean;
  percentLeft?: number;
  extraTwdLeft?: number;
  paidUntil?: string;
  plan?: 'navigator' | 'secretary';
};

/** Subscription quota from Aprico; anything other than a clear "paid" counts as unpaid. */
async function quota(): Promise<Quota> {
  const base = env('APRICO_URL'),
    url = base && `${base}/status`,
    key = await apricoKey();
  if (!url || !key) return { paid: false };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    });
    const q = res.ok ? await res.json() : null;
    const plan = q?.plan === 'navigator' ? 'navigator' : 'secretary';
    if (q?.paid !== true) return { paid: false, plan };
    return {
      paid: true,
      plan,
      percentLeft: Math.max(0, Math.min(100, Number(q.percentLeft) || 0)),
      extraTwdLeft: Math.max(0, Number(q.extraTwdLeft) || 0),
      paidUntil: typeof q.paidUntil === 'string' ? q.paidUntil : '',
    };
  } catch {
    return { paid: false };
  }
}

const MAX_IMAGE = 1_000_000;

function cors(req: Request) {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = env('PAGES_ORIGIN');
  return {
    'Access-Control-Allow-Origin': origin && origin === allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

function decodePng(b64: unknown) {
  if (typeof b64 !== 'string' || b64.length > (MAX_IMAGE * 4) / 3 + 4) throw Error('image_invalid');
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length > MAX_IMAGE || !sig.every((b, i) => bytes[i] === b))
    throw Error('image_invalid');
  // PNG IHDR width/height must match the menu size.
  const view = new DataView(bytes.buffer);
  if (view.getUint32(16) !== 1200 || view.getUint32(20) !== 810) throw Error('image_size_invalid');
  return bytes;
}

Deno.serve(async (req) => {
  const headers = cors(req);
  const respond = (data: unknown, status = 200) => Response.json(data, { status, headers });
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return respond({ error: 'not_found' }, 404);
  let body: any;
  try {
    const raw = await req.text();
    if (raw.length > 2_000_000) return respond({ error: 'too_large' }, 413);
    body = JSON.parse(raw);
  } catch {
    return respond({ error: 'bad_request' }, 400);
  }
  // Aprico's relay pings here when a sealed message is waiting (no data in the ping).
  if (body?.action === 'link_ping') {
    const owner = await ownerId();
    const push = async (messages: unknown[]) =>
      lineClient(await statelessToken(env('LINE_MSG_ID'), env('LINE_MSG_SECRET'))).push(
        owner,
        messages,
      );
    const n = owner ? await pullInbox(push).catch(() => 0) : 0;
    return respond({ ok: true, received: n });
  }
  let user;
  try {
    user = await verifyIdToken(String(body?.idToken ?? ''), env('LINE_LOGIN_ID'));
  } catch {
    return respond({ error: 'login_required' }, 401);
  }
  try {
    const config = await loadConfig();
    const isOwner = (await ownerId()) === user.sub;
    if (body.action === 'me') {
      let card = await member(user.sub);
      if (!card) {
        await upsertMember(user.sub, user.name);
        card = await member(user.sub);
      }
      return respond({ config: publicConfig(config), member: card, isOwner });
    }
    // Owner PIN and pending proposal (applied here after the PIN when one is set).
    if (typeof body.action === 'string' && body.action.startsWith('pin_')) {
      if (!isOwner) return respond({ error: 'owner_only' }, 403);
      await guardOwner(user.sub, false);
      if (body.action === 'pin_set') await setPin(user.sub, body.pin, body.oldPin);
      if (body.action === 'pin_verify') await verifyPin(user.sub, body.pin);
      return respond(await pinStatus(user.sub));
    }
    if (typeof body.action === 'string' && body.action.startsWith('link_')) {
      if (!isOwner) return respond({ error: 'owner_only' }, 403);
      // Listing only needs an unlocked owner; anything that changes a link needs the PIN.
      await guardOwner(user.sub, body.action !== 'link_list');
      const label = typeof body.label === 'string' ? body.label.trim().slice(0, 20) : '';
      if (body.action === 'link_list') return respond({ links: await listLinks() });
      if (body.action === 'link_create') return respond(await createLink(label));
      if (body.action === 'link_accept')
        return respond(await acceptLink(String(body.code ?? ''), label, body.scope));
      if (body.action === 'link_scope')
        return respond(await aprLink('scope', { linkId: body.linkId, scope: body.scope }));
      if (body.action === 'link_revoke')
        return respond(await aprLink('revoke', { linkId: body.linkId }));
    }
    if (['orb_list', 'orb_save', 'orb_check', 'orb_toggle'].includes(body.action)) {
      if (!isOwner) return respond({ error: 'owner_only' }, 403);
      await guardOwner(user.sub, body.action !== 'orb_list');
      return respond(await orbAction(body.action, body, `orb-${crypto.randomUUID()}`));
    }
    if (['group_list', 'group_save', 'group_unbind'].includes(body.action)) {
      if (!isOwner) return respond({ error: 'owner_only' }, 403);
      await guardOwner(user.sub, body.action !== 'group_list');
      return respond(await groupAction(body.action, body));
    }
    if (body.action === 'pending_peek' || body.action === 'pending_apply') {
      if (!isOwner) return respond({ error: 'owner_only' }, 403);
      const pending: any = await peekPending(user.sub);
      const has = Boolean(pending?.config || pending?.health);
      if (body.action === 'pending_peek')
        return respond({ pending: has, summary: has ? String(pending.summary ?? '') : '' });
      await guardOwner(user.sub, true);
      return respond({ applied: await applyProposal((await takePending(user.sub)) as any) });
    }
    if (typeof body.action === 'string' && body.action.startsWith('h_')) {
      // The elder's own health views and settings need a recent PIN; family members do not.
      if (isOwner) await guardOwner(user.sub, true);
      return respond(await healthAction(body.action, body, user.sub));
    }
    if (body.action === 'settings') {
      if (!isOwner) return respond({ error: 'owner_only' }, 403);
      await guardOwner(user.sub, false);
      const view = body.view === 'interface' ? 'interface' : 'secretary';
      return respond({
        view,
        ...(await quota()),
        fee: MONTHLY_FEE,
        subscribeUrl: env('APRICO_SUBSCRIBE_URL') || DEFAULT_SUBSCRIBE_URL,
        templates: view === 'interface' ? INTERFACE_TEMPLATES : SECRETARY_TEMPLATES,
        examples: EXAMPLES,
        tutorial: TUTORIAL,
      });
    }
    if (body.action === 'publish_menu') {
      if (!isOwner) return respond({ error: 'owner_only' }, 403);
      await guardOwner(user.sub, true);
      const png = decodePng(body.image);
      // The shape chosen on the publish page is remembered for later edits.
      if (body.shape !== undefined && body.shape !== config.shape)
        Object.assign(config, await saveConfig({ ...config, shape: body.shape }));
      const liffUrl = env('LIFF_URL');
      const token = await statelessToken(env('LINE_MSG_ID'), env('LINE_MSG_SECRET'));
      const id = await lineClient(token).publishMenu(
        richMenu(config, PX, liffUrl),
        png,
        `${PX}-main`,
      );
      return respond({ ok: true, richMenuId: id });
    }
    return respond({ error: 'unknown_action' }, 400);
  } catch (e) {
    const code = e instanceof Error && /^[a-z_0-9]{3,40}$/.test(e.message) ? e.message : 'failed';
    console.warn('oaw api failed:', code);
    const status =
      code.startsWith('image_') || code.startsWith('invalid_') || code.endsWith('_invalid')
        ? 400
        : code === 'health_forbidden' || code === 'consent_required' || code === 'owner_only'
          ? 403
          : code === 'owner_locked' || code === 'pin_wait'
            ? 423
            : code === 'pin_required' || code === 'pin_wrong' || code === 'pin_not_set'
              ? 401
              : code === 'lock_unknown'
                ? 503
                : code === 'points_insufficient'
                  ? 402
                  : code === 'rate_limited'
                    ? 429
                    : 500;
    return respond({ error: code }, status);
  }
});
