PRAGMA foreign_keys=ON;

CREATE TRIGGER `marketplace_ledger_guard_settlement_pending`
BEFORE INSERT ON `marketplace_ledger_entries`
WHEN NEW.`account_code` = 'vendor_pending_payable'
    AND NEW.`debit_minor` > 0
    AND EXISTS (
        SELECT 1
        FROM `marketplace_ledger_journals` AS current_journal
        WHERE current_journal.`id` = NEW.`journal_id`
          AND current_journal.`event_type` = 'settlement.released'
    )
BEGIN
    SELECT CASE WHEN COALESCE((
        SELECT SUM(e.`credit_minor` - e.`debit_minor`)
        FROM `marketplace_ledger_entries` AS e
        JOIN `marketplace_ledger_journals` AS balance_journal
          ON balance_journal.`id` = e.`journal_id`
        WHERE e.`vendor_id` = NEW.`vendor_id`
          AND e.`vendor_order_id` = NEW.`vendor_order_id`
          AND e.`account_code` = 'vendor_pending_payable'
          AND balance_journal.`currency` = (
              SELECT current_journal.`currency`
              FROM `marketplace_ledger_journals` AS current_journal
              WHERE current_journal.`id` = NEW.`journal_id`
          )
    ), 0) < NEW.`debit_minor`
    THEN RAISE(ABORT, 'insufficient vendor pending balance') END;
END;
--> statement-breakpoint

CREATE TRIGGER `marketplace_ledger_guard_payout_available`
BEFORE INSERT ON `marketplace_ledger_entries`
WHEN NEW.`account_code` = 'vendor_available_payable'
    AND NEW.`debit_minor` > 0
    AND EXISTS (
        SELECT 1
        FROM `marketplace_ledger_journals` AS current_journal
        WHERE current_journal.`id` = NEW.`journal_id`
          AND current_journal.`event_type` = 'payout.requested'
    )
BEGIN
    SELECT CASE WHEN COALESCE((
        SELECT SUM(
            CASE
                WHEN account_code = 'vendor_available_payable' THEN account_balance
                WHEN account_code IN ('vendor_pending_payable', 'vendor_payout_reserved')
                    THEN CASE WHEN account_balance < 0 THEN account_balance ELSE 0 END
                ELSE 0
            END
        )
        FROM (
            SELECT
                e.`account_code` AS account_code,
                SUM(e.`credit_minor` - e.`debit_minor`) AS account_balance
            FROM `marketplace_ledger_entries` AS e
            JOIN `marketplace_ledger_journals` AS balance_journal
              ON balance_journal.`id` = e.`journal_id`
            WHERE e.`vendor_id` = NEW.`vendor_id`
              AND e.`account_code` IN (
                  'vendor_pending_payable',
                  'vendor_available_payable',
                  'vendor_payout_reserved'
              )
              AND balance_journal.`currency` = (
                  SELECT current_journal.`currency`
                  FROM `marketplace_ledger_journals` AS current_journal
                  WHERE current_journal.`id` = NEW.`journal_id`
              )
            GROUP BY e.`account_code`
        ) AS vendor_account_balances
    ), 0) < NEW.`debit_minor`
    THEN RAISE(ABORT, 'insufficient vendor available balance') END;
END;
--> statement-breakpoint

CREATE TRIGGER `marketplace_ledger_guard_payout_completion_reserved`
BEFORE INSERT ON `marketplace_ledger_entries`
WHEN NEW.`account_code` = 'vendor_payout_reserved'
    AND NEW.`debit_minor` > 0
    AND EXISTS (
        SELECT 1
        FROM `marketplace_ledger_journals` AS current_journal
        WHERE current_journal.`id` = NEW.`journal_id`
          AND current_journal.`event_type` = 'payout.completed'
    )
BEGIN
    SELECT CASE WHEN COALESCE((
        SELECT SUM(e.`credit_minor` - e.`debit_minor`)
        FROM `marketplace_ledger_entries` AS e
        JOIN `marketplace_ledger_journals` AS balance_journal
          ON balance_journal.`id` = e.`journal_id`
        JOIN `marketplace_ledger_journals` AS current_journal
          ON current_journal.`id` = NEW.`journal_id`
        WHERE e.`vendor_id` = NEW.`vendor_id`
          AND e.`account_code` = 'vendor_payout_reserved'
          AND balance_journal.`currency` = current_journal.`currency`
          AND balance_journal.payout_id = current_journal.payout_id
          AND current_journal.event_type = 'payout.completed'
    ), 0) < NEW.`debit_minor`
    THEN RAISE(ABORT, 'insufficient payout reservation balance') END;
END;
--> statement-breakpoint

CREATE TRIGGER `marketplace_ledger_guard_payout_release_reserved`
BEFORE INSERT ON `marketplace_ledger_entries`
WHEN NEW.`account_code` = 'vendor_payout_reserved'
    AND NEW.`debit_minor` > 0
    AND EXISTS (
        SELECT 1
        FROM `marketplace_ledger_journals` AS current_journal
        WHERE current_journal.`id` = NEW.`journal_id`
          AND current_journal.`event_type` = 'payout.released'
    )
BEGIN
    SELECT CASE WHEN COALESCE((
        SELECT SUM(e.`credit_minor` - e.`debit_minor`)
        FROM `marketplace_ledger_entries` AS e
        JOIN `marketplace_ledger_journals` AS balance_journal
          ON balance_journal.`id` = e.`journal_id`
        JOIN `marketplace_ledger_journals` AS current_journal
          ON current_journal.`id` = NEW.`journal_id`
        WHERE e.`vendor_id` = NEW.`vendor_id`
          AND e.`account_code` = 'vendor_payout_reserved'
          AND balance_journal.`currency` = current_journal.`currency`
          AND balance_journal.payout_id = current_journal.payout_id
          AND current_journal.event_type = 'payout.released'
    ), 0) < NEW.`debit_minor`
    THEN RAISE(ABORT, 'insufficient payout reservation balance') END;
END;
