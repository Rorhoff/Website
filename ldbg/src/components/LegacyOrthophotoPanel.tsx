"use client";

import { useCallback, useRef, useState } from "react";
import { readImageDimensions } from "@/lib/image-utils";
import { withBasePath } from "@/lib/paths";
import {
  compressOrthophotoForUpload,
  formatMb,
  needsServerDecode,
} from "@/lib/resize-orthophoto";
import { UPLOAD_MAX_BYTES, uploadPreflightError } from "@/lib/upload-limits";
import { parseUploadErrorResponse, xhrUploadFormData } from "@/lib/upload-xhr";

type Props = {
  projectId: string;
  missing: "annotated" | "clean";
  onUploaded: () => void;
};

export function LegacyOrthophotoPanel({ projectId, missing, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const label =
    missing === "annotated" ? "Annotated orthophoto" : "Clean orthophoto";
  const hint =
    missing === "annotated"
      ? "Upload your marked-up sketch to import polygons from color."
      : "Upload the unmarked frame for AI plan fills and CV import.";

  const onPick = useCallback((files: FileList | null) => {
    const f = files?.[0];
    // Some browsers hand over a .tif with an empty type, so the extension is
    // the only thing to go on.
    if (!f || !(f.type.startsWith("image/") || needsServerDecode(f))) return;
    if (f.size > UPLOAD_MAX_BYTES) {
      setError(uploadPreflightError(f.size, label));
      return;
    }
    setError("");
    setFile(f);
  }, [label]);

  async function upload() {
    if (!file) {
      setError(`Choose a ${label.toLowerCase()} first.`);
      return;
    }

    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      const key = missing === "annotated" ? "annotated" : "clean";

      if (needsServerDecode(file)) {
        // Send it whole and let the server convert and measure it. Reporting
        // dimensions is not possible here, and the server knows to skip the
        // cross-check when they are absent for these.
        fd.set(key, file);
      } else {
        const prepared = await compressOrthophotoForUpload(file);
        const dims = prepared.wasCompressed
          ? { width: prepared.width, height: prepared.height }
          : await readImageDimensions(prepared.file);
        fd.set(key, prepared.file);
        fd.set(`${key}Width`, String(dims.width));
        fd.set(`${key}Height`, String(dims.height));
      }

      const result = await xhrUploadFormData(
        withBasePath(`/api/projects/${projectId}/upload`),
        fd
      );

      if (!result.ok) {
        throw new Error(
          parseUploadErrorResponse(
            result.status,
            result.responseText,
            formatMb(file.size)
          )
        );
      }

      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <h3 className="text-sm font-semibold text-amber-950">Add {label.toLowerCase()}</h3>
      <p className="mt-1 text-sm text-amber-900/90">{hint}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-stone-800 hover:bg-amber-50">
          Choose file
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/tiff,.tif,.tiff"
            className="hidden"
            onChange={(e) => onPick(e.target.files)}
          />
        </label>
        {file ? (
          <span className="text-sm text-stone-700">
            {file.name} ({formatMb(file.size)} MB)
          </span>
        ) : null}
        <button
          type="button"
          disabled={busy || !file}
          onClick={upload}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>
      {error ? (
        <p className="mt-2 text-sm text-red-800">{error}</p>
      ) : null}
    </section>
  );
}
