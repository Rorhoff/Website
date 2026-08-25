import type { Project } from "@/lib/project-schema";

export function getWebodmStoredPath(project: Project, key: string): string | undefined {
  return project.webodm?.checklist.find((c) => c.key === key && c.found)?.storedAs;
}

export function projectHasDtm(project: Project): boolean {
  return !!getWebodmStoredPath(project, "dtm");
}
