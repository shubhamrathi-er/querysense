import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { DashboardBackground } from '@/components/dashboard/DashboardBackground';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <div className="flex h-screen bg-background overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Header />
          {/* Shared premium backdrop for all dashboard pages (rendered once here). */}
          <main className="relative flex-1 overflow-hidden flex flex-col">
            <DashboardBackground />
            {children}
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}