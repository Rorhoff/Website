import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createEmptyProject } from "@/lib/project-schema";
import { getStorage } from "@/lib/storage";

export async function GET() {
  const projects = await getStorage().listProjects();
  return NextResponse.json(projects);
}

export async function POST() {
  const id = randomUUID();
  const project = createEmptyProject(id);
  await getStorage().saveProject(project);
  return NextResponse.json(project, { status: 201 });
}
