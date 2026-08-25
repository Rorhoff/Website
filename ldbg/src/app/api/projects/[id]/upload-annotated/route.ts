import { NextResponse } from "next/server";
import { validateAnnotatedUpload } from "@/lib/annotation-base-validation";
import { logImageIngestDiagnostic } from "@/lib/image-dimensions";
import { getStorage } from "@/lib/storage";
import {
  checkContentLengthHeader,
  payloadTooLargeResponse,
  UPLOAD_MAX_BYTES,
} from "@/lib/upload-limits";

export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(req: Request, { params }: Params) {
  const tooLarge = checkContentLengthHeader(req);
  if (tooLarge) return tooLarge;

  const { id } = await params;
  const storage = getStorage();
  const project = await storage.loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (!project.annotationBase) {
    return NextResponse.json(
      { error: "Export an annotation base first (Addendum A3)" },
      { status: 400 }
    );
  }

  const form = await req.formData();
  const annotated = form.get("annotated");

  if (!(annotated instanceof File) || annotated.size === 0) {
    return NextResponse.json({ error: "Annotated image is required" }, { status: 400 });
  }
  if (annotated.size > UPLOAD_MAX_BYTES) {
    return payloadTooLargeResponse(annotated.size);
  }

  if (!ALLOWED.has(annotated.type)) {
    return NextResponse.json(
      { error: "Annotated image must be JPEG, PNG, or WebP" },
      { status: 400 }
    );
  }

  const annW = parseInt(String(form.get("annotatedWidth") ?? "0"), 10);
  const annH = parseInt(String(form.get("annotatedHeight") ?? "0"), 10);
  if (!annW || !annH) {
    return NextResponse.json(
      { error: "Image dimensions missing — reload and try again" },
      { status: 400 }
    );
  }

  const fileBuf = Buffer.from(await annotated.arrayBuffer());
  const dimCheck = await validateAnnotatedUpload(project, fileBuf, annW, annH);
  if (!dimCheck.ok) {
    return NextResponse.json({ error: dimCheck.error }, { status: 400 });
  }

  const clean = project.images.clean ?? project.images.preview;
  if (clean) {
    logImageIngestDiagnostic(`project=${id}`, "clean-orthophoto-on-record", clean.width, clean.height);
  }
  logImageIngestDiagnostic(`project=${id}`, "annotated-upload", dimCheck.fileWidth, dimCheck.fileHeight);
  logImageIngestDiagnostic(
    `project=${id}`,
    "annotation-base-expected",
    project.annotationBase.width,
    project.annotationBase.height
  );

  const annExt =
    annotated.type === "image/png"
      ? "png"
      : annotated.type === "image/webp"
        ? "webp"
        : "jpg";
  const annName = `annotated.${annExt}`;
  await storage.saveProjectFile(id, annName, fileBuf);

  project.images.annotated = {
    filename: annName,
    width: dimCheck.fileWidth,
    height: dimCheck.fileHeight,
  };
  project.updatedAt = new Date().toISOString();
  await storage.saveProject(project);

  return NextResponse.json(project);
}
