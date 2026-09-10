-- Everything `drizzle-kit push` put on the live databases that no migration
-- ever wrote down: one schema, eleven tables and 110 columns.
--
-- WHY THIS FILE EXISTS. Every object in db/schema.ts is meant to be created
-- by a migration in this directory, so the schema can be rebuilt from source.
-- A lot of it never was:
--
--   • eleven tables — companies, grades, guardians, payment_schedules,
--     product_grades, school_coordinators, school_grade_mappings,
--     school_uniform_mappings, student_addresses, student_guardian_links,
--     student_siblings;
--   • 110 columns across thirteen tables that DO have migrations, including
--     twenty on products, twenty-nine on students, fifteen on payments and
--     fourteen on schools;
--   • the `erp` schema itself.
--
-- They were pushed straight at the databases and no migration was written.
--
-- Three consequences, all of which this file ends:
--
--   1. The chain could not build an empty database. It died at 0015 — a data
--      backfill that reads student_guardian_links — after 73 of 116 tables.
--   2. Disaster recovery depended entirely on the nightly dump, because the
--      schema could not be reconstructed from the repository.
--   3. CI could not gate on `npm run build`, because static generation reads
--      the database for 173 pages.
--
-- THE DDL IS NOT HAND-WRITTEN. It is pg_dump's output from a database built
-- by `drizzle-kit push` from db/schema.ts, so it is exactly the shape the
-- application's own queries are typed against — not somebody's reading of
-- what the shape ought to be.
--
-- Every statement is guarded: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF
-- NOT EXISTS, and each constraint behind a pg_constraint check. On the live
-- databases, where all eleven tables already exist, this file is a complete
-- no-op. That is the point: it does not change production, it makes the
-- repository honest about a schema that is already there.
--
-- ORDERING. This file is numbered 0014 — sharing a number with
-- 0014_shop_catalog_data_fixes.sql, which the directory already does in nine
-- other places — because six later migrations READ these tables: 0015, 0020,
-- 0021, 0022, 0023 and 0058. The runner sorts lexicographically, so
-- "0014_missing" lands before "0014_shop" and before all six. Creating the
-- tables at 0076 was tried first and simply moved the failure from 0015 to
-- 0020.
--
-- Added 2026-09-10.

-- ── The erp schema ──────────────────────────────────────────────────────────
-- Same class of problem, one layer down. 0029 and 0032 create erp.sync_state
-- and erp.students with IF NOT EXISTS, but nothing anywhere creates the
-- SCHEMA that holds them, so on an empty database both abort with
-- "schema erp does not exist".
--
-- What this file does NOT do is reconstruct the mirror itself. The erp schema
-- holds eleven tables on a live database — customers, items, sales_orders,
-- sales_order_items, sales_order_sub_items, sales_order_payment_schedule,
-- outward_shipments, outward_status_events, packing_units, plus the two above
-- — and nine of them have no source anywhere in this repository. They are an
-- ERP-owned mirror, created outside migrations, along with two triggers whose
-- functions are likewise absent from source. Copying dev's shape in here
-- would put a guess in the repository and dress it as authority.
--
-- The consequence, stated plainly: a database rebuilt from these migrations
-- has a complete PUBLIC schema and an EMPTY erp schema. That is enough for
-- the application to build and for CI to gate on it, and it is not enough for
-- disaster recovery of ERP-mirrored data — which still depends on the nightly
-- dump. 0048 and 0071 are guarded to skip when the mirror is absent.
CREATE SCHEMA IF NOT EXISTS erp;

-- ── Types ───────────────────────────────────────────────────────────────────
-- products.kind is a product_kind enum, and the type is push-only too. Of the
-- 34 enums db/schema.ts declares, this is the only one no migration creates.
-- CREATE TYPE has no IF NOT EXISTS, hence the catch.

DO $$
BEGIN
  CREATE TYPE public.product_kind AS ENUM (
    'magic_box', 'kit', 'sub_bundle', 'uniform',
    'accessory', 'book', 'consumable', 'excluded'
  );
EXCEPTION WHEN duplicate_object THEN
  NULL;  -- already there, which is the case on every live database
END $$;

-- ── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    abbr text NOT NULL,
    gstin text,
    pan text,
    state_code text,
    address jsonb,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.grades (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    erp_name text,
    grade_name text,
    grade_code text,
    status text,
    raw jsonb,
    erp_modified timestamp with time zone,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.guardians (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    erp_name text,
    guardian_name text,
    email_address text,
    mobile_number text,
    email text,
    alternate_number text,
    date_of_birth text,
    raw jsonb,
    erp_modified timestamp with time zone,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    known_erp_names text[] DEFAULT '{}'::text[] NOT NULL
);

CREATE TABLE IF NOT EXISTS public.payment_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    invoice_id uuid,
    due_date date NOT NULL,
    invoice_portion numeric(5,2) NOT NULL,
    payment_amount integer NOT NULL,
    outstanding_amount integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.product_grades (
    product_id uuid NOT NULL,
    grade text NOT NULL,
    is_organization boolean DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS public.school_coordinators (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    row_idx integer NOT NULL,
    poc_name text,
    email text,
    contact_number text,
    alternate_number text,
    role text,
    raw jsonb
);

CREATE TABLE IF NOT EXISTS public.school_grade_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    row_idx integer NOT NULL,
    grade text,
    school_given_grade_name text,
    sections text,
    raw jsonb
);

CREATE TABLE IF NOT EXISTS public.school_uniform_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    row_idx integer NOT NULL,
    grade text,
    organisation_given_grade text,
    sections text,
    organisation_given_section text,
    house_name text,
    raw jsonb
);

CREATE TABLE IF NOT EXISTS public.student_addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    kind text NOT NULL,
    row_idx integer NOT NULL,
    address_type text,
    address_title text,
    address_line_1 text,
    address_line_2 text,
    city text,
    state text,
    country text,
    pincode text,
    preferred boolean DEFAULT false NOT NULL,
    disabled boolean DEFAULT false NOT NULL,
    raw jsonb
);

CREATE TABLE IF NOT EXISTS public.student_guardian_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    row_idx integer NOT NULL,
    guardian_erp_name text,
    guardian_name text,
    relation text,
    email text,
    phone_no text,
    raw jsonb,
    known_erp_names text[] DEFAULT '{}'::text[] NOT NULL
);

CREATE TABLE IF NOT EXISTS public.student_siblings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    row_idx integer NOT NULL,
    full_name text,
    gender text,
    grade text,
    section text,
    date_of_birth text,
    raw jsonb
);

-- ── Primary keys ────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_pkey') THEN
    ALTER TABLE ONLY public.companies
      ADD CONSTRAINT companies_pkey PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'grades_pkey') THEN
    ALTER TABLE ONLY public.grades
      ADD CONSTRAINT grades_pkey PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guardians_pkey') THEN
    ALTER TABLE ONLY public.guardians
      ADD CONSTRAINT guardians_pkey PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_schedules_pkey') THEN
    ALTER TABLE ONLY public.payment_schedules
      ADD CONSTRAINT payment_schedules_pkey PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_grades_product_id_grade_pk') THEN
    ALTER TABLE ONLY public.product_grades
      ADD CONSTRAINT product_grades_product_id_grade_pk PRIMARY KEY (product_id, grade);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'school_coordinators_pkey') THEN
    ALTER TABLE ONLY public.school_coordinators
      ADD CONSTRAINT school_coordinators_pkey PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'school_grade_mappings_pkey') THEN
    ALTER TABLE ONLY public.school_grade_mappings
      ADD CONSTRAINT school_grade_mappings_pkey PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'school_uniform_mappings_pkey') THEN
    ALTER TABLE ONLY public.school_uniform_mappings
      ADD CONSTRAINT school_uniform_mappings_pkey PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_addresses_pkey') THEN
    ALTER TABLE ONLY public.student_addresses
      ADD CONSTRAINT student_addresses_pkey PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_guardian_links_pkey') THEN
    ALTER TABLE ONLY public.student_guardian_links
      ADD CONSTRAINT student_guardian_links_pkey PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_siblings_pkey') THEN
    ALTER TABLE ONLY public.student_siblings
      ADD CONSTRAINT student_siblings_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- ── Indexes ─────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS companies_abbr_idx ON public.companies USING btree (abbr);
