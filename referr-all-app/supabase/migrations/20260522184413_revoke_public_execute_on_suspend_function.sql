/*
  # Revoke PUBLIC execute on check_block_count_and_suspend

  1. Security Fix
    - Revoke EXECUTE from PUBLIC pseudo-role (which implicitly grants to anon and authenticated)
    - Re-grant only to postgres and service_role which need it for trigger execution
    - This prevents the function from being callable via the REST API by any client

  2. Important Notes
    - The function is only used as a trigger on user_blocks table
    - It does not need to be exposed via PostgREST RPC
*/

REVOKE EXECUTE ON FUNCTION public.check_block_count_and_suspend() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_block_count_and_suspend() FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_block_count_and_suspend() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_block_count_and_suspend() TO postgres;
GRANT EXECUTE ON FUNCTION public.check_block_count_and_suspend() TO service_role;
