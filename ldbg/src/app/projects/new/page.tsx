import { AppHeader } from "@/components/AppHeader";
import { UploadForm } from "@/components/UploadForm";

export default function NewProjectPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h2 className="mb-2 text-2xl font-semibold text-stone-900">New project</h2>
        <p className="mb-6 text-stone-600">
          Upload your annotated orthophoto and optionally the clean base image from the same
          flight frame.
        </p>
        <UploadForm />
      </main>
    </>
  );
}
