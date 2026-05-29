"use client";

import { motion, useInView, animate } from "framer-motion";
import { useEffect, useRef } from "react";

function Counter({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  useEffect(() => {
    if (!inView || !ref.current) return;
    const node = ref.current;
    const controls = animate(0, to, {
      duration: 1.6,
      ease: [0.16, 1, 0.3, 1],
      onUpdate(v) {
        node.textContent = Math.round(v).toLocaleString() + suffix;
      },
    });
    return () => controls.stop();
  }, [inView, to, suffix]);

  return <span ref={ref}>0{suffix}</span>;
}

const FALLBACK = [
  { value: 20000, suffix: "+", label: "Happy students" },
  { value: 17, suffix: "+", label: "Partner schools" },
  { value: 98, suffix: "%", label: "School renewal rate" },
  { value: 7, suffix: "d", label: "Free returns window" },
];

type Stat = { value: number; suffix: string; label: string };

export function Stats({ stats = FALLBACK }: { stats?: Stat[] }) {
  return (
    <section className="border-y border-ink-100 bg-cream">
      <div className="mx-auto max-w-7xl px-5 lg:px-8 py-12 lg:py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-4">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="text-center md:text-left"
            >
              <p className="font-display text-[44px] sm:text-[56px] lg:text-[64px] font-extrabold leading-none tracking-tight text-ink-900">
                <Counter to={s.value} suffix={s.suffix} />
              </p>
              <p className="mt-2 text-[13px] font-medium text-ink-500">{s.label}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
