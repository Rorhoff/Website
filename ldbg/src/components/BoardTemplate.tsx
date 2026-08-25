import type { LegendEntry } from "@/config/legend";
import { BRAND } from "@/config/brand";
import { GeneralNotesBlock } from "@/components/GeneralNotesBlock";
import { GraphicScaleBar } from "@/components/GraphicScaleBar";
import { PlanDrawing } from "@/components/PlanDrawing";
import { ScaleVerificationStamp } from "@/components/ScaleVerificationStamp";
import { TitleBlock, computeBoardScaleLabel } from "@/components/TitleBlock";
import type { StoredDesignContent } from "@/lib/design-content-schema";
import type { InterpretFeature } from "@/lib/interpret-schema";
import { boardDimensions, boardMarginPx, type BoardPageSize } from "@/lib/board-sizes";
import { resolveEnabledNotes } from "@/lib/general-notes";
import { pickScaleBarFeet } from "@/lib/plan-layout";
import type {
  BoardSettings,
  PlanSettings,
  ProjectMetadata,
  ScaleVerification,
} from "@/lib/project-schema";
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
  annotatedUrl?: string;
  cleanUrl?: string;
  baseImageUrl?: string;
  renderSlots?: BoardRenderSlots;
  pageSize: BoardPageSize;
  basePath?: string;
  scaleVerification?: ScaleVerification;
  requiresScaleVerification?: boolean;
  calibrated?: boolean;
};

