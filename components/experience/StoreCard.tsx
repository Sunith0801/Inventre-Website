"use client";

import { motion } from "framer-motion";
import {
  MapPin,
  Phone,
  Building2,
  ExternalLink,
  Copy,
  Check,
  CalendarCheck,
} from "lucide-react";
import { useState } from "react";

const ADDRESS = {
  storeName: "Inventre Store",
  mall: "Ashoka One Mall",
  unit: "3rd Floor, Unit 135",
  pillar: "Pillar No. 835, Y-Junction",
  area: "Habeeb Nagar, Kukatpally",
  city: "Hyderabad, Telangana 500072",
  phone: "+91 70757 85732",
};

export function StoreCard() {
  const [copied, setCopied] = useState(false);
  const fullAddress = `${ADDRESS.storeName}, ${ADDRESS.unit}, ${ADDRESS.mall}, ${ADDRESS.pillar}, ${ADDRESS.area}, ${ADDRESS.city}`;

  const copyAddress = async () => {
    await navigator.clipboard.writeText(fullAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section
      id="address"
      className="bg-cream-200 border-y border-ink-100 scroll-mt-24"
    >
      <div className="mx-auto max-w-7xl px-5 lg:px-8 py-16 lg:py-24">
        <div className="grid lg:grid-cols-[1fr_1.2fr] gap-6 lg:gap-10">
          {/* Address card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6 }}
            className="rounded-2xl border border-ink-100 bg-white p-7 lg:p-9"
          >
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 border border-brand-100 text-brand">
              <Building2 className="h-5 w-5" />
            </span>
            <p className="mt-5 font-display text-[12px] font-bold tracking-[0.16em] uppercase text-brand-700">
              Our store address
            </p>
            <h2 className="mt-2 font-display text-[28px] sm:text-[32px] font-extrabold text-ink-900 leading-tight">
              {ADDRESS.storeName}
              <br />
              <span className="text-brand">{ADDRESS.mall}</span>
            </h2>
            <address className="mt-5 not-italic text-[14.5px] leading-relaxed text-ink-700">
              {ADDRESS.unit}
              <br />
              {ADDRESS.pillar}
              <br />
              {ADDRESS.area}
              <br />
              {ADDRESS.city}
            </address>

            <div className="mt-6 pt-5 border-t border-ink-100 flex items-center gap-2 flex-wrap">
              <a
                href={`https://www.google.com/maps?q=${encodeURIComponent(
                  "Ashoka One Mall Kukatpally Hyderabad"
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-ink-900 text-white px-4 h-10 text-[12px] font-bold hover:bg-ink-700 transition-colors"
              >
                <MapPin className="h-3.5 w-3.5" /> Open in Maps
                <ExternalLink className="h-3 w-3 opacity-70" />
              </a>
              <a
                href={`tel:${ADDRESS.phone.replace(/\s/g, "")}`}
                className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white text-ink-800 px-4 h-10 text-[12px] font-semibold hover:border-ink-900 transition-colors"
              >
                <Phone className="h-3.5 w-3.5" />
                <span className="font-mono">{ADDRESS.phone}</span>
              </a>
              <button
                type="button"
                onClick={copyAddress}
                className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white text-ink-700 px-3 h-10 text-[12px] font-semibold hover:border-ink-900 transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" /> Copy address
                  </>
                )}
              </button>
            </div>

            {/* Book a tour for schools */}
            <a
              href="/contact?kind=school&topic=tour"
              className="mt-5 group flex items-center justify-between gap-3 rounded-2xl bg-brand-50 border border-brand-100 px-4 py-3 hover:bg-brand-100 transition-colors"
            >
              <span className="flex items-center gap-3 min-w-0">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white border border-brand-100 text-brand">
                  <CalendarCheck className="h-4 w-4" strokeWidth={2} />
                </span>
                <span className="min-w-0">
                  <p className="font-display text-[13px] font-bold text-ink-900 leading-tight">
                    Schools — book a private tour
                  </p>
                  <p className="text-[12px] text-ink-600 leading-tight mt-0.5">
                    We&apos;ll prepare your catalogue ahead of your visit
                  </p>
                </span>
              </span>
              <ExternalLink className="h-4 w-4 text-brand shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>
          </motion.div>

          {/* Map — wrapped in styled card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="relative rounded-2xl overflow-hidden border border-ink-200 bg-white shadow-[0_30px_60px_-30px_rgba(0,0,0,0.20)] min-h-[400px] lg:min-h-[480px]"
          >
            <iframe
              src="https://www.google.com/maps?q=Ashoka+One+Mall+Kukatpally+Hyderabad&output=embed"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="w-full h-full min-h-[400px] lg:min-h-[480px] border-0"
              title="Inventre Experience Store on Google Maps"
            />

            {/* Floating pin overlay */}
            <div className="absolute top-4 left-4 right-4 sm:right-auto sm:max-w-xs rounded-2xl border border-ink-100 bg-white/95 backdrop-blur p-4 shadow-[0_15px_35px_-15px_rgba(0,0,0,0.25)] pointer-events-none">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand text-white">
                  <MapPin className="h-4 w-4" strokeWidth={2.5} />
                </span>
                <div className="min-w-0">
                  <p className="font-display text-[10px] font-semibold tracking-[0.18em] uppercase text-brand-700">
                    You are here
                  </p>
                  <p className="mt-0.5 font-display text-[14px] font-bold text-ink-900 leading-tight truncate">
                    Inventre · Ashoka One Mall
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-500 leading-tight">
                    3rd floor · Unit 135
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
