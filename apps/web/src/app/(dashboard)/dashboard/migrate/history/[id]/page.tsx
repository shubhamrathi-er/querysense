'use client';

import { use } from 'react';
import { MigrationRunDetail } from '@/features/migrations/components/MigrationRunDetail';

export default function MigrationRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <MigrationRunDetail id={id} />;
}
