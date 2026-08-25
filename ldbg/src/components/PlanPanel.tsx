"use client";

import { PlanDrawing } from "@/components/PlanDrawing";
import type { LegendEntry } from "@/config/legend";
import type { StoredElevationAnalysis } from "@/lib/elevation-schema";
import type { GeorefDisplayContext } from "@/lib/georef-display";
import type { InterpretFeature } from "@/lib/interpret-schema";
import type { Calibration, EditorSettings, PlanSettings, ProjectMetadata } from "@/lib/project-schema";

type Props = {
  features: InterpretFeature[];
  legend: LegendEntry[];
  metadata: ProjectMetadata;
  calibration?: Calibration;
  pixelsPerFoot?: number;
  georefCtx?: GeorefDisplayContext;
  elevationAnalysis?: StoredElevationAnalysis;
  northRotationDeg: number;
  editorSettings?: EditorSettings;
  imageWidth: number;
  imageHeight: number;
  baseImageUrl?: string;
  planSettings?: PlanSettings;
  onPlanSettingsChange: (settings: PlanSettings) => void;
  onSavePlanSettings: () => void;
  saving?: boolean;
};

export function PlanPanel({
  features,
  legend,
  metadata,
  calibration,
  pixelsPerFoot,
  georefCtx,
  elevationAnalysis,
  northRotationDeg,
  editorSettings,
  imageWidth,
  imageHeight,
  baseImageUrl,
  planSettings,
  onPlanSettingsChange,
  onSavePlanSettings,
  saving,
}: Props) {
  const settings: PlanSettings = planSettings ?? {
    baseMode: "orthophoto",
    orthophotoOpacity: 0.4,
    showContours: false,
    showDrainageArrows: false,
    contourMinorFt: 1,
    contourMajorFt: 5,
  };

  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">Plan drawing</h2>
          <p className="text-sm text-stone-600">
            SVG plan with numbered callouts, textures, north arrow, and scale — sized for a 24×36
            sheet at 300 DPI.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-lg bg-stone-50 p-3 text-sm">
        <label className="block">
          <span className="text-xs font-medium text-stone-600">Base layer</span>
          <select
            className="mt-1 block rounded border border-stone-300 px-2 py-1"
            value={settings.baseMode}
            onChange={(e) =>
              onPlanSettingsChange({
                ...settings,
                baseMode: e.target.value as PlanSettings["baseMode"],
              })
            }
          >
            <option value="orthophoto">Desaturated orthophoto</option>
            <option value="white">White + house footprint</option>
          </select>
        </label>
        {settings.baseMode === "orthophoto" ? (
          <label className="block min-w-48">
            <span className="text-xs font-medium text-stone-600">
              Orthophoto opacity ({Math.round(settings.orthophotoOpacity * 100)}%)
            </span>
            <input
              type="range"
              min={0.1}
              max={0.8}
              step={0.05}
              value={settings.orthophotoOpacity}
              onChange={(e) =>
                onPlanSettingsChange({
                  ...settings,
                  orthophotoOpacity: parseFloat(e.target.value),
                })
              }
              className="mt-1 w-full"
            />
          </label>
        ) : null}
        <button
          type="button"
          onClick={onSavePlanSettings}
          disabled={saving}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save plan settings"}
        </button>
      </div>

      {features.length === 0 ? (
        <p className="text-sm text-stone-500">Add features via interpret and the polygon editor.</p>
      ) : (
        <PlanDrawing
          project={{
            features,
            northRotationDeg,
            calibration,
            pixelsPerFoot,
            georefCtx,
            elevationAnalysis,
            editorSettings,
            metadata,
          }}
          legend={legend}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          baseImageUrl={baseImageUrl}
          planSettings={settings}
          displayWidth={900}
        />
      )}
    </section>
  );
}
