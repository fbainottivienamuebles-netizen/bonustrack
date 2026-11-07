import Link from "next/link";
import { logout } from "../actions";
import { Nav } from "./nav-link";

export default function PanelLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center gap-1 px-4 py-2.5">
          <Link href="/temas" className="mr-4 font-semibold">
            Letras en vivo
          </Link>
          <Nav />
          <form action={logout} className="ml-auto">
            <button className="text-sm text-muted hover:text-foreground">Salir</button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </>
  );
}
