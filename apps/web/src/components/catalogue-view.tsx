import { ProductList } from "@/components/product-list";
import { SiteFrame } from "@/components/site-frame";
import type { AppMode } from "@/lib/config";

/** Catalogue page: every product from the catalogue API, with explicit states. */
export function CatalogueView({ mode }: { mode: AppMode }) {
  return (
    <SiteFrame mode={mode} current="produk">
      <section aria-labelledby="catalogue-heading" className="flex flex-col gap-10">
        <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
          <h1
            id="catalogue-heading"
            className="font-display text-[clamp(64px,13vw,168px)] font-bold uppercase leading-[0.82] text-text"
          >
            Produk
          </h1>
          <p className="max-w-[26ch] text-[17px] leading-snug text-muted md:pb-3 md:text-right">
            Sepatu fiktif untuk demo. Harga dalam rupiah.
          </p>
        </div>
        <ProductList emptyText="Belum ada produk" headingLevel={2} />
      </section>
    </SiteFrame>
  );
}

