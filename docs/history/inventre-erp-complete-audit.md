# Inventre ERP — Complete Deep Audit
## Everything Your Ecommerce Website Needs to Know

> **Platform**: ERPNext v15.88.1 / Frappe v15.88.2  
> **Company**: Inventre Edu Services Pvt Ltd (GSTIN: 36AAMCP1199C1ZA)  
> **Address**: 24th Floor, One West, Nanakramguda, Hyderabad, Telangana 500032  
> **API Base**: https://erp.inventre.in  
> **Live Data**: 6,035 items · 15,614 customers · 23,436+ orders  
> **Audit Date**: 2026-05-02

---

## PART 1 — BUSINESS & PLATFORM OVERVIEW

### What Inventre Does
Inventre is a **B2C school uniform and books supplier** serving multiple schools across India. Parents/students order school-specific uniforms, books, and accessories online. Each product belongs to a specific school and is sold to students of that school.

**Current ecommerce status**: You already have a live ecommerce website processing real orders. Orders arrive in ERPNext as `order_type: "Shopping Cart"` with CCAvenue payment gateway data stored directly on the Sales Order. This audit is to document that full system so you can build/rebuild/extend it.

### Two Companies in ERP
| Abbr | Name | Role |
|------|------|------|
| **IESPL** | Inventre Edu Services Pvt Ltd | Main selling entity (ecommerce orders) |
| **M** | (Manufacturing entity) | Production/manufacturing |

All ecommerce orders go to **IESPL**.

### Installed Apps
| App | Version | Relevance |
|-----|---------|-----------|
| Frappe | 15.88.2 | Framework |
| ERPNext | 15.88.1 | Core ERP |
| India Compliance | 15.23.2 | GST, e-invoicing |
| Webshop | 0.0.1 | Built-in webshop (barely used — only 2 items published) |
| Education | 15.5.3 | Student/fee management |
| Payments | 0.0.1 | Payment gateway framework |
| Inventre (custom) | 0.0.1 | Custom fields and logic |

---

## PART 2 — PRODUCT CATALOG (Items)

### 2.1 Schools & Their Item Prefixes

Every product in ERPNext belongs to one school. The school is stored on each item via **`custom_school_name`** field. The item code prefix identifies the school:

| School Code Prefix | School Name (custom_school_name value) |
|-------------------|----------------------------------------|
| **KLS** | KLINK-Kidlink School |
| **QLS** | QLS School |
| **SAM / SAMYU** | SAMYU-Samyuktha School |
| **SAS BP** | SAS BP School (Badminton/Primary) |
| **SAS KS** | SAS Keesara School |
| **SAS SC / SMS** | SAS Suchitra / SMS School |
| **CAS LR** | CAS LR (Lal Residency campus) |
| **CAS NIBM** | CAS NIBM campus |
| **DLSU** | DL School Uniform |
| **WM JK / Winmore Jakkur** | Winmore Academy Jakkur |
| **WM WF / Winmore Whitefield** | Winmore Academy Whitefield |
| **TSUS** | TSUS School |

**How to use in ecommerce**: When a parent selects their school, filter items where `custom_school_name` contains the school identifier OR use the item name prefix.

### 2.2 Item Category Tree (Complete)

```
All Item Groups
│
├── Uniform
│   ├── Regular
│   │   ├── Shirt          ← Shirts (boys/girls, half-hand/full-hand)
│   │   ├── Full Pants     ← Boys pants, girls pants
│   │   ├── Half Pants     ← Primary school shorts
│   │   ├── Skirt          ← Girls skirts
│   │   ├── Frock          ← Girls frocks (primary)
│   │   ├── Skort          ← Skirt+shorts combo
│   │   ├── T-Shirt        ← Regular polo/house t-shirts
│   │   ├── Blazers        ← School blazers
│   │   └── Waist Coat     ← Formal waistcoats
│   │
│   ├── Sports Uniform
│   │   ├── Tshirt         ← Sports polo/collar shirts
│   │   ├── Track Pant     ← Sports track pants
│   │   ├── RNT            ← Running/Training shorts
│   │   └── Track Shorts   ← Sports shorts
│   │
│   ├── Accessories
│   │   ├── Socks          ← Regular & sports socks
│   │   ├── Bags           ← School bags (S/M/L)
│   │   ├── Belt           ← School belts
│   │   ├── Caps           ← School caps
│   │   ├── Bow Tie
│   │   ├── Tie            ← School ties
│   │   ├── Scarf
│   │   ├── Tights
│   │   └── Bloomers
│   │
│   ├── Essentials
│   │   ├── Shoes          ← School shoes (Bata, Nivia, Kidlink)
│   │   └── Bottle         ← Water bottles (multiple models)
│   │
│   └── Winter Uniform
│       └── Hoodie         ← School hoodies
│
├── Books                  ← Individual textbooks/workbooks/notebooks
├── Books Bundle           ← Complete grade-wise bookkits (CBSE/CIE)
├── Books Template         ← Bookkit templates
├── Sub Bundle             ← Sub-component bundles
├── Magic Box              ← Premium bundle product
├── POS ITEM               ← Walk-in counter items
├── Fee Component          ← School fee items (Education module)
├── Finished Products
├── Raw Material
├── Packing Material
├── Consumable
├── Services
└── Sub Assemblies
```

### 2.3 Complete Item Schema (Real Fields from ERPNext)

These are ALL fields on the Item DocType that matter for ecommerce:

```
tabItem
│
├── IDENTITY
│   ├── name / item_code          → PK. e.g. "KLS Boys Shirt"
│   ├── item_name                 → Display name
│   ├── item_group                → Category (e.g. "Shirt")
│   ├── gst_hsn_code              → "61012000" (garments HSN)
│   ├── stock_uom                 → "Nos" (pieces)
│   ├── disabled                  → 0 = active, 1 = hidden
│   ├── is_sales_item             → 1 = can be sold
│   ├── is_stock_item             → 1 = inventory tracked
│   ├── has_variants              → 1 = has size/color variants
│   ├── variant_of                → Parent item code (if this is a variant)
│   └── variant_based_on          → "Item Attribute"
│
├── MEDIA
│   ├── image                     → e.g. "/files/shirt front.png"
│   └── custom_size_chart         → "/files/Shirt.jpg" (size guide image)
│
├── SCHOOL-SPECIFIC CUSTOM FIELDS
│   ├── custom_school_name        → "KLINK-Kidlink School" ← KEY FIELD
│   ├── custom_uniform_grade[]    → Grades this item is for (Grade 4–10 etc.)
│   └── custom_organization_grade[] → Org-level grade assignments
│
├── PRICING CUSTOM FIELDS
│   ├── custom_inventre_cost_price        → Inventre's cost
│   ├── custom_category_fixed_margin      → Fixed margin %
│   ├── custom_suggested_organization_price → Suggested org price
│   ├── custom_agreed_price_org           → Agreed school price
│   ├── custom_organization_margin        → School markup
│   ├── custom_organization_mrp           → School MRP
│   ├── custom_customer_discount          → Customer discount %
│   └── custom_display_price             → ← USE THIS for ecommerce display
│
├── DIMENSIONS
│   ├── custom_weight, custom_length
│   ├── custom_widthwaist, custom_height
│   └── weight_per_unit (standard field)
│
├── INVENTORY
│   ├── custom_msl                → Minimum stock level
│   ├── custom_opening_qty
│   ├── custom_reordering_tat    → Reorder lead time (days)
│   ├── custom_minimum_order_quantity
│   └── custom_gst_inclusiveexclusive → "Inclusive" or "Exclusive"
│
├── GST
│   ├── gst_hsn_code              → "61012000"
│   └── taxes[]                   → Item-specific tax overrides
│
├── VARIANT ATTRIBUTES (for parent items)
│   └── attributes[]
│       ├── attribute             → e.g. "Shirt Size", "Uniform Colors"
│       └── disabled              → 0/1
│
├── DEFAULT SETTINGS
│   └── item_defaults[]
│       ├── company               → "Inventre Edu Services Pvt Ltd"
│       └── default_warehouse     → "Stores - IESPL"
│
└── QR CODE
    ├── pm_qr_code                → SVG QR code (base64)
    └── pm_qr_data                → JSON: {type, item_code, item_name, weight, cbm, checksum}
```

