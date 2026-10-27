-- 0003: stop future objects in public from being auto-granted to API roles.
-- Supabase grants anon/authenticated ALL on new public tables, sequences and functions by default.
-- Every table here must opt in with explicit GRANTs and RLS policies instead (see 0002).
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
