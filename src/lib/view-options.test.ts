import { describe, expect, it } from "vitest";
import { toViewOptions } from "./view-options";

const A = "0b6e7f5e-3c1a-4a52-9d0e-1f2a3b4c5d6e";
const B = "9f8e7d6c-5b4a-4321-8fed-cba987654321";

describe("toViewOptions", () => {
  it("reads required ids from a comma-separated string or a list", () => {
    expect(toViewOptions("14", `${A},${B}`)).toEqual({ horizonDays: 14, required: [A, B] });
    expect(toViewOptions(14, [B, B])).toEqual({ horizonDays: 14, required: [B] });
  });

  it("drops anything that isn't an id", () => {
    expect(toViewOptions(null, `${A},nope,`)).toEqual({ horizonDays: 7, required: [A] });
    expect(toViewOptions(undefined, { a: 1 })).toEqual({ horizonDays: 7, required: [] });
  });
});
