-- =====================================================================
-- HealthChain: Demo payments (run after migration 008 and demo_seed.sql)
--
-- Marks most completed demo visits as paid (simulated, paid the day
-- before the visit) and leaves a couple unpaid so "Awaiting payment"
-- shows up too. Also pays one upcoming confirmed visit. Skips itself if
-- any payments already exist.
-- =====================================================================

do $$
begin
if exists (select 1 from payments) then
    raise notice 'Payments already present, skipping.';
    return;
end if;

insert into payments (appointment_id, patient_id, doctor_id, amount, method, provider_ref, paid_at)
select a.id, a.patient_id, a.doctor_id, dp.consultation_fee,
       (array['upi', 'card', 'netbanking']::payment_method[])[1 + (row_number() over (order by a.scheduled_at))::int % 3],
       'SIM-' || upper(substr(md5(a.id::text), 1, 10)),
       a.scheduled_at - interval '1 day'
from appointments a
join users p on p.id = a.patient_id
join users d on d.id = a.doctor_id
join doctor_profiles dp on dp.user_id = a.doctor_id and dp.consultation_fee > 0
where p.email like '%@healthchain.dev'
  and (
        (a.status = 'completed' and not (p.email = 'karthik.s@healthchain.dev' and d.email = 'bob@healthchain.dev'))
     or (a.status = 'confirmed' and p.email = 'sneha.kulkarni@healthchain.dev')
  );

raise notice 'Demo payments inserted.';
end $$;
