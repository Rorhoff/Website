"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { readImageDimensions } from "@/lib/image-utils";
import { withBasePath } from "@/lib/paths";
import {
  UPLOAD_MAX_BYTES,
  formatUploadMb,
  uploadPreflightError,
} from "@/lib/upload-limits";
import {
  formatMb,
  prepareOrthophotoPairForUpload,
} from "@/lib/resize-orthophoto";
import {
  parseUploadErrorResponse,
  xhrUploadFormData,
  type UploadProgress,
} from "@/lib/upload-xhr";

export function UploadForm() {
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);
  const [annotated, setAnnotated] = useState<File | null>(null);
  const [clean, setClean] = useState<File | null>(null);
  const [phase, setPhase] = useState<"idle" | "optimizing" | "uploading">("idle");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  const totalBytes = useMemo(
    () => (annotated?.size ?? 0) + (clean?.size ?? 0),
    [annotated, clean]
  );

  const overLimit = totalBytes > UPLOAD_MAX_BYTES;

  const validateFile = useCallback((f: File, label: string) => {
    if (f.size > UPLOAD_MAX_BYTES) {
      return uploadPreflightError(f.size, label);
    }
    return null;
  }, []);

  const onDrop = useCallback(
    (kind: "annotated" | "clean", files: FileList | null) => {
      const f = files?.[0];
      if (!f || !f.type.startsWith("image/")) return;
      const label = kind === "annotated" ? "Annotated orthophoto" : "Clean orthophoto";
      const fileErr = validateFile(f, label);
      if (fileErr) {
        setError(fileErr);
        return;
      }
      const other = kind === "annotated" ? clean : annotated;
      if (other && f.size + other.size > UPLOAD_MAX_BYTES) {
        setError(
          `Combined size would be ${formatUploadMb(f.size + other.size)} MB — limit is ${formatUploadMb(UPLOAD_MAX_BYTES)} MB. ` +
            `We'll try to compress automatically on submit, or choose smaller files.`
        );
      } else {
        setError("");
      }
      if (kind === "annotated") setAnnotated(f);
      else setClean(f);
    },
    [annotated, clean, validateFile]
  );

  function cancelUpload() {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
    setProgress(null);
    setStatus("");
    setError("Upload cancelled.");
  }

  async function submit() {
    if (!annotated) {
      setError("Annotated orthophoto is required.");
      return;
    }
    if (!clean) {
      setError("Clean orthophoto is required — upload the same frame without markings.");
      return;
    }

    const annErr = validateFile(annotated, "Annotated orthophoto");
    const cleanErr = validateFile(clean, "Clean orthophoto");
    if (annErr || cleanErr) {
      setError(annErr ?? cleanErr ?? "File too large");
      return;
    }

    setPhase("optimizing");
    setError("");
    setStatus("");
    setProgress(null);
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    try {
      setStatus(
        totalBytes > UPLOAD_MAX_BYTES
          ? `Combined ${formatMb(totalBytes)} MB exceeds ${formatMb(UPLOAD_MAX_BYTES)} MB — compressing…`
          : `Preparing ${formatMb(totalBytes)} MB for upload…`
      );

      const { annotated: ann, clean: cl } = await prepareOrthophotoPairForUpload(
        annotated,
        clean
      );

      if (signal.aborted) return;

      const combined = ann.file.size + cl.file.size;
      if (combined > UPLOAD_MAX_BYTES) {
        throw new Error(uploadPreflightError(combined, "Combined upload"));
      }

      setStatus("Creating project…");
      const createRes = await fetch(withBasePath("/api/projects"), {
        method: "POST",
        signal,
      });
      if (!createRes.ok) throw new Error("Could not create project");
      const project = await createRes.json();

      const annDim = ann.wasCompressed
        ? { width: ann.width, height: ann.height }
        : await readImageDimensions(ann.file);
      const cleanDim = cl.wasCompressed
        ? { width: cl.width, height: cl.height }
        : await readImageDimensions(cl.file);

      const fd = new FormData();
      fd.set("annotated", ann.file);
      fd.set("annotatedWidth", String(annDim.width));
      fd.set("annotatedHeight", String(annDim.height));
      fd.set("clean", cl.file);
      fd.set("cleanWidth", String(cleanDim.width));
      fd.set("cleanHeight", String(cleanDim.height));

      setPhase("uploading");
      setStatus(
        ann.wasCompressed || cl.wasCompressed
          ? `Uploading ${formatMb(combined)} MB (compressed from ${formatMb(ann.originalBytes + cl.originalBytes)} MB)…`
          : `Uploading ${formatMb(combined)} MB…`
      );

      const result = await xhrUploadFormData(
        withBasePath(`/api/projects/${project.id}/upload`),
        fd,
        (p) => setProgress(p),
        signal
      );

      if (!result.ok) {
        throw new Error(
          parseUploadErrorResponse(result.status, result.responseText, formatMb(combined))
        );
      }

      router.push(`/projects/${project.id}`);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setError("Upload cancelled.");
      } else {
        setError(e instanceof Error ? e.message : "Upload failed");
      }
    } finally {
      abortRef.current = null;
      setPhase("idle");
      setProgress(null);
      setStatus("");
    }
  }

  function DropZone({
    label,
    hint,
    file,
    kind,
    required,
  }: {
    label: string;
    hint: string;
    file: File | null;
    kind: "annotated" | "clean";
    required?: boolean;
  }) {
    return (
      <label
        className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-stone-300 bg-stone-50 p-6 text-center hover:border-emerald-500 hover:bg-emerald-50/30"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onDrop(kind, e.dataTransfer.files);
        }}
      >
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          required={required}
          onChange={(e) => onDrop(kind, e.target.files)}
        />
        <span className="font-medium text-stone-800">
          {label}
          {required ? " *" : ""}
        </span>
        <span className="mt-1 text-sm text-stone-500">{hint}</span>
        {file ? (
          <span
            className={`mt-3 rounded px-2 py-1 text-sm ring-1 ${
              file.size > UPLOAD_MAX_BYTES
                ? "bg-red-50 text-red-900 ring-red-200"
                : "bg-white text-emerald-800 ring-emerald-200"
            }`}
          >
            {file.name} ({formatMb(file.size)} MB)
          </span>
        ) : null}
      </label>
    );
  }

  const busy = phase !== "idle";

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">
        Both photos required. Maximum upload size is{" "}
        <strong>{formatUploadMb(UPLOAD_MAX_BYTES)} MB</strong> combined. Files over the limit are
        rejected immediately; slightly over may be compressed automatically before upload.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <DropZone
          label="Annotated orthophoto"
          hint="Color-coded design sketch on the drone frame"
          file={annotated}
          kind="annotated"
          required
        />
        <DropZone
          label="Clean orthophoto"
          hint="Same frame, no markings"
          file={clean}
          kind="clean"
          required
        />
      </div>
      {annotated && clean ? (
        <p className={`text-xs ${overLimit ? "text-amber-800" : "text-stone-500"}`}>
          Selected: {formatMb(annotated.size)} MB + {formatMb(clean.size)} MB ={" "}
          <strong>{formatMb(totalBytes)} MB</strong>
          {overLimit
            ? " — over the 200 MB cap; will compress on submit if possible."
            : " — within the 200 MB limit."}
        </p>
      ) : null}
      {status ? <p className="text-sm text-stone-600">{status}</p> : null}
      {phase === "uploading" && progress ? (
        <div className="space-y-2">
          <div className="h-2 overflow-hidden rounded-full bg-stone-200">
            <div
              className="h-full bg-emerald-600 transition-all duration-150"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <p className="text-xs text-stone-500">
            {progress.total > 0
              ? `${formatMb(progress.loaded)} / ${formatMb(progress.total)} MB (${Math.round(progress.percent)}%)`
              : `${formatMb(progress.loaded)} MB sent…`}
          </p>
        </div>
      ) : null}
      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !annotated || !clean}
          onClick={submit}
          className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {phase === "optimizing"
            ? "Optimizing…"
            : phase === "uploading"
              ? "Uploading…"
              : "Create project & continue"}
        </button>
        {phase === "uploading" ? (
          <button
            type="button"
            onClick={cancelUpload}
            className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm text-stone-700"
          >
            Cancel upload
          </button>
        ) : null}
      </div>
    </div>
  );
}
