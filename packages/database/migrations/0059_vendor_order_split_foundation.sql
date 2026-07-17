CREATE TABLE `vendor_orders` (
  `id` text PRIMARY KEY NOT NULL,
  `order_id` text NOT NULL,
  `vendor_id` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL CHECK (`status` IN ('pending', 'processing', 'ready', 'shipped', 'delivered', 'cancelled')),
  `fulfillment_status` text DEFAULT 'pending' NOT NULL CHECK (`fulfillment_status` IN ('pending', 'partial', 'complete', 'cancelled')),
  `version` integer DEFAULT 1 NOT NULL,
  `notes` text,
  `created_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
  `updated_at` integer DEFAULT (cast(strftime('%s','now') as int)) NOT NULL,
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_orders_order_vendor_unique` ON `vendor_orders` (`order_id`, `vendor_id`);
--> statement-breakpoint
CREATE INDEX `vendor_orders_order_id_idx` ON `vendor_orders` (`order_id`);
--> statement-breakpoint
CREATE INDEX `vendor_orders_vendor_status_idx` ON `vendor_orders` (`vendor_id`, `status`);
--> statement-breakpoint
CREATE INDEX `vendor_orders_fulfillment_status_idx` ON `vendor_orders` (`fulfillment_status`);
--> statement-breakpoint
CREATE INDEX `vendor_orders_created_at_idx` ON `vendor_orders` (`created_at`);
--> statement-breakpoint
ALTER TABLE `order_items` ADD `vendor_order_id` text;
--> statement-breakpoint
ALTER TABLE `order_items` ADD `vendor_id_snapshot` text REFERENCES `vendors`(`id`) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `order_items` ADD `vendor_name_snapshot` text;
--> statement-breakpoint
ALTER TABLE `order_items` ADD `currency` text DEFAULT 'BDT' NOT NULL;
--> statement-breakpoint
ALTER TABLE `order_items` ADD `unit_price_minor` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `order_items` ADD `line_subtotal_minor` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `order_items` ADD `discount_minor` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `order_items` ADD `commission_rule_id` text REFERENCES `vendor_commission_rules`(`id`) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `order_items` ADD `commission_bps` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `order_items` ADD `commission_minor` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `order_items` ADD `vendor_net_minor` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
INSERT INTO `vendor_orders` (
  `id`,
  `order_id`,
  `vendor_id`,
  `status`,
  `fulfillment_status`,
  `version`,
  `created_at`,
  `updated_at`
)
SELECT
  'vendor_order_' || oi.`order_id` || '_' || coalesce(p.`vendor_id`, 'vendor_platform'),
  oi.`order_id`,
  coalesce(p.`vendor_id`, 'vendor_platform'),
  'pending',
  'pending',
  1,
  cast(strftime('%s','now') as int),
  cast(strftime('%s','now') as int)
FROM `order_items` oi
LEFT JOIN `products` p ON p.`id` = oi.`product_id`
GROUP BY oi.`order_id`, coalesce(p.`vendor_id`, 'vendor_platform');
--> statement-breakpoint
UPDATE `order_items`
SET
  `vendor_order_id` = 'vendor_order_' || `order_id` || '_' || coalesce((SELECT p.`vendor_id` FROM `products` p WHERE p.`id` = `order_items`.`product_id`), 'vendor_platform'),
  `vendor_id_snapshot` = coalesce((SELECT p.`vendor_id` FROM `products` p WHERE p.`id` = `order_items`.`product_id`), 'vendor_platform'),
  `vendor_name_snapshot` = coalesce((
    SELECT v.`name`
    FROM `products` p
    LEFT JOIN `vendors` v ON v.`id` = coalesce(p.`vendor_id`, 'vendor_platform')
    WHERE p.`id` = `order_items`.`product_id`
  ), 'Platform'),
  `currency` = 'BDT',
  `unit_price_minor` = cast(round(`price` * 100) as integer),
  `line_subtotal_minor` = cast(round(`price` * 100) as integer) * `quantity`,
  `discount_minor` = 0,
  `commission_rule_id` = 'commission_platform_default',
  `commission_bps` = 0,
  `commission_minor` = 0,
  `vendor_net_minor` = cast(round(`price` * 100) as integer) * `quantity`;
--> statement-breakpoint
CREATE INDEX `order_items_vendor_order_id_idx` ON `order_items` (`vendor_order_id`);
--> statement-breakpoint
CREATE INDEX `order_items_vendor_snapshot_idx` ON `order_items` (`vendor_id_snapshot`, `order_id`);
--> statement-breakpoint
CREATE INDEX `order_items_commission_rule_idx` ON `order_items` (`commission_rule_id`);
--> statement-breakpoint
CREATE TRIGGER `order_items_validate_vendor_order_before_insert`
BEFORE INSERT ON `order_items`
FOR EACH ROW
WHEN (NEW.`vendor_order_id` IS NOT NULL OR NEW.`vendor_id_snapshot` IS NOT NULL)
  AND (
    NEW.`vendor_order_id` IS NULL
    OR NEW.`vendor_id_snapshot` IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM `vendor_orders` vo
      WHERE vo.`id` = NEW.`vendor_order_id`
        AND vo.`order_id` = NEW.`order_id`
        AND vo.`vendor_id` = NEW.`vendor_id_snapshot`
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'ORDER_ITEM_VENDOR_ALLOCATION_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `order_items_allocate_vendor_after_insert`
AFTER INSERT ON `order_items`
FOR EACH ROW WHEN NEW.`vendor_order_id` IS NULL OR NEW.`vendor_id_snapshot` IS NULL
BEGIN
  INSERT OR IGNORE INTO `vendor_orders` (
    `id`, `order_id`, `vendor_id`, `status`, `fulfillment_status`, `version`, `created_at`, `updated_at`
  ) VALUES (
    'vendor_order_' || NEW.`order_id` || '_' || coalesce((SELECT `vendor_id` FROM `products` WHERE `id` = NEW.`product_id`), 'vendor_platform'),
    NEW.`order_id`,
    coalesce((SELECT `vendor_id` FROM `products` WHERE `id` = NEW.`product_id`), 'vendor_platform'),
    'pending',
    'pending',
    1,
    cast(strftime('%s','now') as int),
    cast(strftime('%s','now') as int)
  );

  UPDATE `order_items`
  SET
    `vendor_order_id` = 'vendor_order_' || NEW.`order_id` || '_' || coalesce((SELECT `vendor_id` FROM `products` WHERE `id` = NEW.`product_id`), 'vendor_platform'),
    `vendor_id_snapshot` = coalesce((SELECT `vendor_id` FROM `products` WHERE `id` = NEW.`product_id`), 'vendor_platform'),
    `vendor_name_snapshot` = coalesce((
      SELECT v.`name`
      FROM `products` p
      LEFT JOIN `vendors` v ON v.`id` = coalesce(p.`vendor_id`, 'vendor_platform')
      WHERE p.`id` = NEW.`product_id`
    ), 'Platform'),
    `currency` = coalesce(NULLIF(NEW.`currency`, ''), 'BDT'),
    `unit_price_minor` = CASE WHEN NEW.`unit_price_minor` = 0 THEN cast(round(NEW.`price` * 100) as integer) ELSE NEW.`unit_price_minor` END,
    `line_subtotal_minor` = CASE WHEN NEW.`line_subtotal_minor` = 0 THEN cast(round(NEW.`price` * 100) as integer) * NEW.`quantity` ELSE NEW.`line_subtotal_minor` END,
    `commission_rule_id` = coalesce(NEW.`commission_rule_id`, 'commission_platform_default'),
    `vendor_net_minor` = CASE WHEN NEW.`vendor_net_minor` = 0 THEN
      (CASE WHEN NEW.`line_subtotal_minor` = 0 THEN cast(round(NEW.`price` * 100) as integer) * NEW.`quantity` ELSE NEW.`line_subtotal_minor` END)
      - NEW.`discount_minor`
      - NEW.`commission_minor`
      ELSE NEW.`vendor_net_minor` END
  WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `order_items_validate_vendor_order_before_update`
BEFORE UPDATE OF `vendor_order_id`, `vendor_id_snapshot` ON `order_items`
FOR EACH ROW
WHEN NEW.`vendor_order_id` IS NULL
  OR NEW.`vendor_id_snapshot` IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM `vendor_orders` vo
    WHERE vo.`id` = NEW.`vendor_order_id`
      AND vo.`order_id` = NEW.`order_id`
      AND vo.`vendor_id` = NEW.`vendor_id_snapshot`
  )
BEGIN
  SELECT RAISE(ABORT, 'ORDER_ITEM_VENDOR_ALLOCATION_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `order_items_immutable_marketplace_snapshot`
BEFORE UPDATE OF
  `vendor_order_id`,
  `vendor_id_snapshot`,
  `vendor_name_snapshot`,
  `currency`,
  `unit_price_minor`,
  `line_subtotal_minor`,
  `discount_minor`,
  `commission_rule_id`,
  `commission_bps`,
  `commission_minor`,
  `vendor_net_minor`
ON `order_items`
FOR EACH ROW
WHEN OLD.`vendor_id_snapshot` IS NOT NULL
  AND (
    NEW.`vendor_order_id` IS NOT OLD.`vendor_order_id`
    OR NEW.`vendor_id_snapshot` IS NOT OLD.`vendor_id_snapshot`
    OR NEW.`vendor_name_snapshot` IS NOT OLD.`vendor_name_snapshot`
    OR NEW.`currency` IS NOT OLD.`currency`
    OR NEW.`unit_price_minor` IS NOT OLD.`unit_price_minor`
    OR NEW.`line_subtotal_minor` IS NOT OLD.`line_subtotal_minor`
    OR NEW.`discount_minor` IS NOT OLD.`discount_minor`
    OR NEW.`commission_rule_id` IS NOT OLD.`commission_rule_id`
    OR NEW.`commission_bps` IS NOT OLD.`commission_bps`
    OR NEW.`commission_minor` IS NOT OLD.`commission_minor`
    OR NEW.`vendor_net_minor` IS NOT OLD.`vendor_net_minor`
  )
BEGIN
  SELECT RAISE(ABORT, 'ORDER_ITEM_MARKETPLACE_SNAPSHOT_IMMUTABLE');
END;
