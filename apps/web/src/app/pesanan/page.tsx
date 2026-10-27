import type { Metadata } from "next";
import { OrdersView } from "@/components/orders-view";
import { getConfig } from "@/lib/config";

export const metadata: Metadata = {
  title: "Pesanan — TokoLangkah Demo",
  description: "Pesanan akun yang sedang masuk pada demo TokoLangkah.",
};

export default function OrdersPage() {
  const { mode } = getConfig();
  return <OrdersView mode={mode} />;
}
