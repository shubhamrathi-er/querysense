'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowRightLeft, ArrowRight, ChevronRight, Plus, Lock, ShieldCheck,
  Database, DatabaseZap, Eye, ListChecks, Play, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useConnections } from '@/features/connections/hooks/useConnections';
import { MigrationWizard } from '@/features/migrations/components/MigrationWizard';

const CARD =
  'rounded-[22px] border border-border bg-card/80 backdrop-blur-xl ' +
  'shadow-[0_1px_2px_rgba(15,23,42,0.04),0_30px_70px_-32px_rgba(91,79,247,0.32)]';

const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const } },
};

export default function MigrateDataPage() {
  const { data: connections, isLoading } = useConnections();
  const [showWizard, setShowWizard] = useState(false);

  const active = (connections ?? []).filter((c) => c.status === 'ACTIVE');
  const canMigrate = active.length >= 2;

  return (
    <div className="flex flex-col relative">
      {/* Local accent glows over the shared dashboard backdrop */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-0 overflow-hidden">
        <div className="absolute -left-24 top-6 h-64 w-64 rounded-full bg-[#7C6BFF]/10 blur-[100px]" />
        <div className="absolute right-0 top-1/3 h-64 w-64 rounded-full bg-cyan-400/10 blur-[110px]" />
      </div>

      <motion.div
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07 } } }}
        className="relative z-10 flex w-full max-w-full flex-1 flex-col justify-center gap-4 px-5 py-4 lg:px-8"
      >
        {/* ── Header ── */}
        <motion.div variants={fadeUp} className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#5B4FF7] to-[#7C6BFF] text-white shadow-lg shadow-[#5B4FF7]/30">
            <ArrowRightLeft className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">Migrate Data</h1>
            <p className="text-xs text-muted-foreground sm:text-sm">
              Move data between two same-engine databases, securely and reliably.
            </p>
          </div>
        </motion.div>

        {/* ── Hero ── */}
        <motion.section variants={fadeUp} className={cn(CARD, 'overflow-hidden p-5 sm:p-6')}>
          <div className="flex flex-col items-center text-center">
            <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#5B4FF7]/12 to-[#7C6BFF]/12 ring-1 ring-inset ring-primary/15">
              <DatabaseZap className="h-6 w-6 text-primary" />
            </div>
            <h2 className="mt-3 text-lg font-bold tracking-tight text-foreground">
              {canMigrate ? 'Ready to migrate' : 'Connect two databases to begin'}
            </h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {isLoading
                ? 'Checking your connections…'
                : canMigrate
                  ? `You have ${active.length} active connections. Choose a source and target, review the plan, then run the migration.`
                  : 'You’ll need at least two active connections of the same engine.'}
            </p>
          </div>

          {/* Flow visualization (generic preview) / empty state */}
          <div className="mt-5">
            {isLoading ? (
              <div className="h-28 animate-pulse rounded-[18px] bg-muted/40" />
            ) : canMigrate ? (
              <MigrationFlow />
            ) : (
              <div className="rounded-[18px] border border-dashed border-border bg-muted/20 px-6 py-7 text-center text-sm text-muted-foreground">
                {active.length === 1 ? '1 active connection' : 'No active connections yet'} — add one more to migrate.
              </div>
            )}
          </div>

          {/* CTA + security */}
          <div className="mt-5 flex flex-col items-center">
            {canMigrate ? (
              <motion.button
                onClick={() => setShowWizard(true)}
                whileHover={{ scale: 1.025 }}
                whileTap={{ scale: 0.98 }}
                className="group inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-[#5B4FF7] to-[#7C6BFF] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#5B4FF7]/30 transition-shadow hover:shadow-xl hover:shadow-[#5B4FF7]/40"
              >
                <ArrowRightLeft className="h-4 w-4" />
                Start Migration
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </motion.button>
            ) : (
              <Link
                href="/dashboard/connections"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#5B4FF7] to-[#7C6BFF] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#5B4FF7]/30 transition-shadow hover:shadow-xl hover:shadow-[#5B4FF7]/40"
              >
                <Plus className="h-4 w-4" /> Add a connection
              </Link>
            )}
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5 text-emerald-500" />
              Encrypted — your data never leaves your environment.
            </p>
          </div>
        </motion.section>

        {/* ── How it works ── */}
        <MigrationSteps />
      </motion.div>

      {showWizard && <MigrationWizard onClose={() => setShowWizard(false)} />}
    </div>
  );
}

