import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { busyFrom, openGrant, openStored, sealGrant, sealStored } from "./google-calendar";

beforeAll(() => {
  process.env.CALENDAR_TOKEN_KEY = randomBytes(32).toString("base64");
});

describe("token sealing", () => {
  it("round-trips a stored refresh token", () => {
    expect(openStored(sealStored("1//refresh-token"))).toBe("1//refresh-token");
  });

  it("rejects tampered values", () => {
    const sealed = sealStored("1//refresh-token");
    const flipped = Buffer.from(sealed, "base64url");
    flipped[flipped.length - 1] ^= 1;
    expect(openStored(flipped.toString("base64url"))).toBeNull();
    expect(openStored("garbage")).toBeNull();
  });

  it("keeps browser grants and stored tokens apart", () => {
    expect(openStored(sealGrant("1//refresh-token"))).toBeNull();
    expect(() => openGrant(sealStored("1//refresh-token"))).toThrow(/expired/);
  });

  it("expires browser grants after an hour", () => {
    const now = Date.now();
    const grant = sealGrant("1//refresh-token", now);
    expect(openGrant(grant, now + 59 * 60_000)).toBe("1//refresh-token");
    expect(() => openGrant(grant, now + 61 * 60_000)).toThrow(/expired/);
  });
});

describe("busyFrom", () => {
  it("turns the primary calendar's busy blocks into intervals", () => {
    const busy = busyFrom({
      calendars: {
        primary: {
          busy: [
            { start: "2026-10-27T09:00:00Z", end: "2026-10-27T10:30:00Z" },
            // Overnight, with an offset: kept as one absolute block.
            { start: "2026-10-27T22:00:00+01:00", end: "2026-10-28T07:00:00+01:00" },
            { start: "2026-10-28T12:00:00Z", end: "2026-10-28T12:00:00Z" },
          ],
        },
      },
    });
    expect(busy).toEqual([
      { s: Date.UTC(2026, 9, 27, 9), e: Date.UTC(2026, 9, 27, 10, 30) },
      { s: Date.UTC(2026, 9, 27, 21), e: Date.UTC(2026, 9, 28, 6) },
    ]);
  });

  it("fails when Google reports an error for the calendar", () => {
    expect(() => busyFrom({ calendars: { primary: { errors: [{ reason: "notFound" }] } } })).toThrow(/notFound/);
  });
});
