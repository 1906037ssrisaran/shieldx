import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "@fontsource-variable/inter-tight";
import "@xyflow/react/dist/style.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShieldIQ | Fraud Investigation",
  description:
    "From fraud alerts to autonomous investigations. An explainable investigation workspace for financial risk teams.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
