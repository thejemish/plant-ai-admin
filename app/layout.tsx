import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AdminQueryProvider } from "@/components/admin/query-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Plant-AI Admin",
  description: "Admin contract dashboard for Plant-AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AdminQueryProvider>{children}</AdminQueryProvider>
      </body>
    </html>
  );
}
