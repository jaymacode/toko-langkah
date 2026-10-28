-- 0012_customer_registration.sql: a newly registered account becomes a customer of the demo store.
-- Earlier migrations 0001-0011 are unchanged. Works on local Docker (db/local shim) and Supabase.
--
-- Supabase Auth creates the account (sign-up from the browser). The account has no customers row
-- yet, so it could not chat or see orders. The API calls this function once after sign-up or sign-in
-- with the VERIFIED token subject; nothing in the request chooses the user, the store or the alias.
--
-- Rules:
--   * the user must exist in auth.users (a token for an unknown subject creates nothing);
--   * staff accounts (any store_members row) are never turned into customers;
--   * one customers row per (store, user); repeating the call returns the same row;
--   * the alias is generated from the user id, never taken from input.
-- Only the API login role may execute it (same pattern as 0007).

CREATE OR REPLACE FUNCTION tokolangkah_private.register_customer(
    p_user uuid,
    p_store_external_id text
)
RETURNS TABLE (store_external_id text, alias text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_store uuid;
BEGIN
    IF p_user IS NULL OR p_store_external_id IS NULL THEN
        RAISE EXCEPTION 'register_customer: null input' USING ERRCODE = '22004';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = p_user) THEN
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.store_members AS m WHERE m.user_id = p_user) THEN
        RETURN;
    END IF;
    SELECT s.id INTO v_store FROM public.stores AS s WHERE s.external_id = p_store_external_id;
    IF v_store IS NULL THEN
        RETURN;
    END IF;

    INSERT INTO public.customers (store_id, user_id, alias)
    VALUES (v_store, p_user, 'pelanggan-' || substr(md5(p_user::text), 1, 10))
    ON CONFLICT (store_id, user_id) DO NOTHING;

    RETURN QUERY
    SELECT p_store_external_id, c.alias
      FROM public.customers AS c
     WHERE c.store_id = v_store AND c.user_id = p_user;
END
$$;

REVOKE ALL ON FUNCTION tokolangkah_private.register_customer(uuid, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION tokolangkah_private.register_customer(uuid, text) TO tokolangkah_api;
