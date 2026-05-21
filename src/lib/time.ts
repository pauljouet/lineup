/** Time helpers. We store ISO strings; compute on epoch ms. */

export const MINUTE = 60_000;

export const toMs = (iso: string): number => new Date(iso).getTime();
export const toIso = (ms: number): string => new Date(ms).toISOString();

export const durationMin = (from: string, to: string): number =>
  (toMs(to) - toMs(from)) / MINUTE;

/** Snap an epoch-ms timestamp to the nearest `step` minutes. */
export const snapMs = (ms: number, stepMin = 5): number => {
  const step = stepMin * MINUTE;
  return Math.round(ms / step) * step;
};

/** Parse "YYYY-MM-DD HH:mm" (CSV format) into an ISO string. Returns null if invalid. */
export const parseCsvDate = (raw: string): string | null => {
  const s = raw.trim();
  // Accept both "YYYY-MM-DD HH:mm" and ISO-ish "YYYY-MM-DDTHH:mm".
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const dt = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
  );
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
};

/** Parse a clock time "H:mm" / "HH:mm" into minutes-of-day. null if invalid. */
export const parseClockMinutes = (raw: string): number | null => {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
};

/** Parse a date-only "YYYY-MM-DD" into calendar components. null if invalid. */
export const parseDateOnly = (
  raw: string,
): { y: number; mo: number; d: number } | null => {
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
};

/**
 * Combine a festival day with a clock time into an ISO datetime, rolling
 * past midnight: any clock time earlier than `rolloverMin` (minutes-of-day)
 * is treated as belonging to the next calendar day. Festival sets typically
 * run ~13:00 → ~05:00, so a rollover around 06:00 maps early-morning sets
 * onto the following date while keeping afternoon/evening sets on the day.
 */
export const dayClockToIso = (
  date: { y: number; mo: number; d: number },
  clockMin: number,
  rolloverMin: number,
): string => {
  const offsetDays = clockMin < rolloverMin ? 1 : 0;
  // Date normalizes the large minute count and any day/month overflow.
  return new Date(date.y, date.mo - 1, date.d + offsetDays, 0, clockMin).toISOString();
};

/** Format an ISO string as local "HH:mm". */
export const fmtTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};

/** Format an ISO string as local "ddd HH:mm" for multi-day clarity. */
export const fmtDayTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleString([], {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

/** Convert an ISO datetime to the value a <input type="datetime-local"> expects. */
export const toLocalInput = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
};

/** Convert a datetime-local input value to an ISO string. */
export const fromLocalInput = (val: string): string => {
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
};
