import { NextResponse } from "next/server";
import sharp from "sharp";
import { validateAnnotatedUpload } from "@/lib/annotation-base-validation";
import { logImageIngestDiagnostic } from "@/lib/image-dimensions";
import { readImageDimensionsFromBuffer } from "@/lib/image-dimensions-server";
import { getStorage } from "@/lib/storage";
import {
  checkContentLengthHeader,
  payloadTooLargeResponse,
  UPLOAD_MAX_BYTES,
} from "@/lib/upload-limits";

export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

const BROWSER_DECODABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

type Ext = "jpg" | "png" | "webp";

function extForMime(type: string): Ext {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

/** Kept in step with needsServerDecode on the client. */
function isTiff(file: File): boolean {
  return file.type === "image/tiff" || /\.tiff?$/i.test(file.name);
}

type Prepared = { ok: true; buf: Buffer; width: number; height: number; ext: Ext };
type Rejected = { ok: false; error: string; status: number };

async function validateImageFile(
  file: File,
  label: string,
  reportedW: number,
  reportedH: number
): Promise<Prepared | Rejected> {
  if (file.size > UPLOAD_MAX_BYTES) {
    return { ok: false, error: "File too large", status: 413 };
  }
  const tiff = isTiff(file);
  if (!tiff && !BROWSER_DECODABLE.has(file.type)) {
    return {
      ok: false,
      error: `${label} must be JPEG, PNG, WebP, or TIFF`,
      status: 400,
    };
  }

  const raw = Buffer.from(await file.arrayBuffer());

  if (tiff) {
    // The browser could not open it, so it sent the bytes as they are and no
    // dimensions with them. Convert to something the app can display and take
    // the size from the result. Alpha is common on drone orthos, where the
    // frame's nodata edges are transparent, and flattening turns those black.
    try {
      const meta = await sharp(raw).metadata();
      const buf = meta.hasAlpha
        ? await sharp(raw).png().toBuffer()
        : await sharp(raw).jpeg({ quality: 92 }).toBuffer();
      const dims = await readImageDimensionsFromBuffer(buf);
      return {
        ok: true,
        buf,
        width: dims.width,
        height: dims.height,
        ext: meta.hasAlpha ? "png" : "jpg",
      };
    } catch {
      return {
        ok: false,
        error: `${label} could not be read as an image. TIFFs with unusual compression may need exporting as JPEG or PNG first.`,
        status: 400,
      };
    }
  }

  if (!reportedW || !reportedH) {
    return {
      ok: false,
      error: `${label} dimensions missing — reload and try again`,
      status: 400,
    };
  }

  const fileDims = await readImageDimensionsFromBuffer(raw);
  if (fileDims.width !== reportedW || fileDims.height !== reportedH) {
    return {
      ok: false,
      error: `${label} file bytes are ${fileDims.width}×${fileDims.height}px but client reported ${reportedW}×${reportedH}px.`,
      status: 400,
    };
  }

  return {
    ok: true,
    buf: raw,
    width: reportedW,
    height: reportedH,
    ext: extForMime(file.type),
  };
}

export async function POST(req: Request, { params }: Params) {
  const tooLarge = checkContentLengthHeader(req);
  if (tooLarge) return tooLarge;

  const { id } = await params;
  const storage = getStorage();
  const project = await storage.loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const form = await req.formData();
  const annotated = form.get("annotated");
  const clean = form.get("clean");
  const hasAnnotated = annotated instanceof File && annotated.size > 0;
  const hasClean = clean instanceof File && clean.size > 0;

  if (!hasAnnotated && !hasClean) {
    return NextResponse.json(
      { error: "Upload at least one orthophoto — annotated and/or clean" },
      { status: 400 }
    );
  }

  if (
    hasAnnotated &&
    hasClean &&
    annotated.size + clean.size > UPLOAD_MAX_BYTES
  ) {
    return payloadTooLargeResponse(annotated.size + clean.size);
  }

  if (hasAnnotated) {
    const annW = parseInt(String(form.get("annotatedWidth") ?? "0"), 10);
    const annH = parseInt(String(form.get("annotatedHeight") ?? "0"), 10);
    const check = await validateImageFile(annotated, "Annotated image", annW, annH);
    if (!check.ok) {
      if (check.status === 413) return payloadTooLargeResponse(annotated.size);
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    if (project.annotationBase) {
      const dimCheck = await validateAnnotatedUpload(
        project,
        check.buf,
        check.width,
        check.height
      );
      if (!dimCheck.ok) {
        return NextResponse.json({ error: dimCheck.error }, { status: 400 });
      }
    }

    logImageIngestDiagnostic(
      `project=${id}`,
      "annotated-upload",
      check.width,
      check.height
    );
    const annName = `annotated.${check.ext}`;
    await storage.saveProjectFile(id, annName, check.buf);
    project.images.annotated = {
      filename: annName,
      width: check.width,
      height: check.height,
    };
  }

  if (hasClean) {
    const cleanW = parseInt(String(form.get("cleanWidth") ?? "0"), 10);
    const cleanH = parseInt(String(form.get("cleanHeight") ?? "0"), 10);
    const check = await validateImageFile(clean, "Clean image", cleanW, cleanH);
    if (!check.ok) {
      if (check.status === 413) return payloadTooLargeResponse(clean.size);
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    logImageIngestDiagnostic(
      `project=${id}`,
      "clean-upload",
      check.width,
      check.height
    );
    const cleanName = `clean.${check.ext}`;
    await storage.saveProjectFile(id, cleanName, check.buf);
    project.images.clean = {
      filename: cleanName,
      width: check.width,
      height: check.height,
    };
  }

  project.updatedAt = new Date().toISOString();
  await storage.saveProject(project);
  return NextResponse.json(project);
}
