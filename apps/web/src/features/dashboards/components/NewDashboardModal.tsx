'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { LayoutDashboard, X, Loader2 } from 'lucide-react';
import { useCreateDashboard } from '../hooks/useDashboards';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

export function NewDashboardModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const createDashboard = useCreateDashboard();
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const create = async () => {
    if (!name.trim()) return;
    try {
      const dashboard = await createDashboard.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      onClose();
      router.push(`/dashboard/dashboards/${dashboard.id}`);
    } catch {
      toast.error('Failed to create dashboard.');
    }
  };

  const field =
    'w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl"
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#5B4FF7] to-[#7C6BFF] text-white shadow-lg shadow-[#5B4FF7]/25">
          <LayoutDashboard className="h-5 w-5" />
        </div>
        <h2 className="mt-4 text-lg font-bold tracking-tight">New Dashboard</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Give your dashboard a name and an optional description.
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create();
              }}
              placeholder="e.g. Sales Overview"
              autoFocus
              maxLength={80}
              className={field}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Description <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this dashboard track?"
              rows={3}
              maxLength={240}
              className={cn(field, 'resize-none')}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={() => void create()}
            disabled={!name.trim() || createDashboard.isPending}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#5B4FF7] to-[#7C6BFF] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#5B4FF7]/25 transition-shadow hover:shadow-xl disabled:opacity-50"
          >
            {createDashboard.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Dashboard
          </button>
        </div>
      </motion.div>
    </div>
  );
}
