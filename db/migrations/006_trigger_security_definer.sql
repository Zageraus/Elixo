-- =====================================================================
-- HealthChain: Trigger functions run as their owner (Migration 006)
--
-- The audit, notification, and role-check triggers fire on writes made
-- through the RLS-scoped client, so they ran as the requesting user and
-- were blocked by RLS: audit_logs has no insert policy, notifications only
-- accepts rows for the current user, and users rows of other people are
-- hidden. Running them as SECURITY DEFINER lets these system-side writes
-- and lookups through while the user's own write is still checked by RLS.
-- =====================================================================

alter function fn_audit_trigger() security definer set search_path = public;
alter function fn_notify_appointment_change() security definer set search_path = public;
alter function fn_notify_new_report() security definer set search_path = public;
alter function fn_notify_new_prescription() security definer set search_path = public;
alter function fn_check_doctor_role() security definer set search_path = public;
