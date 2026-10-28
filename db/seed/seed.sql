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

insert into prescriptions (id, appointment_id, patient_id, doctor_id, notes) values
    ('77777777-7777-7777-7777-777777777777', '55555555-5555-5555-5555-555555555555',
     '33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222',
     'Recheck lipid panel in 3 months; low-cholesterol diet advised.');

insert into prescription_items (prescription_id, line_no, medicine_name, dosage, frequency, duration_days) values
    ('77777777-7777-7777-7777-777777777777', 1, 'Atorvastatin', '10mg', 'once daily', 90);

-- (No blockchain_transactions are seeded: real anchors come from the backend.)