### 2.4 Variant Item Code Pattern (CRITICAL)

**This is how variant item codes are constructed in your system:**

```
{ParentItemCode}{ColorLetter}{Size}{Separator}
```

Examples from live data:
| Variant Item Code | Parent | Color Code | Size | Separator |
|------------------|--------|-----------|------|-----------|
| `SAM Boys PantK22$$` | SAM Boys Pant | K | 22 | $$ |
| `SAM Sports ShortsJ34$$` | SAM Sports Shorts | J | 34 | $$ |
| `SAM Track PantM34$$` | SAM Track Pant | M | 34 | $$ |
| `SAM Regular T-ShirtN38$$` | SAM Regular T-Shirt | N | 38 | $$ |
| `SAM House T-shirtA38$$` | SAM House T-shirt | A | 38 | $$ |
| `SAM SocksKL$$$` | SAM Socks | K | L | $$$ |
| `SAM BeltKL$$$` | SAM Belt | K | L | $$$ |
| `QLS Boys ShirtJ34$$` | QLS Boys Shirt | J | 34 | $$ |
| `SAS BP Regular SocksJL$$$` | SAS BP Regular Socks | J | L | $$$ |
| `SMS 9-10 Girls SkirtM40$$` | SMS 9-10 Girls Skirt | M | 40 | $$ |
| `SAS BP BeltL2XL$` | SAS BP Belt | L | 2XL | $ |
| `SAS KS ShoesI4UK$` | SAS KS Shoes | I | 4UK | $ |

**Pattern breakdown:**
- Color = encoded as single uppercase letter (A, B, D, G, J, K, L, M, N, R, etc.)
- Size = numeric (22, 34, 38...) or alpha-numeric (2XL, L, 4UK, 10S...)
- Separator = `$`, `$$`, or `$$$` (varies by item type)

**What the color letters map to depends on the item's attribute.** For SAM House T-shirt: A=Kalpana Chawla(RED), V=Vikram Sarabhai(BLUE), I=Isaac Newton(GREEN), G=Galileo Galilei(YELLOW).

> **Ecommerce implication**: When displaying a product, fetch parent item + all variants. Parse the variant `item_name` to show readable size/color labels rather than the encoded item_code.

### 2.5 All Item Attributes with Complete Values

#### Size Attributes

| Attribute | Values |
|-----------|--------|
| **Shirt Size** | 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58 |
| **Full Pant size** | 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50 |
| **Half Pants Size** | 14A/B, 16A/B/C/D, 18A/B/C/D, 20A/B/C/D, 22A/B/C/D, 24A/B/C/D, 26A/B/C/D, 28A/B/C/D, 30A/B/C/D, 32A/B/C/D, 34A/B/C/D, 36A/B/C/D, 38A/B/C |
| **Skirt Size** | 16A-E, 18A-F, 20A-E, 22A-F, 24A-F, 26A-F, 28A-E, 30A-F, 32A-F, 34A-F, 36A-D, 38A-E, 40A-D, 42A-C |
| **Tshirt Size** | 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60, 62, 64 |
| **Track Pant Size** | 18–52 (even numbers) |
| **Track Shorts Sizes** | 14–46 |
| **Hoodie Sizes** | 20–58 (even) |
| **Blazer Sizes** | 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 50 |
| **Waist Coat Sizes** | 24–46 (even) |
| **Frock Sizes** | 18–48 (even) |
| **Bloomers Sizes** | 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 110 |
| **Tie Sizes** | 12, 14, 16, 18, 20 |
| **Belt Size** | S, M, L, XL, 2XL |
| **Bags Size** | S, M, L |
| **Socks Size** | XS, S, M, L, XL, 2XL, 3XL, 4XL |
| **Shoe Size** | 6S–13S (Indian kids), 1UK–12UK (UK sizing), 6K–13K |
| **BATA SHOE SIZE** | UK 1–12 |
| **NIVIA SHOES SIZE** | UK 1–13 |
| **WINMORE SHOES SIZE** | UK 4–10 |
| **WM JK SHOE SIZE** | 11S, 1UK–11UK |
| **WM WF SHOE SIZE** | 11S, 4UK–10UK |
| **SAS SHOES SIZE** | UK 1–13 (mixed format) |
| **Caps Sizes** | 1, 2, 3, 4 |
| **WM Skirt Sizes** | Waist-Length format: 20-12, 22-14... 36-26 |
| **WM WF Half Pants Sizes** | Waist-Length: 18-10 to 32-16 |
| **SMS 9-10 Skirt Sizes** | 30–46 (even) |

#### Color Attributes

| Attribute | Values |
|-----------|--------|
| **Uniform Colors** | Teal, Yellow, White, Navy, Grey, BLUE, Maroon, Purple, Red, Green, Black, Orange, Pink, Brown, Beige, Turquoise, Off White, Mint |
| **SAM House Color** | Kalpana Chawla - RED, Vikram Sarabhai - BLUE, Isaac Newton - GREEN, Galileo Galilei - YELLOW |
| **SAS BP UNIFORM COLOURS** | Sapphire knights - BLUE, Topaz Vikings - YELLOW, Ruby Spartans - RED, Emarald Gladiators - Green |
| **QLS Sports Color** | Alpha (Red), Beta (Blue), Delta (Green), Gamma (Yellow) |
| **TSUS Colors** | Dhairya (Blue), Abhay (RED), Lakshay (GREEN), Nishchay (YELLOW), NAVY, WHITE, BLACK, OFF WHITE |
| **Sports Color** | Red, Blue, Green, Yellow |
| **Sports Track Color** | Red, Blue, Green, Yellow, Navy, Black |
| **Hoodie Color** | Navy, Maroon |
| **Belt Color** | Black, Navy, Maroon, Green |
| **Regular Socks Color** | Navy, White, Grey, Green, Black |
| **Sports Socks Color** | Red, Blue, Green, Yellow |
| **Caps Color** | Navy, Red, Green, Grey |
| **Shoes Color** | Black, White |
| **Bag Color** | Red, Navy, + 25 named designs (Dreamy Unicorn, Space Adventure, etc.) |

#### Bag Design Attributes

| Attribute | Values |
|-----------|--------|
| **INVENTRE BAG DESIGN** | GLOBE TECH L, COSMIC NAVIGATOR L, INVENTRE CLASSIC L, ROCK MODE L, THUNDER CHARGE L, INVENTRE PRESTIGE L, RACING REX NAVY M, RACING REX BLACK M, etc. (17 designs) |
| **CRIMSON BAG DESIGN** | Space adventure, Dreamy unicorn, Pink paradise, etc. (12 variants) |

#### Water Bottle Models
| Attribute | Values |
|-----------|--------|
| **WATER BOTTLE MODELS** | Deer horns (6 colors), Smart Vacuum (2), Urban Matt stainless steel (6 colors), Cloud striper (4), Dual Sippers (Dino/Bunny/Unicorn/Bear) |

