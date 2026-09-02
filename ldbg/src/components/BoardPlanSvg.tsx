import type { LegendEntry } from "@/config/legend";
import type { GeorefDisplayContext } from "@/lib/georef-display";
import { geometryRadiusPx, geometryToPxPoints } from "@/lib/feature-georef";
import { labelForFeatureType, styleForFeatureType } from "@/lib/feature-styles";
import type { InterpretFeature } from "@/lib/interpret-schema";
import { computePlanContentBounds } from "@/lib/plan-bounds";
import {
  buildCalloutsAndLegend,
  computeArchScaleLabel,
  pickScaleBarFeet,
  pxPointsAttr,
} from "@/lib/plan-layout";
import {
  formatLegendRowMeasure,
  LEGEND_ESTIMATE_DISCLAIMER,
} from "@/lib/legend-display";
import { patternUrl, PlanPatternDefs } from "@/lib/plan-patterns";
import type { PlanSettings } from "@/lib/project-schema";
import type { FeatureFillEntry } from "@/lib/feature-fill-schema";
import {
  buildFeatureFillLayers,
  ClippedFeatureFills,
} from "@/lib/plan-feature-fills";
import { PlanInkLinework } from "@/lib/plan-ink-linework";
import styles from "./board.module.css";

type PlanScale = {
  scaleLabel: string;
  scaleBarFeet: number;
  scaleBarPx: number;
};

type BoardPlanProps = {
  features: InterpretFeature[];
  legend: LegendEntry[];
  imageWidth: number;
  imageHeight: number;
  baseImageUrl?: string;
  baseImageFilter?: string;
  planSettings?: PlanSettings;
  northRotationDeg: number;
  pixelsPerFoot?: number;
  georefCtx?: GeorefDisplayContext;
  hiddenFeatureTypes?: string[];
  featureFills?: Record<string, FeatureFillEntry>;
  featureFillImageUrl?: (filename: string) => string;
  /** When true, show the full orthophoto frame instead of cropping to feature bounds. */
  fullFrame?: boolean;
  /** Compact inset for Materials panel — crop to design, no callouts or north arrow. */
  previewMode?: boolean;
};

type BoardPlanLegendProps = Omit<
  BoardPlanProps,
  "baseImageUrl" | "planSettings" | "northRotationDeg" | "baseImageFilter" | "featureFills" | "featureFillImageUrl" | "fullFrame"
> & {
  /** Manual calibration reference distance (ft) for ±1 ft area band. */
  calibrationDistanceFeet?: number;
};

function isTreeType(featureType: string): boolean {
  return featureType === "tree" || featureType === "tree_specimen";
}

function isHouseExisting(f: InterpretFeature): boolean {
  return (
    f.existing &&
    (f.featureType.includes("house") ||
      f.featureType.includes("roof") ||
      f.featureType === "existing_house")
  );
}

function renderFeature(
  f: InterpretFeature,
  legend: LegendEntry[],
  w: number,
  h: number,
  georefCtx?: GeorefDisplayContext
) {
  const style = styleForFeatureType(f.featureType, legend, f.existing);
  const stroke = style.stroke;
  const strokeWidth = f.existing ? Math.max(0.75, style.strokeWidth ?? 1) : (style.strokeWidth ?? 1.5);
  const fillBase = style.fill;
  const opacity = style.opacity;
  const pat = patternUrl(style.patternId);
  const pxPts = geometryToPxPoints(f, w, h, georefCtx);

  if (!f.existing && (f.geometry.kind === "point" || isTreeType(f.featureType))) {
    const c = pxPts[0] ?? { x: w / 2, y: h / 2 };
    const r = geometryRadiusPx(f, w, h, georefCtx) ?? 0.025 * Math.max(w, h);
    return (
      <g key={f.id} opacity={opacity}>
        <circle cx={c.x} cy={c.y} r={r} fill="url(#tree-canopy-gradient)" stroke={stroke} strokeWidth={strokeWidth} />
        <circle cx={c.x} cy={c.y} r={Math.max(2, r * 0.08)} fill="#4a3520" />
      </g>
    );
  }

  if (f.existing && (f.geometry.kind === "point" || isTreeType(f.featureType))) {
    const c = pxPts[0] ?? { x: w / 2, y: h / 2 };
    const r = geometryRadiusPx(f, w, h, georefCtx) ?? 0.015 * Math.max(w, h);
    return (
      <g key={f.id} opacity={opacity}>
        <circle cx={c.x} cy={c.y} r={r} fill={pat ?? fillBase} stroke={stroke} strokeWidth={strokeWidth} />
      </g>
    );
  }

  if (f.geometry.kind === "polyline") {
    return (
      <polyline
        key={f.id}
        points={pxPointsAttr(pxPts)}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        opacity={opacity}
      />
    );
  }

  return (
    <polygon
      key={f.id}
      points={pxPointsAttr(pxPts)}
      fill={pat ?? fillBase}
      stroke={stroke}
      strokeWidth={strokeWidth}
      opacity={opacity}
    />
  );
}

