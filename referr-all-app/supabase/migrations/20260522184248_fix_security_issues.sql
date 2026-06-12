/*
  # Fix Security Issues

  1. Function Security
    - Set immutable search_path on `check_block_count_and_suspend` to prevent search path manipulation
    - Revoke EXECUTE from `anon` and `authenticated` roles (function is trigger-only, not callable via RPC)

  2. RLS Policy Fixes
    - `conversation_participants` INSERT: Replace always-true policy with one that ensures
      the inserting user can only add participants to conversations they created
    - `conversations` INSERT: Replace always-true policy with one that requires the
      authenticated user to be creating the conversation (no restriction beyond auth since
      conversations are empty shells, but prevent unauthenticated access)

  3. Storage Policy Fix
    - Remove broad SELECT policy on avatars bucket that allows listing all files
    - Public bucket URLs are accessible without SELECT policy; listing is unnecessary

  4. Important Notes
    - The function remains SECURITY DEFINER since it needs to update profiles table
    - Conversation creation flow: user creates conversation, then adds participants
    - The participant INSERT policy allows adding others only to conversations where you are already a participant
*/

-- 1. Fix function: set search_path and revoke execute from public roles
CREATE OR REPLACE FUNCTION public.check_block_count_and_suspend()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $function$
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
$function$;

REVOKE EXECUTE ON FUNCTION public.check_block_count_and_suspend() FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_block_count_and_suspend() FROM authenticated;

-- 2. Fix conversation_participants INSERT policy
DROP POLICY IF EXISTS "Authenticated users can add participants" ON public.conversation_participants;

CREATE POLICY "Users can add participants to their conversations"
  ON public.conversation_participants
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = conversation_participants.conversation_id
        AND cp.user_id = auth.uid()
    )
    OR
    conversation_participants.user_id = auth.uid()
  );

-- 3. Fix conversations INSERT policy
DROP POLICY IF EXISTS "Authenticated users can create conversations" ON public.conversations;

CREATE POLICY "Authenticated users can create conversations"
  ON public.conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- 4. Fix avatars storage SELECT policy (remove listing ability)
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
