import { describe, expect, it } from "vitest";
import { assertPublicUrl, compactJson, countEpochs, findUrls, humanizeRRules, localizeEpochs, localizeTimestamps } from "./page-reader";

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

  it("converts Unix timestamps near now to local time, leaving other numbers alone", () => {
    const now = Date.UTC(2026, 9, 26);
    expect(localizeEpochs('[["1793093400"],30,1793093400000,{"id":1234567890}]', "Europe/Rome", now)).toBe(
      '[["2026-10-27 10:30"],30,"2026-10-27 10:30",{"id":1234567890}]',
    );
    expect(countEpochs('{"a":1793093400,"b":"1793095200","c":"x 1793097000"}', now)).toBe(2);
  });

  it("compresses slot tuples like Google appointment pages send", () => {
    const now = Date.UTC(2026, 9, 26);
    const body = '[[[[["1793093400"],30]],[[["1793095200"],30]],[[["1793097000"],30]],[[["1793107800"],30]]]]';
    expect(JSON.parse(compactJson(localizeEpochs(body, "Europe/Rome", now)))).toEqual([
      "starts every 30 min from 2026-10-27 10:30 through 11:30 [30]",
      "starts at 2026-10-27 14:30 [30]",
    ]);
  });

  it("lists two starts separately instead of as a run", () => {
    const body = JSON.stringify({ slots: ["2026-10-07 09:30", "2026-10-07 11:00", "2026-10-07 11:30", "2026-10-07 12:00"] });
    expect(JSON.parse(compactJson(body)).slots).toEqual([
      "starts at 2026-10-07 09:30",
      "starts every 30 min from 2026-10-07 11:00 through 12:00",
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
