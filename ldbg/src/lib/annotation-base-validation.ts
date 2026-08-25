import type { Project } from "@/lib/project-schema";
import {
  dimensionMismatchError,
  toDimensionRecord,
} from "@/lib/image-dimensions";
import { readImageDimensionsFromBuffer } from "@/lib/image-dimensions-server";

export type AnnotatedUploadValidation =
  | { ok: true; fileWidth: number; fileHeight: number }
  | { ok: false; error: string };

/**
 * Addendum A3 — annotated upload must exactly match the recorded annotation base.
 * Validates client-reported dimensions and actual file bytes (sharp).
 */
export async function validateAnnotatedUpload(
  project: Project,
  fileBuffer: Buffer,
  clientWidth: number,
  clientHeight: number
): Promise<AnnotatedUploadValidation> {
  const base = project.annotationBase;
  if (!base) {
    return {
      ok: false,
      error:
        "Export an annotation base first (Addendum A3) — annotated uploads require a recorded base size.",
    };
  }

  let fileDims;
  try {
    fileDims = await readImageDimensionsFromBuffer(fileBuffer);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not read annotated image dimensions",
    };
  }

  const expected = toDimensionRecord(base.width, base.height);
  const reported = toDimensionRecord(clientWidth, clientHeight);
  const actual = toDimensionRecord(fileDims.width, fileDims.height);

  if (clientWidth !== fileDims.width || clientHeight !== fileDims.height) {
    return {
      ok: false,
      error: dimensionMismatchError(
        "Annotated upload",
        reported,
        actual,
        "Browser-reported dimensions do not match the file on disk — reload and try again."
      ),
    };
  }

  if (fileDims.width !== base.width || fileDims.height !== base.height) {
    return {
      ok: false,
      error: [
        "Annotated image dimensions do not match the recorded annotation base (Addendum A3).",
        `Expected (annotation base): ${base.width}×${base.height}px.`,
        `Your upload (file bytes): ${fileDims.width}×${fileDims.height}px.`,
        `Client reported: ${clientWidth}×${clientHeight}px.`,
        "Re-export annotation-base.jpg from the app and draw on that file without cropping or resizing.",
      ].join(" "),
    };
  }

  return { ok: true, fileWidth: fileDims.width, fileHeight: fileDims.height };
}
