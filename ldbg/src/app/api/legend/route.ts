import { NextResponse } from "next/server";
import { getLegend, getStorage } from "@/lib/storage";
import type { LegendEntry } from "@/config/legend";

export async function GET() {
  const legend = await getLegend();
  return NextResponse.json(legend);
}

export async function PUT(req: Request) {
  const entries = (await req.json()) as LegendEntry[];
  if (!Array.isArray(entries) || entries.length === 0) {
    return NextResponse.json({ error: "Invalid legend" }, { status: 400 });
  }
  await getStorage().saveLegendOverrides(entries);
  return NextResponse.json(await getLegend());
}
