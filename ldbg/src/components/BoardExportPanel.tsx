"use client";

import { useState } from "react";
import Link from "next/link";
import { BOARD_SIZES, type BoardPageSize } from "@/lib/board-sizes";
import { withBasePath } from "@/lib/paths";
import type { BoardSettings } from "@/lib/project-schema";

type Props = {
  projectId: string;
  boardSettings?: BoardSettings;
  onBoardSettingsChange: (settings: BoardSettings) => void;
  onSaveBoardSettings: () => void;
  hasFeatures: boolean;
  exportBlocked?: boolean;
  exportBlockReason?: string;
  saving?: boolean;
};

function mergeSettings(
  current: BoardSettings | undefined,
  patch: Partial<BoardSettings>
): BoardSettings {
  return {
    pageSize: patch.pageSize ?? current?.pageSize ?? "24x36",
    sheetNumber: patch.sheetNumber ?? current?.sheetNumber ?? "C-100",
    revision: patch.revision ?? current?.revision ?? "Rev 1",
    designer: patch.designer ?? current?.designer ?? "",
    issueDate: patch.issueDate ?? current?.issueDate,
    enabledNoteIds: patch.enabledNoteIds ?? current?.enabledNoteIds,
  };
}

export function BoardExportPanel({
  projectId,
  boardSettings,
  onBoardSettingsChange,
  onSaveBoardSettings,
  hasFeatures,
  exportBlocked,
  exportBlockReason,
  saving,
}: Props) {
  const [pageSize, setPageSize] = useState<BoardPageSize>(
    boardSettings?.pageSize ?? "24x36"
  );
  const [exporting, setExporting] = useState<"pdf" | "png" | null>(null);
  const [error, setError] = useState("");

  function patch(p: Partial<BoardSettings>) {
    onBoardSettingsChange(mergeSettings(boardSettings, p));
  }

  function updateSize(size: BoardPageSize) {
    setPageSize(size);
    patch({ pageSize: size });
  }

  const exportDisabled = !hasFeatures || exporting !== null || exportBlocked;

  async function download(format: "pdf" | "png") {
    setExporting(format);
    setError("");
    try {
      const res = await fetch(
        withBasePath(`/api/projects/${projectId}/export-board`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ format, pageSize }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Export failed");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? `board.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(null);
    }
  }

  const previewHref = `/projects/${projectId}/board?size=${pageSize}`;

  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">Design board export</h2>
          <p className="text-sm text-stone-600">
            Professional layout at 300 DPI with title block, general notes, and scale stamp.
          </p>
        </div>
      </div>

      <div className="grid gap-3 rounded-lg bg-stone-50 p-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className="text-xs font-medium text-stone-600">Page size</span>
          <select
            className="mt-1 block w-full rounded border border-stone-300 px-2 py-1"
            value={pageSize}
            onChange={(e) => updateSize(e.target.value as BoardPageSize)}
          >
            {(Object.keys(BOARD_SIZES) as BoardPageSize[]).map((k) => (
              <option key={k} value={k}>
                {BOARD_SIZES[k].label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-stone-600">Sheet no.</span>
          <input
            className="mt-1 block w-full rounded border border-stone-300 px-2 py-1"
            value={boardSettings?.sheetNumber ?? "C-100"}
            onChange={(e) => patch({ sheetNumber: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-stone-600">Revision</span>
          <input
            className="mt-1 block w-full rounded border border-stone-300 px-2 py-1"
            value={boardSettings?.revision ?? "Rev 1"}
            onChange={(e) => patch({ revision: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-stone-600">Drawn by</span>
          <input
            className="mt-1 block w-full rounded border border-stone-300 px-2 py-1"
            value={boardSettings?.designer ?? ""}
            onChange={(e) => patch({ designer: e.target.value })}
            placeholder="Designer name"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-stone-600">Issue date</span>
          <input
            type="date"
            className="mt-1 block w-full rounded border border-stone-300 px-2 py-1"
            value={
              boardSettings?.issueDate
                ? boardSettings.issueDate.slice(0, 10)
                : new Date().toISOString().slice(0, 10)
            }
            onChange={(e) =>
              patch({ issueDate: new Date(e.target.value).toISOString() })
            }
          />
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <button
          type="button"
          onClick={onSaveBoardSettings}
          disabled={saving}
          className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm disabled:opacity-50"
        >
          Save sheet settings
        </button>
        <Link
          href={previewHref}
          target="_blank"
          className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-800 hover:bg-white"
        >
          Preview board
        </Link>
        <button
          type="button"
          disabled={exportDisabled}
          onClick={() => download("pdf")}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {exporting === "pdf" ? "Exporting PDF…" : "Export PDF"}
        </button>
        <button
          type="button"
          disabled={exportDisabled}
          onClick={() => download("png")}
          className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {exporting === "png" ? "Exporting PNG…" : "Export PNG"}
        </button>
      </div>

      {!hasFeatures ? (
        <p className="text-sm text-amber-800">Add features before exporting a board.</p>
      ) : null}

      {exportBlocked && exportBlockReason ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {exportBlockReason}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}

      <p className="text-xs text-stone-500">
        Branding: <code className="text-stone-700">src/config/brand.ts</code> and{" "}
        <code className="text-stone-700">public/brand/</code>
      </p>
    </section>
  );
}
