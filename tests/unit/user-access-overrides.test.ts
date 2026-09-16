/**
 * Per-user access overrides.
 *
 * The rule that carries the most weight here is "never store an override that
 * agrees with the role". A redundant row looks harmless and is not: it stops
 * the user tracking the role, so editing the role later silently fails to
 * reach the one account that appeared to be a plain inheritor.
 */

import { describe, expect, it } from "vitest";
import type { AdminPage } from "@/lib/admin-permissions";
import {
  baselinePageAccess,
  cellState,
  effectiveHas,
  effectivePageAccess,
  effectiveSet,
  overrideDiffCount,
  pageIsOverridden,
  redundantOverrides,
  resetPage,
  withoutRedundant,
  setPageAccess,
  summarise,
  toPayload,
  toggleRead,
  toggleWrite,
} from "@/lib/admin-access-view";

const PAGES: AdminPage[] = [
  { slug: "orders", label: "Orders", group: "Sales" },
  { slug: "students", label: "Students", group: "People" },
];

const set = (...k: string[]) => new Set(k);
const ov = (...pairs: [string, boolean][]) => new Map(pairs);

describe("effective access", () => {
  it("falls through to the role when there is no override", () => {
    expect(effectiveHas(set("orders.read"), ov(), "orders.read")).toBe(true);
    expect(effectiveHas(set(), ov(), "orders.read")).toBe(false);
  });

  it("a grant beats a role that says no", () => {
    expect(effectiveHas(set(), ov(["orders.read", true]), "orders.read")).toBe(true);
  });

  it("a revoke beats a role that says yes", () => {
    expect(effectiveHas(set("orders.read"), ov(["orders.read", false]), "orders.read")).toBe(
      false
    );
  });

  it("effectiveSet applies both directions", () => {
    const eff = effectiveSet(
      set("orders.read", "students.read"),
      ov(["students.read", false], ["orders.write", true])
    );
    expect([...eff].sort()).toEqual(["orders.read", "orders.write"]);
  });
});

describe("cell state", () => {
  it("distinguishes inherit, grant and revoke", () => {
    expect(cellState(ov(), "orders.read")).toBe("inherit");
    expect(cellState(ov(["orders.read", true]), "orders.read")).toBe("grant");
    expect(cellState(ov(["orders.read", false]), "orders.read")).toBe("revoke");
  });
});

describe("setPageAccess", () => {
  it("stores nothing when the role already agrees", () => {
    // The role grants read; asking for read must leave NO row behind, so the
    // user keeps tracking the role.
    const next = setPageAccess(set("orders.read"), ov(), "orders", "read");
    expect(next.size).toBe(0);
  });

  it("clears a redundant row that already exists", () => {
    const next = setPageAccess(set("orders.read"), ov(["orders.read", true]), "orders", "read");
    expect(next.has("orders.read")).toBe(false);
  });

  it("granting write on a page the role does not give writes two grants", () => {
    const next = setPageAccess(set(), ov(), "orders", "write");
    expect(next.get("orders.read")).toBe(true);
    expect(next.get("orders.write")).toBe(true);
  });

  it("granting write when the role already reads stores only the write", () => {
    const next = setPageAccess(set("orders.read"), ov(), "orders", "write");
    expect(next.has("orders.read")).toBe(false);
    expect(next.get("orders.write")).toBe(true);
  });

  it("revoking a page the role grants writes explicit revokes", () => {
    const next = setPageAccess(set("orders.read", "orders.write"), ov(), "orders", "none");
    expect(next.get("orders.read")).toBe(false);
    expect(next.get("orders.write")).toBe(false);
  });

  it("never produces effective write without read", () => {
    const baseline = set();
    const next = setPageAccess(baseline, ov(), "orders", "write");
    expect(effectivePageAccess(baseline, next, "orders")).toBe("write");
    expect(effectiveHas(baseline, next, "orders.read")).toBe(true);
  });

  it("does not mutate the input map", () => {
    const original = ov(["orders.read", true]);
    setPageAccess(set(), original, "orders", "none");
    expect(original.get("orders.read")).toBe(true);
  });

  it("leaves other pages alone", () => {
    const next = setPageAccess(set(), ov(["students.read", true]), "orders", "write");
    expect(next.get("students.read")).toBe(true);
  });
});

