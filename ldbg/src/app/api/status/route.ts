import { NextResponse } from "next/server";
import {
  anthropicKeySource,
  isAnthropicConfigured,
} from "@/lib/anthropic-env";

export async function GET() {
  const configured = isAnthropicConfigured();
  return NextResponse.json({
    anthropicConfigured: configured,
    anthropicKeySource: configured ? anthropicKeySource() : undefined,
  });
}
