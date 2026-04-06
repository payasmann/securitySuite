"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// ─── Icon Components (inline SVGs for zero dependencies) ─────

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

function CamerasIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="4" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M14 8L18 5.5V12.5L14 10" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
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

function ManagementIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 2V4M10 16V18M18 10H16M4 10H2M15.66 4.34L14.24 5.76M5.76 14.24L4.34 15.66M15.66 15.66L14.24 14.24M5.76 5.76L4.34 4.34" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ─── Navigation Items ────────────────────────────────────

interface NavItem {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

const schoolNavItems: NavItem[] = [
  { href: "/dashboard", icon: DashboardIcon, label: "Dashboard" },
  { href: "/cameras", icon: CamerasIcon, label: "Cameras" },
  { href: "/alerts", icon: AlertsIcon, label: "Alerts" },
  { href: "/management", icon: ManagementIcon, label: "Management" },
];

// ─── Sidebar Component ──────────────────────────────────

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-sidebar bg-bg-sidebar border-r border-border z-50 flex flex-col items-center">
      {/* Brand icon */}
      <div className="w-full h-sidebar flex items-center justify-center border-b border-border">
        <div className="w-8 h-8 bg-accent/10 rounded-lg flex items-center justify-center">
          <span className="text-accent font-bold text-xs">SG</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 w-full py-3 flex flex-col items-center gap-1">
        {schoolNavItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));

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

// ─── Nav Button with Tooltip ────────────────────────────

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

      {/* Active indicator */}
      {isActive && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-accent rounded-r" />
      )}

      {/* Tooltip */}
      <div className="absolute left-full ml-2 px-2 py-1 bg-bg-card border border-border rounded text-xs text-text-primary whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-50">
        {label}
      </div>
    </Link>
  );
}
