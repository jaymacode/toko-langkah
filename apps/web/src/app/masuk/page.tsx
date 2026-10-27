import type { Metadata } from "next";
import { SignInView } from "@/components/sign-in-view";
import { getConfig } from "@/lib/config";

export const metadata: Metadata = {
  title: "Masuk — TokoLangkah Demo",
  description: "Masuk ke akun demo fiktif TokoLangkah.",
};

export default function SignInPage() {
  const { mode } = getConfig();
  return <SignInView mode={mode} />;
}
