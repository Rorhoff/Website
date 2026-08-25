import { NextResponse } from "next/server";
import {
  anthropicKeySource,
  isAnthropicConfigured,
} from "@/lib/anthropic-env";
import { INTERPRET_MODEL } from "@/lib/interpret-service";
import { getLegend, getStorage } from "@/lib/storage";
import type { LegendEntry } from "@/config/legend";

/** ?diag=1 returns deploy health JSON (works even when /api/status is cached/missing upstream). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("diag") === "1") {
    const configured = isAnthropicConfigured();
    return NextResponse.json({
      anthropicConfigured: configured,
      anthropicKeySource: configured ? anthropicKeySource() : undefined,
      interpretModel: INTERPRET_MODEL,
    });
  }

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