describe("toggles", () => {
  it("read toggles the effective level on and off", () => {
    const baseline = set();
    let o = toggleRead(baseline, ov(), "orders");
    expect(effectivePageAccess(baseline, o, "orders")).toBe("read");
    o = toggleRead(baseline, o, "orders");
    expect(effectivePageAccess(baseline, o, "orders")).toBe("none");
  });

  it("turning read off from an inherited write revokes both", () => {
    const baseline = set("orders.read", "orders.write");
    const o = toggleRead(baseline, ov(), "orders");
    expect(effectivePageAccess(baseline, o, "orders")).toBe("none");
  });

  it("write toggles between write and read, not write and none", () => {
    const baseline = set("orders.read");
    const o = toggleWrite(baseline, ov(), "orders");
    expect(effectivePageAccess(baseline, o, "orders")).toBe("write");
    const back = toggleWrite(baseline, o, "orders");
    expect(effectivePageAccess(baseline, back, "orders")).toBe("read");
    // and the page is back to following the role, with no rows left over
    expect(pageIsOverridden(back, "orders")).toBe(false);
  });
});

describe("reset", () => {
  it("drops every override on the page", () => {
    const o = resetPage(ov(["orders.read", true], ["orders.write", false], ["students.read", true]), "orders");
    expect(pageIsOverridden(o, "orders")).toBe(false);
    expect(o.get("students.read")).toBe(true);
  });
});

describe("baseline reporting", () => {
  it("reports what the role alone would give", () => {
    expect(baselinePageAccess(set(), "orders")).toBe("none");
    expect(baselinePageAccess(set("orders.read"), "orders")).toBe("read");
    expect(baselinePageAccess(set("orders.read", "orders.write"), "orders")).toBe("write");
  });
});

describe("summary", () => {
  it("counts grants, revokes and affected pages", () => {
    const s = summarise(
      ov(["orders.read", true], ["orders.write", true], ["students.read", false]),
      PAGES
    );
    expect(s.grants).toBe(2);
    expect(s.revokes).toBe(1);
    expect(s.pages).toBe(2);
  });

  it("an empty override map is a clean inheritor", () => {
    expect(summarise(ov(), PAGES)).toEqual({ grants: 0, revokes: 0, pages: 0 });
  });
});

describe("wire format", () => {
  it("splits into the grants/revokes arrays the endpoint expects", () => {
    const p = toPayload(ov(["orders.read", true], ["students.read", false]));
    expect(p).toEqual({ grants: ["orders.read"], revokes: ["students.read"] });
  });

  it("cannot put the same key in both lists", () => {
    // A Map holds one value per key, so the endpoint's disjointness check
    // can never be tripped by this editor.
    const p = toPayload(ov(["orders.read", true], ["orders.read", false]));
    expect(p.grants).toEqual([]);
    expect(p.revokes).toEqual(["orders.read"]);
  });
});

describe("diff", () => {
  it("counts rows that changed state in either direction", () => {
    const before = ov(["orders.read", true]);
    const after = ov(["orders.read", false], ["students.read", true]);
    expect(overrideDiffCount(before, after)).toBe(2);
  });

  it("removing an override counts as a change", () => {
    expect(overrideDiffCount(ov(["orders.read", true]), ov())).toBe(1);
  });

  it("an identical map has no changes", () => {
    expect(overrideDiffCount(ov(["orders.read", true]), ov(["orders.read", true]))).toBe(0);
  });
});

describe("redundant overrides", () => {
  it("a grant the role already gives is redundant", () => {
    expect(redundantOverrides(set("students.read"), ov(["students.read", true]))).toEqual([
      "students.read",
    ]);
  });

  it("a revoke of a key the role never gave is redundant", () => {
    expect(redundantOverrides(set(), ov(["orders.write", false]))).toEqual(["orders.write"]);
  });

  it("an override that changes the outcome is not", () => {
    expect(redundantOverrides(set(), ov(["orders.read", true]))).toEqual([]);
    expect(redundantOverrides(set("orders.read"), ov(["orders.read", false]))).toEqual([]);
  });

  it("withoutRedundant strips only the redundant rows", () => {
    const cleaned = withoutRedundant(
      set("students.read"),
      ov(["students.read", true], ["orders.read", true])
    );
    expect([...cleaned.keys()]).toEqual(["orders.read"]);
  });
});
