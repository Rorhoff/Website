import { NextResponse } from "next/server";
import { blenderRenderForSlot } from "@/lib/blender-render-service";
import { isRenderSlotKey } from "@/lib/render-slots";
import type { BlenderCameraPreset } from "@/lib/blender-schema";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await req.json()) as {
    slot?: string;
    force?: boolean;
    preset?: BlenderCameraPreset;
  };

  if (!body.slot || !isRenderSlotKey(body.slot)) {
    return NextResponse.json({ error: "Invalid render slot" }, { status: 400 });
  }

  const result = await blenderRenderForSlot(id, body.slot, {
    force: body.force,
    preset: body.preset,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
}
