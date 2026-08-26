import { useMemo } from "react";
import type { LegendEntry } from "@/config/legend";
import type { StoredElevationAnalysis } from "@/lib/elevation-schema";
import type { GeorefDisplayContext } from "@/lib/georef-display";
import { projectedToPixel } from "@/lib/georef-transform";
import {
  geometryRadiusPx,
  geometryToPxPoints,
} from "@/lib/feature-georef";
import { labelForFeatureType, styleForFeatureType } from "@/lib/feature-styles";
import type { InterpretFeature } from "@/lib/interpret-schema";
import { computePlanContentBounds, sheetPxFromInches } from "@/lib/plan-bounds";
import {
  buildCalloutsAndLegend,
  calloutRadiusInPlanGroup,
  computeArchScaleLabel,
  pickScaleBarFeet,
  pxPointsAttr,
  SHEET_HEIGHT_PX,
  SHEET_WIDTH_PX,
  type CalloutObstacle,
} from "@/lib/plan-layout";
import { patternUrl, PlanPatternDefs } from "@/lib/plan-patterns";
import type { PlanSettings } from "@/lib/project-schema";
import type { FeatureFillEntry } from "@/lib/feature-fill-schema";
import {
  buildFeatureFillLayers,
  ClippedFeatureFills,
} from "@/lib/plan-feature-fills";

export type PlanDrawingProject = {
  features: InterpretFeature[];
  northRotationDeg: number;
  calibration?: { pixelsPerFoot: number };
  pixelsPerFoot?: number;
  georefCtx?: GeorefDisplayContext;
  elevationAnalysis?: StoredElevationAnalysis;
  editorSettings?: { hiddenFeatureTypes?: string[] };
  metadata: { projectTitle?: string };
};

type Props = {
  project: PlanDrawingProject;
  legend: LegendEntry[];
  imageWidth: number;
  imageHeight: number;
  baseImageUrl?: string;
  baseImageFilter?: string;
  planSettings?: PlanSettings;
  displayWidth?: number;
  className?: string;
  featureFills?: Record<string, FeatureFillEntry>;
  featureFillImageUrl?: (filename: string) => string;
};

const PLAN_MARGIN = 120;
const LEGEND_WIDTH = 520;
const FOOTER_H = 200;
const SHEET_DPI = 300;
const NORTH_ARROW_MAX_IN = 0.75;

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
  georefCtx?: GeorefDisplayContext,
  fitScale = 1
) {
  const style = styleForFeatureType(f.featureType, legend, f.existing);
  const stroke = style.stroke;
  const strokeWidth = f.existing
    ? Math.max(0.5, (style.strokeWidth * SHEET_DPI) / 72 / fitScale)
    : (style.strokeWidth ?? 1.5);
  const fillBase = style.fill;
  const opacity = style.opacity;
  const pat = patternUrl(style.patternId);
  const pxPts = geometryToPxPoints(f, w, h, georefCtx);
  const strokeProps = f.existing
    ? { vectorEffect: "non-scaling-stroke" as const }
    : {};

  if (!f.existing && (f.geometry.kind === "point" || isTreeType(f.featureType))) {
    const c = pxPts[0] ?? { x: w / 2, y: h / 2 };
    const r =
      geometryRadiusPx(f, w, h, georefCtx) ??
      0.025 * Math.max(w, h);
    return (
      <g key={f.id} opacity={opacity}>
        <circle
          cx={c.x}
          cy={c.y}
          r={r}
          fill="url(#tree-canopy-gradient)"
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
        <circle cx={c.x} cy={c.y} r={Math.max(3, r * 0.08)} fill="#4a3520" />
      </g>
    );
  }

  if (f.existing && (f.geometry.kind === "point" || isTreeType(f.featureType))) {
    const c = pxPts[0] ?? { x: w / 2, y: h / 2 };
    const r =
      geometryRadiusPx(f, w, h, georefCtx) ??
      0.015 * Math.max(w, h);
    return (
      <g key={f.id} opacity={opacity}>
        <circle
          cx={c.x}
          cy={c.y}
          r={r}
          fill={pat ?? fillBase}
          stroke={stroke}
          strokeWidth={strokeWidth}
          {...strokeProps}
        />
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
        {...strokeProps}
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
      {...strokeProps}
    />
  );
}

function NorthArrow({
  x,
  y,
  size,
  rotationDeg,
}: {
  x: number;
  y: number;
  size: number;
  rotationDeg: number;
}) {
  return (
    <g transform={`translate(${x}, ${y}) rotate(${rotationDeg})`}>
      <circle cx={0} cy={0} r={size * 0.55} fill="white" stroke="#334155" strokeWidth={2} />
      <path
        d={`M0 ${-size * 0.42} L${size * 0.22} ${size * 0.28} L0 ${size * 0.12} L${-size * 0.22} ${size * 0.28} Z`}
        fill="#334155"
      />
      <text
        y={-size * 0.55}
        textAnchor="middle"
        fontSize={size * 0.35}
        fontWeight="700"
        fill="#334155"
        fontFamily="system-ui, sans-serif"
      >
        N
      </text>
    </g>
  );
}

function ScaleBar({
  x,
  y,
  barPx,
  feet,
  scaleLabel,
}: {
  x: number;
  y: number;
  barPx: number;
  feet: number;
  scaleLabel: string;
}) {
  const h = 14;
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x={0} y={0} width={barPx} height={h} fill="white" stroke="#334155" strokeWidth={2} />
      <rect x={0} y={0} width={barPx / 2} height={h} fill="#334155" />
      <text
        x={barPx / 2}
        y={h + 22}
        textAnchor="middle"
        fontSize={22}
        fill="#334155"
        fontFamily="system-ui, sans-serif"
      >
        {feet} ft
      </text>
      <text
        x={barPx / 2}
        y={h + 48}
        textAnchor="middle"
        fontSize={20}
        fill="#64748b"
        fontFamily="system-ui, sans-serif"
      >
        {scaleLabel}
      </text>
    </g>
  );
}

