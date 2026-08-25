import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { getStorage } from "@/lib/storage";

export default async function HomePage() {
  const projects = await getStorage().listProjects();

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-stone-900">Projects</h2>
            <p className="text-stone-600">
              WebODM georeferenced orthophotos or legacy JPEG uploads — then build design boards.
            </p>
          </div>
          <Link
            href="/projects/new"
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white"
          >
            New project
          </Link>
        </div>
        {projects.length === 0 ? (
          <p className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-stone-500">
            No projects yet.{" "}
            <Link href="/projects/new" className="text-emerald-700 underline">
              Create your first project
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-stone-50"
                >
                  <div>
                    <p className="font-medium text-stone-900">
                      {p.projectTitle || "Untitled project"}
                    </p>
                    <p className="text-sm text-stone-500">
                      {p.clientName || "No client"} · updated{" "}
                      {new Date(p.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-2 text-xs">
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
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
