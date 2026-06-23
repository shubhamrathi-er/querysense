'use client';

import { useState, type MouseEvent } from 'react';
import { Sparkles } from 'lucide-react';
import { AnimatedGradient } from '@/components/ui/AnimatedGradient';
import { HeroSection } from '@/components/showcase/HeroSection';
import { QueryDemo } from '@/components/showcase/QueryDemo';
import { DatabaseIntegrations } from '@/components/showcase/DatabaseIntegrations';
import { LoginCard } from '@/components/auth/LoginCard';

export default function LoginPage() {
  const [glow, setGlow] = useState({ x: -400, y: -400 });

  const handleMove = (e: MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setGlow({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden lg:h-screen lg:overflow-hidden">
      <AnimatedGradient />
      {/* mouse-following glow */}
      <div
        className="pointer-events-none absolute h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#5B4FF7]/15 blur-3xl transition-transform duration-300 ease-out"
        style={{ left: glow.x, top: glow.y }}
      />

      <div className="relative z-10 flex min-h-screen flex-col lg:h-screen lg:flex-row">
        {/* ── Left: product showcase ── */}
        <section
          onMouseMove={handleMove}
          className="relative hidden flex-col justify-between overflow-hidden px-10 py-8 lg:flex lg:h-screen lg:w-[60%] xl:px-14 xl:py-10"
        >


          <div className="relative">
            <HeroSection />
          </div>

          <div className="relative mt-5 xl:mt-7">
            <QueryDemo />
          </div>

          <div className="relative mt-5 xl:mt-7">
            <DatabaseIntegrations />
          </div>
        </section>

        {/* ── Right: auth ── */}
        <section className="flex w-full items-center justify-center px-6 py-8 lg:h-screen lg:w-[40%] lg:px-8">
          <div className="w-full max-w-md">
            {/* Mobile-only brand header (showcase is hidden on small screens) */}
            <div className="mb-8 flex flex-col items-center text-center lg:hidden">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#5B4FF7] to-[#7C6BFF] text-white shadow-lg shadow-[#5B4FF7]/25">
                  <Sparkles className="h-5 w-5" />
                </div>
                <span className="text-lg font-bold tracking-tight text-slate-900">
                  QuerySense <span className="text-[#5B4FF7]">AI</span>
                </span>
              </div>
              <p className="mt-3 text-sm text-slate-500">
                Turn natural language into accurate SQL in seconds.
              </p>
            </div>

            <LoginCard />
          </div>
        </section>
      </div>
    </div>
  );
}
