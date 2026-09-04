"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AnnotationBasePanel } from "@/components/AnnotationBasePanel";
import { ImageRegistrationPanel } from "@/components/ImageRegistrationPanel";
import { AppHeader } from "@/components/AppHeader";
import { CalibrationTool } from "@/components/CalibrationTool";
import { BoardExportPanel } from "@/components/BoardExportPanel";
import { GeneralNotesPanel } from "@/components/GeneralNotesPanel";
import { GeometryExportPanel } from "@/components/GeometryExportPanel";
import { DesignContentPanel } from "@/components/DesignContentPanel";
import { ElevationPanel } from "@/components/ElevationPanel";
import { InterpretPanel } from "@/components/InterpretPanel";
import { LegacyOrthophotoPanel } from "@/components/LegacyOrthophotoPanel";
import { MetadataForm } from "@/components/MetadataForm";
import { PlanPanel } from "@/components/PlanPanel";
import { PolygonEditorLoader } from "@/components/PolygonEditorLoader";
import { RenderPanel } from "@/components/RenderPanel";
import { ScaleVerificationPanel } from "@/components/ScaleVerificationPanel";
import { WatercolorBasePanel } from "@/components/WatercolorBasePanel";
import { WebodmGeorefPanel } from "@/components/WebodmGeorefPanel";
import { DEFAULT_LEGEND, type LegendEntry } from "@/config/legend";
import {
  getDisplayImage,
  getNorthRotationDeg,
  getPixelsPerFoot,
  getTracingImage,
  imageDimensionsMatch,
  isGeoreferenced,
  isProjectScaled,
} from "@/lib/georef";
import { getGeorefDisplayContext } from "@/lib/georef-display";
import { projectImageUrl } from "@/lib/image-utils";
import { cloneFeatures } from "@/lib/feature-geometry";
import {
  type InterpretFeature,
  type StoredInterpretation,
} from "@/lib/interpret-schema";
import type { StoredDesignContent } from "@/lib/design-content-schema";
import type { BlenderRenders } from "@/lib/blender-schema";
import { projectHasMesh } from "@/lib/blender-utils";
import type { StoredElevationAnalysis } from "@/lib/elevation-schema";
import { withBasePath } from "@/lib/paths";
import { canExportBoard } from "@/lib/scale-verification";
import type { FeatureFillEntry } from "@/lib/feature-fill-schema";
import type {
  BoardSettings,
  Calibration,
  EditorSettings,
  PlanSettings,
  Project,
  ProjectMetadata,
  RenderMeta,
  RenderSlots,
  ScaleVerification,
} from "@/lib/project-schema";

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
  const [featureFills, setFeatureFills] = useState<Record<string, FeatureFillEntry> | undefined>();
  const [featureFillTotalCostUsd, setFeatureFillTotalCostUsd] = useState<number | undefined>();
  const [designContent, setDesignContent] = useState<StoredDesignContent | undefined>();
  const [elevationAnalysis, setElevationAnalysis] = useState<
    StoredElevationAnalysis | undefined
  >();
  const [renderSlots, setRenderSlots] = useState<RenderSlots | undefined>();
  const [renderMeta, setRenderMeta] = useState<RenderMeta | undefined>();
  const [blenderRenders, setBlenderRenders] = useState<BlenderRenders | undefined>();
  const [boardSettings, setBoardSettings] = useState<BoardSettings | undefined>();
  const [scaleVerification, setScaleVerification] = useState<
    ScaleVerification | undefined
  >();
  const [legend, setLegend] = useState<LegendEntry[]>(DEFAULT_LEGEND);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");

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
        setFeatureFills(p.featureFills);
        setFeatureFillTotalCostUsd(p.featureFillTotalCostUsd);
        setDesignContent(p.designContent);
        setElevationAnalysis(p.elevationAnalysis);
        setRenderSlots(p.renderSlots);
        setRenderMeta(p.renderMeta);
        setBlenderRenders(p.blenderRenders);
        setBoardSettings(p.boardSettings);
        setScaleVerification(p.scaleVerification);
        if (p.features?.length) {
          setFeatures(p.features);
        } else if (p.interpretation?.features?.length) {
          setFeatures(cloneFeatures(p.interpretation.features));
        } else {
          setFeatures([]);
        }
      })
      .catch(() => setLoadError("Could not load project"));
  }, [id]);

  const persist = useCallback(
    async (patch: Partial<Project>, options?: { silent?: boolean }) => {
      if (!options?.silent) setSaving(true);
      try {
        const res = await fetch(withBasePath(`/api/projects/${id}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          let detail = "Save failed";
          try {
            const data = (await res.json()) as { error?: string };
            if (data.error) detail = data.error;
          } catch {
            if (res.status === 503) detail = "LDBG is restarting — try again in a few seconds";
          }
          throw new Error(detail);
        }
        const updated = await res.json();
        setProject(updated);
        setSaveNotice("");
        if ("calibration" in patch) {
          setCalibration(updated.calibration);
        }
        if ("northRotationDeg" in patch) {
          setNorthRotationDeg(updated.northRotationDeg ?? 0);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Save failed";
        setSaveNotice(options?.silent ? `Autosave failed — ${msg}` : msg);
      } finally {
        if (!options?.silent) setSaving(false);
      }
    },
    [id]
  );

  const handleScaleDraft = useCallback((cal: Calibration | undefined) => {
    setCalibration(cal);
  }, []);

  const handleProjectRefresh = useCallback((p: Project) => {
    setProject(p);
    setMetadata(p.metadata);
    setInterpretation(p.interpretation);
    setScaleVerification(p.scaleVerification);
    if (p.features?.length) {
      setFeatures(p.features);
    }
  }, []);

  const reloadProject = useCallback(() => {
    fetch(withBasePath(`/api/projects/${id}`))
      .then((r) => {
        if (!r.ok) throw new Error("Reload failed");
        return r.json();
      })
      .then((p: Project) => handleProjectRefresh(p))
      .catch(() => setSaveNotice("Could not reload project after upload."));
  }, [id, handleProjectRefresh]);

  const handleEditorAutosave = useCallback(
    (payload: { features: InterpretFeature[]; editorSettings: EditorSettings }) => {
      setFeatures(payload.features);
      setEditorSettings(payload.editorSettings);
      void persist(
        {
          features: payload.features,
          editorSettings: payload.editorSettings,
        },
        { silent: true }
      );
    },
    [persist]
  );

  const handleEditorSettingsChange = useCallback(
    (settings: EditorSettings) => {
      setEditorSettings(settings);
      void persist({ editorSettings: settings }, { silent: true });
    },
    [persist]
  );

  if (loadError) {
    return (
      <>
        <AppHeader />
        <main className="p-8 text-red-700">{loadError}</main>
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
  const tracingImage = getTracingImage(project) ?? displayImage;
  const baseImage = tracingImage ?? displayImage;
  const cleanImage = project.images.clean;
  const pixelsPerFoot = getPixelsPerFoot(project);
  const northDeg = getNorthRotationDeg(project);
  const georef = isGeoreferenced(project);
  const scaled = isProjectScaled(project);
  const calibratedForInterpret = Boolean(
    calibration?.pixelsPerFoot ?? scaled
  );
  const exportGate = canExportBoard(project);

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

  const georefContext = baseImage
    ? getGeorefDisplayContext(project, baseImage.width, baseImage.height)
    : undefined;
  const hasPropertyBoundary = features.some((f) => f.featureType === "property_boundary");
  const cvMaskUrl = interpretation?.importMaskFilename
    ? projectImageUrl(id, interpretation.importMaskFilename)
    : undefined;
  const canEditPolygons = true;

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        {saveNotice ? (
          <div
            role="alert"
            className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
          >
            <p>{saveNotice}</p>
            <button
              type="button"
              onClick={() => setSaveNotice("")}
              className="shrink-0 rounded border border-red-300 bg-white px-2 py-0.5 text-xs font-medium text-red-800 hover:bg-red-100"
            >
              Dismiss
            </button>
          </div>
        ) : null}
        {georef &&
        project.webodm?.georeferencingMode === "gps" &&
        !scaleVerification?.passed ? (
          <div
            role="status"
            className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          >
            <strong>GPS georeferenced</strong> — scale is unverified. Complete an
            independent scale check before exporting.
          </div>
        ) : null}
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
            onScaleDraft={handleScaleDraft}
            onApply={(cal) => {
              setCalibration(cal);
              void persist({ calibration: cal, northRotationDeg });
            }}
            onNorthChange={setNorthRotationDeg}
            onSave={({ calibration: cal, northRotationDeg: north }) => {
              setCalibration(cal);
              setNorthRotationDeg(north);
              void persist({ calibration: cal, northRotationDeg: north });
            }}
            saving={saving}
          />
        )}
        {!georef && !ann ? (
          <LegacyOrthophotoPanel
            projectId={id}
            missing="annotated"
            onUploaded={reloadProject}
          />
        ) : null}
        {!georef && !cleanImage ? (
          <LegacyOrthophotoPanel
            projectId={id}
            missing="clean"
            onUploaded={reloadProject}
          />
        ) : null}
        {georef && pixelsPerFoot ? (
          <ScaleVerificationPanel
            imageUrl={projectImageUrl(id, displayImage.filename)}
            imageWidth={displayImage.width}
            imageHeight={displayImage.height}
            pixelsPerFoot={pixelsPerFoot}
            scaleVerification={scaleVerification}
            georeferencingMode={project.webodm?.georeferencingMode}
            onChange={setScaleVerification}
            onSave={() => persist({ scaleVerification })}
            saving={saving}
          />
        ) : null}
        {baseImage ? (
          <WatercolorBasePanel
            projectId={id}
            sourceImageUrl={projectImageUrl(id, ann?.filename ?? baseImage.filename)}
            imageWidth={baseImage.width}
            imageHeight={baseImage.height}
            editorSettings={editorSettings}
            onEditorSettingsChange={handleEditorSettingsChange}
            ready={scaled}
          />
        ) : null}
        {georef ? (
          <AnnotationBasePanel
            projectId={id}
            annotationBase={project.annotationBase}
            hasAnnotated={!!ann}
            annotatedFilename={ann?.filename}
            onProjectUpdate={handleProjectRefresh}
          />
        ) : null}
        <ImageRegistrationPanel project={project} />
        <MetadataForm
          metadata={metadata}
          onChange={setMetadata}
          onSave={() => persist({ metadata })}
          saving={saving}
        />
        {canEditPolygons && baseImage ? (
          <PolygonEditorLoader
            projectId={id}
            annotatedImageUrl={projectImageUrl(id, ann?.filename ?? baseImage.filename)}
            cleanImageUrl={
              cleanImage &&
              imageDimensionsMatch(cleanImage, baseImage)
                ? projectImageUrl(id, cleanImage.filename)
                : undefined
            }
            imageWidth={baseImage.width}
            imageHeight={baseImage.height}
            features={features}
            legend={legend}
            pixelsPerFoot={pixelsPerFoot}
            georefContext={georefContext}
            calibrationDistanceFeet={calibration?.distanceFeet}
            editorSettings={editorSettings}
            maskImageUrl={cvMaskUrl}
            onAutosave={handleEditorAutosave}
          />
        ) : null}
        <InterpretPanel
          projectId={id}
          interpretation={interpretation}
          hasHandDrawnFeatures={features.length > 0}
          hasPropertyBoundary={hasPropertyBoundary}
          hasCleanOrtho={!!project.images.clean}
          onInterpretation={(next) => {
            setInterpretation(next);
            setFeatures(cloneFeatures(next.features));
          }}
          calibrated={calibratedForInterpret}
          needsAnnotated={georef && !ann}
        />
        {features.length > 0 && baseImage ? (
          <PlanPanel
            projectId={id}
            features={features}
            legend={legend}
            metadata={metadata}
            calibration={calibration}
            pixelsPerFoot={pixelsPerFoot}
            georefCtx={georefContext}
            elevationAnalysis={elevationAnalysis}
            northRotationDeg={northDeg}
            editorSettings={editorSettings}
            imageWidth={baseImage.width}
            imageHeight={baseImage.height}
            rawBaseImageUrl={projectImageUrl(id, baseImage.filename)}
            cleanImageUrl={
              cleanImage && imageDimensionsMatch(cleanImage, baseImage)
                ? projectImageUrl(id, cleanImage.filename)
                : undefined
            }
            planSettings={planSettings}
            featureFills={featureFills}
            featureFillTotalCostUsd={featureFillTotalCostUsd}
            onPlanSettingsChange={setPlanSettings}
            onFeatureFillsChange={(fills, total) => {
              setFeatureFills(fills);
              if (total != null) setFeatureFillTotalCostUsd(total);
            }}
            onSavePlanSettings={() => persist({ planSettings })}
            saving={saving}
          />
        ) : null}
        {features.length > 0 && georef ? (
          <ElevationPanel
            projectId={id}
            project={project}
            features={features}
            elevationAnalysis={elevationAnalysis}
            planSettings={planSettings}
            onElevationAnalysis={setElevationAnalysis}
            onFeaturesChange={setFeatures}
            onPlanSettingsChange={setPlanSettings}
            onSaveFeatures={() => persist({ features })}
            onSavePlanSettings={() => persist({ planSettings })}
            saving={saving}
          />
        ) : null}
        {features.length > 0 ? (
          <DesignContentPanel
            projectId={id}
            features={features}
            legend={legend}
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
            blenderRenders={blenderRenders}
            hasDesignContent={!!designContent?.renderPrompts?.length}
            hasMesh={projectHasMesh(project)}
            onRendersChange={(payload) => {
              if (payload.renderSlots !== undefined) {
                setRenderSlots(payload.renderSlots);
              }
              if (payload.renderMeta !== undefined) {
                setRenderMeta(payload.renderMeta);
              }
              if (payload.blenderRenders !== undefined) {
                setBlenderRenders(payload.blenderRenders);
              }
              setProject((p) =>
                p
                  ? {
                      ...p,
                      renderSlots: payload.renderSlots ?? p.renderSlots,
                      renderMeta: payload.renderMeta ?? p.renderMeta,
                      blenderRenders: payload.blenderRenders ?? p.blenderRenders,
                    }
                  : p
              );
            }}
          />
        ) : null}
        {features.length > 0 && georef ? (
          <GeometryExportPanel
            projectId={id}
            hasFeatures={features.length > 0}
            hasGeoref={!!georef}
            hasElevationAnalysis={!!elevationAnalysis?.contours?.length}
            exportBlocked={!exportGate.allowed}
            exportBlockReason={exportGate.reason}
          />
        ) : null}
        {features.length > 0 ? (
          <GeneralNotesPanel
            boardSettings={boardSettings}
            onChange={setBoardSettings}
            onSave={() => persist({ boardSettings })}
            saving={saving}
          />
        ) : null}
        {features.length > 0 ? (
          <BoardExportPanel
            projectId={id}
            boardSettings={boardSettings}
            onBoardSettingsChange={setBoardSettings}
            onSaveBoardSettings={() => persist({ boardSettings })}
            hasFeatures={features.length > 0}
            exportBlocked={!exportGate.allowed}
            exportBlockReason={exportGate.reason}
            saving={saving}
          />
        ) : null}
      </main>
    </>
  );
}
