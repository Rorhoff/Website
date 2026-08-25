import { useMemo } from "react";
import type { LegendEntry } from "@/config/legend";
import { normToPx } from "@/lib/feature-geometry";
import { labelForFeatureType } from "@/lib/feature-styles";
import type { InterpretFeature } from "@/lib/interpret-schema";
import {
  buildCalloutsAndLegend,
  CALLOUT_RADIUS,
  computeArchScaleLabel,
  pickScaleBarFeet,
  polygonPointsAttr,
  SHEET_HEIGHT_PX,
  SHEET_WIDTH_PX,
} from "@/lib/plan-layout";
import { patternUrl, PlanPatternDefs } from "@/lib/plan-patterns";
import type { PlanSettings } from "@/lib/project-schema";

export type PlanDrawingProject = {
  features: InterpretFeature[];
  northRotationDeg: number;
  calibration?: { pixelsPerFoot: number };
  editorSettings?: { hiddenFeatureTypes?: string[] };
  metadata: { projectTitle?: string };
};

type Props = {
  project: PlanDrawingProject;
  legend: LegendEntry[];
  imageWidth: number;
  imageHeight: number;
  baseImageUrl?: string;
  planSettings?: PlanSettings;
  displayWidth?: number;
  className?: string;
};

const PLAN_MARGIN = 120;
const LEGEND_WIDTH = 520;
const FOOTER_H = 200;

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
  h: number
) {
  const entry = legend.find((e) => e.featureType === f.featureType);
  const rs = entry?.renderStyle;
  const stroke = rs?.stroke ?? "#64748b";
  const strokeWidth = rs?.strokeWidth ?? 1.5;
  const fillBase = rs?.fill === "none" ? "transparent" : (rs?.fill ?? "#94a3b8");
  const opacity = rs?.opacity ?? 0.85;
  const pat = patternUrl(rs?.patternId);

  if (f.geometry.kind === "point" || isTreeType(f.featureType)) {
    const c = normToPx(f.geometry.points[0], w, h);
    const r = (f.geometry.radius ?? 0.025) * Math.max(w, h);
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

  if (f.geometry.kind === "polyline") {
    return (
      <polyline
        key={f.id}
        points={polygonPointsAttr(f.geometry.points, w, h)}
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
      points={polygonPointsAttr(f.geometry.points, w, h)}
      fill={pat ?? fillBase}
      stroke={stroke}
      strokeWidth={strokeWidth}
      opacity={opacity}
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
  planSettings,
  displayWidth = 900,
  className,
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

  const pixelsPerFoot = project.calibration?.pixelsPerFoot;

  const { callouts, legendRows } = useMemo(
    () =>
      buildCalloutsAndLegend(
        designFeatures,
        legend,
        planW,
        planH,
        pixelsPerFoot
      ),
    [designFeatures, legend, planW, planH, pixelsPerFoot]
  );

  const scaleBarFeet =
    pixelsPerFoot != null
      ? pickScaleBarFeet(planW, pixelsPerFoot, planW * 0.18)
      : 20;
  const scaleBarPx = pixelsPerFoot != null ? scaleBarFeet * pixelsPerFoot : planW * 0.12;
  const scaleLabel =
    pixelsPerFoot != null
      ? computeArchScaleLabel(planW, pixelsPerFoot, 20)
      : "Calibrate for scale";

  const planAreaX = PLAN_MARGIN;
  const planAreaY = PLAN_MARGIN;
  const planAreaW = sheetW - PLAN_MARGIN * 2 - LEGEND_WIDTH - 40;
  const planAreaH = sheetH - PLAN_MARGIN * 2 - FOOTER_H;
  const fitScale = Math.min(planAreaW / planW, planAreaH / planH);
  const drawnW = planW * fitScale;
  const drawnH = planH * fitScale;
  const planOffsetX = planAreaX + (planAreaW - drawnW) / 2;
  const planOffsetY = planAreaY + (planAreaH - drawnH) / 2;

  const legendX = sheetW - LEGEND_WIDTH - PLAN_MARGIN + 20;
  const legendY = PLAN_MARGIN + 40;

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

        <g transform={`translate(${planOffsetX}, ${planOffsetY}) scale(${fitScale})`}>
          {baseMode === "orthophoto" && baseImageUrl ? (
            <image
              href={baseImageUrl}
              x={0}
              y={0}
              width={planW}
              height={planH}
              opacity={orthoOpacity}
              filter="url(#plan-desaturate)"
              preserveAspectRatio="xMidYMid meet"
            />
          ) : (
            <rect x={0} y={0} width={planW} height={planH} fill="#ffffff" stroke="#e7e5e4" strokeWidth={2} />
          )}

          {baseMode === "white"
            ? existingFeatures.filter(isHouseExisting).map((f) =>
                renderFeature(f, legend, planW, planH)
              )
            : null}

          {baseMode === "orthophoto"
            ? existingFeatures.map((f) => renderFeature(f, legend, planW, planH))
            : null}

          {designFeatures.map((f) => renderFeature(f, legend, planW, planH))}

          {callouts.map((c) => (
            <g key={c.featureId}>
              <circle
                cx={c.x}
                cy={c.y}
                r={CALLOUT_RADIUS}
                fill="#1c1917"
                stroke="#fff"
                strokeWidth={3}
              />
              <text
                x={c.x}
                y={c.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#fff"
                fontSize={CALLOUT_RADIUS * 0.95}
                fontWeight="700"
                fontFamily="system-ui, sans-serif"
              >
                {c.number}
              </text>
            </g>
          ))}
        </g>

        <g
          transform={`translate(${planOffsetX + drawnW - 180 * fitScale}, ${planOffsetY + 40 * fitScale}) scale(${fitScale})`}
        >
          <NorthArrow
            x={0}
            y={0}
            size={80}
            rotationDeg={project.northRotationDeg}
          />
        </g>

        {pixelsPerFoot != null ? (
          <g transform={`translate(${planOffsetX + 24}, ${planOffsetY + drawnH - 80}) scale(${fitScale})`}>
            <ScaleBar
              x={0}
              y={0}
              barPx={scaleBarPx}
              feet={scaleBarFeet}
              scaleLabel={scaleLabel}
            />
          </g>
        ) : null}

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
