import { NextResponse } from "next/server";
import { z } from "zod";
import { ingestWebodmDataset, type IngestFile } from "@/lib/webodm-ingest";
import { normalizeRelativePath } from "@/lib/webodm-manifest";

const JsonBodySchema = z.object({
  folderPath: z.string().min(1),
  projectId: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    let body: z.infer<typeof JsonBodySchema>;
    try {
      body = JsonBodySchema.parse(await req.json());
    } catch {
      return NextResponse.json(
        { error: "Invalid body — need folderPath" },
        { status: 400 }
      );
    }

    if (process.env.LDBG_WEBODM_ALLOW_PATH !== "true") {
      return NextResponse.json(
        {
          error:
            "Server path ingest is disabled. Set LDBG_WEBODM_ALLOW_PATH=true or upload the WebODM folder from the browser.",
        },
        { status: 403 }
      );
    }

    const result = await ingestWebodmDataset({
      sourceFolder: body.folderPath,
      projectId: body.projectId,
    });

    if ("error" in result) {
      return NextResponse.json(result, { status: 422 });
    }

    return NextResponse.json(result.project, { status: 201 });
  }

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const files: IngestFile[] = [];

    const pathEntries = form.getAll("paths").map(String);
    const fileEntries = form.getAll("files");

    if (fileEntries.length === 0) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }

    for (let i = 0; i < fileEntries.length; i++) {
      const value = fileEntries[i];
      if (!(value instanceof File) || value.size === 0) continue;
      const rel =
        pathEntries[i] ??
        value.name ??
        `upload-${i}`;
      files.push({
        relativePath: normalizeRelativePath(rel),
        data: Buffer.from(await value.arrayBuffer()),
      });
    }

    const projectId = form.get("projectId");
    const result = await ingestWebodmDataset({
      files,
      projectId: typeof projectId === "string" ? projectId : undefined,
    });

    if ("error" in result) {
      return NextResponse.json(result, { status: 422 });
    }

    return NextResponse.json(result.project, { status: 201 });
  }

  return NextResponse.json(
    { error: "Send multipart files or JSON with folderPath" },
    { status: 400 }
  );
}
