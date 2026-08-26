import type { LegendEntry } from "@/config/legend";
import { geometryToPxPoints } from "@/lib/feature-georef";
import type { FeatureFillEntry } from "@/lib/feature-fill-schema";
import type { InterpretFeature } from "@/lib/interpret-schema";
import type { GeorefDisplayContext } from "@/lib/georef-display";
import { pxPointsAttr } from "@/lib/plan-layout";

export type FeatureFillLayer = {
  featureId: string;
  url: string;
  cropBox: { x: number; y: number; width: number; height: number };
};

export function buildFeatureFillLayers(
  features: InterpretFeature[],
  fills: Record<string, FeatureFillEntry> | undefined,
  imageUrl: (filename: string) => string
): FeatureFillLayer[] {
  if (!fills) return [];
  const layers: FeatureFillLayer[] = [];
  for (const f of features) {
    if (f.existing) continue;
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
  showOutlines,
  fitScale = 1,
}: {
  features: InterpretFeature[];
  layers: FeatureFillLayer[];
  imageW: number;
  imageH: number;
  georefCtx?: GeorefDisplayContext;
  showOutlines?: boolean;
  fitScale?: number;
}) {
  if (layers.length === 0) return null;

  const layerById = new Map(layers.map((l) => [l.featureId, l]));
  const filledFeatures = features.filter((f) => layerById.has(f.id));

  return (
    <>
      <defs>
        <filter id="feature-fill-feather" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur in="SourceGraphic" stdDeviation={FEATHER_PX / fitScale} />
        </filter>
        {filledFeatures.map((f) => {
          const pxPts = geometryToPxPoints(f, imageW, imageH, georefCtx);
          if (f.geometry.kind === "polyline" || pxPts.length < 3) return null;
          return (
            <clipPath key={`clip-${f.id}`} id={`feature-fill-clip-${f.id}`}>
              <polygon points={pxPointsAttr(pxPts)} />
            </clipPath>
          );
        })}
      </defs>

      {filledFeatures.map((f) => {
        const layer = layerById.get(f.id);
        if (!layer || f.geometry.kind === "polyline") return null;
        const pxPts = geometryToPxPoints(f, imageW, imageH, georefCtx);
        if (pxPts.length < 3) return null;
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
            if (f.geometry.kind === "polyline") return null;
            const pxPts = geometryToPxPoints(f, imageW, imageH, georefCtx);
            if (pxPts.length < 3) return null;
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
