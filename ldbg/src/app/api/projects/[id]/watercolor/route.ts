import { NextResponse } from "next/server";
import { z } from "zod";
import { presetUsesFilter, type WatercolorPresetId } from "@/config/watercolor";
import { getStorage } from "@/lib/storage";
import {
  ensureWatercolorForProject,
  findCachedWatercolor,
  computeWatercolorCacheKey,
  getWatercolorSourceForPlan,
  readWatercolorJob,
  startWatercolorJob,
} from "@/lib/watercolor-service";
import { WatercolorPresetIdSchema } from "@/lib/watercolor-schema";
import path from "path";

type Params = { params: Promise<{ id: string }> };

const PostBodySchema = z.object({
  preset: WatercolorPresetIdSchema,
  forPrint: z.boolean().optional(),
});

function storageRoot(): string {
  return process.env.LDBG_STORAGE_DIR ?? path.join(process.cwd(), "storage");
}

export const maxDuration = 300;

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const project = await getStorage().loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const job = await readWatercolorJob(id);
  const preset = (project.planSettings?.basePreset ?? "watercolor-soft") as WatercolorPresetId;

  let cacheReady = false;
  let entry: Awaited<ReturnType<typeof findCachedWatercolor>> | undefined;
  if (presetUsesFilter(preset)) {
    const source = getWatercolorSourceForPlan(project, false);
    if (source) {
      const sourceAbs = path.join(storageRoot(), id, source.filename);
      try {
        const hash = await computeWatercolorCacheKey(
          sourceAbs,
          preset,
          project.planSettings?.watercolorParamOverrides
        );
        entry = await findCachedWatercolor(id, preset, hash);
        cacheReady = !!entry;
      } catch {
        cacheReady = false;
      }
    }
  }

  return NextResponse.json({ job, cacheReady, preset, entry });
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const project = await getStorage().loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let body: z.infer<typeof PostBodySchema>;
  try {
    body = PostBodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!presetUsesFilter(body.preset)) {
    return NextResponse.json({ error: "Preset does not use filter pipeline" }, { status: 400 });
  }

  const source = getWatercolorSourceForPlan(project, body.forPrint ?? false);
  if (!source) {
    return NextResponse.json({ error: "No source orthophoto" }, { status: 400 });
  }

  const sourceAbs = path.join(storageRoot(), id, source.filename);
  const hash = await computeWatercolorCacheKey(
    sourceAbs,
    body.preset,
    project.planSettings?.watercolorParamOverrides
  );

  const cached = await findCachedWatercolor(id, body.preset, hash);
  if (cached) {
    const job = await readWatercolorJob(id);
    return NextResponse.json({
      job: { ...job, status: "complete", progress: 100, step: "cached", cacheHash: hash },
      cacheReady: true,
      entry: cached,
    });
  }

  startWatercolorJob(id, body.preset, { forPrintSource: body.forPrint ?? false });

  return NextResponse.json({
    job: {
      status: "running",
      preset: body.preset,
      progress: 0,
      step: "queued",
      cacheHash: hash,
      startedAt: new Date().toISOString(),
    },
    cacheReady: false,
  });
}

/** Synchronous ensure for export — blocks until cache exists. */
export async function PUT(req: Request, { params }: Params) {
  const { id } = await params;
  const project = await getStorage().loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let body: z.infer<typeof PostBodySchema>;
  try {
    body = PostBodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    const entry = await ensureWatercolorForProject(id, body.preset, {
      forPrint: body.forPrint ?? true,
    });
    return NextResponse.json({ entry, cacheReady: !!entry });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Watercolor ensure failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