CREATE UNIQUE INDEX IF NOT EXISTS grades_erp_name_idx ON public.grades USING btree (erp_name);
CREATE INDEX IF NOT EXISTS grades_status_idx ON public.grades USING btree (status);
CREATE UNIQUE INDEX IF NOT EXISTS guardians_erp_name_idx ON public.guardians USING btree (erp_name);
CREATE INDEX IF NOT EXISTS guardians_mobile_idx ON public.guardians USING btree (mobile_number);
CREATE INDEX IF NOT EXISTS guardians_name_idx ON public.guardians USING btree (guardian_name);
CREATE INDEX IF NOT EXISTS product_grades_grade_idx ON public.product_grades USING btree (grade);
CREATE INDEX IF NOT EXISTS school_coordinators_school_idx ON public.school_coordinators USING btree (school_id);
CREATE INDEX IF NOT EXISTS school_grade_mappings_school_idx ON public.school_grade_mappings USING btree (school_id);
CREATE INDEX IF NOT EXISTS school_uniform_mappings_school_idx ON public.school_uniform_mappings USING btree (school_id);
CREATE INDEX IF NOT EXISTS student_addresses_student_idx ON public.student_addresses USING btree (student_id);
CREATE INDEX IF NOT EXISTS student_guardian_links_guardian_ref_idx ON public.student_guardian_links USING btree (guardian_erp_name);
CREATE INDEX IF NOT EXISTS student_guardian_links_student_idx ON public.student_guardian_links USING btree (student_id);
CREATE INDEX IF NOT EXISTS student_siblings_student_idx ON public.student_siblings USING btree (student_id);

-- ── Foreign keys ────────────────────────────────────────────────────────────
-- Every parent table here (orders, products, schools, students) is created by
-- 0000, so these resolve on an empty database as well as on a live one.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_schedules_order_id_orders_id_fk') THEN
    ALTER TABLE ONLY public.payment_schedules
      ADD CONSTRAINT payment_schedules_order_id_orders_id_fk
      FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_grades_product_id_products_id_fk') THEN
    ALTER TABLE ONLY public.product_grades
      ADD CONSTRAINT product_grades_product_id_products_id_fk
      FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'school_coordinators_school_id_schools_id_fk') THEN
    ALTER TABLE ONLY public.school_coordinators
      ADD CONSTRAINT school_coordinators_school_id_schools_id_fk
      FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'school_grade_mappings_school_id_schools_id_fk') THEN
    ALTER TABLE ONLY public.school_grade_mappings
      ADD CONSTRAINT school_grade_mappings_school_id_schools_id_fk
      FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'school_uniform_mappings_school_id_schools_id_fk') THEN
    ALTER TABLE ONLY public.school_uniform_mappings
      ADD CONSTRAINT school_uniform_mappings_school_id_schools_id_fk
      FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_addresses_student_id_students_id_fk') THEN
    ALTER TABLE ONLY public.student_addresses
      ADD CONSTRAINT student_addresses_student_id_students_id_fk
      FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_guardian_links_student_id_students_id_fk') THEN
    ALTER TABLE ONLY public.student_guardian_links
      ADD CONSTRAINT student_guardian_links_student_id_students_id_fk
      FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_siblings_student_id_students_id_fk') THEN
    ALTER TABLE ONLY public.student_siblings
      ADD CONSTRAINT student_siblings_student_id_students_id_fk
      FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── Columns ────────────────────────────────────────────────────────────────
-- 110 columns across thirteen tables that db/schema.ts declares and no
-- migration ever added — the same drift as the tables above, and the reason
-- eleven later migrations could not apply to an empty database: 0034 reads
-- schools.school_code, 0035/0038-0042/0049 read products.kind, 0045 reads
-- students.is_verified, 0058 reads students.student_email_id, and 0037's
-- seed INSERTs are written against the full products/students shape.
--
-- Types, defaults and nullability are read from a database built by
-- `drizzle-kit push` from db/schema.ts — not transcribed by hand. Each is
-- IF NOT EXISTS, so on a live database, where all 110 already exist, every
-- line is a no-op.

