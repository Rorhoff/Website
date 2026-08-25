import type { Project } from "@/lib/project-schema";

/** Meters per pixel → pixels per foot (derived from affine GSD). */
export function pixelsPerFootFromGsdMeters(gsdMeters: number): number {
  const metersPerFoot = 0.3048;
  return metersPerFoot / gsdMeters;
}

export function getPixelsPerFoot(project: Project): number | undefined {
  const ann = project.images.annotated;
  const base = project.annotationBase;
  if (
    base &&
    ann &&
    ann.width === base.width &&
    ann.height === base.height
  ) {
    return base.pixelsPerFoot;
  }
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

/** Full-resolution orthophoto pixel dimensions (WebODM / tile pyramid). */
export function getFullOrthoDimensions(
  project: Project
): { width: number; height: number } | undefined {
  if (project.tilePyramid) {
    return {
      width: project.tilePyramid.fullWidthPx,
      height: project.tilePyramid.fullHeightPx,
    };
  }
  if (project.georeference) {
    return {
      width: project.georeference.widthPx,
      height: project.georeference.heightPx,
    };
  }
  return undefined;
}

/** Higher-resolution ortho for board print export when available. */
export function getPrintBoardImage(project: Project):
  | { filename: string; width: number; height: number }
  | undefined {
  if (project.printOrtho) {
    return {
      filename: project.printOrtho.filename,
      width: project.printOrtho.width,
      height: project.printOrtho.height,
    };
  }
  return getDisplayImage(project);
}

/** North rotation for plan arrow — georeferenced projects use map north (0°). */
export function getNorthRotationDeg(project: Project): number {
  if (project.georeference) return 0;
  return project.northRotationDeg ?? 0;
}
