import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PCSJ Quiz",
  description:
    "Practice sets for the Delhi Judicial Service and UP PCS(J) examinations.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the page paint under an iPad's rounded corners; `.page-shell` keeps
  // the content clear of them. Zoom is deliberately left alone.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="page-shell mx-auto w-full pt-5">{children}</div>
      </body>
    </html>
  );
}
