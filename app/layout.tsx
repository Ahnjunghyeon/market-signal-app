import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Market Signal v1.5',
  description: 'DB 없이 동작하는 실시간 중요 경제뉴스 스캐너',
  manifest: '/manifest.json'
};

export const viewport: Viewport = {
  themeColor: '#07111f'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
