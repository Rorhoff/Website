import type { LegendEntry } from "@/config/legend";
import {
  convertFeaturesToProjected,
  isProjectedGeometry,
} from "@/lib/feature-georef";
import { getGeorefDisplayContext } from "@/lib/georef-display";
import { isGeoreferenced } from "@/lib/georef";
import { metersToFeet, type ProjectedPoint } from "@/lib/georef-transform";
import type { InterpretFeature } from "@/lib/interpret-schema";
import type { Project } from "@/lib/project-schema";
import { labelForFeatureType } from "@/lib/feature-styles";

export type ExportPointFeet = { x: number; y: number; z?: number };
export type ExportPointMeters = ProjectedPoint;

export type ExportFeature = {
  id: string;
  featureType: string;
  label: string;
  existing: boolean;
  kind: "polygon" | "point" | "polyline";
  coordinatesMeters: ExportPointMeters[];
  coordinatesFeet: ExportPointFeet[];
  radiusMeters?: number;
  radiusFeet?: number;
};

export type GeometryExportContext = {
  crs: string;
  epsg?: number;
  features: ExportFeature[];
  projectTitle: string;
};

export function resolveProjectFeatures(project: Project): InterpretFeature[] {
  return project.features?.length
    ? project.features
    : project.interpretation?.features ?? [];
}

export function buildGeometryExportContext(
  project: Project,
  legend: LegendEntry[],
  features?: InterpretFeature[]
): { context: GeometryExportContext } | { error: string } {
  if (!isGeoreferenced(project) || !project.georeference) {
    return {
      error: "Geometry export requires a georeferenced WebODM project.",
    };
  }

  const source = features ?? resolveProjectFeatures(project);
  if (!source.length) {
    return { error: "Project has no features to export." };
  }

  const imageW =
    project.images.annotated?.width ??
    project.images.preview?.width ??
    project.georeference.widthPx;
  const imageH =
    project.images.annotated?.height ??
    project.images.preview?.height ??
    project.georeference.heightPx;

  const georefCtx = getGeorefDisplayContext(project, imageW, imageH);
  if (!georefCtx) {
    return { error: "Could not build georeference display context." };
  }

  const projected = convertFeaturesToProjected(source, imageW, imageH, georefCtx);

  const exportFeatures: ExportFeature[] = [];
  for (const feature of projected) {
    if (!isProjectedGeometry(feature.geometry)) continue;

    const coordinatesMeters = feature.geometry.coordinates.map((c) => ({
      x: c.x,
      y: c.y,
      z: c.z,
    }));

    const coordinatesFeet = coordinatesMeters.map((c) => ({
      x: metersToFeet(c.x),
      y: metersToFeet(c.y),
      z: c.z != null ? metersToFeet(c.z) : undefined,
    }));

    exportFeatures.push({
      id: feature.id,
      featureType: feature.featureType,
      label: feature.label || labelForFeatureType(feature.featureType, legend),
      existing: feature.existing,
      kind: feature.geometry.kind,
      coordinatesMeters,
      coordinatesFeet,
      radiusMeters: feature.geometry.radius,
      radiusFeet:
        feature.geometry.radius != null
          ? metersToFeet(feature.geometry.radius)
          : undefined,
    });
  }

  if (!exportFeatures.length) {
    return { error: "No georeferenced features available for export." };
  }

  return {
    context: {
      crs: project.georeference.crs,
      epsg: project.georeference.epsg,
      features: exportFeatures,
      projectTitle: project.metadata.projectTitle || project.id.slice(0, 8),
    },
  };
}
