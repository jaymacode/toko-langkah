-- 0007_api_role.sql: dedicated API login role that owns no tables, plus three SECURITY DEFINER
-- functions for the assistant-turn SQL that the API previously ran as the table owner.
-- Earlier migrations 0001-0006 are unchanged.
--
-- Works on local Docker (db/local shim) and Supabase: only public, tokolangkah_private and roles
-- anon/authenticated are referenced. Contract: docs/THREAT_MODEL.md item 1, docs/DEPLOYMENT.md "Database role".
--
-- The role is created NOLOGIN without a password. The operator sets LOGIN and the password outside
-- migrations (local: scripts/tasks.py db-migrate; Supabase: a secret-manager step). No secret lives here.
-- NOINHERIT: the role has no table privileges of its own. It reaches anon/authenticated only through
-- SET LOCAL ROLE, which keeps RLS in force for every user-scoped query.

-- 1. The API login role. An existing role is left alone (its LOGIN setting belongs to the operator).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tokolangkah_api') THEN
        CREATE ROLE tokolangkah_api NOLOGIN NOINHERIT;
    END IF;
END
$$;

-- 2. Role switching (SET LOCAL ROLE) needs membership; schema usage is needed to resolve names.
GRANT anon, authenticated TO tokolangkah_api;
GRANT USAGE ON SCHEMA public, extensions TO tokolangkah_api;
GRANT USAGE ON SCHEMA tokolangkah_private TO tokolangkah_api;

-- 3. Rate limit: prune old windows and count this turn in the current fixed window (one statement
--    each for the caller). Same semantics as the former owner-path SQL in conversations/turns.py.
CREATE OR REPLACE FUNCTION tokolangkah_private.consume_chat_turn(
    p_user uuid,
    p_window_seconds integer,
    p_prune_seconds integer
)
RETURNS TABLE (turns integer, remaining_seconds double precision)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
    IF p_user IS NULL OR p_window_seconds IS NULL OR p_prune_seconds IS NULL THEN
        RAISE EXCEPTION 'consume_chat_turn: null input' USING ERRCODE = '22004';
    END IF;
    IF p_window_seconds NOT BETWEEN 1 AND 86400 THEN
        RAISE EXCEPTION 'consume_chat_turn: window out of range' USING ERRCODE = '22023';
    END IF;
    IF p_prune_seconds NOT BETWEEN 1 AND 2592000 THEN
        RAISE EXCEPTION 'consume_chat_turn: prune out of range' USING ERRCODE = '22023';
    END IF;

    DELETE FROM tokolangkah_private.chat_rate_limits AS r
     WHERE r.window_start < now() - make_interval(secs => p_prune_seconds);

    RETURN QUERY
    INSERT INTO tokolangkah_private.chat_rate_limits AS r (user_id, window_start, turns)
    VALUES (
        p_user,
        to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds),
        1
    )
    ON CONFLICT (user_id, window_start)
    DO UPDATE SET turns = r.turns + 1
    RETURNING
        r.turns,
        (extract(epoch FROM r.window_start) + p_window_seconds - extract(epoch FROM now()))::double precision;
END
$$;

-- 4. Stored envelope for a retry. Ownership is checked in the same statement: another customer's
--    conversation yields NULL, exactly as the former owner-path query did.
CREATE OR REPLACE FUNCTION tokolangkah_private.stored_assistant_envelope(
    p_conversation uuid,
    p_user uuid,
    p_client_message uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_conversation IS NULL OR p_user IS NULL OR p_client_message IS NULL THEN
        RAISE EXCEPTION 'stored_assistant_envelope: null input' USING ERRCODE = '22004';
    END IF;
    RETURN (
        SELECT m.payload
          FROM public.messages AS m
          JOIN public.conversations AS c ON c.id = m.conversation_id
         WHERE c.id = p_conversation
           AND c.customer_id = p_user
           AND m.client_message_id = p_client_message
           AND m.role = 'assistant'
    );
END
$$;

-- 5. Store the assistant reply. The insert happens only when the caller owns the conversation.
--    Returns the stored envelope, or NULL when nothing was inserted (conflict or not owned).
CREATE OR REPLACE FUNCTION tokolangkah_private.store_assistant_message(
    p_id uuid,
    p_conversation uuid,
    p_user uuid,
    p_answer text,
    p_client_message uuid,
    p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_payload jsonb;
BEGIN
    IF p_id IS NULL OR p_conversation IS NULL OR p_user IS NULL
       OR p_answer IS NULL OR p_client_message IS NULL OR p_payload IS NULL THEN
        RAISE EXCEPTION 'store_assistant_message: null input' USING ERRCODE = '22004';
    END IF;
    IF char_length(p_answer) > 8000 THEN
        RAISE EXCEPTION 'store_assistant_message: answer too long' USING ERRCODE = '22001';
    END IF;
    IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'store_assistant_message: payload must be an object' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.messages (id, conversation_id, role, content, client_message_id, payload)
    SELECT p_id, c.id, 'assistant', p_answer, p_client_message, p_payload
      FROM public.conversations AS c
     WHERE c.id = p_conversation
       AND c.customer_id = p_user
    ON CONFLICT (conversation_id, client_message_id)
    WHERE role = 'assistant' AND client_message_id IS NOT NULL DO NOTHING
    RETURNING payload INTO v_payload;

    RETURN v_payload;
END
$$;

-- 6. Only the API login role may call the functions. PUBLIC, anon and authenticated get nothing.
REVOKE ALL ON FUNCTION tokolangkah_private.consume_chat_turn(uuid, integer, integer)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION tokolangkah_private.stored_assistant_envelope(uuid, uuid, uuid)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION tokolangkah_private.store_assistant_message(uuid, uuid, uuid, text, uuid, jsonb)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION tokolangkah_private.consume_chat_turn(uuid, integer, integer)
    TO tokolangkah_api;
GRANT EXECUTE ON FUNCTION tokolangkah_private.stored_assistant_envelope(uuid, uuid, uuid)
    TO tokolangkah_api;
GRANT EXECUTE ON FUNCTION tokolangkah_private.store_assistant_message(uuid, uuid, uuid, text, uuid, jsonb)
    TO tokolangkah_api;
