"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo } from "react";
import type { ReactNode } from "react";
import { CloseIcon } from "@/components/icons";
import { ProductCard } from "@/components/product-card";
import { SiteFrame } from "@/components/site-frame";
import type { Product } from "@/lib/api";
import type { AppMode } from "@/lib/config";
import { formatIdr } from "@/lib/format";
import { NEEDS, isNeedKey, matchesNeed } from "@/lib/needs";
import type { NeedKey } from "@/lib/needs";
import { catalogueErrorMessage, useCatalogue } from "@/lib/use-store";

/** Budget caps are inclusive ("maksimal"): price <= cap. */
const BUDGETS = [300_000, 500_000] as const;
type SortKey = "harga-naik" | "harga-turun" | "nama";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "harga-naik", label: "Harga terendah" },
  { key: "harga-turun", label: "Harga tertinggi" },
  { key: "nama", label: "Nama A–Z" },
];

type Filters = { need: NeedKey | null; size: number | null; budget: number | null; sort: SortKey };

function readFilters(params: URLSearchParams): Filters {
  const need = params.get("kebutuhan");
  const size = Number(params.get("ukuran"));
  const budget = Number(params.get("harga"));
  const sort = params.get("urut");
  return {
    need: isNeedKey(need) ? need : null,
    size: Number.isSafeInteger(size) && size >= 30 && size <= 50 ? size : null,
    budget: (BUDGETS as readonly number[]).includes(budget) ? budget : null,
    sort: SORTS.some((option) => option.key === sort) ? (sort as SortKey) : "harga-naik",
  };
}

function applyFilters(products: Product[], filters: Filters): Product[] {
  const matching = products.filter(
    (product) =>
      (filters.need === null || matchesNeed(product, filters.need)) &&
      // A size filter keeps only shoes where that exact size is in stock.
      (filters.size === null || product.sizes.some((size) => size.size_eu === filters.size && size.in_stock)) &&
      (filters.budget === null || product.price_idr <= filters.budget),
  );
  const sorted = [...matching];
  if (filters.sort === "nama") sorted.sort((a, b) => a.name.localeCompare(b.name, "id"));
  else if (filters.sort === "harga-turun") sorted.sort((a, b) => b.price_idr - a.price_idr);
  else sorted.sort((a, b) => a.price_idr - b.price_idr);
  return sorted;
}

function FilterGroup({
  legend,
  layout,
  children,
}: {
  legend: string;
  /** "grid": equal cells (sizes); "stack": one option per row (price caps). */
  layout: "grid" | "stack";
  children: ReactNode;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-[12px] font-medium uppercase tracking-[0.08em] text-muted">{legend}</legend>
      <div className={layout === "grid" ? "grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-4" : "flex flex-col gap-1.5"}>
        {children}
      </div>
    </fieldset>
  );
}

/** One radio rendered as a pill; the checked one is the ink pill (DESIGN.md). */
function PillRadio({
  name,
  label,
  checked,
  onSelect,
  wide = false,
}: {
  name: string;
  label: string;
  checked: boolean;
  onSelect: () => void;
  /** Takes the whole first row, so a word label ("Semua") never leaves a number cell stranded. */
  wide?: boolean;
}) {
  return (
    <label className={`${wide ? "col-span-full " : ""}relative inline-flex min-h-11 cursor-pointer items-center justify-center rounded-pill border border-rule bg-surface px-4 text-[15px] text-text transition-colors duration-200 hover:border-text has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-on-primary has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-text`}>
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
      <span className="tabular">{label}</span>
    </label>
  );
}

/** A need option inside the segmented rail: stone track, the checked one is the ink pill. */
function SegmentRadio({ label, checked, onSelect }: { label: string; checked: boolean; onSelect: () => void }) {
  return (
    <label className="relative inline-flex min-h-11 cursor-pointer items-center rounded-pill px-4 text-[15px] text-text transition-colors duration-200 hover:bg-surface has-[:checked]:bg-primary has-[:checked]:text-on-primary has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-text">
      <input type="radio" name="kebutuhan" checked={checked} onChange={onSelect} className="sr-only" />
      {label}
    </label>
  );
}

/**
 * Catalogue: every shoe with need, size, budget and sort filters. Filters live in the URL
 * (?kebutuhan=&ukuran=&harga=&urut=) so a link from an aisle opens pre-filtered and Back works.
 */
