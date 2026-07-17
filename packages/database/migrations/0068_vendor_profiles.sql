CREATE TABLE `vendor_profiles` (
  `vendor_id` text PRIMARY KEY NOT NULL,
  `description` text,
  `logo_media_id` text,
  `banner_media_id` text,
  `show_contact_email` integer DEFAULT 0 NOT NULL,
  `show_contact_phone` integer DEFAULT 0 NOT NULL,
  `seo_title` text,
  `seo_description` text,
  `return_policy` text,
  `support_hours` text,
  `publication_status` text DEFAULT 'draft' NOT NULL CHECK (`publication_status` IN ('draft', 'published')),
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`logo_media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`banner_media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `vendor_profiles_publication_idx`
ON `vendor_profiles` (`publication_status`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `vendor_profiles_logo_media_idx`
ON `vendor_profiles` (`logo_media_id`);
--> statement-breakpoint
CREATE INDEX `vendor_profiles_banner_media_idx`
ON `vendor_profiles` (`banner_media_id`);
