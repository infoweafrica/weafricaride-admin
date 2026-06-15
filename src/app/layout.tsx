import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { CityProvider } from "@/lib/city-context";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "WeAfrica Ride - Admin Dashboard",
  description: "Admin dashboard for WeAfrica Ride platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          <CityProvider>
            {children}
          </CityProvider>
        </AuthProvider>
      </body>
    </html>
  );
}