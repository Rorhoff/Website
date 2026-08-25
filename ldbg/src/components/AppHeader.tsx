import Link from "next/link";

const links = [
  { href: "/", label: "Projects" },
  { href: "/projects/new", label: "New project" },
  { href: "/legend", label: "Legend editor" },
];

export function AppHeader() {
  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">
            LDBG
          </p>
          <h1 className="text-lg font-semibold text-stone-900">
            Landscape Design Board Generator
          </h1>
        </div>
        <nav className="flex flex-wrap gap-2">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-md px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-100"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
