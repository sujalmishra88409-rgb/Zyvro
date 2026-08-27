import type { Metadata, Viewport } from "next";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "ZYVRO — friends on one dark map",
  description:
    "ZYVRO is a private, mobile-first friend-location map. Dark tactical cartography, live presence, weather and environment at a glance.",
  applicationName: "ZYVRO",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icon-192.png",
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "ZYVRO",
    description: "Private friend locations on one dark tactical map.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0B0D0C",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="antialiased bg-[#0B0D0C] text-[#EDEAE0] overscroll-none">
        {children}
        <Toaster
          theme="dark"
          position="top-center"
          offset={64}
          toastOptions={{
            style: {
              background: "#141816",
              border: "1px solid rgba(237,234,224,0.1)",
              color: "#EDEAE0",
              borderRadius: "14px",
              fontSize: "13px",
            },
          }}
        />
      </body>
    </html>
  );
}
