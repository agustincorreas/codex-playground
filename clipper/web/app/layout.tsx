import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clipper",
  description: "Clips verticales a partir de videos largos",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen">
        <header className="border-b" style={{ borderColor: "var(--border)" }}>
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">Clipper</Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/" className="muted hover:underline">Nuevo</Link>
              <Link href="/#historial" className="muted hover:underline">Historial</Link>
              <Link href="/settings" className="muted hover:underline">Configuración</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
