import { describe, expect, it, vi } from "vitest";

vi.mock("phaser", () => ({ default: {} }));

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerAsepriteAnims } from "./assets";

const here = path.dirname(fileURLToPath(import.meta.url));
const motherJson = JSON.parse(
  fs.readFileSync(path.join(here, "../public/assets/mother_blue.json"), "utf8")
);

type AnimCfg = {
  key: string;
  frames: Array<{ key: string; frame: string; duration: number }>;
};

function fakeScene(json: unknown) {
  const created = new Map<string, AnimCfg>();
  return {
    scene: {
      cache: { json: { get: () => json } },
      anims: {
        exists: (k: string) => created.has(k),
        remove: (k: string) => {
          created.delete(k);
        },
        create: (cfg: AnimCfg) => {
          created.set(cfg.key, cfg);
        },
      },
    },
    created,
  };
}

describe("registerAsepriteAnims", () => {
  it("points the dive tag at the dive filename, not a numeric index", () => {
    const { scene, created } = fakeScene(motherJson);
    registerAsepriteAnims(scene as never, "mother_blue");

    const dive = created.get("mother_blue_dive");
    expect(dive?.frames).toHaveLength(1);
    expect(dive?.frames[0].frame).toBe("mother_blue_dive");
    expect(dive?.frames[0].frame).not.toBe("1");
  });

  it("registers every mother tag the game plays", () => {
    const { scene, created } = fakeScene(motherJson);
    registerAsepriteAnims(scene as never, "mother_blue");

    for (const tag of ["idle", "flap", "dive", "claw", "hurt", "death"]) {
      expect(created.has(`mother_blue_${tag}`), tag).toBe(true);
    }
  });
});
