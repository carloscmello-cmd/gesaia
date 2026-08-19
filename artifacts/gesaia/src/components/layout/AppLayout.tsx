import { useState } from "react";
import { Link, useLocation } from "wouter";
import { UserButton } from "@clerk/react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Building2,
  Network,
  MessageSquare,
  Settings,
  Menu,
  X,
  TrendingUp,
  ChevronRight,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { getMe, getGetMeQueryKey } from "@workspace/api-client-react";

interface AppLayoutProps {
  children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { t } = useTranslation();

  const { data: me } = useQuery({
    queryKey: getGetMeQueryKey(),
    queryFn: getMe,
    staleTime: 60_000,
  });

  const isAdmin = me?.role === "admin";

  const navItems = [
    { href: "/", icon: LayoutDashboard, label: t("nav.dashboard") },
    { href: "/companies", icon: Building2, label: t("nav.companies") },
    { href: "/networks", icon: Network, label: t("nav.networks") },
    { href: "/investigations", icon: MessageSquare, label: t("nav.investigations") },
    ...(isAdmin ? [{ href: "/users", icon: Users, label: t("nav.users") }] : []),
    { href: "/settings", icon: Settings, label: t("nav.settings") },
  ];

  const Sidebar = ({ className }: { className?: string }) => (
    <aside
      className={cn(
        "flex flex-col h-full bg-sidebar text-sidebar-foreground border-r border-sidebar-border",
        className,
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-sidebar-border">
        <div className="w-8 h-8 bg-sidebar-primary rounded-lg flex items-center justify-center flex-shrink-0">
          <TrendingUp className="w-4 h-4 text-sidebar-primary-foreground" />
        </div>
        <div>
          <div className="font-bold text-base text-sidebar-foreground leading-none">GESAIA</div>
          <div className="text-[10px] text-sidebar-foreground/50 mt-0.5 leading-none">{t("nav.intelGerencial")}</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = href === "/" ? location === "/" : location.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60",
              )}
              onClick={() => setMobileOpen(false)}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">{label}</span>
              {active && <ChevronRight className="w-3 h-3 opacity-50" />}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="px-4 py-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3">
          <UserButton
            appearance={{
              elements: {
                avatarBox: "w-8 h-8",
              },
            }}
          />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-sidebar-foreground/50">{t("nav.account")}</div>
          </div>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <div className="hidden md:flex w-60 flex-col flex-shrink-0 no-print">
        <Sidebar className="w-full" />
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden no-print"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 flex flex-col md:hidden transition-transform duration-200 no-print",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Sidebar className="w-full" />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <header className="flex items-center gap-3 px-4 py-3 bg-background border-b border-border md:hidden no-print">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
          <span className="font-semibold text-foreground">GESAIA</span>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
