-- 0001_init.sql: initial TokoLangkah schema (M0 scaffold).
--
-- Conventions
--   * Timestamps are timestamptz; the application must store and read them as UTC.
--   * Money is integer IDR (bigint); price_idr and stock are constrained >= 0.
--   * Embeddings are vector(1536) plus embedding_version. Never compare vectors with different versions.
--   * Foreign keys reference the owning store/customer so ownership can be enforced by composite keys.
--
-- NOT IN THIS FILE: Row Level Security policies and the auth-user mapping. Those are M1 work
-- (migrations 0002 onward). RLS is enabled with no policies at the
-- end of this file, so non-owner roles (including Supabase anon/authenticated) see no rows until then.
-- store_members.user_id is intentionally not a foreign key here because Supabase auth.users does not
-- exist in the local development database.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE stores (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Server-owned staff membership. Customer metadata must never grant a row here.
CREATE TABLE store_members (
    store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    user_id uuid NOT NULL,
    role text NOT NULL CHECK (role IN ('owner', 'staff')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_id, user_id)
);

CREATE TABLE products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    slug text NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    description text NOT NULL DEFAULT '',
    color text,
    price_idr bigint NOT NULL CHECK (price_idr >= 0),
    tags text[] NOT NULL DEFAULT '{}',
    image_path text,
    embedding vector(1536),
    embedding_version text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (store_id, slug),
    CHECK (embedding IS NULL OR embedding_version IS NOT NULL)
);
CREATE INDEX products_store_category_price_idx ON products (store_id, category, price_idr);

CREATE TABLE product_variants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    sku text NOT NULL UNIQUE,
    size_eu text NOT NULL,
    stock integer NOT NULL CHECK (stock >= 0),
    UNIQUE (product_id, size_eu)
);

CREATE TABLE orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    customer_id uuid NOT NULL,
    status text NOT NULL,
    tracking_code text,
    eta_text text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_store_customer_idx ON orders (store_id, customer_id);

CREATE TABLE order_items (
    order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    variant_id uuid NOT NULL REFERENCES product_variants(id),
    quantity integer NOT NULL CHECK (quantity > 0),
    unit_price_idr bigint NOT NULL CHECK (unit_price_idr >= 0),
    PRIMARY KEY (order_id, variant_id)
);

CREATE TABLE policies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    title text NOT NULL,
    version text NOT NULL,
    effective_at timestamptz NOT NULL,
    active boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (store_id, title, version)
);
-- At most one active version per policy title; conflicting active policies fail at the database.
CREATE UNIQUE INDEX policies_one_active_per_title_idx ON policies (store_id, title) WHERE active;

CREATE TABLE policy_chunks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id uuid NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
    chunk_index integer NOT NULL CHECK (chunk_index >= 0),
    section text NOT NULL,
    text text NOT NULL,
    embedding vector(1536),
    embedding_version text,
    UNIQUE (policy_id, chunk_index),
    CHECK (embedding IS NULL OR embedding_version IS NOT NULL)
);

CREATE TABLE conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    customer_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Target for the composite foreign key from tickets (conversation owner must match).
    UNIQUE (id, store_id, customer_id)
);

CREATE TABLE messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('user', 'assistant', 'staff')),
    content text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_created_idx ON messages (conversation_id, created_at);

CREATE TABLE tickets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    customer_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
    summary text NOT NULL,
    reason text NOT NULL,
    idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tickets_conversation_owner_fk
        FOREIGN KEY (conversation_id, store_id, customer_id)
        REFERENCES conversations (id, store_id, customer_id),
    CONSTRAINT tickets_idempotency_uniq
        UNIQUE (store_id, customer_id, conversation_id, idempotency_key)
);
-- Status changes are staff-only; enforcement belongs to the API and RLS (M1/M4), not this DDL.

CREATE TABLE audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id uuid REFERENCES stores(id),
    actor_id uuid,
    action text NOT NULL,
    resource_id text,
    "timestamp" timestamptz NOT NULL DEFAULT now()
);

-- Deny by default: on Supabase, public tables are exposed through the Data API, so RLS is enabled
-- with no policies until M1 adds explicit, tested ones. Table owners (migrations/seed) still bypass it.
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
