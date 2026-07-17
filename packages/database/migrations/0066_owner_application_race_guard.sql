CREATE UNIQUE INDEX `vendor_users_one_active_owner_per_user_idx`
ON `vendor_users` (`user_id`)
WHERE `role` = 'owner' AND `status` = 'active';
