'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Bell, BriefcaseBusiness, ChevronDown, Flame, Home as HomeIcon, Loader2, Pin, Plus, Radar, RefreshCw, Search, Settings2, Sparkles, Trash2, Wifi, X } from 'lucide-react';
import NewsCard from '@/components/NewsCard';
import { sortNews } from '@/lib/scoring';
import { expandStockKeywords, findStockSuggestions, getStockSearchTokens, matchesStockQuery, type StockCandidate } from '@/lib/stockUniverse';
import type { MarketNews, NewsApiResponse } from '@/types/news';

const CACHE_KEY = 'market-signal:last-news:v5.7';
const WATCHLIST_KEY = 'market-signal:watchlist:v4.8';
const THRESHOLD_KEY = 'market-signal:threshold:v4.8';
const PINNED_KEY = 'market-signal:pinned-news:v4.8';
const STOCKS_CACHE_KEY = 'market-signal:stock-master:v5.7';
const defaultThemes: string[] = [];
const defaultStocks: string[] = [];
const PAGE_SIZE = 6;
const CLIENT_TIMEOUT_MS = 4800;
const INTRO_MIN_MS = 850;
const INTRO_MAX_MS = 2200;
const loadingMessages = ['시장 뉴스를 연결하는 중', '최신 기사를 불러오는 중', '공식뉴스와 의견글을 분류하는 중', '중요도 점수를 정렬하는 중'];

type FeedMode = 'all' | 'mystocks' | 'korea' | 'us' | 'global' | 'trusted' | 'hot' | 'opinion' | 'settings';
type WatchState = { themes: string[]; stocks: string[] };

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function safeArray(value: unknown): MarketNews[] {
  return Array.isArray(value) ? value as MarketNews[] : [];
}

function normalizeWatchState(value: unknown): WatchState {
  if (Array.isArray(value)) {
    return { themes: uniqueValues(value as string[]), stocks: [] };
  }
  if (value && typeof value === 'object') {
    const state = value as Partial<WatchState>;
    return {
      themes: uniqueValues(Array.isArray(state.themes) ? state.themes : defaultThemes),
      stocks: uniqueValues(Array.isArray(state.stocks) ? state.stocks : defaultStocks)
    };
  }
  return { themes: defaultThemes, stocks: defaultStocks };
}

function SkeletonFeed() {
  return (
    <div className="skeleton-list" aria-label="뉴스 목록 준비 중">
      {Array.from({ length: 3 }).map((_, index) => (
        <div className="skeleton-card" key={index}>
          <div className="skeleton-line short" />
          <div className="skeleton-line title" />
          <div className="skeleton-line" />
          <div className="skeleton-line mid" />
        </div>
      ))}
    </div>
  );
}

function fallbackResponse(message: string): NewsApiResponse {
  return {
    news: [],
    generatedAt: new Date().toISOString(),
    sourceMode: 'fallback',
    error: message
  };
}

