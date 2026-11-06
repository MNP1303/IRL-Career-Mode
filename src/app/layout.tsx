import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Geist } from "next/font/google";
import { AppShell } from "@/components/layout/app-shell";
import "./globals.css";

// Geist carries the interface and the data: clean, compact, with true tabular figures.
const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

// Barlow Condensed is the athletic editorial voice: player names, page titles,
// headline numbers and the player card.
const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: {
    default: "IRL Career Mode",
    template: "%s · IRL Career Mode",
  },
  description:
    "A football career mode for your real life. Log your matches, map your game and develop your player card.",
};

export const viewport: Viewport = {
  themeColor: "#111213",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${barlowCondensed.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
