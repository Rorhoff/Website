import type { LegendEntry } from "@/config/legend";
import { BRAND } from "@/config/brand";
import { geminiEnabled } from "@/config/ai-features";
import { presetUsesStylePass, type StylePresetId } from "@/config/styles";
import { BoardPlanLegend, BoardPlanSvg, computeBoardPlanScale } from "@/components/BoardPlanSvg";
import { GeneralNotesBlock } from "@/components/GeneralNotesBlock";
import { GraphicScaleBar } from "@/components/GraphicScaleBar";
import { MaterialPatternSwatch } from "@/components/MaterialPatternSwatch";
import { ScaleVerificationStamp } from "@/components/ScaleVerificationStamp";
import { TitleBlock } from "@/components/TitleBlock";
import {
  MATERIALS_DISCLAIMER,
  type StoredDesignContent,
} from "@/lib/design-content-schema";
import { filterPlantsToFeatures, legendEntryForPlant } from "@/lib/board-plants";
import { buildMaterialsKeyRows } from "@/lib/board-materials-key";
import { PlantReferenceThumb } from "@/components/PlantReferenceThumb";
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
  styledPlanUrl?: string;
  baseImageUrl?: string;
  baseImageFilter?: string;
  featureFills?: Record<string, FeatureFillEntry>;
  featureFillImageUrl?: (filename: string) => string;
  hasFilledFeatures?: boolean;
  bakedFeatureFills?: boolean;
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
  styledPlanUrl,
  baseImageUrl,
  baseImageFilter,
  featureFills,
  featureFillImageUrl,
  hasFilledFeatures = false,
  bakedFeatureFills = false,
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
    forceFeatureFillNote: geminiEnabled() && hasFilledFeatures,
    forceStylePassNote:
      geminiEnabled() &&
      presetUsesStylePass((planSettings?.stylePreset ?? "off") as StylePresetId),
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

  const plants = filterPlantsToFeatures(
    designContent?.plantPalette ?? [],
    features,
    legend
  );

  const materialsKey = buildMaterialsKeyRows(features, legend);

  const supporting = [
    { id: "entry", url: renderSlots?.entry, caption: "Entry / pathway view" },
    { id: "fire_pit", url: renderSlots?.fire_pit, caption: "Fire pit & pergola" },
    { id: "hero_dusk", url: renderSlots?.hero_dusk, caption: "Hero perspective at dusk" },
  ].filter((s) => Boolean(s.url));

  const planFeatureFills = bakedFeatureFills ? undefined : featureFills;

  return (
    <div
      className={styles.sheet}
      style={
        {
          width: dims.widthPx,
          height: dims.heightPx,
          "--board-accent": BRAND.accentColor,
          "--col-center": `${grid.colCenter}px`,
          "--col-right": `${grid.colRight}px`,
          "--row-main": `${grid.rowMain}px`,
          "--row-bottom": `${grid.rowBottom}px`,
          "--center-legend-w": `${grid.centerLegendW}px`,
          "--right-notes-h": `${grid.rightNotesH}px`,
          "--right-materials-h": `${grid.rightMaterialsH}px`,
        } as React.CSSProperties
      }
      data-project-id={projectId}
      data-page-size={pageSize}
    >
      <div className={styles.grid}>
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
                  featureFills={planFeatureFills}
                  featureFillImageUrl={featureFillImageUrl}
                  fullFrame
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
          <GeneralNotesBlock notes={numberedNotes} alwaysShow />
          <div className={styles.panel}>
            <div className={styles.panelHead}>Materials &amp; finishes</div>
            <div className={`${styles.panelBody} ${styles.materialsKey}`}>
              <p className={styles.materialsKeyDisclaimer}>{MATERIALS_DISCLAIMER}</p>
              {materialsKey.length > 0 ? (
                <div className={styles.swatches}>
                  {materialsKey.map((m) => (
                    <div key={m.featureId} className={styles.swatchItem}>
                      <MaterialPatternSwatch
                        patternId={m.patternId}
                        fill={m.fill}
                        stroke={m.stroke}
                        uniqueId={m.featureId}
                      />
                      <div className={styles.swatchLabel}>{m.label}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <Placeholder label="Materials key — add hardscape features to the plan" />
              )}
            </div>
          </div>
          <div className={styles.panel}>
            <div className={styles.panelHead}>Plant palette</div>
            <div className={styles.panelBody}>
              {plants.length > 0 ? (
                <div className={styles.plantsList}>
                  {plants.map((p, i) => {
                    const entry = legendEntryForPlant(p, legend);
                    const fill = entry?.renderStyle.fill ?? "#8FBC8F";
                    const stroke = entry?.renderStyle.stroke ?? "#556B2F";
                    return (
                      <div key={i} className={styles.plantRow}>
                        <PlantReferenceThumb
                          commonName={p.commonName}
                          featureType={entry?.featureType}
                          fill={fill}
                          stroke={stroke}
                          className={styles.plantThumbSquare}
                        />
                        <div className={styles.plantText}>
                          <div className={styles.plantName}>{p.commonName}</div>
                          <div className={styles.plantSci}>{p.botanicalName}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <Placeholder label="Plant palette — add plants in the feature editor" />
              )}
            </div>
          </div>
        </aside>

        <div
          className={`${styles.bottomStrip} ${supporting.length > 0 ? styles.bottomStripWithSupporting : ""}`}
        >
          <div className={styles.panel}>
            <div className={styles.panelHead}>Source drone</div>
            <div className={styles.panelBody}>
              {annotatedUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.thumbContain} src={annotatedUrl} alt="" />
              ) : (
                <Placeholder label="Source drone photo" />
              )}
            </div>
          </div>
          <div className={styles.panel}>
            <div className={styles.panelHead}>Styled plan</div>
            <div className={`${styles.panelBody} ${styles.styledPlanCell}`}>
              {styledPlanUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.thumbContain} src={styledPlanUrl} alt="" />
              ) : (
                <Placeholder label="Composite plan preview" />
              )}
            </div>
          </div>
          {supporting.length > 0 ? (
            <div
              className={styles.supportingRow}
              style={{
                gridTemplateColumns: `repeat(${supporting.length}, 1fr)`,
              }}
            >
              {supporting.map((s) => (
                <div key={s.id} className={styles.supportSlot}>
                  <div className={styles.panelBody}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className={styles.renderContain} src={s.url} alt="" />
                  </div>
                  <div className={styles.supportCaption}>{s.caption}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className={styles.titleArea}>
          <div className={styles.titleWall}>
            <TitleBlock
              metadata={metadata}
              boardSettings={boardSettings}
              scaleLabel={scale.scaleLabel}
              basePath={basePath}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