export function CatalogueView({ mode }: { mode: AppMode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters = readFilters(new URLSearchParams(params.toString()));
  const { state, retry } = useCatalogue();
  const idPrefix = useId();
  const sortId = `${idPrefix}-sort`;

  const products = useMemo(() => (state.status === "ready" ? state.items : []), [state]);
  const sizes = useMemo(
    () => [...new Set(products.flatMap((product) => product.sizes.map((size) => size.size_eu)))].sort((a, b) => a - b),
    [products],
  );
  const shown = applyFilters(products, filters);
  const active = filters.need !== null || filters.size !== null || filters.budget !== null;

  function update(next: Partial<Record<"kebutuhan" | "ukuran" | "harga" | "urut", string | null>>) {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === undefined) query.delete(key);
      else query.set(key, value);
    }
    const search = query.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  }

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (filters.size) chips.push({ key: "size", label: `Ukuran ${filters.size}`, clear: () => update({ ukuran: null }) });
  if (filters.budget)
    chips.push({ key: "budget", label: `Maks. ${formatIdr(filters.budget)}`, clear: () => update({ harga: null }) });

  return (
    <SiteFrame mode={mode} current="produk">
      <section aria-labelledby="catalogue-heading" className="flex flex-col gap-8">
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <h1
            id="catalogue-heading"
            className="font-display text-[clamp(56px,10vw,128px)] font-bold uppercase leading-[0.82] text-text"
          >
            Produk
          </h1>
          <p className="max-w-[30ch] text-[17px] leading-snug text-muted md:pb-2 md:text-right">
            Harga dalam rupiah, ukuran EU yang tersedia.
          </p>
        </div>

        <fieldset className="min-w-0">
          <legend className="sr-only">Kebutuhan</legend>
          <div className="inline-flex max-w-full flex-wrap gap-1 rounded-[26px] bg-stone p-1">
            <SegmentRadio label="Semua" checked={filters.need === null} onSelect={() => update({ kebutuhan: null })} />
            {NEEDS.map((need) => (
              <SegmentRadio
                key={need.key}
                label={need.label}
                checked={filters.need === need.key}
                onSelect={() => update({ kebutuhan: need.key })}
              />
            ))}
          </div>
        </fieldset>
        <div className="grid gap-8 lg:grid-cols-[17rem_1fr] lg:items-start">
          <form
            aria-label="Filter produk"
            onSubmit={(event) => event.preventDefault()}
            className="flex flex-col gap-6 rounded-card border border-border bg-surface p-5 lg:sticky lg:top-32"
          >
            <FilterGroup legend="Ukuran EU tersedia" layout="grid">
              <PillRadio wide name="ukuran" label="Semua" checked={filters.size === null} onSelect={() => update({ ukuran: null })} />
              {sizes.map((size) => (
                <PillRadio
                  key={size}
                  name="ukuran"
                  label={String(size)}
                  checked={filters.size === size}
                  onSelect={() => update({ ukuran: String(size) })}
                />
              ))}
            </FilterGroup>
            <FilterGroup legend="Harga" layout="stack">
              <PillRadio name="harga" label="Semua harga" checked={filters.budget === null} onSelect={() => update({ harga: null })} />
              {BUDGETS.map((budget) => (
                <PillRadio
                  key={budget}
                  name="harga"
                  label={`Maks. ${formatIdr(budget)}`}
                  checked={filters.budget === budget}
                  onSelect={() => update({ harga: String(budget) })}
                />
              ))}
            </FilterGroup>
          </form>

          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p role="status" className="tabular text-[15px] text-text">
                {state.status === "ready" ? `${shown.length} dari ${products.length} sepatu` : ""}
              </p>
              <div className="flex items-center gap-2">
                <label htmlFor={sortId} className="text-[15px] text-muted">
                  Urutkan
                </label>
                <select
                  id={sortId}
                  value={filters.sort}
                  onChange={(event) => update({ urut: event.target.value === "harga-naik" ? null : event.target.value })}
                  className="min-h-11 rounded-pill border border-quiet bg-surface px-4 text-[15px] text-text hover:border-text"
                >
                  {SORTS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {chips.length > 0 ? (
              <ul aria-label="Filter aktif" className="flex flex-wrap gap-2">
                {chips.map((chip) => (
                  <li key={chip.key}>
                    <span className="inline-flex items-center gap-1 rounded-pill bg-primary pl-4 text-[15px] text-on-primary">
                      <span className="tabular">{chip.label}</span>
                      <button
                        type="button"
                        onClick={chip.clear}
                        aria-label={`Hapus filter ${chip.label}`}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-pill focus-visible:outline-on-primary"
                      >
                        <CloseIcon />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            {state.status === "loading" ? (
              <p role="status" className="text-muted">
                Memuat produk…
              </p>
            ) : null}
            {state.status === "error" ? (
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
            ) : null}
            {state.status === "ready" && products.length === 0 ? (
              <p className="rounded-card border border-border bg-surface p-6 font-display text-[22px] text-text">Belum ada produk</p>
            ) : null}
            {state.status === "ready" && products.length > 0 && shown.length === 0 ? (
              <div className="flex flex-col items-start gap-4 rounded-card border border-border bg-surface p-6">
                <p className="font-display text-[22px] leading-snug text-text">Tidak ada sepatu yang cocok dengan semua filter ini.</p>
                <button
                  type="button"
                  onClick={() => update({ kebutuhan: null, ukuran: null, harga: null })}
                  className="min-h-11 rounded-pill border border-text px-5 text-text transition-colors duration-200 hover:bg-primary hover:text-on-primary"
                >
                  Hapus semua filter
                </button>
              </div>
            ) : null}
            {shown.length > 0 ? (
              <ul className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
                {shown.map((product, index) => (
                  <li key={product.id} className="min-w-0">
                    <ProductCard product={product} headingLevel={2} eager={index < 3} />
                  </li>
                ))}
              </ul>
            ) : null}
            {active && shown.length > 0 ? (
              <p className="text-sm text-muted">Filter ukuran hanya menampilkan sepatu yang ukuran itu masih tersedia.</p>
            ) : null}
          </div>
        </div>
      </section>
    </SiteFrame>
  );
}
