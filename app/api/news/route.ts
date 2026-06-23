import { NextResponse } from 'next/server';
import { analyzeContentQuality, buildReason, calculateFinalScore, calculateFreshness, calculateImportance, extractRelatedStocks, extractTags, inferMarketRegion, inferSentiment, sortNews } from '@/lib/scoring';
import type { MarketNews } from '@/types/news';

type RawArticle = {
  url: string;
  title: string;
  publishedAt?: string;
  source?: string;
  summary?: string;
  queryTerms?: string[];
};

type GdeltArticle = {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
};

type CachePayload = {
  news: MarketNews[];
  generatedAt: string;
  sourceMode: 'live' | 'fallback';
  provider: string;
  warnings?: string[];
  cacheHit?: boolean;
};

declare global {
  // eslint-disable-next-line no-var
  var __marketSignalCache: { key: string; expiresAt: number; payload: CachePayload } | undefined;
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const RSS_TIMEOUT_MS = 1200;
const GDELT_TIMEOUT_MS = 900;
const CACHE_TTL_MS = 1000 * 60 * 2;
const STALE_TTL_MS = 1000 * 60 * 10;

async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = RSS_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

const BASE_QUERIES = [
  'when:1d 한국경제 OR 코스피 OR 코스닥 OR 환율 OR 금리',
  'when:1d 국내증시 OR 반도체 OR AI OR HBM OR 전력 OR 조선 OR 방산',
  'when:1d 미국경제 OR 뉴욕증시 OR 나스닥 OR S&P500 OR 연준 OR FOMC OR CPI OR PCE',
  'when:1d 엔비디아 OR 테슬라 OR 미국금리 OR 달러 OR 미 국채'
];

const GDELT_QUERY = [
  'economy', 'stock market', 'finance', 'interest rates', 'inflation', 'semiconductor',
  'AI', 'HBM', 'Korea stocks', 'exchange rate', 'shipbuilding', 'defense'
].join(' OR ');

function decodeHtml(value = '') {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTagValue(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return decodeHtml(match?.[1] || '');
}

function unwrapGoogleNewsUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('url') || url;
  } catch {
    return url;
  }
}

function getDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'News';
  }
}

