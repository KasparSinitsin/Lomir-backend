ALTER TABLE users
  ADD COLUMN IF NOT EXISTS accepted_terms_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_privacy_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_age_16_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_terms_version TEXT,
  ADD COLUMN IF NOT EXISTS accepted_privacy_version TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_age_16_version TEXT;
