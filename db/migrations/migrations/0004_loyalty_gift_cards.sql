-- Loyalty ledger
CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id          BIGSERIAL PRIMARY KEY,
  parent_id   UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  delta       INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  ref_type    TEXT,
  ref_id      TEXT,
  notes       TEXT,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS loyalty_ledger_parent_idx
  ON loyalty_ledger (parent_id, created_at DESC);

-- Gift cards
CREATE TABLE IF NOT EXISTS gift_cards (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                   TEXT NOT NULL,
  initial_balance        INTEGER NOT NULL,
  current_balance        INTEGER NOT NULL,
  issued_to_parent_id    UUID REFERENCES parents(id),
  issued_to_email        TEXT,
  issued_to_phone        TEXT,
  issued_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at             TIMESTAMPTZ,
  status                 TEXT NOT NULL DEFAULT 'active',
  notes                  TEXT,
  created_by             UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_cards_code_idx ON gift_cards (code);
CREATE INDEX IF NOT EXISTS gift_cards_status_idx ON gift_cards (status);

CREATE TABLE IF NOT EXISTS gift_card_redemptions (
  id            BIGSERIAL PRIMARY KEY,
  gift_card_id  UUID NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  order_id      UUID,
  amount        INTEGER NOT NULL,
  redeemed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gift_card_redemptions_card_idx
  ON gift_card_redemptions (gift_card_id);
