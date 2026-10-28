"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowIcon, ChatIcon } from "@/components/icons";
import { ProductCard } from "@/components/product-card";
import { SiteFrame, assistantHref } from "@/components/site-frame";
import type { Product } from "@/lib/api";
import type { AppMode } from "@/lib/config";
import { NEEDS, matchesNeed } from "@/lib/needs";
import type { Need } from "@/lib/needs";
import { catalogueErrorMessage, useCatalogue } from "@/lib/use-store";

export { DEMO_LABEL } from "@/components/site-frame";

/** Example questions, each opening the assistant with the text in the composer (not sent). */
const ASK_EXAMPLES = [
  "Sepatu buat jalan jauh di bawah 500 ribu",
  "Bagaimana kebijakan retur dan penukaran ukuran?",
  "Di mana pesanan saya sekarang?",
];

function Hero() {
  return (
    <section
      aria-labelledby="hero-heading"
      className="grid overflow-hidden rounded-card border border-border bg-surface p-1.5 md:grid-cols-[1.1fr_1fr]"
    >
      <div className="flex flex-col justify-center gap-6 px-5 py-8 md:px-10 md:py-10">
        <h1
          id="hero-heading"
          className="font-display text-[clamp(44px,5vw,72px)] font-bold uppercase leading-[0.88] text-text"
        >
          <span className="block lg:whitespace-nowrap">Sepatu untuk</span>{" "}
          <span className="block text-quiet lg:whitespace-nowrap">tiap langkah.</span>
        </h1>
        <p className="max-w-[40ch] text-[17px] leading-relaxed text-muted">
          Harga jelas dan ukuran EU yang benar-benar tersedia. Ragu memilih? Tanyakan ke asisten, jawabannya menyertakan
          sumber.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/produk"
            className="inline-flex min-h-12 items-center gap-2 rounded-pill bg-primary px-6 text-[15px] font-medium text-on-primary transition-opacity duration-200 hover:opacity-85"
          >
            Belanja sekarang
            <ArrowIcon />
          </Link>
          <Link
            href="/asisten"
            className="inline-flex min-h-12 items-center gap-2 rounded-pill border border-text px-6 text-[15px] text-text transition-colors duration-200 hover:bg-primary hover:text-on-primary"
          >
            Tanya asisten
          </Link>
        </div>
      </div>
      {/* The photos are matted to the stone colour, so a non-square bay stays one seamless surface. */}
      <div className="relative aspect-square overflow-hidden rounded-bay bg-stone md:aspect-auto md:min-h-[22rem]">
        <Image
          src={HERO_IMAGE}
          alt="Sepatu fiktif Awan Walk warna navy"
          fill
          priority
          sizes="(min-width: 768px) 50vw, 100vw"
          className="object-contain"
        />
      </div>
    </section>
  );
}

const HERO_IMAGE = "/products/awan-walk.png";

