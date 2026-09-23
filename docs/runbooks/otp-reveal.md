# Revealing a parent's OTP (support)

Since 2026-09-24 the codes in `otp_logs` are encrypted at rest (Data Protection
plan P-01) and wiped 24 hours after sending. A support agent who needs to read
a code back to a parent whose SMS did not arrive:

1. Open **Admin → Tools → OTP Logs**, filter by the phone.
2. On the row, click **•••••• Reveal**, type the **key phrase**, press *Show*.
   The code shows for 60 seconds. Needs the `otp-logs.write` permission.
3. Every reveal (and every wrong phrase) is written to the Activity Log
   (`otp.reveal` / `otp.reveal_denied`) with who, when and which phone.
   Five reveals per agent per 10 minutes.

## Owner set-up (once)

`/root/Inventre/.env.deploy` has two lines:

```
OTP_LOG_KEY=<generated, do not change — changing it makes older codes unreadable>
OTP_REVEAL_PHRASE=            ← choose a phrase and fill it in; share it only with support leads
```

Empty phrase = Reveal disabled (codes are still stored encrypted). Empty key =
codes are not stored at all. After editing, redeploy the app.

## Legacy rows

Codes written before the change are plain text. Once the new build is live, run
once from `/root/Inventre` (reads the key from `.env.deploy`):

```
set -a; . .env.deploy; set +a; npx tsx scripts/otp-logs-seal-legacy.ts          # counts only
set -a; . .env.deploy; set +a; npx tsx scripts/otp-logs-seal-legacy.ts --apply  # seals ≤24 h old, nulls the rest
```

The nightly `data-retention` cron (rule R2) nulls any code older than 24 hours
from then on, and rule R1 deletes log rows after 90 days.