// ── Migration flow visualization (generic preview — not interactive) ───────────

function MigrationFlow() {
  return (
    <div className="flex flex-col items-stretch gap-2.5 lg:flex-row lg:items-center">
      <DbCard label="Source Database" sub="Any connected database" />
      <Connector />
      <EngineCard />
      <Connector />
      <DbCard label="Target Database" sub="Must be the same engine" highlight />
    </div>
  );
}

function DbCard({ label, sub, highlight }: { label: string; sub: string; highlight?: boolean }) {
  return (
    <motion.div
      whileHover={{ y: -3 }}
      className="flex-1 rounded-[16px] border border-border bg-card/70 p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_40px_-30px_rgba(91,79,247,0.4)] backdrop-blur-md transition-colors hover:border-primary/30"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Database className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{label}</p>
          <p
            className={cn(
              'truncate text-xs',
              highlight ? 'font-medium text-primary' : 'text-muted-foreground',
            )}
          >
            {sub}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

function EngineCard() {
  return (
    <div className="relative flex shrink-0 flex-col items-center gap-1.5 rounded-[16px] border border-primary/20 bg-gradient-to-b from-primary/[0.06] to-transparent px-4 py-3 lg:w-40">
      <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#5B4FF7] to-[#7C6BFF] text-white shadow-lg shadow-[#5B4FF7]/30">
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-xl bg-primary/40 blur-md"
          animate={{ opacity: [0.3, 0.7, 0.3], scale: [1, 1.12, 1] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
        />
        <ArrowRightLeft className="relative h-5 w-5" />
      </div>
      <p className="text-sm font-semibold leading-none text-foreground">Migration Engine</p>
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
        Same engine only
      </span>
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
        <ShieldCheck className="h-3 w-3 text-emerald-500" /> Secure transfer
      </span>
    </div>
  );
}

/** Animated connector — soft gradient path with a slow flowing particle. */
function Connector() {
  return (
    <div className="flex shrink-0 items-center justify-center">
      <div className="relative hidden h-px w-10 bg-gradient-to-r from-primary/15 via-primary/45 to-primary/15 lg:block">
        <motion.span
          aria-hidden
          className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_8px_2px_rgba(91,79,247,0.55)]"
          animate={{ left: ['0%', '100%'], opacity: [0, 1, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        />
        <ChevronRight className="absolute -right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-primary/70" />
      </div>
      <div className="relative h-5 w-px bg-gradient-to-b from-primary/15 via-primary/45 to-primary/15 lg:hidden">
        <motion.span
          aria-hidden
          className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-primary shadow-[0_0_8px_2px_rgba(91,79,247,0.55)]"
          animate={{ top: ['0%', '100%'], opacity: [0, 1, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>
    </div>
  );
}

// ── How it works ──────────────────────────────────────────────────────────────

const STEPS = [
  { icon: Database, title: 'Choose databases', desc: 'Select source and target.' },
  { icon: Eye, title: 'Review migration', desc: 'Preview tables before migrating.' },
  { icon: ListChecks, title: 'Configure', desc: 'Choose mapping and options.' },
  { icon: Play, title: 'Run migration', desc: 'Execute and monitor progress.' },
] as const;

function MigrationSteps() {
  return (
    <motion.section variants={fadeUp} className={cn(CARD, 'p-4 sm:p-5')}>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Sparkles className="h-4 w-4 text-primary" /> How it works
      </h3>
      <div className="my-3 h-px bg-gradient-to-r from-primary/40 via-primary/15 to-transparent" />
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {STEPS.map((s) => (
          <motion.div
            key={s.title}
            whileHover={{ y: -3 }}
            className="rounded-[14px] border border-border bg-card/60 p-3 transition-colors hover:border-primary/30"
          >
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <s.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{s.title}</p>
                <p className="text-xs leading-snug text-muted-foreground">{s.desc}</p>
              </div>
            </div>

          </motion.div>
        ))}
      </div>
    </motion.section>
  );
}
