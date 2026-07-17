PRAGMA foreign_keys=ON;

CREATE TRIGGER `payout_items_validate_insert`
BEFORE INSERT ON `payout_items`
BEGIN
    SELECT CASE WHEN NEW.`status` NOT IN ('draft','reserved')
        THEN RAISE(ABORT, 'payout item must be created as draft or reserved') END;

    SELECT CASE WHEN NEW.`status` = 'reserved' AND NOT EXISTS (
        SELECT 1
        FROM `marketplace_ledger_journals` AS journal
        JOIN `marketplace_ledger_entries` AS entry
          ON entry.`journal_id` = journal.`id`
        WHERE journal.`id` = NEW.`reservation_journal_id`
          AND journal.`event_type` = 'payout.requested'
          AND journal.payout_id = NEW.id
          AND entry.`vendor_id` = NEW.`vendor_id`
          AND entry.`account_code` = 'vendor_payout_reserved'
        GROUP BY journal.`id`
        HAVING SUM(entry.credit_minor - entry.debit_minor) = NEW.`amount_minor`
    ) THEN RAISE(ABORT, 'payout reservation journal mismatch') END;
END;
--> statement-breakpoint

CREATE TRIGGER `payout_items_validate_update`
BEFORE UPDATE ON `payout_items`
BEGIN
    SELECT CASE WHEN NOT (
        OLD.`status` = NEW.`status`
        OR (OLD.status = 'draft' AND NEW.status IN ('reserved','cancelled'))
        OR (OLD.status = 'reserved' AND NEW.status IN ('processing','released','cancelled'))
        OR (OLD.status = 'processing' AND NEW.status IN ('completed','released','failed'))
        OR (OLD.status = 'failed' AND NEW.status = 'released')
    ) THEN RAISE(ABORT, 'invalid payout item status transition') END;

    SELECT CASE WHEN NEW.`status` IN ('reserved','processing') AND NOT EXISTS (
        SELECT 1
        FROM `marketplace_ledger_journals` AS journal
        JOIN `marketplace_ledger_entries` AS entry
          ON entry.`journal_id` = journal.`id`
        WHERE journal.`id` = NEW.`reservation_journal_id`
          AND journal.`event_type` = 'payout.requested'
          AND journal.payout_id = NEW.id
          AND entry.`vendor_id` = NEW.`vendor_id`
          AND entry.`account_code` = 'vendor_payout_reserved'
        GROUP BY journal.`id`
        HAVING SUM(entry.credit_minor - entry.debit_minor) = NEW.`amount_minor`
    ) THEN RAISE(ABORT, 'payout reservation journal mismatch') END;

    SELECT CASE WHEN NEW.`status` = 'completed' AND NOT EXISTS (
        SELECT 1
        FROM `marketplace_ledger_journals` AS journal
        JOIN `marketplace_ledger_entries` AS entry
          ON entry.`journal_id` = journal.`id`
        WHERE journal.`id` = NEW.`completion_journal_id`
          AND journal.`event_type` = 'payout.completed'
          AND journal.payout_id = NEW.id
          AND entry.`vendor_id` = NEW.`vendor_id`
          AND entry.`account_code` = 'vendor_paid'
        GROUP BY journal.`id`
        HAVING SUM(entry.credit_minor - entry.debit_minor) = NEW.`amount_minor`
    ) THEN RAISE(ABORT, 'payout completion journal mismatch') END;

    SELECT CASE WHEN NEW.`status` = 'released' AND NOT EXISTS (
        SELECT 1
        FROM `marketplace_ledger_journals` AS journal
        JOIN `marketplace_ledger_entries` AS entry
          ON entry.`journal_id` = journal.`id`
        WHERE journal.`id` = NEW.`release_journal_id`
          AND journal.`event_type` = 'payout.released'
          AND journal.payout_id = NEW.id
          AND entry.`vendor_id` = NEW.`vendor_id`
          AND entry.`account_code` = 'vendor_available_payable'
        GROUP BY journal.`id`
        HAVING SUM(entry.credit_minor - entry.debit_minor) = NEW.`amount_minor`
    ) THEN RAISE(ABORT, 'payout release journal mismatch') END;
END;
--> statement-breakpoint

CREATE TRIGGER `payout_attempts_validate_insert`
BEFORE INSERT ON `payout_attempts`
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM `payout_items`
        WHERE `id` = NEW.`payout_item_id`
          AND `status` = 'processing'
    ) THEN RAISE(ABORT, 'payout item must be processing before an attempt is created') END;
END;
--> statement-breakpoint

CREATE TRIGGER `payout_attempts_validate_update`
BEFORE UPDATE ON `payout_attempts`
BEGIN
    SELECT CASE WHEN NOT (
        OLD.`status` = NEW.`status`
        OR (OLD.`status` = 'processing' AND NEW.`status` IN ('succeeded','failed'))
    ) THEN RAISE(ABORT, 'invalid payout attempt status transition') END;
    SELECT CASE WHEN OLD.`payout_item_id` <> NEW.`payout_item_id`
        OR OLD.`attempt_key` <> NEW.`attempt_key`
        OR OLD.`attempt_number` <> NEW.`attempt_number`
        OR OLD.`provider` <> NEW.`provider`
        THEN RAISE(ABORT, 'payout attempt identity is immutable') END;
END;
