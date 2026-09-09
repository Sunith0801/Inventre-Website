#!/usr/bin/env python3
"""Inventre platform overview deck — CEO strategic review.

Layout rule that matters: never hard-wrap body copy with \n AND rely on
word_wrap — the two compound and text spills its card. Long copy is passed as
one string and allowed to wrap; only short, deliberately-broken display lines
carry explicit newlines.
"""

from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.enum.dml import MSO_LINE_DASH_STYLE
from pptx.oxml.ns import qn

# ---------------------------------------------------------------- palette
INK       = RGBColor(0x0A, 0x0A, 0x0A)
INK_800   = RGBColor(0x16, 0x14, 0x0F)
INK_700   = RGBColor(0x26, 0x24, 0x1F)
INK_600   = RGBColor(0x3D, 0x3B, 0x35)
INK_500   = RGBColor(0x5C, 0x59, 0x50)
INK_400   = RGBColor(0x8A, 0x86, 0x78)
INK_300   = RGBColor(0xB8, 0xB5, 0xAB)
INK_200   = RGBColor(0xD9, 0xD7, 0xD0)
CREAM     = RGBColor(0xFA, 0xF7, 0xF2)
CREAM_200 = RGBColor(0xF2, 0xED, 0xE3)
WHITE     = RGBColor(0xFF, 0xFF, 0xFF)
BRAND     = RGBColor(0xE4, 0x71, 0x27)
BRAND_50  = RGBColor(0xFE, 0xF3, 0xEC)
BRAND_100 = RGBColor(0xFC, 0xE2, 0xD0)
BRAND_600 = RGBColor(0xC4, 0x5A, 0x18)
TEAL      = RGBColor(0x1F, 0x6F, 0x6B)
TEAL_50   = RGBColor(0xEC, 0xF5, 0xF4)

FONT = "Calibri"

W, H = Inches(13.333), Inches(7.5)
M = Inches(0.72)
CW = W - 2 * M
FOOT_Y = Inches(7.02)

prs = Presentation()
prs.slide_width, prs.slide_height = W, H
BLANK = prs.slide_layouts[6]
_n = {"i": 0}


# ---------------------------------------------------------------- helpers
def slide(bg=CREAM):
    s = prs.slides.add_slide(BLANK)
    r = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, W, H)
    r.fill.solid(); r.fill.fore_color.rgb = bg
    r.line.fill.background(); r.shadow.inherit = False
    return s


def tx(s, x, y, w, h, text, size=14, color=INK, bold=False, align=PP_ALIGN.LEFT,
       anchor=MSO_ANCHOR.TOP, italic=False, spacing=1.0):
    b = s.shapes.add_textbox(x, y, w, h)
    tf = b.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    for i, ln in enumerate(text.split("\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = spacing
        r = p.add_run(); r.text = ln
        f = r.font
        f.name, f.size, f.bold, f.italic = FONT, Pt(size), bold, italic
        f.color.rgb = color
    return b


def shape(s, kind, x, y, w, h, fill=None, line=None, lw=1.0, adj=None):
    sh = s.shapes.add_shape(kind, x, y, w, h)
    if fill is None:
        sh.fill.background()
    else:
        sh.fill.solid(); sh.fill.fore_color.rgb = fill
    if line is None:
        sh.line.fill.background()
    else:
        sh.line.color.rgb = line; sh.line.width = Pt(lw)
    sh.shadow.inherit = False
    if adj is not None:
        try:
            sh.adjustments[0] = adj
        except Exception:
            pass
    return sh


def card(s, x, y, w, h, fill=WHITE, line=INK_200):
    return shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h, fill, line, 1.0, 0.055)


def rule(s, x, y, w, color=BRAND, pt=2.5):
    ln = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, Pt(pt))
    ln.fill.solid(); ln.fill.fore_color.rgb = color
    ln.line.fill.background(); ln.shadow.inherit = False
    return ln


def head(s, kicker, title, sub=None, dark=False):
    tx(s, M, Inches(0.46), CW, Inches(0.24), kicker.upper(), 10.5, BRAND, True)
    tx(s, M, Inches(0.76), CW, Inches(0.52), title, 29, CREAM if dark else INK, True)
    y = Inches(1.36)
    if sub:
        tx(s, M, y, Inches(10.6), Inches(0.34), sub, 13.5, INK_400 if dark else INK_500)
        y = Inches(1.76)
    rule(s, M, y, Inches(0.9))
    return y + Inches(0.30)


def foot(s, dark=False):
    _n["i"] += 1
    c = INK_600 if dark else INK_300
    tx(s, M, FOOT_Y, Inches(8.0), Inches(0.22),
       "Inventre  ·  inventre.in  +  audit.inventre.in", 8.5, c)
    tx(s, W - M - Inches(1.0), FOOT_Y, Inches(1.0), Inches(0.22),
       f"{_n['i']:02d}", 8.5, c, True, PP_ALIGN.RIGHT)


def bullets(s, x, y, w, items, size=13, gap=0.42, dot=BRAND, color=INK_700):
    cy = y
    for it in items:
        shape(s, MSO_SHAPE.OVAL, x, cy + Inches(0.072), Inches(0.072), Inches(0.072), dot)
        if isinstance(it, tuple):
            b = s.shapes.add_textbox(x + Inches(0.23), cy - Inches(0.02), w - Inches(0.23), Inches(gap))
            tf = b.text_frame
            tf.word_wrap = True
            tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
            p = tf.paragraphs[0]; p.line_spacing = 1.2
            r1 = p.add_run(); r1.text = it[0] + "  "
            r1.font.name, r1.font.size, r1.font.bold = FONT, Pt(size), True
            r1.font.color.rgb = INK
            r2 = p.add_run(); r2.text = it[1]
            r2.font.name, r2.font.size = FONT, Pt(size)
            r2.font.color.rgb = color
        else:
            tx(s, x + Inches(0.23), cy - Inches(0.02), w - Inches(0.23), Inches(gap),
               it, size, color, spacing=1.2)
        cy += Inches(gap)
    return cy


def row_geom(n, bw):
    """Evenly distribute n boxes of width bw across the content width."""
    gap = (CW - n * bw) / (n - 1)
    return [M + int(i * (bw + gap)) for i in range(n)], gap


