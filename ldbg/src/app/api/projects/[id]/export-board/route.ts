import { NextResponse } from "next/server";
import { z } from "zod";
import { exportBoardDocument } from "@/lib/board-export";
import type { BoardPageSize } from "@/lib/board-sizes";
import { getStorage } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  format: z.enum(["pdf", "png"]),
  pageSize: z.enum(["24x36", "18x24", "11x17"]).optional(),
});

export const maxDuration = 120;

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const project = await getStorage().loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const features =
    project.features?.length
      ? project.features
      : project.interpretation?.features ?? [];
  if (features.length === 0) {
    return NextResponse.json(
      { error: "Project has no features for board export" },
      { status: 400 }
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const pageSize: BoardPageSize =
    body.pageSize ?? project.boardSettings?.pageSize ?? "24x36";

  try {
    const { buffer, contentType, filename } = await exportBoardDocument(
      id,
      pageSize,
      body.format
    );

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Export failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
