"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import { BagIcon, ChatIcon } from "@/components/icons";
import { itemCount } from "@/lib/cart";
import type { AppMode } from "@/lib/config";
import { useCart } from "@/lib/use-store";

export type NavKey = "beranda" | "produk" | "asisten" | "bantuan" | "pesanan" | "keranjang" | "staf";

const NAV_LINK_CLASS =
  "inline-flex min-h-11 items-center rounded-pill px-3 text-[15px] text-text transition-colors duration-200 hover:bg-stone aria-[current=page]:bg-primary aria-[current=page]:text-on-primary";

/** Link to the assistant page, optionally with a question pre-filled (never sent automatically). */
export function assistantHref(question?: string | null): string {
  return question ? `/asisten?tanya=${encodeURIComponent(question)}` : "/asisten";
}

function CartLink({ current }: { current: boolean }) {
  const { lines } = useCart();
  const count = itemCount(lines);
  return (
    <Link
      href="/keranjang"
      aria-current={current ? "page" : undefined}
      aria-label={count > 0 ? `Keranjang, ${count} barang` : "Keranjang, kosong"}
      className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-rule bg-surface px-3.5 text-[15px] text-text transition-colors duration-200 hover:border-text aria-[current=page]:border-text"
    >
      <BagIcon />
      <span aria-hidden="true" className="hidden sm:inline">
        Keranjang
      </span>
      <span
        aria-hidden="true"
        data-testid="cart-count"
        className={`tabular inline-flex h-6 min-w-6 items-center justify-center rounded-pill px-1.5 text-[13px] font-semibold ${
          count > 0 ? "bg-primary text-on-primary" : "bg-stone text-muted"
        }`}
      >
        {count}
      </span>
    </Link>
  );
}

/**
 * Shared header, footer and main landmark for every page. The Staf link appears
 * only when /me reports a staff store. Store pages also get the floating assistant button,
 * which can carry a question about the shoe on screen.
 */
export function SiteFrame({
  current,
  assistantQuestion = null,
  showAssistantButton,
  reserveBottom = false,
  children,
}: {
  mode: AppMode;
  current: NavKey | null;
  /** Pre-fills the assistant composer when the floating button is used. */
  assistantQuestion?: string | null;
  /** Defaults to true on store pages and false on the assistant and staff pages. */
  showAssistantButton?: boolean;
  /** Keeps room under the footer for a page's own fixed bottom bar (e.g. add to cart on phones). */
  reserveBottom?: boolean;
  children: ReactNode;
}) {
  const auth = useAuth();
  const signedIn = auth.sessionStatus === "signed_in";
  const floating = showAssistantButton ?? (current !== "asisten" && current !== "staf");

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#konten"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-pill focus:bg-surface focus:px-4 focus:py-2"
      >
        Lewati ke konten
      </a>
      <header className="border-b border-border bg-background/95 md:sticky md:top-0 md:z-30">
        <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 md:grid-cols-[1fr_auto_1fr] md:px-8">
          <Link
            href="/"
            aria-label="TokoLangkah, beranda"
            className="font-display col-start-1 row-start-1 inline-flex min-h-11 items-center justify-self-start text-[22px] font-semibold leading-none text-text md:col-start-2 md:justify-self-center"
          >
            tokolangkah<span aria-hidden="true" className="text-accent">.</span>
          </Link>
          <nav aria-label="Utama" className="col-span-2 row-start-2 -mx-1 md:col-span-1 md:col-start-1 md:row-start-1">
            <ul className="flex flex-wrap gap-1">
              <li>
                <Link href="/produk" aria-current={current === "produk" ? "page" : undefined} className={NAV_LINK_CLASS}>
                  Produk
                </Link>
              </li>
              <li>
                <Link href="/asisten" aria-current={current === "asisten" ? "page" : undefined} className={NAV_LINK_CLASS}>
                  Asisten
                </Link>
              </li>
              <li>
                <Link href="/bantuan" aria-current={current === "bantuan" ? "page" : undefined} className={NAV_LINK_CLASS}>
                  Bantuan
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
                  className="hidden min-w-0 max-w-[12rem] truncate text-sm text-muted lg:inline"
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
                className="inline-flex min-h-11 items-center rounded-pill border border-rule bg-surface px-4 text-[15px] text-text transition-colors duration-200 hover:border-text"
              >
                Masuk
              </Link>
            )}
            <CartLink current={current === "keranjang"} />
          </div>
        </div>
      </header>
      {/* tabIndex -1 lets the skip link move keyboard focus here; the outline is removed only on this container. */}
      <main
        id="konten"
        tabIndex={-1}
        className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 focus:outline-none md:px-8 md:py-10"
      >
        {children}
      </main>
      <footer className="border-t border-border">
        {/* Extra bottom room keeps the floating assistant button off the footer links. */}
        <div className={`mx-auto grid max-w-7xl gap-6 px-4 pt-8 md:grid-cols-[1fr_auto] md:items-end md:px-8 ${floating || reserveBottom ? "pb-24" : "pb-8"}`}>
          <div>
            <p className="font-display text-[22px] font-semibold leading-none text-text">
              tokolangkah<span aria-hidden="true" className="text-accent">.</span>
            </p>
            <p className="mt-2 max-w-[52ch] text-sm text-muted">
              Toko sepatu TokoLangkah. Tanya produk, ukuran, pesanan, atau kebijakan toko kepada asisten kami.
            </p>
          </div>
          <nav aria-label="Tautan bawah">
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[15px]">
              <li>
                <Link href="/produk" className="inline-flex min-h-11 items-center text-text underline-offset-4 hover:underline">
                  Semua produk
                </Link>
              </li>
              <li>
                <Link href="/bantuan" className="inline-flex min-h-11 items-center text-text underline-offset-4 hover:underline">
                  Bantuan &amp; FAQ
                </Link>
              </li>
              <li>
                <Link href="/pesanan" className="inline-flex min-h-11 items-center text-text underline-offset-4 hover:underline">
                  Cek pesanan
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </footer>
      {floating ? (
        <aside aria-label="Bantuan asisten">
        <Link
          href={assistantHref(assistantQuestion)}
          data-testid="assistant-fab"
          className="fixed bottom-4 right-4 z-40 inline-flex min-h-12 items-center gap-2 rounded-pill bg-primary px-5 text-[15px] font-medium text-on-primary shadow-[0_14px_34px_-14px_rgba(21,22,23,0.6)] transition-transform duration-300 ease-out-expo hover:-translate-y-0.5 md:bottom-6 md:right-8"
        >
          <ChatIcon />
          Tanya asisten
        </Link>
        </aside>
      ) : null}
    </div>
  );
}
