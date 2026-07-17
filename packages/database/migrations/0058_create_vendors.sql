CREATE TABLE `vendors` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `slug` text NOT NULL,
  `legal_name` text,
  `status` text DEFAULT 'pending' NOT NULL CHECK (`status` IN ('pending', 'approved', 'rejected', 'suspended', 'closed')),
  `contact_email` text,
  `contact_phone` text,
  `created_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
  `updated_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
  `deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendors_slug_idx` ON `vendors` (`slug`);
--> statement-breakpoint
CREATE INDEX `vendors_status_idx` ON `vendors` (`status`);
--> statement-breakpoint
CREATE INDEX `vendors_deleted_at_idx` ON `vendors` (`deleted_at`);
--> statement-breakpoint
CREATE TABLE `vendor_users` (
  `id` text PRIMARY KEY NOT NULL,
  `vendor_id` text NOT NULL,
  `user_id` text NOT NULL,
  `role` text DEFAULT 'viewer' NOT NULL CHECK (`role` IN ('owner', 'admin', 'catalog', 'fulfillment', 'finance', 'viewer')),
  `status` text DEFAULT 'invited' NOT NULL CHECK (`status` IN ('invited', 'active', 'suspended', 'revoked')),
  `invited_by` text,
  `invited_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
  `accepted_at` integer,
  `revoked_at` integer,
  `created_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
  `updated_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
  FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`invited_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_users_vendor_user_unique` ON `vendor_users` (`vendor_id`, `user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_users_one_active_owner_idx` ON `vendor_users` (`vendor_id`) WHERE `role` = 'owner' AND `status` = 'active';
--> statement-breakpoint
CREATE INDEX `vendor_users_vendor_status_idx` ON `vendor_users` (`vendor_id`, `status`);
--> statement-breakpoint
CREATE INDEX `vendor_users_user_status_idx` ON `vendor_users` (`user_id`, `status`);
--> statement-breakpoint
CREATE INDEX `vendor_users_invited_by_idx` ON `vendor_users` (`invited_by`);
--> statement-breakpoint
CREATE TABLE `vendor_addresses` (
  `id` text PRIMARY KEY NOT NULL,
  `vendor_id` text NOT NULL,
  `type` text NOT NULL CHECK (`type` IN ('business', 'pickup', 'return')),
  `label` text,
  `recipient_name` text,
  `phone` text,
  `address_line_1` text NOT NULL,
  `address_line_2` text,
  `district` text,
  `upazila` text,
  `postal_code` text,
  `country_code` text DEFAULT 'BD' NOT NULL,
  `is_default` integer DEFAULT false NOT NULL,
  `created_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
  `updated_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
  `deleted_at` integer,
  FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `vendor_addresses_vendor_type_idx` ON `vendor_addresses` (`vendor_id`, `type`, `deleted_at`);
--> statement-breakpoint
CREATE INDEX `vendor_addresses_default_idx` ON `vendor_addresses` (`vendor_id`, `type`, `is_default`, `deleted_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_addresses_one_default_idx` ON `vendor_addresses` (`vendor_id`, `type`) WHERE `is_default` = true AND `deleted_at` IS NULL;
--> statement-breakpoint
CREATE TABLE `vendor_payout_methods` (
  `id` text PRIMARY KEY NOT NULL,
  `vendor_id` text NOT NULL,
  `method` text NOT NULL CHECK (`method` IN ('bank', 'bkash', 'nagad', 'rocket', 'manual')),
  `display_name` text NOT NULL,
  `encrypted_payload` text NOT NULL,
  `fingerprint` text NOT NULL,
  `last_four` text,
  `provider_name` text,
  `is_default` integer DEFAULT false NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL CHECK (`status` IN ('pending', 'verified', 'rejected', 'disabled')),
  `verified_by` text,
  `verified_at` integer,
  `rejection_reason` text,
  `created_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
  `updated_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
  `deleted_at` integer,
  FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`verified_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_payout_methods_vendor_fingerprint_unique` ON `vendor_payout_methods` (`vendor_id`, `fingerprint`);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_payout_methods_one_default_idx` ON `vendor_payout_methods` (`vendor_id`) WHERE `is_default` = true AND `deleted_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `vendor_payout_methods_vendor_status_idx` ON `vendor_payout_methods` (`vendor_id`, `status`, `deleted_at`);
--> statement-breakpoint
CREATE INDEX `vendor_payout_methods_default_idx` ON `vendor_payout_methods` (`vendor_id`, `is_default`, `deleted_at`);
--> statement-breakpoint
CREATE INDEX `vendor_payout_methods_verified_by_idx` ON `vendor_payout_methods` (`verified_by`);
--> statement-breakpoint
CREATE TABLE `vendor_verification_documents` (
  `id` text PRIMARY KEY NOT NULL,
  `vendor_id` text NOT NULL,
  `type` text NOT NULL CHECK (`type` IN ('identity', 'trade_license', 'tax', 'bank_document', 'other')),
  `storage_key` text NOT NULL,
  `original_filename` text,
  `mime_type` text,
  `checksum_sha256` text,
  `status` text DEFAULT 'pending' NOT NULL CHECK (`status` IN ('pending', 'approved', 'rejected', 'expired')),
  `reviewed_by` text,
  `reviewed_at` integer,
  `rejection_reason` text,
  `created_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
  `updated_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
  `deleted_at` integer,
  FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`reviewed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `vendor_verification_documents_vendor_status_idx` ON `vendor_verification_documents` (`vendor_id`, `status`, `deleted_at`);
--> statement-breakpoint
CREATE INDEX `vendor_verification_documents_reviewed_by_idx` ON `vendor_verification_documents` (`reviewed_by`);
--> statement-breakpoint
CREATE TABLE `vendor_moderation_events` (
  `id` text PRIMARY KEY NOT NULL,
  `vendor_id` text NOT NULL,
  `from_status` text,
  `to_status` text NOT NULL,
  `reason` text,
  `actor_user_id` text,
  `metadata` text,
  `created_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
  FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `vendor_moderation_events_vendor_created_idx` ON `vendor_moderation_events` (`vendor_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `vendor_moderation_events_actor_idx` ON `vendor_moderation_events` (`actor_user_id`);
--> statement-breakpoint
CREATE TABLE `vendor_commission_rules` (
  `id` text PRIMARY KEY NOT NULL,
  `scope` text NOT NULL CHECK (`scope` IN ('platform', 'vendor')),
  `vendor_id` text,
  `rate_bps` integer NOT NULL CHECK (`rate_bps` >= 0 AND `rate_bps` <= 10000),
  `status` text DEFAULT 'draft' NOT NULL CHECK (`status` IN ('draft', 'active', 'retired')),
  `priority` integer DEFAULT 0 NOT NULL,
  `effective_from` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
  `effective_to` integer,
  `created_by` text,
  `created_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
  `updated_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
  CHECK ((`scope` = 'platform' AND `vendor_id` IS NULL) OR (`scope` = 'vendor' AND `vendor_id` IS NOT NULL)),
  CHECK (`effective_to` IS NULL OR `effective_to` > `effective_from`),
  FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `vendor_commission_rules_resolution_idx` ON `vendor_commission_rules` (`vendor_id`, `status`, `effective_from`, `effective_to`, `priority`);
--> statement-breakpoint
CREATE INDEX `vendor_commission_rules_created_by_idx` ON `vendor_commission_rules` (`created_by`);
--> statement-breakpoint
INSERT INTO `vendors` (`id`, `name`, `slug`, `legal_name`, `status`, `created_at`, `updated_at`)
VALUES ('vendor_platform', 'Platform', 'platform', 'Platform', 'approved', cast(strftime('%s','now') as int), cast(strftime('%s','now') as int));
--> statement-breakpoint
INSERT INTO `vendor_commission_rules` (`id`, `scope`, `vendor_id`, `rate_bps`, `status`, `priority`, `effective_from`, `created_at`, `updated_at`)
VALUES ('commission_platform_default', 'platform', NULL, 0, 'active', 0, 0, cast(strftime('%s','now') as int), cast(strftime('%s','now') as int));
--> statement-breakpoint
ALTER TABLE `products` ADD `vendor_id` text REFERENCES `vendors`(`id`) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `products` ADD `approval_status` text DEFAULT 'approved' NOT NULL;
--> statement-breakpoint
ALTER TABLE `products` ADD `moderation_version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
UPDATE `products` SET `vendor_id` = 'vendor_platform' WHERE `vendor_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `products_marketplace_owner_idx` ON `products` (`vendor_id`);
--> statement-breakpoint
CREATE INDEX `products_approval_idx` ON `products` (`approval_status`);
--> statement-breakpoint
CREATE TRIGGER `products_default_vendor_after_insert`
AFTER INSERT ON `products`
FOR EACH ROW WHEN NEW.`vendor_id` IS NULL
BEGIN
  UPDATE `products` SET `vendor_id` = 'vendor_platform' WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `products_default_vendor_after_update`
AFTER UPDATE OF `vendor_id` ON `products`
FOR EACH ROW WHEN NEW.`vendor_id` IS NULL
BEGIN
  UPDATE `products` SET `vendor_id` = 'vendor_platform' WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TABLE `product_moderation_events` (
  `id` text PRIMARY KEY NOT NULL,
  `product_id` text NOT NULL,
  `vendor_id` text NOT NULL,
  `from_status` text,
  `to_status` text NOT NULL,
  `reason` text,
  `actor_user_id` text,
  `moderation_version` integer NOT NULL,
  `metadata` text,
  `created_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `product_moderation_events_product_created_idx` ON `product_moderation_events` (`product_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `product_moderation_events_vendor_created_idx` ON `product_moderation_events` (`vendor_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `product_moderation_events_actor_idx` ON `product_moderation_events` (`actor_user_id`);
