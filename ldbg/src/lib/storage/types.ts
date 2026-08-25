import type { Project, ProjectSummary } from "@/lib/project-schema";
import type { LegendEntry } from "@/config/legend";

export interface StorageProvider {
  listProjects(): Promise<ProjectSummary[]>;
  loadProject(id: string): Promise<Project | null>;
  saveProject(project: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;
  saveProjectFile(projectId: string, filename: string, data: Buffer): Promise<void>;
  readProjectFile(projectId: string, filename: string): Promise<Buffer | null>;
  projectFileExists(projectId: string, filename: string): Promise<boolean>;
  getLegendOverrides(): Promise<LegendEntry[] | null>;
  saveLegendOverrides(entries: LegendEntry[]): Promise<void>;
}
