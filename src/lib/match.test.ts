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
  summary: "",
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
    const slots = findSlots(
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
    const slots = findSlots(
      [
        person("Ana", "UTC", {
          free: [range("2026-10-07", "11:00", "15:00")],
          preferences: [{ kind: "avoid", date: null, weekdays: null, start: "12:00", end: "14:00", weight: 3, label: "lunch" }],
        }),
        person("Bob", "UTC", { free: [range("2026-10-07", "09:00", "18:00")] }),
      ],
      { ...opts, limit: 1 },
    );
    const h = new Date(slots[0].start).getUTCHours();
    expect(h < 12 || h >= 14).toBe(true);
    expect(slots[0].reasons).toContainEqual({ tone: "good", text: "Avoids Ana's lunch" });
  });

  it("returns at most 3 non-overlapping slots, preferring different days", () => {
    const slots = findSlots(
      [person("Ana", "UTC", { free: [range(null, "09:00", "17:00", ["mon", "tue", "wed", "thu", "fri"])] })],
      opts,
    );
    expect(slots).toHaveLength(3);
    expect(new Set(slots.map((s) => s.start.slice(0, 10))).size).toBe(3);
  });

  it("falls back to best coverage when nobody fully overlaps", () => {
    const slots = findSlots(
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
    const slots = findSlots([person("Ana", "UTC", { free: [range("2026-10-05", "08:00", "09:30")] })], opts);
    expect(slots).toEqual([]);
  });
});
