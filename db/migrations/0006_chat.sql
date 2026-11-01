-- 0006_chat.sql: round 4 assistant turns (idempotent messages, envelope payload, shared rate limit).
-- Earlier migrations 0001-0005 are unchanged.
--
-- Customers insert only role='user' rows (0002 policy). Assistant rows are written by the API through
-- the table-owner connection after it has verified conversation ownership in the same statement, so
-- no role can insert a spoofed assistant or staff message. The envelope in `payload` is never granted to
-- the API roles: they read only the transcript columns.

ALTER TABLE messages
    ADD COLUMN client_message_id uuid,
    ADD COLUMN payload jsonb,
    ADD CONSTRAINT messages_content_length CHECK (char_length(content) <= 4000);

-- One user message and one assistant reply per (conversation, client_message_id).
CREATE UNIQUE INDEX messages_user_client_message_uniq
    ON messages (conversation_id, client_message_id)
    WHERE role = 'user' AND client_message_id IS NOT NULL;
CREATE UNIQUE INDEX messages_assistant_client_message_uniq
    ON messages (conversation_id, client_message_id)
    WHERE role = 'assistant' AND client_message_id IS NOT NULL;

-- Column-level privileges: the envelope payload is hidden from the API roles.
REVOKE SELECT ON messages FROM authenticated;
GRANT SELECT (id, conversation_id, role, content, created_at, client_message_id) ON messages TO authenticated;
GRANT INSERT (client_message_id) ON messages TO authenticated;

-- Shared fixed-window rate limit (per user), readable and writable only by the API's owner connection.
-- The schema tokolangkah_private is never exposed to anon or authenticated.
CREATE SCHEMA IF NOT EXISTS tokolangkah_private;
CREATE TABLE tokolangkah_private.chat_rate_limits (
    user_id uuid NOT NULL,
    window_start timestamptz NOT NULL,
    turns integer NOT NULL CHECK (turns >= 0),
    PRIMARY KEY (user_id, window_start)
);
CREATE INDEX chat_rate_limits_window_start_idx ON tokolangkah_private.chat_rate_limits (window_start);
REVOKE ALL ON tokolangkah_private.chat_rate_limits FROM PUBLIC, anon, authenticated;
