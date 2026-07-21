import { BookText, KeyRound, Menu, Smartphone, Terminal, Webhook } from 'lucide-react';
import { useState, type ComponentType } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { BrandLockup } from '@/components/layout/brand';
import { UserMenu } from '@/components/layout/user-menu';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import type { SessionUser } from '@/lib/types';
import { cn } from '@/lib/utils';

type NavItem = { to: string; label: string; icon: ComponentType<{ className?: string }> };

const NAV: NavItem[] = [
  { to: '/app/numbers', label: 'Numbers', icon: Smartphone },
  { to: '/app/webhooks', label: 'Webhooks', icon: Webhook },
  { to: '/app/api-keys', label: 'API keys', icon: KeyRound },
  { to: '/app/developer', label: 'Developer', icon: Terminal },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
              'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              isActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
            )
          }
        >
          <Icon className="size-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function SidebarBody({ user, onNavigate }: { user: SessionUser; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-2 bg-sidebar">
      <div className="px-4 pt-5 pb-3">
        <BrandLockup />
      </div>
      <div className="flex-1 overflow-y-auto px-3">
        <NavItems onNavigate={onNavigate} />
      </div>
      <div className="border-t border-sidebar-border p-2.5">
        <UserMenu user={user} />
      </div>
    </div>
  );
}

export function AppLayout({ user }: { user: SessionUser }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-svh bg-background lg:grid lg:grid-cols-[15.5rem_1fr]">
      <aside className="sticky top-0 hidden h-svh border-r border-sidebar-border lg:block">
        <SidebarBody user={user} />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Open navigation">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[16rem] p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarBody user={user} onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <div className="lg:hidden">
            <BrandLockup />
          </div>

          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
              <a href="/docs" target="_blank" rel="noreferrer">
                <BookText /> API reference
              </a>
            </Button>
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
