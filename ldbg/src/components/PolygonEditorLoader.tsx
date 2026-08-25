"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

const PolygonEditor = dynamic(() => import("@/components/PolygonEditor"), {
  ssr: false,
  loading: () => (
    <section className="rounded-xl border border-stone-200 bg-stone-50 p-8 text-center text-stone-500">
      Loading polygon editor…
    </section>
  ),
});

export function PolygonEditorLoader(props: ComponentProps<typeof PolygonEditor>) {
  return <PolygonEditor {...props} />;
}