function NorthArrow({ x, y, size, rotationDeg }: { x: number; y: number; size: number; rotationDeg: number }) {
  return (
    <g transform={`translate(${x}, ${y}) rotate(${rotationDeg})`}>
      <circle cx={0} cy={0} r={size * 0.55} fill="white" stroke="#334155" strokeWidth={1.5} />
      <path
        d={`M0 ${-size * 0.42} L${size * 0.22} ${size * 0.28} L0 ${size * 0.12} L${-size * 0.22} ${size * 0.28} Z`}
        fill="#334155"
      />
      <text y={-size * 0.55} textAnchor="middle" fontSize={size * 0.35} fontWeight="700" fill="#334155" fontFamily="system-ui,sans-serif">
        N
      </text>
    </g>
  );
}

export function computeBoardPlanScale(
  features: InterpretFeature[],
  imageWidth: number,
  imageHeight: number,
  planPanelWidthPx: number,
  pixelsPerFoot?: number,
  georefCtx?: GeorefDisplayContext,
  hiddenFeatureTypes: string[] = []
): PlanScale {
  const visible = features.filter((f) => !hiddenFeatureTypes.includes(f.featureType));
  const design = visible.filter((f) => !f.existing);
  const bounds = computePlanContentBounds(design, imageWidth, imageHeight, georefCtx);
  if (!pixelsPerFoot || pixelsPerFoot <= 0) {
    return { scaleLabel: "Scale N/A", scaleBarFeet: 20, scaleBarPx: planPanelWidthPx * 0.12 };
  }
  const scaleBarFeet = pickScaleBarFeet(bounds.width, pixelsPerFoot, bounds.width * 0.22);
  const scaleBarPx = scaleBarFeet * pixelsPerFoot;
  const scaleLabel = computeArchScaleLabel(bounds.width, pixelsPerFoot, planPanelWidthPx, 100);
  const displayBarPx = (scaleBarPx / bounds.width) * planPanelWidthPx * 0.85;
  return { scaleLabel, scaleBarFeet, scaleBarPx: displayBarPx };
}

