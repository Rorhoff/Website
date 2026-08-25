import puppeteer from "puppeteer";
import type { BoardPageSize } from "@/lib/board-sizes";
import { boardDimensions } from "@/lib/board-sizes";

export type ExportFormat = "pdf" | "png";

function boardPageUrl(projectId: string, pageSize: BoardPageSize): string {
  const base =
    process.env.LDBG_EXPORT_BASE_URL ??
    process.env.LDBG_INTERNAL_URL ??
    "http://127.0.0.1:3002";
  const basePath = (process.env.LDBG_BASE_PATH ?? "").replace(/\/$/, "");
  const params = new URLSearchParams({ size: pageSize, export: "1" });
  return `${base.replace(/\/$/, "")}${basePath}/projects/${projectId}/board?${params}`;
}

export async function exportBoardDocument(
  projectId: string,
  pageSize: BoardPageSize,
  format: ExportFormat
): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
  const dims = boardDimensions(pageSize);
  const url = boardPageUrl(projectId, pageSize);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: dims.widthPx,
      height: dims.heightPx,
      deviceScaleFactor: 1,
    });

    await page.goto(url, {
      waitUntil: "networkidle0",
      timeout: 120_000,
    });

    await page.evaluate(async () => {
      const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
      if (fonts?.ready) await fonts.ready;
    });

    const stamp = new Date().toISOString().slice(0, 10);

    if (format === "pdf") {
      const buffer = Buffer.from(
        await page.pdf({
          width: `${dims.widthIn}in`,
          height: `${dims.heightIn}in`,
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
        })
      );
      return {
        buffer,
        contentType: "application/pdf",
        filename: `board-${projectId.slice(0, 8)}-${pageSize}-${stamp}.pdf`,
      };
    }

    const buffer = Buffer.from(
      await page.screenshot({
        type: "png",
        fullPage: false,
        clip: { x: 0, y: 0, width: dims.widthPx, height: dims.heightPx },
      })
    );
    return {
      buffer,
      contentType: "image/png",
      filename: `board-${projectId.slice(0, 8)}-${pageSize}-${stamp}.png`,
    };
  } finally {
    await browser.close();
  }
}
