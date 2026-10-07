import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "WinnerDinner 2000",
  description: "Share the work of a dinner between friends.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#faf8f5",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            <span aria-hidden="true">🍽️</span> WinnerDinner 2000
          </Link>
        </header>
        {children}
      </body>
    </html>
  );
}
