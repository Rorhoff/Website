"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ProjectSummary } from "@/lib/project-schema";
import { withBasePath } from "@/lib/paths";

type Props = {
  initialProjects: ProjectSummary[];
};

export function ProjectList({ initialProjects }: Props) {
  const router = useRouter();
  const [projects, setProjects] = useState(initialProjects);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function handleDelete(project: ProjectSummary) {
    const title = project.projectTitle || "Untitled project";
    const ok = window.confirm(
      `Delete "${title}"?\n\nThis permanently removes the project and all uploaded files. This cannot be undone.`
    );
    if (!ok) return;

    setError("");
    setDeletingId(project.id);
    try {
      const res = await fetch(withBasePath(`/api/projects/${project.id}`), {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Delete failed");
      }
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  if (projects.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-stone-500">
        No projects yet.{" "}
        <Link href="/projects/new" className="text-emerald-700 underline">
          Create your first project
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
        {projects.map((p) => (
          <li key={p.id} className="flex items-stretch gap-2">
            <Link
              href={`/projects/${p.id}`}
              className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-stone-50"
            >
              <div className="min-w-0">
                <p className="font-medium text-stone-900">
                  {p.projectTitle || "Untitled project"}
                </p>
                <p className="text-sm text-stone-500">
                  {p.clientName || "No client"} · updated{" "}
                  {new Date(p.updatedAt).toLocaleString()}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 text-xs">
                {p.hasWebodm ? (
                  <span className="rounded bg-sky-100 px-2 py-1 text-sky-900">WebODM</span>
                ) : null}
                {p.hasAnnotated ? (
                  <span className="rounded bg-stone-100 px-2 py-1">Annotated</span>
                ) : null}
                {p.calibrated ? (
                  <span className="rounded bg-emerald-100 px-2 py-1 text-emerald-900">
                    Scaled
                  </span>
                ) : (
                  <span className="rounded bg-amber-100 px-2 py-1 text-amber-900">
                    Needs scale
                  </span>
                )}
                {p.hasWebodm && !p.scaleVerified ? (
                  <span className="rounded bg-amber-100 px-2 py-1 text-amber-900">
                    Needs verify
                  </span>
                ) : p.scaleVerified ? (
                  <span className="rounded bg-emerald-100 px-2 py-1 text-emerald-900">
                    Verified
                  </span>
                ) : null}
              </div>
            </Link>
            <div className="flex items-center pr-3">
              <button
                type="button"
                disabled={deletingId === p.id}
                onClick={() => void handleDelete(p)}
                className="rounded-md border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:border-red-300 hover:bg-red-50 hover:text-red-800 disabled:opacity-50"
              >
                {deletingId === p.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
