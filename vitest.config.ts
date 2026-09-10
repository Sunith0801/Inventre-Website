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
    include: ["tests/**/*.test.ts"],
    environment: "node",
    reporters: "dot",
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
});
