import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ProjectSchema } from "@/lib/project-schema";
import { getStorage } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const project = await getStorage().loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json(project);
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const existing = await getStorage().loadProject(id);
  if (!existing) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const body = await req.json();
  try {
    const merged = ProjectSchema.parse({
      ...existing,
      ...body,
      id: existing.id,
      version: 1,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
      metadata: { ...existing.metadata, ...(body.metadata ?? {}) },
      images: { ...existing.images, ...(body.images ?? {}) },
    });
    await getStorage().saveProject(merged);
    return NextResponse.json(merged);
  } catch (e) {
    if (e instanceof ZodError) {
      const detail = e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return NextResponse.json({ error: `Invalid project data — ${detail}` }, { status: 400 });
    }
    throw e;
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const existing = await getStorage().loadProject(id);
  if (!existing) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  await getStorage().deleteProject(id);
  revalidatePath("/");
  return NextResponse.json({ ok: true });
}
