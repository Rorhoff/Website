import {
  SLOT_COLS,
  SLOT_GAP,
  SLOT_ROW_GAP,
  SLOT_SIZE,
  SLOTS_TO_WIN,
  W,
} from "./constants";
import { newId } from "./schema";
import type { MapHoardSlot } from "./types";

/** Build the default 15-slot grid from a top-left anchor. */
export function hoardGridFromAnchor(anchorX: number, anchorY: number): MapHoardSlot[] {
  const slots: MapHoardSlot[] = [];
  for (let i = 0; i < SLOTS_TO_WIN; i++) {
    const col = i % SLOT_COLS;
    const row = Math.floor(i / SLOT_COLS);
    const pairId = newId("pair");
    slots.push({
      id: newId("slot"),
      x: anchorX + col * (SLOT_SIZE + SLOT_GAP),
      y: anchorY + row * (SLOT_ROW_GAP + SLOT_SIZE),
      index: i,
      pairId,
    });
  }
  return slots;
}

export function mirrorHoardSlot(s: MapHoardSlot): MapHoardSlot {
  return {
    id: newId("slot"),
    x: W - s.x - SLOT_SIZE,
    y: s.y,
    index: s.index,
    pairId: s.pairId,
  };
}

export function mirrorHoardTeam(blueSlots: MapHoardSlot[]): MapHoardSlot[] {
  return blueSlots.map((s) => mirrorHoardSlot(s));
}

export function slotRect(s: MapHoardSlot) {
  return { x: s.x, y: s.y, w: SLOT_SIZE, h: SLOT_SIZE };
}
