// Builds one OA app inside the customer's own GitHub Actions.
// Run: node --experimental-strip-types scripts/oaw-setup.mjs [--dry-run]
// Inputs come from Actions secrets/variables (see .github/workflows/oaw-setup.yml).
// Writes oaw/status.json (public values only) and liff/config.js.
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { validateConfig } from '../template/supabase/functions/_shared/logic.ts';

const DRY = process.argv.includes('--dry-run');
const E = (name) => (process.env[name] ?? '').trim();
const SB = 'https://api.supabase.com';
const LINE = 'https://api.line.me';
const status = { ok: false, steps: {}, finished_at: null };
const save = () => writeFileSync('oaw/status.json', JSON.stringify(status, null, 2) + '\n');
const step = (name, value = 'done') => {
  status.steps[name] = value;
  save();
  console.log(`[oaw] ${name}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
};

export function inputs(env = process.env) {
  // Lowercase so a phone keyboard's automatic capital ("Test1") still works.
  const px = (env.OAW_PX ?? '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9]{1,7}$/.test(px)) throw Error('OAW_PX 必須是 2–8 個小寫英數字，字母開頭');
  const repo = (env.GITHUB_REPOSITORY ?? '').trim();
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw Error('GITHUB_REPOSITORY 缺少');
  const pagesOrigin = `https://${owner.toLowerCase()}.github.io`;
  return { px, UP: px.toUpperCase(), pagesOrigin, pagesUrl: `${pagesOrigin}/${name}/` };
}

/** Copy the function sources into build/ with the prefix applied. */
export function render(px, out = 'build') {
  rmSync(out, { recursive: true, force: true });
  const fn = `${out}/supabase/functions`;
  mkdirSync(fn, { recursive: true });
  cpSync('template/supabase/functions/_shared', `${fn}/_shared`, { recursive: true });
  cpSync('template/supabase/functions/oaw-webhook', `${fn}/${px}-webhook`, { recursive: true });
  cpSync('template/supabase/functions/oaw-api', `${fn}/${px}-api`, { recursive: true });
  writeFileSync(`${fn}/_shared/px.ts`, `export const PX = '${px}';\n`);
  writeFileSync(`${out}/supabase/config.toml`, `project_id = "${px}-oa"\n`);
  return readFileSync('template/supabase/schema.sql', 'utf8').replaceAll('__px__', px);
}

/** SQL that seeds the config once and arms the one-time owner binding code. */
/** Accept full-width digits and stray spaces or dashes typed on a phone. */
export function normalizeBindCode(raw = '') {
  return String(raw)
    .replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10))
    .replace(/[\s-]/g, '');
}

export function seedSql(px, config, rawBindCode) {
  const bindCode = normalizeBindCode(rawBindCode);
  const json = JSON.stringify(config);
  if (json.includes('$oaw$')) throw Error('config contains a reserved sequence');
  let sql = `insert into public.${px}_config (id, data) values (1, $oaw$${json}$oaw$::jsonb) on conflict (id) do nothing;\n`;
  if (bindCode) {
    if (!/^\d{6}$/.test(bindCode)) throw Error('OAW_BIND_CODE 必須是 6 位數字');
    const hash = createHash('sha256').update(bindCode).digest('hex');
    sql +=
      `insert into public.${px}_owner (id, bind_hash, bind_expires) values (1, '${hash}', now() + interval '24 hours') ` +
      `on conflict (id) do update set bind_hash = excluded.bind_hash, bind_expires = excluded.bind_expires ` +
      `where public.${px}_owner.line_user_id is null;\n`;
  }
  return sql;
}

async function api(base, path, { token, method = 'GET', body, form } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: form ? new URLSearchParams(form) : body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) {
    // Error bodies from these APIs carry a reason (never our secrets); keep a short, single-line part.
    let reason = '';
    try {
      const j = JSON.parse(text);
      reason = j.message ?? j.error_description ?? j.error ?? '';
    } catch {
      reason = text;
    }
    reason = String(reason).replace(/\s+/g, ' ').slice(0, 200);
    throw Error(
      `${new URL(base).host}${path.split('?')[0]} → HTTP ${res.status}${reason ? `：${reason}` : ''}`,
    );
  }
  return text ? JSON.parse(text) : {};
}

