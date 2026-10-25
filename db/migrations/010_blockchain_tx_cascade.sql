-- =====================================================================
-- HealthChain: Cascade blockchain transactions with their document
-- (Migration 010)
--
-- blockchain_transactions.report_id / prescription_id were ON DELETE SET
-- NULL, but chk_one_target requires exactly one of them to be set. So
-- deleting a report or prescription that had been anchored (directly, or
-- by deleting its patient or doctor) failed with a check violation. The
-- transaction row only describes how that document was anchored, so it is
-- removed with it. The hash itself stays on-chain regardless.
-- =====================================================================

alter table blockchain_transactions
    drop constraint blockchain_transactions_report_id_fkey,
    add constraint blockchain_transactions_report_id_fkey
        foreign key (report_id) references medical_reports(id) on delete cascade;

alter table blockchain_transactions
    drop constraint blockchain_transactions_prescription_id_fkey,
    add constraint blockchain_transactions_prescription_id_fkey
        foreign key (prescription_id) references prescriptions(id) on delete cascade;
