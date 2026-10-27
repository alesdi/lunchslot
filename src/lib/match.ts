import { TZDate } from "@date-fns/tz";
import { expandAvailability, expandPreferences, type Interval } from "./availability/expand";
import type { ParsedAvailability } from "./availability/schema";

export type MatchParticipant = { id: string; name: string; tz: string; parsed: ParsedAvailability };

export type Reason = { tone: "good" | "warn"; text: string };

/** The ways a slot can be the best: most people, a balance of everything, or as soon as possible. */
export type Pick = "attendance" | "balanced" | "soonest";

export type Slot = {
  start: string; // ISO
  end: string;
  available: string[]; // participant names
  missing: string[];
  everyone: boolean;
  /** Which picks chose this slot, in STRATEGIES order. Usually one; a slot can win several. */
  picks: Pick[];
  score: number;
  reasons: Reason[];
};

/**
 * Every pick weighs the same criteria, just differently: people missing, convenience (preferences and
 * humane local hours), and how far away the slot is. Points are on the preference scale: avoiding a
 * normal preference costs 20, being outside 08-20 costs 4 per person.
 */
const STRATEGIES: { pick: Pick; perMissing: number; perDay: number; minShare: number }[] = [
  // As many people as possible, then the most convenient of those times, even an awkward one.
  { pick: "attendance", perMissing: 1000, perDay: 0.3, minShare: 0 },
  // One person missing costs about a strongly avoided time; a week later costs a mild preference.
  { pick: "balanced", perMissing: 25, perDay: 1, minShare: 0 },
  // A point per hour sooner, at a decent time, with at least half the group.
  { pick: "soonest", perMissing: 8, perDay: 24, minShare: 0.5 },
];

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

/** How convenient a slot is for the people who can make it, regardless of when it is. */
function scoreSlot(s: number, e: number, people: Prepared[]) {
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
  /** `required`: ids of people every suggested time must include. */
  opts: { durationMin: number; now: number; horizonDays: number; required?: string[] },
): MatchResult {
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
  const required = prepared.filter((p) => opts.required?.includes(p.id));
  // Someone who must attend but has no times in the range rules out every slot.
  if (required.some((p) => !people.includes(p))) return { slots: [], idle };
  return { slots: pickSlots(people, required, dur, from, to, opts.now), idle };
}

function pickSlots(people: Prepared[], required: Prepared[], dur: number, from: number, to: number, now: number): Slot[] {
  if (people.length === 0) return [];
  // With several people, a slot only one person can make isn't a useful suggestion.
  const need = people.length > 1 ? 2 : 1;

  // Enumerate grid starts, who can make each one, and how convenient it is for them.
  type Cand = { s: number; e: number; who: Prepared[]; score: number; reasons: Reason[] };
  const cands: Cand[] = [];
  for (let s = from; s + dur <= to; s += GRID) {
    const e = s + dur;
    const who = people.filter((p) => covers(p.free, s, e));
    if (who.length >= need && required.every((p) => who.includes(p))) cands.push({ s, e, who, ...scoreSlot(s, e, who) });
  }

  // Each strategy picks its best slot; ties go to the earliest.
  const picked: { c: Cand; picks: Pick[]; total: number }[] = [];
  for (const st of STRATEGIES) {
    const min = Math.max(need, Math.ceil(people.length * st.minShare));
    let best: Cand | undefined;
    let bestTotal = -Infinity;
    for (const c of cands) {
      if (c.who.length < min) continue;
      const total = c.score - (people.length - c.who.length) * st.perMissing - ((c.s - now) / DAY) * st.perDay;
      if (total > bestTotal) [best, bestTotal] = [c, total];
    }
    if (!best) continue;
    const same = picked.find((p) => p.c === best);
    if (same) same.picks.push(st.pick);
    else picked.push({ c: best, picks: [st.pick], total: bestTotal });
  }

  return picked.map(({ c, picks, total }) => ({
    start: new Date(c.s).toISOString(),
    end: new Date(c.e).toISOString(),
    available: c.who.map((p) => p.name),
    missing: people.filter((p) => !c.who.includes(p)).map((p) => p.name),
    everyone: c.who.length === people.length,
    picks,
    score: Math.round(total * 100) / 100,
    reasons: c.reasons,
  }));
}
