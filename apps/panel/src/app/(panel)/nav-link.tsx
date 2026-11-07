"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

function Item({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 text-sm ${
        active ? "bg-accent/15 font-medium text-accent" : "text-muted hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );
}

const ITEMS = [
  { href: "/temas", label: "Temas" },
  { href: "/setlists", label: "Setlists" },
];

function ActiveNav() {
  const path = usePathname();
  return ITEMS.map((i) => <Item key={i.href} {...i} active={path.startsWith(i.href)} />);
}

export function Nav() {
  return (
    <Suspense fallback={ITEMS.map((i) => <Item key={i.href} {...i} active={false} />)}>
      <ActiveNav />
    </Suspense>
  );
}
