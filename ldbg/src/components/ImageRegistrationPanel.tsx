"use client";

import type { Project } from "@/lib/project-schema";
import {
  buildRegistrationDiagnostics,
  formatAspectRatio,
  formatDimensions,
} from "@/lib/image-dimensions";

type Props = {
  project: Project;
};

function MatchBadge({ match, label }: { match: boolean | null; label: string }) {
  if (match == null) {
    return (
      <span className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-500">{label}: —</span>
    );
  }
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-medium ${
        match ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900"
      }`}
    >
      {label}: {match ? "match" : "MISMATCH"}
    </span>
  );
}

function DimRow({
  label,
  width,
  height,
  filename,
}: {
  label: string;
  width: number;
  height: number;
  filename?: string;
}) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-0.5 text-sm">
      <dt className="font-medium text-stone-700">{label}</dt>
      <dd className="text-stone-800">
        {formatDimensions(width, height)}
        <span className="ml-2 text-stone-500">aspect {formatAspectRatio(width, height)}</span>
        {filename ? (
          <span className="ml-2 text-xs text-stone-400">{filename}</span>
        ) : null}
      </dd>
    </div>
  );
}

export function ImageRegistrationPanel({ project }: Props) {
  const diag = buildRegistrationDiagnostics(project);
  const hasAny =
    diag.annotated || diag.clean || diag.annotationBase || diag.fullOrtho;

  if (!hasAny) return null;

  const hasMismatch =
    diag.annotatedMatchesBase === false ||
    diag.annotatedMatchesClean === false;

  return (
    <section
      className={`rounded-xl border p-4 ${
        hasMismatch ? "border-red-300 bg-red-50" : "border-stone-200 bg-white"
      }`}
    >
      <h2 className="text-lg font-semibold text-stone-900">Image registration</h2>
      <p className="mt-1 text-sm text-stone-600">
        Pixel dimensions recorded at ingest. Annotated and clean orthophotos must share the same
        size and aspect ratio for polygons to align.
      </p>

      <dl className="mt-4 space-y-2">
        {diag.annotationBase ? (
          <DimRow
            label="Annotation base"
            width={diag.annotationBase.width}
            height={diag.annotationBase.height}
          />
        ) : null}
        {diag.annotated ? (
          <DimRow
            label="Annotated"
            width={diag.annotated.width}
            height={diag.annotated.height}
            filename={diag.annotated.filename}
          />
        ) : null}
        {diag.clean ? (
          <DimRow
            label="Clean orthophoto"
            width={diag.clean.width}
            height={diag.clean.height}
            filename={diag.clean.filename}
          />
        ) : null}
        {diag.fullOrtho ? (
          <DimRow
            label="Full ortho (GeoTIFF)"
            width={diag.fullOrtho.width}
            height={diag.fullOrtho.height}
          />
        ) : null}
      </dl>

      <div className="mt-3 flex flex-wrap gap-2">
        <MatchBadge match={diag.annotatedMatchesBase} label="Annotated vs base" />
        <MatchBadge match={diag.annotatedMatchesClean} label="Annotated vs clean" />
        {diag.fullOrtho ? (
          <MatchBadge match={diag.cleanMatchesFullOrtho} label="Clean vs full ortho" />
        ) : null}
      </div>

      {diag.interpretCoordSpace ? (
        <div className="mt-4 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
          <p className="font-medium text-stone-800">Interpret coordinate space</p>
          <p className="mt-1">
            Normalized→pixel uses file sent to Claude:{" "}
            {formatDimensions(
              diag.interpretCoordSpace.coordWidth,
              diag.interpretCoordSpace.coordHeight
            )}{" "}
            (aspect{" "}
            {formatAspectRatio(
              diag.interpretCoordSpace.coordWidth,
              diag.interpretCoordSpace.coordHeight
            )}
            ).
          </p>
          {diag.interpretCoordSpace.downscaleFactor > 1.001 ? (
            <p className="mt-1 text-stone-600">
              Claude received a downscaled copy:{" "}
              {formatDimensions(
                diag.interpretCoordSpace.sentWidth,
                diag.interpretCoordSpace.sentHeight
              )}{" "}
              (×{diag.interpretCoordSpace.downscaleFactor.toFixed(3)} via{" "}
              <code className="text-xs">prepareImageForClaude</code>). Coordinates are normalized
              0–1 relative to the full file above, not the clean orthophoto.
            </p>
          ) : (
            <p className="mt-1 text-stone-600">
              No interpret downscale — Claude received the full-resolution annotated file.
            </p>
          )}
        </div>
      ) : null}

      {hasMismatch ? (
        <p className="mt-3 text-sm font-medium text-red-900">
          Dimension mismatch detected. Polygons will not register between layers until annotated
          and clean images share identical pixel dimensions.
        </p>
      ) : null}
    </section>
  );
}
