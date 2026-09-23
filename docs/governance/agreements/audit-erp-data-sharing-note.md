# Internal Data-Sharing Note — Inventre storefront and the Audit ERP

**DRAFT — for counsel review.** Not yet signed. Version 0.1, [date].

| | |
|---|---|
| Between | Inventre ([legal entity name]), operator of the school-kit storefront inventre.in ("Inventre") |
| And | The Audit ERP team ([legal entity / department name]), operator of the fulfilment and warehouse system on host [host name / IP] ("Audit ERP") |
| Relationship | Same company group. Inventre is the **Data Fiduciary** under the Digital Personal Data Protection Act 2023 ("the Act"). The Audit ERP processes the data below only on Inventre's instructions, as a **Data Processor** (s.8(2)). |
| Owner of this note | [Name], Inventre ([owner e-mail]) |
| Counterpart | [Name], Audit ERP team ([e-mail]) |
| Reference | Inventre Data Protection document v1.2, Sections 2, 4, 6 and 7; finding P-07 |

## 1. Purpose

Inventre sends order and student data to the Audit ERP so that school kits can be picked, packed, shipped and delivered, and so that the call centre can help parents with exchange, missing-item and concern requests. This note records what is shared, what it may be used for, and how each side protects it. It is an internal arrangement; it does not create a separate contract with any parent or school.

## 2. Data items shared

The Audit ERP receives, per order and per request, only the following (from Section 4 of the Data Protection document):

- **The child:** full name, school, grade / class, section, enrolment number, and where the school recorded one, the student mobile and e-mail. Date of birth, blood group and profile picture are **not** sent.
- **The guardians:** guardian names and mobile numbers (including the alternate number where held).
- **Delivery:** receiver name and phone, address lines, city, pincode, landmark; GSTIN and company name for B2B orders.
- **The order:** order number, items, sizes, colours, quantities, bundle contents, amounts, payment status, cancellation reason.
- **Requests:** exchange, missing-item and concern requests with the parent's free-text description, staff decisions and links to the photos the parent uploaded (Cloudflare R2, unguessable public links).
- **Support sessions:** the Audit ERP may request a short-lived, read-only "view as parent" session for a named agent to see exactly what the parent sees; every write is blocked at the edge and every mint is logged.

Nothing else. If the Audit ERP needs a new field, the request goes to the Inventre owner in writing and this note is updated first.

## 3. Permitted uses

1. **Fulfilment:** picking, packing, ground-stock and bin allocation, courier booking, delivery confirmation, returns and re-shipment.
2. **Call centre:** answering parents' calls and tickets about their own orders and requests; recording the outcome back to Inventre through the existing integration.
3. **Reconciliation and reporting** inside the group for the kit programme (stock, dispatch, service levels), using aggregates wherever a child's or parent's identity is not needed.

Not permitted: marketing or promotional contact of any kind; profiling or behavioural monitoring of children (s.9 of the Act); combining the data with any other data set for a new purpose; use for any school or product outside the kit programme.

## 4. No onward sharing

The Audit ERP does not disclose the data to any third party except (a) courier partners, limited to the receiver name, phone, address and parcel details needed to deliver, and (b) any party Inventre approves in writing in advance. Courier partners in use today are listed in the Audit ERP's own integrations register; changes are notified to Inventre before go-live.

## 5. Security expectations

- **Host hardening:** key-only SSH, firewall on all service ports, fail2ban, OS patching, no shared root accounts; the same standard applied to the Inventre host after the June 2026 compromise.
- **Access by named staff only:** each Audit ERP user is a named person with their own login; access is granted by role and removed within one working day of the person leaving or changing role. A list of users with access to student and guardian data is kept and shared with Inventre on request.
- **Integration security:** all traffic between the two systems is over TLS; inbound webhooks and events are HMAC-signed with the shared secret already in place, and unsigned or stale events are rejected. Service tokens are rotated at least annually and immediately after any suspected exposure.
- **No copies outside the system:** no exports of student or guardian data to personal devices, spreadsheets, chat apps or e-mail except where the workflow requires it and the copy is deleted when the task is done.
- **Logging:** access to and changes of personal data are logged in the Audit ERP and kept for at least [12] months.

## 6. Retention

The Audit ERP keeps the data no longer than Inventre does. It mirrors Section 6 of the Data Protection document, in particular: order and invoice records for 8 years from the financial-year end (GST and Income-tax law), then the parent link and address are anonymised; student records for 1 year after the roster shows the child has left, then name and identifiers are anonymised; photo references for exchange, missing and concern requests blanked 180 days after the request closes; logs for 2 years online. When Inventre changes its schedule, it tells the Audit ERP and the Audit ERP follows within [30] days.

## 7. Breach notification

Any actual or suspected unauthorised access, disclosure, loss or alteration of the data on the Audit ERP side is reported to **it@inventre.in within 24 hours** of discovery, with what is known so far (what happened, which data, how many records, what has been done). The Audit ERP team then cooperates with Inventre's breach procedure (docs/runbooks/breach-response.md), because Inventre must notify the Data Protection Board and affected parents within the time the DPDP Rules 2025 prescribe.

## 8. Deletion and correction on request

When Inventre instructs the Audit ERP to delete or correct a record (for example after a parent's erasure request or a roster correction), the Audit ERP does so within [7] working days, including in its own backups as they age out, and confirms in writing. On termination of this arrangement all data is returned or deleted as Inventre instructs, and deletion is confirmed.

## 9. Review

This note is reviewed **annually** by both signatories, and sooner if the data items, the integration or the law changes. Next review: [date].

## Signatures

| For Inventre | For the Audit ERP team |
|---|---|
| Name: [ ] | Name: [ ] |
| Title: [ ] | Title: [ ] |
| Date: [ ] | Date: [ ] |
