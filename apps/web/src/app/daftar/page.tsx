import type { Metadata } from "next";
import { SignUpView } from "@/components/sign-up-view";
import { getConfig } from "@/lib/config";

export const metadata: Metadata = {
  title: "Daftar — TokoLangkah",
  description: "Buat akun pelanggan di toko TokoLangkah.",
};

export default function SignUpPage() {
  const { mode } = getConfig();
  return <SignUpView mode={mode} />;
}
