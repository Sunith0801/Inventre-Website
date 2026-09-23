# Data-Processing Addendum — SMS gateway services

**DRAFT — for counsel review.** Not yet signed. Version 0.1, [date].

This Addendum forms part of the commercial terms dated [date] (the "Agreement") between **Inventre** ([legal entity name], the "Customer") and **Arihant Global** ([legal entity name], the "Vendor") for the sending of SMS messages. Where this Addendum and the Agreement conflict, this Addendum prevails on the handling of personal data. Terms in bold have the meaning given in the Digital Personal Data Protection Act 2023 (the "Act") and the DPDP Rules 2025 (the "Rules").

## 1. Roles

The Customer is the **Data Fiduciary**. The Vendor is a **Data Processor** engaged under section 8(2) of the Act and processes personal data only on behalf of, and on the documented instructions of, the Customer.

## 2. Personal data and purpose

| Item | Detail |
|---|---|
| Data items | Mobile number of a parent or guardian; the text of the message, which for login messages contains a one-time password (OTP) and for other messages an order or service notification |
| Data principals | Parents and guardians of school children who use the Customer's storefront inventre.in |
| Purpose | Delivery of the message to the number given; delivery status reporting to the Customer |
| Duration | The term of the Agreement |

No other personal data is shared. The Vendor does not receive names, addresses, children's details or any payment data.

## 3. Processing only on instruction

The Vendor processes the personal data only to deliver the messages the Customer submits through the agreed API and to report delivery status. The Vendor does not use the numbers or the message content for any other purpose, including its own marketing, analytics beyond aggregate traffic statistics, profiling, resale or list-building, and does not contact the data principals except to deliver the Customer's messages.

## 4. Retention of message content

The Vendor deletes the **content** of each message (including any OTP) from its systems as soon as delivery is confirmed or finally failed, and in any case within **[N] days** of submission. The Vendor may keep **delivery logs** (mobile number, timestamp, message identifier, delivery status, error code, sender id) for no longer than **[N] days** as needed for delivery reporting, dispute resolution and telecom-regulatory (TRAI / DLT) record-keeping, and deletes them thereafter. Where a law or regulator requires a longer period, the Vendor informs the Customer of the period and the legal basis in writing.

## 5. Sub-processors

The Vendor does not engage any sub-processor (including telecom operators' aggregators and cloud hosting providers) to process the personal data without giving the Customer written notice of the sub-processor's identity and role at least **[30] days** in advance. The Customer may object on reasonable grounds. The Vendor's current sub-processors are listed in Schedule A. The Vendor imposes on each sub-processor written obligations no less protective than this Addendum and remains fully liable for their performance.

## 6. Security

The Vendor implements and maintains reasonable security safeguards (section 8(5) of the Act), including at a minimum: TLS for the API and any web console; API credentials issued per customer, stored hashed, and rotated on request; access to message data limited to named staff who need it, with individual accounts and access logging; encryption of message content at rest; malware protection and patching of the hosts; and prompt revocation of access for leavers. The Vendor informs the Customer before any change that materially reduces these safeguards.

## 7. Breach notification

The Vendor notifies the Customer at **it@inventre.in within 24 hours** of becoming aware of any actual or suspected personal-data breach affecting the Customer's data (unauthorised access, disclosure, loss or alteration), giving the nature of the breach, the data and numbers affected, the likely consequences and the measures taken. The Vendor then provides updates as facts emerge and cooperates so that the Customer can meet its own obligations to notify the Data Protection Board of India and affected data principals within the periods the Rules prescribe. The Vendor does not notify data principals or any authority about the Customer's data on its own initiative unless the law requires it, and then only after informing the Customer.

## 8. Deletion or return at the end

On termination or expiry of the Agreement, or earlier on the Customer's written instruction, the Vendor deletes all personal data of the Customer, including from backups as they age out, within **[30] days**, and confirms deletion in writing. If a law requires the Vendor to keep some delivery logs longer, it keeps only what the law requires, protects it under this Addendum, and deletes it when the period ends.

## 9. Audit and information

The Vendor makes available on request the information reasonably necessary to demonstrate compliance with this Addendum (including its current sub-processor list, security summary and retention settings) and allows the Customer or an independent auditor appointed by it to audit, no more than once a year unless a breach has occurred, on **[15] days'** notice, during business hours, subject to reasonable confidentiality terms.

## 10. Data location

The Vendor confirms that the personal data is stored and processed only on systems located in **India**, and that it will not transfer the data outside India without the Customer's prior written consent.

## 11. Assistance and liability

The Vendor assists the Customer, so far as it reasonably can, with requests from data principals (access, correction, erasure) that relate to the data the Vendor holds. Each party is responsible for its own compliance with the Act; the Vendor indemnifies the Customer against penalties and losses caused by the Vendor's breach of this Addendum, subject to the liability cap in the Agreement, which does not apply to breaches of clauses 3, 7 and 10 [counsel to confirm].

## Schedule A — Approved sub-processors

| Name | Role | Location |
|---|---|---|
| [ ] | [e.g. telecom aggregator] | [India] |

## Signatures

| For Inventre | For Arihant Global |
|---|---|
| Name: [ ] | Name: [ ] |
| Title: [ ] | Title: [ ] |
| Date: [ ] | Date: [ ] |
