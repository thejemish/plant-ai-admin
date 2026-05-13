"use client";

import {
  BookOpen,
  Database,
  FlaskConical,
  Gauge,
  ImagePlus,
  Import,
  Leaf,
  ShieldCheck,
  Sprout,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavigationItem = {
  href: string;
  icon: LucideIcon;
  label: string;
};

const navigation: NavigationItem[] = [
  { href: "/", label: "Overview", icon: Gauge },
  { href: "/crops", label: "Crops", icon: Sprout },
  { href: "/diseases", label: "Diseases", icon: Leaf },
  { href: "/treatments", label: "Treatments", icon: ShieldCheck },
  { href: "/leaves", label: "Reference leaves", icon: ImagePlus },
  { href: "/imports", label: "Dataset imports", icon: Import },
  { href: "/embeddings", label: "Embeddings", icon: FlaskConical },
  { href: "/guides", label: "Guides", icon: BookOpen },
  { href: "/snapshots", label: "Snapshots", icon: Database },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
      {navigation.map((item) => {
        const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            className={
              isActive
                ? "flex h-9 items-center gap-2 rounded-md bg-sidebar-accent px-3 text-sm font-medium text-sidebar-accent-foreground"
                : "flex h-9 items-center gap-2 rounded-md px-3 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            }
            href={item.href}
          >
            <item.icon className="size-4" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileSectionNav() {
  const pathname = usePathname();

  return (
    <div className="flex gap-2 overflow-x-auto border-b bg-background px-4 py-2 lg:hidden">
      {navigation.map((item) => {
        const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            className={
              isActive
                ? "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"
                : "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 text-xs text-muted-foreground"
            }
            href={item.href}
          >
            <item.icon className="size-3.5" />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