#### Books Bundle Language/Stream Selection

| School | Grades | Selections |
|--------|--------|-----------|
| **CAS LR CBSE** | Grades 5–8 | Hindi 2nd Lan, French 2nd Lan |
| **CAS LR CBSE Grade 9** | Grade 9 | AI Stream, Painting Stream, FM Stream |
| **CAS LR CIE** | Grades 5–8 | Hindi 2nd Lan, French 2nd Lan |
| **CAS NIBM CBSE** | Grades 5–8 | Hindi/French 2nd Lan |
| **CAS NIBM CBSE Grade 9** | Grade 9 | AI/Painting/FM Stream |
| **SAS Keesara** | Grades UKG–12 | Hindi/Telugu 2nd Lan; Grade 11: Core (MPC/BPC/Commerce/Humanities) + Elective (9 subjects); Grade 12: Core + Extra |
| **SAS Suchitra** | Grades UKG–12 | Hindi/Telugu/French; Grade 11: Core + Elective (12 subjects); Grade 12: Core + Extra |
| **SMS** | Grades UKG–12 | Hindi/Telugu 2nd Lan; Grade 11: Core (MPC/BPC/Commerce/Humanities) + Elective; Grade 12: Core + Extra |
| **Winmore Jakkur** | Grades UKG, 1–10 | Hindi/Kannada 2nd Lan (Grade 6+ adds French) |
| **Winmore Whitefield** | Grades UKG, 1–10 | Hindi/Kannada 2nd Lan |
| **TSUS** | Grade 12 | PCM/PCB/Commerce/Humanities + Extra subjects |

---

## PART 3 — COMPLETE DOCTYPE SCHEMAS

### 3.1 Item (Full Schema with Real Values)

```json
{
  "name": "KLS Boys Shirt",           // item_code — Primary Key
  "item_name": "KLS Boys Shirt",
  "item_group": "Shirt",
  "gst_hsn_code": "61012000",         // HSN for garments
  "stock_uom": "Nos",
  "disabled": 0,
  "is_sales_item": 1,
  "is_stock_item": 1,
  "has_variants": 1,                  // true = parent template
  "variant_of": null,                 // null for parent; "KLS Boys Shirt" for variants
  "variant_based_on": "Item Attribute",
  "image": "/files/shirt front.png",
  "standard_rate": 0.0,              // ALWAYS 0 — prices in Item Price
  "country_of_origin": "India",
  
  // CUSTOM FIELDS (Inventre-specific)
  "custom_school_name": "KLINK-Kidlink School",
  "custom_size_chart": "/files/Shirt.jpg",
  "custom_display_price": 0.0,       // Set this for ecommerce display
  "custom_customer_discount": 0.0,
  "custom_gst_inclusiveexclusive": "",
  "custom_msl": 0.0,                 // Min stock level
  "custom_reordering_tat": 0,
  "custom_minimum_order_quantity": 0,
  "custom_weight": 0.0,
  "custom_length": 0.0,
  "custom_widthwaist": 0.0,
  "custom_height": 0.0,
  "custom_inventre_cost_price": 0.0,
  "custom_display_price": 0.0,
  
  // CHILD TABLES
  "attributes": [
    {"attribute": "Uniform Colors", "disabled": 0},
    {"attribute": "Shirt Size", "disabled": 0}
  ],
  "custom_uniform_grade": [
    {"grade": "Grade 4"},
    {"grade": "Grade 5"},
    {"grade": "Grade 6"},
    {"grade": "Grade 7"},
    {"grade": "Grade 8"},
    {"grade": "Grade 9"},
    {"grade": "Grade 10"}
  ],
  "item_defaults": [
    {
      "company": "Inventre Edu Services Pvt Ltd",
      "default_warehouse": "Stores - IESPL"
    }
  ]
}
```

### 3.2 Customer (Full Schema)

```json
{
  "name": "A J Aarti",               // Auto-generated or customer name
  "naming_series": "CUST-.YYYY.-",
  "customer_name": "A J Aarti",
  "customer_type": "Individual",     // "Individual" or "Company"
  "customer_group": "Student",       // Student/School/Individual/Commercial
  "language": "en",
  "mobile_no": "9885319071",
  "email_id": "aartiarcot78@gmail.com",
  "gst_category": "Unregistered",    // Always Unregistered for student/parent
  "disabled": 0,
  "is_frozen": 0,
  
  // Related via Dynamic Link:
  // tabAddress → Address with link_doctype="Customer", link_name=customer_name
  // tabContact → Contact with link_doctype="Customer", link_name=customer_name
  
  "customer_primary_contact": "A J Aarti-A J Aarti"
  // Contact naming format: "{CustomerName}-{CustomerName}"
}
```

### 3.3 Address (Full Schema)

```json
{
  "name": "Home-Shipping-11480",      // Auto-generated
  "address_title": "Home",
  "address_type": "Shipping",
  "address_line1": "10-9/3 vidyanagar colony",
  "address_line2": "Sangareddy",
  "city": "SANGAREDDY",
  "state": "Telangana",
  "country": "India",
  "pincode": "502001",
  "phone": "09000008464",
  
  // Links to Customer via:
  "links": [
    {
      "link_doctype": "Customer",
      "link_name": "SRIVANDLA JALENDHAR NATH"
    }
  ]
}
```

### 3.4 Sales Order (Full Schema — ACTUAL LIVE FIELDS)