export function PlanDrawing({
  project,
  legend,
  imageWidth,
  imageHeight,
  baseImageUrl,
  baseImageFilter,
  planSettings,
  displayWidth = 900,
  className,
  featureFills,
  featureFillImageUrl,
}: Props) {
  const baseMode = planSettings?.baseMode ?? "orthophoto";
  const orthoOpacity = planSettings?.orthophotoOpacity ?? 0.4;

  const planW = imageWidth;
  const planH = imageHeight;
  const sheetW = SHEET_WIDTH_PX;
  const sheetH = SHEET_HEIGHT_PX;
  const displayH = displayWidth * (sheetH / sheetW);

  const visibleFeatures = useMemo(() => {
    const hidden = project.editorSettings?.hiddenFeatureTypes ?? [];
    return project.features.filter((f) => !hidden.includes(f.featureType));
  }, [project.features, project.editorSettings?.hiddenFeatureTypes]);

  const designFeatures = useMemo(
    () => visibleFeatures.filter((f) => !f.existing),
    [visibleFeatures]
  );

  const existingFeatures = useMemo(
    () => visibleFeatures.filter((f) => f.existing),
    [visibleFeatures]
  );

  const pixelsPerFoot =
    project.pixelsPerFoot ?? project.calibration?.pixelsPerFoot;
  const georefCtx = project.georefCtx;
  const showContours = planSettings?.showContours ?? false;
  const showDrainage = planSettings?.showDrainageArrows ?? false;
  const elevationAnalysis = project.elevationAnalysis;

  const contourPolylines = useMemo(() => {
    if (!showContours || !georefCtx || !elevationAnalysis?.contours.length) return [];
    return elevationAnalysis.contours.map((c) => ({
      ...c,
      px: c.coordinates.map((pt) =>
        projectedToPixel(pt.x, pt.y, georefCtx.affine)
      ),
    }));
  }, [showContours, georefCtx, elevationAnalysis?.contours]);

  const drainagePx = useMemo(() => {
    if (!showDrainage || !georefCtx || !elevationAnalysis?.drainageArrows.length) {
      return [];
    }
    return elevationAnalysis.drainageArrows.map((a) => {
      const origin = projectedToPixel(a.x, a.y, georefCtx.affine);
      const len = 24;
      return {
        ...a,
        x1: origin.x,
        y1: origin.y,
        x2: origin.x + a.dx * len,
        y2: origin.y + a.dy * len,
      };
    });
  }, [showDrainage, georefCtx, elevationAnalysis?.drainageArrows]);

  const planFeaturesForBounds = useMemo(() => {
    const list = [...designFeatures];
    if (baseMode === "orthophoto") list.push(...existingFeatures);
    else if (baseMode === "white") {
      list.push(...existingFeatures.filter(isHouseExisting));
    }
    return list;
  }, [designFeatures, existingFeatures, baseMode]);

  const contentBounds = useMemo(
    () => computePlanContentBounds(planFeaturesForBounds, planW, planH, georefCtx),
    [planFeaturesForBounds, planW, planH, georefCtx]
  );

  const planAreaX = PLAN_MARGIN;
  const planAreaY = PLAN_MARGIN;
  const planAreaW = sheetW - PLAN_MARGIN * 2 - LEGEND_WIDTH - 40;
  const planAreaH = sheetH - PLAN_MARGIN * 2 - FOOTER_H;
  const fitScale = Math.min(planAreaW / contentBounds.width, planAreaH / contentBounds.height);
  const drawnW = contentBounds.width * fitScale;
  const drawnH = contentBounds.height * fitScale;
  const planOffsetX = planAreaX + (planAreaW - drawnW) / 2;
  const planOffsetY = planAreaY + (planAreaH - drawnH) / 2;

  const northArrowSheetPx = sheetPxFromInches(NORTH_ARROW_MAX_IN, SHEET_DPI);
  const northArrowSheetX = planAreaX + planAreaW - northArrowSheetPx * 0.65;
  const northArrowSheetY = planAreaY + northArrowSheetPx * 0.65;
  const northArrowPlanX =
    contentBounds.x + (northArrowSheetX - planOffsetX) / fitScale;
  const northArrowPlanY =
    contentBounds.y + (northArrowSheetY - planOffsetY) / fitScale;
  const northArrowObstacleRadius = (northArrowSheetPx * 0.55) / fitScale;

  const calloutObstacles: CalloutObstacle[] = useMemo(
    () => [
      {
        x: northArrowPlanX,
        y: northArrowPlanY,
        radius: northArrowObstacleRadius,
      },
    ],
    [northArrowPlanX, northArrowPlanY, northArrowObstacleRadius]
  );

  const calloutRImage = calloutRadiusInPlanGroup(fitScale);

  const { callouts, legendRows } = useMemo(
    () =>
      buildCalloutsAndLegend(
        designFeatures,
        legend,
        planW,
        planH,
        pixelsPerFoot,
        {
          georefCtx,
          obstacles: calloutObstacles,
          calloutRadiusPx: calloutRImage,
        }
      ),
    [designFeatures, legend, planW, planH, pixelsPerFoot, georefCtx, calloutObstacles, calloutRImage]
  );

  const scaleBarFeet =
    pixelsPerFoot != null
      ? pickScaleBarFeet(contentBounds.width, pixelsPerFoot, contentBounds.width * 0.22)
      : 20;
  const scaleBarPx =
    pixelsPerFoot != null ? scaleBarFeet * pixelsPerFoot : contentBounds.width * 0.12;
  const scaleLabel =
    pixelsPerFoot != null
      ? computeArchScaleLabel(
          contentBounds.width,
          pixelsPerFoot,
          drawnW,
          SHEET_DPI
        )
      : "Calibrate for scale";

  const legendX = sheetW - LEGEND_WIDTH - PLAN_MARGIN + 20;
  const legendY = PLAN_MARGIN + 40;

  const filledFeatureIds = useMemo(() => {
    const ids = new Set<string>();
    if (!featureFills) return ids;
    for (const [id, entry] of Object.entries(featureFills)) {
      if (entry.status === "filled" && entry.imageFilename) ids.add(id);
    }
    return ids;
  }, [featureFills]);

  const fillLayers = useMemo(() => {
    if (!featureFills || !featureFillImageUrl) return [];
    return buildFeatureFillLayers(designFeatures, featureFills, featureFillImageUrl);
  }, [designFeatures, featureFills, featureFillImageUrl]);

  const showOutlines = planSettings?.showFeatureOutlines ?? true;

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${sheetW} ${sheetH}`}
        width={displayWidth}
        height={displayH}
        className="max-w-full rounded-lg border border-stone-300 bg-white shadow-sm"
        role="img"
        aria-label={`Plan drawing: ${project.metadata.projectTitle || "landscape plan"}`}
      >
        <PlanPatternDefs />
        <defs>
          <marker
            id="drain-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6 Z" fill="#2563eb" />
          </marker>
        </defs>

        <rect x={0} y={0} width={sheetW} height={sheetH} fill="#fafaf9" />

        <text
          x={PLAN_MARGIN}
          y={PLAN_MARGIN - 20}
          fontSize={36}
          fontWeight="600"
          fill="#1c1917"
          fontFamily="system-ui, sans-serif"
        >
          {project.metadata.projectTitle || "Landscape plan"}
        </text>

        <g
          transform={`translate(${planOffsetX}, ${planOffsetY}) scale(${fitScale}) translate(${-contentBounds.x}, ${-contentBounds.y})`}
        >
          {baseMode === "orthophoto" && baseImageUrl ? (
            <image
              href={baseImageUrl}
              x={0}
              y={0}
              width={planW}
              height={planH}
              opacity={orthoOpacity}
              filter={baseImageFilter}
              preserveAspectRatio="xMidYMid meet"
            />
          ) : (
            <rect
              x={contentBounds.x}
              y={contentBounds.y}
              width={contentBounds.width}
              height={contentBounds.height}
              fill="#ffffff"
              stroke="#e7e5e4"
              strokeWidth={2}
            />
          )}

          {baseMode === "white"
            ? existingFeatures.filter(isHouseExisting).map((f) =>
                renderFeature(f, legend, planW, planH, georefCtx, fitScale)
              )
            : null}

          {baseMode === "orthophoto"
            ? existingFeatures.map((f) =>
                renderFeature(f, legend, planW, planH, georefCtx, fitScale)
              )
            : null}

          {designFeatures
            .filter((f) => !filledFeatureIds.has(f.id))
            .map((f) => renderFeature(f, legend, planW, planH, georefCtx, fitScale))}

          <ClippedFeatureFills
            features={designFeatures}
            layers={fillLayers}
            imageW={planW}
            imageH={planH}
            georefCtx={georefCtx}
            showOutlines={showOutlines}
            fitScale={fitScale}
          />

          {contourPolylines.map((c, i) => (
            <polyline
              key={`contour-${i}-${c.elevationFeet}`}
              points={pxPointsAttr(c.px)}
              fill="none"
              stroke={c.major ? "#78716c" : "#a8a29e"}
              strokeWidth={c.major ? 2 : 1}
              opacity={0.85}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {drainagePx.map((a, i) => (
            <line
              key={`drain-${i}`}
              x1={a.x1}
              y1={a.y1}
              x2={a.x2}
              y2={a.y2}
              stroke="#2563eb"
              strokeWidth={2}
              markerEnd="url(#drain-arrow)"
              opacity={0.75}
            />
          ))}

          {pixelsPerFoot != null ? (
            <ScaleBar
              x={contentBounds.x + 24}
              y={contentBounds.y + contentBounds.height - 90}
              barPx={scaleBarPx}
              feet={scaleBarFeet}
              scaleLabel={scaleLabel}
            />
          ) : null}
        </g>

        {callouts.map((c) => {
          const sx = planOffsetX + (c.x - contentBounds.x) * fitScale;
          const sy = planOffsetY + (c.y - contentBounds.y) * fitScale;
          const rSheet = c.radiusPx * fitScale;
          return (
            <g key={c.featureId}>
              <circle
                cx={sx}
                cy={sy}
                r={rSheet}
                fill="#1c1917"
                stroke="#fff"
                strokeWidth={1.25}
              />
              <text
                x={sx}
                y={sy}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#fff"
                fontSize={rSheet * 0.82}
                fontWeight="700"
                fontFamily="system-ui, sans-serif"
              >
                {c.number}
              </text>
            </g>
          );
        })}

        <NorthArrow
          x={northArrowSheetX}
          y={northArrowSheetY}
          size={northArrowSheetPx}
          rotationDeg={project.northRotationDeg}
        />

        <g transform={`translate(${legendX}, ${legendY})`}>
          <text
            x={0}
            y={0}
            fontSize={28}
            fontWeight="700"
            fill="#1c1917"
            fontFamily="system-ui, sans-serif"
          >
            Legend
          </text>
          {legendRows.length === 0 ? (
            <text x={0} y={40} fontSize={20} fill="#78716c" fontFamily="system-ui, sans-serif">
              No design features
            </text>
          ) : (
            legendRows.map((row, i) => {
              const y = 44 + i * 36;
              const typeLabel = labelForFeatureType(row.featureType, legend);
              const area =
                row.areaSqFt != null
                  ? ` — ${row.areaSqFt.toLocaleString(undefined, { maximumFractionDigits: 0 })} sq ft`
                  : "";
              return (
                <g key={row.featureId} transform={`translate(0, ${y})`}>
                  <circle cx={16} cy={0} r={16} fill="#1c1917" />
                  <text
                    x={16}
                    y={1}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#fff"
                    fontSize={18}
                    fontWeight="700"
                    fontFamily="system-ui, sans-serif"
                  >
                    {row.number}
                  </text>
                  <text
                    x={44}
                    y={1}
                    dominantBaseline="central"
                    fontSize={20}
                    fill="#44403c"
                    fontFamily="system-ui, sans-serif"
                  >
                    {row.label || typeLabel}
                    {area}
                  </text>
                </g>
              );
            })
          )}
        </g>

        <text
          x={sheetW - PLAN_MARGIN}
          y={sheetH - 40}
          textAnchor="end"
          fontSize={18}
          fill="#a8a29e"
          fontFamily="system-ui, sans-serif"
        >
          24×36 @ 300 DPI · {sheetW}×{sheetH}px
        </text>
      </svg>
    </div>
  );
}
