/*
  # Add required_skills column to posts table

  1. Modified Tables
    - `posts`
      - Added `required_skills` (text array) - Top skills required for the job, displayed to seekers

  2. Notes
    - The referral_bonus and has_bonus columns are kept in the database for data integrity
      but will no longer be shown in the UI
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'posts' AND column_name = 'required_skills'
  ) THEN
    ALTER TABLE posts ADD COLUMN required_skills text[] DEFAULT '{}';
  END IF;
END $$;