```json
{
  // IDENTITY
  "name": "SAL-ORD-2026-23511",       // Auto: SAL-ORD-.YYYY.-
  "naming_series": "SAL-ORD-.YYYY.-",
  "docstatus": 1,                      // 0=Draft, 1=Submitted, 2=Cancelled
  
  // ORDER BASICS
  "order_type": "Shopping Cart",       // "Shopping Cart" for online orders
  "customer": "SRIVANDLA JALENDHAR NATH",
  "customer_name": "SRIVANDLA JALENDHAR NATH",
  "company": "Inventre Edu Services Pvt Ltd",
  "transaction_date": "2026-05-01",
  "delivery_date": null,
  
  // SCHOOL/STUDENT CUSTOM FIELDS ← CRITICAL
  "custom_student_school": "SAMYU-Samyuktha School",
  "custom_student_grade": "Grade 9",
  
  // PRICING
  "currency": "INR",
  "selling_price_list": "Standard Selling",
  "taxes_and_charges": "Output GST In-state - IESPL",
  
  // AMOUNTS
  "total_qty": 13.0,
  "net_total": 5926.0,
  "total_taxes_and_charges": 0.0,     // 0 because garments are Nil-Rated
  "grand_total": 5926.0,
  "rounded_total": 5926.0,
  "advance_paid": 5926.0,
  
  // ADDRESS
  "customer_address": "Home-Shipping-11480",
  "shipping_address_name": "Home-Shipping-11480",
  "custom_pin_code": "502001",
  "place_of_supply": "36-Telangana",
  "gst_category": "Unregistered",
  
  // STATUS
  "status": "To Deliver and Bill",    // Draft/To Deliver and Bill/Completed/Cancelled
  "delivery_status": "Not Delivered",
  "billing_status": "Not Billed",
  "per_delivered": 0.0,
  "per_billed": 0.0,
  "custom_display_status": "",
  
  // PAYMENT GATEWAY FIELDS ← YOUR CCAVENUE INTEGRATION
  "custom_payment_flow": "ONLINE",
  "custom_gateway_provider": "CCAVENUE",
  "custom_gateway_order_id": "SO177765954505f6eb",
  "custom_internal_payment_reference": "SO177765954505f6eb",
  "custom_payment_mode": "Credit Card",     // Credit Card/Debit Card/UPI/Net Banking
  "custom_payment_status": "SUCCESS",       // SUCCESS/FAILURE/PENDING
  "custom_payment_date": "01/05/2026 23:54:08",
  "custom_paid_currency": "INR",
  "custom_paid_amount": "10964.62",
  "custom_refund_status": "NOT_REQUESTED", // NOT_REQUESTED/PENDING/SUCCESS/FAILED
  "custom_gateway_tracking_id": "114479950132",
  "custom_gateway_response_message": "Y:145262:...",
  "custom_payment_attempt_count": 1,
  "custom_payment_retry_count": 0,
  "custom_payment_finalized": 0,
  "custom_order_submit_error": 0,
  "custom_checkout_notification_sent": "SO177765954505f6eb",
  "custom_is_replacement_so": 0,
  "custom_magic_box": 0,
  
  // WAREHOUSE
  "set_warehouse": "Stores - IESPL",
  
  // COMPANY DETAILS
  "company_address": "Inventre Edu Services Pvt Ltd-Billing",
  "company_gstin": "36AAMCP1199C1ZA",
  
  // CHILD TABLES
  "items": [
    {
      "item_code": "SAM Boys PantK22$$",
      "item_name": "SAM Boys Pant K22$$",
      "item_group": "Full Pants",
      "gst_hsn_code": "61012000",
      "qty": 2.0,
      "rate": 860.0,
      "amount": 1720.0,
      "price_list_rate": 860.0,
      "discount_percentage": 0.0,
      "gst_treatment": "Nil-Rated",   // Most uniforms: Nil-Rated
      "igst_rate": 0.0,
      "cgst_rate": 0.0,
      "sgst_rate": 0.0,
      "warehouse": "Stores - IESPL",
      "actual_qty": 0.0,             // Stock at order time (can be 0 = on backorder)
      "projected_qty": 0.0
    }
  ],
  
  "custom_sub_items": [             // Sub-items for bundled products
    {
      "parent_item_code": "SAM Boys PantK22$$",
      "item_code": "SAM Boys PantK22$$",
      "qty": 2
    }
  ],
  
  "taxes": [],                       // Empty for Nil-Rated uniform orders
  
  "payment_schedule": [
    {
      "due_date": "2026-05-01",
      "invoice_portion": 100.0,
      "payment_amount": 5926.0,
      "outstanding": 5926.0
    }
  ]
}
```

### 3.5 Sales Invoice (Full Schema)

```json
{
  "name": "INV-26-27-00001",          // Naming: INV-26-27- (financial year 26-27)
  "customer": "Yajurrved Basavoju",
  "posting_date": "2026-04-22",
  "due_date": "2026-04-22",
  "company": "Inventre Edu Services Pvt Ltd",
  "company_tax_id": "36AAMCP1199C1ZA",
  
  "selling_price_list": "Standard Selling",
  "taxes_and_charges": "Output GST In-state - IESPL",
  "currency": "INR",
  
  "net_total": 360.0,
  "total_taxes_and_charges": 64.8,  // 9% SGST + 9% CGST on taxable items
  "grand_total": 424.8,
  "rounded_total": 425.0,
  "outstanding_amount": 425.0,
  
  "gst_category": "Unregistered",
  "place_of_supply": "36-Telangana",
  "company_gstin": "36AAMCP1199C1ZA",
  
  "status": "Overdue",              // Draft/Submitted/Paid/Unpaid/Overdue
  "einvoice_status": "Not Applicable",
  "e_waybill_status": "Not Applicable",
  
  "is_return": 0,                   // 1 for credit notes (returns)
  "is_debit_note": 0,
  
  "debit_to": "Debtors - IESPL",
  "against_income_account": "Sales - IESPL",
  
  "items": [
    {
      "item_code": "SAS BP Regular SocksJL$$$",
      "gst_hsn_code": "61012000",
      "qty": 3.0,
      "rate": 120.0,
      "amount": 360.0,
      "gst_treatment": "Taxable",    // Socks ARE taxable (18% GST)
      "cgst_rate": 9.0,
      "sgst_rate": 9.0,
      "cgst_amount": 32.4,
      "sgst_amount": 32.4,
      "warehouse": "Stores - IESPL",
      "sales_order": "SAL-ORD-2026-12215",  // Linked back to SO
      "income_account": "Sales - IESPL",
      "expense_account": "Cost of Goods Sold - IESPL"
    }
  ],
  
  "taxes": [
    {
      "charge_type": "On Net Total",
      "account_head": "Output Tax SGST - IESPL",
      "description": "SGST",
      "rate": 9.0,
      "tax_amount": 32.4,
      "gst_tax_type": "sgst"
    },
    {
      "charge_type": "On Net Total",
      "account_head": "Output Tax CGST - IESPL",
      "description": "CGST",
      "rate": 9.0,
      "tax_amount": 32.4,
      "gst_tax_type": "cgst"
    }
  ]
}
```

### 3.6 GST Tax Rules

```
Uniform items (Nil-Rated):
  HSN 61012000 + gst_treatment = "Nil-Rated"
  → 0% GST (no tax added to order)
  → Use template "Output GST In-state - IESPL" (rates will auto-zero)

Other items (Taxable — e.g. Socks, Stationery):
  HSN 61012000 + gst_treatment = "Taxable"
  → In-state (Telangana → Telangana): SGST 9% + CGST 9% = 18% total
  → Out-state (any other state): IGST 18%

Detect in-state/out-state:
  Company state = Telangana (State Code 36)
  Customer state from shipping pincode
  If shipping state code == "36" → In-state → use "Output GST In-state - IESPL"
  Else → Out-state → use "Output GST Out-state - IESPL"
```

### 3.7 Bin (Stock) Schema

```json
{
  "item_code": "QLS Boys ShirtJ34$$",
  "warehouse": "Stores - IESPL",
  "actual_qty": 69.0,          // Physical stock on hand
  "reserved_qty": 23.0,        // Reserved for submitted Sales Orders
  "projected_qty": 46.0,       // actual_qty - reserved_qty + ordered_qty
  "valuation_rate": 215.0      // Average purchase cost
}
```

**Available for sale = `actual_qty - reserved_qty`**  
⚠️ Many items have negative `projected_qty` — meaning more orders than stock. Your ecommerce site should show "Out of Stock" when `actual_qty - reserved_qty <= 0`.

### 3.8 Item Price Schema

```json
{
  "item_code": "KLS Boys Shirt-28",   // Variant item code
  "price_list": "Standard Selling",  // Use this for ecommerce
  "price_list_rate": 450.0,          // Selling price in INR
  "currency": "INR",
  "uom": "Nos",
  "min_qty": 0.0,                    // Usually 0 = no minimum
  "valid_from": null,
  "valid_upto": null
}
```

**Price Lists available:**
- `Standard Selling` — regular online/retail price ← **USE THIS**
- `MRP` — maximum retail price (for labels)
- `POS Retail` — walk-in store price
- `Standard Buying` — purchase cost (buying only)

---

## PART 4 — PAYMENT GATEWAY (CCAVENUE)

### 4.1 Current Gateway: CCAvenue

Your ERP already has CCAvenue integration. All payment data is stored as custom fields on the Sales Order:

