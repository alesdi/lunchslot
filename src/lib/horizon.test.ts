import { describe, expect, it } from "vitest";
import { DEFAULT_HORIZON_DAYS, horizonPhrase, toHorizonDays } from "./horizon";

describe("horizon", () => {
  it("accepts only the offered ranges", () => {
    expect(toHorizonDays("14")).toBe(14);
    expect(toHorizonDays(60)).toBe(60);
    expect(toHorizonDays("365")).toBe(DEFAULT_HORIZON_DAYS);
    expect(toHorizonDays(null)).toBe(DEFAULT_HORIZON_DAYS);
  });

  it("phrases a range for use mid-sentence", () => {
    expect(horizonPhrase(28)).toBe("next 4 weeks");
  });
});
