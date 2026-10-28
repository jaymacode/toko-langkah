-- 0013_staff_stock.sql: store staff manage stock per size variant.
-- Earlier migrations 0001-0012 are unchanged. Works on local Docker (db/local shim) and Supabase.
--
-- Rules enforced here (the API checks them too):
--   * only staff of the product's store may change a variant, and only its stock column;
--   * stock stays a non-negative integer (0001 CHECK) and below a sanity ceiling;
--   * every change is audited as 'variant.stock:<old>-><new>' on that variant, with the staff actor.
-- Customers and anon keep read-only catalogue access (0002); they never update stock.

ALTER TABLE product_variants
    ADD CONSTRAINT product_variants_stock_ceiling CHECK (stock <= 100000);

GRANT UPDATE (stock) ON product_variants TO authenticated;

CREATE POLICY product_variants_staff_update ON product_variants FOR UPDATE TO authenticated
    USING (EXISTS (
        SELECT 1
          FROM products AS p
          JOIN store_members AS sm ON sm.store_id = p.store_id
         WHERE p.id = product_variants.product_id AND sm.user_id = (select auth.uid())
    ))
    WITH CHECK (EXISTS (
        SELECT 1
          FROM products AS p
          JOIN store_members AS sm ON sm.store_id = p.store_id
         WHERE p.id = product_variants.product_id AND sm.user_id = (select auth.uid())
    ));

CREATE POLICY audit_events_staff_stock_insert ON audit_events FOR INSERT TO authenticated
    WITH CHECK (
        actor_id = (select auth.uid())
        AND action ~ '^variant\.stock:[0-9]{1,6}->[0-9]{1,6}$'
        AND EXISTS (
            SELECT 1 FROM store_members sm
            WHERE sm.store_id = audit_events.store_id AND sm.user_id = (select auth.uid())
        )
        AND EXISTS (
            SELECT 1
              FROM product_variants AS v
              JOIN products AS p ON p.id = v.product_id
             WHERE v.id::text = audit_events.resource_id AND p.store_id = audit_events.store_id
        )
    );