| Field | Description | Example Value |
|-------|-------------|---------------|
| `custom_gateway_provider` | Gateway name | "CCAVENUE" |
| `custom_payment_flow` | "ONLINE" or "COD" | "ONLINE" |
| `custom_gateway_order_id` | CCAvenue order reference | "SO177765954505f6eb" |
| `custom_internal_payment_reference` | Internal ref (usually same) | "SO177765954505f6eb" |
| `custom_payment_mode` | Payment method used | "Credit Card" |
| `custom_payment_status` | Gateway result | "SUCCESS" / "FAILURE" / "PENDING" |
| `custom_payment_date` | When payment happened | "01/05/2026 23:54:08" |
| `custom_paid_currency` | Currency | "INR" |
| `custom_paid_amount` | Amount paid at gateway | "10964.62" |
| `custom_gateway_tracking_id` | CCAvenue tracking ID | "114479950132" |
| `custom_gateway_response_message` | Raw CCAvenue response | "Y:145262:..." |
| `custom_refund_status` | Refund state | "NOT_REQUESTED" |
| `custom_payment_attempt_count` | How many attempts | 1 |
| `custom_payment_retry_count` | Retries | 0 |
| `custom_payment_finalized` | Finalized flag | 0 |
| `custom_checkout_notification_sent` | Notification ref | "SO177765954505f6eb" |

### 4.2 Modes of Payment (Configured)

| Mode | Type | Used For |
|------|------|---------|
| Credit Card | Bank | Online |
| DEBIT CARD | Bank | Online |
| Net Banking | Cash | Online |
| UPI | Cash | Online |
| UNIFIED PAYMENTS | Bank | Online |
| WALLET | Bank | Online |
| EMI | Bank | Online |
| ONLINE | Bank | Generic online |
| COD | Cash | Cash on delivery |
| Cash | Cash | Walk-in |
| Amazon Pay | Cash | Online |

### 4.3 Payment Flow

```
ECOMMERCE WEBSITE
    │
    ▼
[1] Create Sales Order in ERP (Draft, docstatus=0)
    POST /api/resource/Sales Order
    → custom_payment_flow: "ONLINE"
    → custom_gateway_provider: "CCAVENUE"
    → custom_payment_status: "PENDING"
    │
    ▼
[2] Redirect to CCAvenue payment page
    Use: custom_gateway_order_id as the order reference
    │
    ▼
[3] Customer pays at CCAvenue
    │
    ▼
[4] CCAvenue sends response back to your server
    │
    ├── SUCCESS:
    │   PUT /api/resource/Sales Order/{so_name}
    │   {
    │     custom_payment_status: "SUCCESS",
    │     custom_gateway_tracking_id: "{tracking_id}",
    │     custom_payment_mode: "Credit Card",
    │     custom_paid_amount: "{amount}",
    │     custom_payment_date: "{datetime}",
    │     custom_gateway_response_message: "{raw_response}"
    │   }
    │   Then submit the Sales Order:
    │   POST /api/method/frappe.client.submit
    │   {doc: {doctype: "Sales Order", name: "{so_name}"}}
    │
    └── FAILURE:
        PUT /api/resource/Sales Order/{so_name}
        {custom_payment_status: "FAILURE"}
        Keep as Draft, allow retry
```

---

## PART 5 — COMPLETE API REFERENCE

### 5.1 Authentication

```http
Authorization: token {api_key}:{api_secret}
Content-Type: application/json
```

Generate keys: ERPNext → Settings → Users → Your User → API Access → Generate Keys

### 5.2 Products API

**Get items for a school:**
```http
GET /api/resource/Item
  ?filters=[["custom_school_name","like","%Kidlink%"],["disabled","=",0],["is_sales_item","=",1],["has_variants","=",1]]
  &fields=["name","item_name","item_group","image","custom_size_chart","custom_school_name","custom_display_price","custom_uniform_grade"]
  &limit_page_length=500
```

**Get variants of a parent item:**
```http
GET /api/resource/Item
  ?filters=[["variant_of","=","KLS Boys Shirt"],["disabled","=",0]]
  &fields=["name","item_name","item_group","stock_uom"]
  &limit_page_length=100
```

**Get item with all details:**
```http
GET /api/resource/Item/KLS Boys Shirt
```

**Get item price:**
```http
GET /api/resource/Item Price
  ?filters=[["item_code","=","KLS Boys ShirtJ28$$"],["price_list","=","Standard Selling"],["selling","=",1]]
  &fields=["price_list_rate","currency","min_qty","valid_from","valid_upto"]
```

**Get stock (Bin):**
```http
GET /api/resource/Bin
  ?filters=[["item_code","=","KLS Boys ShirtJ28$$"],["warehouse","=","Stores - IESPL"]]
  &fields=["actual_qty","reserved_qty","projected_qty","valuation_rate"]
```

**Get all in-stock items for a school (efficient):**
```http
GET /api/resource/Bin
  ?filters=[["warehouse","=","Stores - IESPL"],["actual_qty",">",0]]
  &fields=["item_code","actual_qty","reserved_qty"]
  &limit_page_length=0
```

### 5.3 Categories API

```http
GET /api/resource/Item Group
  ?filters=[["is_group","=",0],["parent_item_group","in",["Shirt","Full Pants","Half Pants","Skirt"]]]
  &fields=["name","item_group_name","parent_item_group","image"]
  &order_by=lft asc
```

### 5.4 Customer API

**Find by mobile:**
```http
GET /api/resource/Customer
  ?filters=[["mobile_no","=","9885319071"]]
  &fields=["name","customer_name","email_id","mobile_no","customer_group"]
```

**Find by email:**
```http
GET /api/resource/Customer
  ?filters=[["email_id","=","parent@gmail.com"]]
  &fields=["name","customer_name","email_id","mobile_no"]
```

**Create customer:**
```http
POST /api/resource/Customer
{
  "customer_name": "Student Full Name",
  "customer_type": "Individual",
  "customer_group": "Student",
  "mobile_no": "9999999999",
  "email_id": "parent@email.com",
  "gst_category": "Unregistered"
}
```

**Add address:**
```http
POST /api/resource/Address
{
  "address_title": "Home",
  "address_type": "Shipping",
  "address_line1": "123 Main Street",
  "city": "Hyderabad",
  "state": "Telangana",
  "country": "India",
  "pincode": "500032",
  "phone": "9999999999",
  "links": [{"link_doctype": "Customer", "link_name": "CUST-2026-00001"}]
}
```

**Get customer addresses:**
```http
GET /api/resource/Address
  ?filters=[["Dynamic Link","link_doctype","=","Customer"],["Dynamic Link","link_name","=","CUST-2026-00001"]]
  &fields=["name","address_title","address_line1","city","state","pincode","phone"]
```

### 5.5 Sales Order API

**Create Sales Order:**
```http
POST /api/resource/Sales Order
{
  "order_type": "Shopping Cart",
  "customer": "CUST-2026-00001",
  "company": "Inventre Edu Services Pvt Ltd",
  "transaction_date": "2026-05-02",
  "currency": "INR",
  "selling_price_list": "Standard Selling",
  "taxes_and_charges": "Output GST In-state - IESPL",
  "set_warehouse": "Stores - IESPL",
  
  "custom_student_school": "SAMYU-Samyuktha School",
  "custom_student_grade": "Grade 9",
  
  "customer_address": "Home-Shipping-11480",
  "shipping_address_name": "Home-Shipping-11480",
  "custom_pin_code": "502001",
  
  "custom_payment_flow": "ONLINE",
  "custom_gateway_provider": "CCAVENUE",
  "custom_payment_status": "PENDING",
  
  "items": [
    {
      "item_code": "SAM Boys PantK22$$",
      "qty": 2,
      "rate": 860.0,
      "warehouse": "Stores - IESPL"
    }
  ]
}
```

