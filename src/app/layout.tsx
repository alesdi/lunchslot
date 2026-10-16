import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import { Logo } from "@/components/logo";
import "./globals.css";

const schibsted = Schibsted_Grotesk({ variable: "--font-schibsted", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Lunchslot — find a time that works for everyone",
  description:
    "Drop your availability in any format, share the link, and Lunchslot proposes the times that work for everyone. Free and open source.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f5ee" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1b18" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${schibsted.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <div className="mx-auto flex min-h-dvh max-w-[40rem] flex-col px-4 sm:px-6">
          <header className="flex items-center justify-between pt-6 pb-10 sm:pt-8">
            <Logo />
          </header>
          <main className="flex-1">{children}</main>
          <footer className="py-10 text-sm text-muted">
            Free and open source.{" "}
            <a className="underline underline-offset-2 hover:text-ink" href="https://github.com/alesdi/lunchslot">
              Code on GitHub
            </a>
          </footer>
        </div>
      </body>
    </html>
  );
}
