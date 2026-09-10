import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Unit tests only — no database, no network, no Next runtime.
 *
 * That boundary is deliberate. This codebase reaches the database from 282
 * route and page files, so a test that needs one would need most of the app
 * standing up, and nobody would run it. Everything here is a pure function
 * that decides something a customer sees: what their phone number resolves
 * to, what quantity they are allowed to return, which tax template their
 * pincode selects, which grade an ERP string means.
 */
export default defineConfig({
  test: {
    // Tests live BESIDE the code they describe (features/**) as well as in
    // tests/ for cross-cutting rules. A rule and its proof in the same folder
    // is far more likely to be read — and updated — than one two directories away.
    include: ["tests/**/*.test.ts", "features/**/*.test.ts"],
    environment: "node",
    reporters: "dot",
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
});
