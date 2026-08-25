"use client";

import type { Calibration, ProjectMetadata } from "@/lib/project-schema";
import { DesignStyleSchema } from "@/lib/project-schema";

const STYLES = DesignStyleSchema.options;

type Props = {
  metadata: ProjectMetadata;
  onChange: (metadata: ProjectMetadata) => void;
  onSave: () => void;
  saving: boolean;
};

export function MetadataForm({ metadata, onChange, onSave, saving }: Props) {
  function set<K extends keyof ProjectMetadata>(key: K, value: ProjectMetadata[K]) {
    onChange({ ...metadata, [key]: value });
  }

  return (
    <div className="space-y-4 rounded-xl border border-stone-200 bg-white p-4">
      <h2 className="text-lg font-semibold text-stone-900">Project metadata</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-sm">
          <span className="text-stone-600">Client name</span>
          <input
            className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
            value={metadata.clientName}
            onChange={(e) => set("clientName", e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-stone-600">Project title</span>
          <input
            className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
            value={metadata.projectTitle}
            onChange={(e) => set("projectTitle", e.target.value)}
          />
        </label>
        <label className="block text-sm md:col-span-2">
          <span className="text-stone-600">Property address</span>
          <input
            className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
            value={metadata.propertyAddress}
            onChange={(e) => set("propertyAddress", e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-stone-600">Design style</span>
          <select
            className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
            value={metadata.designStyle}
            onChange={(e) =>
              set("designStyle", e.target.value as ProjectMetadata["designStyle"])
            }
          >
            {STYLES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-stone-600">Climate zone</span>
          <input
            className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
            value={metadata.climateZone}
            onChange={(e) => set("climateZone", e.target.value)}
          />
        </label>
        <label className="block text-sm md:col-span-2">
          <span className="text-stone-600">Notes</span>
          <textarea
            className="mt-1 min-h-24 w-full rounded-md border border-stone-300 px-3 py-2"
            value={metadata.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </label>
      </div>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save metadata"}
      </button>
    </div>
  );
}

export type { Calibration };
