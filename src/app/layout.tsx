import "./globals.css";

/**
 * Root layout — the outer shell for every page.
 * Next.js requires this file. It provides the <html> and <body> tags.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <title>WeStamp — Stamp Duty Calculator</title>
      </head>
      <body>{children}</body>
    </html>
  );
}
