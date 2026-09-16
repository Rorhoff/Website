import type { ReactElement } from "react";
import type { InterpretFeature } from "@/lib/interpret-schema";
import {
  isPlanFenceFeature,
  planLineMaterialStrokeWidthPx,
  planStrokeForLineMaterial,
  PLAN_FENCE_HALO_STROKE,
} from "@/lib/feature-styles";

type LineProps = {
  key: string;
  points: string;
  strokeWidth: number;
  opacity: number;
  strokeProps?: { vectorEffect?: "non-scaling-stroke" };
};

/** Stroke-only fence / edging on the plan (not a wide gray strip). */
export function PlanLineMaterialPolyline({
  f,
  points,
  fallbackStroke,
  areaOutlineStrokeWidth,
  opacity,
  strokeProps,
}: {
  f: InterpretFeature;
  points: string;
  fallbackStroke: string;
  areaOutlineStrokeWidth: number;
  opacity: number;
  strokeProps?: LineProps["strokeProps"];
}): ReactElement {
  const stroke = planStrokeForLineMaterial(f, fallbackStroke);
  const lineW = planLineMaterialStrokeWidthPx(areaOutlineStrokeWidth);

  if (isPlanFenceFeature(f)) {
    return (
      <g key={f.id} opacity={opacity}>
        <polyline
          points={points}
          fill="none"
          stroke={PLAN_FENCE_HALO_STROKE}
          strokeWidth={lineW + 1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.45}
          {...strokeProps}
        />
        <polyline
          points={points}
          fill="none"
          stroke={stroke}
          strokeWidth={lineW}
          strokeLinecap="round"
          strokeLinejoin="round"
          {...strokeProps}
        />
      </g>
    );
  }

  return (
    <polyline
      key={f.id}
      points={points}
      fill="none"
      stroke={stroke}
      strokeWidth={lineW}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={opacity}
      {...strokeProps}
    />
  );
}
