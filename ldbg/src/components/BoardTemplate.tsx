import type { LegendEntry } from "@/config/legend";
import { BRAND } from "@/config/brand";
import { presetUsesStylePass, type StylePresetId } from "@/config/styles";
import { BoardPlanLegend, BoardPlanSvg, computeBoardPlanScale } from "@/components/BoardPlanSvg";
import { GeneralNotesBlock } from "@/components/GeneralNotesBlock";
import { GraphicScaleBar } from "@/components/GraphicScaleBar";
import { ScaleVerificationStamp } from "@/components/ScaleVerificationStamp";
import { TitleBlock } from "@/components/TitleBlock";
import {
  filterMaterialsToFeatures,
  type StoredDesignContent,
} from "@/lib/design-content-schema";
import type { InterpretFeature } from "@/lib/interpret-schema";
import { boardDimensions, boardGridTracks, type BoardPageSize } from "@/lib/board-sizes";
import { resolveEnabledNotes } from "@/lib/general-notes";
import type { GeorefDisplayContext } from "@/lib/georef-display";
import type {
  BoardSettings,
  PlanSettings,
  ProjectMetadata,
  ScaleVerification,
} from "@/lib/project-schema";
import type { FeatureFillEntry } from "@/lib/feature-fill-schema";
import styles from "./board.module.css";

export type BoardRenderSlots = {
  hero?: string;
  entry?: string;
  fire_pit?: string;
  hero_dusk?: string;
};

type Props = {
  projectId: string;
  metadata: ProjectMetadata;
  features: InterpretFeature[];
  legend: LegendEntry[];
  northRotationDeg: number;
  designContent?: StoredDesignContent;
  planSettings?: PlanSettings;
  boardSettings?: BoardSettings;
  imageWidth: number;
  imageHeight: number;
  pixelsPerFoot?: number;
  georefContext?: GeorefDisplayContext;
  annotatedUrl?: string;
  cleanUrl?: string;
  planSchematicBaseUrl?: string;
  baseImageUrl?: string;
  baseImageFilter?: string;
  featureFills?: Record<string, FeatureFillEntry>;
  featureFillImageUrl?: (filename: string) => string;
  hasFilledFeatures?: boolean;
  renderSlots?: BoardRenderSlots;
  pageSize: BoardPageSize;
  basePath?: string;
  scaleVerification?: ScaleVerification;
  requiresScaleVerification?: boolean;
  calibrated?: boolean;
};

function Placeholder({ label }: { label: string }) {
  return (
    <div className={styles.placeholder}>
      <span>{label}</span>
    </div>
  );
}

function RenderPanel({
  label,
  url,
  placeholder,
}: {
  label: string;
  url?: string;
  placeholder: string;
}) {
  return (
    <div className={`${styles.panel} h-full`}>
      <div className={styles.panelHead}>{label}</div>
      <div className={styles.panelBody}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.renderFill} src={url} alt="" />
        ) : (
          <Placeholder label={placeholder} />
        )}
      </div>
    </div>
  );
}

