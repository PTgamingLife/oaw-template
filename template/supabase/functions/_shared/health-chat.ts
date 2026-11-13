// Chat side of the health template (only when the app was set up with OAW_TEMPLATE=health):
//   elder:     「血壓 135/85」 → confirm card → saved; 「完成了」 buttons on reminders;
//              approves family members from a card.
//   family:    「家人 123456」 with the elder's invite code → elder gets an approval card.
import { DISCLAIMER, describe, parseMeasureText, taipei } from './health.ts';
import { healthRole, saveMeasure } from './health-api.ts';
import type { lineClient } from './line.ts';
import { noticeCard } from './onboarding.ts';
import { db, env, setPending, takePending, T } from './store.ts';

export const healthEnabled = () => env('TEMPLATE') === 'health';
type Line = ReturnType<typeof lineClient>;

async function sha256(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function joinRequest(userId: string, code: string, owner: string, line: Line) {
  const { data: p } = await db
    .from(T('h_profile'))
    .select('invite_hash,invite_expires')
    .eq('id', 1)
    .maybeSingle();
  const valid =
    p?.invite_hash &&
    new Date(p.invite_expires).getTime() > Date.now() &&
    (await sha256(`family:${code}`)) === p.invite_hash;
  if (!valid) return noticeCard('邀請碼無效', '邀請碼可能已過期，請長輩重新產生一組。');
  const name =
    (await line.profile(userId).catch(() => ({ displayName: '' }))).displayName || '家人';
  await db
    .from(T('h_caregivers'))
    .upsert({ line_user_id: userId, display_name: name.slice(0, 20), status: 'pending' });
  // One code, one person: the elder generates a new code for the next family member.
  await db.from(T('h_profile')).update({ invite_hash: null, invite_expires: null }).eq('id', 1);
  await line.push(owner, [
    noticeCard('家人想加入', `「${name}」想成為你的家人，加入後會收到你同意分享的提醒與週報。`, {
      label: '同意加入',
      data: `h-approve:${userId}`,
      text: '同意加入',
    }),
  ]);
  return noticeCard('已送出', '等長輩按「同意加入」後就完成了。');
}

/** Returns the reply card when the event was a health action, or null to fall through. */
export async function healthChat(event: any, userId: string, owner: string, line: Line) {
  if (!healthEnabled()) return null;
  const isOwner = Boolean(owner) && owner === userId;

  if (event.type === 'postback') {
    const data = String(event.postback?.data ?? '');
    if (!data.startsWith('h-')) return null;
    if (!isOwner) return noticeCard('無法操作', '只有長輩本人可以按這個按鈕。');
    const slot = data.match(/^h-done:(\d)$/)?.[1];
    if (slot !== undefined) {
      await db.from(T('h_done')).upsert({ day: taipei().day, slot: Number(slot) });
      return noticeCard('👍 已完成', '做得很好，繼續保持！');
    }
    if (data === 'h-ok') {
      const pending: any = await takePending(userId);
      if (!pending?.measure) return noticeCard('已經過期', '請再輸入一次數值。');
      const r = await saveMeasure(pending.measure);
      return r.flagged
        ? noticeCard('⚠️ 已記錄', `${r.flagged}\n已通知你同意分享的家人。\n\n${DISCLAIMER}`)
        : noticeCard('✅ 已記錄', r.saved);
    }
    const family = data.match(/^h-approve:(U[0-9a-f]{32})$/)?.[1];
    if (family) {
      await db.from(T('h_caregivers')).update({ status: 'active' }).eq('line_user_id', family);
      await line
        .push(family, [noticeCard('✅ 已加入', '之後會收到長輩同意分享的提醒與週報。')])
        .catch(() => {});
      return noticeCard('已同意', '可以在「家人與設定」調整他會收到哪些通知。');
    }
    return null;
  }

  if (event.type !== 'message' || event.message?.type !== 'text') return null;
  const text = String(event.message.text).trim();
  const join = text.match(/^家人\s*(\d{6})$/)?.[1];
  if (join && !isOwner && owner) {
    if ((await healthRole(userId)) === 'caregiver')
      return noticeCard('已經是家人', '你已經加入了。');
    return joinRequest(userId, join, owner, line);
  }
  if (!isOwner) return null;
  const m = parseMeasureText(text);
  if (!m) return null;
  const { data: p } = await db.from(T('h_profile')).select('consent_at').eq('id', 1).maybeSingle();
  if (!p?.consent_at)
    return noticeCard('請先開啟健康秘書', '打開選單的「今天」，同意後就能開始記錄。');
  await setPending(userId, { measure: m });
  return noticeCard('要記錄這筆嗎？', `${describe(m)}\n\n不對的話直接重打一次就好。`, {
    label: '確認記錄',
    data: 'h-ok',
    text: '確認記錄',
  });
}
