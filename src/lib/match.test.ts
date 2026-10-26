import { describe, expect, it } from "vitest";
import { expandAvailability, localToEpoch } from "./availability/expand";
import type { ParsedAvailability } from "./availability/schema";
import { findSlots, type MatchParticipant } from "./match";

const base: ParsedAvailability = {
  statedTimezone: null,
  free: [],
  busy: [],
  bookingStarts: [],
  bookingSlotMinutes: null,
  preferences: [],
  unparseable: false,
};
const avail = (p: Partial<ParsedAvailability>): ParsedAvailability => ({ ...base, ...p });
const person = (name: string, tz: string, parsed: Partial<ParsedAvailability>): MatchParticipant => ({
  id: name,
  name,
  tz,
  parsed: avail(parsed),
});
const range = (date: string | null, start: string, end: string, weekdays: ParsedAvailability["free"][0]["weekdays"] = null) => ({
  date,
  weekdays,
  start,
  end,
});

// Monday 2026-10-05 08:00 UTC
const NOW = Date.UTC(2026, 9, 5, 8, 0);

describe("expandAvailability", () => {
  it("converts local wall time to UTC using the participant timezone", () => {
    const iv = expandAvailability(avail({ free: [range("2026-10-07", "14:00", "16:00")] }), "Europe/Rome", NOW, NOW + 7 * 864e5);
    expect(iv).toEqual([{ s: Date.UTC(2026, 9, 7, 12), e: Date.UTC(2026, 9, 7, 14) }]);
  });

  it("handles DST transitions (Europe/Rome falls back on 2026-10-25)", () => {
    const before = localToEpoch("2026-10-24", 10 * 60, "Europe/Rome");
    const after = localToEpoch("2026-10-26", 10 * 60, "Europe/Rome");
    expect(before).toBe(Date.UTC(2026, 9, 24, 8));
    expect(after).toBe(Date.UTC(2026, 9, 26, 9));
  });

  it("assumes Mon-Fri 9-18 when only busy times are given", () => {
    const iv = expandAvailability(avail({ busy: [range("2026-10-06", "09:00", "17:00")] }), "UTC", NOW, NOW + 2 * 864e5);
    expect(iv).toEqual([
      { s: Date.UTC(2026, 9, 5, 9), e: Date.UTC(2026, 9, 5, 18) },
      { s: Date.UTC(2026, 9, 6, 17), e: Date.UTC(2026, 9, 6, 18) },
    ]);
  });

  it("uses an explicitly stated timezone for ranges", () => {
    const iv = expandAvailability(
      avail({ statedTimezone: "America/New_York", free: [range("2026-10-07", "15:00", "18:00")] }),
      "Europe/London",
      NOW,
      NOW + 7 * 864e5,
    );
    expect(iv).toEqual([{ s: Date.UTC(2026, 9, 7, 19), e: Date.UTC(2026, 9, 7, 22) }]);
  });

  it("extends booking-page start runs by the slot length", () => {
    const iv = expandAvailability(
      avail({ bookingStarts: [range("2026-10-07", "09:00", "10:00"), range("2026-10-07", "14:00", "14:00")], bookingSlotMinutes: 30 }),
      "UTC",
      NOW,
      NOW + 7 * 864e5,
    );
    expect(iv).toEqual([
      { s: Date.UTC(2026, 9, 7, 9), e: Date.UTC(2026, 9, 7, 10, 30) },
      { s: Date.UTC(2026, 9, 7, 14), e: Date.UTC(2026, 9, 7, 14, 30) },
    ]);
  });

  it("skips zero-length ranges", () => {
    expect(expandAvailability(avail({ free: [range("2026-10-07", "11:00", "11:00")] }), "UTC", NOW, NOW + 7 * 864e5)).toEqual([]);
  });

  it("expands recurring weekday ranges", () => {
    const iv = expandAvailability(avail({ free: [range(null, "09:00", "10:00", ["tue", "thu"])] }), "UTC", NOW, NOW + 7 * 864e5);
    expect(iv.map((i) => new Date(i.s).toISOString())).toEqual([
      "2026-10-06T09:00:00.000Z",
      "2026-10-08T09:00:00.000Z",
    ]);
  });

  it("subtracts busy blocks from free ranges", () => {
    const iv = expandAvailability(
      avail({
        free: [range(null, "09:00", "12:00", ["tue"])],
        busy: [range("2026-10-06", "10:00", "11:00")],
      }),
      "UTC",
      NOW,
      NOW + 7 * 864e5,
    );
    expect(iv).toEqual([
      { s: Date.UTC(2026, 9, 6, 9), e: Date.UTC(2026, 9, 6, 10) },
      { s: Date.UTC(2026, 9, 6, 11), e: Date.UTC(2026, 9, 6, 12) },
    ]);
  });
});