export function BoardPlanSvg({
  features,
  legend,
  imageWidth,
  imageHeight,
  baseImageUrl,
  baseImageFilter,
  planSettings,
  northRotationDeg,
  pixelsPerFoot,
  georefCtx,
  hiddenFeatureTypes = [],
  featureFills,
  featureFillImageUrl,
  fullFrame = true,
  previewMode = false,
}: BoardPlanProps) {
  const baseMode = planSettings?.baseMode ?? "orthophoto";
  const orthoOpacity = planSettings?.orthophotoOpacity ?? 0.4;
  const useFullFrame = previewMode ? false : fullFrame;

  const visibleFeatures = features.filter((f) => !hiddenFeatureTypes.includes(f.featureType));
  const designFeatures = visibleFeatures.filter((f) => !f.existing);
  const existingFeatures = visibleFeatures.filter((f) => f.existing);

  const planFeaturesForBounds = (() => {
    const list = [...designFeatures];
    if (baseMode === "orthophoto") list.push(...existingFeatures);
    else if (baseMode === "white") list.push(...existingFeatures.filter(isHouseExisting));
    return list;
  })();

  const bounds = useFullFrame
    ? { x: 0, y: 0, width: imageWidth, height: imageHeight }
    : computePlanContentBounds(planFeaturesForBounds, imageWidth, imageHeight, georefCtx);
  const planSpan = useFullFrame
    ? Math.min(imageWidth, imageHeight)
    : Math.min(bounds.width, bounds.height);
  const { callouts } = previewMode
    ? { callouts: [] as ReturnType<typeof buildCalloutsAndLegend>["callouts"] }
    : buildCalloutsAndLegend(
        designFeatures,
        legend,
        imageWidth,
        imageHeight,
        pixelsPerFoot,
        { georefCtx, planSpanPx: planSpan }
      );

  const northSize = planSpan * 0.08;
  const northX = useFullFrame
    ? imageWidth - northSize * 0.9
    : bounds.x + bounds.width - northSize * 0.8;
  const northY = useFullFrame ? northSize * 1.1 : bounds.y + northSize * 0.9;

  const filledFeatureIds = new Set<string>();
  if (featureFills) {
    for (const [id, entry] of Object.entries(featureFills)) {
      if (entry.status === "filled" && entry.imageFilename) filledFeatureIds.add(id);
    }
  }

  const fillLayers =
    featureFills && featureFillImageUrl
      ? buildFeatureFillLayers(designFeatures, featureFills, featureFillImageUrl)
      : [];

  const showOutlines = planSettings?.showFeatureOutlines ?? true;
  const showInk = planSettings?.showInkLinework ?? true;
  const baseOpacity =
    baseImageFilter || planSettings?.basePreset !== "off" ? 1 : orthoOpacity;

  return (
    <svg
      viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Proposed landscape plan"
    >
      <PlanPatternDefs />
      {baseMode === "orthophoto" && baseImageUrl ? (
        <image
          href={baseImageUrl}
          x={0}
          y={0}
          width={imageWidth}
          height={imageHeight}
          opacity={baseOpacity}
          filter={baseImageFilter}
        />
      ) : (
        <rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} fill="#ffffff" stroke="#e7e5e4" strokeWidth={1} />
      )}

      {baseMode === "white"
        ? existingFeatures.filter(isHouseExisting).map((f) => renderFeature(f, legend, imageWidth, imageHeight, georefCtx))
        : null}
      {baseMode === "orthophoto"
        ? existingFeatures.map((f) => renderFeature(f, legend, imageWidth, imageHeight, georefCtx))
        : null}
      {designFeatures
        .filter((f) => !filledFeatureIds.has(f.id))
        .map((f) => renderFeature(f, legend, imageWidth, imageHeight, georefCtx))}

      <ClippedFeatureFills
        features={designFeatures}
        layers={fillLayers}
        imageW={imageWidth}
        imageH={imageHeight}
        georefCtx={georefCtx}
        showOutlines={showOutlines}
        fitScale={1}
      />

      {showInk ? (
        <PlanInkLinework
          features={visibleFeatures}
          imageW={imageWidth}
          imageH={imageHeight}
          georefCtx={georefCtx}
          spanPx={bounds.width}
        />
      ) : null}

      {!previewMode
        ? callouts.map((c) => (
            <g key={c.featureId}>
              <circle cx={c.x} cy={c.y} r={c.radiusPx} fill="#1c1917" stroke="#fff" strokeWidth={1.25} />
              <text
                x={c.x}
                y={c.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#fff"
                fontSize={c.radiusPx * 0.88}
                fontWeight="700"
                fontFamily="system-ui,sans-serif"
              >
                {c.number}
              </text>
            </g>
          ))
        : null}

      {!previewMode ? (
        <NorthArrow x={northX} y={northY} size={northSize} rotationDeg={northRotationDeg} />
      ) : null}
    </svg>
  );
}

export function BoardPlanLegend({
  features,
  legend,
  imageWidth,
  imageHeight,
  pixelsPerFoot,
  georefCtx,
  hiddenFeatureTypes = [],
  calibrationDistanceFeet,
}: BoardPlanLegendProps) {
  const designFeatures = features.filter(
    (f) => !f.existing && !hiddenFeatureTypes.includes(f.featureType)
  );
  const { legendRows } = buildCalloutsAndLegend(
    designFeatures,
    legend,
    imageWidth,
    imageHeight,
    pixelsPerFoot,
    { georefCtx }
  );

  return (
    <>
      <div className={styles.legendTitle}>Legend</div>
      {legendRows.length === 0 ? (
        <p style={{ fontSize: 10, color: "#78716c" }}>No design features</p>
      ) : (
        legendRows.map((row) => {
          const typeLabel = labelForFeatureType(row.featureType, legend);
          const measure = formatLegendRowMeasure(row, legend, {
            calibrationDistanceFeet,
          });
          return (
            <div key={row.featureId} className={styles.legendRow}>
              <span className={styles.legendNum}>{row.number}</span>
              <span className={styles.legendText}>
                {row.label || typeLabel}
                {measure}
              </span>
            </div>
          );
        })
      )}
      <p className={styles.legendDisclaimer}>{LEGEND_ESTIMATE_DISCLAIMER}</p>
    </>
  );
}
