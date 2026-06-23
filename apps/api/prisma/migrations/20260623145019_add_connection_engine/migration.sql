-- Add database engine discriminator to connections (mysql | postgres).
-- Additive, backward-safe: existing rows default to 'mysql'.
ALTER TABLE `database_connections` ADD COLUMN `engine` VARCHAR(16) NOT NULL DEFAULT 'mysql';
