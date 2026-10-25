-- =====================================================================
-- HealthChain: Demo data for presentations
--
-- Adds 8 doctors, 6 patients, ~20 appointments spread across late
-- Sep - mid Nov 2026, prescriptions for completed visits, and lab/imaging
-- reports with AI-style summaries. Runs after seed.sql. Safe to re-run:
-- it does nothing if the demo doctors already exist.
--
-- Notes:
--   * Demo accounts have no Supabase Auth login (like the seed users).
--   * AI summaries are hand-written and tagged model_used = 'demo-seed'.
--   * No blockchain_transactions are created, so nothing pretends to be
--     anchored on Sepolia. file_hash is the sha256 of each report's text.
--   * Also gives Sanidhya Srivastava's account a General Medicine profile
--     (license marked PENDING) and some demo patients, if that account exists.
-- =====================================================================

do $$
begin
if exists (select 1 from users where email = 'ananya.iyer@healthchain.dev') then
    raise notice 'Demo data already present, skipping.';
    return;
end if;

-- ---------------------------------------------------------------------
-- Doctors
-- ---------------------------------------------------------------------
insert into users (role, full_name, email) values
    ('doctor', 'Dr. Ananya Iyer',     'ananya.iyer@healthchain.dev'),
    ('doctor', 'Dr. Rohan Mehta',     'rohan.mehta@healthchain.dev'),
    ('doctor', 'Dr. Priya Sharma',    'priya.sharma@healthchain.dev'),
    ('doctor', 'Dr. Arjun Nair',      'arjun.nair@healthchain.dev'),
    ('doctor', 'Dr. Kavya Reddy',     'kavya.reddy@healthchain.dev'),
    ('doctor', 'Dr. Vikram Singh',    'vikram.singh@healthchain.dev'),
    ('doctor', 'Dr. Meera Joshi',     'meera.joshi@healthchain.dev'),
    ('doctor', 'Dr. Farhan Qureshi',  'farhan.qureshi@healthchain.dev');

insert into doctor_profiles (user_id, specialization, license_number, years_experience, consultation_fee, bio)
select u.id, v.spec, v.lic, v.yrs, v.fee, v.bio
from (values
    ('ananya.iyer@healthchain.dev',    'Dermatology',             'LIC-2019-0412',  7,  800, 'Skin, hair and nail conditions; allergy and acne care.'),
    ('rohan.mehta@healthchain.dev',    'Orthopedics',             'LIC-2012-1187', 14, 1200, 'Sports injuries, joint pain and spine care.'),
    ('priya.sharma@healthchain.dev',   'Pediatrics',              'LIC-2016-0733', 10,  700, 'Child health, growth monitoring and vaccinations.'),
    ('arjun.nair@healthchain.dev',     'Neurology',               'LIC-2010-0256', 16, 1500, 'Headache, epilepsy and nerve disorders.'),
    ('kavya.reddy@healthchain.dev',    'Gynecology & Obstetrics', 'LIC-2015-0904', 11, 1000, 'Women''s health, pregnancy and prenatal care.'),
    ('vikram.singh@healthchain.dev',   'Endocrinology',           'LIC-2013-0548', 13, 1100, 'Diabetes, thyroid and hormonal disorders.'),
    ('meera.joshi@healthchain.dev',    'Psychiatry',              'LIC-2018-0621',  8, 1300, 'Anxiety, depression and sleep disorders.'),
    ('farhan.qureshi@healthchain.dev', 'Pulmonology',             'LIC-2014-0377', 12,  900, 'Asthma, chronic cough and respiratory care.')
) v(email, spec, lic, yrs, fee, bio)
join users u on u.email = v.email;

insert into doctor_profiles (user_id, specialization, license_number, years_experience, bio)
select id, 'General Medicine', 'PENDING-' || left(id::text, 8), null, 'General physician.'
from users
where email = 'ssanidhya886@gmail.com' and role = 'doctor'
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------
-- Patients
-- ---------------------------------------------------------------------
insert into users (role, full_name, email) values
    ('patient', 'Aarav Patel',          'aarav.patel@healthchain.dev'),
    ('patient', 'Sneha Kulkarni',       'sneha.kulkarni@healthchain.dev'),
    ('patient', 'Rahul Verma',          'rahul.verma@healthchain.dev'),
    ('patient', 'Ishita Banerjee',      'ishita.banerjee@healthchain.dev'),
    ('patient', 'Karthik Subramanian',  'karthik.s@healthchain.dev'),
    ('patient', 'Neha Gupta',           'neha.gupta@healthchain.dev');

