import type { Metadata } from "next";
import { OrdersView } from "@/components/orders-view";
import { getConfig } from "@/lib/config";

export const metadata: Metadata = {
  title: "Pesanan — TokoLangkah",
  description: "Pesanan akun yang sedang masuk di TokoLangkah.",
};

export default function OrdersPage() {
  const { mode } = getConfig();
  return <OrdersView mode={mode} />;
}
