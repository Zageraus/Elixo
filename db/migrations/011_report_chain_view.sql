-- =====================================================================
-- HealthChain: Report view shows the latest anchor and its chain
-- (Migration 011)
--
-- * v_report_with_analysis joined every blockchain_transactions row, so a
--   report with a failed attempt and a later success appeared twice. It now
--   takes the latest attempt per report, and exposes which chain it is on
--   (e.g. 'sepolia' or 'hardhat-local') so the UI can link correctly.
-- * Removes the placeholder "confirmed" transaction from the original seed
--   data: its hash was made up, so it pointed nowhere on any chain.
-- =====================================================================

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
    btx.block_number,
    btx.chain
from medical_reports mr
left join lateral (
    select * from ai_analyses a
    where a.report_id = mr.id
    order by a.created_at desc
    limit 1
) ai on true
left join lateral (
    select * from blockchain_transactions t
    where t.report_id = mr.id
    order by t.created_at desc
    limit 1
) btx on true;

delete from blockchain_transactions
where tx_hash = '0xabc123def4560000000000000000000000000000000000000000000000000001';
