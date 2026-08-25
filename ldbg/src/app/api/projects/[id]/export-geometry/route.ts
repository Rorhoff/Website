import { NextResponse } from "next/server";
import { z } from "zod";
import {
  exportProjectGeometry,
  type GeometryExportFormat,
} from "@/lib/geometry-export-service";
import { canExportBoard } from "@/lib/scale-verification";
import { getLegend, getStorage } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  format: z.enum([
    "dxf",
    "geojson",
    "kml",
    "kmz",
    "stakeout-csv",
    "contours-dxf",
  ]),
});

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const project = await getStorage().loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const exportGate = canExportBoard(project);
  if (!exportGate.allowed) {
    return NextResponse.json({ error: exportGate.reason }, { status: 403 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body — need format" }, { status: 400 });
  }

  try {
    const legend = await getLegend();
    const { buffer, contentType, filename } = await exportProjectGeometry(
      project,
      legend,
      body.format as GeometryExportFormat
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
    const msg = e instanceof Error ? e.message : "Geometry export failed";
    const status = msg.includes("requires") || msg.includes("No ") ? 400 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
