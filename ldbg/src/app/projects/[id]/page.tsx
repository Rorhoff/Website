"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { CalibrationTool } from "@/components/CalibrationTool";
import { BoardExportPanel } from "@/components/BoardExportPanel";
import { DesignContentPanel } from "@/components/DesignContentPanel";
import { InterpretPanel } from "@/components/InterpretPanel";
import { MetadataForm } from "@/components/MetadataForm";
import { PlanPanel } from "@/components/PlanPanel";
import { PolygonEditorLoader } from "@/components/PolygonEditorLoader";
import { RenderPanel } from "@/components/RenderPanel";
import { WebodmGeorefPanel } from "@/components/WebodmGeorefPanel";
import { DEFAULT_LEGEND, type LegendEntry } from "@/config/legend";
import {
  getDisplayImage,
  getNorthRotationDeg,
  getPixelsPerFoot,
  isGeoreferenced,
  isProjectScaled,
} from "@/lib/georef";
import { projectImageUrl } from "@/lib/image-utils";
import { cloneFeatures } from "@/lib/feature-geometry";
import {
  needsReview,
  type InterpretFeature,
  type StoredInterpretation,
} from "@/lib/interpret-schema";
import type { StoredDesignContent } from "@/lib/design-content-schema";
import { withBasePath } from "@/lib/paths";
import type { BoardSettings, Calibration, EditorSettings, PlanSettings, Project, ProjectMetadata, RenderMeta, RenderSlots } from "@/lib/project-schema";

