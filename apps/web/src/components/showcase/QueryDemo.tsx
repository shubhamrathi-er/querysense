'use client';

import { useEffect, useState, Fragment } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Copy, User, CheckCircle2, Loader2 } from 'lucide-react';

const QUESTION = 'Who are the top 5 customers by total revenue?';

const SQL_LINES = [
  'SELECT customer_name,',
  '  SUM(revenue) AS total_revenue',
  'FROM orders',
  'GROUP BY customer_name',
  'ORDER BY total_revenue DESC',
  'LIMIT 5;',
];
const SQL = SQL_LINES.join('\n');

type Phase = 'asking' | 'processing' | 'generating' | 'done';

const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'GROUP', 'BY', 'ORDER', 'DESC', 'ASC',
  'LIMIT', 'AS', 'SUM', 'COUNT', 'AVG', 'ON', 'JOIN', 'INNER', 'LEFT',
]);

/** Lightweight SQL highlighter for the (possibly partial) typed text. */
function highlight(text: string) {
  const tokens = text.split(/(\s+|,|;|\(|\))/);
  return tokens.map((tok, i) => {
    if (KEYWORDS.has(tok.toUpperCase()) && /^[a-z]+$/i.test(tok)) {
      return <span key={i} className="text-[#7C6BFF] font-semibold">{tok}</span>;
    }
    if (/^'.*'?$/.test(tok) || /'/.test(tok)) {
      return <span key={i} className="text-emerald-600">{tok}</span>;
    }
    if (/^\d+$/.test(tok)) {
      return <span key={i} className="text-amber-600">{tok}</span>;
    }
    return <Fragment key={i}>{tok}</Fragment>;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function QueryDemo() {
  const [typedQuestion, setTypedQuestion] = useState('');
  const [typedSql, setTypedSql] = useState('');
  const [phase, setPhase] = useState<Phase>('asking');

  useEffect(() => {
    let cancelled = false;

    async function loop() {
      while (!cancelled) {
        setTypedQuestion('');
        setTypedSql('');
        setPhase('asking');

        for (let i = 0; i <= QUESTION.length; i++) {
          if (cancelled) return;
          setTypedQuestion(QUESTION.slice(0, i));
          await sleep(26);
        }
        await sleep(550);

        setPhase('processing');
        await sleep(1100);

        setPhase('generating');
        for (let i = 0; i <= SQL.length; i++) {
          if (cancelled) return;
          setTypedSql(SQL.slice(0, i));
          await sleep(13);
        }
        setPhase('done');
        await sleep(3800);
      }
    }
    void loop();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="relative w-full max-w-2xl">
      {/* User prompt card */}
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.7 }}
        className="max-w-md rounded-2xl border border-white/70 bg-white/70 p-3 shadow-[0_10px_40px_rgba(30,27,75,0.08)] backdrop-blur-xl"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5B4FF7] to-[#7C6BFF] text-white">
            <User className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-slate-400">You ask</p>
            {/* reserve 2 lines so the card doesn't grow while the question types */}
            <p className="mt-0.5 min-h-[1.75rem] text-sm font-medium leading-relaxed text-slate-800">
              {typedQuestion}
              {phase === 'asking' && <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-[#5B4FF7] align-middle" />}
            </p>
          </div>
        </div>
      </motion.div>

      {/* Elbow connector: lives in the left gutter so it's never hidden by the card.
          Vertical drop under the avatar → rounded corner → arrow pointing at the card edge. */}
      <div className="relative z-20 h-7">
        <svg
          className="absolute -top-3 left-0 overflow-visible"
          width="56"
          height="56"
          viewBox="0 0 56 56"
          fill="none"
          aria-hidden
        >
          <defs>
            <linearGradient id="qd-elbow" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#5B4FF7" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#7C6BFF" stopOpacity="0.35" />
            </linearGradient>
          </defs>
          <motion.path
            d="M28 0 V30 Q28 40 38 40 H46"
            stroke="url(#qd-elbow)"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.7, delay: 1, ease: 'easeInOut' }}
          />
          <motion.path
            d="M42 35 L48 40 L42 45"
            stroke="url(#qd-elbow)"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 1.6 }}
          />
        </svg>
      </div>

      {/* SQL output card — indented to the right so the elbow sits in a clean gutter */}
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.9 }}
        className="relative ml-12 overflow-hidden rounded-2xl border border-white/70 bg-white/80 shadow-[0_16px_50px_rgba(30,27,75,0.12)] backdrop-blur-xl"
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-[#5B4FF7] to-[#7C6BFF] text-white">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-semibold text-slate-700">QuerySense AI</span>
          </div>
          <Copy className="h-4 w-4 text-slate-300" />
        </div>

        {/* body — fixed height up front so the SQL typing never shifts layout */}
        <div className="relative h-[156px] px-4 py-3">
          <AnimatePresence mode="wait">
            {phase === 'processing' ? (
              <motion.div
                key="processing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex h-[120px] flex-col items-center justify-center gap-3"
              >
                <motion.div
                  animate={{ rotate: 360, scale: [1, 1.15, 1] }}
                  transition={{ rotate: { duration: 2, repeat: Infinity, ease: 'linear' }, scale: { duration: 1, repeat: Infinity } }}
                  className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#5B4FF7] to-[#7C6BFF] text-white shadow-lg shadow-[#5B4FF7]/30"
                >
                  <Sparkles className="h-5 w-5" />
                </motion.div>
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="bg-gradient-to-r from-slate-400 via-[#5B4FF7] to-slate-400 bg-[length:200%_auto] bg-clip-text font-medium text-transparent [animation:shimmer_1.5s_linear_infinite]">
                    Generating SQL…
                  </span>
                </div>
              </motion.div>
            ) : (
              <motion.pre
                key="sql"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-slate-700"
              >
                {highlight(typedSql)}
                {phase === 'generating' && (
                  <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-[#5B4FF7] align-middle" />
                )}
              </motion.pre>
            )}
          </AnimatePresence>
        </div>

        {/* success badge */}
        <AnimatePresence>
          {phase === 'done' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 shadow-sm"
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              <span className="text-xs font-medium text-emerald-700">Generated in 1.23s</span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