def arrow(s, x, y, w, h, color=BRAND_100):
    return shape(s, MSO_SHAPE.RIGHT_ARROW, x, y, w, h, color)


def flowbox(s, x, y, w, h, title, sub=None, fill=WHITE, line=INK_200,
            tcolor=INK, scolor=INK_500, tsize=13, ssize=9.5):
    card(s, x, y, w, h, fill, line)
    if sub:
        tx(s, x + Inches(0.1), y + Inches(0.2), w - Inches(0.2), Inches(0.28),
           title, tsize, tcolor, True, PP_ALIGN.CENTER)
        tx(s, x + Inches(0.1), y + Inches(0.56), w - Inches(0.2), h - Inches(0.66),
           sub, ssize, scolor, False, PP_ALIGN.CENTER, spacing=1.16)
    else:
        tx(s, x + Inches(0.1), y, w - Inches(0.2), h, title, tsize, tcolor, True,
           PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE)


def flowrow(s, y, h, steps, bw, arrow_col=BRAND_100, tsize=13, ssize=9.5):
    """steps: (title, sub, fill, line, title_color, sub_color)"""
    xs, gap = row_geom(len(steps), bw)
    for i, st in enumerate(steps):
        t, sb, f, ln, tc, sc = st
        flowbox(s, xs[i], y, bw, h, t, sb, f, ln, tc, sc, tsize, ssize)
        if i < len(steps) - 1:
            aw = min(Inches(0.4), gap - Inches(0.14))
            ax = xs[i] + bw + (gap - aw) / 2
            arrow(s, ax, y + h / 2 - Inches(0.09), aw, Inches(0.18), arrow_col)
    return xs, gap


def stat(s, x, y, w, h, num, label, fill=WHITE, line=INK_200, ncolor=INK, nsize=24,
         lcolor=INK_500):
    card(s, x, y, w, h, fill, line)
    tx(s, x + Inches(0.08), y + Inches(0.22), w - Inches(0.16), Inches(0.44),
       num, nsize, ncolor, True, PP_ALIGN.CENTER)
    tx(s, x + Inches(0.08), y + Inches(0.74), w - Inches(0.16), h - Inches(0.8),
       label, 9.5, lcolor, False, PP_ALIGN.CENTER, spacing=1.14)


def banner(s, y, h, title, body, fill=BRAND_50, line=BRAND_100,
           tcolor=INK, bcolor=BRAND_600, tsize=15, bsize=12.5):
    card(s, M, y, CW, h, fill, line)
    tx(s, M + Inches(0.38), y + Inches(0.18), CW - Inches(0.76), Inches(0.3), title, tsize, tcolor, True)
    tx(s, M + Inches(0.38), y + Inches(0.56), CW - Inches(0.76), h - Inches(0.66),
       body, bsize, bcolor, spacing=1.22)


def divider(num, title, sub, pts):
    s = slide(INK)
    tx(s, W - Inches(5.6), Inches(1.2), Inches(4.88), Inches(3.4), num, 190, INK_800, True, PP_ALIGN.RIGHT)
    tx(s, M, Inches(1.86), Inches(8.0), Inches(0.3), f"SECTION {num}", 11, BRAND, True)
    rule(s, M, Inches(2.44), Inches(1.3), BRAND, 3)
    tx(s, M, Inches(2.74), Inches(9.6), Inches(0.9), title, 40, CREAM, True)
    tx(s, M, Inches(3.78), Inches(8.2), Inches(0.4), sub, 15, INK_300)
    cy = Inches(4.62)
    for b in pts:
        shape(s, MSO_SHAPE.OVAL, M, cy + Inches(0.08), Inches(0.07), Inches(0.07), BRAND)
        tx(s, M + Inches(0.24), cy, Inches(9.4), Inches(0.3), b, 12.5, INK_300)
        cy += Inches(0.4)
    foot(s, dark=True)



# ================================================================ 01 TITLE
s = slide(INK)
shape(s, MSO_SHAPE.RECTANGLE, 0, 0, Inches(0.1), H, BRAND)
X = M + Inches(0.2)
tx(s, X, Inches(1.42), Inches(9), Inches(0.3), "BOARD & EXECUTIVE REVIEW  ·  JULY 2026", 11.5, BRAND, True)
tx(s, X, Inches(1.92), Inches(11), Inches(1.1), "INVENTRE", 74, CREAM, True)
tx(s, X, Inches(3.08), Inches(11), Inches(0.5), "Enterprise Platform — Architecture & Roadmap", 24, INK_300)
rule(s, X, Inches(3.84), Inches(1.4), BRAND, 3)
tx(s, X, Inches(4.22), Inches(11), Inches(0.4),
   "What runs today, and what we build next", 15, INK_400, italic=True)
trio = [("inventre.in", "eCommerce — live"), ("audit.inventre.in", "ERP — live"),
        ("Inventre NXT", "Intelligence — in build")]
for i, (a, b) in enumerate(trio):
    bx = X + i * Inches(3.72)
    card(s, bx, Inches(5.0), Inches(3.4), Inches(1.14), INK_800, BRAND if i < 2 else INK_700)
    tx(s, bx + Inches(0.28), Inches(5.22), Inches(2.9), Inches(0.28), a, 15,
       BRAND if i < 2 else INK_300, True)
    tx(s, bx + Inches(0.28), Inches(5.56), Inches(2.9), Inches(0.28), b, 11.5, INK_400)
tx(s, X, Inches(6.54), Inches(11), Inches(0.26),
   "Production figures in this deck were queried from the live systems on 20 July 2026.", 10, INK_600)

