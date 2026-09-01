import { describe, expect, it } from "vitest";
import { padJoinUrl } from "./qr";

describe("padJoinUrl", () => {
  it("builds a pad deep link with the room code", () => {
    expect(padJoinUrl("ABCD", "https://rorhoff.com")).toBe(
      "https://rorhoff.com/mw/pad/c/ABCD"
    );
  });

  it("strips trailing slash from origin", () => {
    expect(padJoinUrl("WXYZ", "https://rorhoff.com/")).toBe(
      "https://rorhoff.com/mw/pad/c/WXYZ"
    );
  });
});
