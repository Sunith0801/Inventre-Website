/**
 * The permission algebra behind the roles editor.
 *
 * Each rule here is a policy the admin panel enforces, not an implementation
 * detail. They were previously expressed only as event handlers inside a
 * 308-line client component, where breaking one was silent — the editor still
 * rendered, it just granted the wrong thing.
 *
 * The invariant every test below defends: a permission set may never contain
 * `<page>.write` without `<page>.read`. Write-without-read would let an
 * account POST to an endpoint whose page it cannot load, which reads as a
 * lockout to the user and as a hole to anyone auditing the grant.
 */

import { describe, expect, it } from "vitest";
import type { AdminPage } from "@/lib/admin-permissions";
import {
  groupLevel,
  groupPages,
  nextGroupLevel,
  orphanGrants,
  pageChanged,
  pageLevel,
  permissionDiff,
  permissionLevel,
  roleCoverage,
  setGroupLevel,
  setPageLevel,
  toggleRead,
  toggleWrite,
} from "@/lib/admin-roles-view";

/** A miniature registry, so the assertions do not move when a page is added. */
const PAGES: AdminPage[] = [
  { slug: "orders", label: "Orders", group: "Sales" },
  { slug: "shipments", label: "Shipments", group: "Sales" },
  { slug: "students", label: "Students", group: "People" },
];
const SALES = PAGES.filter((p) => p.group === "Sales");

const set = (...keys: string[]) => new Set(keys);

describe("page level", () => {
  it("reports none, read and write", () => {
    expect(pageLevel(set(), "orders")).toBe("none");
    expect(pageLevel(set("orders.read"), "orders")).toBe("read");
    expect(pageLevel(set("orders.read", "orders.write"), "orders")).toBe("write");
  });

  it("treats a write-only set as write, so a broken grant still renders honestly", () => {
    // Nothing in the UI can produce this, but a hand-edited database row can.
    expect(pageLevel(set("orders.write"), "orders")).toBe("write");
  });
});

describe("setPageLevel", () => {
  it("granting write implies read", () => {
    const next = setPageLevel(set(), "orders", "write");
    expect(next.has("orders.read")).toBe(true);
    expect(next.has("orders.write")).toBe(true);
  });

  it("dropping to read revokes write", () => {
    const next = setPageLevel(set("orders.read", "orders.write"), "orders", "read");
    expect(next.has("orders.read")).toBe(true);
    expect(next.has("orders.write")).toBe(false);
  });

  it("none revokes both", () => {
    const next = setPageLevel(set("orders.read", "orders.write"), "orders", "none");
    expect(next.has("orders.read")).toBe(false);
    expect(next.has("orders.write")).toBe(false);
  });

  it("leaves other pages untouched", () => {
    const next = setPageLevel(set("students.read"), "orders", "write");
    expect(next.has("students.read")).toBe(true);
  });

  it("does not mutate the input set", () => {
    const original = set("orders.read");
    setPageLevel(original, "orders", "none");
    expect(original.has("orders.read")).toBe(true);
  });
});

describe("checkbox toggles", () => {
  it("turning read off also turns write off", () => {
    const next = toggleRead(set("orders.read", "orders.write"), "orders");
    expect(next.has("orders.read")).toBe(false);
    expect(next.has("orders.write")).toBe(false);
  });

  it("turning write on also turns read on", () => {
    const next = toggleWrite(set(), "orders");
    expect(next.has("orders.read")).toBe(true);
    expect(next.has("orders.write")).toBe(true);
  });

  it("turning write off keeps read", () => {
    const next = toggleWrite(set("orders.read", "orders.write"), "orders");
    expect(next.has("orders.read")).toBe(true);
    expect(next.has("orders.write")).toBe(false);
  });

  it("read then write then read returns to none", () => {
    let s: ReadonlySet<string> = set();
    s = toggleRead(s, "orders");
    s = toggleWrite(s, "orders");
    s = toggleRead(s, "orders");
    expect(pageLevel(s, "orders")).toBe("none");
  });
});

