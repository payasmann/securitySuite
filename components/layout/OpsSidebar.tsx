"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// ─── Icon Components ─────────────────────────────────────

function DashboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="2" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2" y="11" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="11" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function SchoolsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 2L2 7V18H8V13H12V18H18V7L10 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function AlertsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8.5 3.5C9.1 2.17 10.9 2.17 11.5 3.5L17 15C17.5 16.17 16.67 17.5 15.37 17.5H4.63C3.33 17.5 2.5 16.17 3 15L8.5 3.5Z" stroke="currentColor" strokeWidth="1.5" />
      <line x1="10" y1="8" x2="10" y2="11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="14" r="0.75" fill="currentColor" />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="6" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 17C4 13.69 6.69 11 10 11C13.31 11 16 13.69 16 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ─── Navigation Items ────────────────────────────────────

interface NavItem {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

const opsNavItems: NavItem[] = [
  { href: "/ops/dashboard", icon: DashboardIcon, label: "Dashboard" },
  { href: "/ops/schools", icon: SchoolsIcon, label: "Schools" },
  { href: "/ops/alerts", icon: AlertsIcon, label: "Alerts" },
  { href: "/ops/users", icon: UsersIcon, label: "Users" },
];

// ─── Sidebar Component ──────────────────────────────────

export default function OpsSidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-sidebar bg-bg-sidebar border-r border-border z-50 flex flex-col items-center">
      {/* Brand icon — different accent for ops */}
      <div className="w-full h-sidebar flex items-center justify-center border-b border-border">
        <div className="w-8 h-8 bg-status-warning/10 rounded-lg flex items-center justify-center">
          <span className="text-status-warning font-bold text-xs">OP</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 w-full py-3 flex flex-col items-center gap-1">
        {opsNavItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/ops/dashboard" && pathname.startsWith(item.href));

          return (
            <NavButton
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              isActive={isActive}
            />
          );
        })}
      </nav>
    </aside>
  );
}

function NavButton({
  href,
  icon: Icon,
  label,
  isActive,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  isActive: boolean;
}) {
  return (
    <Link
      href={href}
      className={`
        group relative w-10 h-10 flex items-center justify-center rounded-lg
        transition-all duration-200
        ${
          isActive
            ? "bg-accent/15 text-accent"
            : "text-text-muted hover:text-text-secondary hover:bg-bg-hover"
        }
      `}
      aria-label={label}
    >
      <Icon className="w-5 h-5" />
      {isActive && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-accent rounded-r" />
      )}
      <div className="absolute left-full ml-2 px-2 py-1 bg-bg-card border border-border rounded text-xs text-text-primary whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-50">
        {label}
      </div>
    </Link>
  );
}
