import Papa from 'papaparse';
import type { Artist } from '../state/types';
import { parseCsvDate, parseClockMinutes, parseDateOnly, dayClockToIso } from './time';
import { uuid } from './id';

export type ParseOptions = {
  /** Which festival day (the `day` column value, e.g. "2026-05-23") to import.
   *  Defaults to the first day found. Only meaningful for day+clock CSVs. */
  day?: string;
  /** Clock hour at which a new festival day begins; clock times earlier than
   *  this roll onto the next calendar day. Default 6 (06:00). */
  rolloverHour?: number;
};

export type CsvResult = {
  artists: Artist[];
  errors: string[]; // human-readable per-row problems
  days: string[]; // distinct festival days found (day+clock CSVs only)
  selectedDay?: string; // the day actually imported, if day-mode
};

const pick = (row: Record<string, string>, ...keys: string[]): string => {
  for (const k of keys) {
    const found = Object.keys(row).find((rk) => rk.trim().toLowerCase() === k);
    if (found && row[found] != null) return String(row[found]).trim();
  }
  return '';
};

/**
 * Parse a festival timetable CSV. Two layouts are supported:
 *
 *  1. Day + clock times (e.g. columns `day, stage, artist, start_time, end_time`
 *     where times are "HH:mm"). A festival "day" spans past midnight, so this is
 *     imported one day at a time and early-morning times roll to the next date.
 *
 *  2. Full datetimes (columns `stage, start, end, artist`, dates "YYYY-MM-DD HH:mm").
 */
export function parseTimetableCsv(text: string, opts: ParseOptions = {}): CsvResult {
  const out = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  const headers = (out.meta.fields ?? []).map((h) => h.trim().toLowerCase());
  const dayMode = headers.includes('day');

  return dayMode
    ? parseDayMode(out.data, opts)
    : parseDatetimeMode(out.data);
}

function parseDayMode(
  rows: Record<string, string>[],
  opts: ParseOptions,
): CsvResult {
  const rolloverMin = (opts.rolloverHour ?? 6) * 60;

  // Distinct festival days, in document order then sorted.
  const days = Array.from(
    new Set(rows.map((r) => pick(r, 'day')).filter(Boolean)),
  ).sort();
  const selectedDay = opts.day && days.includes(opts.day) ? opts.day : days[0];

  const artists: Artist[] = [];
  const errors: string[] = [];

  rows.forEach((row, i) => {
    const line = i + 2;
    const day = pick(row, 'day');
    const name = pick(row, 'artist', 'name');
    const stage = pick(row, 'stage');
    const startRaw = pick(row, 'start_time', 'start');
    const endRaw = pick(row, 'end_time', 'end');

    if (!day && !name && !stage && !startRaw && !endRaw) return; // blank row
    if (day !== selectedDay) return; // import one day at a time

    const missing: string[] = [];
    if (!name) missing.push('artist');
    if (!stage) missing.push('stage');
    if (!startRaw) missing.push('start_time');
    if (!endRaw) missing.push('end_time');
    if (missing.length) {
      errors.push(`Row ${line}: missing ${missing.join(', ')}`);
      return;
    }

    const date = parseDateOnly(day);
    if (!date) {
      errors.push(`Row ${line} (${name}): bad day "${day}" — expected YYYY-MM-DD`);
      return;
    }
    const startMin = parseClockMinutes(startRaw);
    const endMin = parseClockMinutes(endRaw);
    if (startMin == null) {
      errors.push(`Row ${line} (${name}): bad start_time "${startRaw}" — expected HH:mm`);
      return;
    }
    if (endMin == null) {
      errors.push(`Row ${line} (${name}): bad end_time "${endRaw}" — expected HH:mm`);
      return;
    }

    const start = dayClockToIso(date, startMin, rolloverMin);
    const end = dayClockToIso(date, endMin, rolloverMin);
    if (new Date(end).getTime() <= new Date(start).getTime()) {
      errors.push(`Row ${line} (${name}): end is not after start`);
      return;
    }

    artists.push({ id: uuid(), name, stage, start, end });
  });

  return { artists, errors, days, selectedDay };
}

function parseDatetimeMode(rows: Record<string, string>[]): CsvResult {
  const artists: Artist[] = [];
  const errors: string[] = [];

  rows.forEach((row, i) => {
    const line = i + 2;
    const name = pick(row, 'artist', 'name');
    const stage = pick(row, 'stage');
    const startRaw = pick(row, 'start');
    const endRaw = pick(row, 'end');

    if (!name && !stage && !startRaw && !endRaw) return;

    const missing: string[] = [];
    if (!name) missing.push('artist');
    if (!stage) missing.push('stage');
    if (!startRaw) missing.push('start');
    if (!endRaw) missing.push('end');
    if (missing.length) {
      errors.push(`Row ${line}: missing ${missing.join(', ')}`);
      return;
    }

    const start = parseCsvDate(startRaw);
    const end = parseCsvDate(endRaw);
    if (!start) {
      errors.push(`Row ${line} (${name}): bad start "${startRaw}" — expected YYYY-MM-DD HH:mm`);
      return;
    }
    if (!end) {
      errors.push(`Row ${line} (${name}): bad end "${endRaw}" — expected YYYY-MM-DD HH:mm`);
      return;
    }
    if (new Date(end).getTime() <= new Date(start).getTime()) {
      errors.push(`Row ${line} (${name}): end is not after start`);
      return;
    }

    artists.push({ id: uuid(), name, stage, start, end });
  });

  return { artists, errors, days: [] };
}
