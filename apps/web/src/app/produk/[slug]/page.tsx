import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductDetailView } from "@/components/product-detail-view";
import { getConfig } from "@/lib/config";

export const metadata: Metadata = {
  title: "Produk — TokoLangkah Demo",
  description: "Detail sepatu fiktif TokoLangkah.",
};

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,100}$/.test(slug)) notFound();
  const { mode } = getConfig();
  return <ProductDetailView key={slug} mode={mode} slug={slug} />;
}
