import { StorefrontView } from "@/components/storefront-view";
import { getConfig } from "@/lib/config";

export default function HomePage() {
  const { mode } = getConfig();
  return <StorefrontView mode={mode} />;
}
