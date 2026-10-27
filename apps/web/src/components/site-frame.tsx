"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import type { AppMode } from "@/lib/config";

export const DEMO_LABEL = "Demo — produk, pesanan, dan kebijakan fiktif";

type NavKey = "asisten" | "produk" | "pesanan" | "staf";

const NAV_LINK_CLASS =
  "inline-flex min-h-11 items-center rounded-card px-3 text-text hover:bg-background aria-[current=page]:font-semibold aria-[current=page]:text-primary";

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
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-card focus:bg-surface focus:px-4 focus:py-2"
      >
        Lewati ke konten
      </a>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/" className="inline-flex min-h-11 items-center text-lg font-semibold text-primary">
              TokoLangkah
            </Link>
            <nav aria-label="Utama">
              <ul className="flex flex-wrap gap-2">
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
          </div>
          <div className="flex min-w-0 max-w-full items-center gap-2">
            {signedIn ? (
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 max-w-[14rem] truncate text-sm text-text" data-testid="signed-in-email">
                  {auth.email}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void auth.signOut();
                  }}
                  className="min-h-11 rounded-card border border-border bg-surface px-3 text-text hover:bg-background"
                >
                  Keluar
                </button>
              </div>
            ) : (
              <Link href="/masuk" className="inline-flex min-h-11 items-center rounded-card border border-border bg-surface px-3 text-text hover:bg-background">
                Masuk
              </Link>
            )}
          </div>
        </div>
        <div className="border-t border-border bg-background">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2">
            <p className="text-sm text-muted">{DEMO_LABEL}</p>
            <span data-testid="mode-badge" className="rounded-card border border-border px-2 py-0.5 text-sm text-muted">
              Mode: {mode}
            </span>
          </div>
        </div>
      </header>
      {/* tabIndex -1 lets the skip link move keyboard focus here; the outline is removed only on this container. */}
      <main id="konten" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-6 focus:outline-none md:py-8">
        {children}
      </main>
    </div>
  );
}
