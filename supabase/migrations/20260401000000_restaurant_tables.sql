-- =============================================================================
-- NEXUS-POS: TABLAS DE RESTAURANTE (10 tablas con RLS completo)
-- =============================================================================
-- Este archivo crea todas las tablas necesarias para el módulo de restaurante:
--   1.  restaurant_zones        — Zonas/áreas del restaurante (terraza, salón, etc.)
--   2.  restaurant_tables       — Mesas físicas con posición y estado
--   3.  table_sessions          — Sesiones activas por mesa (quién está sentado)
--   4.  kitchen_stations        — Estaciones de cocina (barra, plancha, etc.)
--   5.  product_stations        — Asignación producto → estación de cocina
--   6.  restaurant_orders       — Pedidos (comanda) por sesión de mesa
--   7.  order_items             — Líneas de cada pedido con estado de cocina
--   8.  modifier_groups         — Grupos de modificadores (tamaño, cocción, etc.)
--   9.  modifiers               — Opciones dentro de cada grupo
--   10. product_modifier_groups — Asignación producto → grupo de modificadores
--
-- Cada tabla tiene RLS habilitado con 4 políticas estándar:
--   SELECT: business_id = get_user_business_id() OR is_super_admin()
--   INSERT: WITH CHECK business_id = get_user_business_id()
--   UPDATE: business_id = get_user_business_id() OR is_super_admin()
--   DELETE: business_id = get_user_business_id() OR is_super_admin()
--
-- Requiere: funciones get_user_business_id() e is_super_admin() de
--           20260323000000_security_hardening.sql
-- =============================================================================


-- =============================================================================
-- 1. RESTAURANT_ZONES
-- =============================================================================

