PRAGMA foreign_keys=ON;

ALTER TABLE `vendors` ADD COLUMN `settlement_hold_days` integer DEFAULT 7 NOT NULL CHECK (`settlement_hold_days` >= 0 AND `settlement_hold_days` <= 3650);
--> statement-breakpoint
ALTER TABLE `vendors` ADD COLUMN `minimum_payout_minor` integer DEFAULT 0 NOT NULL CHECK (`minimum_payout_minor` >= 0);
--> statement-breakpoint
ALTER TABLE `vendor_orders` ADD COLUMN `delivered_at` integer;
--> statement-breakpoint
UPDATE `vendor_orders`
SET `delivered_at` = `updated_at`
WHERE `status` = 'delivered' AND `delivered_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `vendor_orders_delivered_at_idx` ON `vendor_orders` (`status`,`delivered_at`);
--> statement-breakpoint

CREATE TABLE `payout_batches` (
    `id` text PRIMARY KEY NOT NULL,
    `idempotency_key` text NOT NULL,
    `currency` text NOT NULL,
    `method` text DEFAULT 'mixed' NOT NULL,
    `status` text DEFAULT 'draft' NOT NULL,
    `window_start_at` integer,
    `window_end_at` integer,
    `item_count` integer DEFAULT 0 NOT NULL,
    `total_minor` integer DEFAULT 0 NOT NULL,
    `notes` text,
    `created_by` text,
    `approved_by` text,
    `approved_at` integer,
    `processing_started_at` integer,
    `completed_at` integer,
    `cancelled_at` integer,
    `created_at` integer DEFAULT (unixepoch()) NOT NULL,
    `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
    FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (`approved_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
    CONSTRAINT `payout_batches_method_ck` CHECK (`method` IN ('bank','bkash','nagad','rocket','manual','mixed')),
    CONSTRAINT `payout_batches_status_ck` CHECK (`status` IN ('draft','approved','processing','completed','partially_failed','failed','cancelled')),
    CONSTRAINT `payout_batches_item_count_non_negative_ck` CHECK (`item_count` >= 0),
    CONSTRAINT `payout_batches_total_non_negative_ck` CHECK (`total_minor` >= 0),
    CONSTRAINT `payout_batches_window_ck` CHECK (`window_start_at` IS NULL OR `window_end_at` IS NULL OR `window_start_at` <= `window_end_at`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payout_batches_idempotency_uq` ON `payout_batches` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `payout_batches_status_created_idx` ON `payout_batches` (`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `payout_batches_currency_window_idx` ON `payout_batches` (`currency`,`window_end_at`);
--> statement-breakpoint
CREATE INDEX `payout_batches_created_by_idx` ON `payout_batches` (`created_by`);
--> statement-breakpoint
CREATE INDEX `payout_batches_approved_by_idx` ON `payout_batches` (`approved_by`);
--> statement-breakpoint

CREATE TABLE `payout_items` (
    `id` text PRIMARY KEY NOT NULL,
    `batch_id` text NOT NULL,
    `vendor_id` text NOT NULL,
    `payout_method_id` text NOT NULL,
    `idempotency_key` text NOT NULL,
    `currency` text NOT NULL,
    `amount_minor` integer NOT NULL,
    `status` text DEFAULT 'draft' NOT NULL,
    `reservation_journal_id` text,
    `completion_journal_id` text,
    `release_journal_id` text,
    `provider_reference` text,
    `failure_reason` text,
    `version` integer DEFAULT 1 NOT NULL,
    `reserved_at` integer,
    `processing_started_at` integer,
    `completed_at` integer,
    `released_at` integer,
    `failed_at` integer,
    `created_at` integer DEFAULT (unixepoch()) NOT NULL,
    `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
    FOREIGN KEY (`batch_id`) REFERENCES `payout_batches`(`id`) ON UPDATE no action ON DELETE restrict,
    FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE restrict,
    FOREIGN KEY (`payout_method_id`) REFERENCES `vendor_payout_methods`(`id`) ON UPDATE no action ON DELETE restrict,
    FOREIGN KEY (`reservation_journal_id`) REFERENCES `marketplace_ledger_journals`(`id`) ON UPDATE no action ON DELETE restrict,
    FOREIGN KEY (`completion_journal_id`) REFERENCES `marketplace_ledger_journals`(`id`) ON UPDATE no action ON DELETE restrict,
    FOREIGN KEY (`release_journal_id`) REFERENCES `marketplace_ledger_journals`(`id`) ON UPDATE no action ON DELETE restrict,
    CONSTRAINT `payout_items_status_ck` CHECK (`status` IN ('draft','reserved','processing','completed','failed','released','cancelled')),
    CONSTRAINT `payout_items_amount_positive_ck` CHECK (`amount_minor` > 0),
    CONSTRAINT `payout_items_version_positive_ck` CHECK (`version` > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payout_items_idempotency_uq` ON `payout_items` (`idempotency_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `payout_items_batch_vendor_currency_uq` ON `payout_items` (`batch_id`,`vendor_id`,`currency`);
--> statement-breakpoint
CREATE INDEX `payout_items_vendor_status_idx` ON `payout_items` (`vendor_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `payout_items_batch_status_idx` ON `payout_items` (`batch_id`,`status`);
--> statement-breakpoint
CREATE INDEX `payout_items_payout_method_idx` ON `payout_items` (`payout_method_id`);
--> statement-breakpoint
CREATE INDEX `payout_items_reservation_journal_idx` ON `payout_items` (`reservation_journal_id`);
--> statement-breakpoint

CREATE TABLE `payout_attempts` (
    `id` text PRIMARY KEY NOT NULL,
    `payout_item_id` text NOT NULL,
    `attempt_key` text NOT NULL,
    `attempt_number` integer NOT NULL,
    `provider` text NOT NULL,
    `status` text NOT NULL,
    `provider_reference` text,
    `request_metadata` text,
    `response_metadata` text,
    `error_message` text,
    `started_at` integer DEFAULT (unixepoch()) NOT NULL,
    `completed_at` integer,
    `created_at` integer DEFAULT (unixepoch()) NOT NULL,
    FOREIGN KEY (`payout_item_id`) REFERENCES `payout_items`(`id`) ON UPDATE no action ON DELETE restrict,
    CONSTRAINT `payout_attempts_status_ck` CHECK (`status` IN ('processing','succeeded','failed')),
    CONSTRAINT `payout_attempts_number_positive_ck` CHECK (`attempt_number` > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payout_attempts_attempt_key_uq` ON `payout_attempts` (`attempt_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `payout_attempts_item_number_uq` ON `payout_attempts` (`payout_item_id`,`attempt_number`);
--> statement-breakpoint
CREATE INDEX `payout_attempts_item_status_idx` ON `payout_attempts` (`payout_item_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `payout_attempts_reject_delete`
BEFORE DELETE ON `payout_attempts`
BEGIN
    SELECT RAISE(ABORT, 'payout attempts are audit evidence and cannot be deleted');
END;
