"use client";

/**
 * Profile — the editable facts about a user: name and email.
 *
 * Until this existed the only way to change a user's name or email was the
 * old inline list editor, which is gone. The record page showed the values
 * and offered no way to change them, so "Edit User" — the action the spec
 * put on this page — did not exist anywhere.
 *
 * Scope (the school an account is narrowed to) is NOT here: it only applies
 * to school-side roles, so it lives under the role selector on the Role card
 * and appears only when such a role is chosen.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Save } from "lucide-react";
import { Button, Card, Field, Input } from "@/components/admin/ui/primitives";

export function UserProfileCard({
  user,
  canWrite,
}: {
  user: { id: string; name: string | null; email: string };
  canWrite: boolean;
}) {
  const router = useRouter();
  const [name, setName] = React.useState(user.name ?? "");
  const [email, setEmail] = React.useState(user.email);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    setName(user.name ?? "");
    setEmail(user.email);
  }, [user.name, user.email]);

  const dirty =
    name.trim() !== (user.name ?? "").trim() ||
    email.trim().toLowerCase() !== user.email;

  const save = async () => {
    if (!email.trim()) {
      setError("Email is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || null,
          email: email.trim().toLowerCase(),
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? `Could not save the profile (${res.status}).`);
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Network error — nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 className="text-[15px] font-bold text-ink-900">Profile</h2>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Full name" htmlFor="profile-name">
          <Input
            id="profile-name"
            value={name}
            onChange={(e) => { setName(e.target.value); setSaved(false); }}
            disabled={!canWrite}
            placeholder="Not set"
            autoComplete="off"
          />
        </Field>
        <Field label="Email" htmlFor="profile-email" required>
          <Input
            id="profile-email"
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setSaved(false); }}
            disabled={!canWrite}
            autoComplete="off"
            invalid={Boolean(error) && !email.trim()}
          />
        </Field>
      </div>

      {error ? (
        <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[12.5px] font-medium text-red-700">
          {error}
        </div>
      ) : null}

      {canWrite ? (
        <div className="mt-3 flex items-center justify-end gap-3 border-t border-ink-100 pt-3">
          {saved && !dirty ? (
            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-emerald-700">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
          ) : null}
          <Button icon={<Save className="h-3.5 w-3.5" />} onClick={save} busy={busy} disabled={!dirty}>
            Save profile
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
