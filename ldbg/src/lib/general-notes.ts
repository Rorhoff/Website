import { GENERAL_NOTES, type GeneralNote } from "@/config/notes";

export type NumberedNote = {
  number: number;
  id: string;
  text: string;
};

export function resolveEnabledNotes(
  enabledIds: string[] | undefined,
  options?: { forceFeatureFillNote?: boolean; forceStylePassNote?: boolean }
): NumberedNote[] {
  const baseIds = enabledIds ?? GENERAL_NOTES.filter((n) => n.defaultOn).map((n) => n.id);
  const idSet = new Set(baseIds);
  if (options?.forceFeatureFillNote) {
    idSet.add("ai-feature-fill");
  }
  if (options?.forceStylePassNote) {
    idSet.add("ai-style-pass");
  }
  const active: GeneralNote[] = GENERAL_NOTES.filter((n) => idSet.has(n.id));
  return active.map((n, i) => ({
    number: i + 1,
    id: n.id,
    text: n.text,
  }));
}
