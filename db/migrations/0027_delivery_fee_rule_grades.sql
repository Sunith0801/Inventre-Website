-- Local side-table for the per-rule grade scope on ERPNext Delivery Fee Rules.
-- The Delivery Fee Rule doctype has no `grade` field (and the admin panel
-- intentionally does not modify ERPNext schema), so we key by the rule's
-- ERPNext name and store the grade label here. The admin Delivery Fee Rules
-- screen left-joins this table when listing, and the cart-side matcher
-- filters candidates by grade against the student's grade.
CREATE TABLE IF NOT EXISTS delivery_fee_rule_grades (
  rule_name  text PRIMARY KEY,
  grade      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
