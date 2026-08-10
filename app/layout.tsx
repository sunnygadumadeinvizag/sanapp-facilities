import type { Metadata } from "next";
import "iipe-common-ui/styles.css";
import "./globals.css";
import { ThemeScript } from "iipe-common-ui";

export const metadata: Metadata = {
  title: "IIPE Facilities Booking",
  description: "Book institute facilities — buildings, rooms and slots (Indian Standard Time).",
};

const SSO_BASE_URL = process.env.SSO_BASE_URL!;

async function getTheme() {
  const fallback = { mode: "system", primary: "#0b5d4f", accent: "#d9a441" } as const;
  try {
    const res = await fetch(`${SSO_BASE_URL}/api/theme`, { cache: "no-store", signal: AbortSignal.timeout(2000) });
    if (!res.ok) return fallback;
    const data = await res.json();
    return {
      mode: data.mode ?? fallback.mode,
      primary: data.primary ?? fallback.primary,
      accent: data.accent ?? fallback.accent,
    };
  } catch {
    return fallback;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await getTheme();
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeScript
          defaultMode={theme.mode}
          primary={theme.primary}
          accent={theme.accent}
        />
        {children}
      </body>
    </html>
  );
}
