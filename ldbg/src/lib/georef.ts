import type { Project } from "@/lib/project-schema";

/** Meters per pixel → pixels per foot (derived from affine GSD). */
export function pixelsPerFootFromGsdMeters(gsdMeters: number): number {
  const metersPerFoot = 0.3048;
  return metersPerFoot / gsdMeters;
}

export function getPixelsPerFoot(project: Project): number | undefined {
  if (project.georeference?.pixelsPerFoot) {
    return project.georeference.pixelsPerFoot;
  }
  return project.calibration?.pixelsPerFoot;
}

export function isGeoreferenced(project: Project): boolean {
  return !!project.georeference;
}

export function isProjectScaled(project: Project): boolean {
  return getPixelsPerFoot(project) != null;
}

/** Primary raster for canvas display (preview, annotated, or legacy clean). */
export function getDisplayImage(project: Project):
  | { filename: string; width: number; height: number }
  | undefined {
  return (
    project.images.annotated ??
    project.images.preview ??
    project.images.clean
  );
}

/** North rotation for plan arrow — georeferenced projects use map north (0°). */
export function getNorthRotationDeg(project: Project): number {
  if (project.georeference) return 0;
  return project.northRotationDeg ?? 0;
}
