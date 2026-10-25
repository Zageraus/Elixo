-- =====================================================================
-- HealthChain: Complete All-in-One Database Setup
-- Run this entire script in Supabase SQL Editor in one click.
-- =====================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 001_core_schema.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- =====================================================================
-- HealthChain: Core Schema (Migration 001)
-- Blockchain-authenticated, AI-augmented healthcare platform
-- Target: Supabase Postgres (>=15), pgcrypto + pgvector extensions
-- =====================================================================

create extension if not exists pgcrypto;   -- for gen_random_uuid()
create extension if not exists vector;     -- for embeddings (pgvector)
create extension if not exists citext;     -- case-insensitive text (wallet addresses, email)

-- ---------------------------------------------------------------------
-- ENUM TYPES
-- ---------------------------------------------------------------------
create type user_role as enum ('patient', 'doctor', 'admin');
create type appointment_status as enum ('requested', 'confirmed', 'completed', 'cancelled', 'no_show');
create type report_type as enum ('lab_result', 'imaging', 'discharge_summary', 'consultation_note', 'other');
create type tx_status as enum ('pending', 'confirmed', 'failed');
create type notification_type as enum ('appointment', 'report', 'prescription', 'system');

-- ---------------------------------------------------------------------
-- USERS  (identity anchored to an Ethereum wallet address)
-- ---------------------------------------------------------------------
create table users (
    id              uuid primary key default gen_random_uuid(),
    wallet_address  citext not null unique,          -- lowercase, unique EOA address
    role            user_role not null default 'patient',
    full_name       text not null,
    email           citext unique,
    phone           text,
    is_active       boolean not null default true,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    constraint chk_wallet_format check (wallet_address ~* '^0x[a-f0-9]{40}$')
);

create index idx_users_role on users(role);
create index idx_users_wallet on users(wallet_address);

-- ---------------------------------------------------------------------
-- AUTH NONCES  (SIWE-style: one-time nonce signed by the wallet)
-- ---------------------------------------------------------------------
create table auth_nonces (
    id              uuid primary key default gen_random_uuid(),
    wallet_address  citext not null,
    nonce           text not null unique,
    expires_at      timestamptz not null,
    consumed_at     timestamptz,
    created_at      timestamptz not null default now()
);

create index idx_auth_nonces_wallet on auth_nonces(wallet_address);
create index idx_auth_nonces_expiry on auth_nonces(expires_at) where consumed_at is null;

-- ---------------------------------------------------------------------
-- ROLE-SPECIFIC PROFILES  (1:1 extension tables -> keeps USERS lean/3NF)
-- ---------------------------------------------------------------------
create table doctor_profiles (
    user_id             uuid primary key references users(id) on delete cascade,
    specialization      text not null,
    license_number      text not null unique,
    years_experience    smallint check (years_experience >= 0),
    consultation_fee    numeric(10,2) check (consultation_fee >= 0),
    bio                 text
);

