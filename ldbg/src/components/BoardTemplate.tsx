import type { LegendEntry } from "@/config/legend";
import { BRANDING, brandingLogoUrl } from "@/config/branding";
import { PlanDrawing } from "@/components/PlanDrawing";
import type { StoredDesignContent } from "@/lib/design-content-schema";
import type { InterpretFeature } from "@/lib/interpret-schema";
import { boardDimensions, type BoardPageSize } from "@/lib/board-sizes";
import type { PlanSettings, ProjectMetadata, ScaleVerification } from "@/lib/project-schema";
import {
  formatScaleVerificationSummary,
  PHOTOGRAMMETRY_DISCLAIMER,
} from "@/lib/scale-verification";
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
  imageWidth: number;
  imageHeight: number;
  annotatedUrl?: string;
  cleanUrl?: string;
  baseImageUrl?: string;
  renderSlots?: BoardRenderSlots;
  pageSize: BoardPageSize;
  basePath?: string;
  scaleVerification?: ScaleVerification;
  showPhotogrammetryDisclaimer?: boolean;
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
  imageWidth,
  imageHeight,
  annotatedUrl,
  cleanUrl,
  baseImageUrl,
  renderSlots,
  pageSize,
  basePath = "",
  scaleVerification,
  showPhotogrammetryDisclaimer = false,
}: Props) {
  const dims = boardDimensions(pageSize);
  const logoUrl = brandingLogoUrl(basePath);

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
          fontSize: dims.widthPx / 100,
          "--board-accent": BRANDING.accentColor,
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
                  }}
                  legend={legend}
                  imageWidth={imageWidth}
                  imageHeight={imageHeight}
                  baseImageUrl={baseImageUrl}
                  planSettings={planSettings}
                  displayWidth={dims.widthPx * 0.52}
                />
              ) : (
                <span className={styles.boardEmpty}>Plan not available</span>
              )}
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

          <div className={styles.boardBrand}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.boardLogo} src={logoUrl} alt="" />
            <div className={styles.boardBrandName}>{BRANDING.businessName}</div>
            <div className={styles.boardTagline}>{BRANDING.tagline}</div>
            <div className={styles.boardMeta}>
              {metadata.clientName ? `${metadata.clientName} · ` : ""}
              {metadata.propertyAddress || metadata.projectTitle}
            </div>
            <div className={styles.boardMeta}>
              {metadata.designStyle} · {metadata.climateZone}
            </div>
            {showPhotogrammetryDisclaimer ? (
              <div className={styles.boardDisclaimer}>{PHOTOGRAMMETRY_DISCLAIMER}</div>
            ) : null}
            {scaleVerification?.passed ? (
              <div className={styles.boardScaleVerify}>
                Scale check: {formatScaleVerificationSummary(scaleVerification)}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