function Aisle({ need, products }: { need: Need; products: Product[] }) {
  const members = products.filter((product) => matchesNeed(product, need.key));
  // Prefer a shoe other than the hero's, so the first scroll does not repeat one photo.
  const face = members.find((product) => product.image_path !== HERO_IMAGE) ?? members[0];
  const allSoldOut = members.length > 0 && members.every((product) => product.sizes.every((size) => !size.in_stock));
  return (
    <li className="min-w-0">
      <Link
        href={`/produk?kebutuhan=${need.key}`}
        className="group flex h-full items-center gap-4 rounded-card border border-border bg-surface p-1.5 pr-5 transition-shadow duration-300 ease-out-expo hover:shadow-[0_18px_40px_-24px_rgba(21,22,23,0.35)]"
      >
        <span className="relative block aspect-square w-28 shrink-0 overflow-hidden rounded-bay bg-stone md:w-36">
          {face?.image_path ? (
            <Image
              src={face.image_path}
              alt=""
              fill
              sizes="144px"
              className="object-contain transition-transform duration-700 ease-out-expo group-hover:scale-[1.04]"
            />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="font-display text-[clamp(28px,3vw,36px)] font-bold uppercase leading-[0.9] text-text">
            {need.label}
          </span>
          <span className="text-sm text-muted">{need.blurb}</span>
          <span className="tabular text-sm font-medium text-text">
            {members.length} model
            {allSoldOut ? <span className="block text-accent-ink">Semua ukuran habis</span> : null}
          </span>
        </span>
        <ArrowIcon className="h-5 w-5 shrink-0 text-text transition-transform duration-300 ease-out-expo group-hover:translate-x-1" />
      </Link>
    </li>
  );
}

function CatalogueStatus({ state, retry }: ReturnType<typeof useCatalogue>) {
  if (state.status === "loading") {
    return (
      <p role="status" className="text-muted">
        Memuat produk…
      </p>
    );
  }
  if (state.status === "error") {
    return (
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
    );
  }
  return null;
}

/**
 * Store front page: hero, shopping aisles by need, every shoe, and a band that opens the
 * assistant with a real example question. Aisle counts come from the catalogue tags.
 */
export function StorefrontView({ mode }: { mode: AppMode }) {
  const catalogue = useCatalogue();
  const { state } = catalogue;
  const products = state.status === "ready" ? state.items : [];

  return (
    <SiteFrame mode={mode} current="beranda">
      <div className="flex flex-col gap-14">
        <Hero />

        <section aria-labelledby="aisles-heading" className="flex flex-col gap-5">
          <h2 id="aisles-heading" className="font-display text-[clamp(32px,4vw,52px)] font-bold uppercase leading-[0.9] text-text">
            Belanja <span className="text-quiet">sesuai kebutuhan</span>
          </h2>
          {state.status === "ready" ? (
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {NEEDS.map((need) => (
                <Aisle key={need.key} need={need} products={products} />
              ))}
            </ul>
          ) : (
            <CatalogueStatus {...catalogue} />
          )}
        </section>

        <section aria-labelledby="all-heading" className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <h2 id="all-heading" className="font-display text-[clamp(32px,4vw,52px)] font-bold uppercase leading-[0.9] text-text">
              Semua <span className="text-quiet">sepatu</span>
            </h2>
            <Link
              href="/produk"
              className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-text px-4 text-[15px] text-text transition-colors duration-200 hover:bg-primary hover:text-on-primary"
            >
              Lihat katalog
              <ArrowIcon />
            </Link>
          </div>
          {state.status === "ready" ? (
            products.length === 0 ? (
              <p className="rounded-card border border-border bg-surface p-6 font-display text-[22px] text-text">Belum ada produk</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                {products.slice(0, 8).map((product) => (
                  <li key={product.id} className="min-w-0">
                    <ProductCard product={product} />
                  </li>
                ))}
              </ul>
            )
          ) : state.status === "loading" ? (
            <p role="status" className="sr-only">
              Memuat produk…
            </p>
          ) : null}
        </section>

        <section
          aria-labelledby="ask-heading"
          className="grid gap-8 rounded-card bg-primary px-6 py-10 text-on-primary md:grid-cols-[1fr_1.1fr] md:items-end md:px-10 md:py-14"
        >
          <div className="flex flex-col gap-4">
            <h2 id="ask-heading" className="font-display text-[clamp(36px,5vw,64px)] font-bold uppercase leading-[0.88]">
              Ragu soal ukuran <span className="block text-ink-quiet">atau retur?</span>
            </h2>
            <p className="max-w-[44ch] text-[16px] leading-relaxed text-ink-muted">
              Asisten mencari sepatu dengan batas harga dan ukuran persis dari kata-kata Anda, mengutip kebijakan toko, dan
              bisa menyerahkan ke staf.
            </p>
          </div>
          <ul className="flex flex-col gap-2">
            {ASK_EXAMPLES.map((question) => (
              <li key={question}>
                <Link
                  href={assistantHref(question)}
                  className="group flex min-h-12 items-center justify-between gap-4 rounded-pill border border-ink-rule px-5 text-[15px] transition-colors duration-200 hover:border-on-primary hover:bg-on-primary hover:text-text"
                >
                  <span className="flex items-center gap-3">
                    <ChatIcon className="h-4 w-4 shrink-0" />
                    {question}
                  </span>
                  <ArrowIcon className="h-4 w-4 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </SiteFrame>
  );
}
