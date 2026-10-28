"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowIcon } from "@/components/icons";
import { ProductCard } from "@/components/product-card";
import { SiteFrame } from "@/components/site-frame";
import { SizePicker } from "@/components/size-picker";
import { getProduct, toApiError } from "@/lib/api";
import type { ApiError, Product } from "@/lib/api";
import type { AppMode } from "@/lib/config";
import { formatIdr } from "@/lib/format";
import { NEEDS, matchesNeed } from "@/lib/needs";
import { catalogueErrorMessage, useCart, useCatalogue } from "@/lib/use-store";

type DetailState =
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "error"; error: ApiError }
  | { status: "ready"; product: Product };

export const PICK_SIZE_MESSAGE = "Pilih ukuran yang tersedia dulu.";
export const ADDED_MESSAGE = "Ditambahkan ke keranjang.";
const STORAGE_REFUSED_MESSAGE = "Browser menolak menyimpan keranjang. Izinkan penyimpanan situs lalu coba lagi.";

function Breadcrumb({ name }: { name: string | null }) {
  return (
    <nav aria-label="Jejak halaman">
      <ol className="flex flex-wrap items-center gap-1 text-[15px] text-muted">
        <li>
          <Link href="/" className="inline-flex min-h-11 items-center px-1 underline-offset-4 hover:text-text hover:underline">
            Beranda
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li>
          <Link href="/produk" className="inline-flex min-h-11 items-center px-1 underline-offset-4 hover:text-text hover:underline">
            Produk
          </Link>
        </li>
        {name ? (
          <>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="px-1 text-text">
              {name}
            </li>
          </>
        ) : null}
      </ol>
    </nav>
  );
}

function BuyBox({ product }: { product: Product }) {
  const cart = useCart();
  const [size, setSize] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "added"; text: string } | null>(null);
  const messageId = useId();
  const pickerRef = useRef<HTMLDivElement>(null);
  const anyInStock = product.sizes.some((entry) => entry.in_stock);

  function addToCart() {
    if (size === null) {
      setMessage({ kind: "error", text: PICK_SIZE_MESSAGE });
      pickerRef.current?.querySelector<HTMLInputElement>("input:not(:disabled)")?.focus();
      return;
    }
    const stored = cart.add(product.slug, size);
    setMessage(stored ? { kind: "added", text: ADDED_MESSAGE } : { kind: "error", text: STORAGE_REFUSED_MESSAGE });
  }

  const needs = NEEDS.filter((need) => matchesNeed(product, need.key));
  // Two-tone headline rule: the last word of the name sits in quiet grey.
  const split = product.name.lastIndexOf(" ");
  const head = split > 0 ? product.name.slice(0, split) : "";
  const tail = split > 0 ? product.name.slice(split + 1) : product.name;

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-[clamp(40px,6vw,72px)] font-bold uppercase leading-[0.86] text-text">
          {head ? `${head} ` : null}
          <span className={head ? "text-quiet" : undefined}>{tail}</span>
        </h1>
        <p data-price className="tabular text-[28px] font-semibold text-text">
          {formatIdr(product.price_idr)}
        </p>
        <p className="max-w-[46ch] text-[17px] leading-relaxed text-muted">{product.description}</p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-y border-border py-4 text-[15px]">
        {product.color ? (
          <>
            <dt className="text-muted">Warna</dt>
            <dd className="text-text">{product.color}</dd>
          </>
        ) : null}
        {needs.length > 0 ? (
          <>
            <dt className="text-muted">Kebutuhan</dt>
            <dd className="flex flex-wrap gap-x-3">
              {needs.map((need) => (
                <Link key={need.key} href={`/produk?kebutuhan=${need.key}`} className="text-text underline underline-offset-4">
                  {need.label}
                </Link>
              ))}
            </dd>
          </>
        ) : null}
      </dl>

      {anyInStock ? (
        <div ref={pickerRef}>
          <SizePicker
            name={`ukuran-${product.slug}`}
            legend="Pilih ukuran (EU)"
            sizes={product.sizes}
            value={size}
            onChange={(next) => {
              setSize(next);
              setMessage(null);
            }}
            describedBy={message ? messageId : undefined}
          />
        </div>
      ) : (
        <p className="rounded-bay bg-stone px-4 py-3 text-text">Semua ukuran model ini sedang habis.</p>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {/* Below md this group is a bar fixed to the bottom of the screen; from md it sits inline. */}
          <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t border-border bg-background/95 px-4 py-3 md:static md:z-auto md:border-0 md:bg-transparent md:p-0">
            <p className="tabular text-[17px] font-semibold text-text md:hidden">{formatIdr(product.price_idr)}</p>
            <button
              type="button"
              onClick={addToCart}
              disabled={!anyInStock}
              className="inline-flex min-h-12 items-center gap-2 rounded-pill bg-primary px-7 text-[15px] font-medium text-on-primary transition-opacity duration-200 hover:opacity-85 disabled:opacity-60"
            >
              Tambah ke keranjang
            </button>
          </div>
          <Link
            href={`/asisten?tanya=${encodeURIComponent(`Tentang ${product.name}: `)}`}
            className="inline-flex min-h-12 items-center rounded-pill border border-text px-6 text-[15px] text-text transition-colors duration-200 hover:bg-primary hover:text-on-primary"
          >
            Tanya asisten soal sepatu ini
          </Link>
        </div>
        <div aria-live="polite" id={messageId}>
          {message?.kind === "error" ? (
            <p className="flex items-center gap-2 text-accent-ink">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
              {message.text}
            </p>
          ) : null}
          {message?.kind === "added" ? (
            <p className="flex flex-wrap items-center gap-x-3 text-text">
              {message.text}
              <Link href="/keranjang" className="inline-flex min-h-11 items-center gap-1 font-medium underline underline-offset-4">
                Lihat keranjang
                <ArrowIcon />
              </Link>
            </p>
          ) : null}
        </div>
        <p className="text-sm text-muted">Demo: keranjang hanya tersimpan di browser ini dan pembayaran tidak tersedia.</p>
      </div>
    </div>
  );
}

