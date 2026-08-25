import { NextResponse } from "next/server";
import { validateAnnotatedDimensions } from "@/lib/annotation-base-utils";
import { getStorage } from "@/lib/storage";
import { checkContentLengthHeader, payloadTooLargeResponse, UPLOAD_MAX_BYTES } from "@/lib/upload-limits";

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

  const form = await req.formData();
  const annotated = form.get("annotated");
  const clean = form.get("clean");

  if (!(annotated instanceof File) || annotated.size === 0) {
    return NextResponse.json(
      { error: "Annotated orthophoto is required" },
      { status: 400 }
    );
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

  const dimCheck = validateAnnotatedDimensions(project, annW, annH);
  if (!dimCheck.ok) {
    return NextResponse.json({ error: dimCheck.error }, { status: 400 });
  }

  const annExt =
    annotated.type === "image/png"
      ? "png"
      : annotated.type === "image/webp"
        ? "webp"
        : "jpg";
  const annName = `annotated.${annExt}`;
  await storage.saveProjectFile(
    id,
    annName,
    Buffer.from(await annotated.arrayBuffer())
  );
  project.images.annotated = {
    filename: annName,
    width: annW,
    height: annH,
  };

  if (!(clean instanceof File) || clean.size === 0) {
    return NextResponse.json(
      { error: "Clean orthophoto is required" },
      { status: 400 }
    );
  }
  if (clean.size > UPLOAD_MAX_BYTES) {
    return payloadTooLargeResponse(clean.size);
  }
  if (annotated.size + clean.size > UPLOAD_MAX_BYTES) {
    return payloadTooLargeResponse(annotated.size + clean.size);
  }
  if (!ALLOWED.has(clean.type)) {
    return NextResponse.json(
      { error: "Clean image must be JPEG, PNG, or WebP" },
      { status: 400 }
    );
  }
  const cleanW = parseInt(String(form.get("cleanWidth") ?? "0"), 10);
  const cleanH = parseInt(String(form.get("cleanHeight") ?? "0"), 10);
  if (!cleanW || !cleanH) {
    return NextResponse.json(
      { error: "Clean image dimensions missing" },
      { status: 400 }
    );
  }
  const cleanExt =
    clean.type === "image/png"
      ? "png"
      : clean.type === "image/webp"
        ? "webp"
        : "jpg";
  const cleanName = `clean.${cleanExt}`;
  await storage.saveProjectFile(
    id,
    cleanName,
    Buffer.from(await clean.arrayBuffer())
  );
  project.images.clean = {
    filename: cleanName,
    width: cleanW,
    height: cleanH,
  };

  project.updatedAt = new Date().toISOString();
  await storage.saveProject(project);
  return NextResponse.json(project);
}
