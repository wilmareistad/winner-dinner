import "./globals.css";

export const metadata = {
  title: "WinnerDinner 2000",
  description: "Share the work of a dinner between friends.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
