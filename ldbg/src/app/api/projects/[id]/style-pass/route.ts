import { NextResponse } from "next/server";
import { z } from "zod";
import { presetUsesStylePass, type StylePresetId } from "@/config/styles";
import { getStorage } from "@/lib/storage";
import { buildPlanCompositePng } from "@/lib/plan-composite-service";
import {
  getStylePassCacheEntry,
  readStylePassJob,
  resolveStylePreset,
  runStylePassForProject,
  startStylePassJob,
} from "@/lib/style-pass-service";
import { StylePresetIdSchema } from "@/lib/style-pass-schema";
import { createHash } from "node:crypto";

type Params = { params: Promise<{ id: string }> };

const PostBodySchema = z.object({
  preset: StylePresetIdSchema,
  forPrint: z.boolean().optional(),
  sync: z.boolean().optional(),
});

function styleCacheKey(compositeHash: string, preset: StylePresetId): string {
  return createHash("sha256").update(`${compositeHash}:${preset}`).digest("hex").slice(0, 16);
}

export const maxDuration = 300;

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const project = await getStorage().loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const job = await readStylePassJob(id);
  const preset = resolveStylePreset(project);
  let cacheReady = false;
  let entry = undefined;

  if (presetUsesStylePass(preset)) {
    try {
      const { hash: compositeHash } = await buildPlanCompositePng(id, project);
      const cacheHash = styleCacheKey(compositeHash, preset);
      entry = getStylePassCacheEntry(project, preset, cacheHash);
      cacheReady = !!entry;
    } catch {
      cacheReady = false;
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

  if (!presetUsesStylePass(body.preset)) {
    return NextResponse.json({ error: "Preset does not use style pass", cacheReady: true });
  }

  if (body.sync) {
    try {
      const entry = await runStylePassForProject(id, body.preset, {
        quality: body.forPrint ? "final" : "draft",
      });
      return NextResponse.json({ entry, cacheReady: !!entry, job: await readStylePassJob(id) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Style pass failed";
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  try {
    const { hash: compositeHash } = await buildPlanCompositePng(id, project);
    const cacheHash = styleCacheKey(compositeHash, body.preset);
    const cached = getStylePassCacheEntry(project, body.preset, cacheHash);
    if (cached) {
      return NextResponse.json({
        job: { status: "complete", progress: 100, step: "cached", cacheHash },
        cacheReady: true,
        entry: cached,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Composite build failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  startStylePassJob(id, body.preset);
  return NextResponse.json({
    job: {
      status: "running",
      preset: body.preset,
      progress: 0,
      step: "queued",
      startedAt: new Date().toISOString(),
    },
    cacheReady: false,
  });
}
