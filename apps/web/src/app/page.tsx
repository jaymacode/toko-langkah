import { HomeView } from "@/components/home-view";
import { getConfig } from "@/lib/config";

export default function HomePage() {
  const { mode } = getConfig();
  return <HomeView mode={mode} />;
}
