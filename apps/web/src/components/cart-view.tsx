"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ArrowIcon, CloseIcon, MinusIcon, PlusIcon } from "@/components/icons";
import { SiteFrame } from "@/components/site-frame";
import type { Product } from "@/lib/api";
import { MAX_LINE_QUANTITY, itemCount } from "@/lib/cart";
import type { CartLine } from "@/lib/cart";
import type { AppMode } from "@/lib/config";
import { formatIdr } from "@/lib/format";
import { catalogueErrorMessage, useCart, useCatalogue } from "@/lib/use-store";

export const CHECKOUT_UNAVAILABLE_MESSAGE =
  "Pembayaran tidak tersedia di demo ini. Tidak ada pesanan yang dibuat dan isi keranjang tidak dikirim ke mana pun.";

type ResolvedLine = { line: CartLine; product: Product | null; available: boolean };

function resolve(lines: CartLine[], products: Product[]): ResolvedLine[] {
  return lines.map((line) => {
    const product = products.find((candidate) => candidate.slug === line.slug) ?? null;
    const available = product?.sizes.some((size) => size.size_eu === line.size_eu && size.in_stock) ?? false;
    return { line, product, available };
  });
}

function LineRow({ entry }: { entry: ResolvedLine }) {
  const cart = useCart();
  const { line, product, available } = entry;
  const name = product?.name ?? line.slug;
  const stepClass =
    "inline-flex h-11 w-11 items-center justify-center rounded-pill text-text transition-colors duration-200 hover:bg-stone disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <li className="grid grid-cols-[6rem_1fr] gap-4 rounded-card border border-border bg-surface p-1.5 pr-4 sm:grid-cols-[8rem_1fr]">
      <div className="relative aspect-square overflow-hidden rounded-bay bg-stone">
        {product?.image_path ? (
          <Image src={product.image_path} alt={product.image_alt} fill sizes="128px" className="object-contain" />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col justify-between gap-3 py-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-[22px] font-medium leading-tight text-text">
              {product ? (
                <Link href={`/produk/${product.slug}`} className="underline-offset-4 hover:underline">
                  {name}
                </Link>
              ) : (
                name
              )}
            </h2>
            <p className="tabular text-sm text-muted">
              Ukuran EU {line.size_eu}
              {product?.color ? ` · ${product.color}` : ""}
            </p>
            {!available ? (
              <p className="mt-1 flex items-center gap-2 text-sm text-accent-ink">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
                {product ? "Ukuran ini sekarang habis. Tidak dihitung di total." : "Produk ini tidak ada lagi di katalog."}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => cart.remove(line)}
            aria-label={`Hapus ${name} ukuran ${line.size_eu} dari keranjang`}
            className="-mr-2 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-pill text-text transition-colors duration-200 hover:bg-stone"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center rounded-pill border border-rule" role="group" aria-label={`Jumlah ${name}`}>
            <button
              type="button"
              onClick={() => cart.update(line, line.quantity - 1)}
              disabled={line.quantity <= 1}
              aria-label="Kurangi satu"
              className={stepClass}
            >
              <MinusIcon />
            </button>
            <span className="tabular min-w-8 text-center text-[17px] font-semibold text-text" aria-live="polite">
              {line.quantity}
            </span>
            <button
              type="button"
              onClick={() => cart.update(line, line.quantity + 1)}
              disabled={line.quantity >= MAX_LINE_QUANTITY}
              aria-label="Tambah satu"
              className={stepClass}
            >
              <PlusIcon />
            </button>
          </div>
          {product ? (
            <p className={`tabular text-[17px] font-semibold ${available ? "text-text" : "text-muted line-through"}`}>
              {formatIdr(product.price_idr * line.quantity)}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** Demo cart page. Checkout stops honestly: there are no payments and no order is created. */
export function CartView({ mode }: { mode: AppMode }) {
  const cart = useCart();
  const { state, retry } = useCatalogue();
  const [checkoutTried, setCheckoutTried] = useState(false);
  const count = itemCount(cart.lines);
  const resolved = state.status === "ready" ? resolve(cart.lines, state.items) : [];
  const total = resolved.reduce((sum, entry) => (entry.available && entry.product ? sum + entry.product.price_idr * entry.line.quantity : sum), 0);
  const payable = resolved.filter((entry) => entry.available).reduce((sum, entry) => sum + entry.line.quantity, 0);

  return (
    <SiteFrame mode={mode} current="keranjang">
      <section aria-labelledby="cart-heading" className="flex flex-col gap-8">
        <h1 id="cart-heading" className="font-display text-[clamp(40px,6vw,72px)] font-bold uppercase leading-[0.86] text-text">
          Keranjang
        </h1>

        {count === 0 ? (
          <div className="flex flex-col items-start gap-5 rounded-card border border-border bg-surface p-6 md:p-10">
            <p className="font-display text-[clamp(26px,3vw,36px)] leading-tight text-text">Keranjang Anda masih kosong.</p>
            <Link
              href="/produk"
              className="inline-flex min-h-12 items-center gap-2 rounded-pill bg-primary px-6 text-[15px] font-medium text-on-primary transition-opacity duration-200 hover:opacity-85"
            >
              Lihat produk
              <ArrowIcon />
            </Link>
          </div>
        ) : state.status === "loading" ? (
          <p role="status" className="text-muted">
            Memuat keranjang…
          </p>
        ) : state.status === "error" ? (
          <div className="flex flex-col items-start gap-4 rounded-card border border-border bg-surface p-6">
            <p role="alert" className="font-display text-[22px] leading-snug text-text">
              {catalogueErrorMessage(state.error)}
            </p>
            <button
              type="button"
              onClick={retry}
              className="min-h-11 rounded-pill bg-primary px-5 font-medium text-on-primary transition-opacity duration-200 hover:opacity-85"
            >
              Coba lagi
            </button>
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[1fr_22rem] lg:items-start">
            <ul aria-label="Isi keranjang" className="flex flex-col gap-3">
              {resolved.map((entry) => (
                <LineRow key={`${entry.line.slug}-${entry.line.size_eu}`} entry={entry} />
              ))}
            </ul>
            <aside
              aria-labelledby="summary-heading"
              className="flex flex-col gap-5 rounded-card border border-border bg-surface p-6 lg:sticky lg:top-32"
            >
              <h2 id="summary-heading" className="font-display text-[26px] font-medium leading-tight text-text">
                Ringkasan
              </h2>
              <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-[15px]">
                <dt className="text-muted">Barang</dt>
                <dd className="tabular text-right text-text">{payable}</dd>
                <dt className="text-muted">Ongkos kirim</dt>
                <dd className="text-right text-muted">Tidak dihitung di demo</dd>
                <dt className="border-t border-border pt-3 font-medium text-text">Subtotal</dt>
                <dd className="tabular border-t border-border pt-3 text-right text-[22px] font-semibold text-text">
                  {formatIdr(total)}
                </dd>
              </dl>
              <button
                type="button"
                onClick={() => setCheckoutTried(true)}
                disabled={payable === 0}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-pill bg-primary px-6 text-[15px] font-medium text-on-primary transition-opacity duration-200 hover:opacity-85 disabled:opacity-60"
              >
                Lanjut ke pembayaran
              </button>
              <div aria-live="polite">
                {checkoutTried ? (
                  <p className="rounded-bay bg-stone px-4 py-3 text-[15px] leading-relaxed text-text">
                    {CHECKOUT_UNAVAILABLE_MESSAGE}
                  </p>
                ) : null}
              </div>
              <Link href="/produk" className="inline-flex min-h-11 items-center gap-2 text-[15px] text-text underline underline-offset-4">
                Lanjut belanja
              </Link>
            </aside>
          </div>
        )}
      </section>
    </SiteFrame>
  );
}
