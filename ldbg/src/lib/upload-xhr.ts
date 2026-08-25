export type UploadProgress = {
  percent: number;
  loaded: number;
  total: number;
};

export type XhrUploadResult = {
  ok: boolean;
  status: number;
  responseText: string;
};

/** Multipart upload with upload.onprogress (fetch cannot report upload progress). */
export function xhrUploadFormData(
  url: string,
  formData: FormData,
  onProgress?: (progress: UploadProgress) => void,
  signal?: AbortSignal
): Promise<XhrUploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);

    xhr.upload.onprogress = (event) => {
      if (!onProgress) return;
      if (event.lengthComputable && event.total > 0) {
        onProgress({
          percent: Math.min(100, (event.loaded / event.total) * 100),
          loaded: event.loaded,
          total: event.total,
        });
      } else {
        onProgress({ percent: 0, loaded: event.loaded, total: 0 });
      }
    };

    xhr.onload = () => {
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        responseText: xhr.responseText,
      });
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          xhr.abort();
        },
        { once: true }
      );
    }

    xhr.send(formData);
  });
}

export function parseUploadErrorResponse(
  status: number,
  responseText: string,
  fallbackSizeMb?: string
): string {
  if (status === 413) {
    try {
      const data = JSON.parse(responseText) as { error?: string };
      if (data.error) return data.error;
    } catch {
      // ignore
    }
    return (
      `Upload rejected: payload too large (HTTP 413).` +
      (fallbackSizeMb ? ` Your upload was ${fallbackSizeMb} MB.` : "") +
      ` The server limit is 200 MB.`
    );
  }
  if (status === 504) {
    return "Upload timed out (HTTP 504). Try a smaller file or a faster connection.";
  }
  try {
    const data = JSON.parse(responseText) as { error?: string };
    if (data.error) return data.error;
  } catch {
    // ignore
  }
  return `Upload failed (HTTP ${status})`;
}
