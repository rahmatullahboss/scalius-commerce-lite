PRAGMA foreign_keys=ON;

CREATE TABLE `domain_outbox_events` (
    `id` text PRIMARY KEY NOT NULL,
    `event_key` text NOT NULL,
    `aggregate_type` text NOT NULL,
    `aggregate_id` text NOT NULL,
    `event_type` text NOT NULL,
    `schema_version` integer DEFAULT 1 NOT NULL,
    `payload` text NOT NULL,
    `status` text DEFAULT 'pending' NOT NULL,
    `attempts` integer DEFAULT 0 NOT NULL,
    `next_attempt_at` integer,
    `claim_id` text,
    `claim_expires_at` integer,
    `last_error` text,
    `created_at` integer DEFAULT (unixepoch()) NOT NULL,
    `processed_at` integer,
    `failed_at` integer,
    CONSTRAINT `domain_outbox_events_schema_version_ck` CHECK (`schema_version` > 0),
    CONSTRAINT `domain_outbox_events_attempts_ck` CHECK (`attempts` >= 0),
    CONSTRAINT `domain_outbox_events_status_ck` CHECK (`status` IN ('pending','processing','processed','failed','dead'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domain_outbox_events_event_key_uq` ON `domain_outbox_events` (`event_key`);
--> statement-breakpoint
CREATE INDEX `domain_outbox_events_status_attempt_idx` ON `domain_outbox_events` (`status`,`next_attempt_at`,`created_at`);
--> statement-breakpoint
CREATE INDEX `domain_outbox_events_aggregate_idx` ON `domain_outbox_events` (`aggregate_type`,`aggregate_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `domain_outbox_events_claim_idx` ON `domain_outbox_events` (`claim_id`,`claim_expires_at`);
--> statement-breakpoint

CREATE TABLE `refunds` (
    `id` text PRIMARY KEY NOT NULL,
    `order_id` text NOT NULL,
    `order_payment_id` text,
    `gateway` text,
    `provider_refund_id` text,
    `status` text DEFAULT 'pending' NOT NULL,
    `currency` text DEFAULT 'BDT' NOT NULL,
    `amount_minor` integer NOT NULL,
    `reason` text,
    `actor_user_id` text,
    `claim_key` text NOT NULL,
    `metadata` text,
    `requested_at` integer DEFAULT (unixepoch()) NOT NULL,
    `completed_at` integer,
    `failed_at` integer,
    `created_at` integer DEFAULT (unixepoch()) NOT NULL,
    `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
    FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict,
    FOREIGN KEY (`order_payment_id`) REFERENCES `order_payments`(`id`) ON UPDATE no action ON DELETE restrict,
    FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
    CONSTRAINT `refunds_amount_non_negative_ck` CHECK (`amount_minor` >= 0),
    CONSTRAINT `refunds_status_ck` CHECK (`status` IN ('pending','processing','completed','failed','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refunds_claim_key_uq` ON `refunds` (`claim_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `refunds_gateway_provider_ref_uq` ON `refunds` (`gateway`,`provider_refund_id`);
--> statement-breakpoint
CREATE INDEX `refunds_order_idx` ON `refunds` (`order_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `refunds_payment_idx` ON `refunds` (`order_payment_id`);
--> statement-breakpoint
CREATE INDEX `refunds_status_idx` ON `refunds` (`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `refunds_actor_idx` ON `refunds` (`actor_user_id`);
--> statement-breakpoint

CREATE TABLE `marketplace_ledger_journals` (
    `id` text PRIMARY KEY NOT NULL,
    `idempotency_key` text NOT NULL,
    `event_type` text NOT NULL,
    `source_type` text NOT NULL,
    `source_id` text NOT NULL,
    `order_id` text,
    `order_payment_id` text,
    `refund_id` text,
    `payout_id` text,
    `reversal_of_journal_id` text,
    `currency` text NOT NULL,
    `occurred_at` integer NOT NULL,
    `posted_at` integer DEFAULT (unixepoch()) NOT NULL,
    `metadata` text,
    `created_at` integer DEFAULT (unixepoch()) NOT NULL,
    FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict,
    FOREIGN KEY (`order_payment_id`) REFERENCES `order_payments`(`id`) ON UPDATE no action ON DELETE restrict,
    FOREIGN KEY (`refund_id`) REFERENCES `refunds`(`id`) ON UPDATE no action ON DELETE restrict,
    FOREIGN KEY (`reversal_of_journal_id`) REFERENCES `marketplace_ledger_journals`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `marketplace_ledger_journals_idempotency_uq` ON `marketplace_ledger_journals` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `marketplace_ledger_journals_source_idx` ON `marketplace_ledger_journals` (`source_type`,`source_id`);
--> statement-breakpoint
CREATE INDEX `marketplace_ledger_journals_order_idx` ON `marketplace_ledger_journals` (`order_id`,`posted_at`);
--> statement-breakpoint
CREATE INDEX `marketplace_ledger_journals_payment_idx` ON `marketplace_ledger_journals` (`order_payment_id`);
--> statement-breakpoint
CREATE INDEX `marketplace_ledger_journals_refund_idx` ON `marketplace_ledger_journals` (`refund_id`);
--> statement-breakpoint
CREATE INDEX `marketplace_ledger_journals_payout_idx` ON `marketplace_ledger_journals` (`payout_id`);
--> statement-breakpoint
CREATE INDEX `marketplace_ledger_journals_reversal_idx` ON `marketplace_ledger_journals` (`reversal_of_journal_id`);
--> statement-breakpoint

CREATE TABLE `marketplace_ledger_entries` (
    `id` text PRIMARY KEY NOT NULL,
    `journal_id` text NOT NULL,
    `vendor_id` text,
    `account_code` text NOT NULL,
    `debit_minor` integer DEFAULT 0 NOT NULL,
    `credit_minor` integer DEFAULT 0 NOT NULL,
    `vendor_order_id` text,
    `order_item_id` text,
    `created_at` integer DEFAULT (unixepoch()) NOT NULL,
    FOREIGN KEY (`journal_id`) REFERENCES `marketplace_ledger_journals`(`id`) ON UPDATE no action ON DELETE restrict,
    FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE restrict,
    FOREIGN KEY (`vendor_order_id`) REFERENCES `vendor_orders`(`id`) ON UPDATE no action ON DELETE restrict,
    FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE restrict,
    CONSTRAINT `marketplace_ledger_entries_one_side_ck` CHECK ((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0)),
    CONSTRAINT `marketplace_ledger_entries_account_code_ck` CHECK (`account_code` IN (
        'cash_clearing',
        'vendor_pending_payable',
        'vendor_available_payable',
        'vendor_payout_reserved',
        'vendor_paid',
        'platform_commission_revenue',
        'shipping_clearing',
        'refund_clearing',
        'marketplace_adjustment'
    ))
);
--> statement-breakpoint
CREATE INDEX `marketplace_ledger_entries_journal_idx` ON `marketplace_ledger_entries` (`journal_id`);
--> statement-breakpoint
CREATE INDEX `marketplace_ledger_entries_vendor_account_idx` ON `marketplace_ledger_entries` (`vendor_id`,`account_code`,`created_at`);
--> statement-breakpoint
CREATE INDEX `marketplace_ledger_entries_vendor_order_idx` ON `marketplace_ledger_entries` (`vendor_order_id`);
--> statement-breakpoint
CREATE INDEX `marketplace_ledger_entries_order_item_idx` ON `marketplace_ledger_entries` (`order_item_id`);
--> statement-breakpoint

CREATE TABLE `refund_items` (
    `id` text PRIMARY KEY NOT NULL,
    `refund_id` text NOT NULL,
    `order_item_id` text NOT NULL,
    `vendor_id` text NOT NULL,
    `quantity` integer NOT NULL,
    `refund_amount_minor` integer NOT NULL,
    `gross_minor` integer NOT NULL,
    `discount_reversal_minor` integer DEFAULT 0 NOT NULL,
    `shipping_reversal_minor` integer DEFAULT 0 NOT NULL,
    `tax_reversal_minor` integer DEFAULT 0 NOT NULL,
    `commission_reversal_minor` integer DEFAULT 0 NOT NULL,
    `vendor_net_reversal_minor` integer DEFAULT 0 NOT NULL,
    `created_at` integer DEFAULT (unixepoch()) NOT NULL,
    FOREIGN KEY (`refund_id`) REFERENCES `refunds`(`id`) ON UPDATE no action ON DELETE restrict,
    FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE restrict,
    FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE restrict,
    CONSTRAINT `refund_items_quantity_positive_ck` CHECK (`quantity` > 0),
    CONSTRAINT `refund_items_amounts_non_negative_ck` CHECK (
        `refund_amount_minor` >= 0
        AND `gross_minor` >= 0
        AND `discount_reversal_minor` >= 0
        AND `shipping_reversal_minor` >= 0
        AND `tax_reversal_minor` >= 0
        AND `commission_reversal_minor` >= 0
        AND `vendor_net_reversal_minor` >= 0
    ),
    CONSTRAINT `refund_items_seller_components_ck` CHECK (
        `commission_reversal_minor` + `vendor_net_reversal_minor`
        = `gross_minor` - `discount_reversal_minor`
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refund_items_refund_order_item_uq` ON `refund_items` (`refund_id`,`order_item_id`);
--> statement-breakpoint
CREATE INDEX `refund_items_order_item_idx` ON `refund_items` (`order_item_id`);
--> statement-breakpoint
CREATE INDEX `refund_items_vendor_idx` ON `refund_items` (`vendor_id`,`created_at`);
--> statement-breakpoint

CREATE TABLE `vendor_balance_projections` (
    `vendor_id` text NOT NULL,
    `currency` text NOT NULL,
    `pending_minor` integer DEFAULT 0 NOT NULL,
    `available_minor` integer DEFAULT 0 NOT NULL,
    `reserved_minor` integer DEFAULT 0 NOT NULL,
    `paid_minor` integer DEFAULT 0 NOT NULL,
    `debt_minor` integer DEFAULT 0 NOT NULL,
    `last_journal_id` text,
    `version` integer DEFAULT 1 NOT NULL,
    `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
    PRIMARY KEY (`vendor_id`,`currency`),
    FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE restrict,
    FOREIGN KEY (`last_journal_id`) REFERENCES `marketplace_ledger_journals`(`id`) ON UPDATE no action ON DELETE restrict,
    CONSTRAINT `vendor_balance_projections_non_negative_ck` CHECK (
        `pending_minor` >= 0
        AND `available_minor` >= 0
        AND `reserved_minor` >= 0
        AND `paid_minor` >= 0
        AND `debt_minor` >= 0
    ),
    CONSTRAINT `vendor_balance_projections_version_ck` CHECK (`version` > 0)
);
--> statement-breakpoint
CREATE INDEX `vendor_balance_projections_last_journal_idx` ON `vendor_balance_projections` (`last_journal_id`);
--> statement-breakpoint

CREATE TRIGGER `marketplace_ledger_journals_reject_update`
BEFORE UPDATE ON `marketplace_ledger_journals`
BEGIN
    SELECT RAISE(ABORT, 'marketplace ledger is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `marketplace_ledger_journals_reject_delete`
BEFORE DELETE ON `marketplace_ledger_journals`
BEGIN
    SELECT RAISE(ABORT, 'marketplace ledger is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `marketplace_ledger_entries_reject_update`
BEFORE UPDATE ON `marketplace_ledger_entries`
BEGIN
    SELECT RAISE(ABORT, 'marketplace ledger is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `marketplace_ledger_entries_reject_delete`
BEFORE DELETE ON `marketplace_ledger_entries`
BEGIN
    SELECT RAISE(ABORT, 'marketplace ledger is immutable');
END;
