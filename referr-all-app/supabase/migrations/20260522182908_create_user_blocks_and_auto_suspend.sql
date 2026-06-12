/*
  # Create user_blocks table with auto-suspend on 10 blocks

  1. New Tables
    - `user_blocks`
      - `id` (uuid, primary key)
      - `blocker_id` (uuid, references profiles) - the user doing the blocking
      - `blocked_id` (uuid, references profiles) - the user being blocked
      - `created_at` (timestamptz)
      - Unique constraint on (blocker_id, blocked_id) to prevent duplicate blocks

  2. Modified Tables
    - `profiles`
      - Added `is_suspended` (boolean, default false) - whether the user is permanently suspended

  3. Security
    - RLS enabled on user_blocks
    - Users can view their own blocks
    - Users can insert blocks (block someone)
    - Users can delete their own blocks (unblock someone)

  4. Auto-suspend trigger
    - After inserting a block, counts total distinct blockers for the blocked user
    - If count reaches 10 or more, sets is_suspended = true on their profile

  5. Important Notes
    - The Ten-Block Rule is a core trust & safety mechanism per the ToS
    - Suspended accounts cannot be reactivated through normal means
    - A user cannot block themselves
*/

-- Add is_suspended column to profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'is_suspended'
  ) THEN
    ALTER TABLE profiles ADD COLUMN is_suspended boolean DEFAULT false;
  END IF;
END $$;

-- Create user_blocks table
CREATE TABLE IF NOT EXISTS user_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT user_blocks_no_self_block CHECK (blocker_id != blocked_id),
  CONSTRAINT user_blocks_unique UNIQUE (blocker_id, blocked_id)
);

ALTER TABLE user_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own blocks"
  ON user_blocks FOR SELECT
  TO authenticated
  USING (auth.uid() = blocker_id);

CREATE POLICY "Users can block others"
  ON user_blocks FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = blocker_id AND blocker_id != blocked_id);

CREATE POLICY "Users can unblock others"
  ON user_blocks FOR DELETE
  TO authenticated
  USING (auth.uid() = blocker_id);

-- Function to check block count and suspend if >= 10
CREATE OR REPLACE FUNCTION check_block_count_and_suspend()
RETURNS TRIGGER AS $$
DECLARE
  block_count int;
BEGIN
  SELECT COUNT(*) INTO block_count
  FROM user_blocks
  WHERE blocked_id = NEW.blocked_id;

  IF block_count >= 10 THEN
    UPDATE profiles
    SET is_suspended = true, updated_at = now()
    WHERE id = NEW.blocked_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on insert
DROP TRIGGER IF EXISTS trigger_check_block_count ON user_blocks;
CREATE TRIGGER trigger_check_block_count
  AFTER INSERT ON user_blocks
  FOR EACH ROW
  EXECUTE FUNCTION check_block_count_and_suspend();

-- Index for fast count lookups
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked_id ON user_blocks(blocked_id);