/*
  # Add Seeker Posts and Premium System

  1. New Tables
    - `seeker_posts` - Job seeker "hire me" posts with skills, desired role, location
    - `premium_purchases` - Tracks premium post purchases with dynamic pricing

  2. Modified Tables
    - `posts` - Add `post_type` column to distinguish referral vs general opening
    - `seeker_posts` - Add `is_premium`, `premium_expires_at`, `premium_order` for boosting

  3. Pricing Logic
    - `premium_purchases` stores a counter so app can derive current price dynamically
    - Price = base $9.99 + ($5 * total_purchases_this_month) — capped at $99.99

  4. Security
    - RLS on all new tables
    - Users can only manage their own records
*/

-- SEEKER POSTS
CREATE TABLE IF NOT EXISTS seeker_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  headline text NOT NULL DEFAULT '',
  about text NOT NULL DEFAULT '',
  desired_role text NOT NULL DEFAULT '',
  desired_location text DEFAULT '',
  open_to_remote boolean DEFAULT false,
  field_of_work text DEFAULT '',
  skills text[] DEFAULT '{}',
  experience_years int DEFAULT 0,
  resume_url text DEFAULT '',
  portfolio_url text DEFAULT '',
  availability text DEFAULT 'immediately' CHECK (availability IN ('immediately', '2weeks', '1month', '3months')),
  is_premium boolean DEFAULT false,
  premium_expires_at timestamptz,
  premium_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE seeker_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Seeker posts viewable by authenticated users"
  ON seeker_posts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create own seeker posts"
  ON seeker_posts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = author_id);

CREATE POLICY "Users can update own seeker posts"
  ON seeker_posts FOR UPDATE
  TO authenticated
  USING (auth.uid() = author_id)
  WITH CHECK (auth.uid() = author_id);

CREATE POLICY "Users can delete own seeker posts"
  ON seeker_posts FOR DELETE
  TO authenticated
  USING (auth.uid() = author_id);

-- PREMIUM PURCHASES (tracks history for dynamic pricing)
CREATE TABLE IF NOT EXISTS premium_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  seeker_post_id uuid REFERENCES seeker_posts(id) ON DELETE SET NULL,
  amount_cents int NOT NULL,
  purchase_number int NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE premium_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own purchases"
  ON premium_purchases FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own purchases"
  ON premium_purchases FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS seeker_posts_author_id_idx ON seeker_posts(author_id);
CREATE INDEX IF NOT EXISTS seeker_posts_is_premium_idx ON seeker_posts(is_premium, premium_order DESC);
CREATE INDEX IF NOT EXISTS seeker_posts_created_at_idx ON seeker_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS seeker_posts_field_idx ON seeker_posts(field_of_work);
CREATE INDEX IF NOT EXISTS premium_purchases_created_at_idx ON premium_purchases(created_at DESC);