# ================================================================ 02 CONTENTS
s = slide()
y = head(s, "Contents", "What this deck covers")
items = [
    ("01", "The enterprise landscape", "Three platforms, and the systems that run today"),
    ("02", "How it runs today", "The journey of one order, end to end, across every system"),
    ("03", "Integration & security", "How the systems stay joined, and how they stay safe"),
    ("04", "Inventre NXT", "The intelligence layer we build next"),
    ("05", "Deployment & ownership", "Environments, live production numbers, and what Inventre owns"),
]
cy = y + Inches(0.1)
for n, t, d in items:
    card(s, M, cy, CW, Inches(0.82))
    shape(s, MSO_SHAPE.RECTANGLE, M, cy, Pt(3.5), Inches(0.82), BRAND)
    tx(s, M + Inches(0.36), cy + Inches(0.24), Inches(0.7), Inches(0.34), n, 17, BRAND, True)
    tx(s, M + Inches(1.16), cy + Inches(0.18), Inches(4.6), Inches(0.32), t, 15, INK, True)
    tx(s, M + Inches(1.16), cy + Inches(0.48), Inches(9.6), Inches(0.28), d, 11.5, INK_500)
    cy += Inches(0.94)
foot(s)

# ================================================================ 03 DIVIDER 1
divider("01", "The enterprise landscape", "Three platforms, one governed business.", [
    "Two platforms are live and carrying the business today",
    "The third — the intelligence layer — is in build",
    "Every external system they depend on, named and verified",
])

# ================================================================ 04 THREE PLATFORMS
s = slide()
y = head(s, "The landscape", "Three platforms, one business",
         "Each layer owns a different responsibility. Every large enterprise draws this same line.")
peo = ["Parents", "Students", "Schools", "Vendors", "Employees"]
pw = (CW - Inches(0.6)) / 5
for i, p in enumerate(peo):
    px = M + i * (pw + Inches(0.15))
    card(s, px, y, pw, Inches(0.46), CREAM_200, INK_200)
    tx(s, px, y + Inches(0.02), pw, Inches(0.4), p, 11.5, INK_600, True, PP_ALIGN.CENTER,
       MSO_ANCHOR.MIDDLE)
py = y + Inches(0.72)
plats = [
    ("INVENTRE eCOMMERCE", "Customer Experience", "31 modules  ·  live",
     "Orders · Registration · Payments · Catalogue · Cart · Tracking · Returns · Notifications", BRAND),
    ("INVENTRE ERP", "Business Operations", "24 modules  ·  live",
     "Warehouse · Inventory · Purchase · Finance · Call Centre · CRM · Master Data · Dispatch", TEAL),
    ("INVENTRE NXT", "Enterprise Intelligence", "12 modules  ·  in build",
     "Analytics · Dashboards · Predictions · Executive KPIs · Parent CRM · Vendor Management", INK_400),
]
cw3 = (CW - Inches(0.44)) / 3
for i, (t, sub, tag, body, col) in enumerate(plats):
    cx = M + i * (cw3 + Inches(0.22))
    live = i < 2
    card(s, cx, py, cw3, Inches(2.24), WHITE if live else None, col if live else INK_300)
    if not live:
        s.shapes[-1].line.dash_style = MSO_LINE_DASH_STYLE.DASH
    shape(s, MSO_SHAPE.RECTANGLE, cx, py, cw3, Pt(3.5), col)
    tx(s, cx + Inches(0.3), py + Inches(0.3), cw3 - Inches(0.6), Inches(0.3), t, 14.5,
       INK if live else INK_500, True)
    tx(s, cx + Inches(0.3), py + Inches(0.64), cw3 - Inches(0.6), Inches(0.26), sub, 11.5, INK_500)
    tx(s, cx + Inches(0.3), py + Inches(0.94), cw3 - Inches(0.6), Inches(0.24), tag.upper(), 9, col, True)
    tx(s, cx + Inches(0.3), py + Inches(1.28), cw3 - Inches(0.6), Inches(0.86), body, 10.5,
       INK_600 if live else INK_400, spacing=1.22)
by = py + Inches(2.54)
card(s, M, by, CW, Inches(0.86), BRAND_50, BRAND_100)
tx(s, M + Inches(0.4), by + Inches(0.16), CW - Inches(0.8), Inches(0.3),
   "eCommerce owns the customer. ERP owns operations. NXT will own the numbers.", 15, INK, True)
tx(s, M + Inches(0.4), by + Inches(0.52), CW - Inches(0.8), Inches(0.28),
   "The first two are live and carrying the business today. The third is the next build.", 12, BRAND_600)
foot(s)

# ================================================================ 05 SYSTEMS MAP
s = slide()
y = head(s, "The landscape", "The systems map — what runs today",
         "The ERP shell sits at the centre. Everything else plugs into it.")

COLW = (CW - 2 * Inches(0.62)) / 3
CX = [M, M + COLW + Inches(0.62), M + 2 * (COLW + Inches(0.62))]
RY = [y, y + Inches(1.48), y + Inches(3.14)]
RH = [Inches(1.34), Inches(1.52), Inches(1.34)]


def node(col, row, title, spec=None, tag=None, ghost=False, hub=False):
    """A box on the systems map. Returns its centre point for wiring."""
    x, ry, h = CX[col], RY[row], RH[row]
    fill = INK_800 if hub else (None if ghost else WHITE)
    line = BRAND if hub else (INK_300 if ghost else INK_200)
    c = card(s, x, ry, COLW, h, fill, line)
    if ghost:
        c.line.dash_style = MSO_LINE_DASH_STYLE.DASH
    pad = Inches(0.26)
    ty = ry + Inches(0.20)
    tx(s, x + pad, ty, COLW - 2 * pad, Inches(0.28), title,
       16 if hub else 13, BRAND if hub else (INK_400 if ghost else INK), True)
    ty += Inches(0.30 if hub else 0.26)
    if tag:
        tx(s, x + pad, ty, COLW - 2 * pad, Inches(0.22), tag.upper(),
           8.5, INK_500 if hub else (INK_300 if ghost else BRAND), True)
        ty += Inches(0.24)
    if spec:
        tx(s, x + pad, ty, COLW - 2 * pad, ry + h - ty - Inches(0.14), spec,
           9.5 if hub else 9, INK_300 if hub else (INK_400 if ghost else INK_600),
           italic=ghost, spacing=1.2)
    return (x + COLW / 2, ry + h / 2)


