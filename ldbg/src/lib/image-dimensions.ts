import type { Project } from "@/lib/project-schema";

export type ImageDimensionRecord = {
  width: number;
  height: number;
  aspectRatio: number;
};

export function aspectRatio(width: number, height: number): number {
  if (!width || !height) return 0;
  return width / height;
}

export function formatDimensions(width: number, height: number): string {
  return `${width}×${height}px`;
}

export function formatAspectRatio(width: number, height: number): string {
  const ar = aspectRatio(width, height);
  return ar > 0 ? ar.toFixed(4) : "—";
}

export function toDimensionRecord(width: number, height: number): ImageDimensionRecord {
  return { width, height, aspectRatio: aspectRatio(width, height) };
}

export function logImageIngestDiagnostic(
  context: string,
  label: string,
  width: number,
  height: number
): void {
  console.info(
    `[image-ingest] ${context} ${label}: ${formatDimensions(width, height)} aspect=${formatAspectRatio(width, height)}`
  );
}

export function dimensionMismatchError(
  label: string,
  expected: ImageDimensionRecord,
  actual: ImageDimensionRecord,
  extra?: string
): string {
  const parts = [
    `${label} dimension mismatch.`,
    `Expected ${formatDimensions(expected.width, expected.height)} (aspect ${formatAspectRatio(expected.width, expected.height)}).`,
    `Got ${formatDimensions(actual.width, actual.height)} (aspect ${formatAspectRatio(actual.width, actual.height)}).`,
  ];
  if (extra) parts.push(extra);
  return parts.join(" ");
}

export type RegistrationDiagnostics = {
  annotated?: ImageDimensionRecord & { filename?: string };
  clean?: ImageDimensionRecord & { filename?: string };
  annotationBase?: ImageDimensionRecord;
  fullOrtho?: ImageDimensionRecord;
  annotatedMatchesBase: boolean | null;
  annotatedMatchesClean: boolean | null;
  cleanMatchesFullOrtho: boolean | null;
  interpretCoordSpace?: {
    coordWidth: number;
    coordHeight: number;
    sentWidth: number;
    sentHeight: number;
    downscaleFactor: number;
  };
};

export function buildRegistrationDiagnostics(project: Project): RegistrationDiagnostics {
  const ann = project.images.annotated;
  const clean = project.images.clean ?? project.images.preview;
  const base = project.annotationBase;
  const full =
    project.tilePyramid != null
      ? {
          width: project.tilePyramid.fullWidthPx,
          height: project.tilePyramid.fullHeightPx,
        }
      : project.georeference != null
        ? {
            width: project.georeference.widthPx,
            height: project.georeference.heightPx,
          }
        : undefined;

  const annotatedMatchesBase =
    ann && base ? ann.width === base.width && ann.height === base.height : null;
  const annotatedMatchesClean =
    ann && clean ? ann.width === clean.width && ann.height === clean.height : null;
  const cleanMatchesFullOrtho =
    clean && full ? clean.width === full.width && clean.height === full.height : null;

  const interpret = project.interpretation;
  const interpretCoordSpace =
    interpret?.interpretImageSpace != null
      ? {
          coordWidth: interpret.interpretImageSpace.coordWidth,
          coordHeight: interpret.interpretImageSpace.coordHeight,
          sentWidth: interpret.interpretImageSpace.sentWidth,
          sentHeight: interpret.interpretImageSpace.sentHeight,
          downscaleFactor: interpret.interpretImageSpace.downscaleFactor,
        }
      : interpret?.downscaleFactor != null && interpret.imageSize
        ? {
            coordWidth: interpret.imageSize.width,
            coordHeight: interpret.imageSize.height,
            sentWidth: Math.round(
              interpret.imageSize.width / (interpret.downscaleFactor || 1)
            ),
            sentHeight: Math.round(
              interpret.imageSize.height / (interpret.downscaleFactor || 1)
            ),
            downscaleFactor: interpret.downscaleFactor,
          }
        : undefined;

  return {
    annotated: ann
      ? { ...toDimensionRecord(ann.width, ann.height), filename: ann.filename }
      : undefined,
    clean: clean
      ? { ...toDimensionRecord(clean.width, clean.height), filename: clean.filename }
      : undefined,
    annotationBase: base ? toDimensionRecord(base.width, base.height) : undefined,
    fullOrtho: full ? toDimensionRecord(full.width, full.height) : undefined,
    annotatedMatchesBase,
    annotatedMatchesClean,
    cleanMatchesFullOrtho,
    interpretCoordSpace,
  };
}
