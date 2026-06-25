import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SKIM',
  description: '실시간 경제뉴스 브리핑 SKIM',
  manifest: '/manifest.json'
};

export const viewport: Viewport = {
  themeColor: '#fff8ff'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
