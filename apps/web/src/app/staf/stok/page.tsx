import type { Metadata } from "next";
import { StockView } from "@/components/stock-view";
import { getConfig } from "@/lib/config";

export const metadata: Metadata = {
  title: "Stok — Konsol staf TokoLangkah",
  description: "Kelola stok per ukuran untuk staf toko demo.",
};

export default function StockPage() {
  const { mode } = getConfig();
  return <StockView mode={mode} />;
}
