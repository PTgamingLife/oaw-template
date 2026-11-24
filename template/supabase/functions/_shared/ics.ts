// Calendar subscription (iCalendar) for the owner's recorded events, so Google Calendar or
// the iPhone calendar can show them. One-way: this app → the calendar. Pure, testable.
type Event = { id: number; day: string; time: string; title: string };

const esc = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1').slice(0, 200);
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
const compact = (day: string) => day.replace(/-/g, '');
const nextDay = (day: string) =>
  new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);

/** Events are stored in Asia/Taipei; timed ones last an hour, the rest are all-day. */
export function buildIcs(events: Event[], name: string, px: string, now = new Date()) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Aprico//OAW Secretary//ZH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name || 'AI 秘書')}`,
    'X-WR-TIMEZONE:Asia/Taipei',
  ];
  for (const e of events) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.day) || !e.title) continue;
    lines.push('BEGIN:VEVENT', `UID:${px}-${e.id}@oaw.aprico`, `DTSTAMP:${stamp(now)}`);
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time)) {
      const start = new Date(`${e.day}T${e.time}:00+08:00`);
      lines.push(`DTSTART:${stamp(start)}`, `DTEND:${stamp(new Date(start.getTime() + 3600000))}`);
    } else lines.push(`DTSTART;VALUE=DATE:${compact(e.day)}`, `DTEND;VALUE=DATE:${compact(nextDay(e.day))}`);
    lines.push(`SUMMARY:${esc(e.title)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/** Links the owner taps: the feed itself, and "add by URL" for Google and Apple calendars. */
export function icsLinks(feed: string) {
  const webcal = feed.replace(/^https:/, 'webcal:');
  return {
    feed,
    apple: webcal,
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
  };
}

/** Constant-time comparison of two short tokens. */
export function sameToken(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