function renderImageSlot(url: string | undefined, placeholder: string) {
  return (
    <div className={styles.boardRenderImg}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" />
      ) : (
        <span>{placeholder}</span>
      )}
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
  annotatedUrl,
  cleanUrl,
  baseImageUrl,
  renderSlots,
  pageSize,
  basePath = "",
  scaleVerification,
  requiresScaleVerification = false,
  calibrated = false,
}: Props) {
  const dims = boardDimensions(pageSize);
  const marginPx = boardMarginPx();
  const planDisplayWidth = dims.widthPx * 0.48;
  const numberedNotes = resolveEnabledNotes(boardSettings?.enabledNoteIds);
  const scaleLabel = computeBoardScaleLabel(planDisplayWidth, pixelsPerFoot, 20);
  const scaleBarFeet =
    pixelsPerFoot != null
      ? pickScaleBarFeet(planDisplayWidth, pixelsPerFoot, planDisplayWidth * 0.14)
      : 20;
  const scaleBarPx =
    pixelsPerFoot != null ? scaleBarFeet * pixelsPerFoot : planDisplayWidth * 0.1;

  const materials = designContent?.materialsAndFinishes ?? [];
  const plants = designContent?.plantPalette ?? [];
  const concept = designContent?.conceptOverview ?? [];
  const renderPrompts = designContent?.renderPrompts ?? [];

  const heroPrompt = renderPrompts.find((r) => r.id === "hero_dusk");
  const entryPrompt = renderPrompts.find((r) => r.id === "entry");
  const firePrompt = renderPrompts.find((r) => r.id === "fire_pit");

  const supporting = [
    {
      id: "entry",
      url: renderSlots?.entry,
      caption: entryPrompt?.title ?? "Entry / pathway view",
    },
    {
      id: "fire_pit",
      url: renderSlots?.fire_pit,
      caption: firePrompt?.title ?? "Fire pit & pergola",
    },
    {
      id: "hero_dusk",
      url: renderSlots?.hero_dusk,
      caption: heroPrompt?.title ?? "Hero perspective at dusk",
    },
  ];

  return (
    <div
      className={styles.boardRoot}
      style={
        {
          width: dims.widthPx,
          height: dims.heightPx,
          padding: marginPx,
          fontSize: dims.widthPx / 100,
          "--board-accent": BRAND.accentColor,
          "--board-margin-px": `${marginPx}px`,
        } as React.CSSProperties
      }
      data-project-id={projectId}
      data-page-size={pageSize}
    >
      <div className={styles.boardCanvas}>
        <div className={styles.boardMain}>
          <aside className={styles.boardRail}>
            {annotatedUrl ? (
              <div className={styles.boardThumb}>
                <div className={styles.boardThumbLabel}>Source drone</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={styles.boardThumbImg} src={annotatedUrl} alt="" />
              </div>
            ) : null}
            {cleanUrl ? (
              <div className={styles.boardThumb}>
                <div className={styles.boardThumbLabel}>Clean orthophoto</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={styles.boardThumbImg} src={cleanUrl} alt="" />
              </div>
            ) : null}
            {!annotatedUrl && !cleanUrl ? (
              <div className={styles.boardThumb}>
                <div className={styles.boardPanelBody}>
                  <span className={styles.boardEmpty}>No source photos</span>
                </div>
              </div>
            ) : null}
            <GeneralNotesBlock notes={numberedNotes} />
          </aside>

          <section className={styles.boardCenter}>
            <div className={styles.boardCenterTitle}>
              {metadata.projectTitle || "Landscape plan"}
            </div>
            <div className={styles.boardPlanWrap}>
              {features.length > 0 ? (
                <PlanDrawing
                  project={{
                    features,
                    northRotationDeg,
                    metadata,
                    pixelsPerFoot,
                    calibration:
                      pixelsPerFoot != null
                        ? { pixelsPerFoot }
                        : undefined,
                  }}
                  legend={legend}
                  imageWidth={imageWidth}
                  imageHeight={imageHeight}
                  baseImageUrl={baseImageUrl}
                  planSettings={planSettings}
                  displayWidth={planDisplayWidth}
                />
              ) : (
                <span className={styles.boardEmpty}>Plan not available</span>
              )}
            </div>
            <div className={styles.boardPlanFooter}>
              <ScaleVerificationStamp
                scaleVerification={scaleVerification}
                requiresVerification={requiresScaleVerification}
                calibrated={calibrated}
              />
              {pixelsPerFoot != null ? (
                <GraphicScaleBar barPx={scaleBarPx} feet={scaleBarFeet} />
              ) : null}
            </div>
          </section>

          <aside className={styles.boardRight}>
            <div className={`${styles.boardPanel} ${styles.boardRenderSlot}`}>
              <div className={styles.boardPanelHead}>Perspective</div>
              {renderImageSlot(
                renderSlots?.hero,
                "Render slot — Milestone 7 or manual upload"
              )}
            </div>

            {materials.length > 0 ? (
              <div className={styles.boardPanel}>
                <div className={styles.boardPanelHead}>Materials & finishes</div>
                <div className={styles.boardPanelBody}>
                  <div className={styles.boardSwatches}>
                    {materials.map((m) => {
                      const entry = legend.find((e) => e.featureType === m.featureType);
                      const fill = entry?.renderStyle.fill ?? "#ccc";
                      return (
                        <div key={m.featureId} className={styles.boardSwatchItem}>
                          <div
                            className={styles.boardSwatch}
                            style={{
                              background: fill === "none" ? "#e7e5e4" : fill,
                            }}
                          />
                          <div className={styles.boardSwatchLabel}>{m.material}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}

            {plants.length > 0 ? (
              <div className={styles.boardPanel}>
                <div className={styles.boardPanelHead}>Plant palette</div>
                <div className={styles.boardPanelBody}>
                  <div className={styles.boardPlants}>
                    {plants.slice(0, 10).map((p, i) => (
                      <div key={i} className={styles.boardPlantCard}>
                        <div className={styles.boardPlantName}>{p.commonName}</div>
                        <div className={styles.boardPlantSci}>{p.botanicalName}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {materials.length === 0 && plants.length === 0 ? (
              <div className={styles.boardPanel}>
                <div className={styles.boardPanelBody}>
                  <span className={styles.boardEmpty}>
                    Generate design content for materials & plants
                  </span>
                </div>
              </div>
            ) : null}
          </aside>
        </div>

        <div className={styles.boardBottom}>
          <div className={styles.boardBottomLeft}>
            <div className={styles.boardConcept}>
              <div className={styles.boardConceptTitle}>Concept overview</div>
              {concept.length > 0 ? (
                <ul>
                  {concept.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              ) : (
                <p className={styles.boardEmpty}>Generate design content for concept bullets</p>
              )}
            </div>

            <div className={styles.boardSupporting}>
              {supporting.map((s) => (
                <div key={s.id} className={styles.boardSupportSlot}>
                  {renderImageSlot(s.url, "Supporting render")}
                  <div className={styles.boardSupportCaption}>{s.caption}</div>
                </div>
              ))}
            </div>
          </div>

          <TitleBlock
            metadata={metadata}
            boardSettings={boardSettings}
            scaleLabel={scaleLabel}
            basePath={basePath}
          />
        </div>
      </div>
    </div>
  );
}
