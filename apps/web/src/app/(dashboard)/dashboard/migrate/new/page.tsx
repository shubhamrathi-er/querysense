'use client';

import { useRouter } from 'next/navigation';
import { MigrationWizard } from '@/features/migrations/components/MigrationWizard';

export default function MigrateNewPage() {
  const router = useRouter();
  return <MigrationWizard onClose={() => router.push('/dashboard/migrate')} />;
}
