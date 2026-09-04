import { NextResponse } from "next/server";
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

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

function extForMime(type: string): "jpg" | "png" | "webp" {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

async function validateImageFile(
  file: File,
  label: string,
  reportedW: number,
  reportedH: number
): Promise<{ ok: true; buf: Buffer } | { ok: false; error: string; status: number }> {
  if (file.size > UPLOAD_MAX_BYTES) {
    return { ok: false, error: "File too large", status: 413 };
  }
  if (!ALLOWED.has(file.type)) {
    return {
      ok: false,
      error: `${label} must be JPEG, PNG, or WebP`,
      status: 400,
    };
  }
  if (!reportedW || !reportedH) {
    return {
      ok: false,
      error: `${label} dimensions missing — reload and try again`,
      status: 400,
    };
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const fileDims = await readImageDimensionsFromBuffer(buf);
  if (fileDims.width !== reportedW || fileDims.height !== reportedH) {
    return {
      ok: false,
      error: `${label} file bytes are ${fileDims.width}×${fileDims.height}px but client reported ${reportedW}×${reportedH}px.`,
      status: 400,
    };
  }

  return { ok: true, buf };
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
      const dimCheck = await validateAnnotatedUpload(project, check.buf, annW, annH);
      if (!dimCheck.ok) {
        return NextResponse.json({ error: dimCheck.error }, { status: 400 });
      }
    }

    logImageIngestDiagnostic(`project=${id}`, "annotated-upload", annW, annH);
    const annName = `annotated.${extForMime(annotated.type)}`;
    await storage.saveProjectFile(id, annName, check.buf);
    project.images.annotated = {
      filename: annName,
      width: annW,
      height: annH,
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

    logImageIngestDiagnostic(`project=${id}`, "clean-upload", cleanW, cleanH);
    const cleanName = `clean.${extForMime(clean.type)}`;
    await storage.saveProjectFile(id, cleanName, check.buf);
    project.images.clean = {
      filename: cleanName,
      width: cleanW,
      height: cleanH,
    };
  }

  project.updatedAt = new Date().toISOString();
  await storage.saveProject(project);
  return NextResponse.json(project);
}
