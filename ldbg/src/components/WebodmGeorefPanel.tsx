"use client";

import type { Georeference, WebodmFileCheck, WebodmIngest } from "@/lib/project-schema";

type Props = {
  webodm?: WebodmIngest;
  georeference?: Georeference;
};

export function WebodmGeorefPanel({ webodm, georeference }: Props) {
  if (!webodm && !georeference) return null;

  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div>
        <h2 className="text-lg font-semibold text-stone-900">WebODM georeference</h2>
        <p className="text-sm text-stone-600">
          Scale and north come from the orthophoto affine transform — no manual calibration.
        </p>
      </div>

      {webodm?.georeferencingMode === "gps" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>GPS georeferenced</strong> — no ground control points found. Scale is
          unverified until you complete an independent scale check (Addendum A2).
        </div>
      ) : null}

      {webodm?.georeferencingMode === "gcp" ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <strong>GCP georeferenced</strong>
          {webodm.gcpCount != null ? ` — ${webodm.gcpCount} control point(s) in gcp_list.txt` : ""}
        </div>
      ) : null}

      {georeference ? (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-stone-500">CRS</dt>
            <dd className="font-mono text-stone-900">{georeference.crs}</dd>
          </div>
          <div>
            <dt className="text-stone-500">Ground sample distance</dt>
            <dd className="text-stone-900">
              {georeference.gsdInches.toFixed(3)} in/pixel ({georeference.gsdMeters.toFixed(4)}{" "}
              m/pixel)
            </dd>
          </div>
          <div>
            <dt className="text-stone-500">Derived scale</dt>
            <dd className="text-stone-900">
              {georeference.pixelsPerFoot.toFixed(2)} px/ft
            </dd>
          </div>
          <div>
            <dt className="text-stone-500">Full raster</dt>
            <dd className="text-stone-900">
              {georeference.widthPx.toLocaleString()} × {georeference.heightPx.toLocaleString()} px
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-stone-500">Bounds (projected)</dt>
            <dd className="font-mono text-xs text-stone-800">
              {georeference.boundsProjected.minX.toFixed(2)},{" "}
              {georeference.boundsProjected.minY.toFixed(2)} →{" "}
              {georeference.boundsProjected.maxX.toFixed(2)},{" "}
              {georeference.boundsProjected.maxY.toFixed(2)}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-stone-500">Bounds (WGS84)</dt>
            <dd className="font-mono text-xs text-stone-800">
              {georeference.boundsWgs84.minY.toFixed(6)}°N,{" "}
              {georeference.boundsWgs84.minX.toFixed(6)}°W →{" "}
              {georeference.boundsWgs84.maxY.toFixed(6)}°N,{" "}
              {georeference.boundsWgs84.maxX.toFixed(6)}°W
            </dd>
          </div>
        </dl>
      ) : null}

      {webodm?.checklist?.length ? (
        <div>
          <h3 className="mb-2 text-sm font-medium text-stone-800">Ingest checklist</h3>
          <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
            {webodm.checklist.map((row) => (
              <ChecklistRow key={row.key} row={row} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function ChecklistRow({ row }: { row: WebodmFileCheck }) {
  const status = row.found ? "Found" : row.required ? "Missing (required)" : "Not found";
  const tone = row.found
    ? "text-emerald-800"
    : row.required
      ? "text-red-800"
      : "text-stone-500";

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
      <div>
        <span className="font-medium text-stone-900">{row.label}</span>
        <span className="ml-2 font-mono text-xs text-stone-500">{row.relativePath}</span>
      </div>
      <span className={`text-xs font-medium ${tone}`}>{status}</span>
    </li>
  );
}
