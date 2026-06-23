import type {
  VolumeAssessment,
  VolumeClass,
  MigrationStrategy,
} from '../types';

// Rough copy throughput assumption for duration estimates (rows/second).
const ROWS_PER_SECOND = 5000;

export function classifyVolume(rows: number, bytes: number): VolumeClass {
  if (rows >= 10_000_000 || bytes >= 5 * 1024 ** 3) return 'VERY_LARGE';
  if (rows >= 1_000_000 || bytes >= 1024 ** 3) return 'LARGE';
  if (rows >= 100_000 || bytes >= 100 * 1024 ** 2) return 'MEDIUM';
  return 'SMALL';
}

export function recommendStrategy(cls: VolumeClass): MigrationStrategy {
  switch (cls) {
    case 'SMALL':
      return 'SINGLE_TRANSACTION';
    case 'MEDIUM':
      return 'BATCH';
    case 'LARGE':
      return 'CHUNKED';
    case 'VERY_LARGE':
      return 'PARALLEL';
  }
}

export function assessVolume(rows: number, bytes: number): VolumeAssessment {
  const classification = classifyVolume(rows, bytes);
  return {
    totalRows: rows,
    totalBytes: bytes,
    estimatedTransferBytes: bytes,
    estimatedDurationSeconds: Math.max(1, Math.ceil(rows / ROWS_PER_SECOND)),
    classification,
    recommendedStrategy: recommendStrategy(classification),
  };
}
