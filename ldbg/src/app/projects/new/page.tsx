import { AppHeader } from "@/components/AppHeader";
import { UploadForm } from "@/components/UploadForm";
import { WebodmIngestForm } from "@/components/WebodmIngestForm";

export default function NewProjectPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h2 className="mb-2 text-2xl font-semibold text-stone-900">New project</h2>

        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <h3 className="text-lg font-semibold text-stone-900">
            Legacy: upload annotated JPEG
          </h3>
          <p className="mt-1 mb-4 text-sm text-stone-600">
            Upload a hand-annotated orthophoto sketch (original SPEC workflow). Scale calibration
            is set on the project page after upload.
          </p>
          <UploadForm />
        </section>

        <section className="mt-10 rounded-xl border border-stone-200 bg-stone-50 p-5">
          <h3 className="text-lg font-semibold text-stone-900">WebODM export folder</h3>
          <p className="mt-1 mb-4 text-sm text-stone-600">
            Point at a WebODM export folder (Addendum A). Georeferenced orthophotos replace manual
            scale calibration.
          </p>
          <WebodmIngestForm />
        </section>
      </main>
    </>
  );
}
