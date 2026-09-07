import { serializeMap } from "../src/schema.js";
import { defaultArenaMap } from "../src/default-map.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../../tv/src/maps/default_arena.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, serializeMap(defaultArenaMap()) + "\n");
console.log("Wrote", out);
