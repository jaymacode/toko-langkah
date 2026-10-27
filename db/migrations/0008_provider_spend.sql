-- 0008_provider_spend.sql: USD spend ledger for live model calls (chat turns and live evals).
-- One budget (LIVE_EVAL_BUDGET_USD) covers both sources. Rows are never deleted by the application:
-- the ledger is cumulative spend, and deleting rows would reset the budget.
-- Earlier migrations 0001-0007 are unchanged.

CREATE TABLE tokolangkah_private.provider_spend (
    id bigserial PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    source text NOT NULL CHECK (source IN ('chat', 'eval')),
    model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 100),
    input_tokens integer NOT NULL CHECK (input_tokens >= 0),
    output_tokens integer NOT NULL CHECK (output_tokens >= 0),
    est_cost_usd numeric(12,6) NOT NULL CHECK (est_cost_usd >= 0),
    request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128)
);

-- Only the table owner and the API login role (through the functions below) may touch the ledger.
REVOKE ALL ON tokolangkah_private.provider_spend FROM PUBLIC, anon, authenticated;

-- Record one call's measured usage. Validation is by the table CHECK constraints.
CREATE OR REPLACE FUNCTION tokolangkah_private.record_provider_spend(
    p_source text,
    p_model text,
    p_input_tokens integer,
    p_output_tokens integer,
    p_est_cost_usd numeric,
    p_request_id text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p_source IS NULL OR p_model IS NULL OR p_input_tokens IS NULL OR p_output_tokens IS NULL
       OR p_est_cost_usd IS NULL OR p_request_id IS NULL THEN
        RAISE EXCEPTION 'record_provider_spend: null input' USING ERRCODE = '22004';
    END IF;
    INSERT INTO tokolangkah_private.provider_spend
        (source, model, input_tokens, output_tokens, est_cost_usd, request_id)
    VALUES
        (p_source, p_model, p_input_tokens, p_output_tokens, p_est_cost_usd, p_request_id)
    RETURNING id INTO v_id;
    RETURN v_id;
END
$$;

-- Total estimated spend across every source, in USD.
CREATE OR REPLACE FUNCTION tokolangkah_private.provider_spend_total()
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(sum(s.est_cost_usd), 0)::numeric
      FROM tokolangkah_private.provider_spend AS s;
$$;

REVOKE ALL ON FUNCTION tokolangkah_private.record_provider_spend(text, text, integer, integer, numeric, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION tokolangkah_private.provider_spend_total()
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION tokolangkah_private.record_provider_spend(text, text, integer, integer, numeric, text)
    TO tokolangkah_api;
GRANT EXECUTE ON FUNCTION tokolangkah_private.provider_spend_total()
    TO tokolangkah_api;
