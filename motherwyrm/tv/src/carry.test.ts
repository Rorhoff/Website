import { describe, expect, it } from "vitest";
import { TUNING } from "./arena-layout";

describe("carry rules", () => {
  it("whelps carry at most one gem", () => {
    expect(TUNING.carryMax).toBe(1);
  });
});
