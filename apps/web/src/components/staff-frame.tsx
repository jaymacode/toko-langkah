"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import type { AppMode } from "@/lib/config";

/**
 * Chrome for the staff console. Deliberately not the storefront frame: no shop navigation, cart,
 * floating assistant or shop footer. The ink bar marks that this is a working tool for staff.
 */
const STAFF_LINK =
  "inline-flex min-h-11 items-center rounded-pill px-3 text-[15px] text-ink-muted transition-colors duration-200 hover:text-on-primary aria-[current=page]:bg-on-primary aria-[current=page]:text-text";

export function StaffFrame({
  current,
  children,
}: {
  mode: AppMode;
  current: "tiket" | "stok";
  children: ReactNode;
}) {
  const auth = useAuth();
  const signedIn = auth.sessionStatus === "signed_in";

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#konten"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-pill focus:bg-surface focus:px-4 focus:py-2"
      >
        Lewati ke konten
      </a>
      <header className="md:sticky md:top-0 md:z-30">
        <div className="bg-primary text-on-primary">
          <div className="mx-auto flex max-w-[90rem] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 md:px-6">
            <p className="flex min-h-11 items-center gap-3">
              <span className="font-display text-[22px] font-semibold leading-none">
                tokolangkah<span aria-hidden="true" className="text-accent">.</span>
              </span>
              <span className="rounded-pill border border-ink-rule px-2.5 py-0.5 text-[13px] text-ink-muted">Konsol staf</span>
            </p>
            <nav aria-label="Konsol staf" className="flex-1">
              <ul className="flex flex-wrap gap-1">
                <li>
                  <Link href="/staf" aria-current={current === "tiket" ? "page" : undefined} className={STAFF_LINK}>
                    Tiket
                  </Link>
                </li>
                <li>
                  <Link href="/staf/stok" aria-current={current === "stok" ? "page" : undefined} className={STAFF_LINK}>
                    Stok
                  </Link>
                </li>
                <li>
                  <Link href="/" className={STAFF_LINK}>
                    Lihat toko
                  </Link>
                </li>
              </ul>
            </nav>
            {signedIn ? (
              <div className="flex min-w-0 items-center gap-3">
                <span className="hidden min-w-0 max-w-[16rem] truncate text-sm text-ink-muted md:inline" data-testid="signed-in-email">
                  {auth.email}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void auth.signOut();
                  }}
                  className="min-h-11 rounded-pill border border-ink-rule px-4 text-[15px] transition-colors duration-200 hover:border-on-primary"
                >
                  Keluar
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <main id="konten" tabIndex={-1} className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-6 focus:outline-none md:px-6">
        {children}
      </main>
    </div>
  );
}
