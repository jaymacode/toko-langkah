"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import type { AppMode } from "@/lib/config";

export const DEMO_LABEL = "Demo — produk, pesanan, dan kebijakan fiktif";

type NavKey = "asisten" | "produk" | "pesanan" | "staf";

const NAV_LINK_CLASS =
  "inline-flex min-h-11 items-center rounded-pill px-3 text-[15px] text-text transition-colors duration-200 hover:bg-stone aria-[current=page]:bg-primary aria-[current=page]:text-on-primary";

/**
 * Shared header, demo label and main landmark for every page. The demo label is
 * always visible so fictional data is never mistaken for a live store. The
 * Staf link appears only when /me reports a staff store; the account control
 * shows the signed-in email with Keluar, or a Masuk link.
 */
export function SiteFrame({
  mode,
  current,
  children,
}: {
  mode: AppMode;
  current: NavKey | null;
  children: ReactNode;
}) {
  const auth = useAuth();
  const signedIn = auth.sessionStatus === "signed_in";

  return (
    <div className="min-h-screen">
      <a
        href="#konten"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-pill focus:bg-surface focus:px-4 focus:py-2"
      >
        Lewati ke konten
      </a>
      <header className="border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:sticky md:top-0 md:z-30">
        <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 md:grid-cols-[1fr_auto_1fr] md:px-8">
          <Link
            href="/"
            aria-label="TokoLangkah"
            className="font-display col-start-1 row-start-1 inline-flex min-h-11 items-center justify-self-start text-[22px] font-semibold leading-none text-text md:col-start-2 md:justify-self-center"
          >
            tokolangkah<span aria-hidden="true" className="text-accent">.</span>
          </Link>
          <nav aria-label="Utama" className="col-span-2 row-start-2 -mx-1 md:col-span-1 md:col-start-1 md:row-start-1">
            <ul className="flex flex-wrap gap-1">
              <li>
                <Link href="/" aria-current={current === "asisten" ? "page" : undefined} className={NAV_LINK_CLASS}>
                  Asisten
                </Link>
              </li>
              <li>
                <Link href="/produk" aria-current={current === "produk" ? "page" : undefined} className={NAV_LINK_CLASS}>
                  Produk
                </Link>
              </li>
              <li>
                <Link href="/pesanan" aria-current={current === "pesanan" ? "page" : undefined} className={NAV_LINK_CLASS}>
                  Pesanan
                </Link>
              </li>
              {auth.isStaff ? (
                <li>
                  <Link href="/staf" aria-current={current === "staf" ? "page" : undefined} className={NAV_LINK_CLASS}>
                    Staf
                  </Link>
                </li>
              ) : null}
            </ul>
          </nav>
          <div className="col-start-2 row-start-1 flex min-w-0 items-center justify-end gap-2 md:col-start-3">
            {signedIn ? (
              <>
                <span
                  className="hidden min-w-0 max-w-[14rem] truncate text-sm text-muted sm:inline"
                  data-testid="signed-in-email"
                >
                  {auth.email}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void auth.signOut();
                  }}
                  className="min-h-11 rounded-pill border border-rule bg-surface px-4 text-[15px] text-text transition-colors duration-200 hover:border-text"
                >
                  Keluar
                </button>
              </>
            ) : (
              <Link
                href="/masuk"
                className="inline-flex min-h-11 items-center rounded-pill bg-primary px-5 text-[15px] font-medium text-on-primary transition-opacity duration-200 hover:opacity-85"
              >
                Masuk
              </Link>
            )}
          </div>
        </div>
        <div className="border-t border-border">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 md:px-8">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
            <p className="text-[13px] text-muted">{DEMO_LABEL}</p>
            <span data-testid="mode-badge" className="tabular rounded-pill border border-rule px-2 py-px text-[12px] text-muted">
              Mode: {mode}
            </span>
          </div>
        </div>
      </header>
      {/* tabIndex -1 lets the skip link move keyboard focus here; the outline is removed only on this container. */}
      <main id="konten" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-6 focus:outline-none md:px-8 md:py-10">
        {children}
      </main>
    </div>
  );
}
