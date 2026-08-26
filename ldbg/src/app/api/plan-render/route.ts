import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ensurePlanRenderCache,
  findPlanRenderEntry,
  generatePlanMaskOnly,
  readPlanRenderJob,
  startPlanRenderJob,
} from "@/lib/plan-render-service";
import { getStorage } from "@/lib/storage";

const PostSchema = z.object({
  projectId: z.string().uuid(),
  quality: z.enum(["draft", "final"]).optional(),
  force: z.boolean().optional(),
  action: z.enum(["render", "mask"]).default("render"),
});

export const maxDuration = 300;

export async function POST(req: Request) {
  let body: z.infer<typeof PostSchema>;
  try {
    body = PostSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const project = await getStorage().loadProject(body.projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    if (body.action === "mask") {
      const mask = await generatePlanMaskOnly(body.projectId);
      return NextResponse.json({ ok: true, ...mask });
    }

    if (body.force) {
      const { entry, project: updated } = await ensurePlanRenderCache(body.projectId, {
        quality: body.quality,
        force: true,
      });
      return NextResponse.json({
        job: { status: "complete", progress: 100 },
        entry,
        project: { planSettings: updated.planSettings, planRenderCache: updated.planRenderCache },
      });
    }

    const job = await startPlanRenderJob(body.projectId, {
      quality: body.quality,
      force: body.force,
    });
    return NextResponse.json({ job });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Plan render failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const project = await getStorage().loadProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const quality =
    new URL(req.url).searchParams.get("quality") === "final" ? "final" : "draft";
  const job = await readPlanRenderJob(projectId);
  const entry = findPlanRenderEntry(project, quality);

  return NextResponse.json({
    job,
    cacheReady: !!entry,
    entry,
    registrationPassed: entry?.registrationPassed,
    registrationDisplacementPct: entry?.registrationDisplacementPct,
  });
}
