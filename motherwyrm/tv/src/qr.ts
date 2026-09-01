import QRCode from "qrcode";

/** Phone pad URL with game code pre-filled. */
export function padJoinUrl(code: string, origin = "https://rorhoff.com"): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/mw/pad/c/${encodeURIComponent(code)}`;
}

export async function qrDataUrl(text: string, size = 180): Promise<string> {
  return QRCode.toDataURL(text, {
    width: size,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#7fe3c4ff", light: "#171016ff" },
  });
}