export function BoardTemplate({
  projectId,
  metadata,
  features,
  legend,
  northRotationDeg,
  designContent,
  planSettings,
  boardSettings,
  imageWidth,
  imageHeight,
  pixelsPerFoot,
  georefContext,
  annotatedUrl,
  cleanUrl,
  planSchematicBaseUrl,
  baseImageUrl,
  baseImageFilter,
  featureFills,
  featureFillImageUrl,
  hasFilledFeatures = false,
  renderSlots,
  pageSize,
  basePath = "",
  scaleVerification,
  requiresScaleVerification = false,
  calibrated = false,
}: Props) {
  const dims = boardDimensions(pageSize);
  const grid = boardGridTracks(pageSize);
  const numberedNotes = resolveEnabledNotes(boardSettings?.enabledNoteIds, {
    forceFeatureFillNote: hasFilledFeatures,
    forceStylePassNote: presetUsesStylePass(
      (planSettings?.stylePreset ?? "off") as StylePresetId
    ),
  });
  const hiddenTypes: string[] = [];

  const planPanelWidth = grid.colCenter - grid.centerLegendW - 16;
  const scale = computeBoardPlanScale(
    features,
    imageWidth,
    imageHeight,
    planPanelWidth,
    pixelsPerFoot,
    georefContext,
    hiddenTypes
  );

  const materials = filterMaterialsToFeatures(
    designContent?.materialsAndFinishes ?? [],
    features
  );
  const plants = designContent?.plantPalette ?? [];
  const concept = designContent?.conceptOverview ?? [];
  const renderPrompts = designContent?.renderPrompts ?? [];

  const entryPrompt = renderPrompts.find((r) => r.id === "entry");
  const firePrompt = renderPrompts.find((r) => r.id === "fire_pit");
  const heroPrompt = renderPrompts.find((r) => r.id === "hero_dusk");

  const supporting = [
    { id: "entry", url: renderSlots?.entry, caption: entryPrompt?.title ?? "Entry / pathway view" },
    { id: "fire_pit", url: renderSlots?.fire_pit, caption: firePrompt?.title ?? "Fire pit & pergola" },
    { id: "hero_dusk", url: renderSlots?.hero_dusk, caption: heroPrompt?.title ?? "Hero perspective at dusk" },
  ];

  return (
    <div
      className={styles.sheet}
      style={
        {
          width: dims.widthPx,
          height: dims.heightPx,
          "--board-accent": BRAND.accentColor,
          "--col-rail": `${grid.colRail}px`,
          "--col-center": `${grid.colCenter}px`,
          "--col-right": `${grid.colRight}px`,
          "--row-main": `${grid.rowMain}px`,
          "--row-bottom": `${grid.rowBottom}px`,
          "--center-legend-w": `${grid.centerLegendW}px`,
          "--right-hero-h": `${grid.rightHeroH}px`,
          "--right-materials-h": `${grid.rightMaterialsH}px`,
          "--rail-thumb-h": `${grid.railThumbH}px`,
          "--rail-schematic-h": `${grid.railSchematicH}px`,
        } as React.CSSProperties
      }
      data-project-id={projectId}
      data-page-size={pageSize}
    >
      <div className={styles.grid}>
        <aside className={styles.rail}>
          <div className={styles.panel}>
            <div className={styles.panelHead}>Source drone</div>
            <div className={styles.panelBody}>
              {annotatedUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.thumbImg} src={annotatedUrl} alt="" />
              ) : (
                <Placeholder label="Source drone photo — upload annotated orthophoto" />
              )}
            </div>
          </div>
          <div className={styles.panel}>
            <div className={styles.panelHead}>Clean orthophoto</div>
            <div className={styles.panelBody}>
              {cleanUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.thumbImg} src={cleanUrl} alt="" />
              ) : (
                <Placeholder label="Clean orthophoto — upload unmarked base image" />
              )}
            </div>
          </div>
          <div className={styles.panel}>
            <div className={styles.panelHead}>Plan schematic</div>
            <div className={`${styles.panelBody} ${styles.schematicCell}`}>
              {features.length > 0 ? (
                <BoardPlanSvg
                  features={features}
                  legend={legend}
                  imageWidth={imageWidth}
                  imageHeight={imageHeight}
                  baseImageUrl={planSchematicBaseUrl ?? cleanUrl}
                  planSettings={{
                    baseMode: "orthophoto",
                    basePreset: planSettings?.basePreset ?? "off",
                    stylePreset: planSettings?.stylePreset ?? "off",
                    orthophotoOpacity: planSchematicBaseUrl ? 1 : 0.4,
                    showFeatureOutlines: true,
                    showInkLinework: false,
                    watercolorCompareRaw: planSettings?.watercolorCompareRaw ?? false,
                    showContours: planSettings?.showContours ?? false,
                    showDrainageArrows: planSettings?.showDrainageArrows ?? false,
                    contourMinorFt: planSettings?.contourMinorFt ?? 1,
                    contourMajorFt: planSettings?.contourMajorFt ?? 5,
                  }}
                  northRotationDeg={northRotationDeg}
                  pixelsPerFoot={pixelsPerFoot}
                  georefCtx={georefContext}
                  featureFills={featureFills}
                  featureFillImageUrl={featureFillImageUrl}
                />
              ) : (
                <Placeholder label="Plan schematic — draw features and fill materials" />
              )}
            </div>
          </div>
          <GeneralNotesBlock notes={numberedNotes} alwaysShow />
        </aside>

        <section className={`${styles.panel} ${styles.center}`}>
          <div className={styles.centerTitle}>
            {metadata.projectTitle || "Proposed landscape plan"}
          </div>
          <div className={styles.centerPlanRow}>
            <div className={styles.planCell}>
              {features.length > 0 ? (
                <BoardPlanSvg
                  features={features}
                  legend={legend}
                  imageWidth={imageWidth}
                  imageHeight={imageHeight}
                  baseImageUrl={baseImageUrl}
                  baseImageFilter={baseImageFilter}
                  planSettings={planSettings}
                  northRotationDeg={northRotationDeg}
                  pixelsPerFoot={pixelsPerFoot}
                  georefCtx={georefContext}
                  hiddenFeatureTypes={hiddenTypes}
                  featureFills={featureFills}
                  featureFillImageUrl={featureFillImageUrl}
                />
              ) : (
                <Placeholder label="Proposed landscape plan — draw or interpret features" />
              )}
            </div>
            <div className={styles.legendCell}>
              {features.length > 0 ? (
                <BoardPlanLegend
                  features={features}
                  legend={legend}
                  imageWidth={imageWidth}
                  imageHeight={imageHeight}
                  pixelsPerFoot={pixelsPerFoot}
                  georefCtx={georefContext}
                  hiddenFeatureTypes={hiddenTypes}
                />
              ) : (
                <Placeholder label="Numbered plan legend" />
              )}
            </div>
          </div>
          <div className={styles.centerFooter}>
            <ScaleVerificationStamp
              scaleVerification={scaleVerification}
              requiresVerification={requiresScaleVerification}
              calibrated={calibrated}
            />
            {pixelsPerFoot != null ? (
              <GraphicScaleBar barPx={scale.scaleBarPx} feet={scale.scaleBarFeet} />
            ) : (
              <span className={styles.scaleStampMuted}>Calibrate scale for graphic bar</span>
            )}
          </div>
        </section>

        <aside className={styles.right}>
          <RenderPanel
            label="Perspective"
            url={renderSlots?.hero}
            placeholder="Perspective render — Milestone 7 or manual upload"
          />
          <div className={styles.panel}>
            <div className={styles.panelHead}>Materials &amp; finishes</div>
            <div className={styles.panelBody}>
              {materials.length > 0 ? (
                <div className={styles.swatches}>
                  {materials.map((m) => {
                    const entry = legend.find((e) => e.featureType === m.featureType);
                    const fill = entry?.renderStyle.fill ?? "#ccc";
                    return (
                      <div key={m.featureId} className={styles.swatchItem}>
                        <div
                          className={styles.swatch}
                          style={{ background: fill === "none" ? "#e7e5e4" : fill }}
                        />
                        <div className={styles.swatchLabel}>{m.material}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <Placeholder label="Materials &amp; finishes — generate design content" />
              )}
            </div>
          </div>
          <div className={styles.panel}>
            <div className={styles.panelHead}>Plant palette</div>
            <div className={styles.panelBody}>
              {plants.length > 0 ? (
                <div className={styles.plantsGrid}>
                  {plants.slice(0, 12).map((p, i) => (
                    <div key={i} className={styles.plantCard}>
                      <div className={styles.plantName}>{p.commonName}</div>
                      <div className={styles.plantSci}>{p.botanicalName}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <Placeholder label="Plant palette grid — generate design content" />
              )}
            </div>
          </div>
        </aside>

        <div className={styles.bottom}>
          <div className={styles.conceptPanel}>
            <div className={styles.conceptTitle}>Concept overview</div>
            {concept.length > 0 ? (
              <ul className={styles.conceptList}>
                {concept.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            ) : (
              <Placeholder label="Concept overview bullets — generate design content" />
            )}
          </div>
          <div className={styles.supportingRow}>
            {supporting.map((s) => (
              <div key={s.id} className={styles.supportSlot}>
                <div className={styles.panelBody}>
                  {s.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className={styles.renderFill} src={s.url} alt="" />
                  ) : (
                    <Placeholder label={`Supporting render — ${s.caption}`} />
                  )}
                </div>
                <div className={styles.supportCaption}>{s.caption}</div>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.titleArea}>
          <TitleBlock
            metadata={metadata}
            boardSettings={boardSettings}
            scaleLabel={scale.scaleLabel}
            basePath={basePath}
          />
        </div>
      </div>
    </div>
  );
}
