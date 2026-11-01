import type { Metadata } from "next";
import { CartView } from "@/components/cart-view";
import { getConfig } from "@/lib/config";

export const metadata: Metadata = {
  title: "Keranjang — TokoLangkah",
  description: "Keranjang belanja TokoLangkah. Pembayaran online belum tersedia.",
};

export default function CartPage() {
  const { mode } = getConfig();
  return <CartView mode={mode} />;
}