export default function Home() {
  const [threshold, setThreshold] = useState(82);
  const [watchThemes, setWatchThemes] = useState(defaultThemes);
  const [watchStocks, setWatchStocks] = useState(defaultStocks);
  const [themeKeyword, setThemeKeyword] = useState('');
  const [themeSuggestOpen, setThemeSuggestOpen] = useState(false);
  const [stockKeyword, setStockKeyword] = useState('');
  const [stockSuggestOpen, setStockSuggestOpen] = useState(false);
  const [stockCatalog, setStockCatalog] = useState<StockCandidate[]>([]);
  const [remoteStockSuggestions, setRemoteStockSuggestions] = useState<StockCandidate[]>([]);
  const [stockSuggestLoading, setStockSuggestLoading] = useState(false);
  const [stockSourceLabel, setStockSourceLabel] = useState('실시간 종목 마스터 연결 중');
  const [news, setNews] = useState<MarketNews[]>([]);
  const [feedMode, setFeedMode] = useState<FeedMode>('all');
  const [isNearBottom, setIsNearBottom] = useState(false);
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  const [compactMode, setCompactMode] = useState(false);
  const [pinnedNewsIds, setPinnedNewsIds] = useState<string[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sourceMode, setSourceMode] = useState<'live' | 'fallback'>('fallback');
  const [generatedAt, setGeneratedAt] = useState<string>('');
  const [lastUpdatedLabel, setLastUpdatedLabel] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [newCount, setNewCount] = useState(0);
  const [newIds, setNewIds] = useState<string[]>([]);
    const [debugText, setDebugText] = useState('기본 뉴스 표시 후 최신 뉴스 확인 중');
  const [introVisible, setIntroVisible] = useState(true);
  const [loadingStep, setLoadingStep] = useState(0);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const previousIdsRef = useRef<Set<string>>(new Set());
  const introStartedAtRef = useRef(0);
  const inFlightControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);
  const lastContentModeRef = useRef<Exclude<FeedMode, 'settings'>>('all');
  const countryMenuRef = useRef<HTMLDivElement | null>(null);
  const themeSuggestRef = useRef<HTMLDivElement | null>(null);
  const stockSuggestRef = useRef<HTMLDivElement | null>(null);

  const expandedStockKeywords = useMemo(() => expandStockKeywords(watchStocks, stockCatalog), [watchStocks, stockCatalog]);
  const watchlist = useMemo(() => uniqueValues([...watchThemes, ...expandedStockKeywords]), [watchThemes, expandedStockKeywords]);
  const watchSet = useMemo(() => new Set(uniqueValues([...watchThemes, ...watchStocks, ...expandedStockKeywords])), [watchThemes, watchStocks, expandedStockKeywords]);
  const stockFocusedRequestKey = useMemo(() => expandedStockKeywords.join('|'), [expandedStockKeywords]);
  const stockSuggestions = useMemo(() => {
    const keyword = stockKeyword.trim();
    if (!keyword) return [];

    const source = remoteStockSuggestions.length > 0
      ? remoteStockSuggestions
      : findStockSuggestions(keyword, 10, stockCatalog);

    const scoreNewsMentions = (stock: StockCandidate) => {
      const tokens = getStockSearchTokens(stock.name, stockCatalog)
        .concat(stock.aliases || [], stock.code)
        .map((value) => value.trim())
        .filter((value) => value.length >= 2);

      if (tokens.length === 0 || news.length === 0) return 0;

      const normalizedTokens = Array.from(new Set(tokens.map((value) => value.toLowerCase())));
      let score = 0;

      for (const item of news) {
        const title = (item.title || '').toLowerCase();
        const summary = (item.summary || '').toLowerCase();
        const metadata = [
          ...(item.relatedStocks || []),
          ...(item.tags || [])
        ].join(' ').toLowerCase();

        for (const token of normalizedTokens) {
          if (title.includes(token)) score += 12;
          if (summary.includes(token)) score += 5;
          if (metadata.includes(token)) score += 4;
        }
      }

      return score;
    };

    const marketRank = (market: StockCandidate['market']) => {
      if (market === 'KOSPI') return 3;
      if (market === 'KOSDAQ') return 2;
      if (market === 'NASDAQ' || market === 'NYSE') return 1;
      return 0;
    };

    return source
      .filter((stock) => matchesStockQuery(keyword, stock))
      .map((stock, index) => ({
        stock,
        index,
        popularity: scoreNewsMentions(stock),
        marketRank: marketRank(stock.market)
      }))
      .sort((a, b) =>
        b.popularity - a.popularity ||
        b.marketRank - a.marketRank ||
        a.index - b.index
      )
      .slice(0, 8)
      .map((item) => item.stock);
  }, [stockKeyword, stockCatalog, remoteStockSuggestions, news]);
  const dynamicThemeSuggestions = useMemo(() => {
    const keyword = themeKeyword.trim().toLowerCase();
    const known = new Set(watchThemes.map((theme) => theme.toLowerCase()));
    const score = new Map<string, number>();

    const add = (raw: string, weight = 1) => {
      const value = raw.replace(/^#/, '').trim();
      if (!value || value.length < 2 || value.length > 18) return;
      if (/^[0-9]+$/.test(value)) return;
      if (known.has(value.toLowerCase())) return;
      score.set(value, (score.get(value) || 0) + weight);
    };

    for (const item of news) {
      item.tags?.forEach((tag) => add(tag, 9));
      item.relatedStocks?.forEach((stock) => {
        if (!watchStocks.includes(stock)) add(stock, 2);
      });
      const text = `${item.title || ''} ${item.summary || ''}`;
      const tokens = text.match(/[가-힣A-Za-z0-9+]{2,18}/g) || [];
      for (const token of tokens) {
        if (/뉴스|기사|관련|시장|주식|투자|오늘|전망|종목|경제|한국|미국|기자|제공|사진/.test(token)) continue;
        if (/AI|HBM|반도체|전력|원전|방산|조선|환율|금리|데이터센터|로봇|바이오|자동차|전기차|배터리|2차전지|CPI|FOMC/i.test(token)) add(token, 3);
      }
    }

    return Array.from(score.entries())
      .filter(([theme]) => !keyword || theme.toLowerCase().includes(keyword))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
      .slice(0, 8)
      .map(([theme]) => theme);
  }, [news, themeKeyword, watchThemes, watchStocks]);
  const thresholdDisplay = Math.round(threshold);
  const thresholdPercent = Math.max(0, Math.min(100, ((threshold - 50) / 45) * 100));

  const persistSettings = useCallback((next: WatchState = { themes: watchThemes, stocks: watchStocks }, nextThreshold = threshold) => {
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
      localStorage.setItem(THRESHOLD_KEY, String(nextThreshold));
    } catch {
      // 브라우저 저장소가 막힌 환경에서도 화면 표시는 계속 진행합니다.
    }
  }, [threshold, watchStocks, watchThemes]);

  const setWatchState = useCallback((next: WatchState) => {
    const normalized = normalizeWatchState(next);
    setWatchThemes(normalized.themes);
    setWatchStocks(normalized.stocks);
    persistSettings(normalized, threshold);
  }, [persistSettings, threshold]);

  const applyResponse = useCallback((data: NewsApiResponse, shouldResetVisible = true) => {
    const sorted = sortNews(safeArray(data.news));
    const beforeIds = previousIdsRef.current;

    if (beforeIds.size > 0) {
      const incomingNewIds = sorted.filter((item) => !beforeIds.has(item.id)).map((item) => item.id);
      setNewCount(incomingNewIds.length);
      setNewIds(incomingNewIds);
    }
    previousIdsRef.current = new Set(sorted.map((item) => item.id));

    setNews(sorted);
    setSourceMode(data.sourceMode || 'fallback');
    setGeneratedAt(data.generatedAt || new Date().toISOString());
    setError(data.error || '');
    setLatencyMs(typeof data.latencyMs === 'number' ? data.latencyMs : null);
    setDebugText(`${data.cacheHit ? 'cache' : data.sourceMode || 'unknown'} · ${sorted.length}건 수신 · ${new Date().toLocaleTimeString('ko-KR')}`);
    if (!data.cacheHit) window.setTimeout(() => setNewIds([]), 5200);
    if (shouldResetVisible) setVisibleCount(PAGE_SIZE);

    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, news: sorted }));
    } catch {
      // 캐시 저장 실패는 치명적이지 않습니다.
    }
  }, []);

  const loadNews = useCallback(async (silent = false, stockFocused = false) => {
    inFlightControllerRef.current?.abort();

    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setIntroVisible(true);
      introStartedAtRef.current = Date.now();
    }
    setError('');

    const controller = new AbortController();
    inFlightControllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

    try {
      const focusedWatchlist = uniqueValues(stockFocused ? expandedStockKeywords : watchlist);
      const params = new URLSearchParams({ limit: stockFocused ? '90' : '70', watchlist: focusedWatchlist.join(',') });
      if (stockFocused) params.set('mode', 'mystocks');
      const requestUrl = `/api/news?${params.toString()}`;
      setDebugText(stockFocused ? '내 관심 종목 관련 뉴스 재검색 중' : '최신 뉴스 요청 중');

      const response = await fetch(requestUrl, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`뉴스 API HTTP 오류: ${response.status}`);

      const data = await response.json() as NewsApiResponse;
      if (inFlightControllerRef.current !== controller) return;
      const receivedNews = safeArray(data.news);
      if (receivedNews.length === 0 && !stockFocused) throw new Error('API 응답은 왔지만 news 배열이 비어 있습니다.');

      applyResponse(data);
    } catch (err) {
      if (inFlightControllerRef.current !== controller && err instanceof Error && err.name === 'AbortError') return;

      const message = err instanceof Error && err.name === 'AbortError'
        ? '뉴스 API 응답 시간이 길어 대체 데이터를 표시했습니다.'
        : err instanceof Error ? err.message : '뉴스를 불러오지 못했습니다.';
      setError(message);
      setDebugText(`오류: ${message}`);

      if (previousIdsRef.current.size === 0) {
        applyResponse(fallbackResponse(message));
      }
    } finally {
      window.clearTimeout(timeout);
      if (inFlightControllerRef.current === controller) {
        inFlightControllerRef.current = null;
      }
      if (!mountedRef.current) return;
      setLoading(false);
      setRefreshing(false);
      const elapsed = Date.now() - introStartedAtRef.current;
      window.setTimeout(() => {
        if (mountedRef.current) setIntroVisible(false);
      }, Math.max(0, INTRO_MIN_MS - elapsed));
    }
  }, [applyResponse, expandedStockKeywords, watchlist]);

  useEffect(() => {
    const stepTimer = window.setInterval(() => {
      setLoadingStep((step) => (step + 1) % loadingMessages.length);
    }, 560);
    const hardLimit = window.setTimeout(() => setIntroVisible(false), INTRO_MAX_MS);
    return () => {
      window.clearInterval(stepTimer);
      window.clearTimeout(hardLimit);
    };
  }, []);

  useEffect(() => {
    if (news.length > 0) {
      const elapsed = Date.now() - introStartedAtRef.current;
      const wait = Math.max(0, INTRO_MIN_MS - elapsed);
      const timer = window.setTimeout(() => setIntroVisible(false), wait);
      return () => window.clearTimeout(timer);
    }
  }, [news.length]);

  useEffect(() => {
    if (!generatedAt) {
      setLastUpdatedLabel('');
      return;
    }

    try {
      setLastUpdatedLabel(new Date(generatedAt).toLocaleString('ko-KR'));
    } catch {
      setLastUpdatedLabel('');
    }
  }, [generatedAt]);

  useEffect(() => {
    try {
      const cachedWatchlist = localStorage.getItem(WATCHLIST_KEY);
      const oldCachedWatchlist = localStorage.getItem('market-signal:watchlist:v1.6') || localStorage.getItem('market-signal:watchlist:v1.5');
      const cachedThreshold = localStorage.getItem(THRESHOLD_KEY) || localStorage.getItem('market-signal:threshold:v1.6') || localStorage.getItem('market-signal:threshold:v1.5');
      const cachedNews = localStorage.getItem(CACHE_KEY);
      const cachedPinned = localStorage.getItem(PINNED_KEY);

      const watchPayload = cachedWatchlist || oldCachedWatchlist;
      if (watchPayload) {
        const parsedWatchlist = JSON.parse(watchPayload);
        const normalized = normalizeWatchState(parsedWatchlist);
        setWatchThemes(normalized.themes);
        setWatchStocks(normalized.stocks);
      }
      if (cachedThreshold && !Number.isNaN(Number(cachedThreshold))) setThreshold(Number(cachedThreshold));
      if (cachedNews) {
        const parsed = JSON.parse(cachedNews) as NewsApiResponse;
        applyResponse(parsed, false);
        setLoading(false);
      }
      if (cachedPinned) {
        const parsedPinned = JSON.parse(cachedPinned);
        if (Array.isArray(parsedPinned)) setPinnedNewsIds(parsedPinned.filter((id) => typeof id === 'string'));
      }
    } catch {
      localStorage.removeItem(CACHE_KEY);
      localStorage.removeItem(WATCHLIST_KEY);
      localStorage.removeItem(THRESHOLD_KEY);
      localStorage.removeItem(PINNED_KEY);
    }
  }, [applyResponse]);

  useEffect(() => {
    let cancelled = false;

    async function loadStockMaster() {
      try {
        const cached = localStorage.getItem(STOCKS_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as { stocks?: StockCandidate[]; generatedAt?: string; sourceMode?: string };
          const generated = parsed.generatedAt ? new Date(parsed.generatedAt).getTime() : 0;
          if (Array.isArray(parsed.stocks) && parsed.stocks.length > 0 && Date.now() - generated < 1000 * 60 * 60 * 24) {
            setStockCatalog(parsed.stocks);
            setStockSourceLabel(parsed.sourceMode === 'kis-master' ? `실시간 종목 ${parsed.stocks.length.toLocaleString('ko-KR')}개` : '종목 마스터 연결 불가');
            return;
          }
        }
      } catch {
        localStorage.removeItem(STOCKS_CACHE_KEY);
      }

      try {
        const response = await fetch('/api/stocks', { cache: 'no-store' });
        if (!response.ok) throw new Error(`종목 API HTTP 오류: ${response.status}`);
        const data = await response.json() as { stocks?: StockCandidate[]; sourceMode?: string; generatedAt?: string; error?: string };
        if (cancelled) return;
        if (Array.isArray(data.stocks) && data.stocks.length > 0) {
          setStockCatalog(data.stocks);
          setStockSourceLabel(data.sourceMode === 'kis-master' ? `실시간 종목 ${data.stocks.length.toLocaleString('ko-KR')}개` : '종목 마스터 연결 불가');
          localStorage.setItem(STOCKS_CACHE_KEY, JSON.stringify({ ...data, generatedAt: data.generatedAt || new Date().toISOString() }));
        }
      } catch {
        if (!cancelled) {
          setStockCatalog([]);
          setStockSourceLabel('종목 마스터 연결 불가');
        }
      }
    }

    loadStockMaster();
    return () => { cancelled = true; };
  }, []);


  useEffect(() => {
    const keyword = stockKeyword.trim();
    if (!keyword) {
      setRemoteStockSuggestions([]);
      setStockSuggestLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setStockSuggestLoading(true);
        const response = await fetch(`/api/stocks?q=${encodeURIComponent(keyword)}&limit=12`, {
          cache: 'no-store',
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`종목 자동완성 HTTP 오류: ${response.status}`);
        const data = await response.json() as { stocks?: StockCandidate[] };
        if (!controller.signal.aborted) {
          setRemoteStockSuggestions(Array.isArray(data.stocks) ? data.stocks : []);
        }
      } catch {
        if (!controller.signal.aborted) setRemoteStockSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setStockSuggestLoading(false);
      }
    }, 120);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [stockKeyword]);

  useEffect(() => {
    mountedRef.current = true;
    const isStockFeed = feedMode === 'mystocks';
    loadNews(true, isStockFeed);

    const timer = window.setInterval(() => loadNews(true, feedMode === 'mystocks'), 1000 * 60 * 2);
    const onFocus = () => loadNews(true, feedMode === 'mystocks');
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') loadNews(true, feedMode === 'mystocks');
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);

    return () => {
      mountedRef.current = false;
      inFlightControllerRef.current?.abort();
      inFlightControllerRef.current = null;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [feedMode, loadNews]);


  useEffect(() => {
    const updateBottomState = () => {
      const doc = document.documentElement;
      const distanceFromBottom = doc.scrollHeight - (window.scrollY + window.innerHeight);
      setIsNearBottom(distanceFromBottom < 180);
    };
    updateBottomState();
    window.addEventListener('scroll', updateBottomState, { passive: true });
    window.addEventListener('resize', updateBottomState);
    return () => {
      window.removeEventListener('scroll', updateBottomState);
      window.removeEventListener('resize', updateBottomState);
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('.country-dropdown')) setCountryMenuOpen(false);
      if (!target?.closest('.stock-autocomplete')) setStockSuggestOpen(false);
      if (!target?.closest('.theme-autocomplete')) setThemeSuggestOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const sortedNews = useMemo(() => sortNews(news), [news]);
  const isMyStockNews = useCallback((item: MarketNews) => {
    if (watchStocks.length === 0) return false;
    const haystack = [
      item.title,
      item.summary,
      item.source,
      ...(item.relatedStocks || []),
      ...(item.tags || [])
    ].join(' ').toLowerCase();

    return expandedStockKeywords.some((stock) => {
      const normalized = stock.trim().toLowerCase();
      return normalized.length > 0 && haystack.includes(normalized);
    });
  }, [expandedStockKeywords, watchStocks.length]);

  const filteredNews = useMemo(() => {
    if (feedMode === 'mystocks') return sortedNews;
    if (feedMode === 'korea') return sortedNews.filter((item) => item.marketRegion === 'korea');
    if (feedMode === 'us') return sortedNews.filter((item) => item.marketRegion === 'us');
    if (feedMode === 'global') return sortedNews.filter((item) => item.marketRegion === 'global' || item.marketRegion === 'unknown');
    if (feedMode === 'trusted') return sortedNews.filter((item) => item.contentType === 'official_news' || item.contentType === 'market_report' || item.contentType === 'press_release');
    if (feedMode === 'hot') return sortedNews.filter((item) => (item.finalScore ?? item.importanceScore) >= threshold);
    if (feedMode === 'opinion') return sortedNews.filter((item) => item.contentType === 'blog_opinion' || item.contentType === 'community_post');
    return sortedNews;
  }, [feedMode, isMyStockNews, sortedNews, threshold]);
  const visibleNews = filteredNews.slice(0, visibleCount);
  const alertNews = sortedNews.filter((item) => (item.finalScore ?? item.importanceScore) >= threshold);
  const myStocksCount = feedMode === 'mystocks' ? sortedNews.length : sortedNews.filter(isMyStockNews).length;
  const pinnedHotNews = pinnedNewsIds
    .map((id) => sortedNews.find((item) => item.id === id))
    .filter((item): item is MarketNews => Boolean(item));
  const koreaCount = sortedNews.filter((item) => item.marketRegion === 'korea').length;
  const usCount = sortedNews.filter((item) => item.marketRegion === 'us').length;
  const globalCount = sortedNews.filter((item) => item.marketRegion === 'global' || item.marketRegion === 'unknown').length;
  const trustedCount = sortedNews.filter((item) => item.contentType === 'official_news' || item.contentType === 'market_report' || item.contentType === 'press_release').length;
  const opinionCount = sortedNews.filter((item) => item.contentType === 'blog_opinion' || item.contentType === 'community_post').length;
  const topScore = sortedNews[0]?.finalScore || sortedNews[0]?.importanceScore || 0;
  const hasMore = visibleCount < filteredNews.length;
  const countryLabel = feedMode === 'korea' ? '🇰🇷 한국' : feedMode === 'us' ? '🇺🇸 미국' : feedMode === 'global' ? '🌍 글로벌' : '국가';

  function addTheme(valueFromSuggestion?: string) {
    const value = (valueFromSuggestion || themeKeyword).trim();
    if (!value || watchThemes.includes(value)) {
      setThemeKeyword('');
      setThemeSuggestOpen(false);
      return;
    }
    const next = { themes: [...watchThemes, value], stocks: watchStocks };
    setWatchState(next);
    setThemeKeyword('');
    setThemeSuggestOpen(false);
  }

  function addStock() {
    const value = stockKeyword.trim();
    if (!value) return;
    const exact = findStockSuggestions(value, 1, stockCatalog)[0];
    const selected = exact ? exact.name : value;
    if (watchStocks.includes(selected)) {
      setStockKeyword('');
      setStockSuggestOpen(false);
      return;
    }
    const next = { themes: watchThemes, stocks: [...watchStocks, selected] };
    setWatchState(next);
    if (feedMode === 'mystocks') setDebugText('관심 종목을 추가했습니다. 관련 뉴스를 재검색합니다.');
    setStockKeyword('');
    setStockSuggestOpen(false);
  }

  function removeTheme(item: string) {
    setWatchState({ themes: watchThemes.filter((value) => value !== item), stocks: watchStocks });
  }

  function removeStock(item: string) {
    setWatchState({ themes: watchThemes, stocks: watchStocks.filter((value) => value !== item) });
  }

  function selectStockSuggestion(stockName: string) {
    if (!watchStocks.includes(stockName)) {
      setWatchState({ themes: watchThemes, stocks: [...watchStocks, stockName] });
      if (feedMode !== 'mystocks') changeFeed('mystocks');
      setDebugText('관심 종목을 추가했습니다. 관련 뉴스를 재검색합니다.');
    }
    setStockKeyword('');
    setStockSuggestOpen(false);
  }

  function resetWatchlist() {
    setWatchState({ themes: defaultThemes, stocks: defaultStocks });
  }

  function clearWatchlist() {
    setWatchState({ themes: [], stocks: [] });
  }

  function clearNewsCache() {
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {
      // 저장소 접근이 제한된 환경에서는 무시합니다.
    }
    setDebugText('뉴스 캐시를 삭제했습니다.');
  }

  function toggleTheme(tag: string) {
    if (watchThemes.includes(tag)) {
      removeTheme(tag);
    } else {
      setWatchState({ themes: [...watchThemes, tag], stocks: watchStocks });
    }
  }

  function toggleStock(stock: string) {
    const canonical = findStockSuggestions(stock, 1, stockCatalog)[0]?.name || stock;
    if (watchStocks.includes(canonical)) {
      removeStock(canonical);
    } else {
      setWatchState({ themes: watchThemes, stocks: [...watchStocks, canonical] });
    }
  }

  function changeThreshold(value: number) {
    const normalized = Math.max(50, Math.min(95, Number(value.toFixed(1))));
    setThreshold(normalized);
    persistSettings({ themes: watchThemes, stocks: watchStocks }, normalized);
  }

  function changeFeed(mode: FeedMode, options: { preserveScroll?: boolean } = {}) {
    if (mode !== 'settings') {
      lastContentModeRef.current = mode;
    }
    setFeedMode(mode);
    setCountryMenuOpen(false);
    setVisibleCount(PAGE_SIZE);
    if (!options.preserveScroll) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function toggleSettings() {
    if (feedMode === 'settings') {
      changeFeed(lastContentModeRef.current);
      return;
    }
    lastContentModeRef.current = feedMode as Exclude<FeedMode, 'settings'>;
    changeFeed('settings');
  }

  function toggleMyStocksFeed() {
    if (feedMode === 'mystocks') {
      changeFeed('all');
      return;
    }
    changeFeed('mystocks');
    setDebugText('내 관심 종목 관련 뉴스를 재검색합니다.');
    window.setTimeout(() => loadNews(true, true), 0);
  }

  function togglePinnedNews(item: MarketNews) {
    setPinnedNewsIds((prev) => {
      const exists = prev.includes(item.id);
      const next = exists ? prev.filter((id) => id !== item.id) : [item.id, ...prev].slice(0, 8);
      try {
        localStorage.setItem(PINNED_KEY, JSON.stringify(next));
      } catch {
        // 저장소 제한 환경에서는 화면 상태만 유지합니다.
      }
      return next;
    });
  }

  function removePinnedNews(id: string) {
    setPinnedNewsIds((prev) => {
      const next = prev.filter((itemId) => itemId !== id);
      try {
        localStorage.setItem(PINNED_KEY, JSON.stringify(next));
      } catch {
        // 저장소 제한 환경에서는 화면 상태만 유지합니다.
      }
      return next;
    });
  }

  function QuickRegionMenu({ placement = 'side' }: { placement?: 'side' | 'bottom' }) {
    const compactLabel = compactMode ? '자세히' : '간략히';
    return (
      <nav className={`quick-region-menu ${placement} redesigned`} aria-label={placement === 'bottom' ? '모바일 빠른 뉴스 필터' : '빠른 뉴스 필터'}>
        <button className={feedMode === 'all' ? 'active' : ''} onClick={() => changeFeed('all')} aria-label="전체 뉴스">
          <HomeIcon size={17} /><span>전체</span>
        </button>

        <div className="country-dropdown" ref={placement === 'side' ? countryMenuRef : undefined}>
          <button
            type="button"
            className={(feedMode === 'korea' || feedMode === 'us' || feedMode === 'global' || countryMenuOpen) ? 'active country-trigger' : 'country-trigger'}
            onClick={() => setCountryMenuOpen((open) => !open)}
            aria-expanded={countryMenuOpen}
            aria-label="국가별 뉴스 선택"
          >
            <span>{countryLabel}</span><ChevronDown size={15} />
          </button>
          {countryMenuOpen && (
            <div className="country-popover" role="menu">
              <button type="button" onClick={() => changeFeed('korea')} className={feedMode === 'korea' ? 'selected' : ''}>🇰🇷 한국경제</button>
              <button type="button" onClick={() => changeFeed('us')} className={feedMode === 'us' ? 'selected' : ''}>🇺🇸 미국경제</button>
              <button type="button" onClick={() => changeFeed('global')} className={feedMode === 'global' ? 'selected' : ''}>🌍 글로벌</button>
            </div>
          )}
        </div>

        <button className={feedMode === 'mystocks' ? 'active my-stocks-active' : 'my-stocks-button'} onClick={toggleMyStocksFeed} aria-label="내 주식 뉴스">
          <BriefcaseBusiness size={17} /><span>내주식</span>
        </button>
        <button className={compactMode ? 'active compact-toggle' : 'compact-toggle'} onClick={() => setCompactMode((value) => !value)} aria-label="간략히 또는 자세히 보기">
          <Sparkles size={16} /><span>{compactLabel}</span>
        </button>
        <button className={feedMode === 'settings' ? 'active' : ''} onClick={toggleSettings} aria-label="설정">
          <Settings2 size={17} /><span>{feedMode === 'settings' ? '닫기' : '설정'}</span>
        </button>
      </nav>
    );
  }

  function ThresholdSlider({ label, helper, className = '' }: { label: string; helper: string; className?: string }) {
    const rangeShellRef = useRef<HTMLDivElement | null>(null);

    const handleInput = (event: FormEvent<HTMLInputElement> | ChangeEvent<HTMLInputElement>) => {
      changeThreshold(Number(event.currentTarget.value));
    };

    const valueFromClientX = useCallback((clientX: number, rect: DOMRect) => {
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return 50 + ratio * 45;
    }, []);

    const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
      const shell = rangeShellRef.current;
      if (!shell) return;

      event.preventDefault();
      const rect = shell.getBoundingClientRect();
      changeThreshold(valueFromClientX(event.clientX, rect));

      const handlePointerMove = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault();
        changeThreshold(valueFromClientX(moveEvent.clientX, rect));
      };

      const stopDragging = () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', stopDragging);
        window.removeEventListener('pointercancel', stopDragging);
      };

      window.addEventListener('pointermove', handlePointerMove, { passive: false });
      window.addEventListener('pointerup', stopDragging, { once: true });
      window.addEventListener('pointercancel', stopDragging, { once: true });
    };

    return (
      <div className={`threshold-control ${className}`} style={{ '--range-progress': `${thresholdPercent}%` } as CSSProperties}>
        <label className="range-label">
          <span>{label}</span>
          <strong>{thresholdDisplay}</strong>
        </label>
        <div
          ref={rangeShellRef}
          className="range-shell draggable-range-shell"
          onPointerDown={handlePointerDown}
        >
          <input
            className="smooth-range"
            type="range"
            min="50"
            max="95"
            step="0.1"
            value={threshold}
            onInput={handleInput}
            onChange={handleInput}
            aria-label={label}
            tabIndex={-1}
          />
        </div>
        <div className="range-scale" aria-hidden="true">
          <span>50</span>
          <span>65</span>
          <span>80</span>
          <span>95</span>
        </div>
        <p className="hint">{helper}</p>
      </div>
    );
  }

  function SettingsPanel({ compact = false }: { compact?: boolean }) {
    return (
      <div className={compact ? 'settings-page compact' : 'settings-page'}>
        <div className="settings-hero">
          <span>PERSONAL SIGNAL</span>
          <h2>설정</h2>
          <p>관심 종목·테마, 알림 기준 점수, 캐시 관리를 한 곳에서 조정합니다. 변경 내용은 브라우저 localStorage에 즉시 저장됩니다.</p>
          <button type="button" className="settings-close-btn" onClick={toggleSettings}><X size={16} /> 설정 닫기</button>
        </div>

        <div className="settings-grid">
          <section className="settings-card">
            <div className="settings-title"><Sparkles size={17} /> 관심 테마</div>
            <div className="theme-autocomplete" ref={themeSuggestRef}>
              <div className="keyword-box theme-keyword-box">
                <input
                  value={themeKeyword}
                  onChange={(event) => {
                    setThemeKeyword(event.target.value);
                    setThemeSuggestOpen(true);
                  }}
                  onFocus={() => setThemeSuggestOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addTheme(dynamicThemeSuggestions[0]);
                    }
                    if (event.key === 'Escape') setThemeSuggestOpen(false);
                  }}
                  placeholder="테마 검색 (예: AI, HBM, 원전)"
                  autoComplete="off"
                />
                <button type="button" onClick={() => addTheme(dynamicThemeSuggestions[0])} aria-label="관심 테마 추가"><Plus size={17} /></button>
              </div>
              {themeSuggestOpen && (themeKeyword.trim() || dynamicThemeSuggestions.length > 0) && (
                <div className="stock-suggest-panel theme-suggest-panel" role="listbox" aria-label="관심 테마 자동완성">
                  {dynamicThemeSuggestions.length > 0 ? dynamicThemeSuggestions.map((theme) => (
                    <button key={theme} type="button" className="stock-suggest-item theme-suggest-item" onClick={() => addTheme(theme)}>
                      <span className="stock-suggest-main">
                        <strong>#{theme}</strong>
                        <em>뉴스에서 자주 감지된 테마</em>
                      </span>
                      <span className="stock-suggest-sub">테마</span>
                    </button>
                  )) : (
                    <div className="stock-suggest-empty">
                      일치하는 추천 테마가 없습니다. Enter 또는 + 버튼을 누르면 입력어 그대로 추가됩니다.
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="managed-chip-list">
              {watchThemes.length === 0 && <span className="empty-chip">등록된 관심 테마가 없습니다.</span>}
              {watchThemes.map((item) => (
                <span key={item} className="managed-chip theme-chip">
                  {item}
                  <button type="button" onClick={() => removeTheme(item)} aria-label={`${item} 테마 삭제`}><X size={14} /></button>
                </span>
              ))}
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-title"><Search size={17} /> 관심 종목</div>
            <div className="stock-autocomplete" ref={stockSuggestRef}>
              <div className="keyword-box stock-keyword-box">
                <input
                  value={stockKeyword}
                  onChange={(event) => {
                    setStockKeyword(event.target.value);
                    setStockSuggestOpen(true);
                  }}
                  onFocus={() => setStockSuggestOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      if (stockSuggestions.length > 0) selectStockSuggestion(stockSuggestions[0].name);
                      else addStock();
                    }
                    if (event.key === 'Escape') setStockSuggestOpen(false);
                  }}
                  placeholder="예: LS, 삼성, NVDA"
                  autoComplete="off"
                />
                <button type="button" onClick={addStock} aria-label="관심 종목 추가"><Plus size={17} /></button>
              </div>
              {stockSuggestOpen && stockKeyword.trim() && (
                <div className="stock-suggest-panel" role="listbox" aria-label="관심 종목 자동완성">
                  {stockSuggestLoading ? (
                    <div className="stock-suggest-empty">실제 종목을 검색하는 중입니다...</div>
                  ) : stockSuggestions.length > 0 ? stockSuggestions.map((stock) => (
                    <button key={`${stock.code}-${stock.name}`} type="button" className="stock-suggest-item" onClick={() => selectStockSuggestion(stock.name)}>
                      <span className="stock-suggest-main">
                        <strong>{stock.name}</strong>
                        <em>{stock.code} · {stock.market}</em>
                      </span>
                      <span className="stock-suggest-sub">{stock.sector}</span>
                    </button>
                  )) : (
                    <div className="stock-suggest-empty">
                      일치하는 실제 종목을 찾지 못했습니다. 종목명을 더 입력하거나 Enter/+ 버튼으로 입력어를 관심 키워드로 직접 추가할 수 있습니다.
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="managed-chip-list">
              {watchStocks.length === 0 && <span className="empty-chip">등록된 관심 종목이 없습니다.</span>}
              {watchStocks.map((item) => (
                <span key={item} className="managed-chip stock-chip" title={`매칭 키워드: ${getStockSearchTokens(item, stockCatalog).join(', ')}`}>
                  {item}
                  <button type="button" onClick={() => removeStock(item)} aria-label={`${item} 종목 삭제`}><X size={14} /></button>
                </span>
              ))}
            </div>
          </section>
        </div>

        <section className="settings-card settings-wide-card">
          <div className="settings-title"><Bell size={17} /> 알림 기준</div>
          <ThresholdSlider
            className="settings-range"
            label="중요 뉴스 기준 점수"
            helper="이 점수 이상인 뉴스는 알림대상 탭과 상단 고정 영역에 우선 표시됩니다. 드래그하면 부드럽게 연속 조정됩니다."
          />
        </section>

        <div className="settings-actions">
          <button type="button" className="danger-btn" onClick={resetWatchlist}><Trash2 size={16} /> 관심 설정 기본값으로 초기화</button>
          <button type="button" className="danger-btn secondary" onClick={clearWatchlist}><X size={16} /> 관심 설정 모두 비우기</button>
          <button type="button" className="ghost-btn" onClick={clearNewsCache}><Trash2 size={16} /> 뉴스 캐시 삭제</button>
          <button type="button" className="ghost-btn" onClick={() => loadNews(false)} disabled={loading || refreshing}>
            {refreshing || loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} 현재 관심 기준으로 새로고침
          </button>
        </div>
      </div>
    );
  }

  function MyStockFeedManager() {
    const topSuggestions = stockKeyword.trim() ? stockSuggestions : [];

    return (
      <section className="my-stock-manager" aria-label="내 주식 관심 종목 빠른 관리">
        <div className="my-stock-manager-head">
          <div>
            <span>MY WATCHLIST</span>
            <h3>관심 종목을 바로 추가해 보세요</h3>
            <p>종목명을 정확히 몰라도 됩니다. “LS”, “삼성”, “NVDA”처럼 입력하면 후보를 추천하고, 선택 즉시 내 주식 피드에 반영됩니다. <b>{stockSourceLabel}</b></p>
          </div>
          <button type="button" className="manager-refresh" onClick={() => loadNews(false, true)} disabled={loading || refreshing}>
            {loading || refreshing ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} 새로고침
          </button>
        </div>

        <div className="my-stock-input-row stock-autocomplete">
          <div className="keyword-box stock-keyword-box my-stock-keyword-box">
            <Search size={17} className="input-leading-icon" />
            <input
              value={stockKeyword}
              onChange={(event) => {
                setStockKeyword(event.target.value);
                setStockSuggestOpen(true);
              }}
              onFocus={() => setStockSuggestOpen(true)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (stockSuggestions.length > 0) selectStockSuggestion(stockSuggestions[0].name);
                  else addStock();
                }
                if (event.key === 'Escape') setStockSuggestOpen(false);
              }}
              placeholder="종목 검색 (예: LS, 삼성전자)"
              autoComplete="off"
            />
            {stockKeyword && (
              <button type="button" className="input-clear-btn" onClick={() => { setStockKeyword(''); setStockSuggestOpen(false); }} aria-label="종목 검색어 지우기">
                <X size={15} />
              </button>
            )}
            <button type="button" onClick={addStock} aria-label="관심 종목 추가"><Plus size={17} /></button>
          </div>

          {stockSuggestOpen && stockKeyword.trim() && (
            <div className="stock-suggest-panel my-stock-suggest-panel" role="listbox" aria-label="내 주식 종목 자동완성">
              {stockSuggestLoading ? (
                    <div className="stock-suggest-empty">실제 종목을 검색하는 중입니다...</div>
                  ) : topSuggestions.length > 0 ? topSuggestions.map((stock) => (
                <button key={`mystock-${stock.code}-${stock.name}`} type="button" className="stock-suggest-item" onClick={() => selectStockSuggestion(stock.name)}>
                  <span className="stock-suggest-main">
                    <strong>{stock.name}</strong>
                    <em>{stock.code} · {stock.market}</em>
                  </span>
                  <span className="stock-suggest-sub">{stock.sector}</span>
                </button>
              )) : (
                <div className="stock-suggest-empty">
                  일치하는 실제 종목을 찾지 못했습니다. 종목명을 더 입력하거나 Enter/+ 버튼으로 입력어를 관심 키워드로 직접 추가할 수 있습니다.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="my-stock-chip-row" aria-label="내 관심 종목 목록">
          {watchStocks.length === 0 ? (
            <span className="empty-chip">아직 관심 종목이 없습니다.</span>
          ) : watchStocks.map((item) => (
            <span key={`mystock-chip-${item}`} className="managed-chip stock-chip" title={`매칭 키워드: ${getStockSearchTokens(item, stockCatalog).join(', ')}`}>
              {item}
              <button type="button" onClick={() => removeStock(item)} aria-label={`${item} 종목 삭제`}><X size={14} /></button>
            </span>
          ))}
        </div>

        <div className="my-stock-help-row">
          <span>매칭 뉴스 {myStocksCount}건</span>
          <button type="button" onClick={() => changeFeed('all')}>전체 피드 보기</button>
          <button type="button" onClick={toggleSettings}>설정에서 자세히 관리</button>
        </div>
      </section>
    );
  }


  return (
    <main>
      {introVisible && (
        <div className="app-splash" role="status" aria-live="polite">
          <div className="splash-card">
            <div className="splash-logo"><Radar size={26} /></div>
            <div className="splash-eyebrow">Market Signal</div>
            <h1>오늘의 시장 신호를 정리하고 있습니다.</h1>
            <p>{loadingMessages[loadingStep]}</p>
            <div className="splash-progress"><span /></div>
            <div className="splash-steps">
              <span className={loadingStep >= 0 ? 'active' : ''}>기사 수집</span>
              <span className={loadingStep >= 1 ? 'active' : ''}>출처 판별</span>
              <span className={loadingStep >= 2 ? 'active' : ''}>중요도 분류</span>
            </div>
          </div>
        </div>
      )}
      <div className="orb orb-a" />
      <div className="orb orb-b" />

      <div className="container">
        <header className="header">
          <div className="brand">
            <div className="logo-mark"><Radar size={23} /></div>
            <div>
              <strong>Market Signal</strong>
              <span>Fast Market News Radar</span>
            </div>
          </div>
          <div className="header-actions">
            <button type="button" className="ghost-btn" onClick={() => loadNews(false)} disabled={loading || refreshing}>
              {refreshing || loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} 새로고침
            </button>
            <button type="button" className="ghost-btn settings-top-btn" onClick={toggleSettings}>
              <Settings2 size={16} /> {feedMode === 'settings' ? '설정 닫기' : '설정'}
            </button>
            <button className="primary-btn" onClick={() => alert(`현재 알림 대상 뉴스는 ${alertNews.length}건입니다.`)}>
              <Bell size={16} /> 알림
            </button>
          </div>
        </header>

        <section className="hero-panel">
          <div className="hero-copy">
            <div className="eyebrow"><Wifi size={15} /> 출처 품질을 분류하는 실시간 뉴스 스캐너</div>
            <h1>뉴스와 개인 의견을 구분해, 시장 신호만 빠르게 보여드립니다.</h1>
            <p>
              한국경제와 미국경제를 기사별로 자동 분류하고, 공식 뉴스·시장 리포트·블로그/의견 글을 함께 판별합니다. 신뢰도·최신성·의견성까지 계산해 시장 신호를 빠르게 정리합니다.
            </p>
          </div>
          <div className="hero-stats">
            <div className="stat-card highlight"><span>TOP SCORE</span><strong>{topScore}</strong></div>
            <div className="stat-card"><span>KOREA</span><strong>{koreaCount}</strong></div>
            <div className="stat-card"><span>U.S.</span><strong>{usCount}</strong></div>
          </div>
        </section>

        <section className="status-strip">
          <span className={sourceMode === 'live' ? 'live-dot' : 'fail-dot'} />
          <strong>{sourceMode === 'live' ? '실제 뉴스 연동 중' : '실제 뉴스 호출 실패 · 대체 데이터 표시'}</strong>
          {lastUpdatedLabel && <span suppressHydrationWarning>마지막 갱신 {lastUpdatedLabel}</span>}
          {newCount > 0 && <span className="new-badge">새 뉴스 {newCount}건 감지</span>}
          {error && <span className="error-text">{error}</span>}
          <span className="debug-chip">{debugText}</span>
          {latencyMs !== null && <span className="debug-chip">응답 {latencyMs}ms</span>}
        </section>

        <div className="app-grid">
          <section className={feedMode === 'settings' ? 'feed-panel settings-feed' : 'feed-panel'}>
            <div className="section-head">
              <div>
                <span className="section-kicker">{feedMode === 'settings' ? 'SETTINGS' : feedMode === 'mystocks' ? 'MY STOCK FEED' : 'LIVE FEED'}</span>
                <h2>{feedMode === 'settings' ? '관심 설정' : feedMode === 'mystocks' ? '내 주식 뉴스' : '중요 뉴스 피드'}</h2>
              </div>
              <span className="threshold-chip">종합점수 {thresholdDisplay}점 이상 알림</span>
            </div>

            <div className="feed-tabs">
              <button className={feedMode === 'all' ? 'active' : ''} onClick={() => { setFeedMode('all'); setVisibleCount(PAGE_SIZE); }}>전체 {sortedNews.length}</button>
              <button className={feedMode === 'mystocks' ? 'active' : ''} onClick={toggleMyStocksFeed}>내 주식 {myStocksCount}</button>
              <button className={feedMode === 'korea' ? 'active' : ''} onClick={() => { setFeedMode('korea'); setVisibleCount(PAGE_SIZE); }}>한국경제 {koreaCount}</button>
              <button className={feedMode === 'us' ? 'active' : ''} onClick={() => { setFeedMode('us'); setVisibleCount(PAGE_SIZE); }}>미국경제 {usCount}</button>
              <button className={feedMode === 'global' ? 'active' : ''} onClick={() => { setFeedMode('global'); setVisibleCount(PAGE_SIZE); }}>글로벌/기타 {globalCount}</button>
              <button className={feedMode === 'trusted' ? 'active' : ''} onClick={() => { setFeedMode('trusted'); setVisibleCount(PAGE_SIZE); }}>공식/리포트 {trustedCount}</button>
              <button className={feedMode === 'hot' ? 'active' : ''} onClick={() => { setFeedMode('hot'); setVisibleCount(PAGE_SIZE); }}>알림대상 {alertNews.length}</button>
              <button className={feedMode === 'opinion' ? 'active' : ''} onClick={() => { setFeedMode('opinion'); setVisibleCount(PAGE_SIZE); }}>참고의견 {opinionCount}</button>
              <button className={feedMode === 'settings' ? 'active' : ''} onClick={() => changeFeed('settings')}>설정</button>
            </div>

            {feedMode === 'settings' ? (
              SettingsPanel({ compact: true })
            ) : (
              <>
                {feedMode === 'mystocks' && MyStockFeedManager()}

                {feedMode !== 'opinion' && (
                  <div className="hot-rail" aria-label="사용자 고정 뉴스">
                    <div className="hot-rail-title"><Flame size={16} /> 중요 뉴스 상단 고정 <span>{pinnedHotNews.length}건</span></div>
                    {pinnedHotNews.length === 0 ? (
                      <div className="pin-empty"><Pin size={16} /> 카드의 고정 버튼을 누르면 이곳에 모아볼 수 있습니다.</div>
                    ) : (
                      <div className="hot-rail-grid">
                        {pinnedHotNews.map((item) => (
                          <div className="hot-tile pinned-tile" key={item.id}>
                            <button type="button" className="pin-remove" onClick={() => removePinnedNews(item.id)} aria-label="고정 뉴스 제거"><X size={14} /></button>
                            <a href={item.originalUrl} target="_blank" rel="noreferrer">
                              <span>{item.marketRegionLabel}</span>
                              <strong>{item.title}</strong>
                              <em>종합 {item.finalScore}</em>
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {(loading || refreshing) && <SkeletonFeed />}

                {loading && visibleNews.length === 0 ? (
                  <div className="empty"><Loader2 className="spin" /> 실시간 뉴스를 불러오는 중입니다.</div>
                ) : visibleNews.length === 0 ? (
                  <div className="empty">{feedMode === 'mystocks' ? '관심 종목 기준으로 뉴스 공급원을 별도 검색했지만 아직 표시할 기사가 없습니다. 종목 별칭/뉴스 공급원에 따라 잠시 후 다시 검색해 주세요.' : '표시할 뉴스가 없습니다. 새로고침을 다시 눌러주세요.'}</div>
                ) : (
                  <>
                    <div className="news-list">
                      {visibleNews.map((item) => (
                        <NewsCard
                          key={item.id}
                          news={item}
                          threshold={threshold}
                          isNew={newIds.includes(item.id)}
                          watchSet={watchSet}
                          onToggleTheme={toggleTheme}
                          onToggleStock={toggleStock}
                          compact={compactMode}
                          pinned={pinnedNewsIds.includes(item.id)}
                          onTogglePin={() => togglePinnedNews(item)}
                        />
                      ))}
                    </div>

                    {hasMore && (
                      <button className="load-more" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
                        <Plus size={18} /> 뉴스 더 보기 <span>{Math.min(PAGE_SIZE, filteredNews.length - visibleCount)}개</span>
                        <ChevronDown size={18} />
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </section>

          <aside className={`control-panel ${isNearBottom ? 'bottom-reached' : ''}`}>
            <div className="side-menu-card">
              <div className="panel-title compact-title"><Radar size={16} /> 빠른 메뉴</div>
              <QuickRegionMenu placement="side" />
            </div>

            <div className="panel-card">
              <div className="panel-title"><Settings2 size={17} /> 필터 설정</div>
              <ThresholdSlider
                label="알림 중요도"
                helper="종합점수는 중요도, 신뢰도, 최신성을 더하고 개인 의견성은 감점해서 계산합니다."
              />
            </div>

            <div className="panel-card quick-watch-card">
              <div className="panel-title"><Search size={17} /> 관심 요약</div>
              <div className="watch-summary">
                <strong>테마 {watchThemes.length}</strong>
                <span>{watchThemes.slice(0, 4).join(' · ') || '없음'}</span>
              </div>
              <div className="watch-summary">
                <strong>종목 {watchStocks.length}</strong>
                <span>{watchStocks.slice(0, 4).join(' · ') || '없음'}</span>
              </div>
              <button type="button" className="settings-shortcut" onClick={toggleSettings}><Settings2 size={16} /> 설정 관리</button>
            </div>

            <div className="panel-card note-card">
              <strong>운영 방식</strong>
              <p>DB 저장 없이 API 응답과 브라우저 캐시만 사용합니다. 블로그/개인 의견은 제거하지 않고 참고 피드로 분리해 판단 근거를 보존합니다.</p>
            </div>
          </aside>
        </div>

        <footer className="footer">Market Signal v3.4 · Dark Glass UI · Stable Inputs · My Stock UX · Responsive QA · No DB</footer>
      </div>


      <div className={`bottom-nav-shell ${isNearBottom ? 'show' : ''}`}>
        <QuickRegionMenu placement="bottom" />
      </div>
    </main>
  );
}
