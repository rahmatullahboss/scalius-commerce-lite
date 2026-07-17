PRAGMA foreign_keys=ON;

CREATE TRIGGER `marketplace_ledger_guard_payout_completion_state`
BEFORE INSERT ON `marketplace_ledger_entries`
WHEN NEW.`account_code` = 'vendor_payout_reserved'
    AND NEW.`debit_minor` > 0
    AND EXISTS (
        SELECT 1
        FROM `marketplace_ledger_journals`
        WHERE `id` = NEW.`journal_id`
          AND `event_type` = 'payout.completed'
    )
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM `marketplace_ledger_journals` AS journal
        JOIN `payout_items` AS payout_items
          ON payout_items.`id` = journal.`payout_id`
        WHERE journal.`id` = NEW.`journal_id`
          AND journal.`event_type` = 'payout.completed'
          AND payout_items.status = 'processing'
          AND payout_items.amount_minor = NEW.debit_minor
          AND payout_items.vendor_id = NEW.vendor_id
          AND payout_items.currency = journal.currency
    ) THEN RAISE(ABORT, 'payout item is not processing or amount does not match') END;
END;
--> statement-breakpoint

CREATE TRIGGER `marketplace_ledger_guard_payout_release_state`
BEFORE INSERT ON `marketplace_ledger_entries`
WHEN NEW.`account_code` = 'vendor_payout_reserved'
    AND NEW.`debit_minor` > 0
    AND EXISTS (
        SELECT 1
        FROM `marketplace_ledger_journals`
        WHERE `id` = NEW.`journal_id`
          AND `event_type` = 'payout.released'
    )
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM `marketplace_ledger_journals` AS journal
        JOIN `payout_items` AS payout_items
          ON payout_items.`id` = journal.`payout_id`
        WHERE journal.`id` = NEW.`journal_id`
          AND journal.`event_type` = 'payout.released'
          AND payout_items.status IN ('reserved','processing')
          AND payout_items.amount_minor = NEW.debit_minor
          AND payout_items.vendor_id = NEW.vendor_id
          AND payout_items.currency = journal.currency
    ) THEN RAISE(ABORT, 'payout item is not releasable or amount does not match') END;
END;
