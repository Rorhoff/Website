"use client";

import { GENERAL_NOTES } from "@/config/notes";
import type { BoardSettings } from "@/lib/project-schema";

type Props = {
  boardSettings?: BoardSettings;
  onChange: (settings: BoardSettings) => void;
  onSave: () => void;
  saving?: boolean;
};

export function GeneralNotesPanel({
  boardSettings,
  onChange,
  onSave,
  saving,
}: Props) {
  const enabled = new Set(
    boardSettings?.enabledNoteIds ??
      GENERAL_NOTES.filter((n) => n.defaultOn).map((n) => n.id)
  );

  function toggle(id: string) {
    const next = new Set(enabled);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({
      pageSize: boardSettings?.pageSize ?? "24x36",
      sheetNumber: boardSettings?.sheetNumber ?? "C-100",
      revision: boardSettings?.revision ?? "Rev 1",
      designer: boardSettings?.designer ?? "",
      issueDate: boardSettings?.issueDate,
      enabledNoteIds: GENERAL_NOTES.filter((n) => next.has(n.id)).map((n) => n.id),
    });
  }

  return (
    <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-5">
      <div>
        <h2 className="text-lg font-semibold text-stone-900">General notes</h2>
        <p className="text-sm text-stone-600">
          Toggle notes for the exported sheet. Numbers renumber automatically on export.
        </p>
      </div>
      <ul className="max-h-72 space-y-2 overflow-y-auto text-sm">
        {GENERAL_NOTES.map((n) => (
          <li key={n.id} className="flex gap-2 rounded-lg border border-stone-100 p-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={enabled.has(n.id)}
              onChange={() => toggle(n.id)}
            />
            <span className="text-stone-700">{n.text}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="rounded-lg bg-stone-800 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save note selection"}
      </button>
    </section>
  );
}
