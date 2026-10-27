import type { Metadata } from "next";
import { CatalogueView } from "@/components/catalogue-view";
import { getConfig } from "@/lib/config";

export const metadata: Metadata = {
  title: "Produk — TokoLangkah Demo",
  description: "Katalog sepatu fiktif TokoLangkah untuk demo.",
};

export default function ProductsPage() {
  const { mode } = getConfig();
  return <CatalogueView mode={mode} />;
}