insert into patient_profiles (user_id, date_of_birth, blood_group, allergies)
select u.id, v.dob::date, v.bg, v.allergies
from (values
    ('aarav.patel@healthchain.dev',     '1992-07-19', 'A+',  'Penicillin'),
    ('sneha.kulkarni@healthchain.dev',  '1988-03-05', 'B-',  null),
    ('rahul.verma@healthchain.dev',     '1979-12-11', 'O-',  'Sulfa drugs'),
    ('ishita.banerjee@healthchain.dev', '2001-09-23', 'AB+', null),
    ('karthik.s@healthchain.dev',       '1965-05-30', 'B+',  null),
    ('neha.gupta@healthchain.dev',      '1995-01-14', 'O+',  'Peanuts')
) v(email, dob, bg, allergies)
join users u on u.email = v.email;

-- ---------------------------------------------------------------------
-- Appointments (times are IST)
-- ---------------------------------------------------------------------
insert into appointments (patient_id, doctor_id, scheduled_at, status, reason)
select p.id, d.id, v.at::timestamptz, v.status::appointment_status, v.reason
from (values
    -- past
    ('karthik.s@healthchain.dev',       'vikram.singh@healthchain.dev',   '2026-09-29 10:00+05:30', 'completed', 'Diabetes follow-up, HbA1c review'),
    ('rahul.verma@healthchain.dev',     'farhan.qureshi@healthchain.dev', '2026-09-30 16:30+05:30', 'completed', 'Persistent cough for 3 weeks'),
    ('aarav.patel@healthchain.dev',     'ananya.iyer@healthchain.dev',    '2026-10-03 11:00+05:30', 'completed', 'Itchy rash on forearms'),
    ('sneha.kulkarni@healthchain.dev',  'kavya.reddy@healthchain.dev',    '2026-10-06 09:30+05:30', 'completed', 'Annual gynecological check-up'),
    ('ishita.banerjee@healthchain.dev', 'meera.joshi@healthchain.dev',    '2026-10-07 18:00+05:30', 'completed', 'Anxiety and difficulty sleeping'),
    ('dev@healthchain.dev',             'rohan.mehta@healthchain.dev',    '2026-10-08 12:00+05:30', 'completed', 'Lower back pain after lifting'),
    ('neha.gupta@healthchain.dev',      'ssanidhya886@gmail.com',         '2026-10-12 10:30+05:30', 'completed', 'Fever and body ache'),
    ('karthik.s@healthchain.dev',       'bob@healthchain.dev',            '2026-10-14 15:00+05:30', 'completed', 'Chest tightness on exertion'),
    ('rahul.verma@healthchain.dev',     'arjun.nair@healthchain.dev',     '2026-10-15 11:30+05:30', 'no_show',   'Recurring headaches'),
    ('aarav.patel@healthchain.dev',     'ssanidhya886@gmail.com',         '2026-10-19 09:00+05:30', 'completed', 'General health check-up'),
    ('ishita.banerjee@healthchain.dev', 'ananya.iyer@healthchain.dev',    '2026-10-20 14:00+05:30', 'cancelled', 'Acne treatment follow-up'),
    ('sneha.kulkarni@healthchain.dev',  'vikram.singh@healthchain.dev',   '2026-10-21 10:00+05:30', 'completed', 'Thyroid function review'),
    -- upcoming
    ('chitra@healthchain.dev',          'bob@healthchain.dev',            '2026-10-27 10:30+05:30', 'confirmed', 'Lipid panel follow-up'),
    ('dev@healthchain.dev',             'ssanidhya886@gmail.com',         '2026-10-27 12:00+05:30', 'confirmed', 'Blood pressure check'),
    ('neha.gupta@healthchain.dev',      'meera.joshi@healthchain.dev',    '2026-10-28 17:00+05:30', 'confirmed', 'Stress management consultation'),
    ('rahul.verma@healthchain.dev',     'arjun.nair@healthchain.dev',     '2026-10-29 11:00+05:30', 'requested', 'Recurring headaches (rescheduled)'),
    ('karthik.s@healthchain.dev',       'vikram.singh@healthchain.dev',   '2026-10-30 10:00+05:30', 'requested', 'Quarterly diabetes review'),
    ('ishita.banerjee@healthchain.dev', 'ssanidhya886@gmail.com',         '2026-11-02 09:30+05:30', 'requested', 'Seasonal allergy symptoms'),
    ('aarav.patel@healthchain.dev',     'rohan.mehta@healthchain.dev',    '2026-11-03 16:00+05:30', 'requested', 'Knee pain while running'),
    ('chitra@healthchain.dev',          'priya.sharma@healthchain.dev',   '2026-11-04 15:30+05:30', 'requested', 'Child''s vaccination schedule'),
    ('sneha.kulkarni@healthchain.dev',  'kavya.reddy@healthchain.dev',    '2026-11-05 10:00+05:30', 'confirmed', 'Ultrasound results follow-up'),
    ('neha.gupta@healthchain.dev',      'farhan.qureshi@healthchain.dev', '2026-11-10 11:00+05:30', 'requested', 'Breathlessness during exercise')
) v(patient_email, doctor_email, at, status, reason)
join users p on p.email = v.patient_email
join users d on d.email = v.doctor_email;

