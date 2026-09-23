/**
 * Canonical Privacy Notice content for the storefront (/privacy).
 *
 * Written for parents, in plain English, per the Digital Personal Data
 * Protection Act 2023 (DPDP). Structured so the page and any future
 * re-consent prompt render the same words.
 *
 * Versioning: bump PRIVACY_VERSION whenever any wording below changes.
 */

export const PRIVACY_VERSION = "2026-09-24";

export const GRIEVANCE_OFFICER = {
  name:
    process.env.NEXT_PUBLIC_GRIEVANCE_OFFICER_NAME ||
    "Grievance Officer (to be appointed)",
  email: process.env.NEXT_PUBLIC_GRIEVANCE_OFFICER_EMAIL || "privacy@inventre.in",
  /** Target response time, in working days. */
  responseDays: 7,
} as const;

export type PrivacySection = {
  id: string;
  title: string;
  /** Free-text paragraphs, shown before the bullets (if any). */
  paragraphs: string[];
  /** Optional bullet list, shown after the paragraphs. */
  bullets?: string[];
  /** Optional closing note, shown after the bullets. */
  note?: string;
};

export const PRIVACY_SECTIONS: PrivacySection[] = [
  {
    id: "who-we-are",
    title: "Who we are",
    paragraphs: [
      "Inventre runs the school kit storefront you are using: the place where you see your child's uniform, books and essentials, order them and have them delivered. This notice explains what personal information we hold about you and your child, why, and what you can do about it.",
      "For the storefront, Inventre decides how your information is used, so under the Digital Personal Data Protection Act 2023 we are the \"data fiduciary\" — the party responsible for it.",
      "Some schools also use Inventre to view their fee ledgers. For that service we only process the school's data on the school's instructions; the school remains responsible for it, and any question about fee records should go to the school first.",
    ],
  },
  {
    id: "what-we-collect",
    title: "What we collect",
    paragraphs: [
      "We keep only what is needed to deliver the right kit to the right child and to keep a proper record of it.",
    ],
    bullets: [
      "About you (the parent or guardian): your name, your mobile number (this is your login identity), your email address and the delivery addresses you give us.",
      "About your child: name, school, grade/class and section, enrolment number, gender (needed to show the correct uniform), date of birth (shown on your account so you can confirm it is the right child) and uniform sizes.",
      "Your orders and payments. We never store card details — CCAvenue, our payment gateway, handles cards, UPI and net banking. We keep only the payment reference and status.",
      "Exchange and missing-item requests you raise, and any photos you attach to them.",
      "Support conversations with our team, by phone, WhatsApp, email or the contact form.",
      "OTP delivery records (which number an OTP was sent to, when, and whether it was delivered), so we can trace login problems.",
      "For school fee-desk users only: school fee ledger data that the school makes available from its MyClassBoard system.",
    ],
    note: "Photos you attach to a request are stored on a content-delivery link that is not guessable but can be opened by anyone who has the exact link; do not include anything in a photo you would not want the warehouse team to see.",
  },
  {
    id: "where-it-comes-from",
    title: "Where it comes from",
    paragraphs: [],
    bullets: [
      "From your child's school. The school shares its roster (student name, grade, section, enrolment number, gender, date of birth and the parent's contact details) with us so we can set up your account for the kit programme. The school has your consent to do this.",
      "From you, when you log in, place an order, add an address, raise a request or contact support.",
      "From the payment gateway, which tells us whether a payment succeeded or failed.",
    ],
  },
  {
    id: "why-we-use-it",
    title: "Why we use it",
    paragraphs: ["We use your information only for these purposes:"],
    bullets: [
      "Showing your child the right kit: the correct school, grade and uniform options.",
      "Delivering your order to your address or to the school, and keeping you informed about it by SMS, email, call or WhatsApp.",
      "Taking payment and issuing invoices.",
      "Handling exchanges, missing-item requests and other support.",
      "Providing the fee ledger service to schools that have asked for it.",
      "Keeping the records that tax and company law require us to keep.",
    ],
  },
  {
    id: "children",
    title: "Children",
    paragraphs: [
      "Children never log in to Inventre. The only account is the parent's or guardian's, verified by a one-time password sent to the mobile number the school holds for you.",
      "We do not advertise to children, we do not track them and we do not build behavioural profiles of them. Product suggestions in the storefront are based on price and the school's kit list, never on browsing behaviour.",
    ],
  },
  {
    id: "who-we-share-with",
    title: "Who we share it with",
    paragraphs: [
      "We never sell your information. We share it only with the services that help us deliver your order, and only as much as each one needs:",
    ],
    bullets: [
      "Our fulfilment and warehouse system (Audit ERP), operated for Inventre, which packs and tracks your order.",
      "The SMS gateway that delivers one-time passwords and order messages.",
      "CCAvenue, which processes your payment.",
      "Courier partners, who receive the delivery name, address and phone number.",
      "Cloudflare, which stores product images and the photos attached to requests.",
      "Microsoft 365, which holds our encrypted backups.",
      "Your child's school, which can see the orders placed for its students.",
    ],
  },
  {
    id: "how-long-we-keep-it",
    title: "How long we keep it",
    paragraphs: ["We keep information only as long as it is needed:"],
    bullets: [
      "OTP delivery records: 90 days.",
      "Orders and invoices: 8 years, as tax law requires.",
      "Accounts with no activity: reviewed after 3 years.",
      "Students who have left the school: 1 year after leaving.",
      "Photos attached to exchange or missing-item requests: 180 days after the request is closed.",
      "Staff activity logs: 2 years.",
    ],
  },
  {
    id: "how-we-protect-it",
    title: "How we protect it",
    paragraphs: [],
    bullets: [
      "Everything between your device and Inventre travels over an encrypted connection (TLS).",
      "Passwords are stored as one-way hashes; nobody at Inventre can read them.",
      "Backups are encrypted before they leave the server.",
      "Staff see only what their role needs; access is role-based.",
      "Staff actions in the admin system are logged and reviewed.",
    ],
  },
  {
    id: "your-rights",
    title: "Your rights",
    paragraphs: [
      "Under the Digital Personal Data Protection Act 2023 you can:",
    ],
    bullets: [
      "Get a copy of your information: Account → Download my data.",
      "Correct it: change your name, email, phone number and addresses in the app. School, grade and section come from the school's roster, so ask the school to correct those.",
      "Erase it: Account → Request account deletion, or write to the grievance officer. We will delete everything except the records the law requires us to keep (such as invoices).",
      "Withdraw your consent: the same way. Note that without your consent we cannot deliver the kit programme for your child.",
      "Nominate someone to exercise these rights for you if you are unable to.",
      "Complain: to our grievance officer first, and if you are not satisfied with our answer, to the Data Protection Board of India.",
    ],
  },
  {
    id: "grievance-officer",
    title: "Grievance officer",
    paragraphs: [
      `Questions, requests and complaints about your information go to our grievance officer, who will respond within ${GRIEVANCE_OFFICER.responseDays} working days.`,
    ],
  },
  {
    id: "changes",
    title: "Changes to this notice",
    paragraphs: [
      `This is version ${PRIVACY_VERSION} of the notice. If we change it in a way that matters to you, we will ask you to read and accept the new version the next time you log in. Small wording changes will simply be published here with a new date.`,
    ],
  },
];
