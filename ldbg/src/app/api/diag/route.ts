import { NextResponse } from "next/server";
import {
  anthropicKeySource,
  isAnthropicConfigured,
} from "@/lib/anthropic-env";
import { INTERPRET_MODEL } from "@/lib/interpret-service";

/** Deploy health — confirms Anthropic key + interpret model on the running build. */
export async function GET() {
  const configured = isAnthropicConfigured();
  return NextResponse.json({
    anthropicConfigured: configured,
    anthropicKeySource: configured ? anthropicKeySource() : undefined,
    interpretModel: INTERPRET_MODEL,
  });
}
