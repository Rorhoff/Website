import type { Project } from "@/lib/project-schema";
import { getWebodmStoredPath } from "@/lib/elevation-utils";

export function projectHasMesh(project: Project): boolean {
  return !!getWebodmStoredPath(project, "mesh_obj");
}
