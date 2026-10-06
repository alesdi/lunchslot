import { TZDate } from "@date-fns/tz";
import { WEEKDAYS, type ParsedAvailability, type Weekday } from "./schema";

/** Half-open interval of epoch milliseconds. */
export type Interval = { s: number; e: number };

const DAY_MS = 86_400_000;
const DEFAULT_WORKING_HOURS = { weekdays: ["mon", "tue", "wed", "thu", "fri"] as Weekday[], start: "09:00", end: "18:00" };

type LocalRule = { date: string | null; weekdays: Weekday[] | null; start: string | null; end: string | null };

function parseTime(t: string | null, fallback: number): number {
  if (!t) return fallback;
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(t.trim());
  if (!m) return fallback;
  return Math.min(24 * 60, Number(m[1]) * 60 + Number(m[2] ?? 0));
}

function minutesToTime(min: number): string {
  const m = Math.min(min, 24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Calendar dates ("YYYY-MM-DD") covering [from, to] as seen in `tz`, padded by one day each side. */
export function localDates(from: number, to: number, tz: string): string[] {
  const start = new TZDate(from - DAY_MS, tz);
  const days = Math.ceil((to - from) / DAY_MS) + 3;
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate() + i));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function weekdayOf(date: string): Weekday {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

/** Absolute instant for a local wall-clock time (minutes since midnight, may be >= 1440) on `date` in `tz`. */
export function localToEpoch(date: string, minutes: number, tz: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new TZDate(y, m - 1, d, Math.floor(minutes / 60), minutes % 60, tz).getTime();
}

function ruleIntervals(rules: LocalRule[], dates: string[], tz: string): Interval[] {
  const out: Interval[] = [];
  for (const date of dates) {
    const wd = weekdayOf(date);
    for (const r of rules) {
      const matches = r.date ? r.date === date : !r.weekdays || r.weekdays.length === 0 || r.weekdays.includes(wd);
      if (!matches) continue;
      const s = parseTime(r.start, 0);
      let e = parseTime(r.end, 24 * 60);
      if (e === s) continue;
      if (e < s) e += 24 * 60; // crosses midnight
      out.push({ s: localToEpoch(date, s, tz), e: localToEpoch(date, e, tz) });
    }
  }
  return out;
}

export function merge(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.e > i.s).sort((a, b) => a.s - b.s);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.s <= last.e) last.e = Math.max(last.e, i.e);
    else out.push({ ...i });
  }
  return out;
}

export function subtract(base: Interval[], cut: Interval[]): Interval[] {
  const cuts = merge(cut);
  const out: Interval[] = [];
  for (const b of merge(base)) {
    let cur = b.s;
    for (const c of cuts) {
      if (c.e <= cur || c.s >= b.e) continue;
      if (c.s > cur) out.push({ s: cur, e: c.s });
      cur = Math.max(cur, c.e);
    }
    if (cur < b.e) out.push({ s: cur, e: b.e });
  }
  return out;
}

export function clip(intervals: Interval[], from: number, to: number): Interval[] {
  return intervals.map((i) => ({ s: Math.max(i.s, from), e: Math.min(i.e, to) })).filter((i) => i.e > i.s);
}

function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Timezone the ranges were expressed in: an explicitly stated one, else the participant's. */
export function rangesTz(p: ParsedAvailability, tz: string): string {
  return p.statedTimezone && isValidTz(p.statedTimezone) ? p.statedTimezone : tz;
}

/** Free intervals (absolute) for a participant within [from, to]. */
export function expandAvailability(p: ParsedAvailability, tz: string, from: number, to: number): Interval[] {
  const zone = rangesTz(p, tz);
  const dates = localDates(from, to, zone);
  // Booking-page runs list start times; each slot lasts bookingSlotMinutes past its start.
  const slotMin = p.bookingSlotMinutes ?? 30;
  const booked = (p.bookingStarts ?? []).map((r) => ({
    ...r,
    end: minutesToTime(Math.max(parseTime(r.end, 0), parseTime(r.start, 0)) + slotMin),
  }));
  const free = [...p.free, ...booked];
  // Only busy times given: assume regular working hours around them.
  const base = ruleIntervals(free.length ? free : [{ date: null, ...DEFAULT_WORKING_HOURS }], dates, zone);
  return clip(subtract(base, ruleIntervals(p.busy, dates, zone)), from, to);
}

/** Absolute intervals for each preference within [from, to], aligned with `p.preferences`.
 *  Preferences ("avoid lunch") are about the person's own day, so they use the participant's timezone. */
export function expandPreferences(p: ParsedAvailability, tz: string, from: number, to: number): Interval[][] {
  const dates = localDates(from, to, tz);
  return p.preferences.map((pref) => clip(merge(ruleIntervals([pref], dates, tz)), from, to));
}
