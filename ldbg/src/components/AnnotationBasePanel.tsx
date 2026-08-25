"use client";

import { useRef, useState } from "react";
import { DEFAULT_ANNOTATION_LONG_EDGE } from "@/lib/annotation-base-constants";
import { readImageDimensions, projectImageUrl } from "@/lib/image-utils";
import { withBasePath } from "@/lib/paths";
import type { AnnotationBase, Project } from "@/lib/project-schema";
import {
  UPLOAD_MAX_BYTES,
  uploadPreflightError,
} from "@/lib/upload-limits";
import { parseUploadErrorResponse, xhrUploadFormData } from "@/lib/upload-xhr";

type Props = {
  projectId: string;
  annotationBase?: AnnotationBase;
  hasAnnotated: boolean;
  annotatedFilename?: string;
  onProjectUpdate: (project: Project) => void;
};

export function AnnotationBasePanel({
  projectId,
  annotationBase,
  hasAnnotated,
  annotatedFilename,
  onProjectUpdate,
}: Props) {
  const [longEdge, setLongEdge] = useState(
    annotationBase?.longEdgePx ?? DEFAULT_ANNOTATION_LONG_EDGE
  );
  const [busy, setBusy] = useState<"export" | "upload" | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function exportBase(force = false) {
    setBusy("export");
    setError("");
    try {
      const res = await fetch(
        withBasePath(`/api/projects/${projectId}/export-annotation-base`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ longEdge, force }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Export failed");
      onProjectUpdate(data);

      const url = projectImageUrl(projectId, "annotation-base.jpg");
      const a = document.createElement("a");
      a.href = url;
      a.download = "annotation-base.jpg";
      a.click();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  async function uploadAnnotated(file: File) {
    if (file.size > UPLOAD_MAX_BYTES) {
      setError(uploadPreflightError(file.size, "Annotated sketch"));
      return;
    }

    setBusy("upload");
    setError("");
    try {
      const dim = await readImageDimensions(file);
      const fd = new FormData();
      fd.set("annotated", file);
      fd.set("annotatedWidth", String(dim.width));
      fd.set("annotatedHeight", String(dim.height));

      const result = await xhrUploadFormData(
        withBasePath(`/api/projects/${projectId}/upload-annotated`),
        fd
      );

      let data: Project & { error?: string } = {} as Project & { error?: string };
      try {
        data = JSON.parse(result.responseText);
      } catch {
        // ignore
      }

      if (!result.ok) {
        throw new Error(
          parseUploadErrorResponse(result.status, result.responseText)
        );
      }

      onProjectUpdate(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div>
        <h2 className="text-lg font-semibold text-stone-900">Annotation base</h2>
        <p className="text-sm text-stone-600">
          Export a right-sized JPEG from the georeferenced orthophoto, draw on your phone,
          then upload the marked-up file back. Dimensions must match exactly.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg bg-stone-50 p-3 text-sm">
        <label className="block">
          <span className="text-xs font-medium text-stone-600">Long edge (px)</span>
          <input
            type="number"
            min={512}
            max={8192}
            step={100}
            value={longEdge}
            onChange={(e) => setLongEdge(parseInt(e.target.value, 10) || 4000)}
            className="mt-1 block w-28 rounded border border-stone-300 px-2 py-1"
          />
        </label>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => exportBase(false)}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy === "export" ? "Exporting…" : "Export annotation base"}
        </button>
        {annotationBase ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => exportBase(true)}
            className="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-800 disabled:opacity-50"
          >
            Re-export
          </button>
        ) : null}
        {annotationBase ? (
          <a
            href={projectImageUrl(projectId, annotationBase.filename)}
            download={annotationBase.filename}
            className="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-800 hover:bg-white"
          >
            Download JPEG
          </a>
        ) : null}
      </div>

      {annotationBase ? (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-stone-500">Base size</dt>
            <dd className="font-mono text-stone-900">
              {annotationBase.width} × {annotationBase.height} px
            </dd>
          </div>
          <div>
            <dt className="text-stone-500">Downscale from full ortho</dt>
            <dd className="text-stone-900">
              {annotationBase.downscaleFactor.toFixed(2)}× (
              {annotationBase.fullWidthPx.toLocaleString()} ×{" "}
              {annotationBase.fullHeightPx.toLocaleString()} full)
            </dd>
          </div>
          <div>
            <dt className="text-stone-500">Exported</dt>
            <dd className="text-stone-900">
              {new Date(annotationBase.exportedAt).toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-stone-500">Annotated upload</dt>
            <dd className={hasAnnotated ? "text-emerald-800" : "text-amber-800"}>
              {hasAnnotated
                ? `Loaded (${annotatedFilename ?? "annotated"})`
                : "Not uploaded yet"}
            </dd>
          </div>
        </dl>
      ) : null}

      {annotationBase ? (
        <div className="space-y-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => fileRef.current?.click()}
            className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === "upload" ? "Uploading…" : "Upload annotated sketch"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadAnnotated(f);
              e.target.value = "";
            }}
          />
          <p className="text-xs text-stone-500">
            Upload must be exactly {annotationBase.width}×{annotationBase.height}px — use
            the exported file without cropping.
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}
    </section>
  );
}