describe("findSlots", () => {
  const opts = { durationMin: 30, now: NOW, horizonDays: 14 };

  it("finds the overlap across timezones", () => {
    const { slots } = findSlots(
      [
        person("Ana", "Europe/Rome", { free: [range("2026-10-07", "15:00", "18:00")] }), // 13-16 UTC
        person("Bob", "America/New_York", { free: [range("2026-10-07", "11:00", "12:00")] }), // 15-16 UTC
      ],
      opts,
    );
    expect(slots[0]).toMatchObject({ start: "2026-10-07T15:00:00.000Z", everyone: true });
    expect(slots.every((s) => s.start >= "2026-10-07T15:00" && s.end <= "2026-10-07T16:00:00.000Z")).toBe(true);
  });

  it("respects avoid preferences", () => {
    const { slots } = findSlots(
      [
        person("Ana", "UTC", {
          free: [range("2026-10-07", "11:00", "15:00")],
          preferences: [{ kind: "avoid", date: null, weekdays: null, start: "12:00", end: "14:00", weight: 3, label: "lunch" }],
        }),
        person("Bob", "UTC", { free: [range("2026-10-07", "09:00", "18:00")] }),
      ],
      opts,
    );
    const h = new Date(slots[0].start).getUTCHours();
    expect(h < 12 || h >= 14).toBe(true);
    expect(slots[0].reasons).toEqual([]);
  });

  it("picks for attendance, balance and speed separately", () => {
    const avoidEarly = { kind: "avoid" as const, date: null, weekdays: null, start: "06:00", end: "08:00", weight: 3, label: "early mornings" };
    const { slots } = findSlots(
      [
        // Everyone can only make an early slot in 13 days, which Ana strongly wants to avoid.
        person("Ana", "UTC", {
          free: [range("2026-10-18", "06:00", "07:00"), range("2026-10-09", "10:00", "11:00"), range("2026-10-06", "07:00", "07:30")],
          preferences: [avoidEarly],
        }),
        person("Bob", "UTC", { free: [range("2026-10-18", "06:00", "07:00"), range("2026-10-09", "10:00", "11:00")] }),
        // Ana and Cy could also meet tomorrow, at an awkward hour.
        person("Cy", "UTC", { free: [range("2026-10-18", "06:00", "07:00"), range("2026-10-06", "07:00", "07:30")] }),
      ],
      opts,
    );
    expect(slots.map((s) => [s.picks, s.start])).toEqual([
      [["attendance"], "2026-10-18T06:00:00.000Z"],
      [["balanced"], "2026-10-09T10:00:00.000Z"],
      [["soonest"], "2026-10-06T07:00:00.000Z"],
    ]);
    expect(slots[0]).toMatchObject({ everyone: true });
    expect(slots[1]).toMatchObject({ everyone: false, missing: ["Cy"] });
  });

  it("shows a slot that wins several picks once", () => {
    const { slots } = findSlots(
      [
        person("Ana", "UTC", { free: [range("2026-10-06", "10:00", "11:00")] }),
        person("Bob", "UTC", { free: [range("2026-10-06", "10:00", "11:00")] }),
      ],
      opts,
    );
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ start: "2026-10-06T10:00:00.000Z", picks: ["attendance", "balanced", "soonest"] });
  });

  it("only picks the earliest time when at least half the group can make it", () => {
    const { slots } = findSlots(
      [
        person("Ana", "UTC", { free: [range("2026-10-06", "10:00", "11:00"), range("2026-10-08", "10:00", "11:00")] }),
        person("Bob", "UTC", { free: [range("2026-10-06", "10:00", "11:00"), range("2026-10-08", "10:00", "11:00")] }),
        person("Cy", "UTC", { free: [range("2026-10-08", "10:00", "11:00")] }),
        person("Di", "UTC", { free: [range("2026-10-08", "10:00", "11:00")] }),
        person("Ed", "UTC", { free: [range("2026-10-08", "10:00", "11:00")] }),
      ],
      opts,
    );
    // Two of five tomorrow is too few: every pick lands on the 8th, when everyone can come.
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ start: "2026-10-08T10:00:00.000Z", everyone: true });
  });

  it("falls back to best coverage when nobody fully overlaps", () => {
    const { slots } = findSlots(
      [
        person("Ana", "UTC", { free: [range("2026-10-07", "09:00", "10:00")] }),
        person("Bob", "UTC", { free: [range("2026-10-07", "09:00", "10:00")] }),
        person("Cy", "UTC", { free: [range("2026-10-08", "09:00", "10:00")] }),
      ],
      opts,
    );
    expect(slots[0]).toMatchObject({ everyone: false, missing: ["Cy"] });
  });

  it("ignores slots too close to now", () => {
    const { slots } = findSlots([person("Ana", "UTC", { free: [range("2026-10-05", "08:00", "09:30")] })], opts);
    expect(slots).toEqual([]);
  });

  it("leaves out people whose times have all passed", () => {
    const { slots, idle } = findSlots(
      [
        person("Ana", "UTC", { free: [range("2026-10-07", "09:00", "10:00")] }),
        person("Bob", "UTC", { free: [range("2026-10-07", "09:00", "10:00")] }),
        person("Cy", "UTC", { free: [range("2026-10-04", "09:00", "18:00")] }), // yesterday
        person("Di", "UTC", { free: [range("2026-10-07", "09:00", "09:15")] }), // too short for the meeting
      ],
      opts,
    );
    expect(idle).toEqual(["Cy", "Di"]);
    expect(slots[0]).toMatchObject({ everyone: true, available: ["Ana", "Bob"], missing: [] });
  });
});
