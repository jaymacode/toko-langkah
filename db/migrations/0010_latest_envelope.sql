-- 0010_latest_envelope.sql: the newest assistant envelope of one conversation, for restore on reload.
-- Earlier migrations 0001-0009 are unchanged.
--
-- The API reads this only through tokolangkah_private.latest_assistant_envelope, which runs as the
-- table owner (SECURITY DEFINER). messages.payload stays column-revoked from the API roles. The
-- function returns the payload only when the conversation belongs to p_user, otherwise NULL, so the
-- ownership check is in the same statement that reads the envelope.

CREATE OR REPLACE FUNCTION tokolangkah_private.latest_assistant_envelope(
    p_conversation uuid,
    p_user uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_conversation IS NULL OR p_user IS NULL THEN
        RAISE EXCEPTION 'latest_assistant_envelope: null input' USING ERRCODE = '22004';
    END IF;
    RETURN (
        SELECT m.payload
          FROM public.messages AS m
          JOIN public.conversations AS c ON c.id = m.conversation_id
         WHERE c.id = p_conversation
           AND c.customer_id = p_user
           AND m.role = 'assistant'
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT 1
    );
END
$$;

REVOKE ALL ON FUNCTION tokolangkah_private.latest_assistant_envelope(uuid, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION tokolangkah_private.latest_assistant_envelope(uuid, uuid)
    TO tokolangkah_api;
