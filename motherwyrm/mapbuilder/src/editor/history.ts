import { serializeMap, parseMap } from "../schema";
import type { MapDocument } from "../types";

const MAX = 64;

export function createHistory() {
  const undoStack: string[] = [];
  const redoStack: string[] = [];

  return {
    canUndo(): boolean {
      return undoStack.length > 0;
    },
    canRedo(): boolean {
      return redoStack.length > 0;
    },
    clear(): void {
      undoStack.length = 0;
      redoStack.length = 0;
    },
    /** Call immediately before a mutating edit. */
    record(doc: MapDocument): void {
      undoStack.push(serializeMap(doc));
      if (undoStack.length > MAX) undoStack.shift();
      redoStack.length = 0;
    },
    undo(current: MapDocument): MapDocument | null {
      if (!undoStack.length) return null;
      redoStack.push(serializeMap(current));
      return parseMap(undoStack.pop()!);
    },
    redo(current: MapDocument): MapDocument | null {
      if (!redoStack.length) return null;
      undoStack.push(serializeMap(current));
      return parseMap(redoStack.pop()!);
    },
  };
}

export type EditorHistory = ReturnType<typeof createHistory>;
