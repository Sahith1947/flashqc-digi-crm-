import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { ToastProvider } from '@/components/ui/toast';
import './globals.css';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'FlashQC Digi · Call Operations', template: '%s · FlashQC Digi' },
  description: 'FlashQC Digi call operations CRM: inbound, outbound and bulk calling, recordings, transcripts and analytics.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#0b0b0b', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en-IN" className={`${inter.variable} h-full`}>
      <body className="min-h-full">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