def wire(p1, p2, both=True, dashed=False):
    """Connector between two node centres; double-headed unless one-way."""
    cn = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT,
                                int(p1[0]), int(p1[1]), int(p2[0]), int(p2[1]))
    cn.line.color.rgb = INK_300 if dashed else BRAND_100
    cn.line.width = Pt(1.75)
    if dashed:
        cn.line.dash_style = MSO_LINE_DASH_STYLE.DASH
    ln = cn.line._get_or_add_ln()
    for tag_ in (("tailEnd", both), ("headEnd", True)):
        if not tag_[1]:
            continue
        e = ln.makeelement(qn("a:" + tag_[0]), {})
        e.set("type", "triangle"); e.set("w", "med"); e.set("len", "med")
        ln.append(e)
    cn.shadow.inherit = False
    s.shapes._spTree.remove(cn._element)
    s.shapes._spTree.insert(3, cn._element)
    return cn


hub = node(1, 1, "ERP Shell",
           "Python 3.11 · FastAPI + SQLAlchemy 2 + Alembic · PostgreSQL 16 · Redis · React 18 + Vite · "
           "Docker Compose behind nginx. 75 screens, 54 staff users.",
           "audit.inventre.in  ·  runs on", hub=True)

wire(hub, node(1, 0, "Cloud Hosting",
               "Two Ubuntu 24.04 LTS servers · Docker Compose · nginx + Certbot TLS · "
               "Cloudflare R2 · nightly database backup · Grafana",
               "runs on"), both=False)

wire(hub, node(0, 0, "Inventre OneDrive",
               "Five shared Excel workbooks — outward, bookkit, uniform, warehouse stock — "
               "polled on a timer over OAuth.",
               "microsoft graph  ·  live"))

wire(hub, node(2, 0, "ERPNext",
               "The upstream master. Frappe REST with token auth — items, customers "
               "and sales orders flow down from here.",
               "erp.inventre.in  ·  live"))

wire(hub, node(0, 1, "Cust Care",
               "Portal concern intake → CON- tickets · read-only view-as-parent for agents · "
               "WhatsApp bot and cloud telephony on Tata Tele.",
               "runs on"))

wire(hub, node(2, 1, "Website",
               "Next.js 15 + React 18 + TypeScript · Drizzle ORM · PostgreSQL 16 via pgbouncer · "
               "Redis 7 · CCAvenue payments · Node 20 in Docker",
               "inventre.in  ·  runs on"))

wire(hub, node(0, 2, "Zoho Inventory",
               "OAuth REST sync pulling purchase orders into the stock engine. "
               "2,231 POs across 249 vendors.",
               "purchase orders  ·  live"))

wire(hub, node(1, 2, "Couriers",
               "Ekart, DTDC, S-Rocket, XpressBees, Amazon, Porter and school drops — "
               "four of them book and track by API.",
               "eight dispatch channels"))

wire(hub, node(2, 2, "Inventre NXT",
               "The intelligence layer. Reads from every box on this page. In build.",
               "next", ghost=True), dashed=True)

tx(s, M, Inches(6.60), CW, Inches(0.24),
   "Also wired in:  MyClassBoard for student and fee sync  ·  Arihant Global SMS  ·  "
   "Office 365 SMTP for parent invoices  ·  Tata Tele WhatsApp and cloud telephony.", 9.5, INK_500)
tx(s, M, Inches(6.78), CW, Inches(0.24),
   "Solid lines are live, automated integrations. The dashed line is the platform we build next.",
   9.5, INK_400)
foot(s)

# ================================================================ 06 DIVIDER 2
divider("02", "How it runs today", "One order, every system, no re-entry.", [
    "The parent journey, from OTP login to delivery",
    "What the warehouse and finance do with that order",
    "Where a human still touches it — named honestly",
])

# ================================================================ 07 JOURNEY
s = slide()
y = head(s, "End to end", "The journey of one order",
         "One order crosses three systems. Almost none of it is re-keyed.")
lanes = [
    ("eCOMMERCE  ·  inventre.in", BRAND,
     ["Parent logs in by OTP", "Picks the school catalogue", "Cart, coupons, checkout",
      "Pays via CCAvenue", "Invoice raised, order confirmed"]),
    ("ERP  ·  audit.inventre.in", TEAL,
     ["Order arrives within seconds", "BOM-driven picking and packing", "Scan-verified sealed box",
      "Booked with the carrier", "Delivery and RTO monitored"]),
    ("NXT  ·  in build", INK_400,
     ["Every figure rolls up", "Trends and forecasts", "Executive dashboard"]),
]
ly = y
for t, col, steps in lanes:
    n = len(steps)
    lh = Inches(1.22)
    tx(s, M, ly, Inches(3.4), Inches(0.24), t.upper(), 9.5, col, True)
    bw = (CW - Inches(0.20) * (n - 1)) / n
    for i, st in enumerate(steps):
        bx = M + i * (bw + Inches(0.20))
        ghost = col == INK_400
        c = card(s, bx, ly + Inches(0.30), bw, Inches(0.78), None if ghost else WHITE,
                 INK_300 if ghost else INK_200)
        if ghost:
            c.line.dash_style = MSO_LINE_DASH_STYLE.DASH
        shape(s, MSO_SHAPE.RECTANGLE, bx, ly + Inches(0.30), Pt(3), Inches(0.78), col)
        tx(s, bx + Inches(0.18), ly + Inches(0.36), bw - Inches(0.3), Inches(0.66), st,
           10.5, INK_500 if ghost else INK_700, False, PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE, spacing=1.16)
    ly += lh
banner(s, ly - Inches(0.06), Inches(1.16),
       "Status flows back the other way, continuously.",
       "The parent sees live tracking, the warehouse sees a packed order, finance sees a reconciled "
       "invoice. Porter, local-vendor and school-drop consignments are the one leg still keyed in "
       "by hand.")
foot(s)

# ================================================================ 08 ECOM DEEP DIVE
s = slide()
y = head(s, "Deep dive  ·  01", "Inventre eCommerce",
         "Everything the parent and the student touch. 31 modules behind the admin backend.")
layers = [
    ("USERS", "Parent  ·  Student  ·  School admin", CREAM_200, INK_600),
    ("PORTAL", "Mobile-responsive web storefront  ·  OTP login  ·  role-based sessions", CREAM_200, INK_600),
]
cy = y
for t, b, f, c in layers:
    card(s, M, cy, CW, Inches(0.56), f, INK_200)
    tx(s, M + Inches(0.3), cy + Inches(0.06), Inches(1.3), Inches(0.44), t, 9.5, BRAND, True,
       PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE)
    tx(s, M + Inches(1.7), cy + Inches(0.06), CW - Inches(2.0), Inches(0.44), b, 11.5, c,
       False, PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE)
    cy += Inches(0.66)
