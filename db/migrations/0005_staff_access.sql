-- 0005_staff_access.sql: round 3 staff access, escalation audit and ticket timestamps.
-- Contract: docs/contracts/M3M4.md section A. Earlier migrations 0001-0004 are unchanged.
--
-- Works on local Docker (db/local shim) and Supabase: only (select auth.uid()) and public tables.
-- Staff identity comes only from store_members (server-owned). Customer metadata never grants staff.

-- 1. Staff read access to the transcripts and customer aliases of the stores they staff.
CREATE POLICY conversations_staff_read ON conversations FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM store_members sm
        WHERE sm.store_id = conversations.store_id AND sm.user_id = (select auth.uid())
    ));

CREATE POLICY messages_staff_read ON messages FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1
        FROM conversations c
        JOIN store_members sm ON sm.store_id = c.store_id
        WHERE c.id = messages.conversation_id AND sm.user_id = (select auth.uid())
    ));

CREATE POLICY customers_staff_read ON customers FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM store_members sm
        WHERE sm.store_id = customers.store_id AND sm.user_id = (select auth.uid())
    ));

-- 2. Audit trail for staff status changes. Staff may insert only:
--    - actor_id equal to their own verified identity,
--    - a store they staff,
--    - a ticket action string of the exact form ticket.status:<old>-><new>,
--    - a resource_id that is a ticket of that same store.
GRANT INSERT (store_id, actor_id, action, resource_id) ON audit_events TO authenticated;

CREATE POLICY audit_events_staff_insert ON audit_events FOR INSERT TO authenticated
    WITH CHECK (
        actor_id = (select auth.uid())
        AND EXISTS (
            SELECT 1 FROM store_members sm
            WHERE sm.store_id = audit_events.store_id AND sm.user_id = (select auth.uid())
        )
        AND action ~ '^ticket\.status:(open|in_progress|resolved)->(open|in_progress|resolved)$'
        AND EXISTS (
            SELECT 1 FROM tickets t
            WHERE t.id::text = audit_events.resource_id AND t.store_id = audit_events.store_id
        )
    );

-- 3. Ticket updated_at is maintained by the database, so the API needs no column grant beyond status.
CREATE OR REPLACE FUNCTION public.tickets_set_updated_at() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tickets_set_updated_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tickets_set_updated_at
    BEFORE UPDATE ON tickets
    FOR EACH ROW EXECUTE FUNCTION public.tickets_set_updated_at();

-- 4. Index for the staff ticket list (store scope, status filter, newest first).
CREATE INDEX tickets_store_status_created_idx ON tickets (store_id, status, created_at DESC);
