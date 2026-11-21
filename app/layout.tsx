import type { Metadata } from "next";
import { Atkinson_Hyperlegible, IBM_Plex_Serif } from "next/font/google";
import "./globals.css";

// Atkinson Hyperlegible: designed by the Braille Institute for readers with low vision.
const atkinson = Atkinson_Hyperlegible({ variable: "--font-atkinson", subsets: ["latin"], weight: ["400", "700"] });
// IBM Plex Serif: headlines only (greeting, screen titles, card titles).
const plexSerif = IBM_Plex_Serif({ variable: "--font-plex-serif", subsets: ["latin"], weight: ["600"] });

export const metadata: Metadata = {
  title: "Kin",
  description: "A personal shopping agent for older adults, with family in the loop and every step shown",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${atkinson.variable} ${plexSerif.variable} antialiased`}>{children}</body>
    </html>
  );
}