**Update payment status (after CCAvenue callback):**
```http
PUT /api/resource/Sales Order/SAL-ORD-2026-23511
{
  "custom_payment_status": "SUCCESS",
  "custom_payment_mode": "Credit Card",
  "custom_gateway_tracking_id": "114479950132",
  "custom_paid_amount": "5926.00",
  "custom_payment_date": "02/05/2026 14:30:00",
  "custom_gateway_response_message": "Y:...",
  "custom_refund_status": "NOT_REQUESTED"
}
```

**Submit Sales Order (finalizes it):**
```http
POST /api/method/frappe.client.submit
{"doc": {"doctype": "Sales Order", "name": "SAL-ORD-2026-23511"}}
```

**Get order status:**
```http
GET /api/resource/Sales Order/SAL-ORD-2026-23511
```

**Get customer's order history:**
```http
GET /api/resource/Sales Order
  ?filters=[["customer","=","CUST-2026-00001"]]
  &fields=["name","transaction_date","grand_total","status","delivery_status","billing_status","custom_student_school","custom_student_grade","custom_payment_status"]
  &order_by=transaction_date desc
  &limit_page_length=20
```

**Cancel order:**
```http
POST /api/method/frappe.client.cancel
{"doc": {"doctype": "Sales Order", "name": "SAL-ORD-2026-23511"}}
```

### 5.6 Delivery & Invoice API

**Get delivery note for an order:**
```http
GET /api/resource/Delivery Note
  ?filters=[["Sales Order","against_sales_order","=","SAL-ORD-2026-23511"]]
  &fields=["name","posting_date","status","lr_no","lr_date","transporter","grand_total"]
```

**Get invoice for an order:**
```http
GET /api/resource/Sales Invoice
  ?filters=[["Sales Invoice Item","sales_order","=","SAL-ORD-2026-23511"]]
  &fields=["name","posting_date","status","grand_total","outstanding_amount","einvoice_status"]
```

### 5.7 GST / Tax Detection

```javascript
// Determine correct tax template based on customer pincode
function getTaxTemplate(pincode) {
  // All Telangana pincodes start with 5 (500xxx-536xxx)
  const telanganaRanges = [
    [500000, 536999]
  ];
  const pin = parseInt(pincode);
  const inTelangana = telanganaRanges.some(([min, max]) => pin >= min && pin <= max);
  
  return inTelangana
    ? 'Output GST In-state - IESPL'    // SGST 9% + CGST 9%
    : 'Output GST Out-state - IESPL';  // IGST 18% (for taxable items only)
}
// Note: Most uniform items are Nil-Rated anyway, so GST = 0 regardless
```

---

## PART 6 — COMPLETE ORDER FLOW

### 6.1 Full Checkout Flow (What Your Ecommerce Site Needs to Do)

```
STEP 1: SCHOOL SELECTION
├── Parent visits site
├── Selects school from dropdown
│   GET /api/resource/Item ?filters=[["custom_school_name","like","%{school}%"]]
└── Site filters catalog to show only that school's items

STEP 2: GRADE SELECTION (optional filter)
├── Parent selects child's grade (Grade 1, Grade 2... Grade 12)
└── Filter items by custom_uniform_grade[].grade = "Grade X"

STEP 3: CATALOG BROWSING
├── Show parent items (has_variants=1) as product cards
├── For each product: fetch Item Price (Standard Selling) for display price
└── Show "In Stock" / "Out of Stock" from Bin (actual_qty - reserved_qty)

STEP 4: PRODUCT DETAIL
├── Show parent item image, description, size chart (custom_size_chart)
├── Show variant selector: dropdown for each attribute (Color, Size)
├── On selection: fetch specific variant's Item Price and Bin stock
└── Add to cart: store {item_code (variant), qty, rate, item_name}

STEP 5: CART
├── Local cart state: [{item_code, item_name, qty, rate, image}]
├── Show line totals and grand total
├── GST note: "Uniform items are GST exempt"
└── Proceed to checkout

STEP 6: LOGIN / REGISTER
├── Login by mobile OTP (matches ERP mobile_no field)
├── Or login by email
├── On login:
│   GET /api/resource/Customer ?filters=[["mobile_no","=","{phone}"]]
│   → found: use existing customer
│   → not found: POST /api/resource/Customer (create new)
└── Store ERP customer name in session

STEP 7: ADDRESS
├── Show saved addresses:
│   GET /api/resource/Address ?filters=[["Dynamic Link","link_name","=","{customer}"]]
├── Or add new address:
│   POST /api/resource/Address
└── Select billing = shipping (or separate)

STEP 8: ORDER REVIEW
├── Show order summary
├── Determine tax template from pincode
└── Calculate final total (usually same as cart total for nil-rated items)

STEP 9: CREATE SALES ORDER IN ERP
POST /api/resource/Sales Order
{
  order_type: "Shopping Cart",
  customer: "{erpCustomerName}",
  company: "Inventre Edu Services Pvt Ltd",
  transaction_date: "{today}",
  selling_price_list: "Standard Selling",
  taxes_and_charges: "{instate_or_outstate}",
  set_warehouse: "Stores - IESPL",
  custom_student_school: "{schoolName}",
  custom_student_grade: "{grade}",
  shipping_address_name: "{addressName}",
  custom_pin_code: "{pincode}",
  custom_payment_flow: "ONLINE",
  custom_gateway_provider: "CCAVENUE",
  custom_payment_status: "PENDING",
  custom_gateway_order_id: "{generate_unique_ref}",
  items: [{item_code, qty, rate, warehouse: "Stores - IESPL"}]
}
→ Response: {data: {name: "SAL-ORD-2026-XXXXX"}}

STEP 10: PAYMENT GATEWAY
├── Redirect to CCAvenue with:
│   order_id: "{custom_gateway_order_id}"
│   amount: "{grand_total}"
│   customer_email, customer_phone
└── Wait for CCAvenue callback

STEP 11: PAYMENT CALLBACK
├── SUCCESS:
│   PUT /api/resource/Sales Order/{so_name}
│   {custom_payment_status: "SUCCESS", tracking_id, mode, amount, date}
│   POST /api/method/frappe.client.submit {so_name}
│   → Order status becomes "To Deliver and Bill"
│   → Send confirmation SMS/email to customer
│
└── FAILURE:
    PUT /api/resource/Sales Order/{so_name}
    {custom_payment_status: "FAILURE"}
    → Keep as Draft, show retry payment option

STEP 12: ORDER CONFIRMATION PAGE
GET /api/resource/Sales Order/{so_name}
Show: order number, items, total, estimated delivery
```

### 6.2 Order Status Mapping

| ERP Status | Display to Customer |
|-----------|---------------------|
| Draft + custom_payment_status=PENDING | "Payment Pending" |
| Draft + custom_payment_status=FAILURE | "Payment Failed — Please retry" |
| To Deliver and Bill | "Order Confirmed — Processing" |
| To Deliver and Bill + Delivery Note created | "Order Shipped" |
| Completed | "Order Delivered" |
| Cancelled | "Order Cancelled" |

### 6.3 Delivery Tracking

```
ERP Staff creates Delivery Note from Sales Order
Adds lr_no (AWB/tracking number) and transporter name

GET /api/resource/Delivery Note
  ?filters=[["against_sales_order","=","SAL-ORD-2026-XXXXX"]]
  &fields=["name","status","lr_no","lr_date","transporter","posting_date"]

Display to customer:
  Courier: {transporter}
  Tracking: {lr_no}
  Shipped on: {lr_date}
```

---

## PART 7 — WEBHOOK SETUP

Set up in ERPNext: Settings → Integrations → Webhook → New