export default function ProjectPage() {
  const params = useParams();
  const id = params.id as string;
  const [project, setProject] = useState<Project | null>(null);
  const [metadata, setMetadata] = useState<ProjectMetadata | null>(null);
  const [calibration, setCalibration] = useState<Calibration | undefined>();
  const [northRotationDeg, setNorthRotationDeg] = useState(0);
  const [interpretation, setInterpretation] = useState<StoredInterpretation | undefined>();
  const [features, setFeatures] = useState<InterpretFeature[]>([]);
  const [editorSettings, setEditorSettings] = useState<EditorSettings | undefined>();
  const [planSettings, setPlanSettings] = useState<PlanSettings | undefined>();
  const [designContent, setDesignContent] = useState<StoredDesignContent | undefined>();
  const [renderSlots, setRenderSlots] = useState<RenderSlots | undefined>();
  const [renderMeta, setRenderMeta] = useState<RenderMeta | undefined>();
  const [boardSettings, setBoardSettings] = useState<BoardSettings | undefined>();
  const [legend, setLegend] = useState<LegendEntry[]>(DEFAULT_LEGEND);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(withBasePath("/api/legend"))
      .then((r) => r.json())
      .then(setLegend)
      .catch(() => setLegend(DEFAULT_LEGEND));
  }, []);

  useEffect(() => {
    fetch(withBasePath(`/api/projects/${id}`))
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((p: Project) => {
        setProject(p);
        setMetadata(p.metadata);
        setCalibration(p.calibration);
        setNorthRotationDeg(p.northRotationDeg ?? 0);
        setInterpretation(p.interpretation);
        setEditorSettings(p.editorSettings);
        setPlanSettings(p.planSettings);
        setDesignContent(p.designContent);
        setRenderSlots(p.renderSlots);
        setRenderMeta(p.renderMeta);
        setBoardSettings(p.boardSettings);
        if (p.features?.length) {
          setFeatures(p.features);
        } else if (p.interpretation?.features?.length) {
          setFeatures(cloneFeatures(p.interpretation.features));
        } else {
          setFeatures([]);
        }
      })
      .catch(() => setError("Could not load project"));
  }, [id]);

  const persist = useCallback(
    async (patch: Partial<Project>) => {
      setSaving(true);
      try {
        const res = await fetch(withBasePath(`/api/projects/${id}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error("Save failed");
        const updated = await res.json();
        setProject(updated);
      } catch {
        setError("Save failed");
      } finally {
        setSaving(false);
      }
    },
    [id]
  );

  const canEditPolygons = useMemo(() => {
    if (!interpretation || features.length === 0) return false;
    if (!needsReview(interpretation)) return true;
    return !!interpretation.reviewClearedAt;
  }, [interpretation, features.length]);

  const handleEditorAutosave = useCallback(
    (payload: { features: InterpretFeature[]; editorSettings: EditorSettings }) => {
      setFeatures(payload.features);
      setEditorSettings(payload.editorSettings);
      persist({
        features: payload.features,
        editorSettings: payload.editorSettings,
      });
    },
    [persist]
  );

  if (error) {
    return (
      <>
        <AppHeader />
        <main className="p-8 text-red-700">{error}</main>
      </>
    );
  }

  if (!project || !metadata) {
    return (
      <>
        <AppHeader />
        <main className="p-8 text-stone-500">Loading…</main>
      </>
    );
  }

  const ann = project.images.annotated;
  const displayImage = getDisplayImage(project);
  const baseImage = displayImage;
  const pixelsPerFoot = getPixelsPerFoot(project);
  const northDeg = getNorthRotationDeg(project);
  const georef = isGeoreferenced(project);
  const scaled = isProjectScaled(project);

  if (!displayImage) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto max-w-4xl p-8 text-stone-600">
          No display image on this project. Ingest a WebODM export or upload an orthophoto.
        </main>
      </>
    );
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        {georef ? (
          <WebodmGeorefPanel webodm={project.webodm} georeference={project.georeference} />
        ) : (
          <CalibrationTool
            imageUrl={projectImageUrl(id, displayImage.filename)}
            imageWidth={displayImage.width}
            imageHeight={displayImage.height}
            calibration={calibration}
            northRotationDeg={northRotationDeg}
            onCalibrationChange={setCalibration}
            onNorthChange={setNorthRotationDeg}
            onSave={() =>
              persist({
                calibration,
                northRotationDeg,
              })
            }
            saving={saving}
          />
        )}
        {!ann && georef ? (
          <section className="rounded-xl border border-dashed border-stone-300 p-6 text-sm text-stone-600">
            Orthophoto preview is loaded from WebODM. Export an annotation base (Addendum A3)
            or upload your annotated sketch when that flow is ready.
          </section>
        ) : null}
        <MetadataForm
          metadata={metadata}
          onChange={setMetadata}
          onSave={() => persist({ metadata })}
          saving={saving}
        />
        <InterpretPanel
          projectId={id}
          interpretation={interpretation}
          onInterpretation={(next) => {
            setInterpretation(next);
            if (!project.features?.length) {
              setFeatures(cloneFeatures(next.features));
            }
          }}
          calibrated={scaled}
        />
        {canEditPolygons && baseImage ? (
          <PolygonEditorLoader
            imageUrl={projectImageUrl(id, baseImage.filename)}
            imageWidth={baseImage.width}
            imageHeight={baseImage.height}
            features={features}
            legend={legend}
            pixelsPerFoot={pixelsPerFoot}
            editorSettings={editorSettings}
            onAutosave={handleEditorAutosave}
          />
        ) : interpretation && features.length === 0 ? (
          <section className="rounded-xl border border-dashed border-stone-300 p-6 text-sm text-stone-600">
            Run interpret to populate features, then refine them here.
          </section>
        ) : interpretation && needsReview(interpretation) && !interpretation.reviewClearedAt ? (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
            Clear the interpret review queue above before editing polygons.
          </section>
        ) : null}
        {features.length > 0 && baseImage ? (
          <PlanPanel
            features={features}
            legend={legend}
            metadata={metadata}
            calibration={calibration}
            northRotationDeg={northDeg}
            editorSettings={editorSettings}
            imageWidth={baseImage.width}
            imageHeight={baseImage.height}
            baseImageUrl={projectImageUrl(id, baseImage.filename)}
            planSettings={planSettings}
            onPlanSettingsChange={setPlanSettings}
            onSavePlanSettings={() => persist({ planSettings })}
            saving={saving}
          />
        ) : null}
        {features.length > 0 ? (
          <DesignContentPanel
            projectId={id}
            designContent={designContent}
            onDesignContentChange={setDesignContent}
            hasFeatures={features.length > 0}
            calibrated={scaled}
          />
        ) : null}
        {features.length > 0 ? (
          <RenderPanel
            projectId={id}
            renderSlots={renderSlots}
            renderMeta={renderMeta}
            hasDesignContent={!!designContent?.renderPrompts?.length}
            onRendersChange={(payload) => {
              if (payload.renderSlots !== undefined) {
                setRenderSlots(payload.renderSlots);
              }
              if (payload.renderMeta !== undefined) {
                setRenderMeta(payload.renderMeta);
              }
              setProject((p) =>
                p
                  ? {
                      ...p,
                      renderSlots: payload.renderSlots ?? p.renderSlots,
                      renderMeta: payload.renderMeta ?? p.renderMeta,
                    }
                  : p
              );
            }}
          />
        ) : null}
        {features.length > 0 ? (
          <BoardExportPanel
            projectId={id}
            boardSettings={boardSettings}
            onBoardSettingsChange={setBoardSettings}
            onSaveBoardSettings={() => persist({ boardSettings })}
            hasFeatures={features.length > 0}
            saving={saving}
          />
        ) : null}
      </main>
    </>
  );
}
