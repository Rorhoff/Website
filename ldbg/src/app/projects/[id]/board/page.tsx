export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { presetUsesFilter, type WatercolorPresetId } from "@/config/watercolor";
import { BoardTemplate } from "@/components/BoardTemplate";
import { boardDimensions, parseBoardPageSize } from "@/lib/board-sizes";
import {
  getDisplayImage,
  getNorthRotationDeg,
  getPixelsPerFoot,
  getPrintBoardImage,
  isGeoreferenced,
  isProjectScaled,
} from "@/lib/georef";
import { resolvePlanBaseLayer } from "@/lib/plan-base-layer";
import {
  ensureWatercolorForProject,
  resolveWatercolorUrls,
} from "@/lib/watercolor-service";
import { getLegend, getStorage } from "@/lib/storage";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ size?: string; export?: string }>;
};

function exportAssetBase(): string {
  return (
    process.env.LDBG_EXPORT_BASE_URL ??
    process.env.LDBG_INTERNAL_URL ??
    "http://127.0.0.1:3002"
  ).replace(/\/$/, "");
}

function basePath(): string {
  return (process.env.LDBG_BASE_PATH ?? "").replace(/\/$/, "");
}

function fileUrl(projectId: string, filename: string): string {
  return `${exportAssetBase()}${basePath()}/api/projects/${projectId}/files/${encodeURIComponent(filename)}`;
}

export default async function BoardPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const pageSize = parseBoardPageSize(sp.size);
  const exportMode = sp.export === "1";

  const project = await getStorage().loadProject(id);
  if (!project) notFound();

  const legend = await getLegend();
  const features =
    project.features?.length
      ? project.features
      : project.interpretation?.features ?? [];

  const ann = project.images.annotated;
  const clean = project.images.clean;
  const rawBaseImage = exportMode ? getPrintBoardImage(project) : getDisplayImage(project);

  const rawBaseUrl = rawBaseImage ? fileUrl(id, rawBaseImage.filename) : undefined;

  const preset = (project.planSettings?.basePreset ?? "watercolor-soft") as WatercolorPresetId;
  let boardProject = project;
  if (exportMode && presetUsesFilter(preset)) {
    try {
      await ensureWatercolorForProject(id, preset, { forPrint: true });
      boardProject = (await getStorage().loadProject(id)) ?? project;
    } catch (e) {
      console.warn("[board] watercolor ensure failed:", e instanceof Error ? e.message : e);
    }
  }

  const wcUrls = await resolveWatercolorUrls(boardProject, id, exportMode);
  const watercolorPreviewUrl = wcUrls.preview ? fileUrl(id, wcUrls.preview) : undefined;
  const watercolorFullUrl = wcUrls.full ? fileUrl(id, wcUrls.full) : undefined;

  const planBase = resolvePlanBaseLayer(boardProject.planSettings, {
    rawUrl: rawBaseUrl,
    watercolorPreviewUrl,
    watercolorFullUrl,
    forPrint: exportMode,
  });

  const bp = basePath();
  const renderSlots = project.renderSlots
    ? {
        hero: project.renderSlots.hero
          ? fileUrl(id, project.renderSlots.hero)
          : undefined,
        entry: project.renderSlots.entry
          ? fileUrl(id, project.renderSlots.entry)
          : undefined,
        fire_pit: project.renderSlots.fire_pit
          ? fileUrl(id, project.renderSlots.fire_pit)
          : undefined,
        hero_dusk: project.renderSlots.hero_dusk
          ? fileUrl(id, project.renderSlots.hero_dusk)
          : undefined,
      }
    : undefined;

  const dims = boardDimensions(pageSize);

  return (
    <>
      {exportMode ? (
        <style>{`
          @page { size: ${dims.widthIn}in ${dims.heightIn}in; margin: 0; }
          html, body { margin: 0; padding: 0; overflow: hidden; width: 100%; height: 100%; }
        `}</style>
      ) : null}
      {!exportMode ? (
        <div
          style={{
            padding: "8px 12px",
            background: "#1c1917",
            color: "#fff",
            fontSize: 12,
            fontFamily: "system-ui,sans-serif",
          }}
        >
          Board preview · {pageSize} ·{" "}
          <a href={`${bp}/projects/${id}`} style={{ color: "#6ee7b7" }}>
            Back to project
          </a>
        </div>
      ) : null}
      <BoardTemplate
          projectId={id}
          metadata={project.metadata}
          features={features}
          legend={legend}
          northRotationDeg={getNorthRotationDeg(project)}
          designContent={project.designContent}
          planSettings={boardProject.planSettings}
          boardSettings={boardProject.boardSettings}
          imageWidth={rawBaseImage?.width ?? 1000}
          imageHeight={rawBaseImage?.height ?? 1000}
          pixelsPerFoot={getPixelsPerFoot(boardProject)}
          annotatedUrl={
            ann ? fileUrl(id, ann.filename) : undefined
          }
          cleanUrl={clean ? fileUrl(id, clean.filename) : undefined}
          baseImageUrl={planBase.url}
          baseImageFilter={planBase.svgFilter}
          featureFills={boardProject.featureFills}
          featureFillImageUrl={(filename) => fileUrl(id, filename)}
          hasFilledFeatures={Object.values(boardProject.featureFills ?? {}).some(
            (e) => e.status === "filled"
          )}
          renderSlots={renderSlots}
          pageSize={pageSize}
          basePath={bp}
          scaleVerification={
            project.scaleVerification?.passed
              ? project.scaleVerification
              : undefined
          }
          requiresScaleVerification={isGeoreferenced(project)}
          calibrated={isProjectScaled(project)}
        />
    </>
  );
}
