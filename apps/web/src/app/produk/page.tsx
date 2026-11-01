import type { Metadata } from "next";
import { Suspense } from "react";
import { CatalogueView } from "@/components/catalogue-view";
import { getConfig } from "@/lib/config";

export const metadata: Metadata = {
  title: "Produk — TokoLangkah",
  description: "Katalog sepatu TokoLangkah: harga dalam rupiah, ukuran EU yang tersedia.",
};

export default function ProductsPage() {
  const { mode } = getConfig();
  // The filters read the URL on the client; Suspense keeps the page statically renderable.
  return (
    <Suspense>
      <CatalogueView mode={mode} />
    </Suspense>
  );
}
