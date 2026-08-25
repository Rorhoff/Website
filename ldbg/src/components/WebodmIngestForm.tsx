"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { withBasePath } from "@/lib/paths";
import { WEBODM_MANIFEST } from "@/lib/webodm-manifest";

export function WebodmIngestForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [selectedCount, setSelectedCount] = useState(0);
  const [fileList, setFileList] = useState<FileList | null>(null);

  const onFolderPick = useCallback((files: FileList | null) => {
    if (!files?.length) return;
    setFileList(files);
    setSelectedCount(files.length);
    setError("");
  }, []);

  async function ingestFromUpload() {
    if (!fileList?.length) {
      setError("Select your WebODM export folder first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i]!;
        const rel =
          (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
          file.name;
        fd.append("files", file);
        fd.append("paths", rel);
      }

      const res = await fetch(withBasePath("/api/projects/ingest-webodm"), {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        const checklist = data.checklist as { label: string; found: boolean }[] | undefined;
        const missing = checklist?.filter((c) => !c.found && c.label).map((c) => c.label);
        throw new Error(
          data.error + (missing?.length ? ` — missing: ${missing.join(", ")}` : "")
        );
      }
      router.push(`/projects/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ingest failed");
    } finally {
      setBusy(false);
    }
  }

  async function ingestFromPath() {
    if (!folderPath.trim()) {
      setError("Enter the absolute path to the WebODM export folder.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(withBasePath("/api/projects/ingest-webodm"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderPath: folderPath.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ingest failed");
      router.push(`/projects/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ingest failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
        <h3 className="text-sm font-semibold text-stone-900">Expected WebODM files</h3>
        <ul className="mt-2 space-y-1 text-xs text-stone-600">
          {WEBODM_MANIFEST.map((entry) => (
            <li key={entry.key}>
              <span className={entry.required ? "font-medium text-stone-800" : ""}>
                {entry.relativePath}
              </span>
              {entry.required ? " *" : entry.expected ? " (expected)" : ""}
            </li>
          ))}
        </ul>
      </div>

      <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-stone-300 bg-white p-6 text-center hover:border-emerald-500 hover:bg-emerald-50/30">
        <input
          type="file"
          className="hidden"
          // @ts-expect-error webkitdirectory is non-standard but supported for folder pick
          webkitdirectory=""
          directory=""
          multiple
          onChange={(e) => onFolderPick(e.target.files)}
        />
        <span className="font-medium text-stone-800">Select WebODM export folder</span>
        <span className="mt-1 text-sm text-stone-500">
          Choose the task folder containing odm_orthophoto, odm_georeferencing, etc.
        </span>
        {selectedCount > 0 ? (
          <span className="mt-3 rounded bg-emerald-50 px-2 py-1 text-sm text-emerald-800 ring-1 ring-emerald-200">
            {selectedCount} file(s) selected
          </span>
        ) : null}
      </label>

      <button
        type="button"
        disabled={busy || !fileList?.length}
        onClick={ingestFromUpload}
        className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Ingesting…" : "Ingest folder & create project"}
      </button>

      <details className="rounded-lg border border-stone-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-medium text-stone-800">
          Advanced: server folder path
        </summary>
        <p className="mt-2 text-xs text-stone-500">
          When LDBG runs on the same machine as the WebODM export. Requires{" "}
          <code className="rounded bg-stone-100 px-1">LDBG_WEBODM_ALLOW_PATH=true</code>.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            type="text"
            value={folderPath}
            onChange={(e) => setFolderPath(e.target.value)}
            placeholder="C:\WebODM\data\...\task_output"
            className="min-w-0 flex-1 rounded-md border border-stone-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy || !folderPath.trim()}
            onClick={ingestFromPath}
            className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-800 disabled:opacity-50"
          >
            Ingest path
          </button>
        </div>
      </details>

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}
    </div>
  );
}
