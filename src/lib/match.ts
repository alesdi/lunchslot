import { TZDate } from "@date-fns/tz";
import { expandAvailability, expandPreferences, type Interval } from "./availability/expand";
import type { ParsedAvailability } from "./availability/schema";

export type MatchParticipant = { id: string; name: string; tz: string; parsed: ParsedAvailability };

export type Reason = { tone: "good" | "warn"; text: string };

export type Slot = {
  start: string; // ISO
  end: string;
  available: string[]; // participant names
  missing: string[];
  everyone: boolean;
  score: number;
  reasons: Reason[];
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const GRID = 15 * MIN;
const MIN_LEAD = 2 * HOUR;

type Prepared = MatchParticipant & { free: Interval[]; prefs: Interval[][] };

function covers(intervals: Interval[], s: number, e: number): boolean {
  // intervals are merged and sorted; small n so linear scan is fine
  for (const i of intervals) {
    if (i.s > s) return false;
    if (i.e >= e) return true;
  }
  return false;
}

function overlap(intervals: Interval[], s: number, e: number): number {
  let total = 0;
  for (const i of intervals) total += Math.max(0, Math.min(i.e, e) - Math.max(i.s, s));
  return total;
}

function localHourMinutes(t: number, tz: string): number {
  const d = new TZDate(t, tz);
  return d.getHours() * 60 + d.getMinutes();
}

function localDayKey(t: number, tz: string): string {
  const d = new TZDate(t, tz);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function scoreSlot(s: number, e: number, people: Prepared[], now: number) {
  let score = 0;
  const reasons: Reason[] = [];
  const dur = e - s;

  for (const p of people) {
    p.parsed.preferences.forEach((pref, idx) => {
      const windows = p.prefs[idx];
      const ov = overlap(windows, s, e);
      const who = p.name;
      if (pref.kind === "avoid") {
        if (ov > 0) {
          score -= pref.weight * 10 * Math.max(0.5, ov / dur);
          reasons.push({ tone: "warn", text: `${who} prefers to avoid ${pref.label}` });
        } else if (windows.some((w) => Math.abs(w.s - s) < 12 * HOUR)) {
          reasons.push({ tone: "good", text: `Avoids ${who}'s ${pref.label}` });
        }
      } else if (ov > 0) {
        score += pref.weight * 6 * (ov / dur);
        reasons.push({ tone: "good", text: `${who} prefers ${pref.label}` });
      }
    });

    // Keep everyone inside humane local hours, even if they said "anytime".
    const startM = localHourMinutes(s, p.tz);
    const endM = startM + dur / MIN;
    if (startM < 8 * 60 || endM > 20 * 60) score -= 4;
  }

  // Sooner is better, gently.
  score -= ((s - now) / DAY) * 0.3;
  // Round start times read nicer.
  const minute = localHourMinutes(s, people[0].tz) % 60;
  if (minute === 0) score += 1;
  else if (minute === 30) score += 0.5;

  // Warnings first, then dedupe and cap.
  const seen = new Set<string>();
  const sorted = [...reasons.filter((r) => r.tone === "warn"), ...reasons.filter((r) => r.tone === "good")].filter((r) =>
    seen.has(r.text) ? false : (seen.add(r.text), true),
  );
  return { score, reasons: sorted.slice(0, 3) };
}

export type MatchResult = {
  slots: Slot[];
  /** Ids of participants with no time left in the window (e.g. they only gave dates that have passed).
   *  They're left out of the slots entirely, so they don't show up as "missing" from every one. */
  idle: string[];
};

export function findSlots(
  participants: MatchParticipant[],
  opts: { durationMin: number; now: number; horizonDays: number; limit?: number },
): MatchResult {
  const limit = opts.limit ?? 3;
  const dur = opts.durationMin * MIN;
  const from = Math.ceil((opts.now + MIN_LEAD) / GRID) * GRID;
  const to = opts.now + opts.horizonDays * DAY;

  const prepared: Prepared[] = participants.map((p) => ({
    ...p,
    free: expandAvailability(p.parsed, p.tz, from, to),
    prefs: expandPreferences(p.parsed, p.tz, from, to),
  }));
  const people = prepared.filter((p) => p.free.some((i) => i.e - i.s >= dur));
  const idle = prepared.filter((p) => !people.includes(p)).map((p) => p.id);
  return { slots: pickSlots(people, dur, from, to, limit, opts.now), idle };
}

function pickSlots(people: Prepared[], dur: number, from: number, to: number, limit: number, now: number): Slot[] {
  if (people.length === 0) return [];

  // Enumerate grid starts and who can make each one.
  type Cand = { s: number; e: number; who: Prepared[] };
  const cands: Cand[] = [];
  let best = 0;
  for (let s = from; s + dur <= to; s += GRID) {
    const e = s + dur;
    const who = people.filter((p) => covers(p.free, s, e));
    if (who.length === 0 || who.length < best) continue;
    if (who.length > best) {
      best = who.length;
      cands.length = 0;
    }
    cands.push({ s, e, who });
  }
  if (best === 0) return [];
  // With several people, a slot only one person can make isn't a useful suggestion.
  if (people.length > 1 && best < 2) return [];

  const scored = cands
    .map((c) => ({ ...c, ...scoreSlot(c.s, c.e, c.who, now) }))
    .sort((a, b) => b.score - a.score || a.s - b.s);

  // Pick top slots: first prefer distinct days, then fill with any non-overlapping.
  const refTz = people[0].tz;
  const picked: typeof scored = [];
  const days = new Set<string>();
  for (const pass of [true, false]) {
    for (const c of scored) {
      if (picked.length >= limit) break;
      if (picked.includes(c)) continue;
      if (picked.some((p) => c.s < p.e && p.s < c.e)) continue;
      const day = localDayKey(c.s, refTz);
      if (pass && days.has(day)) continue;
      picked.push(c);
      days.add(day);
    }
  }

  return picked.map((c) => ({
    start: new Date(c.s).toISOString(),
    end: new Date(c.e).toISOString(),
    available: c.who.map((p) => p.name),
    missing: people.filter((p) => !c.who.includes(p)).map((p) => p.name),
    everyone: c.who.length === people.length,
    score: Math.round(c.score * 100) / 100,
    reasons: c.reasons,
  }));
}
