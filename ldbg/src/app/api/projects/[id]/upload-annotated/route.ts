import { NextResponse } from "next/server";
import { validateAnnotatedDimensions } from "@/lib/annotation-base-utils";
import { getStorage } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(req: Request, { params }: Params) {
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
  project.updatedAt = new Date().toISOString();
  await storage.saveProject(project);

  return NextResponse.json(project);
}
