import type { Metadata } from "next";
import { StaffView } from "@/components/staff-view";
import { getConfig } from "@/lib/config";

export const metadata: Metadata = {
  title: "Staf — TokoLangkah Demo",
  description: "Tiket eskalasi untuk staf toko fiktif TokoLangkah.",
};

export default function StaffPage() {
  const { mode } = getConfig();
  return <StaffView mode={mode} />;
}
