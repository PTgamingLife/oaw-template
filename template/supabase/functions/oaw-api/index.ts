// API for the LIFF page. Deployed as `{px}-api` with verify_jwt=false; every request
// carries a LIFF ID token that is verified with LINE before anything is returned.
import { publicConfig, richMenu } from '../_shared/logic.ts';
import { lineClient, statelessToken, verifyIdToken } from '../_shared/line.ts';
import { env, loadConfig, member, ownerId, upsertMember } from '../_shared/store.ts';
import { PX } from '../_shared/px.ts';
import {
  EXAMPLES,
  INTERFACE_TEMPLATES,
  MONTHLY_FEE,
  SECRETARY_TEMPLATES,
  TUTORIAL,
} from '../_shared/onboarding.ts';

const DEFAULT_SUBSCRIBE_URL = 'https://liff.line.me/2012197506-Vmb4O5iT/build.html';

/** Subscription state comes from Aprico; anything other than a clear "paid" counts as unpaid. */
async function isPaid() {
  const url = env('APRICO_STATUS_URL'),
    key = env('APRICO_KEY');
  if (!url || !key) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    });
    return res.ok && (await res.json())?.paid === true;
  } catch {
    return false;
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
    if (body.action === 'settings') {
      if (!isOwner) return respond({ error: 'owner_only' }, 403);
      const view = body.view === 'interface' ? 'interface' : 'secretary';
      return respond({
        view,
        paid: await isPaid(),
        fee: MONTHLY_FEE,
        subscribeUrl: env('APRICO_SUBSCRIBE_URL') || DEFAULT_SUBSCRIBE_URL,
        templates: view === 'interface' ? INTERFACE_TEMPLATES : SECRETARY_TEMPLATES,
        examples: EXAMPLES,
        tutorial: TUTORIAL,
      });
    }
    if (body.action === 'publish_menu') {
      if (!isOwner) return respond({ error: 'owner_only' }, 403);
      const png = decodePng(body.image);
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
    return respond({ error: code }, code.startsWith('image_') ? 400 : 500);
  }
});
