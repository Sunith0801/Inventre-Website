"use client";

/**
 * Client-side auth helpers. These call the Next.js Route Handlers under
 * /api/auth/* — actual auth state lives server-side (httpOnly JWT cookie).
 */

export type Me =
  | {
      kind: "parent";
      id: string;
      phone: string;
      loggedInPhone?: string | null;
      name: string | null;
      email: string | null;
      /** ISO timestamp string when present. Used by LoginForm to skip the
       *  T&C modal when this parent already accepted the current version. */
      tcAcceptedAt?: string | null;
      tcAcceptedVersion?: string | null;
      students: {
        id: string;
        name: string;
        class: string | null;
        grade?: string | null;
        schoolGivenGrade?: string | null;
        section: string | null;
        enrollmentNumber: string | null;
        isNewStudent?: boolean;
        gender?: string | null;
        dateOfBirth?: string | null;
        guardianName: string | null;
        school: {
          id: string;
          name: string;
          slug: string;
          bannerUrl: string | null;
          logoUrl: string | null;
          schoolLogoUrl: string | null;
        };
      }[];
      /** Students on this family's phone graph whose website access is
       *  switched off. Never shoppable — carried only so the picker can
       *  show them as Closed instead of silently dropping them. */
      closedStudents?: {
        id: string;
        name: string;
        grade: string | null;
        section: string | null;
        enrollmentNumber: string | null;
      }[];
    }
  | {
      kind: "admin";
      id: string;
      email: string;
      name: string | null;
      role: "super" | "ops" | "school_admin";
      schoolId: string | null;
    }
  | null;

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    let msg = "Request failed";
    try {
      const data = await res.json();
      msg = data?.error ?? msg;
    } catch {}
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return res.json();
}

// Dedup cache for auth.me() — multiple components mount in parallel and each
// used to fire its own /api/auth/me request. We share the in-flight promise
// and cache the resolved value for a short TTL so a single page-load
// produces one network call regardless of how many consumers there are.
let meInflight: Promise<Me> | null = null;
let meCachedAt = 0;
let meCache: Me = null;
const ME_TTL_MS = 10_000;

export function clearMeCache() {
  meInflight = null;
  meCachedAt = 0;
  meCache = null;
}