function makeId(url: string, title: string) {
  const seed = `${url}-${title}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return `news-${Math.abs(hash)}`;
}

function parseGdeltDate(value?: string) {
  if (!value) return new Date().toISOString();
  const normalized = value.replace(/(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?/, '$1-$2-$3T$4:$5:$6Z');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeTitle(title: string) {
  return decodeHtml(title)
    .replace(/\s+-\s+[^-]{2,30}$/g, '')
    .replace(/\[[^\]]{1,18}\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toMarketNews(article: RawArticle, watchlist: string[]): MarketNews | null {
  const title = decodeHtml(article.title || '');
  const normalizedTitle = normalizeTitle(title);
  const originalUrl = article.url || '';
  if (!title || !originalUrl) return null;

  const source = article.source || getDomain(originalUrl);
  const summary = decodeHtml(article.summary || `${source}에서 감지된 최근 경제/시장 뉴스입니다. 제목과 관심 키워드 기준으로 중요도를 산정했습니다.`);
  const publishedAt = article.publishedAt || new Date().toISOString();
  const tags = extractTags(title, summary);
  const relatedStocks = extractRelatedStocks(title, summary, watchlist);
  const importanceScore = calculateImportance(title, summary, watchlist);
  const freshnessScore = calculateFreshness(publishedAt);
  const quality = analyzeContentQuality(source, title, summary, originalUrl);
  const finalScore = calculateFinalScore(importanceScore, quality.reliabilityScore, freshnessScore, quality.opinionScore);
  const region = inferMarketRegion(title, summary, source, originalUrl);
  const newsBase = { title, summary, tags, relatedStocks, importanceScore, ...quality, ...region };

  return {
    id: makeId(originalUrl, normalizedTitle || title),
    title,
    summary,
    source,
    originalUrl,
    publishedAt,
    importanceScore,
    reliabilityScore: quality.reliabilityScore,
    opinionScore: quality.opinionScore,
    freshnessScore,
    finalScore,
    contentType: quality.contentType,
    marketRegion: region.marketRegion,
    marketRegionLabel: region.marketRegionLabel,
    qualityLabel: quality.qualityLabel,
    sentiment: inferSentiment(title, summary),
    tags,
    relatedStocks,
    reason: buildReason(newsBase)
  };
}

async function fetchGoogleNewsRss(query: string, queryTerms: string[] = []): Promise<RawArticle[]> {
  const url = new URL('https://news.google.com/rss/search');
  url.searchParams.set('q', query);
  url.searchParams.set('hl', 'ko');
  url.searchParams.set('gl', 'KR');
  url.searchParams.set('ceid', 'KR:ko');

  const response = await fetchWithTimeout(url.toString(), {
    cache: 'no-store',
    headers: {
      'User-Agent': 'Mozilla/5.0 MarketSignal/1.2',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*'
    }
  }, RSS_TIMEOUT_MS);
  if (!response.ok) throw new Error(`Google News RSS 오류: ${response.status}`);

  const xml = await response.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];

  return items.map((item) => {
    const link = unwrapGoogleNewsUrl(getTagValue(item, 'link'));
    const source = getTagValue(item, 'source') || getDomain(link);
    const pubDate = getTagValue(item, 'pubDate');
    const date = pubDate ? new Date(pubDate) : new Date();

    return {
      title: getTagValue(item, 'title'),
      url: link,
      source,
      publishedAt: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
      summary: getTagValue(item, 'description') || `${source}에서 수집된 경제/시장 뉴스입니다.`,
      queryTerms
    };
  }).filter((article) => article.title && article.url);
}

async function fetchGdeltNews(watchlist: string[], limit: number): Promise<RawArticle[]> {
  const watchQuery = watchlist.slice(0, 4).filter(Boolean).map((item) => `"${item}"`).join(' OR ');
  const query = watchQuery ? `(${GDELT_QUERY}) OR (${watchQuery})` : GDELT_QUERY;
  const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  url.searchParams.set('query', query);
  url.searchParams.set('mode', 'ArtList');
  url.searchParams.set('format', 'json');
  url.searchParams.set('sort', 'DateDesc');
  url.searchParams.set('maxrecords', String(Math.min(Math.max(limit, 20), 36)));
  url.searchParams.set('timespan', '24h');

  const response = await fetchWithTimeout(url.toString(), {
    cache: 'no-store',
    headers: {
      'User-Agent': 'Mozilla/5.0 MarketSignal/1.2',
      'Accept': 'application/json, text/plain, */*'
    }
  }, GDELT_TIMEOUT_MS);
  if (!response.ok) throw new Error(`GDELT API 오류: ${response.status}`);

  const data = await response.json();
  const articles = Array.isArray(data.articles) ? data.articles as GdeltArticle[] : [];

  return articles.map((article) => ({
    title: article.title || '',
    url: article.url || '',
    source: article.domain || 'GDELT',
    publishedAt: parseGdeltDate(article.seendate),
    summary: `${article.domain || 'GDELT'}에서 감지된 최근 경제/시장 뉴스입니다.`,
    queryTerms: watchlist
  })).filter((article) => article.title && article.url);
}

function getFallbackNews(_watchlist: string[]) {
  // 시장성 서비스 특성상 하드코딩 뉴스는 사용하지 않습니다.
  // 실제 수집 실패 시에는 빈 배열과 오류 메시지를 내려 화면에서 재시도 안내를 표시합니다.
  return [] as MarketNews[];
}

function makeCacheKey(watchlist: string[], limit: number, mode: string) {
  return `${mode}::${watchlist.slice().sort().join('|')}::${limit}`;
}

function quoteIfNeeded(value: string) {
  const escaped = value.replace(/\"/g, '').trim();
  return /\s/.test(escaped) ? `\"${escaped}\"` : escaped;
}

function isUsefulStockTerm(value: string) {
  const term = value.trim();
  if (term.length < 2) return false;
  if (/^\d{6}$/.test(term)) return false;
  if (/^KR\d{10}$/i.test(term)) return false;
  return true;
}