create table patient_profiles (
    user_id         uuid primary key references users(id) on delete cascade,
    date_of_birth   date,
    blood_group     text check (blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
    allergies       text,
    emergency_contact text
);

-- ---------------------------------------------------------------------
-- APPOINTMENTS
-- ---------------------------------------------------------------------
create table appointments (
    id              uuid primary key default gen_random_uuid(),
    patient_id      uuid not null references users(id) on delete cascade,
    doctor_id       uuid not null references users(id) on delete cascade,
    scheduled_at    timestamptz not null,
    status          appointment_status not null default 'requested',
    reason          text,
    notes           text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    constraint chk_appt_roles check (patient_id <> doctor_id)
);

create index idx_appt_patient on appointments(patient_id);
create index idx_appt_doctor on appointments(doctor_id);
create index idx_appt_status on appointments(status);
create index idx_appt_scheduled on appointments(scheduled_at);

-- ---------------------------------------------------------------------
-- MEDICAL REPORTS
-- ---------------------------------------------------------------------
create table medical_reports (
    id              uuid primary key default gen_random_uuid(),
    patient_id      uuid not null references users(id) on delete cascade,
    doctor_id       uuid references users(id) on delete set null,
    appointment_id  uuid references appointments(id) on delete set null,
    report_type     report_type not null default 'other',
    title           text not null,
    file_url        text not null,          -- Supabase Storage object path
    file_hash       text not null,          -- sha256 of file bytes (anchored on-chain)
    raw_text        text,                   -- extracted text used for RAG
    created_at      timestamptz not null default now(),

    constraint chk_file_hash_format check (file_hash ~* '^[a-f0-9]{64}$')
);

create index idx_reports_patient on medical_reports(patient_id);
create index idx_reports_doctor on medical_reports(doctor_id);
create index idx_reports_type on medical_reports(report_type);

-- ---------------------------------------------------------------------
-- AI ANALYSES  (RAG output linked 1:1 -> N with a report; embeddings for retrieval)
-- ---------------------------------------------------------------------
create table ai_analyses (
    id              uuid primary key default gen_random_uuid(),
    report_id       uuid not null references medical_reports(id) on delete cascade,
    summary         text not null,
    findings        jsonb not null default '{}'::jsonb,   -- structured: {flags:[...], severity:"..."}
    embedding       vector(1536),                          -- text-embedding-3-small dimension
    model_used      text not null,
    confidence      numeric(4,3) check (confidence between 0 and 1),
    created_at      timestamptz not null default now()
);

create index idx_ai_report on ai_analyses(report_id);
create index idx_ai_embedding on ai_analyses using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ---------------------------------------------------------------------
-- PRESCRIPTIONS
-- ---------------------------------------------------------------------
create table prescriptions (
    id              uuid primary key default gen_random_uuid(),
    appointment_id  uuid references appointments(id) on delete set null,
    patient_id      uuid not null references users(id) on delete cascade,
    doctor_id       uuid not null references users(id) on delete cascade,
    medications     jsonb not null,   -- [{name, dosage, frequency, duration_days}]
    notes           text,
    issued_at       timestamptz not null default now(),

    constraint chk_presc_roles check (patient_id <> doctor_id)
);

create index idx_presc_patient on prescriptions(patient_id);
create index idx_presc_doctor on prescriptions(doctor_id);

-- ---------------------------------------------------------------------
-- BLOCKCHAIN TRANSACTIONS  (audit anchoring for reports & prescriptions)
-- ---------------------------------------------------------------------
create table blockchain_transactions (
    id              uuid primary key default gen_random_uuid(),
    report_id       uuid references medical_reports(id) on delete set null,
    prescription_id uuid references prescriptions(id) on delete set null,
    chain           text not null default 'sepolia',
    tx_hash         text not null unique,
    block_number    bigint,
    data_hash       text not null,          -- the sha256 that was anchored
    status          tx_status not null default 'pending',
    gas_used        numeric(20,0),
    created_at      timestamptz not null default now(),
    confirmed_at    timestamptz,

    constraint chk_one_target check (
        (report_id is not null and prescription_id is null) or
        (report_id is null and prescription_id is not null)
    )
);

create index idx_btx_report on blockchain_transactions(report_id);
create index idx_btx_prescription on blockchain_transactions(prescription_id);
create index idx_btx_status on blockchain_transactions(status);

-- ---------------------------------------------------------------------
-- AUDIT LOGS  (generic append-only trail, populated by triggers below)
-- ---------------------------------------------------------------------
create table audit_logs (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid references users(id) on delete set null,
    action          text not null,           -- e.g. 'INSERT', 'UPDATE', 'ROLE_CHANGE'
    entity_type     text not null,           -- e.g. 'medical_reports'
    entity_id       uuid not null,
    metadata        jsonb not null default '{}'::jsonb,
    created_at      timestamptz not null default now()
);

create index idx_audit_entity on audit_logs(entity_type, entity_id);
create index idx_audit_user on audit_logs(user_id);
create index idx_audit_created on audit_logs(created_at);

-- ---------------------------------------------------------------------
-- NOTIFICATIONS
-- ---------------------------------------------------------------------
create table notifications (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references users(id) on delete cascade,
    type            notification_type not null,
    message         text not null,
    is_read         boolean not null default false,
    created_at      timestamptz not null default now()
);

create index idx_notif_user on notifications(user_id, is_read);


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 002_triggers.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- =====================================================================
-- HealthChain: Triggers (Migration 002)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Generic updated_at maintenance
-- ---------------------------------------------------------------------
create or replace function fn_set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

create trigger trg_users_updated_at
    before update on users
    for each row execute function fn_set_updated_at();

create trigger trg_appointments_updated_at
    before update on appointments
    for each row execute function fn_set_updated_at();

-- ---------------------------------------------------------------------
-- Audit logging: fires on every INSERT/UPDATE/DELETE to sensitive tables
-- Captures who (via app.current_user_id session var, set by backend),
-- what changed, and a JSON diff.
-- ---------------------------------------------------------------------
create or replace function fn_audit_trigger()
returns trigger as $$
declare
    v_user_id uuid;
    v_entity_id uuid;
begin
    begin
        v_user_id := nullif(current_setting('app.current_user_id', true), '')::uuid;
    exception when others then
        v_user_id := null;
    end;

    v_entity_id := coalesce((case when TG_OP = 'DELETE' then old.id else new.id end), gen_random_uuid());

    insert into audit_logs (user_id, action, entity_type, entity_id, metadata)
    values (
        v_user_id,
        TG_OP,
        TG_TABLE_NAME,
        v_entity_id,
        jsonb_build_object(
            'old', case when TG_OP in ('UPDATE','DELETE') then to_jsonb(old) else null end,
            'new', case when TG_OP in ('UPDATE','INSERT') then to_jsonb(new) else null end
        )
    );

    return coalesce(new, old);
end;
$$ language plpgsql;

create trigger trg_audit_medical_reports
    after insert or update or delete on medical_reports
    for each row execute function fn_audit_trigger();

create trigger trg_audit_prescriptions
    after insert or update or delete on prescriptions
    for each row execute function fn_audit_trigger();

create trigger trg_audit_appointments
    after insert or update or delete on appointments
    for each row execute function fn_audit_trigger();

create trigger trg_audit_users_role
    after update of role on users
    for each row execute function fn_audit_trigger();

-- ---------------------------------------------------------------------
-- Auto-notifications
-- ---------------------------------------------------------------------
create or replace function fn_notify_appointment_change()
returns trigger as $$
begin
    if TG_OP = 'INSERT' then
        insert into notifications (user_id, type, message)
        values (new.doctor_id, 'appointment',
                format('New appointment requested for %s', to_char(new.scheduled_at, 'YYYY-MM-DD HH24:MI')));
    elsif TG_OP = 'UPDATE' and old.status <> new.status then
        insert into notifications (user_id, type, message)
        values (new.patient_id, 'appointment',
                format('Your appointment status changed to %s', new.status));
    end if;
    return new;
end;
$$ language plpgsql;

create trigger trg_notify_appointment
    after insert or update on appointments
    for each row execute function fn_notify_appointment_change();

create or replace function fn_notify_new_report()
returns trigger as $$
begin
    insert into notifications (user_id, type, message)
    values (new.patient_id, 'report', format('A new medical report "%s" has been added', new.title));
    return new;
end;
$$ language plpgsql;

create trigger trg_notify_report
    after insert on medical_reports
    for each row execute function fn_notify_new_report();

create or replace function fn_notify_new_prescription()
returns trigger as $$
begin
    insert into notifications (user_id, type, message)
    values (new.patient_id, 'prescription', 'A new prescription has been issued for you');
    return new;
end;
$$ language plpgsql;

create trigger trg_notify_prescription
    after insert on prescriptions
    for each row execute function fn_notify_new_prescription();

-- ---------------------------------------------------------------------
-- Guard: only doctors/admins can be assigned as appointments.doctor_id
-- ---------------------------------------------------------------------
create or replace function fn_check_doctor_role()
returns trigger as $$
begin
    if not exists (select 1 from users where id = new.doctor_id and role in ('doctor','admin')) then
        raise exception 'doctor_id % does not reference a user with role doctor/admin', new.doctor_id;
    end if;
    if not exists (select 1 from users where id = new.patient_id and role = 'patient') then
        raise exception 'patient_id % does not reference a user with role patient', new.patient_id;
    end if;
    return new;
end;
$$ language plpgsql;

create trigger trg_check_appt_roles
    before insert or update on appointments
    for each row execute function fn_check_doctor_role();


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 003_views.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- =====================================================================
-- HealthChain: Views (Migration 003)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Patient dashboard: everything relevant to one patient, pre-joined
-- ---------------------------------------------------------------------
create or replace view v_patient_dashboard as
select
    u.id                as patient_id,
    u.full_name,
    a.id                as appointment_id,
    a.scheduled_at,
    a.status            as appointment_status,
    d.full_name          as doctor_name,
    dp.specialization
from users u
join appointments a on a.patient_id = u.id
join users d on d.id = a.doctor_id
left join doctor_profiles dp on dp.user_id = d.id
where u.role = 'patient';

-- ---------------------------------------------------------------------
-- Doctor dashboard: upcoming appointments + patient report counts
-- ---------------------------------------------------------------------
create or replace view v_doctor_dashboard as
select
    doc.id                  as doctor_id,
    doc.full_name           as doctor_name,
    a.id                    as appointment_id,
    a.scheduled_at,
    a.status,
    p.id                    as patient_id,
    p.full_name             as patient_name,
    (select count(*) from medical_reports mr where mr.patient_id = p.id) as patient_report_count
from users doc
join appointments a on a.doctor_id = doc.id
join users p on p.id = a.patient_id
where doc.role = 'doctor';

-- ---------------------------------------------------------------------
-- Report + latest AI analysis, joined for the report detail screen
-- ---------------------------------------------------------------------
create or replace view v_report_with_analysis as
select
    mr.id               as report_id,
    mr.patient_id,
    mr.doctor_id,
    mr.title,
    mr.report_type,
    mr.file_hash,
    mr.created_at       as report_created_at,
    ai.summary,
    ai.findings,
    ai.confidence,
    ai.model_used,
    btx.tx_hash,
    btx.status           as blockchain_status,
    btx.block_number
from medical_reports mr
left join lateral (
    select * from ai_analyses a
    where a.report_id = mr.id
    order by a.created_at desc
    limit 1
) ai on true
left join blockchain_transactions btx on btx.report_id = mr.id;

-- ---------------------------------------------------------------------
-- Admin analytics: platform-wide aggregates
-- ---------------------------------------------------------------------
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
       from blockchain_transactions where status = 'confirmed')                  as avg_confirmation_seconds;

