-- 0011_staff_replies.sql: staff reply in an escalated conversation.
-- Earlier migrations 0001-0010 are unchanged. Works on local Docker (db/local shim) and Supabase.
--
-- A conversation is "with staff" while it has a ticket whose status is not 'resolved'. In that state
-- the API stops running the assistant for the customer's messages, and store staff answer in the
-- same transcript as role 'staff'. When every ticket of the conversation is resolved the assistant
-- answers again.
--
-- Rules enforced here (the API checks them too, so a missing check in one layer cannot widen access):
--   * only staff of the conversation's store may insert role='staff' rows, as themselves
--     (author_id = auth.uid()), and only while the conversation has an unresolved ticket;
--   * customers still insert only role='user' rows (0002 policy is unchanged);
--   * a staff reply is idempotent per (conversation, client_message_id);
--   * the reply is audited as action 'ticket.reply' on the ticket, with the staff actor.

-- 1. Who wrote a staff message. NULL for customer and assistant rows. Not readable by API roles:
--    customers see that staff answered, not which staff account.
ALTER TABLE messages ADD COLUMN author_id uuid;
ALTER TABLE messages ADD CONSTRAINT messages_staff_author
    CHECK ((role = 'staff') = (author_id IS NOT NULL));
GRANT INSERT (author_id) ON messages TO authenticated;

CREATE UNIQUE INDEX messages_staff_client_message_uniq
    ON messages (conversation_id, client_message_id)
    WHERE role = 'staff' AND client_message_id IS NOT NULL;

-- 2. Staff insert policy. Permissive policies are OR-ed: a customer row still has to satisfy
--    messages_owner_insert (role = 'user'); a staff row has to satisfy this one.
CREATE POLICY messages_staff_insert ON messages FOR INSERT TO authenticated
    WITH CHECK (
        role = 'staff'
        AND author_id = (select auth.uid())
        AND EXISTS (
            SELECT 1
              FROM tickets AS t
              JOIN store_members AS sm ON sm.store_id = t.store_id
             WHERE t.conversation_id = messages.conversation_id
               AND t.status <> 'resolved'
               AND sm.user_id = (select auth.uid())
        )
    );

-- 3. Audit for a reply: same shape as the status policy in 0005, one fixed action string.
CREATE POLICY audit_events_staff_reply_insert ON audit_events FOR INSERT TO authenticated
    WITH CHECK (
        actor_id = (select auth.uid())
        AND action = 'ticket.reply'
        AND EXISTS (
            SELECT 1 FROM store_members sm
            WHERE sm.store_id = audit_events.store_id AND sm.user_id = (select auth.uid())
        )
        AND EXISTS (
            SELECT 1 FROM tickets t
            WHERE t.id::text = audit_events.resource_id AND t.store_id = audit_events.store_id
        )
    );

-- 4. "Is this conversation with staff?" is asked on every customer turn.
CREATE INDEX tickets_conversation_status_idx ON tickets (conversation_id, status);
