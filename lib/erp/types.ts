// Minimal ERPNext DocType shapes — extend as wiring proceeds.

export type ErpCustomer = {
  name?: string; // ERP primary key (e.g. "CUST-2026-00001")
  customer_name: string;
  mobile_no?: string | null;
  email_id?: string | null;
  customer_group?: string;
  territory?: string;
  gst_category?: string;
};

export type ErpItem = {
  name?: string;
  item_code: string;
  item_name: string;
  item_group?: string;
  stock_uom?: string;
  is_stock_item?: 0 | 1;
  description?: string;
  standard_rate?: number;
};

export type ErpSalesOrderItem = {
  item_code: string;
  qty: number;
  rate: number;
  warehouse?: string;
};

export type ErpSalesOrder = {
  name?: string;
  customer: string;
  transaction_date: string; // YYYY-MM-DD
  delivery_date: string;
  company: string;
  items: ErpSalesOrderItem[];
  taxes_and_charges?: string;
  // Custom CCAvenue fields (Gap audit §C1) live here too — typed when wired.
};

export type ErpWebhookEvent =
  | { event: "on_submit"; doctype: "Sales Order"; doc: ErpSalesOrder }
  | { event: "on_update"; doctype: "Item"; doc: ErpItem }
  | { event: "on_update"; doctype: "Customer"; doc: ErpCustomer };
