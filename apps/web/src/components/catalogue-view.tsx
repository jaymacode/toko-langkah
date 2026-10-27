import { ProductList } from "@/components/product-list";
import { SiteFrame } from "@/components/site-frame";
import type { AppMode } from "@/lib/config";

/** Catalogue page: every product from the catalogue API, with explicit states. */
export function CatalogueView({ mode }: { mode: AppMode }) {
  return (
    <SiteFrame mode={mode} current="produk">
      <section aria-labelledby="catalogue-heading" className="flex flex-col gap-6">
        <div>
          <h1 id="catalogue-heading" className="text-2xl font-semibold text-text">
            Produk
          </h1>
          <p className="mt-2 text-muted">Sepatu fiktif untuk demo. Harga dalam rupiah.</p>
        </div>
        <ProductList emptyText="Belum ada produk" headingLevel={2} />
      </section>
    </SiteFrame>
  );
}
