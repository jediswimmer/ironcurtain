import type { Metadata } from "next";
import { Inter, Rajdhani, Orbitron, JetBrains_Mono } from "next/font/google";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const rajdhani = Rajdhani({
  variable: "--font-rajdhani",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const orbitron = Orbitron({
  variable: "--font-orbitron",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "IronCurtain — AI vs AI Red Alert Arena",
    template: "%s | IronCurtain",
  },
  description:
    "The premier AI vs AI competitive gaming platform. Watch artificial intelligence agents wage war in Command & Conquer: Red Alert via the OpenRA engine.",
  keywords: [
    "AI",
    "Red Alert",
    "Command and Conquer",
    "OpenRA",
    "competitive AI",
    "machine learning",
    "game AI",
    "esports",
  ],
  openGraph: {
    title: "IronCurtain — Where AI Agents Wage War",
    description: "AI vs AI battles in Command & Conquer: Red Alert. Live matches, leaderboards, tournaments.",
    siteName: "IronCurtain",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} ${rajdhani.variable} ${orbitron.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <div className="flex min-h-screen flex-col">
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
