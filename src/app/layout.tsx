import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Toaster } from "sonner";
import { PwaRoot } from "@/components/pwa/pwa-root";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: { default: t("appName"), template: `%s · ${t("appName")}` },
    applicationName: t("appName"),
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, title: t("appName"), statusBarStyle: "default" },
    // Older iOS versions only honour the apple-prefixed tag for Home Screen standalone mode.
    other: { "apple-mobile-web-app-capable": "yes" },
    icons: {
      icon: { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180" },
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className="antialiased">
        <NextIntlClientProvider>
          {children}
          <PwaRoot />
          {/* Phones: the 16px page gutter on the sides, below the notch/status bar on top. */}
          <Toaster
            position="top-center"
            richColors
            closeButton
            mobileOffset={{ top: "max(16px, env(safe-area-inset-top))", left: 16, right: 16, bottom: "max(16px, env(safe-area-inset-bottom))" }}
            toastOptions={{ className: "!rounded-2xl !font-sans" }}
          />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
