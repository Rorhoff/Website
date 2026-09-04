"use client";

import { PlanDrawing } from "@/components/PlanDrawing";
import type { LegendEntry } from "@/config/legend";
import type { GeorefDisplayContext } from "@/lib/georef-display";
import type { InterpretFeature } from "@/lib/interpret-schema";
import type { FeatureFillEntry } from "@/lib/feature-fill-schema";
import type { PlanSettings, ProjectMetadata } from "@/lib/project-schema";
import styles from "./board.module.css";

type Props = {
  features: InterpretFeature[];
  legend: LegendEntry[];
  metadata: ProjectMetadata;
  imageWidth: number;
  imageHeight: number;
  baseImageUrl?: string;
  baseImageFilter?: string;
  planSettings?: PlanSettings;
  northRotationDeg: number;
  pixelsPerFoot?: number;
  georefContext?: GeorefDisplayContext;
  featureFills?: Record<string, FeatureFillEntry>;
  featureFillImageUrl?: (filename: string) => string;
};

/** Same composite as the Plan drawing panel — cropped to design features. */
export function MaterialsPlanPreview({
  features,
  legend,
  metadata,
  imageWidth,
  imageHeight,
  baseImageUrl,
  baseImageFilter,
  planSettings,
  northRotationDeg,
  pixelsPerFoot,
  georefContext,
  featureFills,
  featureFillImageUrl,
}: Props) {
  if (!baseImageUrl || features.length === 0) return null;

  return (
    <div className={styles.materialsPlanPreview}>
      <PlanDrawing
        project={{
          features,
          northRotationDeg,
          pixelsPerFoot,
          georefCtx: georefContext,
          metadata: { projectTitle: metadata.projectTitle },
        }}
        legend={legend}
        imageWidth={imageWidth}
        imageHeight={imageHeight}
        baseImageUrl={baseImageUrl}
        baseImageFilter={baseImageFilter}
        planSettings={planSettings}
        fitToContent
        displayWidth={360}
        className={styles.materialsPlanDrawing}
        featureFills={featureFills}
        featureFillImageUrl={featureFillImageUrl}
      />
    </div>
  );
}