function buildStockFocusedQueries(terms: string[]) {
  const cleanTerms = Array.from(new Set(terms
    .map((item) => item.trim())
    .filter(isUsefulStockTerm)
  ));

  if (cleanTerms.length === 0) return [] as { query: string; terms: string[] }[];

  const quoted = cleanTerms.slice(0, 10).map(quoteIfNeeded);
  const primary = quoted.slice(0, 6).join(' OR ');

  const queries: { query: string; terms: string[] }[] = [];

  // 종목별 직접 검색: 전체 피드 70건 재활용이 아니라 관심 종목 별도 검색 파이프라인입니다.
  cleanTerms.slice(0, 8).forEach((term) => {
    const quotedTerm = quoteIfNeeded(term);
    queries.push({ query: `when:30d ${quotedTerm}`, terms: [term] });
    queries.push({ query: `when:30d ${quotedTerm} 주식 OR 증권 OR 실적 OR 수주 OR 공시`, terms: [term] });
  });

  if (primary) {
    queries.push({ query: `when:7d ${primary}`, terms: cleanTerms.slice(0, 6) });
    queries.push({ query: `when:30d (${primary}) 뉴스`, terms: cleanTerms.slice(0, 6) });
  }

  const seen = new Set<string>();
  return queries.filter((item) => {
    const key = item.query.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}

function normalizeMatchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[()\[\]{}.,:;!?"'“”‘’·ㆍ_-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactMatchText(value: string) {
  return normalizeMatchText(value).replace(/\s+/g, '');
}

function articleMatchesWatchTerms(article: RawArticle, watchTerms: string[]) {
  if (watchTerms.length === 0) return true;
  const text = normalizeMatchText(`${article.title || ''} ${article.summary || ''} ${article.source || ''}`);
  const compact = compactMatchText(text);
  const queryText = normalizeMatchText((article.queryTerms || []).join(' '));
  const queryCompact = compactMatchText(queryText);

  return watchTerms.some((rawTerm) => {
    const term = normalizeMatchText(rawTerm);
    const compactTerm = compactMatchText(rawTerm);
    if (!term || compactTerm.length < 2) return false;
    return text.includes(term) || compact.includes(compactTerm) || queryText.includes(term) || queryCompact.includes(compactTerm);
  });
}


function withOverallTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`뉴스 공급처 응답 지연: ${timeoutMs}ms 초과`)), timeoutMs);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }).catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function GET(request: Request) {
  const started = Date.now();
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit') || '60');
  const watchlist = (searchParams.get('watchlist') || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const force = searchParams.get('force') === '1';
  const mode = searchParams.get('mode') === 'mystocks' ? 'mystocks' : 'live';
  const cacheKey = makeCacheKey(watchlist, limit, mode);

  const cached = globalThis.__marketSignalCache;
  if (!force && cached?.key === cacheKey && cached.expiresAt > Date.now()) {
    return NextResponse.json(
      { ...cached.payload, cacheHit: true, latencyMs: Date.now() - started },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }

  const meaningfulWatchTerms = Array.from(new Set(
    watchlist
      .map((item) => item.trim())
      .filter((item) => item.length >= 2 && !/^\d{6}$/.test(item))
      .sort((a, b) => {
        const aHangul = /[가-힣]/.test(a) ? 0 : 1;
        const bHangul = /[가-힣]/.test(b) ? 0 : 1;
        return aHangul - bHangul || a.length - b.length;
      })
  ));
  const watchQueries = meaningfulWatchTerms.slice(0, 4).map((item) => `when:1d ${item} 주식 경제 뉴스`);
  const stockFocusedQueries = buildStockFocusedQueries(meaningfulWatchTerms);
  const rssQueries = mode === 'mystocks'
    ? stockFocusedQueries
    : [...BASE_QUERIES.slice(0, 2), ...watchQueries].slice(0, 6).map((query) => ({ query, terms: meaningfulWatchTerms.slice(0, 4) }));
  const errors: string[] = [];

  if (mode === 'mystocks' && rssQueries.length === 0 && watchlist.length === 0) {
    return NextResponse.json({
      news: [],
      generatedAt: new Date().toISOString(),
      sourceMode: 'live',
      provider: 'v5.7-my-stock-source-search',
      error: '관심 종목이 없어 내 주식 뉴스를 검색하지 않았습니다.',
      latencyMs: Date.now() - started
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  }

  try {
    const results = await withOverallTimeout(Promise.allSettled([
      ...rssQueries.map((item) => fetchGoogleNewsRss(item.query, item.terms)),
      fetchGdeltNews(watchlist, mode === 'mystocks' ? Math.max(limit, 80) : limit)
    ]), mode === 'mystocks' ? 5200 : 2500);

    const rawArticles: RawArticle[] = [];
    results.forEach((result) => {
      if (result.status === 'fulfilled') rawArticles.push(...result.value);
      else errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    });

    const stockTermsForMatching = mode === 'mystocks' ? meaningfulWatchTerms : [];
    const unique = new Map<string, MarketNews>();
    rawArticles
      .filter((article) => mode !== 'mystocks' || articleMatchesWatchTerms(article, stockTermsForMatching))
      .forEach((article) => {
      const news = toMarketNews(article, watchlist);
      if (!news) return;
      const key = normalizeTitle(news.title).toLowerCase() || news.originalUrl;
      const prev = unique.get(key);
      if (!prev || news.finalScore > prev.finalScore) unique.set(key, news);
    });

    const news = sortNews(Array.from(unique.values())).slice(0, limit);
    if (news.length === 0 && mode !== 'mystocks') throw new Error(errors[0] || '실시간 뉴스 결과가 비어 있습니다.');

    const payload: CachePayload = {
      news,
      generatedAt: new Date().toISOString(),
      sourceMode: 'live',
      provider: mode === 'mystocks' ? 'v5.7-my-stock-source-search' : 'v5.7-live-news',
      warnings: errors.slice(0, 3),
      cacheHit: false
    };
    globalThis.__marketSignalCache = { key: cacheKey, expiresAt: Date.now() + CACHE_TTL_MS, payload };

    return NextResponse.json(
      { ...payload, latencyMs: Date.now() - started },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    if (cached?.key === cacheKey && cached.expiresAt + STALE_TTL_MS > Date.now()) {
      return NextResponse.json(
        { ...cached.payload, cacheHit: true, stale: true, error: error instanceof Error ? error.message : '뉴스 API 오류', latencyMs: Date.now() - started },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }

    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json(
      { news: getFallbackNews(watchlist), generatedAt: new Date().toISOString(), sourceMode: 'fallback', provider: 'empty-fallback', error: message, warnings: errors.slice(0, 3), latencyMs: Date.now() - started },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }
}