describe("group level", () => {
  it("is uniform only when every page agrees", () => {
    expect(groupLevel(set(), SALES)).toBe("none");
    expect(groupLevel(set("orders.read", "shipments.read"), SALES)).toBe("read");
  });

  it("reports mixed when pages disagree", () => {
    expect(groupLevel(set("orders.read"), SALES)).toBe("mixed");
  });

  it("an empty group is none, not a crash", () => {
    expect(groupLevel(set(), [])).toBe("none");
  });

  it("setGroupLevel applies to every page in the group", () => {
    const next = setGroupLevel(set(), SALES, "write");
    expect(pageLevel(next, "orders")).toBe("write");
    expect(pageLevel(next, "shipments")).toBe("write");
    expect(pageLevel(next, "students")).toBe("none");
  });

  it("cycles none → read → write → none", () => {
    expect(nextGroupLevel("none")).toBe("read");
    expect(nextGroupLevel("read")).toBe("write");
    expect(nextGroupLevel("write")).toBe("none");
  });

  it("levels a mixed group up to read rather than continuing a cycle", () => {
    expect(nextGroupLevel("mixed")).toBe("read");
  });
});

describe("role summary", () => {
  it("full requires write on every page, not merely many", () => {
    const all = PAGES.flatMap((p) => [`${p.slug}.read`, `${p.slug}.write`]);
    expect(permissionLevel(new Set(all), PAGES)).toBe("full");

    const nearly = all.filter((k) => k !== "students.write");
    expect(permissionLevel(new Set(nearly), PAGES)).toBe("readwrite");
  });

  it("distinguishes read-only from read & write", () => {
    expect(permissionLevel(set("orders.read"), PAGES)).toBe("readonly");
    expect(permissionLevel(set("orders.read", "orders.write"), PAGES)).toBe("readwrite");
  });

  it("an empty set is no access", () => {
    // The "Agent" role in production is exactly this.
    expect(permissionLevel(set(), PAGES)).toBe("none");
  });

  it("counts distinct modules, not pages", () => {
    const c = roleCoverage(set("orders.read", "shipments.write", "shipments.read"), PAGES);
    expect(c.pages).toBe(2);
    expect(c.writablePages).toBe(1);
    expect(c.modules).toBe(1); // both are Sales
    expect(c.totalModules).toBe(2);
  });
});

describe("drift", () => {
  it("flags grants whose page is no longer in the registry", () => {
    // Production case: Super Admin holds settings-api-keys.* for a page that
    // was removed.
    expect(orphanGrants(["orders.read", "settings-api-keys.read"])).toEqual([
      "settings-api-keys.read",
    ]);
  });

  it("accepts a clean set", () => {
    expect(orphanGrants(["orders.read", "orders.write"])).toEqual([]);
  });
});

describe("diff", () => {
  it("separates added from removed and totals them", () => {
    const d = permissionDiff(set("orders.read"), set("students.read", "students.write"));
    expect(d.added).toEqual(["students.read", "students.write"]);
    expect(d.removed).toEqual(["orders.read"]);
    expect(d.count).toBe(3);
  });

  it("an unchanged set has no diff", () => {
    expect(permissionDiff(set("orders.read"), set("orders.read")).count).toBe(0);
  });

  it("pageChanged compares level, not raw keys", () => {
    const before = set("orders.read", "orders.write");
    expect(pageChanged(before, set("orders.read"), "orders")).toBe(true);
    expect(pageChanged(before, before, "orders")).toBe(false);
  });
});

describe("grouping", () => {
  const GROUPS = ["Sales", "People"];

  it("buckets pages by group in registry order", () => {
    const g = groupPages(PAGES, GROUPS);
    expect(g.map((x) => x.name)).toEqual(["Sales", "People"]);
    expect(g[0].pages).toHaveLength(2);
  });

  it("search matches label or slug", () => {
    expect(groupPages(PAGES, GROUPS, "ship")[0].pages[0].slug).toBe("shipments");
    expect(groupPages(PAGES, GROUPS, "STUDENTS")[0].pages[0].slug).toBe("students");
  });

  it("drops groups a search empties, so no orphan headers render", () => {
    const g = groupPages(PAGES, GROUPS, "students");
    expect(g).toHaveLength(1);
    expect(g[0].name).toBe("People");
  });

  it("a search matching nothing yields nothing", () => {
    expect(groupPages(PAGES, GROUPS, "zzz")).toEqual([]);
  });
});
