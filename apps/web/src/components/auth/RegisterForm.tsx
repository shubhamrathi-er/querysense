'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { Loader2, Mail, Lock, User, Eye, EyeOff, ArrowRight, AlertCircle } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { cn } from '@/lib/utils';

const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/[0-9]/, 'Must contain a number'),
});
type RegisterForm = z.infer<typeof registerSchema>;

interface RegisterResponse {
  data: {
    user: { id: string; email: string; name: string; avatarUrl: string | null };
    accessToken: string;
    refreshToken: string;
  };
}
interface Workspace { id: string; name: string; slug: string; plan: string }

const fieldClass = cn(
  'w-full rounded-xl border bg-white/70 py-2.5 pl-11 pr-11 text-sm text-slate-800',
  'placeholder:text-slate-400 outline-none transition-all duration-200',
  'focus:border-[#5B4FF7] focus:ring-4 focus:ring-[#5B4FF7]/15',
);

export function RegisterForm() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const { setWorkspaces, setCurrentWorkspace } = useWorkspaceStore();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({ resolver: zodResolver(registerSchema) });

  const onSubmit = async (data: RegisterForm) => {
    setError(null);
    try {
      const response = (await apiClient.post('/auth/register', data)) as RegisterResponse;
      const { user, accessToken, refreshToken } = response.data;
      setAuth(user, accessToken, refreshToken);

      const workspacesRes = (await apiClient.get('/workspaces')) as { data: Workspace[] };
      const workspaces = workspacesRes.data;
      setWorkspaces(workspaces);
      if (workspaces.length > 0) setCurrentWorkspace(workspaces[0]);

      router.push('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed. Please try again.');
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Name */}
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">Full name</label>
        <div className="relative">
          <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            {...register('name')}
            placeholder="John Doe"
            autoComplete="name"
            className={cn(fieldClass, errors.name ? 'border-red-400' : 'border-slate-200')}
          />
        </div>
        {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>}
      </div>

      {/* Email */}
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">Email</label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            {...register('email')}
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            className={cn(fieldClass, errors.email ? 'border-red-400' : 'border-slate-200')}
          />
        </div>
        {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>}
      </div>

      {/* Password */}
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">Password</label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            {...register('password')}
            type={showPassword ? 'text' : 'password'}
            placeholder="Min 8 chars, 1 uppercase, 1 number"
            autoComplete="new-password"
            className={cn(fieldClass, errors.password ? 'border-red-400' : 'border-slate-200')}
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPassword((s) => !s)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-600"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password.message}</p>}
      </div>

      {/* Error */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </motion.div>
      )}

      {/* CTA */}
      <motion.button
        type="submit"
        disabled={isSubmitting}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.985 }}
        className={cn(
          'group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl py-3',
          'bg-gradient-to-r from-[#5B4FF7] to-[#7C6BFF] text-sm font-semibold text-white',
          'shadow-lg shadow-[#5B4FF7]/30 transition-shadow hover:shadow-xl hover:shadow-[#5B4FF7]/40',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
      >
        <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
        {isSubmitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            Create account
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </>
        )}
      </motion.button>
    </form>
  );
}
