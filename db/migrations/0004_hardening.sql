-- 0004: findings from the Supabase security advisor (2026-10-27).
-- 1. Keep the vector extension out of the exposed public schema.
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated;
ALTER EXTENSION vector SET SCHEMA extensions;

-- 2. Pre-existing project helper (not created by this repo): a SECURITY DEFINER function in public is
-- callable through /rest/v1/rpc by anon/authenticated. Event triggers still run it; API roles must not.
DO $$
BEGIN
    IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
        REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
    END IF;
END
$$;