### Recommended Webhooks

| # | DocType | Event | Send to Your Site | Purpose |
|---|---------|-------|-------------------|---------|
| 1 | Sales Order | on_submit | `/webhooks/erp/order-confirmed` | Order processing started |
| 2 | Delivery Note | on_submit | `/webhooks/erp/order-shipped` | Trigger tracking notification |
| 3 | Sales Invoice | on_submit | `/webhooks/erp/invoice-ready` | Send invoice to customer |
| 4 | Bin | after_save | `/webhooks/erp/stock-update` | Update product availability |
| 5 | Sales Order | on_cancel | `/webhooks/erp/order-cancelled` | Trigger refund flow |

### Sample Webhook Receiver

```javascript
// POST /webhooks/erp/order-shipped
app.post('/webhooks/erp/order-shipped', (req, res) => {
  const dn = req.body;
  const soName = dn.items?.[0]?.against_sales_order;
  
  if (soName && dn.lr_no) {
    // Update order in your DB
    await updateOrderTracking(soName, {
      courier: dn.transporter,
      trackingNumber: dn.lr_no,
      shippedDate: dn.lr_date,
      status: 'Shipped'
    });
    
    // Notify customer
    await sendWhatsApp(dn.contact_mobile,
      `Your order ${soName} has been shipped! Track: ${dn.lr_no}`);
  }
  
  res.json({ status: 'ok' });
});
```

---

## PART 8 — DATABASE SCHEMA REFERENCE

### 8.1 Table Names (MariaDB)

| DocType | Table Name |
|---------|-----------|
| Item | `tabItem` |
| Item Group | `tabItem Group` |
| Item Price | `tabItem Price` |
| Item Attribute | `tabItem Attribute` |
| Item Variant Attribute | `tabItem Variant Attribute` |
| Bin | `tabBin` |
| Customer | `tabCustomer` |
| Address | `tabAddress` |
| Contact | `tabContact` |
| Dynamic Link | `tabDynamic Link` |
| Sales Order | `tabSales Order` |
| Sales Order Item | `tabSales Order Item` |
| Delivery Note | `tabDelivery Note` |
| Sales Invoice | `tabSales Invoice` |
| Payment Entry | `tabPayment Entry` |
| Pricing Rule | `tabPricing Rule` |
| Coupon Code | `tabCoupon Code` |
| Warehouse | `tabWarehouse` |

### 8.2 Key Relationships

```
tabItem (parent)
  ↓ via variant_of
tabItem (variant) ←→ tabItem Variant Attribute (size, color)
  ↓
tabItem Price (price_list_rate per price_list)
  ↓
tabBin (actual_qty, reserved_qty per warehouse)

tabCustomer
  ↓ via tabDynamic Link (link_doctype="Customer")
tabAddress (shipping/billing)
tabContact (phone, email)

tabSales Order
  ↓ items → tabSales Order Item (item_code, qty, rate)
  ↓ taxes → tabSales Taxes and Charges
  ↓
tabDelivery Note (fulfillment, lr_no = tracking)
  ↓
tabSales Invoice (billing, GST amounts)
  ↓
tabPayment Entry (payment reconciliation)
```

---

## PART 9 — LIVE STOCK SAMPLES (From Stores - IESPL)

Current live stock showing valuation rates (your cost price):

| Item Code | Qty | Reserved | Available | Cost/Unit |
|-----------|-----|----------|-----------|-----------|
| QLS Boys ShirtJ34$$ | 69 | 23 | **46** | ₹215 |
| QLS Primary Half PantsK26B$ | 92 | 5 | **87** | ₹252 |
| QLS Primary Half PantsK28A$ | 92 | 4 | **88** | ₹252 |
| QLS Girls SkirtB24E$ | 69 | 3 | **66** | ₹352 |
| QLS BlazerM28$$ | 8 | 3 | **5** | ₹1,276 |
| QLS BlazerM42$$ | 15 | 1 | **14** | ₹1,452 |
| SAS BP Sports TrackB28$$ | 80 | 12 | **68** | ₹267 |
| SAS BP Sports TrackD44$$ | 32 | 11 | **21** | ₹267 |
| SAS BP SPORTS POLO T-SHIRTBL46$$ | 51 | 16 | **35** | ₹317 |
| SAS KS ShoesI5UK$ | 80 | 2 | **78** | ₹840 |
| SAS KS ShoesI12S$ | 44 | 0 | **44** | ₹840 |
| SMS 9-10 Girls SkirtM40$$ | 54 | 13 | **41** | ₹430 |
| SMS Sports PoloD42$$ | 84 | 5 | **79** | ₹306 |
| SMS Sports TrackA40$$ | 48 | 4 | **44** | ₹231 |
| Sharpener | 13,522 | 0 | **13,522** | ₹1.76 |
| Pencils (1 box) | 6,751 | 0 | **6,751** | ₹35 |
| Exploring Society Grade 7 Part-1 | 825 | 0 | **825** | ₹65 |
| SAS BP BeltL2XL$ | 9 | 45 | **-36** ⚠️ | ₹45 |
| Sports PoloA38$$ | 35 | 38 | **-3** ⚠️ | ₹340 |
| SAS BP Maroon T-ShirtL52$$ | 9 | 11 | **-2** ⚠️ | ₹352 |

⚠️ Items with negative available stock will still accept orders (backorders). Handle this in your site's UX.

---

## PART 10 — REUSABLE API CLIENT CODE

