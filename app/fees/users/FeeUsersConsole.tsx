"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The fee-ledger account manager. Same art direction as the ledger: paper
 * ground, ruled rows, no cards.
 *
 * Passwords are shown ONCE, at the moment they are set, because nothing
 * stores them afterwards — the hash is one-way. That is also why the
 * generator is here: an admin handing out a login should not have to invent
 * a good password under time pressure.
 */

type FeeUser = {
  id: string;
  email: string;
  name: string | null;
  status: string;
  roleSlug: string;
  roleName: string;
  lastLoginAt: string | null;
  createdAt: string | null;
};
type Role = { slug: string; name: string; description: string | null };

function fmtDate(d: string | null) {
  if (!d) return "never";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "—";
  return t.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** Ambiguous glyphs are dropped: these get read aloud and typed by hand. */
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generatePassword() {
  const bytes = new Uint32Array(16);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `Fee-${body}`;
}

export default function FeeUsersConsole({ currentEmail }: { currentEmail: string }) {
  const [users, setUsers] = useState<FeeUser[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The one moment a plaintext password exists in the UI. */
  const [reveal, setReveal] = useState<{ email: string; password: string } | null>(null);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [roleSlug, setRoleSlug] = useState("fees-viewer");

  const load = useCallback(() => {
    setBusy(true);
    fetch("/api/admin/fees/users")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || `Failed to load (${r.status})`);
        setUsers(d.users ?? []);
        setRoles(d.roles ?? []);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setBusy(false));
  }, []);
  useEffect(load, [load]);

  const send = useCallback(
    async (method: "POST" | "PATCH", body: Record<string, unknown>, ok: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const r = await fetch("/api/admin/fees/users", {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || `Failed (${r.status})`);
        if (d.users) setUsers(d.users);
        setNotice(ok);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
        return false;
      } finally {
        setBusy(false);
      }
    },
    []
  );

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    const pw = password || generatePassword();
    const ok = await send("POST", { email, name, password: pw, roleSlug }, `Created ${email}`);
    if (ok) {
      setReveal({ email, password: pw });
      setEmail("");
      setName("");
      setPassword("");
    }
  }

  async function resetPassword(u: FeeUser) {
    const pw = generatePassword();
    const ok = await send(
      "PATCH",
      { id: u.id, action: "reset-password", password: pw },
      `New password set for ${u.email}`
    );
    if (ok) setReveal({ email: u.email, password: pw });
  }

  return (
    <div className="fx">
      {busy ? <div className="fx-sweep"><i /></div> : null}

      <header className="fx-top">
        <div>
          <div className="fx-rule-eyebrow">
            <span className="kicker">Fee ledger · Access</span>
          </div>
          <h1 className="fx-title">
            Who can<br />
            <em>see the ledger.</em>
          </h1>
          <p className="fx-sub">
            Accounts here reach the fee ledger and nothing else — no orders, no catalog,
            no student records outside the fees they are billed. Staff admin accounts are
            managed separately and cannot be seen or changed from this page.
          </p>
        </div>
        <div className="fx-top-right">
          <div className="fx-account">
            {currentEmail ? <span className="fx-account-who mono">{currentEmail}</span> : null}
            <a className="fx-page" href="/fees">← Fee ledger</a>
            <button
              className="fx-page"
              onClick={() => {
                fetch("/api/fees/auth/logout", { method: "POST" }).then(() => {
                  window.location.href = "/fees/login";
                });
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {reveal ? (
        <div className="fu-reveal">
          <div className="kicker">Password for {reveal.email}</div>
          <div className="fu-reveal-pw mono">{reveal.password}</div>
          <p>
            Copy it now — it is not stored anywhere and cannot be shown again. If it is
            lost, set a new one with Reset password.
          </p>
          <div className="fu-reveal-actions">
            <button
              className="fx-page"
              onClick={() => navigator.clipboard?.writeText(reveal.password)}
            >
              Copy password
            </button>
            <button className="fx-page" onClick={() => setReveal(null)}>Done</button>
          </div>
        </div>
      ) : null}

      {error ? <div className="fu-msg is-bad">{error}</div> : null}
      {notice && !reveal ? <div className="fu-msg is-good">{notice}</div> : null}

      <div className="fx-sec">
        <h2>01 — Add an account</h2>
        <span className="kicker">Leave the password blank to generate a strong one</span>
      </div>
      <form className="fu-form" onSubmit={createUser}>
        <label>
          <span className="kicker">Email</span>
          <input
            className="fx-input mono"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@inventre.in"
          />
        </label>
        <label>
          <span className="kicker">Name</span>
          <input
            className="fx-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Fee desk — Keesara"
          />
        </label>
        <label>
          <span className="kicker">Password</span>
          <input
            className="fx-input mono"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="auto-generate"
          />
        </label>
        <label>
          <span className="kicker">Access</span>
          <select
            className="fx-select"
            value={roleSlug}
            onChange={(e) => setRoleSlug(e.target.value)}
          >
            {roles.map((r) => (
              <option key={r.slug} value={r.slug}>{r.name}</option>
            ))}
          </select>
        </label>
        <button className="fx-page fu-submit" disabled={busy}>Create account</button>
      </form>
      <p className="fu-hint">
        <b>View only</b> opens the ledger and its receipts. <b>Admin</b> can additionally
        add and remove accounts on this page.
      </p>

      <div className="fx-sec">
        <h2>02 — Accounts</h2>
        <span className="kicker">{users ? `${users.length} with fee-ledger access` : "loading"}</span>
      </div>
      <div className="fx-tablewrap">
        <table className="fx-table">
          <thead>
            <tr>
              <th style={{ width: "26%" }}>Account</th>
              <th style={{ width: "20%" }}>Access</th>
              <th style={{ width: "12%" }}>Status</th>
              <th style={{ width: "14%" }}>Last login</th>
              <th style={{ width: "28%" }} />
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u) => {
              const isSelf = u.email === currentEmail;
              return (
                <tr key={u.id}>
                  <td>
                    <div className="fx-name">{u.name || u.email}</div>
                    <div className="fx-id">
                      {u.email}
                      {isSelf ? " · you" : ""}
                    </div>
                  </td>
                  <td>
                    <select
                      className="fx-select"
                      value={u.roleSlug}
                      disabled={busy || isSelf}
                      onChange={(e) =>
                        send(
                          "PATCH",
                          { id: u.id, action: "set-role", roleSlug: e.target.value },
                          `${u.email} access updated`
                        )
                      }
                    >
                      {roles.map((r) => (
                        <option key={r.slug} value={r.slug}>{r.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span className={`fx-tag ${u.status === "active" ? "paid" : "due"}`}>
                      {u.status}
                    </span>
                  </td>
                  <td className="mono fx-dim">{fmtDate(u.lastLoginAt)}</td>
                  <td className="fu-actions">
                    <button className="fx-page" disabled={busy} onClick={() => resetPassword(u)}>
                      Reset password
                    </button>
                    <button
                      className="fx-page"
                      disabled={busy || isSelf}
                      onClick={() =>
                        send(
                          "PATCH",
                          {
                            id: u.id,
                            action: "set-status",
                            status: u.status === "active" ? "blocked" : "active",
                          },
                          `${u.email} ${u.status === "active" ? "blocked" : "enabled"}`
                        )
                      }
                    >
                      {u.status === "active" ? "Disable" : "Enable"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {users && users.length === 0 ? <div className="fx-empty">No accounts yet</div> : null}
      </div>

      <footer className="fx-colophon">
        <span>Fee-ledger accounts only · staff admins are managed in /admin</span>

      </footer>
    </div>
  );
}
