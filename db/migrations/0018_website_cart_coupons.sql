-- Mirrors the ERPNext `Website Cart Coupon` doctype on erp.inventre.in.
-- One row per ERP coupon (319+ existing). Local-only fields are limited to
-- usage tracking + soft links into our schools/students tables.

DO $$ BEGIN
  CREATE TYPE website_cart_coupon_discount_type AS ENUM ('Fixed', 'Percentage');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS website_cart_coupons (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  erp_name                 TEXT,
  coupon_code              TEXT NOT NULL,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,

  school_erp_name          TEXT,
  school_id                UUID REFERENCES schools(id) ON DELETE SET NULL,
  student_erp_name         TEXT,
  student_id               UUID REFERENCES students(id) ON DELETE SET NULL,

  start_datetime           TIMESTAMPTZ,
  end_datetime             TIMESTAMPTZ,

  one_time_use             BOOLEAN NOT NULL DEFAULT TRUE,
  can_use_multiple_times   BOOLEAN NOT NULL DEFAULT FALSE,

  discount_type            website_cart_coupon_discount_type NOT NULL,
  discount                 NUMERIC(12, 2) NOT NULL,
  maximum_discount_amount  INTEGER NOT NULL DEFAULT 0,

  erp_creation             TIMESTAMPTZ,
  erp_modified             TIMESTAMPTZ,
  erp_owner                TEXT,
  erp_modified_by          TEXT,

  used_count               INTEGER NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS website_cart_coupons_erp_name_idx
  ON website_cart_coupons (erp_name) WHERE erp_name IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS website_cart_coupons_code_idx
  ON website_cart_coupons (LOWER(coupon_code));

CREATE INDEX IF NOT EXISTS website_cart_coupons_school_idx
  ON website_cart_coupons (school_id) WHERE school_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS website_cart_coupons_student_idx
  ON website_cart_coupons (student_id) WHERE student_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS website_cart_coupon_usages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id   UUID NOT NULL REFERENCES website_cart_coupons(id) ON DELETE CASCADE,
  parent_id   UUID REFERENCES parents(id) ON DELETE SET NULL,
  order_id    UUID REFERENCES orders(id) ON DELETE SET NULL,
  amount_saved INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS website_cart_coupon_usages_coupon_idx
  ON website_cart_coupon_usages (coupon_id);
CREATE INDEX IF NOT EXISTS website_cart_coupon_usages_parent_idx
  ON website_cart_coupon_usages (parent_id);
