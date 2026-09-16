import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { schools, grades, parents, students, guardians } from "@/db/schema";

/**
 * Read-only Master Data browser — what the "Master Data" section shows.
 * One entry per master record type: which table, which columns (the full
 * record minus secrets and raw ERP payloads), which columns search, and
 * the default order. No writes happen anywhere in this section; editing
 * lives in the CRM pages.
 */
export type MasterColumn = {
  key: string;
  label: string;
  col: AnyPgColumn;
  kind?: "text" | "date" | "bool" | "number" | "list" | "json" | "id";
  /** Column is part of the free-text search. */
  search?: boolean;
  /** Stick to the left edge while the table scrolls sideways. */
  pin?: boolean;
};

export type MasterEntity = {
  key: string;
  label: string;
  /** Permission slug — mirrors the editable page's gate. */
  slug: string;
  table: PgTable;
  columns: MasterColumn[];
  orderBy: AnyPgColumn;
};

const c = (
  key: string,
  label: string,
  col: AnyPgColumn,
  opts: Omit<MasterColumn, "key" | "label" | "col"> = {}
): MasterColumn => ({ key, label, col, ...opts });

export const MASTER_ENTITIES: MasterEntity[] = [
  {
    key: "schools",
    label: "Schools",
    slug: "schools",
    table: schools,
    orderBy: schools.name,
    columns: [
      c("name", "Name", schools.name, { search: true, pin: true }),
      c("schoolCode", "Code", schools.schoolCode, { search: true }),
      c("status", "Status", schools.status),
      c("branchName", "Branch", schools.branchName, { search: true }),
      c("schoolName", "Registered name", schools.schoolName, { search: true }),
      c("slug", "Slug", schools.slug, { search: true }),
      c("city", "City", schools.city, { search: true }),
      c("state", "State", schools.state),
      c("country", "Country", schools.country),
      c("street", "Street", schools.street),
      c("pincode", "Pincode", schools.pincode, { search: true }),
      c("contactEmail", "Contact email", schools.contactEmail, { search: true }),
      c("contactPhone", "Contact phone", schools.contactPhone, { search: true }),
      c("websiteUrl", "Website", schools.websiteUrl),
      c("gradesServed", "Grades served", schools.gradesServed, { kind: "list" }),
      c("curriculum", "Curriculum", schools.curriculum, { kind: "list" }),
      c("itemCodePrefixes", "Item code prefixes", schools.itemCodePrefixes, { kind: "list" }),
      c("houseColors", "House colours", schools.houseColors, { kind: "json" }),
      c("isFeatured", "Featured", schools.isFeatured, { kind: "bool" }),
      c("isSetupComplete", "Setup complete", schools.isSetupComplete, { kind: "bool" }),
      c("uniformDetailsCheckbox", "Uniform details", schools.uniformDetailsCheckbox, { kind: "bool" }),
      c("booksDetailsCheckbox", "Books details", schools.booksDetailsCheckbox, { kind: "bool" }),
      c("approvedAt", "Approved", schools.approvedAt, { kind: "date" }),
      c("erpName", "ERP name", schools.erpName, { search: true }),
      c("erpModified", "ERP modified", schools.erpModified, { kind: "date" }),
      c("syncedAt", "Synced", schools.syncedAt, { kind: "date" }),
      c("createdAt", "Created", schools.createdAt, { kind: "date" }),
    ],
  },
  {
    key: "grades",
    label: "Grades",
    slug: "grades",
    table: grades,
    orderBy: grades.gradeName,
    columns: [
      c("gradeName", "Grade", grades.gradeName, { search: true, pin: true }),
      c("gradeCode", "Code", grades.gradeCode, { search: true }),
      c("status", "Status", grades.status),
      c("erpName", "ERP name", grades.erpName, { search: true }),
      c("erpModified", "ERP modified", grades.erpModified, { kind: "date" }),
      c("syncedAt", "Synced", grades.syncedAt, { kind: "date" }),
    ],
  },
  {
    key: "customers",
    label: "Customers (Parents)",
    slug: "customers",
    table: parents,
    orderBy: parents.name,
    columns: [
      c("name", "Name", parents.name, { search: true, pin: true }),
      c("phone", "Phone", parents.phone, { search: true }),
      c("email", "Email", parents.email, { search: true }),
      c("status", "Status", parents.status),
      c("customerCode", "Customer code", parents.customerCode, { search: true }),
      c("customerGroup", "Customer group", parents.customerGroup),
      c("gstCategory", "GST category", parents.gstCategory),
      c("language", "Language", parents.language),
      c("tags", "Tags", parents.tags, { kind: "list" }),
      c("totalOrderCount", "Orders", parents.totalOrderCount, { kind: "number" }),
      c("totalLifetimeValue", "Lifetime value (₹)", parents.totalLifetimeValue, { kind: "number" }),
      c("lastOrderAt", "Last order", parents.lastOrderAt, { kind: "date" }),
      c("isFrozen", "Frozen", parents.isFrozen, { kind: "bool" }),
      c("firstTimeLogin", "First-time login", parents.firstTimeLogin, { kind: "bool" }),
      c("lastLoginAt", "Last login", parents.lastLoginAt, { kind: "date" }),
      c("tcAcceptedAt", "T&C accepted", parents.tcAcceptedAt, { kind: "date" }),
      c("tcAcceptedVersion", "T&C version", parents.tcAcceptedVersion),
      c("notes", "Notes", parents.notes),
      c("createdAt", "Created", parents.createdAt, { kind: "date" }),
    ],
  },
  {
    key: "students",
    label: "Students",
    slug: "students",
    table: students,
    orderBy: students.name,
    columns: [
      c("name", "Name", students.name, { search: true, pin: true }),
      c("enrollmentNumber", "Enrolment", students.enrollmentNumber, { search: true }),
      c("schoolCode", "School code", students.schoolCode, { search: true }),
      c("grade", "Grade", students.grade),
      c("class", "Class", students.class),
      c("section", "Section", students.section),
      c("status", "Status", students.status),
      c("enabled", "Enabled", students.enabled, { kind: "bool" }),
      c("isNewStudent", "New student", students.isNewStudent, { kind: "bool" }),
      c("isVerified", "Verified", students.isVerified, { kind: "bool" }),
      c("verifiedAt", "Verified at", students.verifiedAt, { kind: "date" }),
      c("firstName", "First name", students.firstName, { search: true }),
      c("middleName", "Middle name", students.middleName),
      c("lastName", "Last name", students.lastName, { search: true }),
      c("gender", "Gender", students.gender),
      c("dateOfBirth", "Date of birth", students.dateOfBirth),
      c("bloodGroup", "Blood group", students.bloodGroup),
      c("nationality", "Nationality", students.nationality),
      c("houseColor", "House", students.houseColor),
      c("medium", "Medium", students.medium),
      c("curriculum", "Curriculum", students.curriculum),
      c("joiningDate", "Joining date", students.joiningDate),
      c("studentMobileNumber", "Student mobile", students.studentMobileNumber, { search: true }),
      c("studentEmailId", "Student email", students.studentEmailId, { search: true }),
      c("sizeOverrides", "Size overrides", students.sizeOverrides, { kind: "json" }),
      c("customerGroup", "Customer group", students.customerGroup),
      c("customerLink", "Customer link", students.customerLink),
      c("erpName", "ERP name", students.erpName, { search: true }),
      c("erpModified", "ERP modified", students.erpModified, { kind: "date" }),
      c("syncedAt", "Synced", students.syncedAt, { kind: "date" }),
      c("createdAt", "Created", students.createdAt, { kind: "date" }),
    ],
  },
  {
    key: "guardians",
    label: "Guardians",
    slug: "guardians",
    table: guardians,
    orderBy: guardians.guardianName,
    columns: [
      c("guardianName", "Name", guardians.guardianName, { search: true, pin: true }),
      c("mobileNumber", "Mobile", guardians.mobileNumber, { search: true }),
      c("alternateNumber", "Alternate number", guardians.alternateNumber, { search: true }),
      c("email", "Email", guardians.email, { search: true }),
      c("emailAddress", "Email address", guardians.emailAddress, { search: true }),
      c("dateOfBirth", "Date of birth", guardians.dateOfBirth),
      c("erpName", "ERP name", guardians.erpName, { search: true }),
      c("knownErpNames", "Known ERP names", guardians.knownErpNames, { kind: "list" }),
      c("erpModified", "ERP modified", guardians.erpModified, { kind: "date" }),
      c("syncedAt", "Synced", guardians.syncedAt, { kind: "date" }),
    ],
  },
];

export function masterEntity(key: string): MasterEntity | undefined {
  return MASTER_ENTITIES.find((e) => e.key === key);
}
