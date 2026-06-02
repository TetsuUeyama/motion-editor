import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Motion Editor — Unity → Babylon.js",
  description: "Import Unity assets (animations, models) into Babylon.js games",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
