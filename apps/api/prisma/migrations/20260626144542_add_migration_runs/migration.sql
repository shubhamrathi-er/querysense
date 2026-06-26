-- CreateTable
CREATE TABLE `migration_runs` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `sourceConnectionId` VARCHAR(191) NOT NULL,
    `targetConnectionId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'running',
    `conflict` VARCHAR(191) NOT NULL,
    `createTables` BOOLEAN NOT NULL DEFAULT true,
    `tables` JSON NOT NULL,
    `config` JSON NOT NULL,
    `report` JSON NULL,
    `totalCopied` INTEGER NOT NULL DEFAULT 0,
    `error` TEXT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

    INDEX `migration_runs_workspaceId_idx`(`workspaceId`),
    INDEX `migration_runs_workspaceId_startedAt_idx`(`workspaceId`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
