"use client";

import { useEffect, useState } from "react";
import styles from "@/components/site-nav.module.css";

/** Portfolio cross-links — absolute site-root paths (not basePath-relative). */
const LINKS: { href: string; label: string; external?: boolean; active?: boolean }[] = [
  { href: "/", label: "About" },
  { href: "https://www.linkedin.com/in/rorhoff", label: "LinkedIn", external: true },
  { href: "/classifieds/", label: "Classifieds" },
  { href: "/airevolution/", label: "AI Revolution" },
  { href: "/referr-all/", label: "Referr-All" },
  { href: "/t1landscape/", label: "T1 Landscape" },
  { href: "/ldbg", label: "LDBG", active: true },
  { href: "/sss/", label: "SSS" },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      const nav = document.getElementById("ldbg-site-nav");
      if (nav && !nav.contains(target)) setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  return (
    <nav
      id="ldbg-site-nav"
      className={`site-nav-bar ${styles.siteNav}`}
      aria-label="Primary"
    >
      <button
        type="button"
        className={styles.hamburger}
        aria-label="Toggle navigation"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {open ? "✕" : "☰"}
      </button>
      <div className={`${styles.links} ${open ? styles.linksOpen : ""}`} id="navLinks">
        {LINKS.map((link) =>
          link.external ? (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {link.label}
            </a>
          ) : (
            <a
              key={link.href}
              href={link.href}
              className={link.active ? styles.active : undefined}
              title={link.active ? "Landscape Design Board Generator" : undefined}
            >
              {link.label}
            </a>
          )
        )}
      </div>
    </nav>
  );
}
