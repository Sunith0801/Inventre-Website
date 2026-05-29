// k6 load test — simulate the term-start traffic spike.
// Run:  k6 run loadtest/shop.js
// Or for the 20K target:
//   k6 run --vus 20000 --duration 5m loadtest/shop.js
//
// Stages ramp from 0 to 20K concurrent in 2 mins, hold 3 mins, then ramp down.

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3000";

const homeLatency = new Trend("home_latency_ms");
const shopLatency = new Trend("shop_api_latency_ms");
const errorRate = new Rate("errors");

export const options = {
  stages: [
    { duration: "30s", target: 200 },
    { duration: "1m", target: 1000 },
    { duration: "2m", target: 5000 },
    { duration: "3m", target: 5000 }, // hold
    { duration: "1m", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<500"], // 95% under 500ms
    http_req_failed: ["rate<0.01"], // <1% errors
    errors: ["rate<0.01"],
  },
};

export default function () {
  // 80% of users browse the homepage
  if (Math.random() < 0.8) {
    const r = http.get(`${BASE}/`);
    homeLatency.add(r.timings.duration);
    const ok = check(r, { "home 200": (res) => res.status === 200 });
    errorRate.add(!ok);
    sleep(Math.random() * 4 + 1);
    return;
  }

  // 15% browse a product (assumes session cookie supplied via env)
  if (Math.random() < 0.95) {
    const r = http.get(`${BASE}/api/shop/products`, {
      headers: { Cookie: __ENV.SESSION_COOKIE || "" },
    });
    shopLatency.add(r.timings.duration);
    errorRate.add(r.status !== 200);
    sleep(Math.random() * 3 + 1);
    return;
  }

  // 5% checkout — measure heavier write path
  http.post(
    `${BASE}/api/cart`,
    JSON.stringify({ variantId: __ENV.VARIANT_ID || "", qty: 1 }),
    {
      headers: {
        "Content-Type": "application/json",
        Cookie: __ENV.SESSION_COOKIE || "",
      },
    }
  );
  sleep(Math.random() * 2 + 0.5);
}
