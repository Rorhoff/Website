"use client";

import { useCallback, useState } from "react";
import type { InterpretFeature } from "@/lib/interpret-schema";
import type {
  FeatureElevationAnalysis,
  StoredElevationAnalysis,
} from "@/lib/elevation-schema";
import { projectHasDtm } from "@/lib/elevation-utils";
import type { PlanSettings, Project, WebodmFileCheck } from "@/lib/project-schema";
import { withBasePath } from "@/lib/paths";

type Props = {
  projectId: string;
  project: Project;
  features: InterpretFeature[];
  elevationAnalysis?: StoredElevationAnalysis;
  planSettings?: PlanSettings;
  onElevationAnalysis: (analysis: StoredElevationAnalysis) => void;
  onFeaturesChange: (features: InterpretFeature[]) => void;
  onPlanSettingsChange: (settings: PlanSettings) => void;
  onSaveFeatures: () => void;
  onSavePlanSettings: () => void;
  saving?: boolean;
};

function dtmChecklistRow(checklist: WebodmFileCheck[] | undefined) {
  return checklist?.find((c) => c.key === "dtm");
}

export function ElevationPanel({
  projectId,
  project,
  features,
  elevationAnalysis,
  planSettings,
  onElevationAnalysis,
  onFeaturesChange,
  onPlanSettingsChange,
  onSaveFeatures,
  onSavePlanSettings,
  saving,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const hasDtm = projectHasDtm(project);
  const dtmRow = dtmChecklistRow(project.webodm?.checklist);
  const designFeatures = features.filter((f) => !f.existing);

  const settings: PlanSettings = planSettings ?? {
    baseMode: "orthophoto",
    basePreset: "off",
    orthophotoOpacity: 0.4,
    showFeatureOutlines: true,
    showContours: false,
    showDrainageArrows: false,
    contourMinorFt: 1,
    contourMajorFt: 5,
  };

  const analysisById = new Map<string, FeatureElevationAnalysis>(
    elevationAnalysis?.features.map((f) => [f.featureId, f]) ?? []
  );

  const runAnalysis = useCallback(
    async (force = false) => {
      setBusy(true);
      setError("");
      try {
        const res = await fetch(
          withBasePath(`/api/projects/${projectId}/elevation-analyze`),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              force,
              contourMinorFt: settings.contourMinorFt,
              contourMajorFt: settings.contourMajorFt,
            }),
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Analysis failed");
        onElevationAnalysis(data.elevationAnalysis);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Analysis failed");
      } finally {
        setBusy(false);
      }
    },
    [
      projectId,
      onElevationAnalysis,
      settings.contourMinorFt,
      settings.contourMajorFt,
    ]
  );

  function updateTargetElevation(featureId: string, value: string) {
    const parsed = value.trim() === "" ? undefined : parseFloat(value);
    onFeaturesChange(
      features.map((f) =>
        f.id === featureId
          ? {
              ...f,
              targetElevationFeet:
                parsed != null && !Number.isNaN(parsed) ? parsed : undefined,
            }
          : f
      )
    );
  }

  if (!project.webodm) {
    return null;
  }

  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div>
        <h2 className="text-lg font-semibold text-stone-900">Elevation &amp; grading</h2>
        <p className="text-sm text-stone-600">
          Sample the WebODM DTM for slope, cut/fill, contours, and drainage — then pass facts to
          design content.
        </p>
      </div>

      <div className="rounded-lg bg-stone-50 p-3 text-sm">
        <p>
          <span className="font-medium">DTM:</span>{" "}
          {hasDtm ? (
            <span className="text-emerald-800">
              {dtmRow?.label ?? "dtm.tif"} on disk
              {project.dtmCache ? " · cache built" : ""}
            </span>
          ) : (
            <span className="text-amber-800">
              Not ingested — re-import WebODM export with <code>odm_dem/dtm.tif</code>
            </span>
          )}
        </p>
      </div>

      {designFeatures.length === 0 ? (
        <p className="text-sm text-stone-500">Add design features before running elevation analysis.</p>
      ) : !hasDtm ? null : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => runAnalysis(!!elevationAnalysis)}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy
                ? "Analyzing…"
                : elevationAnalysis
                  ? "Re-run elevation analysis"
                  : "Run elevation analysis"}
            </button>
            {elevationAnalysis ? (
              <span className="text-xs text-stone-500">
                Last run {new Date(elevationAnalysis.analyzedAt).toLocaleString()}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-4 rounded-lg border border-stone-200 p-3 text-sm">
            <label className="block">
              <span className="text-xs font-medium text-stone-600">Contour minor (ft)</span>
              <input
                type="number"
                min={0.5}
                step={0.5}
                className="mt-1 block w-24 rounded border px-2 py-1"
                value={settings.contourMinorFt}
                onChange={(e) =>
                  onPlanSettingsChange({
                    ...settings,
                    contourMinorFt: parseFloat(e.target.value) || 1,
                  })
                }
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-stone-600">Contour major (ft)</span>
              <input
                type="number"
                min={1}
                step={1}
                className="mt-1 block w-24 rounded border px-2 py-1"
                value={settings.contourMajorFt}
                onChange={(e) =>
                  onPlanSettingsChange({
                    ...settings,
                    contourMajorFt: parseFloat(e.target.value) || 5,
                  })
                }
              />
            </label>
            <label className="flex items-center gap-2 self-end">
              <input
                type="checkbox"
                checked={settings.showContours ?? false}
                onChange={(e) =>
                  onPlanSettingsChange({ ...settings, showContours: e.target.checked })
                }
              />
              Show contours on plan
            </label>
            <label className="flex items-center gap-2 self-end">
              <input
                type="checkbox"
                checked={settings.showDrainageArrows ?? false}
                onChange={(e) =>
                  onPlanSettingsChange({
                    ...settings,
                    showDrainageArrows: e.target.checked,
                  })
                }
              />
              Show drainage arrows
            </label>
            <button
              type="button"
              onClick={onSavePlanSettings}
              disabled={saving}
              className="self-end rounded border px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Save plan layer settings
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-stone-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase text-stone-500">
                <tr>
                  <th className="px-3 py-2">Feature</th>
                  <th className="px-3 py-2">Elev (ft)</th>
                  <th className="px-3 py-2">Slope %</th>
                  <th className="px-3 py-2">Target pad (ft)</th>
                  <th className="px-3 py-2">Cut / fill (cy)</th>
                  <th className="px-3 py-2">Flags</th>
                </tr>
              </thead>
              <tbody>
                {designFeatures.map((f) => {
                  const a = analysisById.get(f.id);
                  return (
                    <tr key={f.id} className="border-t border-stone-100">
                      <td className="px-3 py-2 font-medium text-stone-900">
                        {f.label || f.id}
                        <span className="ml-1 text-xs font-normal text-stone-500">
                          {f.featureType}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-stone-700">
                        {a
                          ? `${a.elevationFeet.min.toFixed(1)}–${a.elevationFeet.max.toFixed(1)} (μ ${a.elevationFeet.mean.toFixed(1)})`
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-stone-700">
                        {a
                          ? `${a.slopePct.min.toFixed(1)}–${a.slopePct.max.toFixed(1)} (μ ${a.slopePct.mean.toFixed(1)})`
                          : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          step={0.1}
                          className="w-24 rounded border px-2 py-1 text-sm"
                          placeholder="—"
                          value={f.targetElevationFeet ?? ""}
                          onChange={(e) => updateTargetElevation(f.id, e.target.value)}
                          onBlur={onSaveFeatures}
                        />
                      </td>
                      <td className="px-3 py-2 text-stone-700">
                        {a?.cutFill
                          ? `${a.cutFill.cutCubicYards} / ${a.cutFill.fillCubicYards} (net ${a.cutFill.netCubicYards})`
                          : a?.waterFeatureHead
                            ? `Head ${a.waterFeatureHead.headFeet.toFixed(1)} ft`
                            : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-amber-900">
                        {a?.flags.length ? (
                          <ul className="list-disc pl-4">
                            {a.flags.map((flag, i) => (
                              <li key={i}>{flag}</li>
                            ))}
                          </ul>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-stone-500">
            Set a target pad elevation (feet) on polygons, save, then re-run analysis for cut/fill
            volumes in cubic yards.
          </p>
        </>
      )}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </section>
  );
}
