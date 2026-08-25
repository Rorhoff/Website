/** Approximate Sonnet pricing (USD per million tokens) — update if Anthropic changes rates. */
const INPUT_USD_PER_M = 3;
const OUTPUT_USD_PER_M = 15;

export function estimateInterpretCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * INPUT_USD_PER_M +
    (outputTokens / 1_000_000) * OUTPUT_USD_PER_M
  );
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(4)}`;
}
