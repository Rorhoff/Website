import { NextResponse } from "next/server";

/** Hard ceiling for LDBG multipart uploads — keep in sync with nginx /ldbg and README. */
export const UPLOAD_MAX_BYTES = 200 * 1024 * 1024;

export function formatUploadMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export function uploadLimitMessage(actualBytes: number): string {
  return (
    `Upload is ${formatUploadMb(actualBytes)} MB — the limit is ${formatUploadMb(UPLOAD_MAX_BYTES)} MB. ` +
    `Choose a smaller file or enable compression before uploading.`
  );
}

export function uploadPreflightError(actualBytes: number, label?: string): string {
  const who = label ? `${label} (${formatUploadMb(actualBytes)} MB)` : `${formatUploadMb(actualBytes)} MB`;
  return `${who} exceeds the ${formatUploadMb(UPLOAD_MAX_BYTES)} MB upload limit. Select a smaller file before uploading.`;
}

export function payloadTooLargeResponse(actualBytes: number): NextResponse {
  return NextResponse.json(
    { error: uploadLimitMessage(actualBytes) },
    { status: 413 }
  );
}

export function checkContentLengthHeader(req: Request): NextResponse | null {
  const raw = req.headers.get("content-length");
  if (!raw) return null;
  const len = parseInt(raw, 10);
  if (!Number.isFinite(len) || len <= UPLOAD_MAX_BYTES) return null;
  return payloadTooLargeResponse(len);
}

export function sumFileSizes(files: Iterable<File>): number {
  let total = 0;
  for (const f of files) total += f.size;
  return total;
}