tx(s, M, cy + Inches(0.04), Inches(1.3), Inches(0.24), "SERVICES", 9.5, BRAND, True)
svc = [("Catalogue", "Products · categories\nschool–grade mapping"),
       ("Cart", "Items · coupons\nMagic Box rules"),
       ("Orders", "Lifecycle · status\nhistory · exchanges"),
       ("Payments", "CCAvenue · UPI\ncards · netbanking"),
       ("Notifications", "SMS · email\norder milestones"),
       ("Tracking", "Shipment · delivery\nreturns and claims")]
sw = (CW - Inches(0.20) * 5) / 6
sy = cy + Inches(0.32)
for i, (t, b) in enumerate(svc):
    sx = M + i * (sw + Inches(0.20))
    card(s, sx, sy, sw, Inches(1.06))
    shape(s, MSO_SHAPE.RECTANGLE, sx, sy, sw, Pt(3), BRAND)
    tx(s, sx + Inches(0.14), sy + Inches(0.18), sw - Inches(0.28), Inches(0.26), t, 11.5, INK, True)
    tx(s, sx + Inches(0.14), sy + Inches(0.50), sw - Inches(0.28), Inches(0.5), b, 8.5, INK_500,
       spacing=1.16)
dy = sy + Inches(1.28)
card(s, M, dy, CW, Inches(0.5), INK_800, INK_700)
tx(s, M + Inches(0.3), dy, Inches(1.3), Inches(0.5), "DATA", 9.5, BRAND, True, PP_ALIGN.LEFT,
   MSO_ANCHOR.MIDDLE)
tx(s, M + Inches(1.7), dy, CW - Inches(2.0), Inches(0.5),
   "PostgreSQL 16 via pgbouncer  ·  Redis 7  ·  Cloudflare R2  ·  full activity audit trail",
   11.5, INK_300, False, PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE)
iy = dy + Inches(0.62)
tx(s, M, iy, Inches(1.5), Inches(0.24), "INTEGRATIONS", 9.5, BRAND, True)
ints = ["ERP bridge", "CCAvenue", "Arihant SMS", "Office 365 SMTP", "MyClassBoard", "ERPNext"]
iw = (CW - Inches(0.16) * 5) / 6
for i, t in enumerate(ints):
    ix = M + i * (iw + Inches(0.16))
    card(s, ix, iy + Inches(0.28), iw, Inches(0.42), BRAND_50, BRAND_100)
    tx(s, ix, iy + Inches(0.28), iw, Inches(0.42), t, 10, BRAND_600, True, PP_ALIGN.CENTER,
       MSO_ANCHOR.MIDDLE)
foot(s)

# ================================================================ 09 ERP DEEP DIVE
s = slide()
y = head(s, "Deep dive  ·  02", "Inventre ERP",
         "How the business runs day to day. 24 modules on a single data model.")
card(s, M, y, CW, Inches(0.6), INK_800, BRAND)
tx(s, M + Inches(0.36), y, CW - Inches(0.72), Inches(0.6),
   "ERP CORE   ·   order processing  ·  master data  ·  integration engine", 13, BRAND, True,
   PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE)
