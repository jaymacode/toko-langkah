import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/config";

/**
 * Browser Supabase client (singleton). It is built only from the publishable
 * key and URL; the config parser rejects secret and service-role keys. Returns
 * null when Supabase is not configured for this build.
 */
let client: SupabaseClient | null = null;

export function getBrowserSupabase(): SupabaseClient | null {
  if (client !== null) return client;
  const config = getSupabaseConfig();
  if (config === null) return null;
  client = createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}

/** The current access token, refreshed by supabase-js when it is close to expiry. Null when signed out. */
export async function currentAccessToken(): Promise<string | null> {
  const supabase = getBrowserSupabase();
  if (supabase === null) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
