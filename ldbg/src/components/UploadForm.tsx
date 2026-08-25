"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { withBasePath } from "@/lib/paths";
import {
  UPLOAD_SAFE_COMBINED_BYTES,
  compressOrthophotoForUpload,
  formatMb,
} from "@/lib/resize-orthophoto";

export function UploadForm() {
  const router = useRouter();
  const [annotated, setAnnotated] = useState<File | null>(null);
  const [clean, setClean] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const totalBytes = useMemo(
    () => (annotated?.size ?? 0) + (clean?.size ?? 0),
    [annotated, clean]
  );

  const onDrop = useCallback(
    (kind: "annotated" | "clean", files: FileList | null) => {
      const f = files?.[0];
      if (!f || !f.type.startsWith("image/")) return;
      if (kind === "annotated") setAnnotated(f);
      else setClean(f);
      setError("");
    },
    []
  );

  async function submit() {
    if (!annotated) {
      setError("Annotated orthophoto is required.");
      return;
    }
    if (!clean) {
      setError("Clean orthophoto is required — upload the same frame without markings.");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    try {
      setStatus(
        `Optimizing annotated (${formatMb(annotated.size)} MB)… desktop full-size files are resized like mobile uploads.`
      );
      const annBudget = Math.floor(UPLOAD_SAFE_COMBINED_BYTES * 0.45);
      const ann = await compressOrthophotoForUpload(annotated, {
        maxBytes: annBudget,
      });

      setStatus(
        `Optimizing clean (${formatMb(clean.size)} MB) → target under ${formatMb(UPLOAD_SAFE_COMBINED_BYTES)} MB combined…`
      );
      const cleanBudget = UPLOAD_SAFE_COMBINED_BYTES - ann.file.size;
      const cl = await compressOrthophotoForUpload(clean, {
        maxBytes: cleanBudget,
      });

      const combined = ann.file.size + cl.file.size;
      setStatus(
        `Ready: ${formatMb(ann.originalBytes)}+${formatMb(cl.originalBytes)} MB → ${formatMb(combined)} MB (${ann.width}×${ann.height}). Uploading…`
      );

      const createRes = await fetch(withBasePath("/api/projects"), { method: "POST" });
      if (!createRes.ok) throw new Error("Could not create project");
      const project = await createRes.json();

      const fd = new FormData();
      fd.set("annotated", ann.file);
      fd.set("annotatedWidth", String(ann.width));
      fd.set("annotatedHeight", String(ann.height));
      fd.set("clean", cl.file);
      fd.set("cleanWidth", String(cl.width));
      fd.set("cleanHeight", String(cl.height));

      const up = await fetch(withBasePath(`/api/projects/${project.id}/upload`), {
        method: "POST",
        body: fd,
      });
      if (!up.ok) {
        const err = await up.json().catch(() => ({}));
        if (up.status === 413) {
          throw new Error(
            `Server rejected ${formatMb(combined)} MB (413). Run on EC2: sudo cp ~/Website/deploy/nginx-rorhoff.conf /etc/nginx/sites-available/rorhoff.conf && sudo nginx -t && sudo systemctl reload nginx — then ~/commit.sh`
          );
        }
        throw new Error(err.error ?? "Upload failed");
      }
      router.push(`/projects/${project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
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
          <span className="mt-3 rounded bg-white px-2 py-1 text-sm text-emerald-800 ring-1 ring-emerald-200">
            {file.name} ({formatMb(file.size)} MB)
          </span>
        ) : null}
      </label>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">
        Both photos required. Email/desktop full-size files (often 20–50 MB each) are auto-resized
        before upload — same as when you pick from a phone gallery.
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
        <p className="text-xs text-amber-800">
          Selected: {formatMb(annotated.size)} MB + {formatMb(clean.size)} MB ={" "}
          <strong>{formatMb(totalBytes)} MB</strong>
          {totalBytes > UPLOAD_SAFE_COMBINED_BYTES
            ? " — will shrink before upload (your 23 MB clean ortho is normal from email)."
            : null}
        </p>
      ) : null}
      {status ? (
        <p className="text-sm text-stone-600">{status}</p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}
      <button
        type="button"
        disabled={busy || !annotated || !clean}
        onClick={submit}
        className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Optimizing & uploading…" : "Create project & continue"}
      </button>
    </div>
  );
}
