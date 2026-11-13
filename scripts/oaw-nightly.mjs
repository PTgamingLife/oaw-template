// Calls this app's {px}-digest function. Reads the function address from oaw/status.json
// and signs the request with the LINE channel secret (see _shared/digest.ts).
import { readFileSync } from 'node:fs';
import { digestKey } from '../template/supabase/functions/_shared/digest.ts';

const status = JSON.parse(readFileSync('oaw/status.json', 'utf8'));
if (!status.ok || !status.project_ref || !status.px) {
  console.log('[oaw] app not set up yet; nothing to do');
  process.exit(0);
}
const secret = (process.env.OAW_LINE_MSG_SECRET ?? '').trim();
if (!secret) throw Error('缺少 GitHub Secret：OAW_LINE_MSG_SECRET');
const today = new Date().toISOString().slice(0, 10);
const res = await fetch(
  `https://${status.project_ref}.supabase.co/functions/v1/${status.px}-digest`,
  { method: 'POST', headers: { 'x-oaw-digest': await digestKey(secret, today) } },
);
console.log(`[oaw] digest → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
if (!res.ok && res.status !== 402) process.exitCode = 1;