CREATE TABLE restaurant_zones (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  sort_order  INT         DEFAULT 0,
  active      BOOLEAN     DEFAULT TRUE,
  sync_status TEXT        DEFAULT 'synced',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE restaurant_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "restaurant_zones_select" ON restaurant_zones
  FOR SELECT USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "restaurant_zones_insert" ON restaurant_zones
  FOR INSERT WITH CHECK (business_id = get_user_business_id());

CREATE POLICY "restaurant_zones_update" ON restaurant_zones
  FOR UPDATE USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "restaurant_zones_delete" ON restaurant_zones
  FOR DELETE USING (business_id = get_user_business_id() OR is_super_admin());


-- =============================================================================
-- 2. RESTAURANT_TABLES
-- =============================================================================

CREATE TABLE restaurant_tables (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  zone_id     UUID        REFERENCES restaurant_zones(id) ON DELETE SET NULL,
  name        TEXT        NOT NULL,
  capacity    INT         DEFAULT 4,
  status      TEXT        DEFAULT 'libre' CHECK (status IN ('libre', 'ocupada', 'reservada', 'sucia')),
  pos_x       REAL,
  pos_y       REAL,
  active      BOOLEAN     DEFAULT TRUE,
  sort_order  INT         DEFAULT 0,
  sync_status TEXT        DEFAULT 'synced',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_restaurant_tables_business_status
  ON restaurant_tables (business_id, status);

ALTER TABLE restaurant_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "restaurant_tables_select" ON restaurant_tables
  FOR SELECT USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "restaurant_tables_insert" ON restaurant_tables
  FOR INSERT WITH CHECK (business_id = get_user_business_id());

CREATE POLICY "restaurant_tables_update" ON restaurant_tables
  FOR UPDATE USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "restaurant_tables_delete" ON restaurant_tables
  FOR DELETE USING (business_id = get_user_business_id() OR is_super_admin());


-- =============================================================================
-- 3. TABLE_SESSIONS
-- =============================================================================

CREATE TABLE table_sessions (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id    UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  table_id       UUID        NOT NULL REFERENCES restaurant_tables(id) ON DELETE CASCADE,
  staff_id       TEXT,
  staff_name     TEXT,
  guest_count    INT         DEFAULT 1,
  status         TEXT        DEFAULT 'open' CHECK (status IN ('open', 'requesting_bill', 'closed')),
  opened_at      TIMESTAMPTZ DEFAULT NOW(),
  closed_at      TIMESTAMPTZ,
  sale_id        UUID        REFERENCES sales(id) ON DELETE SET NULL,
  split_sale_ids UUID[],
  notes          TEXT,
  sync_status    TEXT        DEFAULT 'synced',
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_table_sessions_business_status
  ON table_sessions (business_id, status);

ALTER TABLE table_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "table_sessions_select" ON table_sessions
  FOR SELECT USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "table_sessions_insert" ON table_sessions
  FOR INSERT WITH CHECK (business_id = get_user_business_id());

CREATE POLICY "table_sessions_update" ON table_sessions
  FOR UPDATE USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "table_sessions_delete" ON table_sessions
  FOR DELETE USING (business_id = get_user_business_id() OR is_super_admin());


-- =============================================================================
-- 4. KITCHEN_STATIONS
-- =============================================================================

CREATE TABLE kitchen_stations (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id   UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  print_enabled BOOLEAN     DEFAULT FALSE,
  sort_order    INT         DEFAULT 0,
  active        BOOLEAN     DEFAULT TRUE,
  sync_status   TEXT        DEFAULT 'synced',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE kitchen_stations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kitchen_stations_select" ON kitchen_stations
  FOR SELECT USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "kitchen_stations_insert" ON kitchen_stations
  FOR INSERT WITH CHECK (business_id = get_user_business_id());

CREATE POLICY "kitchen_stations_update" ON kitchen_stations
  FOR UPDATE USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "kitchen_stations_delete" ON kitchen_stations
  FOR DELETE USING (business_id = get_user_business_id() OR is_super_admin());


-- =============================================================================
-- 5. PRODUCT_STATIONS (asignación producto → estación de cocina)
-- =============================================================================

CREATE TABLE product_stations (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id  UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  station_id  UUID        NOT NULL REFERENCES kitchen_stations(id) ON DELETE CASCADE,
  sync_status TEXT        DEFAULT 'synced',
  UNIQUE(product_id, station_id)
);

ALTER TABLE product_stations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_stations_select" ON product_stations
  FOR SELECT USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "product_stations_insert" ON product_stations
  FOR INSERT WITH CHECK (business_id = get_user_business_id());

CREATE POLICY "product_stations_update" ON product_stations
  FOR UPDATE USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "product_stations_delete" ON product_stations
  FOR DELETE USING (business_id = get_user_business_id() OR is_super_admin());


-- =============================================================================
-- 6. RESTAURANT_ORDERS (comandas)
-- =============================================================================

CREATE TABLE restaurant_orders (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id   UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  session_id    UUID        REFERENCES table_sessions(id) ON DELETE SET NULL,
  order_type    TEXT        DEFAULT 'dine_in' CHECK (order_type IN ('dine_in', 'takeaway', 'delivery')),
  order_number  INT,
  round_number  INT         DEFAULT 1,
  status        TEXT        DEFAULT 'draft' CHECK (status IN ('draft', 'sent_to_kitchen', 'preparing', 'ready', 'served', 'completed', 'cancelled')),
  staff_id      TEXT,
  staff_name    TEXT,
  customer_id   UUID,
  customer_name TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  sent_at       TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  sync_status   TEXT        DEFAULT 'synced'
);

CREATE INDEX idx_restaurant_orders_business_status
  ON restaurant_orders (business_id, status);

ALTER TABLE restaurant_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "restaurant_orders_select" ON restaurant_orders
  FOR SELECT USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "restaurant_orders_insert" ON restaurant_orders
  FOR INSERT WITH CHECK (business_id = get_user_business_id());

CREATE POLICY "restaurant_orders_update" ON restaurant_orders
  FOR UPDATE USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "restaurant_orders_delete" ON restaurant_orders
  FOR DELETE USING (business_id = get_user_business_id() OR is_super_admin());


-- =============================================================================
-- 7. ORDER_ITEMS (líneas de pedido con estado de cocina)
-- =============================================================================

CREATE TABLE order_items (
  id             UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id    UUID          NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_id       UUID          NOT NULL REFERENCES restaurant_orders(id) ON DELETE CASCADE,
  product_id     UUID          REFERENCES products(id) ON DELETE SET NULL,
  product_name   TEXT          NOT NULL,
  quantity       NUMERIC(10,3) DEFAULT 1,
  unit_price     NUMERIC(12,2),
  cost           NUMERIC(12,2),
  unit           TEXT,
  modifiers      JSONB         DEFAULT '[]',
  kitchen_status TEXT          DEFAULT 'pending' CHECK (kitchen_status IN ('pending', 'preparing', 'ready', 'served')),
  station_id     UUID          REFERENCES kitchen_stations(id) ON DELETE SET NULL,
  notes          TEXT,
  sent_at        TIMESTAMPTZ,
  ready_at       TIMESTAMPTZ,
  served_at      TIMESTAMPTZ,
  voided         BOOLEAN       DEFAULT FALSE,
  void_reason    TEXT,
  sync_status    TEXT          DEFAULT 'synced',
  created_at     TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX idx_order_items_station_status
  ON order_items (station_id, kitchen_status);

CREATE INDEX idx_order_items_order_id
  ON order_items (order_id);

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_items_select" ON order_items
  FOR SELECT USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "order_items_insert" ON order_items
  FOR INSERT WITH CHECK (business_id = get_user_business_id());

CREATE POLICY "order_items_update" ON order_items
  FOR UPDATE USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "order_items_delete" ON order_items
  FOR DELETE USING (business_id = get_user_business_id() OR is_super_admin());


-- =============================================================================
-- 8. MODIFIER_GROUPS
-- =============================================================================

CREATE TABLE modifier_groups (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id    UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL,
  selection_type TEXT        DEFAULT 'single' CHECK (selection_type IN ('single', 'multi')),
  required       BOOLEAN     DEFAULT FALSE,
  min_selections INT,
  max_selections INT,
  sort_order     INT         DEFAULT 0,
  active         BOOLEAN     DEFAULT TRUE,
  sync_status    TEXT        DEFAULT 'synced',
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE modifier_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "modifier_groups_select" ON modifier_groups
  FOR SELECT USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "modifier_groups_insert" ON modifier_groups
  FOR INSERT WITH CHECK (business_id = get_user_business_id());

CREATE POLICY "modifier_groups_update" ON modifier_groups
  FOR UPDATE USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "modifier_groups_delete" ON modifier_groups
  FOR DELETE USING (business_id = get_user_business_id() OR is_super_admin());


-- =============================================================================
-- 9. MODIFIERS (opciones dentro de cada grupo)
-- =============================================================================

CREATE TABLE modifiers (
  id               UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id      UUID          NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  group_id         UUID          NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  name             TEXT          NOT NULL,
  price_adjustment NUMERIC(12,2) DEFAULT 0,
  sort_order       INT           DEFAULT 0,
  active           BOOLEAN       DEFAULT TRUE,
  sync_status      TEXT          DEFAULT 'synced',
  created_at       TIMESTAMPTZ   DEFAULT NOW()
);

ALTER TABLE modifiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "modifiers_select" ON modifiers
  FOR SELECT USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "modifiers_insert" ON modifiers
  FOR INSERT WITH CHECK (business_id = get_user_business_id());

CREATE POLICY "modifiers_update" ON modifiers
  FOR UPDATE USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "modifiers_delete" ON modifiers
  FOR DELETE USING (business_id = get_user_business_id() OR is_super_admin());


-- =============================================================================
-- 10. PRODUCT_MODIFIER_GROUPS (asignación producto → grupo de modificadores)
-- =============================================================================

CREATE TABLE product_modifier_groups (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id        UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  modifier_group_id UUID NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  sort_order        INT  DEFAULT 0,
  sync_status       TEXT DEFAULT 'synced',
  UNIQUE(product_id, modifier_group_id)
);

ALTER TABLE product_modifier_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_modifier_groups_select" ON product_modifier_groups
  FOR SELECT USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "product_modifier_groups_insert" ON product_modifier_groups
  FOR INSERT WITH CHECK (business_id = get_user_business_id());

CREATE POLICY "product_modifier_groups_update" ON product_modifier_groups
  FOR UPDATE USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "product_modifier_groups_delete" ON product_modifier_groups
  FOR DELETE USING (business_id = get_user_business_id() OR is_super_admin());


-- =============================================================================
-- FIN DE LA MIGRACIÓN
-- Para aplicar: copia este archivo y pégalo en Supabase > SQL Editor > Run
-- =============================================================================
