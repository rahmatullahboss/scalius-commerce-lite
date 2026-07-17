CREATE TABLE `vendor_membership_invites` (
  `id` text PRIMARY KEY NOT NULL,
  `vendor_id` text NOT NULL,
  `invitee_email` text NOT NULL,
  `role` text NOT NULL CHECK (`role` IN ('admin', 'catalog', 'fulfillment', 'finance', 'viewer')),
  `token_hash` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL CHECK (`status` IN ('pending', 'accepted', 'revoked', 'expired')),
  `invited_by` text NOT NULL,
  `expires_at` integer NOT NULL,
  `accepted_by_user_id` text,
  `accepted_at` integer,
  `revoked_at` integer,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`invited_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`accepted_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
  CONSTRAINT `vendor_membership_invites_email_normalized_ck` CHECK (`invitee_email` = lower(trim(`invitee_email`)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_membership_invites_token_hash_uq`
ON `vendor_membership_invites` (`token_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_membership_invites_pending_email_uq`
ON `vendor_membership_invites` (`vendor_id`, `invitee_email`)
WHERE `status` = 'pending';
--> statement-breakpoint
CREATE INDEX `vendor_membership_invites_vendor_status_idx`
ON `vendor_membership_invites` (`vendor_id`, `status`, `expires_at`);
--> statement-breakpoint
CREATE INDEX `vendor_membership_invites_email_status_idx`
ON `vendor_membership_invites` (`invitee_email`, `status`, `expires_at`);
--> statement-breakpoint
CREATE INDEX `vendor_membership_invites_invited_by_idx`
ON `vendor_membership_invites` (`invited_by`);
