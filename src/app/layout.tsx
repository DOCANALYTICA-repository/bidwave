import type { Metadata } from "next";
import {
  Anton,
  League_Spartan,
  Arapey,
  Inter,
  JetBrains_Mono,
} from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

// Display — brochure-faithful stand-in for the commercial "Zuume Rough Bold".
// Swapping in a licensed font later is a one-file change (see docs/DESIGN_SYSTEM.md).
const fontDisplay = Anton({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

// Headings, labels, ticker/scoreboard text.
const fontHeading = League_Spartan({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

// Editorial serif for brochure-derived long-form copy (round narratives, about section).
const fontSerif = Arapey({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

// UI / body text.
const fontSans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Tabular numerals — purse, scores, timers, timestamps.
const fontMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "Bidwave — The Pulse of IPL Auction",
    template: "%s · Bidwave",
  },
  description:
    "Bidwave — the IPL-style mock auction event by the Department of Commerce, CHRIST University. 17–19 August 2026.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${fontDisplay.variable} ${fontHeading.variable} ${fontSerif.variable} ${fontSans.variable} ${fontMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        <TooltipProvider delay={200}>
          {children}
          <Toaster position="top-right" />
        </TooltipProvider>
      </body>
    </html>
  );
}
