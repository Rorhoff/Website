import fs from "fs/promises";
import path from "path";
import type { LegendEntry } from "@/config/legend";
import {
  ProjectSchema,
  type Project,
  type ProjectSummary,
} from "@/lib/project-schema";
import { isProjectScaled } from "@/lib/georef";
import { scaleVerificationPassed } from "@/lib/scale-verification";
import type { StorageProvider } from "./types";

const PROJECT_JSON = "project.json";
const LEGEND_OVERRIDES = "legend-overrides.json";
const PALETTE_OVERRIDES = "annotation-palette-overrides.json";

export class LocalStorageProvider implements StorageProvider {
  constructor(private rootDir: string) {}

  private projectDir(id: string) {
    return path.join(this.rootDir, id);
  }

  private projectJsonPath(id: string) {
    return path.join(this.projectDir(id), PROJECT_JSON);
  }

  /** Resolve a project-relative path (e.g. derived/base-….png) with traversal checks. */
  private resolveProjectFilePath(projectId: string, filename: string): string {
    const normalized = filename.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalized || normalized.includes("\0")) {
      throw new Error("Invalid project file path");
    }
    const segments = normalized.split("/").filter(Boolean);
    if (segments.some((s) => s === ".." || s === ".")) {
      throw new Error("Invalid project file path");
    }
    const abs = path.join(this.projectDir(projectId), ...segments);
    const root = this.projectDir(projectId);
    const rel = path.relative(root, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("Invalid project file path");
    }
    return abs;
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
        scaleVerified: scaleVerificationPassed(p),
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
    const filePath = this.resolveProjectFilePath(projectId, filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
  }

  async readProjectFile(
    projectId: string,
    filename: string
  ): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.resolveProjectFilePath(projectId, filename));
    } catch {
      return null;
    }
  }

  async projectFileExists(projectId: string, filename: string): Promise<boolean> {
    try {
      await fs.access(this.resolveProjectFilePath(projectId, filename));
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

  private paletteOverridesPath() {
    return path.join(this.rootDir, PALETTE_OVERRIDES);
  }

  async getPaletteOverrides(): Promise<
    import("@/lib/annotation-palette").AnnotationPaletteEntry[] | null
  > {
    try {
      const raw = await fs.readFile(this.paletteOverridesPath(), "utf8");
      return JSON.parse(raw) as import("@/lib/annotation-palette").AnnotationPaletteEntry[];
    } catch {
      return null;
    }
  }

  async savePaletteOverrides(
    entries: import("@/lib/annotation-palette").AnnotationPaletteEntry[]
  ): Promise<void> {
    await this.ensureRoot();
    await fs.writeFile(
      this.paletteOverridesPath(),
      JSON.stringify(entries, null, 2),
      "utf8"
    );
  }

  async clearPaletteOverrides(): Promise<void> {
    try {
      await fs.unlink(this.paletteOverridesPath());
    } catch {
      /* no overrides */
    }
  }
}
