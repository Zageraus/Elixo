-- =====================================================================
-- HealthChain: Appointment notification tweaks (Migration 009)
--
-- * Show appointment times in IST instead of UTC.
-- * Skip the generic "status changed" notice when the appointment's doctor
--   has been deactivated: the backend sends each affected patient one
--   specific message instead (see admin.routes.ts).
-- =====================================================================

create or replace function fn_notify_appointment_change()
returns trigger as $$
begin
    if TG_OP = 'INSERT' then
        insert into notifications (user_id, type, message)
        values (new.doctor_id, 'appointment',
                format('New appointment requested for %s IST',
                       to_char(new.scheduled_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')));
    elsif TG_OP = 'UPDATE' and old.status <> new.status
          and exists (select 1 from users where id = new.doctor_id and is_active) then
        insert into notifications (user_id, type, message)
        values (new.patient_id, 'appointment',
                format('Your appointment on %s IST is now %s',
                       to_char(new.scheduled_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM'),
                       replace(new.status::text, '_', ' ')));
    end if;
    return new;
end;
$$ language plpgsql security definer set search_path = public;
