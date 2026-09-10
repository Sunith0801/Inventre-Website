import { describe, expect, it } from "vitest";
import { canonicalGrade, extractGrade } from "@/lib/grade";

/**
 * Grade has been the single most repeated source of wrong orders here — ERP,
 * MCB and the school rosters each spell it differently, and the wrong answer
 * puts a child in the wrong uniform kit. These pin the spellings actually
 * seen in production data.
 */
describe("canonicalGrade", () => {
  it("reads the common spellings of a numbered grade", () => {
    expect(canonicalGrade("Grade 9")).toBe("Grade 9");
    expect(canonicalGrade("Grade-9")).toBe("Grade 9");
    expect(canonicalGrade("Class 9")).toBe("Grade 9");
    expect(canonicalGrade("grade 12")).toBe("Grade 12");
  });

  it("reads the pre-primary tokens", () => {
    expect(canonicalGrade("LKG")).toBe("LKG");
    expect(canonicalGrade("UKG")).toBe("UKG");
    expect(canonicalGrade("Nursery")).toBe("Nursery");
  });

  it("refuses to guess at a bare KG, which schools split into LKG/UKG", () => {
    expect(canonicalGrade("KG")).toBeNull();
  });

  it("rejects a grade outside 1..12 rather than inventing one", () => {
    expect(canonicalGrade("Grade 13")).toBeNull();
    expect(canonicalGrade("Grade 0")).toBeNull();
  });

  it("returns null for nothing at all", () => {
    expect(canonicalGrade(null)).toBeNull();
    expect(canonicalGrade("")).toBeNull();
    expect(canonicalGrade("no grade in this string")).toBeNull();
  });
});

describe("extractGrade", () => {
  it("takes the first candidate that parses, so a fallback field can rescue a blank one", () => {
    expect(extractGrade(null, "", "Class 4")).toBe("Grade 4");
    expect(extractGrade("Grade 7", "Class 4")).toBe("Grade 7");
  });
});
