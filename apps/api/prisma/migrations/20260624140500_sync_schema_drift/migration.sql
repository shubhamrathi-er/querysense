-- AlterTable
ALTER TABLE `conversations` ADD COLUMN `pinned` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `database_connections` ADD COLUMN `sshEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `sshHost` VARCHAR(191) NULL,
    ADD COLUMN `sshPassphrase` TEXT NULL,
    ADD COLUMN `sshPassword` TEXT NULL,
    ADD COLUMN `sshPort` INTEGER NULL DEFAULT 22,
    ADD COLUMN `sshPrivateKey` TEXT NULL,
    ADD COLUMN `sshUsername` VARCHAR(191) NULL,
    MODIFY `engine` VARCHAR(191) NOT NULL DEFAULT 'mysql';

-- AlterTable
ALTER TABLE `messages` ADD COLUMN `clarification` JSON NULL,
    ADD COLUMN `queryMeta` JSON NULL;

-- AlterTable
ALTER TABLE `schema_metadata` ADD COLUMN `moduleId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `schema_modules` (
    `id` VARCHAR(191) NOT NULL,
    `connectionId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `color` VARCHAR(191) NULL,
    `ordinal` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `schema_modules_connectionId_name_key`(`connectionId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `schema_metadata` ADD CONSTRAINT `schema_metadata_moduleId_fkey` FOREIGN KEY (`moduleId`) REFERENCES `schema_modules`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schema_modules` ADD CONSTRAINT `schema_modules_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `database_connections`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

