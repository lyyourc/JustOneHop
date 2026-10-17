export function formatVisitTime(timestamp: number | undefined, locale: string, now: number = Date.now()): { text: string; full: string; dateTime: string } | undefined {
  if (timestamp === undefined || !Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now) return undefined;
  const visit = new Date(timestamp);
  const current = new Date(now);
  if (!Number.isFinite(visit.getTime()) || !Number.isFinite(current.getTime())) return undefined;

  const chinese = /^zh(?:-|$)/i.test(locale);
  const elapsed = now - timestamp;
  let text: string;
  if (elapsed < 60_000) {
    text = chinese ? '刚刚' : 'just now';
  } else if (elapsed < 3_600_000) {
    text = new Intl.RelativeTimeFormat(locale).format(-Math.floor(elapsed / 60_000), 'minute');
  } else {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const today = visit.toDateString() === current.toDateString();
    if (today || visit.toDateString() === yesterday.toDateString()) {
      const label = today ? (chinese ? '今天' : 'Today') : (chinese ? '昨天' : 'Yesterday');
      const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(visit);
      text = `${label} ${time}`;
    } else {
      text = new Intl.DateTimeFormat(locale, {
        month: 'short', day: 'numeric',
        ...(visit.getFullYear() !== current.getFullYear() ? { year: 'numeric' as const } : {}),
      }).format(visit);
    }
  }

  return {
    text,
    full: new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'medium' }).format(visit),
    dateTime: visit.toISOString(),
  };
}
