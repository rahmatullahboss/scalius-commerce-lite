PRAGMA foreign_keys=ON;

CREATE TABLE `vendor_shipments` (
    `id` text PRIMARY KEY NOT NULL,
    `idempotency_key` text NOT NULL,
    `vendor_order_id` text NOT NULL,
    `order_id` text NOT NULL,
    `vendor_id` text NOT NULL,
    `provider_id` text,
    `provider_type` text DEFAULT 'manual' NOT NULL,
    `external_id` text,
    `tracking_id` text,
    `tracking_url` text,
    `courier_name` text,
    `status` text DEFAULT 'pending' NOT NULL,
    `raw_status` text,
    `note` text,
    `metadata` text,
    `shipment_amount_minor` integer DEFAULT 0 NOT NULL,
    `is_final_shipment` integer DEFAULT 0 NOT NULL,
    `version` integer DEFAULT 1 NOT NULL,
    `created_by` text,
    `last_checked_at` integer,
    `picked_up_at` integer,
    `delivered_at` integer,
    `cancelled_at` integer,
    `created_at` integer DEFAULT (unixepoch()) NOT NULL,
    `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
    FOREIGN KEY (`vendor_order_id`) REFERENCES `vendor_orders`(`id`) ON UPDATE no action ON DELETE restrict,
    FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict,
    FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE restrict,
    FOREIGN KEY (`provider_id`) REFERENCES `delivery_providers`(`id`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
    CONSTRAINT `vendor_shipments_status_ck` CHECK (`status` IN (
        'pending','processing','pickup_assigned','picked_up','pickup_failed',
        'in_transit','out_for_delivery','delivered','partial_delivered',
        'delivery_failed','on_hold','failed','returned','cancelled'
    )),
    CONSTRAINT `vendor_shipments_amount_non_negative_ck` CHECK (`shipment_amount_minor` >= 0),
    CONSTRAINT `vendor_shipments_final_boolean_ck` CHECK (`is_final_shipment` IN (0,1)),
    CONSTRAINT `vendor_shipments_version_positive_ck` CHECK (`version` > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_shipments_idempotency_uq` ON `vendor_shipments` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `vendor_shipments_vendor_order_idx` ON `vendor_shipments` (`vendor_order_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `vendor_shipments_vendor_status_idx` ON `vendor_shipments` (`vendor_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `vendor_shipments_order_idx` ON `vendor_shipments` (`order_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `vendor_shipments_provider_status_idx` ON `vendor_shipments` (`provider_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_shipments_provider_external_uq` ON `vendor_shipments` (`provider_id`,`external_id`);
--> statement-breakpoint

CREATE TABLE `vendor_shipment_items` (
    `id` text PRIMARY KEY NOT NULL,
    `shipment_id` text NOT NULL,
    `order_item_id` text NOT NULL,
    `quantity` integer NOT NULL,
    `created_at` integer DEFAULT (unixepoch()) NOT NULL,
    FOREIGN KEY (`shipment_id`) REFERENCES `vendor_shipments`(`id`) ON UPDATE no action ON DELETE restrict,
    FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE restrict,
    CONSTRAINT `vendor_shipment_items_quantity_positive_ck` CHECK (`quantity` > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_shipment_items_shipment_order_item_uq` ON `vendor_shipment_items` (`shipment_id`,`order_item_id`);
--> statement-breakpoint
CREATE INDEX `vendor_shipment_items_order_item_idx` ON `vendor_shipment_items` (`order_item_id`);
--> statement-breakpoint

CREATE TRIGGER `vendor_shipments_validate_identity`
BEFORE INSERT ON `vendor_shipments`
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM `vendor_orders`
        WHERE `id` = NEW.`vendor_order_id`
          AND `order_id` = NEW.`order_id`
          AND `vendor_id` = NEW.`vendor_id`
    ) THEN RAISE(ABORT, 'shipment vendor/order identity mismatch') END;
END;
--> statement-breakpoint

CREATE TRIGGER `vendor_shipments_validate_identity_update`
BEFORE UPDATE ON `vendor_shipments`
BEGIN
    SELECT CASE WHEN
        OLD.`vendor_order_id` <> NEW.`vendor_order_id`
        OR OLD.`order_id` <> NEW.`order_id`
        OR OLD.`vendor_id` <> NEW.`vendor_id`
        THEN RAISE(ABORT, 'shipment vendor/order identity is immutable') END;
END;
--> statement-breakpoint

CREATE TRIGGER `vendor_shipment_items_validate_insert`
BEFORE INSERT ON `vendor_shipment_items`
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM `vendor_shipments` AS shipment
        JOIN `order_items` AS order_item
          ON order_item.`id` = NEW.`order_item_id`
        WHERE shipment.`id` = NEW.`shipment_id`
          AND order_item.`vendor_order_id` = shipment.`vendor_order_id`
          AND order_item.`order_id` = shipment.`order_id`
          AND order_item.`vendor_id_snapshot` = shipment.`vendor_id`
    ) THEN RAISE(ABORT, 'shipment item does not belong to vendor order') END;

    SELECT CASE WHEN (
        COALESCE((
            SELECT SUM(existing_item.quantity)
            FROM `vendor_shipment_items` AS existing_item
            JOIN `vendor_shipments` AS existing_shipment
              ON existing_shipment.`id` = existing_item.`shipment_id`
            WHERE existing_item.`order_item_id` = NEW.`order_item_id`
              AND existing_shipment.`status` NOT IN (
                  'cancelled','failed','pickup_failed','delivery_failed','returned'
              )
        ), 0) + NEW.`quantity`
    ) > (
        SELECT `quantity`
        FROM `order_items`
        WHERE `id` = NEW.`order_item_id`
    ) THEN RAISE(ABORT, 'shipment quantity exceeds purchased quantity') END;
END;
--> statement-breakpoint

CREATE TRIGGER `vendor_shipment_items_reject_update`
BEFORE UPDATE ON `vendor_shipment_items`
BEGIN
    SELECT RAISE(ABORT, 'vendor shipment items are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `vendor_shipment_items_reject_delete`
BEFORE DELETE ON `vendor_shipment_items`
BEGIN
    SELECT RAISE(ABORT, 'vendor shipment items are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `vendor_shipments_reject_delete`
BEFORE DELETE ON `vendor_shipments`
BEGIN
    SELECT RAISE(ABORT, 'vendor shipments are historical records and cannot be deleted');
END;
--> statement-breakpoint

CREATE TRIGGER `vendor_shipments_validate_status_update`
BEFORE UPDATE OF `status` ON `vendor_shipments`
WHEN OLD.`status` <> NEW.`status`
BEGIN
    SELECT CASE WHEN NOT (
        (OLD.`status` = 'pending' AND NEW.`status` IN ('processing','pickup_assigned','cancelled','failed'))
        OR (OLD.`status` = 'processing' AND NEW.`status` IN ('pickup_assigned','picked_up','in_transit','cancelled','failed'))
        OR (OLD.`status` = 'pickup_assigned' AND NEW.`status` IN ('picked_up','pickup_failed','cancelled'))
        OR (OLD.`status` = 'pickup_failed' AND NEW.`status` IN ('pickup_assigned','cancelled','failed'))
        OR (OLD.`status` = 'picked_up' AND NEW.`status` IN ('in_transit','returned'))
        OR (OLD.`status` = 'in_transit' AND NEW.`status` IN ('out_for_delivery','delivered','partial_delivered','delivery_failed','on_hold','returned'))
        OR (OLD.`status` = 'out_for_delivery' AND NEW.`status` IN ('delivered','partial_delivered','delivery_failed','on_hold','returned'))
        OR (OLD.`status` = 'partial_delivered' AND NEW.`status` IN ('delivered','returned'))
        OR (OLD.`status` = 'delivery_failed' AND NEW.`status` IN ('out_for_delivery','returned','cancelled'))
        OR (OLD.`status` = 'on_hold' AND NEW.`status` IN ('in_transit','out_for_delivery','returned','cancelled'))
    ) THEN RAISE(ABORT, 'invalid vendor shipment status transition') END;
END;
--> statement-breakpoint

CREATE TRIGGER `vendor_shipments_mark_vendor_order_shipped`
AFTER UPDATE OF `status` ON `vendor_shipments`
WHEN OLD.`status` <> NEW.`status`
  AND NEW.`status` IN ('picked_up','in_transit','out_for_delivery','partial_delivered')
BEGIN
    UPDATE `vendor_orders`
    SET `status` = CASE
            WHEN `status` IN ('pending','processing','ready') THEN 'shipped'
            ELSE `status`
        END,
        `fulfillment_status` = CASE
            WHEN `fulfillment_status` = 'pending' THEN 'partial'
            ELSE `fulfillment_status`
        END,
        `version` = `version` + 1,
        `updated_at` = unixepoch()
    WHERE `id` = NEW.`vendor_order_id`
      AND `status` NOT IN ('delivered','cancelled');
END;
--> statement-breakpoint

CREATE TRIGGER `vendor_shipments_mark_vendor_order_delivered`
AFTER UPDATE OF `status` ON `vendor_shipments`
WHEN OLD.`status` <> NEW.`status`
  AND NEW.`status` = 'delivered'
BEGIN
    UPDATE `vendor_orders`
    SET status = 'delivered',
        `fulfillment_status` = 'complete',
        delivered_at = COALESCE(delivered_at, unixepoch()),
        `version` = `version` + 1,
        `updated_at` = unixepoch()
    WHERE `id` = NEW.`vendor_order_id`
      AND NOT EXISTS (
          SELECT 1
          FROM `order_items` AS order_item
          WHERE order_item.`vendor_order_id` = NEW.`vendor_order_id`
            AND COALESCE((
                SELECT SUM(delivered_item.quantity)
                FROM `vendor_shipment_items` AS delivered_item
                JOIN `vendor_shipments` AS delivered_shipment
                  ON delivered_shipment.`id` = delivered_item.`shipment_id`
                WHERE delivered_item.`order_item_id` = order_item.`id`
                  AND delivered_shipment.`status` = 'delivered'
            ), 0) < order_item.`quantity`
      );

    UPDATE `vendor_orders`
    SET `status` = CASE
            WHEN `status` IN ('pending','processing','ready') THEN 'shipped'
            ELSE `status`
        END,
        `fulfillment_status` = CASE
            WHEN `status` = 'delivered' THEN 'complete'
            ELSE 'partial'
        END,
        `version` = `version` + 1,
        `updated_at` = unixepoch()
    WHERE `id` = NEW.`vendor_order_id`
      AND `status` <> 'delivered';
END;