export const auth = {
  async me(): Promise<Me> {
    if (meInflight) return meInflight;
    if (Date.now() - meCachedAt < ME_TTL_MS) return meCache;
    meInflight = api<{ user: Me }>("/api/auth/me")
      .then((data) => {
        meCache = data.user;
        meCachedAt = Date.now();
        return data.user;
      })
      .finally(() => {
        meInflight = null;
      });
    return meInflight;
  },

  /** Account page only: same as me() but includes each child's date of
   *  birth. Not cached, so it never leaks into the shared me() cache. */
  async meWithDob(): Promise<Me> {
    const data = await api<{ user: Me }>("/api/auth/me?include=dob");
    return data.user;
  },

  async loginWithPassword(phone: string, password: string) {
    const r = await api<{ ok: true }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ phone, password }),
    });
    clearMeCache();
    return r;
  },

  async requestOtp(phone: string) {
    return api<{ ok: true; ttl: number }>("/api/auth/otp/request", {
      method: "POST",
      body: JSON.stringify({ phone }),
    });
  },

  async verifyOtp(phone: string, otp: string) {
    const r = await api<{ ok: true; isNew: boolean; firstTime?: boolean }>(
      "/api/auth/otp/verify",
      { method: "POST", body: JSON.stringify({ phone, otp }) }
    );
    clearMeCache();
    return r;
  },

  async register(phone: string, name: string) {
    return api<{ ok: true; ttl: number }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ phone, name }),
    });
  },

  /** New-user registration step 2: verify OTP, attach the chosen student,
   *  capture the email, and sign in. */
  async registerComplete(args: {
    phone: string;
    otp: string;
    studentId: string;
    email: string;
  }) {
    const r = await api<{ ok: true }>("/api/auth/register/complete", {
      method: "POST",
      body: JSON.stringify(args),
    });
    clearMeCache();
    return r;
  },

  /** Add a second mobile number to an account after the new number's OTP
   *  has been verified. Both numbers then work for login. */
  async changePhoneAdd(args: {
    studentId: string;
    newPhone: string;
    otp: string;
  }) {
    const r = await api<{ ok: true }>("/api/auth/change-phone/add", {
      method: "POST",
      body: JSON.stringify(args),
    });
    clearMeCache();
    return r;
  },

  async phoneStatus(phone: string) {
    return api<{ registered: boolean; hasPassword: boolean; firstTime: boolean }>(
      "/api/auth/phone-status",
      { method: "POST", body: JSON.stringify({ phone }) }
    );
  },

  async firstTimeVerifyOtp(phone: string, otp: string) {
    return api<{ ok: true }>("/api/auth/first-time/verify-otp", {
      method: "POST",
      body: JSON.stringify({ phone, otp }),
    });
  },

  async firstTimeComplete(
    phone: string,
    otp: string,
    password: string,
    tcAcceptedVersion: string
  ) {
    return api<{ ok: true }>("/api/auth/first-time/complete", {
      method: "POST",
      body: JSON.stringify({ phone, otp, password, tcAcceptedVersion }),
    });
  },

  async acceptTc(version: string) {
    return api<{ ok: true }>("/api/auth/accept-tc", {
      method: "POST",
      body: JSON.stringify({ version }),
    });
  },

  async recoverOptions() {
    return api<{
      schools: { code: string; name: string }[];
      grades: string[];
      gradesBySchool: Record<string, { value: string; label: string }[]>;
    }>("/api/auth/recover/options");
  },

  async recoverSearch(school: string, grade: string, q: string) {
    const p = new URLSearchParams({ school, grade, q });
    return api<{
      results: {
        studentId: string;
        name: string;
        enrollment: string;
        school: string;
        phones: { relation: "Father" | "Mother" | null; mobileMasked: string }[];
        mobileMasked: string;
      }[];
    }>(`/api/auth/recover/search?${p.toString()}`);
  },

  async recoverRequestOtp(studentId: string, oldPhone: string) {
    return api<{ ok: true; ttl: number }>("/api/auth/recover/request-otp", {
      method: "POST",
      body: JSON.stringify({ studentId, oldPhone }),
    });
  },

  // verify-old creates a session on success when intent === "change"
  // (default — the old direct-login behaviour). For intent === "add" the
  // server just sets the recovery marker so the add-mobile flow can
  // continue gathering guardian name/relation/new phone before any
  // session is created.
  async recoverVerifyOld(
    studentId: string,
    oldPhone: string,
    otp: string,
    intent: "change" | "add" = "change",
  ) {
    const r = await api<{ ok: true }>("/api/auth/recover/verify-old", {
      method: "POST",
      body: JSON.stringify({ studentId, oldPhone, otp, intent }),
    });
    if (intent === "change") clearMeCache();
    return r;
  },

  async recoverRequestNewOtp(args: {
    studentId: string;
    oldPhone?: string;
    newPhone: string;
  }) {
    return api<{ ok: true; ttl: number }>(
      "/api/auth/recover/request-new-otp",
      { method: "POST", body: JSON.stringify(args) }
    );
  },

  async recoverConfirm(args: {
    studentId: string;
    oldPhone?: string;
    otp: string;
    newPhone: string;
  }) {
    const r = await api<{ ok: true }>("/api/auth/recover/confirm", {
      method: "POST",
      body: JSON.stringify(args),
    });
    clearMeCache();
    return r;
  },

  // ── Add-another-mobile path ──────────────────────────────────────
  // Sends an OTP to a brand-new number the parent wants to ADD (not
  // replace). The server allows the new number to already be an
  // existing parent — on next OTP login that parent gains this
  // student via auto-link in /api/auth/otp/verify.
  async recoverRequestAddOtp(args: {
    studentId: string;
    oldPhone?: string;
    newPhone: string;
  }) {
    return api<{ ok: true; ttl: number }>(
      "/api/auth/recover/request-add-otp",
      { method: "POST", body: JSON.stringify(args) },
    );
  },
  // Verifies the new-phone OTP and INSERTs a fresh student_guardian_links
  // row. No session is created — the parent then signs in with the new
  // phone via the normal OTP flow.
  async recoverAddMobile(args: {
    studentId: string;
    oldPhone?: string;
    otp: string;
    newPhone: string;
    guardianName: string;
    relation:
      | "Father"
      | "Mother"
      | "Brother"
      | "Sister"
      | "Grandparent"
      | "Uncle"
      | "Aunt"
      | "Guardian";
  }) {
    return api<{ ok: true; rowIdx: number }>(
      "/api/auth/recover/add-mobile",
      { method: "POST", body: JSON.stringify(args) },
    );
  },

  // ── "Try another way" — registered-email path ──────────────────────
  async recoverEmailOptions(studentId: string) {
    return api<{ hasEmail: boolean; emailMasked?: string }>(
      "/api/auth/recover/email-options",
      { method: "POST", body: JSON.stringify({ studentId }) }
    );
  },
  async recoverRequestEmailOtp(studentId: string) {
    return api<{ ok: true; ttl: number; emailMasked: string }>(
      "/api/auth/recover/request-email-otp",
      { method: "POST", body: JSON.stringify({ studentId }) }
    );
  },
  async recoverVerifyEmailOtp(studentId: string, otp: string) {
    return api<{ ok: true }>("/api/auth/recover/verify-email-otp", {
      method: "POST",
      body: JSON.stringify({ studentId, otp }),
    });
  },

  async forgotPassword(phone: string) {
    return api<{ ok: true }>("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ phone }),
    });
  },

  async forgotPasswordComplete(phone: string, otp: string, password: string) {
    const r = await api<{ ok: true }>("/api/auth/forgot-password/complete", {
      method: "POST",
      body: JSON.stringify({ phone, otp, password }),
    });
    clearMeCache();
    return r;
  },

  async logout() {
    const r = await api<{ ok: true }>("/api/auth/logout", { method: "POST" });
    clearMeCache();
    return r;
  },
};
