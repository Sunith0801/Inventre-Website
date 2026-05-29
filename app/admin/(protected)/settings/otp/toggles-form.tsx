"use client";

import { useState } from "react";

type Props = {
  initial: { smsRealSend: boolean; emailRealSend: boolean };
};

export function OtpTogglesForm({ initial }: Props) {
  const [sms, setSms] = useState(initial.smsRealSend);
  const [email, setEmail] = useState(initial.emailRealSend);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/settings/otp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ smsRealSend: sms, emailRealSend: email }),
      });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok ? "Saved" : `Failed: ${j.error ?? r.status}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Row
        label="Real SMS sending"
        description="When ON, OTPs are sent via the SMS provider. When OFF, the OTP falls back to the bypass code configured in .env.deploy (OTP_BYPASS_CODE)."
        checked={sms}
        onChange={setSms}
      />
      <Row
        label="Real email (SMTP) sending"
        description="When ON, recovery OTPs are emailed via SMTP/Resend. When OFF, the OTP falls back to the bypass code configured in .env.deploy."
        checked={email}
        onChange={setEmail}
      />
      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-brand text-white px-4 py-2 text-[13px] font-semibold disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {msg ? <span className="text-[12px] text-ink-500">{msg}</span> : null}
      </div>
    </div>
  );
}

function Row({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-xl border border-ink-100 bg-white p-4 cursor-pointer">
      <span className="flex-1">
        <span className="block text-[13px] font-semibold text-ink-900">{label}</span>
        <span className="mt-1 block text-[12px] text-ink-500 leading-relaxed">
          {description}
        </span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-5 w-5 accent-brand"
      />
    </label>
  );
}
