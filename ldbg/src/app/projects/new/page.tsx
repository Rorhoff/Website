import { AppHeader } from "@/components/AppHeader";
import { UploadForm } from "@/components/UploadForm";
import { WebodmIngestForm } from "@/components/WebodmIngestForm";

export default function NewProjectPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h2 className="mb-2 text-2xl font-semibold text-stone-900">New project</h2>
        <p className="mb-6 text-stone-600">
          Point at a WebODM export folder (Addendum A). Georeferenced orthophotos replace
          manual scale calibration.
        </p>
        <WebodmIngestForm />

        <details className="mt-10 rounded-xl border border-stone-200 bg-stone-50 p-5">
          <summary className="cursor-pointer text-sm font-medium text-stone-700">
            Legacy: upload annotated JPEG (original SPEC)
          </summary>
          <div className="mt-4">
            <UploadForm />
          </div>
        </details>
      </main>
    </>
  );
}
