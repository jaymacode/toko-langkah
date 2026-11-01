-- 0009_embeddings.sql: embedding bookkeeping for hybrid retrieval and the 'ingest' spend source.
-- Earlier migrations 0001-0008 are unchanged.
--
-- 1. The spend ledger also records batched embedding ingestion (admin path, source 'ingest').
--    The application never deletes ledger rows; the constraint is only widened here.
ALTER TABLE tokolangkah_private.provider_spend
    DROP CONSTRAINT provider_spend_source_check;
ALTER TABLE tokolangkah_private.provider_spend
    ADD CONSTRAINT provider_spend_source_check CHECK (source IN ('chat', 'eval', 'ingest'));

-- 2. Hash of the exact text that was embedded. Ingestion re-embeds a row only when its text hash
--    changes (or its embedding_version differs or the embedding is missing).
ALTER TABLE products ADD COLUMN embedding_text_sha256 text
    CHECK (embedding_text_sha256 IS NULL OR char_length(embedding_text_sha256) = 64);
ALTER TABLE policy_chunks ADD COLUMN embedding_text_sha256 text
    CHECK (embedding_text_sha256 IS NULL OR char_length(embedding_text_sha256) = 64);

-- 3. No vector index yet. The catalogue and policy corpus are small, so retrieval uses exact
--    search (embedding <=> query) after the SQL predicates. Add an HNSW index only after recall and
--    filter behaviour are validated at a larger size.
