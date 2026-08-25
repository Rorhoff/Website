import { NextResponse } from "next/server";
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
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  await getStorage().deleteProject(id);
  return NextResponse.json({ ok: true });
}