ALTER TABLE public.bundle_components ADD COLUMN IF NOT EXISTS is_visible boolean DEFAULT true NOT NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS is_debit_note boolean DEFAULT false NOT NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS gst_category text DEFAULT 'Unregistered'::text NOT NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS customer_gstin text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS parent_bundle_product_id uuid;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS gst_inclusive_snapshot boolean;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS grade_snapshot text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS school_name_snapshot text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS warehouse_id uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS is_replacement boolean DEFAULT false NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS replacement_for_order_id uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivered_percent integer DEFAULT 0 NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS billed_percent integer DEFAULT 0 NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS gst_category text DEFAULT 'Unregistered'::text NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS display_status text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_date date;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS gst_category text DEFAULT 'Unregistered'::text NOT NULL;
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS is_frozen boolean DEFAULT false NOT NULL;
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS language text DEFAULT 'en'::text NOT NULL;
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS last_login_at timestamp with time zone;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payment_flow text DEFAULT 'ONLINE'::text NOT NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS gateway_provider text DEFAULT 'CCAVENUE'::text NOT NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS gateway_order_id text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS internal_payment_reference text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payment_mode text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payment_date text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS paid_currency text DEFAULT 'INR'::text NOT NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS paid_amount text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS refund_status text DEFAULT 'NOT_REQUESTED'::text NOT NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS gateway_tracking_id text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS gateway_response_message text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payment_attempt_count integer DEFAULT 0 NOT NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payment_retry_count integer DEFAULT 0 NOT NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS checkout_notification_sent text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS order_submit_error boolean DEFAULT false NOT NULL;
ALTER TABLE public.product_attribute_values ADD COLUMN IF NOT EXISTS erp_id text;
ALTER TABLE public.product_attributes ADD COLUMN IF NOT EXISTS is_disabled boolean DEFAULT false NOT NULL;
ALTER TABLE public.product_attributes ADD COLUMN IF NOT EXISTS is_numeric boolean DEFAULT false NOT NULL;
ALTER TABLE public.product_attributes ADD COLUMN IF NOT EXISTS numeric_from_range numeric(12,3);
ALTER TABLE public.product_attributes ADD COLUMN IF NOT EXISTS numeric_to_range numeric(12,3);
ALTER TABLE public.product_attributes ADD COLUMN IF NOT EXISTS numeric_increment numeric(12,3);
ALTER TABLE public.product_attributes ADD COLUMN IF NOT EXISTS erp_id text;
ALTER TABLE public.product_images ADD COLUMN IF NOT EXISTS erp_source_url text;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS erp_name text;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS variant_of_erp_name text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS gst_inclusive boolean DEFAULT true NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS category_fixed_margin_percent numeric(5,2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS customer_discount_percent numeric(5,2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS organization_margin_percent numeric(5,2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS suggested_org_price integer;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS agreed_org_price integer;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS organization_mrp integer;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_magic_box boolean DEFAULT false NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS kind product_kind DEFAULT 'book'::product_kind NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS qr_code_data jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS qr_code_svg text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS weight_per_unit numeric(10,3);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS erp_name text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS erp_raw jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS erp_sub_category text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS erp_uom text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_stock_item boolean DEFAULT true NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS erp_is_disabled boolean DEFAULT false NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS erp_is_deleted boolean DEFAULT false NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS last_erp_sync_at timestamp with time zone;
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS school_code text;
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS school_name text;
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS branch_name text;
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS website_url text;
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS school_logo_url text;
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS street text;
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS pincode text;
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS uniform_details_checkbox boolean DEFAULT false NOT NULL;
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS books_details_checkbox boolean DEFAULT false NOT NULL;
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS erp_name text;
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS erp_raw jsonb;
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS erp_modified timestamp with time zone;
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS synced_at timestamp with time zone;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true NOT NULL;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS is_new_student boolean DEFAULT false NOT NULL;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS is_verified boolean DEFAULT false NOT NULL;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS verified_at timestamp with time zone;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS school_code text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS middle_name text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS grade text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS joining_date text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS house_color text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS medium text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS curriculum text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS shoe_size text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS shirt_size text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS trouser_size text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS profile_picture_url text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS student_email_id text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS student_mobile_number text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS date_of_birth text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS blood_group text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS nationality text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS customer_link text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS customer_group text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS erp_name text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS erp_raw jsonb;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS erp_modified timestamp with time zone;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS synced_at timestamp with time zone;