-- ---------------------------------------------------------------------
-- Appointment load per doctor per week (useful for admin scheduling charts)
-- ---------------------------------------------------------------------
create or replace view v_doctor_weekly_load as
select
    doctor_id,
    date_trunc('week', scheduled_at) as week_start,
    count(*)                          as appointment_count,
    count(*) filter (where status = 'completed') as completed_count,
    count(*) filter (where status = 'cancelled') as cancelled_count
from appointments
group by doctor_id, date_trunc('week', scheduled_at);


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 004_rls_policies.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- =====================================================================
-- HealthChain: Row-Level Security (Migration 004)
--
-- Design note: Supabase/PostgREST serves each HTTP request over a pooled
-- connection, so plain `set_config(..., is_local => true)` calls made as
-- separate RPC round-trips do NOT reliably persist for the query that
-- follows. The correct, standard Supabase pattern is instead to have the
-- backend mint a signed JWT (HS256, Supabase JWT secret) per authenticated
-- request carrying custom claims `app_user_id` and `app_role`, and read
-- those claims back out of `auth.jwt()` inside RLS policies below.
-- See backend/src/middleware/auth.ts (issueSupabaseJWT) for the minting
-- side of this contract.
-- =====================================================================

-- Helper functions -----------------------------------------------------
create or replace function fn_current_user_id() returns uuid as $$
    select nullif(auth.jwt() ->> 'app_user_id', '')::uuid;
