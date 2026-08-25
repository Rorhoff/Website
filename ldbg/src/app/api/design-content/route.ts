import { NextResponse } from "next/server";
import { z } from "zod";
import { StoredDesignContentSchema } from "@/lib/design-content-schema";
import { runDesignContentForProject } from "@/lib/design-content-service";
import { getStorage } from "@/lib/storage";

const PostBodySchema = z.object({
  projectId: z.string().uuid(),
  force: z.boolean().optional(),
});

const PatchBodySchema = z.object({
  projectId: z.string().uuid(),
  designContent: StoredDesignContentSchema,
  approved: z.boolean().optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof PostBodySchema>;
  try {
    body = PostBodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { error: "Invalid body — need projectId (uuid)" },
      { status: 400 }
    );
  }

  const result = await runDesignContentForProject(body.projectId, {
    force: body.force,
  });

  if ("error" in result) {
    const status = result.retryAfterSec ? 429 : 502;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result);
}

export async function PATCH(req: Request) {
  let body: z.infer<typeof PatchBodySchema>;
  try {
    body = PatchBodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const storage = getStorage();
  const project = await storage.loadProject(body.projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let designContent = body.designContent;
  if (body.approved) {
    designContent = { ...designContent, approvedAt: new Date().toISOString() };
  }

  project.designContent = StoredDesignContentSchema.parse(designContent);
  project.updatedAt = new Date().toISOString();
  await storage.saveProject(project);

  return NextResponse.json({ designContent: project.designContent });
}