mods = [
    ("Warehouse", "Stock · packing · dispatch\nscan-verified sealed units"),
    ("Inventory", "Live sync · stock alerts\nnegative-stock flags"),
    ("Purchase", "PO management · Zoho mirror\n249 vendors · spend analytics"),
    ("Finance", "Parent invoices · GST reports\nMCB fee reconciliation"),
    ("Call Centre", "Multi-channel queue · SLA\nsupervisor view · follow-ups"),
    ("CRM", "Tickets · customer records\nschool relationships"),
    ("Master Data", "Students · schools · items\nBOMs · SKU mapping"),
    ("Reports", "11 built-in reports\nsales · GST · stock · aging"),
]
mw = (CW - Inches(0.22) * 3) / 4
my = y + Inches(0.76)
for i, (t, b) in enumerate(mods):
    mx = M + (i % 4) * (mw + Inches(0.22))
    myy = my + (i // 4) * Inches(1.26)
    card(s, mx, myy, mw, Inches(1.06))
    shape(s, MSO_SHAPE.RECTANGLE, mx, myy, mw, Pt(3), TEAL)
    tx(s, mx + Inches(0.22), myy + Inches(0.18), mw - Inches(0.44), Inches(0.26), t, 12.5, INK, True)
    tx(s, mx + Inches(0.22), myy + Inches(0.50), mw - Inches(0.44), Inches(0.5), b, 9, INK_500,
       spacing=1.18)
ky = my + Inches(2.62)
card(s, M, ky, CW, Inches(0.96), TEAL_50, INK_200)
tx(s, M + Inches(0.38), ky + Inches(0.16), CW - Inches(0.76), Inches(0.28),
   "What the ERP does that a generic system would not", 13.5, INK, True)
tx(s, M + Inches(0.38), ky + Inches(0.50), CW - Inches(0.76), Inches(0.36),
   "Magic Box composition and per-component fulfilment  ·  BOM-driven packing with mismatch detection  ·  "
   "aging-order intelligence from 0–3 to 91+ days  ·  dry-run parent invoicing before a single email goes out",
   10.5, INK_600, spacing=1.2)
foot(s)

# ================================================================ 10 DIVIDER 3
divider("03", "Integration & security", "Connected systems, governed data.", [
    "Every external system the platform depends on",
    "What happens when one of them is unavailable",
    "How access, isolation and audit are enforced",
])

# ================================================================ 11 INTEGRATION
s = slide()
y = head(s, "Integration", "Every external system, named",
         "Nine live integrations carry the business. One dispatch leg is still manual.")
groups = [
    ("MONEY & MESSAGING", BRAND, [
        ("CCAvenue", "Payments · PCI-DSS · card data never touches our servers"),
        ("Arihant Global", "DLT-registered SMS — OTP and order milestones"),
        ("Tata Tele", "WhatsApp Business bot and cloud telephony for the call centre"),
        ("Office 365", "SMTP for parent invoices, sent only after a dry run"),
    ]),
    ("MASTER DATA & STOCK", TEAL, [
        ("ERPNext", "Upstream master — items, customers, sales orders"),
        ("Zoho Inventory", "Purchase orders — 2,231 POs across 249 vendors"),
        ("Microsoft OneDrive", "Five shared workbooks polled over Graph OAuth"),
        ("MyClassBoard", "Student grade and school fee receivables"),
    ]),
]
cw2 = (CW - Inches(0.3)) / 2
for gi, (gt, col, rows) in enumerate(groups):
    gx = M + gi * (cw2 + Inches(0.3))
    tx(s, gx, y, cw2, Inches(0.24), gt, 9.5, col, True)
    ry = y + Inches(0.32)
    for t, d in rows:
        card(s, gx, ry, cw2, Inches(0.74))
        shape(s, MSO_SHAPE.RECTANGLE, gx, ry, Pt(3), Inches(0.74), col)
        tx(s, gx + Inches(0.26), ry + Inches(0.11), cw2 - Inches(0.5), Inches(0.26), t, 12, INK, True)
        tx(s, gx + Inches(0.26), ry + Inches(0.40), cw2 - Inches(0.5), Inches(0.3), d, 9.5, INK_500)
        ry += Inches(0.84)
cy = y + Inches(3.74)
tx(s, M, cy, CW, Inches(0.24), "DISPATCH  ·  EIGHT CHANNELS", 9.5, BRAND, True)
chans = [("Ekart", "20,146"), ("S-Rocket", "17,551"), ("DTDC", "16,590"), ("Amazon", "14,412"),
         ("To school", "7,422"), ("Porter", "6,037"), ("Local vendor", "2,220"), ("XpressBees", "317")]
chw = (CW - Inches(0.16) * 7) / 8
for i, (t, n) in enumerate(chans):
    cx = M + i * (chw + Inches(0.16))
    api = i in (0, 1, 2, 7)
    card(s, cx, cy + Inches(0.30), chw, Inches(0.72), WHITE if api else CREAM_200,
         BRAND_100 if api else INK_200)
    tx(s, cx, cy + Inches(0.40), chw, Inches(0.24), t, 10.5, INK if api else INK_500, True,
       PP_ALIGN.CENTER)
    tx(s, cx, cy + Inches(0.68), chw, Inches(0.24), n, 9, BRAND if api else INK_400, False,
       PP_ALIGN.CENTER)
tx(s, M, cy + Inches(1.12), CW, Inches(0.24),
   "Highlighted channels book and track by API. Amazon, school drops, Porter and local vendor are "
   "entered by hand — the one manual leg left in the chain.", 9.5, INK_400)
foot(s)

# ================================================================ 12 RELIABILITY
s = slide()
y = head(s, "Reliability", "Why nothing gets lost",
         "Each safety net below was built after a real incident, not in anticipation of one.")
nets = [
    ("Queued, never dropped", "Every order leaving the storefront is written to a durable queue "
     "before it is sent. If the ERP is unavailable, the queue holds and drains when it returns."),
    ("Retry with back-off", "Failed deliveries retry automatically on a widening interval. A stranded "
     "message raises an alert rather than sitting silent."),
    ("Independent sweepers", "Scheduled jobs re-check payments, settlements and shipment status "
     "against the source, healing anything the live path missed."),
    ("Three payment feeds", "Gateway response, status API and the daily settlement file are "
     "reconciled against each other — a captured payment cannot stay invisible."),
]
nw = (CW - Inches(0.44)) / 2
for i, (t, d) in enumerate(nets):
    nx = M + (i % 2) * (nw + Inches(0.44))
    ny = y + (i // 2) * Inches(1.50)
    card(s, nx, ny, nw, Inches(1.32))
    shape(s, MSO_SHAPE.RECTANGLE, nx, ny, Pt(3.5), Inches(1.32), BRAND)
    tx(s, nx + Inches(0.32), ny + Inches(0.2), nw - Inches(0.6), Inches(0.28), t, 14, INK, True)
    tx(s, nx + Inches(0.32), ny + Inches(0.56), nw - Inches(0.6), Inches(0.68), d, 11, INK_500,
       spacing=1.22)
by = y + Inches(3.20)
card(s, M, by, CW, Inches(1.24), INK_800, BRAND)
tx(s, M + Inches(0.4), by + Inches(0.2), CW - Inches(0.8), Inches(0.3),
   "The integration, marked against itself", 14.5, BRAND, True)
tx(s, M + Inches(0.4), by + Inches(0.56), CW - Inches(0.8), Inches(0.56),
   "The storefront counts 24,800 paid orders. The ERP, independently, counts 24,805 — and the revenue "
   "figure matches to the rupee. Five orders out of twenty-four thousand is the width of the gap.",
   12, INK_300, spacing=1.22)
foot(s, dark=True)

# ================================================================ 13 SECURITY
s = slide()
y = head(s, "Governance", "Security at every layer",
         "The platform handles payments, PII and minor data. None of this is bolted on.")
rows = [
    ("Authentication", "OTP for parents — no password is ever stored for a parent account. "
     "Admin accounts use email and a hashed password."),
    ("Authorisation", "Role-based access control across 8 admin roles, with read and write "
     "permissions set per module."),
    ("Data isolation", "School-scoped at the data layer. Cross-school access is prevented by the "
     "query itself, not by a UI check."),
    ("Payment security", "CCAvenue is PCI-DSS certified. Card data never reaches an Inventre server "
     "at any point in the flow."),
    ("Audit trail", "Every admin action, OTP event and payment transition is logged with actor and "
     "timestamp, and is queryable."),
    ("PII protection", "Student records are role-gated and encrypted at rest, with the most "
     "sensitive fields restricted to SuperAdmin."),
]
ry = y
for t, d in rows:
    card(s, M, ry, CW, Inches(0.68))
    shape(s, MSO_SHAPE.RECTANGLE, M, ry, Pt(3), Inches(0.68), BRAND)
    tx(s, M + Inches(0.32), ry, Inches(2.5), Inches(0.68), t, 12.5, INK, True, PP_ALIGN.LEFT,
       MSO_ANCHOR.MIDDLE)
    tx(s, M + Inches(3.0), ry, CW - Inches(3.3), Inches(0.68), d, 11, INK_500, False,
       PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE)
    ry += Inches(0.78)
foot(s)

# ================================================================ 14 DIVIDER 4
divider("04", "Inventre NXT", "The intelligence layer — the next build.", [
    "12 modules on one governed data model",
    "Reads from every system on the map; owns none of their jobs",
    "Turns two operational databases into one executive view",
])

# ================================================================ 15 NXT
s = slide()
y = head(s, "Roadmap  ·  in build", "Inventre NXT — the intelligence layer",
         "Not another application. The layer that makes the other two answer a single question.")
tx(s, M, y, Inches(2.0), Inches(0.24), "DATA SOURCES", 9.5, BRAND, True)
srcs = [("eCommerce", "Orders · customers\npayments · behaviour"),
        ("ERP", "Warehouse · inventory\nfinance · call centre"),
        ("External", "ERPNext · Zoho\nMyClassBoard · OneDrive")]
sw = (CW - Inches(0.44)) / 3
for i, (t, b) in enumerate(srcs):
    sx = M + i * (sw + Inches(0.22))
    card(s, sx, y + Inches(0.30), sw, Inches(0.80))
    shape(s, MSO_SHAPE.RECTANGLE, sx, y + Inches(0.30), sw, Pt(3), BRAND)
    tx(s, sx + Inches(0.26), y + Inches(0.44), sw - Inches(0.52), Inches(0.26), t, 12.5, INK, True)
    tx(s, sx + Inches(0.26), y + Inches(0.74), sw - Inches(0.52), Inches(0.4), b, 9, INK_500,
       spacing=1.16)
hy = y + Inches(1.24)
c = card(s, M, hy, CW, Inches(0.52), None, INK_300)
c.line.dash_style = MSO_LINE_DASH_STYLE.DASH
tx(s, M, hy, CW, Inches(0.52),
   "INTEGRATION HUB   ·   consolidation  ·  harmonisation  ·  governance  ·  scheduled sync",
   12, INK_500, True, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE)
ay = hy + Inches(0.62)
card(s, M, ay, CW, Inches(0.58), INK_800, BRAND)
tx(s, M, ay, CW, Inches(0.58),
   "GOVERNED DATA MODEL  +  ANALYTICS & PREDICTION ENGINE", 13.5, BRAND, True,
   PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE)
oy = ay + Inches(0.70)
tx(s, M, oy, Inches(2.0), Inches(0.24), "OUTPUTS", 9.5, BRAND, True)
outs = [("Executive dashboard", "One live view of revenue, orders and fulfilment"),
        ("KPI scorecards", "Per school, per category, per period"),
        ("Predictive alerts", "Demand, stock-out and aging-order warnings"),
        ("Decision support", "Trend analysis and what-if scenarios")]
ow = (CW - Inches(0.66)) / 4
for i, (t, b) in enumerate(outs):
    ox = M + i * (ow + Inches(0.22))
    cc = card(s, ox, oy + Inches(0.30), ow, Inches(0.94), None, INK_300)
    cc.line.dash_style = MSO_LINE_DASH_STYLE.DASH
    tx(s, ox + Inches(0.22), oy + Inches(0.44), ow - Inches(0.44), Inches(0.26), t, 11.5, INK_600, True)
    tx(s, ox + Inches(0.22), oy + Inches(0.74), ow - Inches(0.44), Inches(0.44), b, 9, INK_400,
       spacing=1.16)
banner(s, oy + Inches(1.38), Inches(0.88),
       "NXT does not replace anything on the systems map.",
       "It reads from them. eCommerce keeps the customer, ERP keeps operations — NXT makes the "
       "two agree.")
foot(s)

# ================================================================ 16 DIVIDER 5
divider("05", "Deployment & ownership", "What it runs on, what it carries, what you own.", [
    "Three environments, from development to production",
    "The live production figures behind every claim in this deck",
    "Full source-code ownership, no vendor lock-in",
])

# ================================================================ 17 DEPLOYMENT
s = slide()
y = head(s, "Deployment", "Three environments, one pipeline",
         "Nothing reaches a parent without passing through the two environments before it.")
envs = [("DEVELOPMENT", "Active build and integration", "Feature work · unit testing · isolated database"),
        ("STAGING / UAT", "Validation and sign-off", "Production-like data · acceptance testing · rehearsal"),
        ("PRODUCTION", "Live business operations", "SSL/TLS · reverse proxy · nightly backup · monitoring")]
ew = (CW - Inches(0.44)) / 3
for i, (t, sub, b) in enumerate(envs):
    ex = M + i * (ew + Inches(0.22))
    live = i == 2
    card(s, ex, y, ew, Inches(1.66), INK_800 if live else WHITE, BRAND if live else INK_200)
    shape(s, MSO_SHAPE.RECTANGLE, ex, y, ew, Pt(3.5), BRAND)
    tx(s, ex + Inches(0.3), y + Inches(0.3), ew - Inches(0.6), Inches(0.26), t, 12.5,
       BRAND if live else INK, True)
    tx(s, ex + Inches(0.3), y + Inches(0.64), ew - Inches(0.6), Inches(0.26), sub, 11,
       INK_300 if live else INK_500)
    tx(s, ex + Inches(0.3), y + Inches(1.00), ew - Inches(0.6), Inches(0.5), b, 9.5,
       INK_400 if live else INK_500, spacing=1.2)
    if i < 2:
        arrow(s, ex + ew + Inches(0.03), y + Inches(0.74), Inches(0.16), Inches(0.18), BRAND_100)
sy = y + Inches(1.94)
card(s, M, sy, CW, Inches(0.92), CREAM_200, INK_200)
tx(s, M + Inches(0.38), sy + Inches(0.16), CW - Inches(0.76), Inches(0.28),
   "Every environment carries the same shape", 13.5, INK, True)
tx(s, M + Inches(0.38), sy + Inches(0.50), CW - Inches(0.76), Inches(0.3),
   "Application server + PostgreSQL, on Linux, behind nginx with certificate-managed TLS, "
   "with a defined backup strategy and monitoring from day one.", 10.5, INK_600)
oy = sy + Inches(1.20)
tx(s, M, oy, CW, Inches(0.24), "WHAT INVENTRE OWNS AT HANDOVER", 9.5, BRAND, True)
own = ["Full source code — all three platforms", "Complete git history, transferred",
       "Database schema and documentation", "Deployment runbooks",
       "Structured knowledge-transfer sessions", "Perpetual licence · no recurring fee"]
ww = (CW - Inches(0.44)) / 3
for i, t in enumerate(own):
    wx = M + (i % 3) * (ww + Inches(0.22))
    wy = oy + Inches(0.32) + (i // 3) * Inches(0.52)
    card(s, wx, wy, ww, Inches(0.44), BRAND_50, BRAND_100)
    tx(s, wx + Inches(0.24), wy, ww - Inches(0.4), Inches(0.44), t, 10.5, BRAND_600, False,
       PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE)
foot(s)

# ================================================================ 18 SCALE
s = slide(INK)
tx(s, M, Inches(0.46), CW, Inches(0.24), "LIVE PRODUCTION SCALE", 10.5, BRAND, True)
tx(s, M, Inches(0.76), CW, Inches(0.52), "The platform today", 29, CREAM, True)
tx(s, M, Inches(1.36), Inches(10.6), Inches(0.34),
   "Every figure below was queried from the production databases on 20 July 2026.", 13.5, INK_400)
rule(s, M, Inches(1.76), Inches(0.9))
sw = (CW - Inches(0.88)) / 5
sh_ = Inches(1.28)
rows = [
    [("₹14.53 Cr", "collected from paid orders"), ("28,835", "orders placed all-time"),
     ("24,800", "orders paid and confirmed"), ("18,692", "orders delivered to date"),
     ("589", "orders in the busiest single day")],
    [("24,202", "parent accounts"), ("28,836", "students on the platform"),
     ("21", "schools served"), ("24,434", "carrier tracking numbers issued"),
     ("1,996", "exchanges handled")],
]
for r, row in enumerate(rows):
    for i, (n, l) in enumerate(row):
        px = M + i * (sw + Inches(0.22))
        py = Inches(2.18) + r * (sh_ + Inches(0.24))
        hi = (r == 0 and i == 0)
        card(s, px, py, sw, sh_, BRAND if hi else INK_800, BRAND if hi else INK_700)
        tx(s, px + Inches(0.08), py + Inches(0.22), sw - Inches(0.16), Inches(0.42), n,
           25 if hi else 23, WHITE if hi else CREAM, True, PP_ALIGN.CENTER)
        tx(s, px + Inches(0.08), py + Inches(0.72), sw - Inches(0.16), Inches(0.5), l,
           9.5, BRAND_100 if hi else INK_400, False, PP_ALIGN.CENTER, spacing=1.14)
ny = Inches(5.2)
card(s, M, ny, CW, Inches(1.4), INK_800, BRAND)
tx(s, M + Inches(0.4), ny + Inches(0.2), CW - Inches(0.8), Inches(0.3),
   "This is not a pilot", 15, BRAND, True)
tx(s, M + Inches(0.4), ny + Inches(0.58), CW - Inches(0.8), Inches(0.7),
   "Two platforms are already carrying the entire business — 21 schools, 24,202 families, "
   "₹14.53 crore collected, a peak of 589 orders absorbed in a single day without a manual step. "
   "NXT is the layer that turns all of that into one number leadership can act on.",
   12.5, INK_300, spacing=1.22)
foot(s, dark=True)

# ================================================================ 19 NEXT STEPS
s = slide()
y = head(s, "In closing", "One platform, wholly owned",
         "Two systems live, a third in build, and every line of it Inventre's own.")
cw3 = (CW - Inches(0.44)) / 3
sums = [
    ("What runs today", "A storefront and an ERP joined by an integration neither side waits on — "
     "carrying 21 schools and ₹14.53 crore, with nine live external systems behind them."),
    ("What we build next", "Inventre NXT: 12 modules on one governed data model, reading from every "
     "system on the map to give leadership a single, current view of the business."),
    ("What Inventre owns", "All three platforms, in full source, with the git history, the schema, "
     "the runbooks and the knowledge transfer. No lock-in and no recurring licence."),
]
for i, (t, d) in enumerate(sums):
    cx = M + i * (cw3 + Inches(0.22))
    card(s, cx, y, cw3, Inches(2.3))
    shape(s, MSO_SHAPE.RECTANGLE, cx, y, cw3, Pt(3.5), BRAND)
    tx(s, cx + Inches(0.32), y + Inches(0.3), cw3 - Inches(0.64), Inches(0.3), t, 15.5, INK, True)
    tx(s, cx + Inches(0.32), y + Inches(0.74), cw3 - Inches(0.64), Inches(1.4), d, 11.5, INK_500,
       spacing=1.26)
ny = y + Inches(2.6)
tx(s, M, ny, CW, Inches(0.24), "NEXT STEPS", 9.5, BRAND, True)
steps = [("01", "Review", "Board and executive alignment on the architecture"),
         ("02", "Walkthrough", "Live demonstration of both production systems"),
         ("03", "Confirm", "Scope and sequence for the NXT build"),
         ("04", "Commence", "Kick off delivery against an agreed timeline")]
stw = (CW - Inches(0.66)) / 4
for i, (n, t, d) in enumerate(steps):
    sx = M + i * (stw + Inches(0.22))
    card(s, sx, ny + Inches(0.32), stw, Inches(1.22), INK_800, INK_700)
    tx(s, sx + Inches(0.24), ny + Inches(0.46), stw - Inches(0.48), Inches(0.24), n, 11, BRAND, True)
    tx(s, sx + Inches(0.24), ny + Inches(0.70), stw - Inches(0.48), Inches(0.26), t, 13, CREAM, True)
    tx(s, sx + Inches(0.24), ny + Inches(0.98), stw - Inches(0.48), Inches(0.3), d, 9, INK_400,
       spacing=1.16)
foot(s)

out = "/root/Inventre/Inventre_Enterprise_Platform_Merged.pptx"
prs.save(out)
print("saved:", out, "| slides:", len(prs.slides._sldIdLst))