$$ language sql stable;

create or replace function fn_current_user_role() returns text as $$
    select auth.jwt() ->> 'app_role';
$$ language sql stable;

-- ---------------------------------------------------------------------
alter table users enable row level security;
alter table doctor_profiles enable row level security;
alter table patient_profiles enable row level security;
alter table appointments enable row level security;
alter table medical_reports enable row level security;
alter table ai_analyses enable row level security;
alter table prescriptions enable row level security;
alter table blockchain_transactions enable row level security;
alter table notifications enable row level security;
alter table audit_logs enable row level security;
alter table auth_nonces enable row level security;  -- backend-only (service role), see migration 007

-- USERS: everyone can read their own row; admins read all; doctors read
-- basic info of their own patients.
create policy p_users_self_select on users
    for select using (
        id = fn_current_user_id()
        or fn_current_user_role() = 'admin'
        or (fn_current_user_role() = 'doctor' and exists (
              select 1 from appointments a
              where a.doctor_id = fn_current_user_id() and a.patient_id = users.id
           ))
    );

create policy p_users_self_update on users
    for update using (id = fn_current_user_id() or fn_current_user_role() = 'admin');

-- PROFILES: owner + admin only
create policy p_doctor_profiles on doctor_profiles
    for all using (user_id = fn_current_user_id() or fn_current_user_role() in ('admin'))
    with check (user_id = fn_current_user_id() or fn_current_user_role() = 'admin');

