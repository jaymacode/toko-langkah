-- 0002_m1_auth_catalogue.sql: M1 schema additions, RLS policies and minimal grants.
--
-- Assumes the Supabase roles (anon, authenticated) and auth.uid() exist: locally they come from
-- db/local/00_supabase_shim.sql, on Supabase from the platform. This file creates no roles and no auth objects.
-- The ADD COLUMN ... NOT NULL statements assume the tables are empty (true for a fresh dev database).
-- Policies use (select auth.uid()) so it is evaluated once per statement.

-- 1. Stable fixture keys
ALTER TABLE stores ADD COLUMN external_id text NOT NULL UNIQUE;
ALTER TABLE products ADD COLUMN external_id text NOT NULL UNIQUE;
ALTER TABLE products ADD COLUMN image_alt text NOT NULL DEFAULT '';
ALTER TABLE policies ADD COLUMN external_id text NOT NULL UNIQUE;
ALTER TABLE policy_chunks ADD COLUMN external_id text NOT NULL UNIQUE;

-- 2. Sizes are EU integers in a bounded range
ALTER TABLE product_variants ALTER COLUMN size_eu TYPE integer USING size_eu::integer;
ALTER TABLE product_variants
    ADD CONSTRAINT product_variants_size_eu_range CHECK (size_eu BETWEEN 30 AND 50);

-- 3. Customer-facing order number (users never see orders.id)
ALTER TABLE orders ADD COLUMN order_number text NOT NULL;
ALTER TABLE orders ADD CONSTRAINT orders_store_order_number_uniq UNIQUE (store_id, order_number);

-- 4. Customer aliases per store; user_id is the auth user UUID (no FK: auth.users is platform-owned)
CREATE TABLE customers (
    store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    user_id uuid NOT NULL,
    alias text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_id, user_id),
    UNIQUE (store_id, alias)
);

-- 5. Indexes on columns that RLS policies filter on
CREATE INDEX orders_customer_id_idx ON orders (customer_id);
CREATE INDEX conversations_customer_id_idx ON conversations (customer_id);
CREATE INDEX tickets_customer_id_idx ON tickets (customer_id);
CREATE INDEX store_members_user_id_idx ON store_members (user_id);
CREATE INDEX customers_user_id_idx ON customers (user_id);
CREATE INDEX audit_events_store_id_idx ON audit_events (store_id);

-- 6. Row Level Security. Tables created in 0001 already have RLS enabled; customers is new.
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- 7. Deny by default: remove every table privilege from PUBLIC, anon and authenticated, then grant back
-- exactly what the policies below need.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Public catalogue (anon and signed-in users)
GRANT SELECT ON stores, products, product_variants, policies, policy_chunks TO anon, authenticated;

-- Signed-in users; each row is filtered by the policies in section 8
GRANT SELECT ON orders, order_items, conversations, messages, tickets, store_members, customers, audit_events
    TO authenticated;
GRANT INSERT (store_id, customer_id) ON conversations TO authenticated;
-- role is granted, but the messages_owner_insert policy only allows role = 'user' (no spoofed assistant/staff rows)
GRANT INSERT (conversation_id, role, content) ON messages TO authenticated;
-- status is not granted on INSERT: a new ticket is always 'open' (column default)
GRANT INSERT (store_id, customer_id, conversation_id, summary, reason, idempotency_key)
    ON tickets TO authenticated;
-- The only write grant on an operational table: status changes, restricted to store staff by policy
GRANT UPDATE (status) ON tickets TO authenticated;

-- 8. Policies. A command with no policy has no access (RLS default deny).
-- Public catalogue
CREATE POLICY stores_public_read ON stores FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY products_public_read ON products FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY product_variants_public_read ON product_variants FOR SELECT TO anon, authenticated USING (true);

-- Policy versions: only active, effective versions are visible
CREATE POLICY policies_active_read ON policies FOR SELECT TO anon, authenticated
    USING (active AND effective_at <= now());
CREATE POLICY policy_chunks_active_read ON policy_chunks FOR SELECT TO anon, authenticated
    USING (EXISTS (
        SELECT 1 FROM policies p
        WHERE p.id = policy_chunks.policy_id AND p.active AND p.effective_at <= now()
    ));

-- Orders: owner reads only; there are no write policies or write grants
CREATE POLICY orders_owner_read ON orders FOR SELECT TO authenticated
    USING (customer_id = (select auth.uid()));
CREATE POLICY order_items_owner_read ON order_items FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM orders o
        WHERE o.id = order_items.order_id AND o.customer_id = (select auth.uid())
    ));

-- Identity rows: own row only
CREATE POLICY customers_self_read ON customers FOR SELECT TO authenticated
    USING (user_id = (select auth.uid()));
CREATE POLICY store_members_self_read ON store_members FOR SELECT TO authenticated
    USING (user_id = (select auth.uid()));

-- Conversations: owner reads; owner creates, and only in a store where the caller is a customer
CREATE POLICY conversations_owner_read ON conversations FOR SELECT TO authenticated
    USING (customer_id = (select auth.uid()));
CREATE POLICY conversations_owner_insert ON conversations FOR INSERT TO authenticated
    WITH CHECK (
        customer_id = (select auth.uid())
        AND EXISTS (
            SELECT 1 FROM customers c
            WHERE c.store_id = conversations.store_id AND c.user_id = (select auth.uid())
        )
    );

-- Messages: visible and insertable only through an owned conversation; customers insert user messages only
CREATE POLICY messages_owner_read ON messages FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM conversations c
        WHERE c.id = messages.conversation_id AND c.customer_id = (select auth.uid())
    ));
CREATE POLICY messages_owner_insert ON messages FOR INSERT TO authenticated
    WITH CHECK (
        role = 'user'
        AND EXISTS (
            SELECT 1 FROM conversations c
            WHERE c.id = messages.conversation_id AND c.customer_id = (select auth.uid())
        )
    );

-- Tickets: owner or store staff reads; owner inserts (open, own conversation); staff updates
CREATE POLICY tickets_read ON tickets FOR SELECT TO authenticated
    USING (
        customer_id = (select auth.uid())
        OR EXISTS (
            SELECT 1 FROM store_members sm
            WHERE sm.store_id = tickets.store_id AND sm.user_id = (select auth.uid())
        )
    );
CREATE POLICY tickets_owner_insert ON tickets FOR INSERT TO authenticated
    WITH CHECK (
        customer_id = (select auth.uid())
        AND status = 'open'
        AND EXISTS (
            SELECT 1 FROM conversations c
            WHERE c.id = tickets.conversation_id
              AND c.store_id = tickets.store_id
              AND c.customer_id = (select auth.uid())
        )
    );
CREATE POLICY tickets_staff_update ON tickets FOR UPDATE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM store_members sm
        WHERE sm.store_id = tickets.store_id AND sm.user_id = (select auth.uid())
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM store_members sm
        WHERE sm.store_id = tickets.store_id AND sm.user_id = (select auth.uid())
    ));

-- Audit: store staff read; writes happen only through the server (table owner), so no write policy
CREATE POLICY audit_events_staff_read ON audit_events FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM store_members sm
        WHERE sm.store_id = audit_events.store_id AND sm.user_id = (select auth.uid())
    ));
