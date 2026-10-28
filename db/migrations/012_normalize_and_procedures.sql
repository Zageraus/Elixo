-- =====================================================================
-- HealthChain: 3NF clean-up, stored procedure, search indexes
-- (Migration 012)
--
-- * prescriptions.medications was a JSONB array (a repeating group, so not
--   1NF). Each medicine is now a row in prescription_items, numbered by
--   line_no so the prescription hash (anchored on-chain) is rebuilt in the
--   same order as before.
-- * payments.patient_id / doctor_id depended on appointment_id (which is
--   NOT NULL and UNIQUE), a transitive dependency. They are dropped; the
--   patient and doctor are read through the appointment.
-- * prescriptions keeps patient_id / doctor_id because appointment_id is
--   optional (a prescription can be issued without a visit). A trigger now
--   makes sure they match the appointment whenever one is linked.
-- * sp_create_prescription: stored procedure that writes a prescription
--   and its items atomically.
-- * pg_trgm indexes so the admin user search (ILIKE '%term%') can use an
--   index, plus an index for paging notifications newest-first.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PRESCRIPTION ITEMS
-- ---------------------------------------------------------------------
create table prescription_items (
    id              uuid primary key default gen_random_uuid(),
    prescription_id uuid not null references prescriptions(id) on delete cascade,
    line_no         smallint not null check (line_no > 0),
    medicine_name   text not null check (length(trim(medicine_name)) > 0),
    dosage          text not null,
    frequency       text not null,
    duration_days   integer not null check (duration_days > 0),

    constraint uq_prescription_line unique (prescription_id, line_no)
);

insert into prescription_items (prescription_id, line_no, medicine_name, dosage, frequency, duration_days)
select p.id, m.ord::smallint, m.item->>'name', m.item->>'dosage', m.item->>'frequency', (m.item->>'duration_days')::integer
from prescriptions p
cross join lateral jsonb_array_elements(p.medications) with ordinality as m(item, ord);

alter table prescriptions drop column medications;

alter table prescription_items enable row level security;

create policy p_prescription_items_select on prescription_items
    for select using (
        exists (
            select 1 from prescriptions pr
            where pr.id = prescription_items.prescription_id
              and (pr.patient_id = fn_current_user_id()
                   or pr.doctor_id = fn_current_user_id()
                   or fn_current_user_role() = 'admin')
        )
    );

-- ---------------------------------------------------------------------
-- PAYMENTS: remove the transitively dependent columns
-- ---------------------------------------------------------------------
drop policy p_payments_select on payments;

alter table payments
    drop constraint chk_payment_roles,
    drop column patient_id,
    drop column doctor_id;

create policy p_payments_select on payments
    for select using (
        fn_current_user_role() = 'admin'
        or exists (
            select 1 from appointments a
            where a.id = payments.appointment_id
              and (a.patient_id = fn_current_user_id() or a.doctor_id = fn_current_user_id())
        )
    );

-- ---------------------------------------------------------------------
-- PRESCRIPTIONS: linked appointment must agree on patient and doctor
-- ---------------------------------------------------------------------
create or replace function fn_check_prescription_appointment()
returns trigger as $$
begin
    if new.appointment_id is not null and not exists (
        select 1 from appointments a
        where a.id = new.appointment_id
          and a.patient_id = new.patient_id
          and a.doctor_id = new.doctor_id
    ) then
        raise exception 'The linked appointment belongs to a different patient or doctor'
            using errcode = '23514';
    end if;
    return new;
end;
$$ language plpgsql;

create trigger trg_check_prescription_appointment
    before insert or update on prescriptions
    for each row execute function fn_check_prescription_appointment();

-- ---------------------------------------------------------------------
-- STORED PROCEDURE: create a prescription with its items in one unit
-- p_items is a JSON array of {name, dosage, frequency, duration_days}.
-- Everything runs in the caller's transaction, so a bad item rolls back
-- the prescription header too.
-- ---------------------------------------------------------------------
create or replace procedure sp_create_prescription(
    p_doctor_id         uuid,
    p_patient_id        uuid,
    p_appointment_id    uuid,
    p_notes             text,
    p_items             jsonb,
    inout p_prescription_id uuid default null
)
language plpgsql
as $$
begin
    if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
        raise exception 'A prescription needs at least one medication' using errcode = '22023';
    end if;

    if not exists (select 1 from users where id = p_patient_id and role = 'patient' and is_active) then
        raise exception 'Patient not found or inactive' using errcode = 'P0002';
    end if;

    insert into prescriptions (appointment_id, patient_id, doctor_id, notes)
    values (p_appointment_id, p_patient_id, p_doctor_id, nullif(trim(p_notes), ''))
    returning id into p_prescription_id;

    insert into prescription_items (prescription_id, line_no, medicine_name, dosage, frequency, duration_days)
    select p_prescription_id, t.ord::smallint, t.item->>'name', t.item->>'dosage', t.item->>'frequency',
           (t.item->>'duration_days')::integer
    from jsonb_array_elements(p_items) with ordinality as t(item, ord);
end;
$$;

-- ---------------------------------------------------------------------
-- INDEXES for search and paging
-- ---------------------------------------------------------------------
create extension if not exists pg_trgm;

create index idx_users_full_name_trgm on users using gin (full_name gin_trgm_ops);
create index idx_users_email_trgm on users using gin ((email::text) gin_trgm_ops);
create index idx_notif_user_created on notifications(user_id, created_at desc);
create index idx_presc_issued on prescriptions(issued_at desc);
create index idx_reports_created on medical_reports(created_at desc);
