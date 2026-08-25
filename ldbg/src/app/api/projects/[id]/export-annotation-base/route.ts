import { NextResponse } from "next/server";
import { z } from "zod";
import { exportAnnotationBaseForProject } from "@/lib/annotation-base-service";

type Params = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  longEdge: z.number().int().min(512).max(8192).optional(),
  force: z.boolean().optional(),
});

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  let body: z.infer<typeof BodySchema> = {};
  try {
    const raw = await req.json().catch(() => ({}));
    body = BodySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const result = await exportAnnotationBaseForProject(id, {
    longEdge: body.longEdge,
    force: body.force,
  });

  if ("error" in result) {
    return NextResponse.json(result, { status: 422 });
  }

  return NextResponse.json(result.project);
}
