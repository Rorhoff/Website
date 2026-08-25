import { NextResponse } from "next/server";
import { z } from "zod";
import { runInterpretForProject } from "@/lib/interpret-service";
import { getStorage } from "@/lib/storage";

const BodySchema = z.object({
  projectId: z.string().uuid(),
  force: z.boolean().optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body — need projectId (uuid)" }, { status: 400 });
  }

  const result = await runInterpretForProject(body.projectId, { force: body.force });

  if ("error" in result) {
    const status = result.retryAfterSec ? 429 : 502;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result);
}

export async function PATCH(req: Request) {
  let body: { projectId?: string; reviewCleared?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const storage = getStorage();
  const project = await storage.loadProject(body.projectId);
  if (!project?.interpretation) {
    return NextResponse.json({ error: "No interpretation on project" }, { status: 404 });
  }

  if (body.reviewCleared) {
    project.interpretation = {
      ...project.interpretation,
      reviewClearedAt: new Date().toISOString(),
    };
    project.updatedAt = new Date().toISOString();
    await storage.saveProject(project);
  }

  return NextResponse.json({ interpretation: project.interpretation });
}
