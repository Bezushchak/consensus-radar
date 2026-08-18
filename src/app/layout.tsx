import type { Metadata, Viewport } from "next";
import { LangProvider } from "@/components/LangProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Consensus Radar",
  description:
    "A Wavelength-style calibration game for teams — everyone plays from their own phone, results land on a shared leaderboard.",
  openGraph: {
    title: "Consensus Radar",
    description: "Tune into your team's wavelength.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0c1020",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <body>
        <LangProvider>{children}</LangProvider>
      </body>
    </html>
  );
}
