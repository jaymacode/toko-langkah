import type { Metadata } from "next";
import { AssistantView } from "@/components/assistant-view";
import { getConfig } from "@/lib/config";

export const metadata: Metadata = {
  title: "Asisten — TokoLangkah",
  description: "Tanya produk, ukuran, pesanan, atau kebijakan toko TokoLangkah.",
};

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mode } = getConfig();
  const raw = (await searchParams).tanya;
  const question = typeof raw === "string" ? raw : "";
  return <AssistantView mode={mode} initialQuestion={question} />;
}
