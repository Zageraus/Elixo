-- =====================================================================
-- HealthChain: Consultation payments (Migration 008)
--
-- Flow: a patient books for free; once the doctor accepts (status
-- 'confirmed'), the patient pays the doctor's consultation fee. Payments
-- are simulated (provider = 'simulated'): no external gateway, no card
-- data is collected. If a paid appointment is later cancelled, the
-- payment is marked refunded automatically.
-- =====================================================================

create type payment_status as enum ('paid', 'refunded');
create type payment_method as enum ('upi', 'card', 'netbanking');

create table payments (
    id              uuid primary key default gen_random_uuid(),
    appointment_id  uuid not null unique references appointments(id) on delete cascade,  -- one payment per visit
    patient_id      uuid not null references users(id) on delete cascade,
    doctor_id       uuid not null references users(id) on delete cascade,
    amount          numeric(10,2) not null check (amount > 0),   -- fee snapshot at payment time
    currency        char(3) not null default 'INR',
    method          payment_method not null,
    provider        text not null default 'simulated',
    provider_ref    text not null unique,                         -- receipt number
    status          payment_status not null default 'paid',
    paid_at         timestamptz not null default now(),
    refunded_at     timestamptz,

    constraint chk_payment_roles check (patient_id <> doctor_id),
    constraint chk_refund_time check ((status = 'refunded') = (refunded_at is not null))
);

create index idx_payments_patient on payments(patient_id);
create index idx_payments_doctor on payments(doctor_id);
create index idx_payments_status on payments(status);

-- Audit every change like the other clinical tables.
create trigger trg_audit_payments
    after insert or update or delete on payments
    for each row execute function fn_audit_trigger();

-- Cancelling a paid appointment refunds it.
create or replace function fn_refund_on_cancel()
returns trigger as $$
begin
    if new.status = 'cancelled' and old.status <> 'cancelled' then
        update payments
           set status = 'refunded', refunded_at = now()
         where appointment_id = new.id and status = 'paid';
    end if;
    return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_refund_on_cancel
    after update of status on appointments
    for each row execute function fn_refund_on_cancel();

-- RLS: patient and doctor see their own payments, admin sees all. There
-- is no insert/update policy: the backend creates payments with the
-- service role after checking the appointment and fee server-side.
alter table payments enable row level security;

create policy p_payments_select on payments
    for select using (
        patient_id = fn_current_user_id()
        or doctor_id = fn_current_user_id()
        or fn_current_user_role() = 'admin'
    );

-- Admin analytics: add payment figures (new columns go at the end so
-- create or replace view keeps the existing ones).
create or replace view v_admin_analytics as
select
    (select count(*) from users where role = 'patient')                          as total_patients,
    (select count(*) from users where role = 'doctor')                           as total_doctors,
    (select count(*) from appointments)                                          as total_appointments,
    (select count(*) from appointments where status = 'completed')               as completed_appointments,
    (select count(*) from medical_reports)                                       as total_reports,
    (select count(*) from ai_analyses)                                           as total_ai_analyses,
    (select count(*) from prescriptions)                                         as total_prescriptions,
    (select count(*) from blockchain_transactions where status = 'confirmed')    as confirmed_chain_txs,
    (select count(*) from blockchain_transactions where status = 'pending')      as pending_chain_txs,
    (select round(avg(extract(epoch from confirmed_at - created_at))::numeric, 1)
       from blockchain_transactions where status = 'confirmed')                  as avg_confirmation_seconds,
    (select coalesce(sum(amount), 0) from payments where status = 'paid')        as total_revenue,
    (select count(*) from payments where status = 'paid')                        as paid_payments,
    (select coalesce(sum(amount), 0) from payments where status = 'refunded')    as total_refunded,
    (select count(*) from appointments a
       join doctor_profiles dp on dp.user_id = a.doctor_id and dp.consultation_fee > 0
      where a.status in ('confirmed', 'completed')
        and not exists (select 1 from payments p where p.appointment_id = a.id)) as awaiting_payment;