create policy p_patient_profiles on patient_profiles
    for all using (
        user_id = fn_current_user_id()
        or fn_current_user_role() = 'admin'
        or (fn_current_user_role() = 'doctor' and exists (
              select 1 from appointments a
              where a.doctor_id = fn_current_user_id() and a.patient_id = patient_profiles.user_id
           ))
    )
    with check (user_id = fn_current_user_id() or fn_current_user_role() = 'admin');

-- APPOINTMENTS: visible to the patient, the doctor, or admin
create policy p_appointments_select on appointments
    for select using (
        patient_id = fn_current_user_id()
        or doctor_id = fn_current_user_id()
        or fn_current_user_role() = 'admin'
    );

create policy p_appointments_insert on appointments
    for insert with check (
        patient_id = fn_current_user_id() or fn_current_user_role() = 'admin'
    );

create policy p_appointments_update on appointments
    for update using (
        doctor_id = fn_current_user_id()
        or patient_id = fn_current_user_id()
        or fn_current_user_role() = 'admin'
    );

-- MEDICAL REPORTS: patient owns it, assigned doctor can view/add, admin all
create policy p_reports_select on medical_reports
    for select using (
        patient_id = fn_current_user_id()
        or doctor_id = fn_current_user_id()
        or fn_current_user_role() = 'admin'
    );

create policy p_reports_insert on medical_reports
    for insert with check (
        doctor_id = fn_current_user_id()
        or patient_id = fn_current_user_id()
        or fn_current_user_role() = 'admin'
    );

-- AI ANALYSES: follow the parent report's visibility
create policy p_ai_analyses_select on ai_analyses
    for select using (
        exists (
            select 1 from medical_reports mr
            where mr.id = ai_analyses.report_id
              and (mr.patient_id = fn_current_user_id()
                   or mr.doctor_id = fn_current_user_id()
                   or fn_current_user_role() = 'admin')
        )
    );

-- PRESCRIPTIONS: patient + prescribing doctor + admin
create policy p_prescriptions_select on prescriptions
    for select using (
        patient_id = fn_current_user_id()
        or doctor_id = fn_current_user_id()
        or fn_current_user_role() = 'admin'
    );

create policy p_prescriptions_insert on prescriptions
    for insert with check (
        doctor_id = fn_current_user_id() or fn_current_user_role() = 'admin'
    );

-- BLOCKCHAIN TRANSACTIONS: follow parent report/prescription visibility, admin all
create policy p_btx_select on blockchain_transactions
    for select using (
        fn_current_user_role() = 'admin'
        or exists (select 1 from medical_reports mr where mr.id = blockchain_transactions.report_id
                    and (mr.patient_id = fn_current_user_id() or mr.doctor_id = fn_current_user_id()))
        or exists (select 1 from prescriptions pr where pr.id = blockchain_transactions.prescription_id
                    and (pr.patient_id = fn_current_user_id() or pr.doctor_id = fn_current_user_id()))
    );

-- NOTIFICATIONS: strictly owner-only
create policy p_notifications_owner on notifications
    for all using (user_id = fn_current_user_id())
    with check (user_id = fn_current_user_id());

