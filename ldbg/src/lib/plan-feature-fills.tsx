import type { LegendEntry } from "@/config/legend";
import { shouldExcludePlanMaterialFill } from "@/lib/feature-styles";
import { geometryToPxPoints } from "@/lib/feature-georef";
import type { FeatureFillEntry } from "@/lib/feature-fill-schema";
import type { InterpretFeature } from "@/lib/interpret-schema";
import type { GeorefDisplayContext } from "@/lib/georef-display";
import { pxPointsAttr } from "@/lib/plan-layout";
import {
  featureToRenderPolygonsPx,
  polylineStripWidthFt,
} from "@/lib/polyline-buffer";

function featureFillClipPoints(
  f: InterpretFeature,
  imageW: number,
  imageH: number,
  georefCtx: GeorefDisplayContext | undefined,
  legend: LegendEntry[] | undefined,
  pixelsPerFoot: number | undefined
): { x: number; y: number }[] | null {
  if (f.geometry.kind === "polyline" && legend) {
    const widthFt = polylineStripWidthFt(f, legend);
    const ring = featureToRenderPolygonsPx(
      f,
      imageW,
      imageH,
      widthFt,
      pixelsPerFoot,
      georefCtx
    )[0];
    return ring && ring.length >= 3 ? ring : null;
  }
  const pxPts = geometryToPxPoints(f, imageW, imageH, georefCtx);
  return pxPts.length >= 3 ? pxPts : null;
}

export type FeatureFillLayer = {
  featureId: string;
  url: string;
  cropBox: { x: number; y: number; width: number; height: number };
};

export function buildFeatureFillLayers(
  features: InterpretFeature[],
  fills: Record<string, FeatureFillEntry> | undefined,
  imageUrl: (filename: string) => string,
  legend?: LegendEntry[]
): FeatureFillLayer[] {
  if (!fills) return [];
  const layers: FeatureFillLayer[] = [];
  for (const f of features) {
    if (f.existing) continue;
    if (legend && shouldExcludePlanMaterialFill(f, legend)) continue;
    const entry = fills[f.id];
    if (entry?.status !== "filled" || !entry.imageFilename || !entry.cropBox) continue;
    layers.push({
      featureId: f.id,
      url: imageUrl(entry.imageFilename),
      cropBox: entry.cropBox,
    });
  }
  return layers;
}

const FEATHER_PX = 3;

export function ClippedFeatureFills({
  features,
  layers,
  imageW,
  imageH,
  georefCtx,
  legend,
  pixelsPerFoot,
  showOutlines,
  fitScale = 1,
}: {
  features: InterpretFeature[];
  layers: FeatureFillLayer[];
  imageW: number;
  imageH: number;
  georefCtx?: GeorefDisplayContext;
  legend?: LegendEntry[];
  pixelsPerFoot?: number;
  showOutlines?: boolean;
  fitScale?: number;
}) {
  if (layers.length === 0) return null;

  const layerById = new Map(layers.map((l) => [l.featureId, l]));
  const filledFeatures = features.filter(
    (f) =>
      layerById.has(f.id) &&
      !(legend && shouldExcludePlanMaterialFill(f, legend))
  );

  return (
    <>
      <defs>
        <filter id="feature-fill-feather" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur in="SourceGraphic" stdDeviation={FEATHER_PX / fitScale} />
        </filter>
        {filledFeatures.map((f) => {
          const pxPts = featureFillClipPoints(
            f,
            imageW,
            imageH,
            georefCtx,
            legend,
            pixelsPerFoot
          );
          if (!pxPts) return null;
          return (
            <clipPath key={`clip-${f.id}`} id={`feature-fill-clip-${f.id}`}>
              <polygon points={pxPointsAttr(pxPts)} />
            </clipPath>
          );
        })}
      </defs>

      {filledFeatures.map((f) => {
        const layer = layerById.get(f.id);
        if (!layer) return null;
        const pxPts = featureFillClipPoints(
          f,
          imageW,
          imageH,
          georefCtx,
          legend,
          pixelsPerFoot
        );
        if (!pxPts) return null;
        const { cropBox, url } = layer;
        return (
          <g key={`fill-${f.id}`} clipPath={`url(#feature-fill-clip-${f.id})`}>
            <image
              href={url}
              x={cropBox.x}
              y={cropBox.y}
              width={cropBox.width}
              height={cropBox.height}
              preserveAspectRatio="none"
            />
          </g>
        );
      })}

      {showOutlines
        ? filledFeatures.map((f) => {
            const pxPts = featureFillClipPoints(
              f,
              imageW,
              imageH,
              georefCtx,
              legend,
              pixelsPerFoot
            );
            if (!pxPts) return null;
            return (
              <polygon
                key={`outline-${f.id}`}
                points={pxPointsAttr(pxPts)}
                fill="none"
                stroke="#1c1917"
                strokeWidth={1.5 / fitScale}
                opacity={0.35}
                vectorEffect="non-scaling-stroke"
              />
            );
          })
        : null}
    </>
  );
}
