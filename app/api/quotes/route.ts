import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type QuotePayload = {
  priceText: string;
  changeText: string;
  changeRate: number | null;
  source: 'naver' | 'yahoo' | 'unavailable';
};

type NaverQuoteItem = {
  cd?: string;
  nv?: number;
  cv?: number;
  cr?: number;
};

type NaverRealtimeResponse = {
  result?: {
    areas?: Array<{
      datas?: NaverQuoteItem[];
    }>;
  };
};

type YahooQuoteItem = {
  symbol?: string;
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
};

type YahooQuoteResponse = {
  quoteResponse?: {
    result?: YahooQuoteItem[];
  };
};

function formatKrw(value: number) {
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function formatUsd(value: number) {
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}달러`;
}

function formatRate(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '등락률 확인 중';
  const arrow = value >= 0 ? '↑' : '↓';
  return `${arrow} ${Math.abs(value).toFixed(2)}%`;
}

async function fetchWithTimeout(url: string, timeoutMs = 1800) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 SKIM/quote-loader',
        Accept: 'application/json,text/plain,*/*',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchNaverQuotes(codes: string[]) {
  const krCodes = codes.filter((code) => /^\d{6}$/.test(code));
  if (krCodes.length === 0) return {} as Record<string, QuotePayload>;

  const query = krCodes.map((code) => `SERVICE_ITEM:${code}`).join('|');
  const url = `https://polling.finance.naver.com/api/realtime?query=${encodeURIComponent(query)}`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`Naver quote failed: ${response.status}`);
  const data = (await response.json()) as NaverRealtimeResponse;
  const items = data.result?.areas?.flatMap((area) => area.datas || []) || [];
  const result: Record<string, QuotePayload> = {};

  for (const item of items) {
    const code = item.cd;
    if (!code || typeof item.nv !== 'number') continue;
    const rate = typeof item.cr === 'number' ? item.cr : null;
    result[code] = {
      priceText: formatKrw(item.nv),
      changeText: formatRate(rate),
      changeRate: rate,
      source: 'naver',
    };
  }

  return result;
}

async function fetchYahooQuotes(codes: string[]) {
  const symbols = codes.filter((code) => !/^\d{6}$/.test(code));
  if (symbols.length === 0) return {} as Record<string, QuotePayload>;

  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`Yahoo quote failed: ${response.status}`);
  const data = (await response.json()) as YahooQuoteResponse;
  const items = data.quoteResponse?.result || [];
  const result: Record<string, QuotePayload> = {};

  for (const item of items) {
    const symbol = item.symbol;
    if (!symbol || typeof item.regularMarketPrice !== 'number') continue;
    const rate = typeof item.regularMarketChangePercent === 'number' ? item.regularMarketChangePercent : null;
    result[symbol] = {
      priceText: formatUsd(item.regularMarketPrice),
      changeText: formatRate(rate),
      changeRate: rate,
      source: 'yahoo',
    };
  }

  return result;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const codes = Array.from(new Set((url.searchParams.get('codes') || '')
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean)))
    .slice(0, 12);

  if (codes.length === 0) {
    return NextResponse.json({ quotes: {}, generatedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const quotes: Record<string, QuotePayload> = {};
  const warnings: string[] = [];

  try {
    Object.assign(quotes, await fetchNaverQuotes(codes));
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : 'Naver quote unavailable');
  }

  try {
    Object.assign(quotes, await fetchYahooQuotes(codes));
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : 'Yahoo quote unavailable');
  }

  for (const code of codes) {
    if (!quotes[code]) {
      quotes[code] = {
        priceText: '시세 확인 중',
        changeText: '실시간 연동 대기',
        changeRate: null,
        source: 'unavailable',
      };
    }
  }

  return NextResponse.json(
    { quotes, generatedAt: new Date().toISOString(), warnings: warnings.slice(0, 2) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