function MoreShoes({ current }: { current: string }) {
  const { state } = useCatalogue();
  if (state.status !== "ready") return null;
  const others = state.items.filter((product) => product.slug !== current).slice(0, 3);
  if (others.length === 0) return null;
  return (
    <section aria-labelledby="more-heading" className="flex flex-col gap-5">
      <h2 id="more-heading" className="font-display text-[clamp(32px,4vw,52px)] font-bold uppercase leading-[0.9] text-text">
        Sepatu <span className="text-quiet">lainnya</span>
      </h2>
      <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {others.map((product) => (
          <li key={product.id} className="min-w-0">
            <ProductCard product={product} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Product page: large photo, price, description, the size ruler as picker, add to the demo cart. */
export function ProductDetailView({ mode, slug }: { mode: AppMode; slug: string }) {
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    getProduct(slug)
      .then((product) => {
        if (active) setState({ status: "ready", product });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const apiError = toApiError(error);
        setState(apiError.kind === "not_found" ? { status: "not_found" } : { status: "error", error: apiError });
      });
    return () => {
      active = false;
    };
  }, [slug, attempt]);

  const product = state.status === "ready" ? state.product : null;

  return (
    // The inline "Tanya asisten soal sepatu ini" already carries the product, so no floating button here.
    <SiteFrame mode={mode} current="produk" showAssistantButton={false} reserveBottom>
      <div className="flex flex-col gap-16 md:gap-20">
        <div className="flex flex-col gap-4">
          <Breadcrumb name={product?.name ?? null} />
          {state.status === "loading" ? (
            <p role="status" className="text-muted">
              Memuat produk…
            </p>
          ) : null}
          {state.status === "not_found" ? (
            <div className="flex flex-col items-start gap-4 rounded-card border border-border bg-surface p-6">
              <h1 className="font-display text-[clamp(36px,5vw,56px)] font-bold uppercase leading-[0.9] text-text">
                Produk <span className="text-quiet">tidak ditemukan</span>
              </h1>
              <Link
                href="/produk"
                className="inline-flex min-h-11 items-center rounded-pill bg-primary px-5 font-medium text-on-primary transition-opacity duration-200 hover:opacity-85"
              >
                Kembali ke katalog
              </Link>
            </div>
          ) : null}
          {state.status === "error" ? (
            <div className="flex flex-col items-start gap-4 rounded-card border border-border bg-surface p-6">
              <p role="alert" className="font-display text-[22px] leading-snug text-text">
                {catalogueErrorMessage(state.error)}
              </p>
              <button
                type="button"
                onClick={() => {
                  setState({ status: "loading" });
                  setAttempt((current) => current + 1);
                }}
                className="min-h-11 rounded-pill bg-primary px-5 font-medium text-on-primary transition-opacity duration-200 hover:opacity-85"
              >
                Coba lagi
              </button>
            </div>
          ) : null}
          {product ? (
            <div className="grid gap-8 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
              <div className="rounded-card border border-border bg-surface p-1.5 lg:sticky lg:top-32 lg:self-start">
                <div className="relative aspect-square overflow-hidden rounded-bay bg-stone">
                  {product.image_path ? (
                    <Image
                      src={product.image_path}
                      alt={product.image_alt}
                      fill
                      priority
                      sizes="(min-width: 1024px) 640px, 100vw"
                      className="object-contain"
                    />
                  ) : (
                    <p className="flex h-full items-center justify-center p-4 text-sm text-muted">Foto belum tersedia</p>
                  )}
                </div>
              </div>
              <BuyBox key={product.slug} product={product} />
            </div>
          ) : null}
        </div>
        {product ? <MoreShoes current={product.slug} /> : null}
      </div>
    </SiteFrame>
  );
}
