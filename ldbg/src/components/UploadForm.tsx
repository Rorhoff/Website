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
  compressOrthophotoForUpload,
  formatMb,
  needsServerDecode,
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
  // Whatever is in the slots is the project. No mode to pick: one photo, the
  // other, or both are all valid starting points and the server takes any of them.
  const canSubmit = Boolean(annotated || clean);

  const validateFile = useCallback((f: File, label: string) => {
    if (f.size > UPLOAD_MAX_BYTES) {
      return uploadPreflightError(f.size, label);
    }
    return null;
  }, []);

  const onDrop = useCallback(
    (kind: "annotated" | "clean", files: FileList | null) => {
      const f = files?.[0];
      // A .tif often arrives with an empty type, so fall back to the extension.
      if (!f || !(f.type.startsWith("image/") || needsServerDecode(f))) return;
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

  const onClear = useCallback((kind: "annotated" | "clean") => {
    if (kind === "annotated") setAnnotated(null);
    else setClean(null);
    setError("");
  }, []);

  function cancelUpload() {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
    setProgress(null);
    setStatus("");
    setError("Upload cancelled.");
  }

  async function submit() {
    if (!annotated && !clean) {
      setError("Add an annotated orthophoto, a clean one, or both.");
      return;
    }

    if (annotated) {
      const annErr = validateFile(annotated, "Annotated orthophoto");
      if (annErr) {
        setError(annErr);
        return;
      }
    }
    if (clean) {
      const cleanErr = validateFile(clean, "Clean orthophoto");
      if (cleanErr) {
        setError(cleanErr);
        return;
      }
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

      let ann: Awaited<ReturnType<typeof compressOrthophotoForUpload>> | null = null;
      let cl: Awaited<ReturnType<typeof compressOrthophotoForUpload>> | null = null;

      // TIFFs go up untouched: nothing here can open one, so the server does
      // the converting and the measuring.
      const rawAnnotated = annotated && needsServerDecode(annotated) ? annotated : null;
      const rawClean = clean && needsServerDecode(clean) ? clean : null;
      const localAnnotated = rawAnnotated ? null : annotated;
      const localClean = rawClean ? null : clean;

      if (localAnnotated && localClean) {
        const pair = await prepareOrthophotoPairForUpload(localAnnotated, localClean);
        ann = pair.annotated;
        cl = pair.clean;
      } else if (localAnnotated) {
        ann = await compressOrthophotoForUpload(localAnnotated);
      } else if (localClean) {
        cl = await compressOrthophotoForUpload(localClean);
      }

      if (signal.aborted) return;

      const combined =
        (ann?.file.size ?? rawAnnotated?.size ?? 0) +
        (cl?.file.size ?? rawClean?.size ?? 0);
      if (combined > UPLOAD_MAX_BYTES) {
        throw new Error(uploadPreflightError(combined, "Upload"));
      }

      setStatus("Creating project…");
      const createRes = await fetch(withBasePath("/api/projects"), {
        method: "POST",
        signal,
      });
      if (!createRes.ok) throw new Error("Could not create project");
      const project = await createRes.json();

      const fd = new FormData();
      if (rawAnnotated) fd.set("annotated", rawAnnotated);
      if (rawClean) fd.set("clean", rawClean);
      if (ann) {
        const annDim = ann.wasCompressed
          ? { width: ann.width, height: ann.height }
          : await readImageDimensions(ann.file);
        fd.set("annotated", ann.file);
        fd.set("annotatedWidth", String(annDim.width));
        fd.set("annotatedHeight", String(annDim.height));
      }
      if (cl) {
        const cleanDim = cl.wasCompressed
          ? { width: cl.width, height: cl.height }
          : await readImageDimensions(cl.file);
        fd.set("clean", cl.file);
        fd.set("cleanWidth", String(cleanDim.width));
        fd.set("cleanHeight", String(cleanDim.height));
      }

      setPhase("uploading");
      const originalBytes =
        (ann?.originalBytes ?? 0) + (cl?.originalBytes ?? 0);
      setStatus(
        ann?.wasCompressed || cl?.wasCompressed
          ? `Uploading ${formatMb(combined)} MB (compressed from ${formatMb(originalBytes)} MB)…`
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
  }: {
    label: string;
    hint: string;
    file: File | null;
    kind: "annotated" | "clean";
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
          accept="image/jpeg,image/png,image/webp,image/tiff,.tif,.tiff"
          className="hidden"
          onChange={(e) => {
            onDrop(kind, e.target.files);
            // Let the same file be re-picked after clearing it.
            e.target.value = "";
          }}
        />
        <span className="font-medium text-stone-800">{label}</span>
        <span className="mt-1 text-sm text-stone-500">{hint}</span>
        {file ? (
          <span className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <span
              className={`rounded px-2 py-1 text-sm ring-1 ${
                file.size > UPLOAD_MAX_BYTES
                  ? "bg-red-50 text-red-900 ring-red-200"
                  : "bg-white text-emerald-800 ring-emerald-200"
              }`}
            >
              {file.name} ({formatMb(file.size)} MB)
            </span>
            <button
              type="button"
              className="rounded px-2 py-1 text-xs text-stone-600 underline hover:text-stone-900"
              onClick={(e) => {
                // Sits inside the label, which would otherwise reopen the picker.
                e.preventDefault();
                e.stopPropagation();
                onClear(kind);
              }}
            >
              Remove
            </button>
          </span>
        ) : (
          <span className="mt-3 text-xs text-stone-400">Optional</span>
        )}
      </label>
    );
  }

  const busy = phase !== "idle";

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">
        Add either photo or both — whichever you drop in is what the project starts with.
        Maximum upload size is <strong>{formatUploadMb(UPLOAD_MAX_BYTES)} MB</strong> per file
        (combined when uploading both). Slightly over may be compressed automatically before
        upload.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <DropZone
          label="Annotated orthophoto"
          hint="Color-coded design sketch on the drone frame"
          file={annotated}
          kind="annotated"
        />
        <DropZone
          label="Clean orthophoto"
          hint="Same frame, no markings"
          file={clean}
          kind="clean"
        />
      </div>

      {totalBytes > 0 ? (
        <p className={`text-xs ${overLimit ? "text-amber-800" : "text-stone-500"}`}>
          Selected:{" "}
          {annotated ? `${formatMb(annotated.size)} MB annotated` : null}
          {annotated && clean ? " + " : null}
          {clean ? `${formatMb(clean.size)} MB clean` : null}
          {annotated && clean ? (
            <>
              {" "}
              = <strong>{formatMb(totalBytes)} MB</strong>
              {overLimit
                ? ` — over the ${formatUploadMb(UPLOAD_MAX_BYTES)} MB cap; will compress on submit if possible.`
                : ` — within the ${formatUploadMb(UPLOAD_MAX_BYTES)} MB limit.`}
            </>
          ) : null}
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
          disabled={busy || !canSubmit}
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
