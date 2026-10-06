import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Thai, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const plexThai = IBM_Plex_Sans_Thai({
  variable: "--font-plex-thai",
  weight: ["400", "500", "600", "700"],
  subsets: ["thai", "latin"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  weight: ["500", "700"],
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "TERMTEE — ดูไลฟ์สดแบบจ่ายต่อครั้ง", template: "%s | TERMTEE" },
  description: "TERMTEE แพลตฟอร์มถ่ายทอดสดแบบจ่ายต่อครั้ง พร้อมดูย้อนหลัง",
};

export const viewport: Viewport = {
  themeColor: "#060A22",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="th"
      className={`${plexThai.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-bg font-sans text-fg">{children}</body>
    </html>
  );
}
