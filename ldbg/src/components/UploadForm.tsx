"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { readImageDimensions } from "@/lib/image-utils";
import { withBasePath } from "@/lib/paths";

/** Keep in sync with nginx `client_max_body_size` for /ldbg (deploy/nginx-rorhoff.conf). */
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export function UploadForm() {
  const router = useRouter();
  const [annotated, setAnnotated] = useState<File | null>(null);
  const [clean, setClean] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    setError("");
    try {
      if (totalBytes > MAX_UPLOAD_BYTES) {
        throw new Error(
          `Combined upload is ${formatMb(totalBytes)} MB — limit is ${formatMb(MAX_UPLOAD_BYTES)} MB. Export smaller JPEGs from your drone app.`
        );
      }
      const createRes = await fetch(withBasePath("/api/projects"), { method: "POST" });
      if (!createRes.ok) throw new Error("Could not create project");
      const project = await createRes.json();
      const annDim = await readImageDimensions(annotated);
      const fd = new FormData();
      fd.set("annotated", annotated);
      fd.set("annotatedWidth", String(annDim.width));
      fd.set("annotatedHeight", String(annDim.height));
      if (clean) {
        const cleanDim = await readImageDimensions(clean);
        fd.set("clean", clean);
        fd.set("cleanWidth", String(cleanDim.width));
        fd.set("cleanHeight", String(cleanDim.height));
      }
      const up = await fetch(withBasePath(`/api/projects/${project.id}/upload`), {
        method: "POST",
        body: fd,
      });
      if (!up.ok) {
        const err = await up.json().catch(() => ({}));
        if (up.status === 413) {
          throw new Error(
            `Upload too large (${formatMb(totalBytes)} MB combined). Server limit is ${formatMb(MAX_UPLOAD_BYTES)} MB — if this persists after deploy, run: sudo nginx -t && sudo systemctl reload nginx on the server.`
          );
        }
        throw new Error(err.error ?? "Upload failed");
      }
      router.push(`/projects/${project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
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
      <div className="grid gap-4 md:grid-cols-2">
        <DropZone
          label="Annotated orthophoto"
          hint="Drag & drop or click — your color-coded design sketch"
          file={annotated}
          kind="annotated"
          required
        />
        <DropZone
          label="Clean orthophoto"
          hint="Same frame, no markings (strongly recommended)"
          file={clean}
          kind="clean"
        />
      </div>
      {annotated || clean ? (
        <p className="text-xs text-stone-500">
          Combined size: {formatMb(totalBytes)} MB (max {formatMb(MAX_UPLOAD_BYTES)} MB)
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}
      <button
        type="button"
        disabled={busy || !annotated}
        onClick={submit}
        className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Uploading…" : "Create project & continue"}
      </button>
    </div>
  );
}
