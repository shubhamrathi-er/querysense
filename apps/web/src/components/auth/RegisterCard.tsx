'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Sparkles, ShieldCheck } from 'lucide-react';
import { RegisterForm } from './RegisterForm';

export function RegisterCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-md"
    >
      <div className="rounded-[1.75rem] border border-white/70 bg-white/70 p-6 shadow-[0_24px_80px_rgba(30,27,75,0.16)] backdrop-blur-2xl sm:p-7">
        {/* Logo icon */}
        <div className="flex justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#5B4FF7] to-[#7C6BFF] text-white shadow-lg shadow-[#5B4FF7]/30">
            <Sparkles className="h-6 w-6" />
          </div>
        </div>

        {/* Heading */}
        <h2 className="mt-4 text-center text-2xl font-bold tracking-tight text-slate-900">
          Create your account
        </h2>
        <p className="mt-1 text-center text-sm text-slate-500">
          Start chatting with your data in seconds
        </p>

        {/* Divider */}
        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-200" />
          <div className="h-1 w-1 rounded-full bg-slate-300" />
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        <RegisterForm />

        {/* Footer */}
        <p className="mt-5 text-center text-sm text-slate-500">
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-[#5B4FF7] hover:underline">
            Sign in
          </Link>
        </p>
      </div>

      {/* Security badge */}
      <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-400">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
        Secure signup • Your data is protected
      </div>
    </motion.div>
  );
}
