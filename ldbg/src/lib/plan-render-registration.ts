import sharp from "sharp";

export type RegistrationResult = {
  passed: boolean;
  meanDisplacementPct: number;
  patchCount: number;
  details: string;
};

/** Sample fixed corner/margin patches and estimate mean pixel displacement via normalized correlation. */
export async function verifyPlanRenderRegistration(
  inputPng: Buffer,
  outputPng: Buffer,
  imageW: number,
  imageH: number
): Promise<RegistrationResult> {
  const inMeta = await sharp(inputPng).metadata();
  const outMeta = await sharp(outputPng).metadata();
  const inW = inMeta.width ?? imageW;
  const inH = inMeta.height ?? imageH;
  const outW = outMeta.width ?? 0;
  const outH = outMeta.height ?? 0;

  if (outW !== inW || outH !== inH) {
    return {
      passed: false,
      meanDisplacementPct: 100,
      patchCount: 0,
      details: `Output ${outW}x${outH} != input ${inW}x${inH}`,
    };
  }

  const patchSize = Math.max(32, Math.round(Math.min(inW, inH) * 0.04));
  const margin = Math.round(patchSize * 1.5);

  const centers = [
    { x: margin, y: margin },
    { x: inW - margin, y: margin },
    { x: margin, y: inH - margin },
    { x: inW - margin, y: inH - margin },
    { x: Math.round(inW / 2), y: margin },
    { x: Math.round(inW / 2), y: inH - margin },
  ];

  const inRaw = await sharp(inputPng).grayscale().raw().toBuffer();
  const outRaw = await sharp(outputPng).grayscale().raw().toBuffer();

  let totalDisp = 0;
  let used = 0;

  for (const c of centers) {
    const left = Math.max(0, c.x - Math.floor(patchSize / 2));
    const top = Math.max(0, c.y - Math.floor(patchSize / 2));
    if (left + patchSize >= inW || top + patchSize >= inH) continue;

    const inPatch = extractPatch(inRaw, inW, left, top, patchSize);
    const outPatch = extractPatch(outRaw, inW, left, top, patchSize);

    const inMean = mean(inPatch);
    if (inMean < 20 || inMean > 235) continue;

    const disp = patchDisplacement(inPatch, outPatch);
    totalDisp += disp;
    used++;
  }

  if (used === 0) {
    return {
      passed: true,
      meanDisplacementPct: 0,
      patchCount: 0,
      details: "No high-contrast patches sampled; dimension check only",
    };
  }

  const meanDispPx = totalDisp / used;
  const meanDisplacementPct = (meanDispPx / inW) * 100;
  const passed = meanDisplacementPct <= 0.5;

  return {
    passed,
    meanDisplacementPct: Math.round(meanDisplacementPct * 1000) / 1000,
    patchCount: used,
    details: passed
      ? `Mean patch displacement ${meanDisplacementPct.toFixed(3)}% of width (${used} patches)`
      : `Misregistered: mean displacement ${meanDisplacementPct.toFixed(3)}% exceeds 0.5%`,
  };
}

function extractPatch(
  raw: Buffer,
  width: number,
  left: number,
  top: number,
  size: number
): number[] {
  const out: number[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      out.push(raw[(top + y) * width + (left + x)] ?? 0);
    }
  }
  return out;
}

function mean(vals: number[]): number {
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function patchDisplacement(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs(a[i] - b[i]);
  }
  return sum / a.length / 255;
}
