/**
 * Canonical Terms & Conditions content shown in the first-time login
 * acceptance modal. Source: WEBSITE Privacy Policy T and C and FAQ.docx
 * (the T&C section — Shipping/Exchange/Returns/Force Majeure).
 *
 * Versioning: bump TC_VERSION whenever any wording below changes. The
 * accepted version is persisted on parents.tc_accepted_version so we can
 * re-prompt users when policy revisions go out.
 */

export const TC_VERSION = "2026-05-25";

export type TcSection = {
  heading: string;
  paragraphs: string[];
};

export const TC_SECTIONS: TcSection[] = [
  {
    heading: "Shipping Policy",
    paragraphs: [
      "Invent’re strives to ensure that the products are delivered in the shortest time possible (subject to transit conditions and provision of correct PIN code, also availability).",
      "As all orders are pre-orders, delivery timelines will be communicated after order placement based on the processing schedule. Placing of the order does not imply that the delivery would be made forthwith.",
      "While we have a robust logistic network, there could be rare instances wherein the order could get delayed due to circumstances beyond our control. In such instances Invent’re strives to ensure necessary updates are provided to you.",
    ],
  },
  {
    heading: "7 Days Exchange Guarantee",
    paragraphs: [
      "Our aim at Invent're is to ensure that our customer is fully satisfied with the product fit. We guarantee the exchange of any product, for whatever reason, within a period of 7 days from the date of delivery.",
      "The product you wish to return must be unused and unwashed and the tags intact. It must be in the same condition as you received it, in its original packaging, to be exchangeable. Altered, washed, soiled or damaged products will not be accepted.",
      "Invent're reserves the right to reject any exchange request if the product appears to have been used.",
    ],
  },
  {
    heading: "Incorrect Product / Size / Colour Change",
    paragraphs: [
      "If you receive a different product from what you ordered, we will exchange it free of cost if intimated within 7 days of receipt. Initiate the exchange/return on the Invent’re website, or reach our customer care on +91 9059990804.",
      "If you have ordered the wrong size or colour, an exchange request can be placed through the website within 7 days of receipt. We will exchange the size/colour as we receive your order.",
      "Please note: we are unable to exchange one product for a different product.",
    ],
  },
  {
    heading: "Exchange Time Frame & Procedure",
    paragraphs: [
      "We have created Drop-off Locations (Schools) where you can drop exchangeable products once you have initiated the exchange request on the website within 7 days of delivery. In certain cases we may use our delivery partners to pick up the product.",
      "Approximate timeline for any exchange is typically 12 to 15 working days; we try our best to ensure the exchange product reaches you at the earliest.",
      "For any queries, refer to the exchange policy or contact customer care on +91 9059990804. Kindly quote your Customer Order Number in every communication.",
    ],
  },
  {
    heading: "Returns",
    paragraphs: [
      "Only exchanges are allowed. Refunds are not offered; products that meet the 7-day exchange criteria above can be swapped for the same item in a different size or colour.",
    ],
  },
  {
    heading: "Delivery Delays (Force Majeure & Third-Party Logistics)",
    paragraphs: [
      "While Invent’re maintains a robust logistics network, delivery timelines are estimates and may vary due to factors beyond its control. Invent’re shall not be held liable for any delay in delivery where the same is attributable to third-party logistics and/or delivery service providers (including courier, shipping and fulfilment partners) or due to circumstances beyond its reasonable control, including but not limited to transportation disruptions, strikes, operational constraints, weather conditions, regulatory restrictions, or any other unforeseen circumstances.",
      "In such events Invent’re shall make reasonable efforts to facilitate delivery at the earliest possible time. By placing an order, the customer acknowledges and agrees that Invent’re shall not be responsible for delays arising from such external factors.",
    ],
  },
];

/**
 * The required checkbox items the user must tick on the first-time
 * acceptance modal. Keep these short — full body lives in TC_SECTIONS.
 */
export const TC_REQUIRED_CHECKS = [
  {
    id: "terms",
    label: "I have read and agree to the Terms & Conditions above (shipping, 7-day exchange, returns, delivery).",
  },
  {
    id: "privacy",
    label: "I consent to Invent’re processing my personal information per the Privacy Policy and receiving order/account communications via SMS, Email, Call or WhatsApp.",
  },
] as const;
