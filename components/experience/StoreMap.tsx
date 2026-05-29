"use client";

import { motion } from "framer-motion";
import { MapPin, ExternalLink, Copy, Check, Phone } from "lucide-react";
import { useState } from "react";

export function StoreMap() {
  const [copied, setCopied] = useState(false);
  const fullAddress =
    "Inventre Store, 3rd Floor Unit 135, Ashoka One Mall, Pillar No. 835 Y-Junction, Habeeb Nagar, Kukatpally, Hyderabad, Telangana 500072";

  const copy = async () => {
    await navigator.clipboard.writeText(fullAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section
      id="address"
      className="relative bg-ink-900 scroll-mt-24 overflow-hidden"
    >
      {/* Map fills full viewport width — edge to edge */}
      <div className="relative w-full h-[520px] lg:h-[600px]">
        <iframe
          src="https://www.google.com/maps?q=Ashoka+One+Mall+Kukatpally+Hyderabad&output=embed"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className="absolute inset-0 w-full h-full border-0 grayscale-[20%] contrast-[1.05]"
          title="Inventre Experience Store on Google Maps"
        />

        {/* Floating address card — overlay */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="absolute top-6 left-5 right-5 sm:left-8 sm:right-auto sm:max-w-md rounded-2xl border border-ink-100 bg-white/95 backdrop-blur-md p-5 sm:p-6 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.35)]"
        >
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand text-white shadow-[0_10px_25px_-10px_rgba(228,113,39,0.6)]">
              <MapPin className="h-5 w-5" strokeWidth={2.5} />
            </span>
            <div className="min-w-0">
              <p className="font-display text-[10px] font-bold tracking-[0.18em] uppercase text-brand-700">
                Find us at
              </p>
              <p className="mt-1 font-display text-[18px] sm:text-[20px] font-extrabold text-ink-900 leading-tight">
                Inventre Store
              </p>
              <p className="font-display text-[14px] font-semibold text-brand">
                Ashoka One Mall · Kukatpally
              </p>
            </div>
          </div>

          <address className="mt-4 not-italic text-[13px] leading-relaxed text-ink-700">
            3rd Floor, Unit 135 · Pillar No. 835, Y-Junction
            <br />
            Habeeb Nagar, Hyderabad — 500072
          </address>

          <div className="mt-4 pt-4 border-t border-ink-100 flex flex-wrap gap-2">
            <a
              href="https://www.google.com/maps?q=Ashoka+One+Mall+Kukatpally+Hyderabad"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-ink-900 text-white px-3.5 h-9 text-[12px] font-bold hover:bg-ink-700 transition-colors"
            >
              Open in Maps
              <ExternalLink className="h-3 w-3 opacity-80" />
            </a>
            <a
              href="tel:+917075785732"
              className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3.5 h-9 text-[12px] font-semibold text-ink-800 hover:border-ink-900 transition-colors"
            >
              <Phone className="h-3 w-3" />
              <span className="font-mono">+91 70757 85732</span>
            </a>
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 h-9 text-[12px] font-semibold text-ink-700 hover:border-ink-900 transition-colors"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-emerald-600" /> Copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" /> Copy
                </>
              )}
            </button>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
