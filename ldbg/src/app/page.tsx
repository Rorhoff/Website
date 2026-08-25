import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { ProjectList } from "@/components/ProjectList";
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
        <ProjectList initialProjects={projects} />
      </main>
    </>
  );
}