async function lineToken(id, secret) {
  const res = await fetch(`${LINE}/oauth2/v3/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: id,
      client_secret: secret,
    }),
  });
  if (!res.ok) throw Error(`LINE Channel ${id} 的 ID 或 Secret 不正確（HTTP ${res.status}）`);
  return (await res.json()).access_token;
}

async function supabaseProject(token, px, previous) {
  const known = E('OAW_SB_REF') || previous;
  if (known) return known;
  const orgs = await api(SB, '/v1/organizations', { token }).catch((e) => {
    if (/HTTP 40[13]/.test(e.message))
      throw Error(
        'Supabase Token 沒有建立專案的權限：請改用帳號層級的 Access Token，或在 Variables 設定 OAW_SB_REF 使用既有專案',
      );
    throw e;
  });
  const org = E('OAW_SB_ORG') || orgs[0]?.id;
  if (!org) throw Error('找不到 Supabase 組織');
  const created = await api(SB, '/v1/projects', {
    token,
    method: 'POST',
    body: {
      name: `${px}-oa`,
      organization_id: org,
      region: E('OAW_SB_REGION') || 'ap-northeast-1',
      db_pass: E('OAW_SB_DB_PASS') || randomBytes(24).toString('base64url'),
    },
  }).catch((e) => {
    if (/free projects|maximum limits/i.test(e.message))
      throw Error(
        'Supabase 免費方案最多 2 個專案，已經滿了：請在 Variables 設定 OAW_SB_REF 使用既有專案，或到 Supabase 暫停一個不用的專案',
      );
    throw e;
  });
  return created.id ?? created.ref;
}

async function waitHealthy(token, ref) {
  for (let i = 0; i < 60; i++) {
    const p = await api(SB, `/v1/projects/${ref}`, { token });
    if (p.status === 'ACTIVE_HEALTHY') return;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw Error('Supabase 專案 10 分鐘內沒有就緒，請稍後重跑');
}

async function main() {
  const { px, UP, pagesOrigin, pagesUrl } = inputs();
  const config = validateConfig(JSON.parse(readFileSync('oaw/config.json', 'utf8')));
  let previous = {};
  try {
    previous = JSON.parse(readFileSync('oaw/status.json', 'utf8'));
  } catch {}
  Object.assign(status, { px, pages_url: pagesUrl, project_ref: previous.project_ref ?? null });
  const schema = render(px);
  step('render');
  if (DRY) return console.log(seedSql(px, config, E('OAW_BIND_CODE')) + schema);

  const sbToken = E('SUPABASE_ACCESS_TOKEN');
  const msg = { id: E('OAW_LINE_MSG_ID'), secret: E('OAW_LINE_MSG_SECRET') };
  const login = { id: E('OAW_LINE_LOGIN_ID'), secret: E('OAW_LINE_LOGIN_SECRET') };
  for (const [k, v] of Object.entries({
    SUPABASE_ACCESS_TOKEN: sbToken,
    OAW_LINE_MSG_ID: msg.id,
    OAW_LINE_MSG_SECRET: msg.secret,
    OAW_LINE_LOGIN_ID: login.id,
    OAW_LINE_LOGIN_SECRET: login.secret,
  }))
    if (!v) throw Error(`缺少 GitHub Secret：${k}`);

  // LINE first: wrong channel credentials should stop before anything is created.
  const botToken = await lineToken(msg.id, msg.secret);
  const bot = await api(LINE, '/v2/bot/info', { token: botToken });
  status.basic_id = bot.basicId;
  step('line_messaging', bot.basicId);
  const loginToken = await lineToken(login.id, login.secret);
  step('line_login');

  const ref = await supabaseProject(sbToken, px, previous.project_ref);
  status.project_ref = ref;
  step('supabase_project', ref);
  await waitHealthy(sbToken, ref);
  await api(SB, `/v1/projects/${ref}/database/query`, {
    token: sbToken,
    method: 'POST',
    body: { query: schema },
  });
  await api(SB, `/v1/projects/${ref}/database/query`, {
    token: sbToken,
    method: 'POST',
    body: { query: seedSql(px, config, E('OAW_BIND_CODE')) },
  });
  step('database');

  const liffDesc = `${px}-main`;
  // LINE answers 404 (not an empty list) when the channel has no LIFF app yet.
  const { apps = [] } = await api(LINE, '/liff/v1/apps', { token: loginToken }).catch((e) => {
    if (/HTTP 404/.test(e.message)) return {};
    throw e;
  });
  const view = { type: 'full', url: pagesUrl };
  const existing = apps.find((a) => a.description === liffDesc);
  let liffId = existing?.liffId;
  if (liffId)
    await api(LINE, `/liff/v1/apps/${liffId}`, {
      token: loginToken,
      method: 'PUT',
      body: { view },
    });
  else
    liffId = (
      await api(LINE, '/liff/v1/apps', {
        token: loginToken,
        method: 'POST',
        body: { view, description: liffDesc, scope: ['openid', 'profile'], botPrompt: 'normal' },
      })
    ).liffId;
  const liffUrl = `https://liff.line.me/${liffId}`;
  status.liff_url = liffUrl;
  step('liff', liffId);

  const fnBase = `https://${ref}.supabase.co/functions/v1`;
  const secrets = {
    LINE_MSG_ID: msg.id,
    LINE_MSG_SECRET: msg.secret,
    LINE_LOGIN_ID: login.id,
    LIFF_URL: liffUrl,
    PAGES_ORIGIN: pagesOrigin,
    APRICO_KEY: E('OAW_APRICO_KEY'),
    APRICO_RUNTIME_URL: E('OAW_APRICO_RUNTIME_URL'),
    APRICO_DESIGN_URL: E('OAW_APRICO_DESIGN_URL'),
  };
  await api(SB, `/v1/projects/${ref}/secrets`, {
    token: sbToken,
    method: 'POST',
    body: Object.entries(secrets)
      .filter(([, v]) => v)
      .map(([k, v]) => ({ name: `${UP}_${k}`, value: v })),
  });
  step('supabase_secrets');

  for (const fn of [`${px}-webhook`, `${px}-api`])
    execFileSync(
      'supabase',
      [
        'functions',
        'deploy',
        fn,
        '--project-ref',
        ref,
        '--no-verify-jwt',
        '--use-api',
        '--yes',
        '--workdir',
        'build',
      ],
      {
        stdio: 'inherit',
        env: { ...process.env, SUPABASE_ACCESS_TOKEN: sbToken },
      },
    );
  step('functions');

  const endpoint = `${fnBase}/${px}-webhook`;
  await api(LINE, '/v2/bot/channel/webhook/endpoint', {
    token: botToken,
    method: 'PUT',
    body: { endpoint },
  });
  const test = await api(LINE, '/v2/bot/channel/webhook/test', {
    token: botToken,
    method: 'POST',
    body: { endpoint },
  });
  step('webhook', {
    success: test.success === true,
    status: test.statusCode ?? null,
    reason: test.reason ?? null,
  });

  writeFileSync(
    'liff/config.js',
    `window.OAW = ${JSON.stringify({ px, liffId, api: `${fnBase}/${px}-api` })};\n`,
  );
  step('liff_config');
  status.ok = true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((e) => {
      status.error = e instanceof Error ? e.message : String(e);
      console.error('[oaw] failed:', status.error);
      process.exitCode = 1;
    })
    .finally(() => {
      status.finished_at = new Date().toISOString();
      save();
    });
}
