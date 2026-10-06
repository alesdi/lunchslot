import { describe, expect, it } from "vitest";
import { assertPublicUrl, compactJson, findUrls, humanizeRRules, localizeTimestamps } from "./page-reader";

describe("page reader helpers", () => {
  it("finds the first link in free text", () => {
    expect(findUrls("my slots: https://cal.com/me/30min, thanks")).toEqual(["https://cal.com/me/30min"]);
    expect(findUrls("no links here")).toEqual([]);
  });

  it("converts absolute timestamps to local wall-clock time", () => {
    expect(localizeTimestamps('{"t":"2026-10-07T01:00:00Z"}', "Europe/Rome")).toBe('{"t":"2026-10-07 03:00"}');
    expect(localizeTimestamps("2026-10-07T09:00:00-04:00", "Europe/Rome")).toBe("2026-10-07 15:00");
  });

  it("compresses evenly spaced start times into runs, keeping gaps", () => {
    const body = JSON.stringify({
      slots: ["2026-10-07 10:30", "2026-10-07 10:40", "2026-10-07 10:50", "2026-10-07 11:20", "2026-10-07 11:30", "2026-10-07 11:40"],
    });
    expect(JSON.parse(compactJson(body)).slots).toEqual([
      "starts every 10 min from 2026-10-07 10:30 through 10:50",
      "starts every 10 min from 2026-10-07 11:20 through 11:40",
    ]);
  });

  it("drops empty values, URLs, and collapses single-key wrappers", () => {
    const body = JSON.stringify({ a: null, b: [], c: { time: "x" }, img: "https://example.com/a.png", d: 1 });
    expect(JSON.parse(compactJson(body))).toEqual({ c: "x", d: 1 });
  });

  it("spells out iCalendar recurrence rules", () => {
    expect(humanizeRRules("DTSTART:20261006T000000Z\\nRRULE:FREQ=WEEKLY;BYDAY=MO,TU;BYHOUR=9;BYMINUTE=0")).toBe(
      "repeats weekly on Mon, Tue at 09:00 (organizer's time zone)",
    );
  });

  it("rejects private and local addresses", async () => {
    await expect(assertPublicUrl("http://localhost:3000")).rejects.toThrow();
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow();
    await expect(assertPublicUrl("http://10.0.0.1/")).rejects.toThrow();
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow();
  });
});