-- ---------------------------------------------------------------------
-- Prescriptions for completed visits (issued 30 min after the visit)
-- ---------------------------------------------------------------------
insert into prescriptions (appointment_id, patient_id, doctor_id, medications, notes, issued_at)
select a.id, a.patient_id, a.doctor_id, v.meds::jsonb, v.notes, a.scheduled_at + interval '30 minutes'
from (values
    ('karthik.s@healthchain.dev', 'vikram.singh@healthchain.dev', '2026-09-29 10:00+05:30',
     '[{"name":"Metformin","dosage":"500mg","frequency":"twice daily after meals","duration_days":90},{"name":"Glimepiride","dosage":"1mg","frequency":"once daily before breakfast","duration_days":90}]',
     'Continue diet plan; repeat HbA1c in 3 months.'),
    ('rahul.verma@healthchain.dev', 'farhan.qureshi@healthchain.dev', '2026-09-30 16:30+05:30',
     '[{"name":"Montelukast","dosage":"10mg","frequency":"once daily at night","duration_days":14},{"name":"Salbutamol inhaler","dosage":"100mcg, 2 puffs","frequency":"as needed","duration_days":30}]',
     'Chest X-ray clear. Review if cough persists beyond 2 weeks.'),
    ('aarav.patel@healthchain.dev', 'ananya.iyer@healthchain.dev', '2026-10-03 11:00+05:30',
     '[{"name":"Cetirizine","dosage":"10mg","frequency":"once daily","duration_days":10},{"name":"Hydrocortisone 1% cream","dosage":"thin layer","frequency":"twice daily","duration_days":7}]',
     'Likely contact dermatitis; avoid new detergents.'),
    ('ishita.banerjee@healthchain.dev', 'meera.joshi@healthchain.dev', '2026-10-07 18:00+05:30',
     '[{"name":"Escitalopram","dosage":"5mg","frequency":"once daily","duration_days":30}]',
     'Sleep hygiene counselling given; review in 4 weeks.'),
    ('dev@healthchain.dev', 'rohan.mehta@healthchain.dev', '2026-10-08 12:00+05:30',
     '[{"name":"Ibuprofen","dosage":"400mg","frequency":"three times daily after food","duration_days":5},{"name":"Thiocolchicoside","dosage":"4mg","frequency":"twice daily","duration_days":5}]',
     'Physiotherapy for 2 weeks; avoid heavy lifting.'),
    ('neha.gupta@healthchain.dev', 'ssanidhya886@gmail.com', '2026-10-12 10:30+05:30',
     '[{"name":"Paracetamol","dosage":"650mg","frequency":"every 6 hours as needed","duration_days":3}]',
     'Viral fever; fluids and rest. Return if fever lasts beyond 3 days.'),
    ('karthik.s@healthchain.dev', 'bob@healthchain.dev', '2026-10-14 15:00+05:30',
     '[{"name":"Atorvastatin","dosage":"20mg","frequency":"once daily at night","duration_days":90},{"name":"Aspirin","dosage":"75mg","frequency":"once daily","duration_days":90}]',
     'ECG normal; treadmill test advised.'),
    ('sneha.kulkarni@healthchain.dev', 'vikram.singh@healthchain.dev', '2026-10-21 10:00+05:30',
     '[{"name":"Levothyroxine","dosage":"50mcg","frequency":"once daily on an empty stomach","duration_days":90}]',
     'Recheck TSH in 6 weeks.')
) v(patient_email, doctor_email, at, meds, notes)
join users p on p.email = v.patient_email
join users d on d.email = v.doctor_email
join appointments a on a.patient_id = p.id and a.doctor_id = d.id and a.scheduled_at = v.at::timestamptz;

