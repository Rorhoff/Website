import fs from "fs/promises";
import path from "path";
import type { LegendEntry } from "@/config/legend";
import {
  ProjectSchema,
  type Project,
  type ProjectSummary,
} from "@/lib/project-schema";
import { isProjectScaled } from "@/lib/georef";
import type { StorageProvider } from "./types";

const PROJECT_JSON = "project.json";
const LEGEND_OVERRIDES = "legend-overrides.json";

export class LocalStorageProvider implements StorageProvider {
  constructor(private rootDir: string) {}

  private projectDir(id: string) {
    return path.join(this.rootDir, id);
  }

  private projectJsonPath(id: string) {
    return path.join(this.projectDir(id), PROJECT_JSON);
  }

  async ensureRoot() {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  async listProjects(): Promise<ProjectSummary[]> {
    await this.ensureRoot();
    let entries: string[];
    try {
      entries = await fs.readdir(this.rootDir);
    } catch {
      return [];
    }
    const summaries: ProjectSummary[] = [];
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const p = await this.loadProject(entry);
      if (!p) continue;
      summaries.push({
        id: p.id,
        projectTitle: p.metadata.projectTitle || "Untitled project",
        clientName: p.metadata.clientName,
        updatedAt: p.updatedAt,
        hasAnnotated: !!p.images.annotated,
        hasWebodm: !!p.webodm,
        calibrated: isProjectScaled(p),
      });
    }
    summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return summaries;
  }

  async loadProject(id: string): Promise<Project | null> {
    try {
      const raw = await fs.readFile(this.projectJsonPath(id), "utf8");
      return ProjectSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async saveProject(project: Project): Promise<void> {
    await fs.mkdir(this.projectDir(project.id), { recursive: true });
    const parsed = ProjectSchema.parse(project);
    await fs.writeFile(
      this.projectJsonPath(project.id),
      JSON.stringify(parsed, null, 2),
      "utf8"
    );
  }

  async deleteProject(id: string): Promise<void> {
    await fs.rm(this.projectDir(id), { recursive: true, force: true });
  }

  async saveProjectFile(
    projectId: string,
    filename: string,
    data: Buffer
  ): Promise<void> {
    const safe = path.basename(filename);
    await fs.mkdir(this.projectDir(projectId), { recursive: true });
    await fs.writeFile(path.join(this.projectDir(projectId), safe), data);
  }

  async readProjectFile(
    projectId: string,
    filename: string
  ): Promise<Buffer | null> {
    try {
      return await fs.readFile(
        path.join(this.projectDir(projectId), path.basename(filename))
      );
    } catch {
      return null;
    }
  }

  async projectFileExists(projectId: string, filename: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.projectDir(projectId), path.basename(filename)));
      return true;
    } catch {
      return false;
    }
  }

  private legendOverridesPath() {
    return path.join(this.rootDir, LEGEND_OVERRIDES);
  }

  async getLegendOverrides(): Promise<LegendEntry[] | null> {
    try {
      const raw = await fs.readFile(this.legendOverridesPath(), "utf8");
      return JSON.parse(raw) as LegendEntry[];
    } catch {
      return null;
    }
  }

  async saveLegendOverrides(entries: LegendEntry[]): Promise<void> {
    await this.ensureRoot();
    await fs.writeFile(
      this.legendOverridesPath(),
      JSON.stringify(entries, null, 2),
      "utf8"
    );
  }
}
