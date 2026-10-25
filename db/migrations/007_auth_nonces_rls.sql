-- =====================================================================
-- HealthChain: Lock down auth_nonces (Migration 007)
--
-- auth_nonces had RLS disabled, so anyone holding the public anon key
-- could read or insert sign-in nonces through the REST API. The backend
-- only touches this table with the service-role key, which bypasses RLS,
-- so enabling RLS with no policies blocks public access without breaking
-- wallet sign-in.
-- =====================================================================

alter table auth_nonces enable row level security;