```javascript
// inventre-erp-client.js
// Complete ready-to-use client for your ecommerce backend

const BASE_URL = process.env.ERP_BASE_URL || 'https://erp.inventre.in';
const API_KEY = process.env.ERP_API_KEY;
const API_SECRET = process.env.ERP_API_SECRET;

const headers = {
  'Authorization': `token ${API_KEY}:${API_SECRET}`,
  'Content-Type': 'application/json'
};

async function erpGet(path, params = {}) {
  const url = new URL(BASE_URL + path);
  Object.entries(params).forEach(([k, v]) => {
    url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : v);
  });
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) throw new Error(`ERP GET ${path}: ${res.status}`);
  const data = await res.json();
  return data.data ?? data.message ?? data;
}

async function erpPost(path, body) {
  const res = await fetch(BASE_URL + path, {
    method: 'POST', headers, body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.exception || `ERP POST ${path}: ${res.status}`);
  return data.data ?? data.message ?? data;
}

async function erpPut(path, body) {
  const res = await fetch(BASE_URL + path, {
    method: 'PUT', headers, body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.exception || `ERP PUT ${path}: ${res.status}`);
  return data.data ?? data;
}

// ─── PRODUCTS ─────────────────────────────────────────────────────────────────

export const Products = {
  // Get all parent items for a school
  bySchool: (schoolName) => erpGet('/api/resource/Item', {
    filters: JSON.stringify([
      ['custom_school_name', 'like', `%${schoolName}%`],
      ['disabled', '=', 0],
      ['is_sales_item', '=', 1],
      ['has_variants', '=', 1]
    ]),
    fields: JSON.stringify([
      'name', 'item_name', 'item_group', 'image',
      'custom_size_chart', 'custom_school_name', 'custom_display_price',
      'custom_uniform_grade'
    ]),
    limit_page_length: 500
  }),

  // Get single item full details
  get: (itemCode) => erpGet(`/api/resource/Item/${encodeURIComponent(itemCode)}`),

  // Get all variants of a parent
  variants: (parentCode) => erpGet('/api/resource/Item', {
    filters: JSON.stringify([
      ['variant_of', '=', parentCode],
      ['disabled', '=', 0]
    ]),
    fields: JSON.stringify(['name', 'item_name', 'stock_uom']),
    limit_page_length: 100
  }),

  // Get price for a specific variant
  price: (itemCode, priceList = 'Standard Selling') =>
    erpGet('/api/resource/Item Price', {
      filters: JSON.stringify([
        ['item_code', '=', itemCode],
        ['price_list', '=', priceList],
        ['selling', '=', 1]
      ]),
      fields: JSON.stringify(['price_list_rate', 'currency', 'min_qty'])
    }),

  // Get stock for a variant
  stock: (itemCode, warehouse = 'Stores - IESPL') =>
    erpGet('/api/resource/Bin', {
      filters: JSON.stringify([
        ['item_code', '=', itemCode],
        ['warehouse', '=', warehouse]
      ]),
      fields: JSON.stringify(['actual_qty', 'reserved_qty', 'projected_qty'])
    }),

  // Check if in stock
  isAvailable: async (itemCode) => {
    const bins = await Products.stock(itemCode);
    if (!bins?.length) return false;
    return (bins[0].actual_qty - bins[0].reserved_qty) > 0;
  }
};

// ─── CUSTOMERS ───────────────────────────────────────────────────────────────

export const Customers = {
  findByPhone: (mobile) => erpGet('/api/resource/Customer', {
    filters: JSON.stringify([['mobile_no', '=', mobile]]),
    fields: JSON.stringify(['name', 'customer_name', 'email_id', 'mobile_no'])
  }),

  findByEmail: (email) => erpGet('/api/resource/Customer', {
    filters: JSON.stringify([['email_id', '=', email]]),
    fields: JSON.stringify(['name', 'customer_name', 'email_id', 'mobile_no'])
  }),

  create: (data) => erpPost('/api/resource/Customer', {
    customer_type: 'Individual',
    customer_group: 'Student',
    gst_category: 'Unregistered',
    ...data
  }),

  // Find or create customer
  findOrCreate: async ({ mobile, email, name }) => {
    let existing = [];
    if (mobile) existing = await Customers.findByPhone(mobile);
    if (!existing?.length && email) existing = await Customers.findByEmail(email);
    if (existing?.length) return existing[0];
    return Customers.create({ customer_name: name, mobile_no: mobile, email_id: email });
  },

  addresses: (customerName) => erpGet('/api/resource/Address', {
    filters: JSON.stringify([
      ['Dynamic Link', 'link_doctype', '=', 'Customer'],
      ['Dynamic Link', 'link_name', '=', customerName]
    ]),
    fields: JSON.stringify([
      'name', 'address_title', 'address_line1', 'address_line2',
      'city', 'state', 'country', 'pincode', 'phone'
    ])
  }),

  addAddress: (customerName, addr) => erpPost('/api/resource/Address', {
    address_type: 'Shipping',
    country: 'India',
    ...addr,
    links: [{ link_doctype: 'Customer', link_name: customerName }]
  })
};

// ─── ORDERS ──────────────────────────────────────────────────────────────────

export const Orders = {
  create: (data) => erpPost('/api/resource/Sales Order', {
    order_type: 'Shopping Cart',
    company: 'Inventre Edu Services Pvt Ltd',
    currency: 'INR',
    selling_price_list: 'Standard Selling',
    set_warehouse: 'Stores - IESPL',
    custom_payment_flow: 'ONLINE',
    custom_gateway_provider: 'CCAVENUE',
    custom_payment_status: 'PENDING',
    ...data
  }),

  updatePayment: (soName, paymentData) =>
    erpPut(`/api/resource/Sales Order/${soName}`, paymentData),

  submit: (soName) => erpPost('/api/method/frappe.client.submit', {
    doc: { doctype: 'Sales Order', name: soName }
  }),

  cancel: (soName) => erpPost('/api/method/frappe.client.cancel', {
    doc: { doctype: 'Sales Order', name: soName }
  }),

  get: (soName) => erpGet(`/api/resource/Sales Order/${soName}`),

  list: (customerName, page = 0) => erpGet('/api/resource/Sales Order', {
    filters: JSON.stringify([['customer', '=', customerName]]),
    fields: JSON.stringify([
      'name', 'transaction_date', 'grand_total', 'status',
      'delivery_status', 'billing_status', 'custom_payment_status',
      'custom_student_school', 'custom_student_grade', 'total_qty'
    ]),
    order_by: 'transaction_date desc',
    limit_page_length: 10,
    limit_start: page * 10
  }),

  getDelivery: (soName) => erpGet('/api/resource/Delivery Note', {
    filters: JSON.stringify([['against_sales_order', '=', soName]]),
    fields: JSON.stringify(['name', 'status', 'lr_no', 'lr_date', 'transporter', 'posting_date'])
  }),

  getInvoice: (soName) => erpGet('/api/resource/Sales Invoice', {
    filters: JSON.stringify([['Sales Invoice Item', 'sales_order', '=', soName]]),
    fields: JSON.stringify(['name', 'posting_date', 'grand_total', 'status', 'outstanding_amount'])
  })
};

// ─── CHECKOUT HELPERS ────────────────────────────────────────────────────────

export function getTaxTemplate(pincode) {
  // Telangana pincodes: 500000–536999
  const pin = parseInt(pincode, 10);
  return (pin >= 500000 && pin <= 536999)
    ? 'Output GST In-state - IESPL'
    : 'Output GST Out-state - IESPL';
}

export function generateGatewayOrderId(soName) {
  return `${soName}${Date.now().toString(16)}`;
}
```

---

## PART 11 — DATA QUALITY ISSUES TO FIX

| Issue | Count Affected | Impact | Fix |
|-------|---------------|--------|-----|
| Customers with no email | ~80% of 15,614 | Can't send emails | Collect on first login |
| Customers with no phone | Many | Can't do OTP login | Required at registration |
| Items with no `custom_display_price` | Most | No price to show | Run batch update or use Item Price |
| Items with no images | Most | Poor product pages | Upload product photos |
| Items with 0 `custom_size_chart` | Most | Parents can't size | Upload per item group |
| Negative stock on some items | ~15+ items | Overselling | Add backorder logic or disable |
| Some items in wrong item_group | e.g. SAM Belt in "Socks" group | Wrong category | Data cleanup |
| Orders created by "Guest" user | All online orders | No audit trail | Expected for ecommerce |

---

## PART 12 — SCHOOLS COMPLETE LIST

Based on custom_school_name field and item attributes found in your ERP:

| School | Item Prefix | Grades | Curriculum |
|--------|------------|--------|------------|
| Kidlink School (KLS) | KLS | 4–10 | — |
| QLS School | QLS | 1–10 | — |
| Samyuktha School (SAM/SAMYU) | SAM, SAMYU | 1–10 | — |
| SAS BP School | SAS BP | 1–12 | CBSE |
| SAS Keesara School | SAS KS, SAS Keesara | UKG–12 | CBSE |
| SAS Suchitra School | SAS SC, SMS | UKG–12 | CBSE |
| CAS LR School | CAS LR | 5–9 | CBSE + CIE |
| CAS NIBM School | CAS NIBM | 5–9 | CBSE + CIE |
| DL School | DLSU | — | — |
| Winmore Academy Jakkur | WM JK, Winmore Jakkur | UKG, 1–10 | — |
| Winmore Academy Whitefield | WM WF, Winmore Whitefield | UKG, 1–10 | — |
| TSUS School | TSUS | 12 | CBSE |

---

*Live audit of erp.inventre.in — ERPNext v15.88.1*  
*6,035 items · 15,614 customers · 23,436 orders · Generated: 2026-05-02*
