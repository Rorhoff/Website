import { NextResponse } from "next/server";
import { runElevationAnalysisForProject } from "@/lib/elevation-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: RouteContext) {
  const { id } = await context.params;
  let body: { force?: boolean; contourMinorFt?: number; contourMajorFt?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body ok */
  }

  const result = await runElevationAnalysisForProject(id, {
    force: body.force,
    contourMinorFt: body.contourMinorFt,
    contourMajorFt: body.contourMajorFt,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    elevationAnalysis: result.elevationAnalysis,
    cached: result.cached,
  });
}
