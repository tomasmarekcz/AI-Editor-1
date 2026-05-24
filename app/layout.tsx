import type { Metadata } from 'next';
import { BackgroundVideoWidget } from './dashboard/BackgroundVideoWidget';
import './globals.css';

const GOOGLE_FONTS =
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Montserrat:wght@700;900' +
  '&family=Anton&family=Poppins:wght@700;900&family=Inter:wght@700;900' +
  '&family=Archivo+Black&family=League+Spartan:wght@700;900' +
  '&family=Raleway:wght@700;900&family=Oswald:wght@700' +
  '&family=Roboto+Condensed:wght@700&display=swap';

export const metadata: Metadata = {
  title: 'AI Video Generator',
  description: 'Vytvoř video ze scénáře pomocí AI',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href={GOOGLE_FONTS} rel="stylesheet" />
      </head>
      <body className="bg-gray-950 text-white min-h-screen antialiased">
        {children}
        <BackgroundVideoWidget />
      </body>
    </html>
  );
}
