import type { AffineTransform, Project } from "@/lib/project-schema";
import { annotatedMatchesAnnotationBase } from "@/lib/annotation-base-utils";
import { scaleAffine } from "@/lib/georef-transform";

export type GeorefDisplayContext = {
  crs: string;
  affine: AffineTransform;
  imageWidth: number;
  imageHeight: number;
};

export function getGeorefDisplayContext(
  project: Project,
  imageWidth: number,
  imageHeight: number
): GeorefDisplayContext | undefined {
  if (project.annotationBase && annotatedMatchesAnnotationBase(project)) {
    return {
      crs: project.annotationBase.crs ?? project.georeference?.crs ?? "EPSG:unknown",
      affine: project.annotationBase.affine,
      imageWidth,
      imageHeight,
    };
  }

  if (project.georeference) {
    const scaleX = project.georeference.widthPx / imageWidth;
    const scaleY = project.georeference.heightPx / imageHeight;
    const factor = (scaleX + scaleY) / 2;
    return {
      crs: project.georeference.crs,
      affine: scaleAffine(project.georeference.affine, factor),
      imageWidth,
      imageHeight,
    };
  }

  return undefined;
}

export function projectUsesProjectedGeometry(project: Project): boolean {
  const w =
    project.images.annotated?.width ??
    project.images.preview?.width ??
    project.georeference?.widthPx ??
    1;
  const h =
    project.images.annotated?.height ??
    project.images.preview?.height ??
    project.georeference?.heightPx ??
    1;
  return !!getGeorefDisplayContext(project, w, h);
}
