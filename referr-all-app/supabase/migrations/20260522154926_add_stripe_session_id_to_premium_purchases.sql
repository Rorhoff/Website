/*
  # Add stripe_session_id to premium_purchases

  Adds a stripe_session_id column to track which Stripe Checkout session
  fulfilled each premium purchase. This ensures idempotency in the webhook
  and links database records to Stripe payments.

  1. Changes
    - `premium_purchases`: add `stripe_session_id` (text, nullable, unique)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'premium_purchases' AND column_name = 'stripe_session_id'
  ) THEN
    ALTER TABLE premium_purchases ADD COLUMN stripe_session_id text UNIQUE;
  END IF;
END $$;
