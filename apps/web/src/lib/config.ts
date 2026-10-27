export const APP_MODES = ["development", "test", "demo", "production"] as const;

export type AppMode = (typeof APP_MODES)[number];

export type AppConfig = {
  /** Absolute http(s) base URL of the FastAPI service, or null when not configured. */
  apiBaseUrl: string | null;
  mode: AppMode;
};

export type PublicEnv = {
  NEXT_PUBLIC_API_BASE_URL?: string | undefined;
  NEXT_PUBLIC_APP_MODE?: string | undefined;
};

const DEFAULT_MODE: AppMode = "development";

function isAppMode(value: string): value is AppMode {
  return (APP_MODES as readonly string[]).includes(value);
}

/**
 * Parses and validates the public web configuration.
 * Only NEXT_PUBLIC_* values are accepted; secrets must never be read here.
 * Throws a descriptive Error for invalid values so misconfiguration fails loudly.
 */
export function parseConfig(env: PublicEnv): AppConfig {
  const rawMode = (env.NEXT_PUBLIC_APP_MODE ?? "").trim();
  let mode: AppMode = DEFAULT_MODE;
  if (rawMode !== "") {
    if (!isAppMode(rawMode)) {
      throw new Error(
        `Invalid NEXT_PUBLIC_APP_MODE "${rawMode}". Expected one of: ${APP_MODES.join(", ")}.`,
      );
    }
    mode = rawMode;
  }

  const rawApiBaseUrl = (env.NEXT_PUBLIC_API_BASE_URL ?? "").trim();
  let apiBaseUrl: string | null = null;
  if (rawApiBaseUrl !== "") {
    let parsed: URL;
    try {
      parsed = new URL(rawApiBaseUrl);
    } catch {
      throw new Error(
        `Invalid NEXT_PUBLIC_API_BASE_URL "${rawApiBaseUrl}". Expected an absolute http or https URL.`,
      );
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        `Invalid NEXT_PUBLIC_API_BASE_URL protocol "${parsed.protocol}". Expected http or https.`,
      );
    }
    apiBaseUrl = rawApiBaseUrl.replace(/\/+$/, "");
  }

  return { apiBaseUrl, mode };
}

/**
 * Reads the public config from the build-time environment.
 * Next.js only inlines NEXT_PUBLIC_* values when they are read as literal
 * property accesses, so the keys are spelled out here.
 */
export function getConfig(): AppConfig {
  return parseConfig({
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
    NEXT_PUBLIC_APP_MODE: process.env.NEXT_PUBLIC_APP_MODE,
  });
}

export type SupabaseConfig = {
  /** Absolute https project URL, without a trailing slash. */
  url: string;
  /** Browser-safe publishable key (sb_publishable_...). Never a secret or service-role key. */
  publishableKey: string;
};

export type SupabasePublicEnv = {
  NEXT_PUBLIC_SUPABASE_URL?: string | undefined;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string | undefined;
};

const PUBLISHABLE_KEY_PREFIX = "sb_publishable_";
const SECRET_KEY_PREFIX = "sb_secret_";

/** True when the value is a JWT whose payload role is service_role (decoded locally, never verified). */
function isServiceRoleJwt(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  try {
    const base64 = (parts[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
    const payload: unknown = JSON.parse(atob(base64));
    return (
      typeof payload === "object" &&
      payload !== null &&
      (payload as Record<string, unknown>).role === "service_role"
    );
  } catch {
    return false;
  }
}

/**
 * Parses the optional browser Supabase configuration. Both values must be set
 * together, or neither. A secret or service-role key is rejected with a clear
 * error so it can never reach the browser bundle.
 */
export function parseSupabaseConfig(env: SupabasePublicEnv): SupabaseConfig | null {
  const rawUrl = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const rawKey = (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "").trim();

  if (rawUrl === "" && rawKey === "") return null;
  if (rawUrl === "" || rawKey === "") {
    throw new Error(
      "Set both NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, or neither.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid NEXT_PUBLIC_SUPABASE_URL. Expected an absolute https URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Invalid NEXT_PUBLIC_SUPABASE_URL. Expected an absolute https URL.");
  }

  if (rawKey.startsWith(SECRET_KEY_PREFIX) || isServiceRoleJwt(rawKey)) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a secret or service-role key. Only a publishable key (sb_publishable_...) may be used in the browser.",
    );
  }
  if (!rawKey.startsWith(PUBLISHABLE_KEY_PREFIX) || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(rawKey)) {
    throw new Error(
      "Invalid NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Expected a key starting with sb_publishable_.",
    );
  }

  return { url: rawUrl.replace(/\/+$/, ""), publishableKey: rawKey };
}

/** Reads the browser Supabase configuration from the build-time environment (literal keys for inlining). */
export function getSupabaseConfig(): SupabaseConfig | null {
  return parseSupabaseConfig({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}