-- ---------------------------------------------------------------------
-- Reports + AI summaries
-- ---------------------------------------------------------------------
insert into medical_reports (patient_id, doctor_id, appointment_id, report_type, title, file_url, file_hash, raw_text, created_at)
select a.patient_id, a.doctor_id, a.id, v.rtype::report_type, v.title,
       'reports/' || a.patient_id || '/demo_' || v.slug || '.txt',
       encode(sha256(convert_to(v.body, 'UTF8')), 'hex'),
       v.body,
       a.scheduled_at + interval '1 hour'
from (values
    ('karthik.s@healthchain.dev', 'vikram.singh@healthchain.dev', '2026-09-29 10:00+05:30', 'lab_result', 'HbA1c & Fasting Glucose', 'hba1c',
     'HbA1c: 7.8% (ref < 5.7%). Fasting plasma glucose: 148 mg/dL (ref 70-99). Serum creatinine: 1.0 mg/dL (ref 0.7-1.3).'),
    ('rahul.verma@healthchain.dev', 'farhan.qureshi@healthchain.dev', '2026-09-30 16:30+05:30', 'imaging', 'Chest X-ray (PA view)', 'chest_xray',
     'Chest radiograph PA view: lungs are clear. No consolidation, effusion or pneumothorax. Cardiac silhouette and mediastinum normal.'),
    ('karthik.s@healthchain.dev', 'bob@healthchain.dev', '2026-10-14 15:00+05:30', 'lab_result', 'Lipid Profile', 'lipid',
     'Total cholesterol: 232 mg/dL (ref < 200). LDL: 158 mg/dL (ref < 100). HDL: 38 mg/dL (ref > 40). Triglycerides: 190 mg/dL (ref < 150).'),
    ('aarav.patel@healthchain.dev', 'ssanidhya886@gmail.com', '2026-10-19 09:00+05:30', 'lab_result', 'Complete Blood Count', 'cbc',
     'Hemoglobin: 14.6 g/dL. WBC: 7,200 /uL. Platelets: 250,000 /uL. RBC indices within reference range.'),
    ('sneha.kulkarni@healthchain.dev', 'vikram.singh@healthchain.dev', '2026-10-21 10:00+05:30', 'lab_result', 'Thyroid Function Test', 'thyroid',
     'TSH: 6.8 mIU/L (ref 0.4-4.0). Free T4: 0.9 ng/dL (ref 0.8-1.8).')
) v(patient_email, doctor_email, at, rtype, title, slug, body)
join users p on p.email = v.patient_email
join users d on d.email = v.doctor_email
join appointments a on a.patient_id = p.id and a.doctor_id = d.id and a.scheduled_at = v.at::timestamptz;

insert into ai_analyses (report_id, summary, findings, model_used, confidence, created_at)
select mr.id, v.summary, v.findings::jsonb, 'demo-seed', v.confidence, mr.created_at + interval '1 minute'
from (values
    ('karthik.s@healthchain.dev', 'HbA1c & Fasting Glucose',
     'HbA1c and fasting glucose are above target, consistent with suboptimally controlled diabetes. Renal function is within range.',
     '{"flags":["HbA1c 7.8% above target","Fasting glucose 148 mg/dL elevated"],"severity":"moderate","recommendation":"Clinician to review glycemic control and current therapy."}', 0.82),
    ('rahul.verma@healthchain.dev', 'Chest X-ray (PA view)',
     'No acute cardiopulmonary findings are reported on the chest radiograph.',
     '{"flags":[],"severity":"low","recommendation":"No imaging follow-up indicated unless symptoms persist."}', 0.90),
    ('karthik.s@healthchain.dev', 'Lipid Profile',
     'Elevated total cholesterol, LDL and triglycerides with low HDL.',
     '{"flags":["LDL 158 mg/dL elevated","HDL 38 mg/dL low","Triglycerides 190 mg/dL elevated"],"severity":"moderate","recommendation":"Clinician to review cardiovascular risk and lipid management."}', 0.85),
    ('aarav.patel@healthchain.dev', 'Complete Blood Count',
     'All reported blood count values are within reference ranges.',
     '{"flags":[],"severity":"low","recommendation":"No action needed based on this report."}', 0.92),
    ('sneha.kulkarni@healthchain.dev', 'Thyroid Function Test',
     'Raised TSH with low-normal free T4, which can indicate subclinical hypothyroidism.',
     '{"flags":["TSH 6.8 mIU/L above range"],"severity":"moderate","recommendation":"Clinician to correlate clinically and consider repeat testing."}', 0.80)
) v(patient_email, title, summary, findings, confidence)
join users p on p.email = v.patient_email
join medical_reports mr on mr.patient_id = p.id and mr.title = v.title;

raise notice 'Demo data inserted.';
end $$;