-- AUDIT LOGS: admin only (read-only from the API's perspective)
create policy p_audit_admin_only on audit_logs
    for select using (fn_current_user_role() = 'admin');


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 005_rag_function.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- =====================================================================
-- HealthChain: RAG retrieval helper (Migration 005)
-- Cosine-similarity search over a single patient's own past AI analyses,
-- used by backend/src/services/ai.service.ts to ground new report
-- analysis in that patient's history (longitudinal context).
-- security definer + explicit patient_id scoping keeps this safe to call
-- from the service-role client without leaking other patients' data.
-- =====================================================================

create or replace function match_patient_analyses(
    p_patient_id uuid,
    p_query_embedding vector(1536),
    p_match_count int default 3
)
returns table (
    analysis_id uuid,
    report_id uuid,
    summary text,
    similarity float
)
language sql stable
as $$
    select
        a.id as analysis_id,
        a.report_id,
        a.summary,
        1 - (a.embedding <=> p_query_embedding) as similarity
    from ai_analyses a
    join medical_reports mr on mr.id = a.report_id
    where mr.patient_id = p_patient_id
      and a.embedding is not null
    order by a.embedding <=> p_query_embedding
    limit p_match_count;
$$;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: seed.sql
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- =====================================================================
-- HealthChain: Demo seed data
-- Run after migrations, only in dev/test environments.
-- =====================================================================

insert into users (id, wallet_address, role, full_name, email) values
    ('11111111-1111-1111-1111-111111111111', '0x111111111111111111111111111111111111aaaa', 'admin',   'Alice Admin',  'admin@healthchain.dev'),
    ('22222222-2222-2222-2222-222222222222', '0x222222222222222222222222222222222222bbbb', 'doctor',  'Dr. Bob Rao',  'bob@healthchain.dev'),
    ('33333333-3333-3333-3333-333333333333', '0x333333333333333333333333333333333333cccc', 'patient', 'Chitra Menon', 'chitra@healthchain.dev'),
    ('44444444-4444-4444-4444-444444444444', '0x444444444444444444444444444444444444dddd', 'patient', 'Dev Kumar',    'dev@healthchain.dev');

insert into doctor_profiles (user_id, specialization, license_number, years_experience, consultation_fee) values
    ('22222222-2222-2222-2222-222222222222', 'Cardiology', 'LIC-2024-0091', 12, 500.00);

insert into patient_profiles (user_id, date_of_birth, blood_group, allergies) values
    ('33333333-3333-3333-3333-333333333333', '1990-04-12', 'O+', 'Penicillin'),
    ('44444444-4444-4444-4444-444444444444', '1985-11-02', 'B+', null);

insert into appointments (id, patient_id, doctor_id, scheduled_at, status, reason) values
    ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333',
     '22222222-2222-2222-2222-222222222222', now() + interval '2 days', 'confirmed', 'Routine checkup');

insert into medical_reports (id, patient_id, doctor_id, appointment_id, report_type, title, file_url, file_hash, raw_text) values
    ('66666666-6666-6666-6666-666666666666', '33333333-3333-3333-3333-333333333333',
     '22222222-2222-2222-2222-222222222222', '55555555-5555-5555-5555-555555555555',
     'lab_result', 'Lipid Panel - Jan 2026', 'reports/chitra/lipid_panel_jan2026.pdf',
     '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
     'LDL: 145 mg/dL, HDL: 42 mg/dL, Triglycerides: 180 mg/dL, Total Cholesterol: 220 mg/dL');

insert into ai_analyses (report_id, summary, findings, model_used, confidence) values
    ('66666666-6666-6666-6666-666666666666',
     'Lipid panel shows borderline-high LDL and total cholesterol; triglycerides mildly elevated.',
     '{"flags": ["elevated_ldl", "elevated_triglycerides"], "severity": "moderate", "recommendation": "Dietary review, recheck in 3 months"}',
     'gpt-4o-mini-rag-v1', 0.870);

insert into prescriptions (appointment_id, patient_id, doctor_id, medications, notes) values
    ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333',
     '22222222-2222-2222-2222-222222222222',
     '[{"name": "Atorvastatin", "dosage": "10mg", "frequency": "once daily", "duration_days": 90}]',
     'Recheck lipid panel in 3 months; low-cholesterol diet advised.');

insert into blockchain_transactions (report_id, chain, tx_hash, block_number, data_hash, status, confirmed_at) values
    ('66666666-6666-6666-6666-666666666666', 'sepolia',
     '0xabc123def4560000000000000000000000000000000000000000000000000001',
     5123456, '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
     'confirmed', now());


-- Trigger functions run as their owner so RLS doesn't block the audit,
-- notification, and role-check writes they make (see migration 006).
alter function fn_audit_trigger() security definer set search_path = public;
alter function fn_notify_appointment_change() security definer set search_path = public;
alter function fn_notify_new_report() security definer set search_path = public;
alter function fn_notify_new_prescription() security definer set search_path = public;
alter function fn_check_doctor_role() security definer set search_path = public;

-- Force reload schema cache for PostgREST
NOTIFY pgrst, 'reload schema';
