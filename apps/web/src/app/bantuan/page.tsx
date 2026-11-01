import type { Metadata } from "next";
import { HelpView } from "@/components/help-view";
import { getConfig } from "@/lib/config";

export const metadata: Metadata = {
  title: "Bantuan & FAQ — TokoLangkah",
  description: "Ketentuan toko TokoLangkah: retur, pengiriman, pembayaran, ukuran dan bantuan.",
};

export default function HelpPage() {
  const { mode } = getConfig();
  return <HelpView mode={mode} />;
}
