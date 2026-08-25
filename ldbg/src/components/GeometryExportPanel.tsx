"use client";

import { useState } from "react";
import { withBasePath } from "@/lib/paths";
import type { GeometryExportFormat } from "@/lib/geometry-export-service";

type Props = {
  projectId: string;
  hasFeatures: boolean;
  hasGeoref: boolean;
  hasElevationAnalysis: boolean;
  exportBlocked?: boolean;
  exportBlockReason?: string;
};

const FORMATS: {
  format: GeometryExportFormat;
  label: string;
  hint: string;
}[] = [
  {
    format: "dxf",
    label: "DXF (Vectorworks)",
    hint: "Projected feet, Prop-/Ex- layers",
  },
  {
    format: "geojson",
    label: "GeoJSON (WGS84)",
    hint: "GIS / web",
  },
  {
    format: "kml",
    label: "KML",
    hint: "Google Earth",
  },
  {
    format: "kmz",
    label: "KMZ",
    hint: "Zipped KML for mobile",
  },
  {
    format: "stakeout-csv",
    label: "Stakeout CSV",
    hint: "Vertex points + DTM elevation",
  },
  {
    format: "contours-dxf",
    label: "Contours DXF",
    hint: "From elevation analysis",
  },
];

export function GeometryExportPanel({
  projectId,
  hasFeatures,
  hasGeoref,
  hasElevationAnalysis,
  exportBlocked,
  exportBlockReason,
}: Props) {
  const [busy, setBusy] = useState<GeometryExportFormat | null>(null);
  const [error, setError] = useState("");

  async function download(format: GeometryExportFormat) {
    setBusy(format);
    setError("");
    try {
      const res = await fetch(
        withBasePath(`/api/projects/${projectId}/export-geometry`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ format }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Export failed");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? `export.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  const disabled =
    !hasFeatures || !hasGeoref || exportBlocked || busy !== null;

  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div>
        <h2 className="text-lg font-semibold text-stone-900">Geometry export</h2>
        <p className="text-sm text-stone-600">
          Export proposed features for Vectorworks, GIS, stakeout, and Google Earth
          (Addendum A7). DXF uses feet in the project CRS with Prop-/Ex- layer names.
        </p>
      </div>

      {!hasGeoref ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Ingest a georeferenced WebODM project to enable geometry export.
        </p>
      ) : null}

      {!hasElevationAnalysis ? (
        <p className="text-xs text-stone-500">
          Contours DXF and stakeout elevations need elevation analysis (DTM).
        </p>
      ) : null}

      {exportBlocked && exportBlockReason ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {exportBlockReason}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        {FORMATS.map(({ format, label, hint }) => {
          const needsContours = format === "contours-dxf";
          const btnDisabled =
            disabled || (needsContours && !hasElevationAnalysis);
          return (
            <button
              key={format}
              type="button"
              disabled={btnDisabled}
              onClick={() => download(format)}
              className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-left text-sm hover:bg-white disabled:opacity-40"
            >
              <span className="font-medium text-stone-900">
                {busy === format ? "Exporting…" : label}
              </span>
              <span className="mt-0.5 block text-xs text-stone-500">{hint}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
