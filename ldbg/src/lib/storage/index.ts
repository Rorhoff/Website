import path from "path";
import { DEFAULT_LEGEND, type LegendEntry } from "@/config/legend";
import {
  DEFAULT_ANNOTATION_PALETTE,
  type AnnotationPaletteEntry,
} from "@/lib/annotation-palette";
import { LocalStorageProvider } from "./local-storage";
import type { StorageProvider } from "./types";

let provider: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (!provider) {
    const root =
      process.env.LDBG_STORAGE_DIR ??
      path.join(process.cwd(), "storage");
    provider = new LocalStorageProvider(root);
  }
  return provider;
}

export async function getLegend(): Promise<LegendEntry[]> {
  const overrides = await getStorage().getLegendOverrides();
  return overrides ?? DEFAULT_LEGEND;
}

export async function getAnnotationPalette(): Promise<AnnotationPaletteEntry[]> {
  const overrides = await getStorage().getPaletteOverrides();
  return overrides ?? DEFAULT_ANNOTATION_PALETTE;
}

export type { StorageProvider };
