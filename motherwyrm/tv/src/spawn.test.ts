import { describe, expect, it } from "vitest";
import { TUNING } from "./arena-layout";
import {
  enemyCampingHoard,
  hoardCenter,
  hoardSpawnPoint,
  mothersClash,
  pickWhelpRespawn,
} from "./spawn";

describe("mother combat tuning", () => {
  it("one mother hit is lethal", () => {
    expect(TUNING.motherHp).toBe(1);
  });
});

describe("mother clash", () => {
  it("deflects when both attacks connect", () => {
    const clash = mothersClash(
      { x: 100, y: 100 },
      { x: 120, y: 100 },
      { x: 80, y: 100 },
      { x: 100, y: 100 }
    );
    expect(clash).toBe(true);
  });

  it("deflects face-to-face lunges when claws cross", () => {
    const clash = mothersClash(
      { x: 130, y: 100 },
      { x: 110, y: 100 },
      { x: 90, y: 100 },
      { x: 110, y: 100 },
      { x: 1, y: 0 },
      { x: -1, y: 0 }
    );
    expect(clash).toBe(true);
  });

  it("does not deflect when only one side connects", () => {
    const oneSided = mothersClash(
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 80, y: 100 },
      { x: 100, y: 100 }
    );
    expect(oneSided).toBe(false);
  });
});

describe("whelp respawn", () => {
  it("places whelp near own hoard by default", () => {
    expect(pickWhelpRespawn("blue", null, TUNING.spawnCampRadius)).toEqual(
      hoardSpawnPoint("blue")
    );
    expect(pickWhelpRespawn("red", null, TUNING.spawnCampRadius)).toEqual(
      hoardSpawnPoint("red")
    );
  });

  it("detects enemy mother camping the hoard", () => {
    const center = hoardCenter("blue");
    expect(
      enemyCampingHoard(center.x, center.y, "blue", TUNING.spawnCampRadius)
    ).toBe(true);
    expect(
      enemyCampingHoard(640, 620, "blue", TUNING.spawnCampRadius)
    ).toBe(false);
  });

  it("uses a distant alt spawn when hoard is camped", () => {
    const center = hoardCenter("red");
    const pt = pickWhelpRespawn(
      "red",
      { x: center.x, y: center.y },
      TUNING.spawnCampRadius
    );
    expect(pt).not.toEqual(hoardSpawnPoint("red"));
    const distFromCamper = (pt.x - center.x) ** 2 + (pt.y - center.y) ** 2;
    expect(distFromCamper).toBeGreaterThan(TUNING.spawnCampRadius ** 2);
  });
});
