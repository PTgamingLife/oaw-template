// Owner protection: the PIN (asked again after 30 minutes, 5 wrong tries then a 15-minute
// wait) and the emergency lock set in Aprico. Friends and caregivers are never affected.
import { afterStatus, STATUS_BODY } from './pair.ts';
import { checkPin, hashPin, LOCKOUT_MS, MAX_TRIES, PIN_TTL_MS, validPin } from './pin.ts';
import { apricoKey, db, env, T } from './store.ts';

/** true = locked, false = not locked, null = Aprico could not be asked. */
export async function ownerLocked(): Promise<boolean | null> {
  const base = env('APRICO_URL'),
    key = await apricoKey();
  if (!base || !key) return false; // not connected to Aprico: nothing can have been locked
  try {
    const res = await fetch(`${base}/status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: STATUS_BODY,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const status = await res.json();
    await afterStatus(status);
    return status?.locked === true;
  } catch {
    return null;
  }
}

/**
 * 秘書版 (not the health template, not 領航者版): the account is its owner's private secretary.
 * Strangers who add it get no AI replies, no menu and no member record. When Aprico cannot be
 * asked, it counts as private: that never spends the owner's quota on someone else.
 */
export async function privateSecretary(): Promise<boolean> {
  if (env('TEMPLATE') === 'health') return false;
  const base = env('APRICO_URL'),
    key = await apricoKey();
  if (!base || !key) return true;
  try {
    const res = await fetch(`${base}/status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: STATUS_BODY,
      signal: AbortSignal.timeout(5000),
    });
    const status = res.ok ? await res.json() : null;
    await afterStatus(status);
    return status?.plan !== 'navigator';
  } catch {
    return true;
  }
}

async function pinRow(): Promise<any> {
  const { data } = await db
    .from(T('owner'))
    .select('line_user_id,pin_hash,pin_fails,pin_wait_until,pin_ok_until')
    .eq('id', 1)
    .maybeSingle();
  return data ?? {};
}

const future = (t: unknown) => typeof t === 'string' && Date.parse(t) > Date.now();

export async function pinStatus(userId: string) {
  const r = await pinRow();
  return {
    set: Boolean(r.pin_hash),
    fresh: r.line_user_id === userId && future(r.pin_ok_until),
    waitUntil: future(r.pin_wait_until) ? r.pin_wait_until : null,
  };
}

/** Check a PIN; a correct one opens a 30-minute window. Throws pin_wait / pin_wrong. */
export async function verifyPin(userId: string, pin: unknown) {
  const r = await pinRow();
  if (r.line_user_id !== userId || !r.pin_hash) throw Error('pin_not_set');
  if (future(r.pin_wait_until)) throw Error('pin_wait');
  if (typeof pin === 'string' && /^\d{6}$/.test(pin) && (await checkPin(pin, r.pin_hash))) {
    await db
      .from(T('owner'))
      .update({
        pin_fails: 0,
        pin_wait_until: null,
        pin_ok_until: new Date(Date.now() + PIN_TTL_MS).toISOString(),
      })
      .eq('id', 1);
    return true;
  }
  const fails = (Number(r.pin_fails) || 0) + 1;
  await db
    .from(T('owner'))
    .update(
      fails >= MAX_TRIES
        ? { pin_fails: 0, pin_wait_until: new Date(Date.now() + LOCKOUT_MS).toISOString() }
        : { pin_fails: fails },
    )
    .eq('id', 1);
  throw Error(fails >= MAX_TRIES ? 'pin_wait' : 'pin_wrong');
}

/** Set or change the PIN. Changing needs the old PIN, or a PIN check in the last 30 minutes. */
export async function setPin(userId: string, pin: unknown, oldPin?: unknown) {
  if (!validPin(pin)) throw Error('pin_invalid');
  const s = await pinStatus(userId);
  if (s.set && !s.fresh) await verifyPin(userId, oldPin);
  const { data } = await db
    .from(T('owner'))
    .update({
      pin_hash: await hashPin(pin),
      pin_fails: 0,
      pin_wait_until: null,
      pin_ok_until: new Date(Date.now() + PIN_TTL_MS).toISOString(),
    })
    .eq('id', 1)
    .eq('line_user_id', userId)
    .select('id');
  if (!data?.length) throw Error('owner_only');
}

/**
 * Guard for owner actions. Always refuses while locked. Sensitive actions also need a
 * recent PIN (when one is set) and fail closed if the lock state cannot be checked.
 */
export async function guardOwner(userId: string, sensitive: boolean) {
  const locked = await ownerLocked();
  if (locked === true) throw Error('owner_locked');
  if (!sensitive) return;
  if (locked === null) throw Error('lock_unknown');
  const s = await pinStatus(userId);
  if (s.set && !s.fresh) throw Error('pin_required');
}
