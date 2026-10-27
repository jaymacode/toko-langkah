import type { Metadata } from "next";
import { OrderDetailView } from "@/components/order-detail-view";
import { getConfig } from "@/lib/config";

export const metadata: Metadata = {
  title: "Detail pesanan — TokoLangkah Demo",
  description: "Detail pesanan pada akun yang sedang masuk.",
};

export default async function OrderPage({ params }: { params: Promise<{ order_number: string }> }) {
  const { order_number } = await params;
  const { mode } = getConfig();
  return <OrderDetailView mode={mode} orderNumber={order_number} />;
}
