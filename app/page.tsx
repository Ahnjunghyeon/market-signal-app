"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Bell,
  Bookmark,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  ChevronRight,
  Clock3,
  DatabaseZap,
  Home,
  Loader2,
  LogOut,
  Menu,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
import NewsCard from "@/components/NewsCard";
import { mockNews } from "@/lib/mockNews";
import { sortNews } from "@/lib/scoring";
import {
  expandStockKeywords,
  findStockSuggestions,
  getStockSearchTokens,
  type StockCandidate,
} from "@/lib/stockUniverse";
import type { MarketNews, NewsApiResponse } from "@/types/news";

const CACHE_KEY = "news-briefing:v7:news";
const WATCHLIST_KEY = "news-briefing:v7:watchlist";
const THRESHOLD_KEY = "news-briefing:v7:threshold";
const AI_STOCK_THRESHOLD_KEY = "news-briefing:v7:ai-stock-threshold";
const APP_THEME_KEY = "news-briefing:v8:theme";
const QUICK_MENU_KEY = "news-briefing:v8:quick-menu";
const PINNED_KEY = "news-briefing:v7:pinned";
const PAGE_SIZE = 7;
const defaultThemes = ["AI", "반도체", "HBM"];
const defaultStocks: string[] = [];

type FeedMode =
  | "home"
  | "stocks"
  | "aiStocks"
  | "scanner"
  | "news"
  | "search"
  | "alerts"
  | "settings";
type AppTheme = "light" | "musinsa";
type CountryFilter = "all" | "korea" | "us" | "global";
type WatchState = { themes: string[]; stocks: string[] };
type QuoteMap = Record<
  string,
  { priceText: string; changeText: string; changeRate: number | null }
>;

function unique(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

function safeNews(value: unknown): MarketNews[] {
  return Array.isArray(value) ? (value as MarketNews[]) : [];
}

function normalizeWatchState(value: unknown): WatchState {
  if (Array.isArray(value))
    return { themes: unique(value as string[]), stocks: [] };
  if (value && typeof value === "object") {
    const item = value as Partial<WatchState>;
    return {
      themes: unique(Array.isArray(item.themes) ? item.themes : defaultThemes),
      stocks: unique(Array.isArray(item.stocks) ? item.stocks : defaultStocks),
    };
  }
  return { themes: defaultThemes, stocks: defaultStocks };
}

function scoreLabel(score: number) {
  if (score >= 90) return "매우 높음";
  if (score >= 80) return "높음";
  if (score >= 70) return "관찰";
  return "보통";
}

function formatTime(value: string) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "-";
  }
}

function fallbackResponse(
  message = "대체 뉴스를 표시했습니다.",
): NewsApiResponse {
  return {
    news: mockNews,
    generatedAt: new Date().toISOString(),
    sourceMode: "fallback",
    error: message,
  };
}

function useDebouncedValue<T>(value: T, delay = 220) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

export default function HomePage() {
  const [feedMode, setFeedMode] = useState<FeedMode>("home");
  const [country, setCountry] = useState<CountryFilter>("all");
  const [threshold, setThreshold] = useState(82);
  const [aiStockThreshold, setAiStockThreshold] = useState(60);
  const [watchThemes, setWatchThemes] = useState<string[]>(defaultThemes);
  const [watchStocks, setWatchStocks] = useState<string[]>(defaultStocks);
  const [news, setNews] = useState<MarketNews[]>([]);
  const [generatedAt, setGeneratedAt] = useState("");
  const [sourceMode, setSourceMode] = useState<"live" | "fallback">("fallback");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fullRefreshVisible, setFullRefreshVisible] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [compact, setCompact] = useState(false);
  const [pinnedNewsIds, setPinnedNewsIds] = useState<string[]>([]);
  const [stockCatalog, setStockCatalog] = useState<StockCandidate[]>([]);
  const [stockQuotes, setStockQuotes] = useState<QuoteMap>({});
  const [stockQuery, setStockQuery] = useState("");
  const [themeQuery, setThemeQuery] = useState("");
  const [stockSuggestions, setStockSuggestions] = useState<StockCandidate[]>(
    [],
  );
  const debouncedStockQuery = useDebouncedValue(stockQuery, 220);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileDrawerClosing, setMobileDrawerClosing] = useState(false);
  const [selectedNews, setSelectedNews] = useState<MarketNews | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [dismissedAlertIds, setDismissedAlertIds] = useState<string[]>([]);
  const [themeSuggestOpen, setThemeSuggestOpen] = useState(false);
  const [stockSearchFocused, setStockSearchFocused] = useState(false);
  const [themeSearchFocused, setThemeSearchFocused] = useState(false);
  const [aiRefreshStamp, setAiRefreshStamp] = useState(0);
  const [aiDescriptionOpen, setAiDescriptionOpen] = useState(false);
  const stockInputRef = useRef<HTMLInputElement | null>(null);
  const themeInputRef = useRef<HTMLInputElement | null>(null);
  const summaryGridRef = useRef<HTMLElement | null>(null);
  const watchCardRowRef = useRef<HTMLDivElement | null>(null);
  const [mobileHeaderHidden, setMobileHeaderHidden] = useState(false);
  const [appTheme, setAppTheme] = useState<AppTheme>("light");
  const [quickMenuVisible, setQuickMenuVisible] = useState(true);
  const [interestChipsExpanded, setInterestChipsExpanded] = useState(false);
  const [refreshMessage, setRefreshMessage] =
    useState("뉴스를 새로고침하고 있습니다.");
  const [pullDistance, setPullDistance] = useState(0);
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const expandedStocks = useMemo(
    () => expandStockKeywords(watchStocks, stockCatalog),
    [watchStocks, stockCatalog],
  );
  const watchlist = useMemo(
    () => unique([...watchThemes, ...expandedStocks]),
    [watchThemes, expandedStocks],
  );
  const watchlistRef = useRef<string[]>(watchlist);

  useEffect(() => {
    watchlistRef.current = watchlist;
  }, [watchlist]);

  function resolveWatchStock(name: string, index: number) {
    const candidate = findStockSuggestions(name, 1, stockCatalog)[0];
    const fallbackCode =
      index === 0 ? "005930" : index === 1 ? "NVDA" : "010120";
    return {
      name,
      code: candidate?.code || fallbackCode,
      market: candidate?.market,
    };
  }

  const watchStockItems = useMemo(
    () =>
      watchStocks
        .slice(0, 3)
        .map((name, index) => resolveWatchStock(name, index)),
    [watchStocks, stockCatalog],
  );

  useEffect(() => {
    const codes = unique(
      watchStockItems.map((item) => item.code).filter(Boolean),
    );
    if (codes.length === 0) {
      setStockQuotes({});
      return;
    }

    const controller = new AbortController();
    let active = true;

    async function loadQuotes() {
      try {
        const response = await fetch(
          `/api/quotes?codes=${encodeURIComponent(codes.join(","))}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error("quote api failed");
        const data = (await response.json()) as { quotes?: QuoteMap };
        if (active) setStockQuotes(data.quotes || {});
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (active) setStockQuotes({});
      }
    }

    void loadQuotes();
    const timer = window.setInterval(loadQuotes, 1000 * 60);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [watchStockItems]);

  useEffect(() => {
    const scrollTargets = [
      summaryGridRef.current,
      watchCardRowRef.current,
    ].filter((target): target is HTMLElement => Boolean(target));

    const cleanups = scrollTargets.map((target) => {
      let isDown = false;
      let isDragging = false;
      let startX = 0;
      let startLeft = 0;

      const handlePointerDown = (event: PointerEvent) => {
        if (event.pointerType !== "mouse" || event.button !== 0) return;
        if (target.scrollWidth <= target.clientWidth) return;

        isDown = true;
        isDragging = false;
        startX = event.clientX;
        startLeft = target.scrollLeft;
        target.classList.add("is-drag-ready");
        target.setPointerCapture?.(event.pointerId);
      };

      const handlePointerMove = (event: PointerEvent) => {
        if (!isDown || event.pointerType !== "mouse") return;

        const deltaX = event.clientX - startX;
        if (Math.abs(deltaX) > 4) {
          isDragging = true;
          target.classList.add("is-dragging");
        }
        if (!isDragging) return;

        event.preventDefault();
        target.scrollLeft = startLeft - deltaX;
      };

      const stopDrag = (event: PointerEvent) => {
        if (!isDown) return;
        isDown = false;
        target.classList.remove("is-drag-ready", "is-dragging");
        target.releasePointerCapture?.(event.pointerId);

        if (isDragging) {
          target.dataset.dragging = "true";
          window.setTimeout(() => {
            delete target.dataset.dragging;
          }, 0);
        }
      };

      const preventClickAfterDrag = (event: MouseEvent) => {
        if (target.dataset.dragging === "true") {
          event.preventDefault();
          event.stopPropagation();
        }
      };

      target.addEventListener("pointerdown", handlePointerDown);
      target.addEventListener("pointermove", handlePointerMove);
      target.addEventListener("pointerup", stopDrag);
      target.addEventListener("pointercancel", stopDrag);
      target.addEventListener("click", preventClickAfterDrag, true);

      return () => {
        target.removeEventListener("pointerdown", handlePointerDown);
        target.removeEventListener("pointermove", handlePointerMove);
        target.removeEventListener("pointerup", stopDrag);
        target.removeEventListener("pointercancel", stopDrag);
        target.removeEventListener("click", preventClickAfterDrag, true);
      };
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [feedMode, watchStocks.length]);
  const watchSet = useMemo(
    () => new Set(unique([...watchThemes, ...watchStocks, ...expandedStocks])),
    [watchThemes, watchStocks, expandedStocks],
  );
  const sortedNews = useMemo(() => sortNews(news), [news]);
  const topScore =
    sortedNews[0]?.finalScore ?? sortedNews[0]?.importanceScore ?? 0;
  const importantNews = sortedNews.filter(
    (item) => (item.finalScore ?? item.importanceScore) >= threshold,
  );
  const alertNews = useMemo(() => {
    if (dismissedAlertIds.length === 0) return importantNews;
    const dismissed = new Set(dismissedAlertIds);
    return importantNews.filter((item) => !dismissed.has(item.id));
  }, [dismissedAlertIds, importantNews]);

  const clearAllAlerts = () => {
    setDismissedAlertIds((prev) =>
      unique([...prev, ...importantNews.map((item) => item.id)]),
    );
  };
  const koreaCount = sortedNews.filter(
    (item) => item.marketRegion === "korea",
  ).length;
  const usCount = sortedNews.filter(
    (item) => item.marketRegion === "us",
  ).length;
  const globalCount = sortedNews.filter(
    (item) => item.marketRegion === "global" || item.marketRegion === "unknown",
  ).length;
  const pinnedNews = pinnedNewsIds
    .map((id) => sortedNews.find((item) => item.id === id))
    .filter((item): item is MarketNews => Boolean(item));

  const myStockNews = useMemo(() => {
    if (watchStocks.length === 0) return [];
    const tokens = unique([...watchStocks, ...expandedStocks]).map((value) =>
      value.toLowerCase(),
    );
    const matched = sortedNews.filter((item) => {
      const text = [
        item.title,
        item.summary,
        item.source,
        ...(item.tags || []),
        ...(item.relatedStocks || []),
      ]
        .join(" ")
        .toLowerCase();
      return tokens.some((token) => token.length > 0 && text.includes(token));
    });

    if (matched.length > 0) return matched;

    // API 결과가 아직 관심 종목명과 직접 매칭되지 않을 때도 빈 화면만 보이지 않도록,
    // 관심 테마와 높은 점수 뉴스를 보조 후보로 보여줍니다.
    const themeTokens = watchThemes.map((value) => value.toLowerCase());
    return sortedNews
      .filter((item) => {
        const text = [item.title, item.summary, ...(item.tags || [])]
          .join(" ")
          .toLowerCase();
        return themeTokens.some((token) => token && text.includes(token));
      })
      .slice(0, 10);
  }, [expandedStocks, sortedNews, watchStocks, watchThemes]);

  const dynamicThemes = useMemo(() => {
    const score = new Map<string, number>();
    const known = new Set(watchThemes.map((theme) => theme.toLowerCase()));
    for (const item of sortedNews) {
      for (const tag of item.tags || []) {
        const key = tag.trim();
        if (key && !known.has(key.toLowerCase()))
          score.set(key, (score.get(key) || 0) + 8);
      }
    }
    const query = themeQuery.trim().toLowerCase();
    return Array.from(score.entries())
      .filter(([theme]) => !query || theme.toLowerCase().includes(query))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
      .slice(0, 8)
      .map(([theme]) => theme);
  }, [sortedNews, themeQuery, watchThemes]);

  const filteredNews = useMemo(() => {
    let source = feedMode === "stocks" ? myStockNews : sortedNews;
    if (feedMode === "scanner") source = importantNews;
    if (feedMode === "alerts") source = alertNews;
    if (country !== "all") {
      source = source.filter((item) => {
        if (country === "global")
          return (
            item.marketRegion === "global" || item.marketRegion === "unknown"
          );
        return item.marketRegion === country;
      });
    }
    return source;
  }, [country, feedMode, alertNews, importantNews, myStockNews, sortedNews]);

  const visibleNews = filteredNews.slice(0, visibleCount);
  const hasMore = visibleCount < filteredNews.length;

  const summaryCards = [
    {
      label: "종합점수 TOP",
      value: topScore || "-",
      sub: scoreLabel(topScore),
      icon: <ChartNoAxesCombined size={18} />,
      action: () => openMode("home"),
    },
    {
      label: "오늘의 핵심 뉴스",
      value: `${importantNews.length}건`,
      sub: `전체 ${sortedNews.length}건`,
      icon: <Sparkles size={18} />,
      action: () => openMode("home"),
    },
    {
      label: "관심 종목",
      value: `${watchStocks.length}개`,
      sub: `관련 ${myStockNews.length}건`,
      icon: <BriefcaseBusiness size={18} />,
      action: () => openMode("stocks"),
    },
    {
      label: "알림 중요도",
      value: `${Math.round(threshold)}%`,
      sub: scoreLabel(threshold),
      icon: <Bell size={18} />,
      action: () => openMode("settings"),
    },
  ];

  function resolveStockCandidate(raw: string) {
    const cleaned = raw.replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
    const codeMatch = raw.match(/\b\d{6}\b/);
    const code = codeMatch?.[0];
    return stockCatalog.find(
      (stock) =>
        (code && stock.code === code) ||
        stock.name === raw ||
        stock.name === cleaned ||
        stock.aliases?.some((alias) => alias === raw || alias === cleaned),
    );
  }

  function inferStocksFromNewsText(item: MarketNews) {
    const text = [
      item.title,
      item.summary,
      ...(item.tags || []),
      ...(item.relatedStocks || []),
    ]
      .join(" ")
      .toLowerCase();
    const themeMap: Record<string, string[]> = {
      ai: [
        "삼성전자",
        "SK하이닉스",
        "네이버",
        "카카오",
        "한미반도체",
        "테크윙",
      ],
      hbm: ["SK하이닉스", "삼성전자", "한미반도체", "테크윙", "원익IPS"],
      반도체: [
        "삼성전자",
        "SK하이닉스",
        "한미반도체",
        "테크윙",
        "원익IPS",
        "리노공업",
      ],
      전력: ["LS ELECTRIC", "HD현대일렉트릭", "효성중공업", "대한전선"],
      전선: ["LS", "LS ELECTRIC", "대한전선", "가온전선"],
      환율: ["KB금융", "하나금융지주", "신한지주", "삼성전자"],
      금리: ["KB금융", "하나금융지주", "신한지주", "우리금융지주"],
      조선: ["HD한국조선해양", "삼성중공업", "한화오션"],
      원전: ["두산에너빌리티", "현대건설", "LS ELECTRIC"],
      방산: ["한화에어로스페이스", "LIG넥스원", "현대로템"],
    };
    const inferred = new Set<string>();
    for (const [keyword, names] of Object.entries(themeMap)) {
      if (text.includes(keyword.toLowerCase()))
        names.forEach((name) => inferred.add(name));
    }
    for (const candidate of stockCatalog.slice(0, 1800)) {
      const name = candidate.name.trim();
      if (name && name.length >= 2 && text.includes(name.toLowerCase()))
        inferred.add(name);
    }
    return Array.from(inferred).slice(0, 8);
  }

  const aiStockRecommendations = useMemo(() => {
    const score = new Map<
      string,
      {
        name: string;
        code?: string;
        score: number;
        reasons: string[];
        news?: MarketNews;
      }
    >();
    const bump = (
      raw: string,
      value: number,
      reason: string,
      newsItem?: MarketNews,
    ) => {
      const candidate = resolveStockCandidate(raw);
      const name = candidate?.name || raw.replace(/\(\d{6}\)/g, "").trim();
      if (!name || /^[0-9]{6}$/.test(name)) return;
      const key = candidate?.code || name.toLowerCase();
      const prev = score.get(key) || {
        name,
        code: candidate?.code,
        score: 0,
        reasons: [],
        news: newsItem,
      };
      const reasons = prev.reasons.includes(reason)
        ? prev.reasons
        : [...prev.reasons, reason].slice(0, 2);
      score.set(key, {
        name: prev.name,
        code: prev.code || candidate?.code,
        score: Math.min(100, prev.score + value),
        reasons,
        news: prev.news || newsItem,
      });
    };

    for (const item of sortedNews.slice(0, 60)) {
      const newsScore = item.finalScore ?? item.importanceScore;
      const base = Math.max(8, Math.round(newsScore / 9));
      for (const stock of item.relatedStocks || []) {
        bump(
          stock,
          base + 12,
          `${item.marketRegionLabel || "시장"} ${newsScore}점 뉴스와 연결`,
          item,
        );
      }
      for (const stock of inferStocksFromNewsText(item)) {
        bump(stock, base + 7, "관련 뉴스 기반 후보", item);
      }
    }

    if (score.size === 0) {
      const fallbackNames =
        unique([...watchStocks, ...watchThemes]).length > 0
          ? [
              "삼성전자",
              "SK하이닉스",
              "한미반도체",
              "테크윙",
              "LS ELECTRIC",
              "두산에너빌리티",
            ]
          : ["삼성전자", "SK하이닉스", "한미반도체", "테크윙", "LS ELECTRIC"];
      fallbackNames.forEach((name, index) =>
        bump(
          name,
          Math.max(45, 74 - index * 4),
          "수집 뉴스와 기본 시장 테마 기반 후보",
          sortedNews[index],
        ),
      );
    }

    const allCandidates = Array.from(score.values())
      .filter((item) => !watchStocks.includes(item.name))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ko"));

    const passed = allCandidates
      .filter((item) => item.score >= aiStockThreshold)
      .slice(0, 5);
    return passed.length > 0 ? passed : allCandidates.slice(0, 5);
  }, [aiRefreshStamp, sortedNews, stockCatalog, watchStocks, aiStockThreshold]);

  function changeAiStockThreshold(value: number) {
    const normalized = Math.max(40, Math.min(95, value));
    setAiStockThreshold(normalized);
    try {
      localStorage.setItem(AI_STOCK_THRESHOLD_KEY, String(normalized));
    } catch {}
  }

  function changeAiStockThresholdByPointer(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const next = Math.round(40 + (x / rect.width) * 55);
    changeAiStockThreshold(next);
  }

  function addAiStockOnly(name: string) {
    const candidate = findStockSuggestions(name, 1, stockCatalog)[0];
    const selected = candidate?.name || name;
    if (!watchStocks.includes(selected)) {
      setWatchState({
        themes: watchThemes,
        stocks: [...watchStocks, selected],
      });
    }
  }

  function addAiStockAndReveal(item: { name: string; news?: MarketNews }) {
    addAiStockOnly(item.name);
    if (item.news) revealNewsOnHome(item.news);
    else openMode("stocks");
  }

  function refreshAiRecommendations() {
    setAiRefreshStamp(Date.now());
    void loadNews(true, false, watchlistRef.current);
  }

  const persistWatch = useCallback(
    (next: WatchState, nextThreshold = threshold) => {
      try {
        localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
        localStorage.setItem(THRESHOLD_KEY, String(nextThreshold));
      } catch {
        // ignore
      }
    },
    [threshold],
  );

  const setWatchState = useCallback(
    (next: WatchState) => {
      const normalized = normalizeWatchState(next);
      setWatchThemes(normalized.themes);
      setWatchStocks(normalized.stocks);
      persistWatch(normalized);
    },
    [persistWatch],
  );

  const applyResponse = useCallback((data: NewsApiResponse) => {
    const next = sortNews(safeNews(data.news));
    setNews(next.length > 0 ? next : mockNews);
    setGeneratedAt(data.generatedAt || new Date().toISOString());
    setSourceMode(data.sourceMode || "fallback");
    setLatencyMs(typeof data.latencyMs === "number" ? data.latencyMs : null);
    setError(data.error || "");
    setVisibleCount(PAGE_SIZE);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, news: next }));
    } catch {
      // ignore
    }
  }, []);

  const requestSeqRef = useRef(0);
  const inFlightRef = useRef<AbortController | null>(null);
  const activeNewsRequestKeyRef = useRef("");
  const lastNewsRequestRef = useRef<{ key: string; at: number }>({
    key: "",
    at: 0,
  });

  const loadNews = useCallback(
    async (
      fullScreen = false,
      stockFocused = false,
      watchlistOverride?: string[],
    ) => {
      const activeWatchlist = unique(watchlistOverride || watchlistRef.current);
      const params = new URLSearchParams({
        limit: stockFocused ? "90" : "70",
        watchlist: activeWatchlist.join(","),
      });
      if (stockFocused) params.set("mode", "mystocks");
      const requestKey = params.toString();
      const now = Date.now();

      if (activeNewsRequestKeyRef.current === requestKey) return;
      if (
        !fullScreen &&
        lastNewsRequestRef.current.key === requestKey &&
        now - lastNewsRequestRef.current.at < 1500
      )
        return;

      const requestId = requestSeqRef.current + 1;
      requestSeqRef.current = requestId;

      if (inFlightRef.current) inFlightRef.current.abort();
      const controller = new AbortController();
      inFlightRef.current = controller;
      activeNewsRequestKeyRef.current = requestKey;
      lastNewsRequestRef.current = { key: requestKey, at: now };

      if (fullScreen) {
        setRefreshMessage(
          stockFocused
            ? "내 주식 피드를 동기화하고 있습니다."
            : "실시간 데이터를 동기화하고 있습니다.",
        );
        setFullRefreshVisible(true);
      }
      setLoading(!fullScreen);
      setRefreshing(true);
      setError("");
      try {
        const response = await fetch(`/api/news?${requestKey}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(`뉴스 API HTTP 오류: ${response.status}`);
        const data = (await response.json()) as NewsApiResponse;
        if (requestSeqRef.current === requestId) applyResponse(data);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message =
          err instanceof Error ? err.message : "뉴스를 불러오지 못했습니다.";
        if (requestSeqRef.current === requestId) {
          setError(message);
          applyResponse(fallbackResponse(message));
        }
      } finally {
        if (requestSeqRef.current === requestId) {
          setLoading(false);
          setRefreshing(false);
          setTimeout(() => setFullRefreshVisible(false), 1000);
        }
        if (inFlightRef.current === controller) inFlightRef.current = null;
        if (activeNewsRequestKeyRef.current === requestKey)
          activeNewsRequestKeyRef.current = "";
      }
    },
    [applyResponse],
  );

  useEffect(() => {
    let initialWatchlist = watchlistRef.current;
    try {
      const cachedWatch = localStorage.getItem(WATCHLIST_KEY);
      const cachedThreshold = localStorage.getItem(THRESHOLD_KEY);
      const cachedAiThreshold = localStorage.getItem(AI_STOCK_THRESHOLD_KEY);
      const cachedTheme = localStorage.getItem(APP_THEME_KEY);
      const cachedQuickMenu = localStorage.getItem(QUICK_MENU_KEY);
      const cachedNews = localStorage.getItem(CACHE_KEY);
      const cachedPinned = localStorage.getItem(PINNED_KEY);
      if (cachedWatch) {
        const normalized = normalizeWatchState(JSON.parse(cachedWatch));
        setWatchThemes(normalized.themes);
        setWatchStocks(normalized.stocks);
        initialWatchlist = unique([...normalized.themes, ...normalized.stocks]);
        watchlistRef.current = initialWatchlist;
      }
      if (cachedThreshold && !Number.isNaN(Number(cachedThreshold)))
        setThreshold(Number(cachedThreshold));
      if (cachedAiThreshold && !Number.isNaN(Number(cachedAiThreshold)))
        setAiStockThreshold(Number(cachedAiThreshold));
      if (cachedTheme === "musinsa" || cachedTheme === "light")
        setAppTheme(cachedTheme);
      if (cachedQuickMenu === "hidden") setQuickMenuVisible(false);
      if (cachedNews) applyResponse(JSON.parse(cachedNews) as NewsApiResponse);
      if (cachedPinned) {
        const parsed = JSON.parse(cachedPinned);
        if (Array.isArray(parsed))
          setPinnedNewsIds(parsed.filter((id) => typeof id === "string"));
      }
    } catch {
      // ignore corrupted cache
    }
    void loadNews(false, false, initialWatchlist);
    return () => {
      if (inFlightRef.current) inFlightRef.current.abort();
    };
    // 초기 부팅 시 1회만 실행합니다. 관심사 변경은 수동 새로고침/추가 액션에서만 호출합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadStocks() {
      try {
        const response = await fetch("/api/stocks", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { stocks?: StockCandidate[] };
        if (!cancelled && Array.isArray(data.stocks))
          setStockCatalog(data.stocks);
      } catch {
        // ignore
      }
    }
    void loadStocks();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const query = debouncedStockQuery.trim();
    if (!query) {
      setStockSuggestions([]);
      return;
    }

    const controller = new AbortController();
    let active = true;

    async function loadStockSuggestions() {
      try {
        const response = await fetch(
          `/api/stocks?q=${encodeURIComponent(query)}&limit=8`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) throw new Error("stock api failed");
        const data = (await response.json()) as { stocks?: StockCandidate[] };
        if (!active) return;
        const remote = Array.isArray(data.stocks) ? data.stocks : [];
        setStockSuggestions(
          remote.length > 0
            ? remote
            : findStockSuggestions(query, 8, stockCatalog),
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (active)
          setStockSuggestions(findStockSuggestions(query, 8, stockCatalog));
      }
    }

    void loadStockSuggestions();

    return () => {
      active = false;
      controller.abort();
    };
  }, [debouncedStockQuery, stockCatalog]);

  useEffect(() => {
    if (!stockSearchFocused || !stockQuery) return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active === stockInputRef.current)
      return;
    const timer = window.setTimeout(() => {
      stockInputRef.current?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [stockQuery, stockSearchFocused, stockSuggestions.length]);

  useEffect(() => {
    if (!themeSearchFocused || !themeQuery) return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active === themeInputRef.current)
      return;
    const timer = window.setTimeout(() => {
      themeInputRef.current?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [themeQuery, themeSearchFocused, dynamicThemes.length]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 860px)");
    const syncCompact = () => {
      if (media.matches) setCompact(false);
    };
    syncCompact();
    media.addEventListener("change", syncCompact);
    return () => media.removeEventListener("change", syncCompact);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = appTheme;
    try {
      localStorage.setItem(APP_THEME_KEY, appTheme);
    } catch {}
  }, [appTheme]);

  useEffect(() => {
    try {
      localStorage.setItem(
        QUICK_MENU_KEY,
        quickMenuVisible ? "visible" : "hidden",
      );
    } catch {}
  }, [quickMenuVisible]);

  useEffect(() => {
    let startY = 0;
    let tracking = false;

    function handleTouchStart(event: TouchEvent) {
      if (window.scrollY > 2 || fullRefreshVisible) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          "input, textarea, select, .suggestion-popover, .mobile-bottom-nav, .alerts-modal, .news-detail-sheet",
        )
      )
        return;
      startY = event.touches[0]?.clientY || 0;
      tracking = true;
    }

    function handleTouchMove(event: TouchEvent) {
      if (!tracking) return;
      const y = event.touches[0]?.clientY || 0;
      const distance = Math.max(0, Math.min(118, (y - startY) * 0.62));
      if (distance > 6) {
        event.preventDefault();
        setPullDistance(distance);
      }
    }

    function handleTouchEnd() {
      if (!tracking) return;
      tracking = false;
      const shouldRefresh = pullDistance >= 86;
      if (shouldRefresh) {
        setPullRefreshing(true);
        void loadNews(
          true,
          feedMode === "stocks",
          watchlistRef.current,
        ).finally(() => {
          window.setTimeout(() => {
            setPullRefreshing(false);
            setPullDistance(0);
          }, 500);
        });
      } else {
        setPullDistance(0);
      }
    }

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);
    window.addEventListener("touchcancel", handleTouchEnd);
    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [feedMode, fullRefreshVisible, loadNews, pullDistance]);

  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;

    function handleScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        const currentY = window.scrollY;
        const delta = currentY - lastY;
        if (currentY < 80) setMobileHeaderHidden(false);
        else if (delta > 8) setMobileHeaderHidden(true);
        else if (delta < -6) setMobileHeaderHidden(false);
        lastY = currentY;
        ticking = false;
      });
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    let dragging = false;
    let startY = 0;
    let startScrollY = 0;

    function isInteractive(target: EventTarget | null) {
      return (
        target instanceof Element &&
        Boolean(
          target.closest(
            "button, a, input, textarea, select, [role='button'], .suggestion-popover, .mobile-bottom-nav, .mobile-topbar",
          ),
        )
      );
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.pointerType === "touch" || isInteractive(event.target)) return;
      dragging = true;
      startY = event.clientY;
      startScrollY = window.scrollY;
      document.documentElement.classList.add("drag-scroll-active");
    }

    function handlePointerMove(event: PointerEvent) {
      if (!dragging) return;
      const distance = startY - event.clientY;
      window.scrollTo({ top: startScrollY + distance });
    }

    function stopDragging() {
      dragging = false;
      document.documentElement.classList.remove("drag-scroll-active");
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
      document.documentElement.classList.remove("drag-scroll-active");
    };
  }, []);

  function changeThreshold(value: number) {
    const normalized = Math.max(50, Math.min(95, value));
    setThreshold(normalized);
    persistWatch({ themes: watchThemes, stocks: watchStocks }, normalized);
  }

  function addStock(name?: string) {
    const raw = (name || stockQuery).trim();
    if (!raw) return;
    const candidate = findStockSuggestions(raw, 1, stockCatalog)[0];
    const selected = candidate?.name || raw;
    const nextStocks = watchStocks.includes(selected)
      ? watchStocks
      : [...watchStocks, selected];
    const nextState = { themes: watchThemes, stocks: nextStocks };
    setWatchState(nextState);
    const nextExpanded = expandStockKeywords(nextStocks, stockCatalog);
    const nextWatchlist = unique([...watchThemes, ...nextExpanded]);
    watchlistRef.current = nextWatchlist;
    setStockQuery("");
    setFeedMode("stocks");
    void loadNews(true, true, nextWatchlist);
  }

  function addTheme(theme?: string) {
    const selected = (theme || themeQuery).replace(/^#/, "").trim();
    if (!selected) return;
    if (!watchThemes.includes(selected))
      setWatchState({
        themes: [...watchThemes, selected],
        stocks: watchStocks,
      });
    setThemeQuery("");
    setThemeSuggestOpen(false);
    setThemeSearchFocused(false);
  }

  function removeStock(name: string) {
    setWatchState({
      themes: watchThemes,
      stocks: watchStocks.filter((item) => item !== name),
    });
  }

  function removeTheme(theme: string) {
    setWatchState({
      themes: watchThemes.filter((item) => item !== theme),
      stocks: watchStocks,
    });
  }

  function toggleTheme(theme: string) {
    if (watchThemes.includes(theme)) removeTheme(theme);
    else
      setWatchState({ themes: [...watchThemes, theme], stocks: watchStocks });
  }

  function toggleStock(stock: string) {
    const canonical =
      findStockSuggestions(stock, 1, stockCatalog)[0]?.name || stock;
    if (watchStocks.includes(canonical)) removeStock(canonical);
    else
      setWatchState({
        themes: watchThemes,
        stocks: [...watchStocks, canonical],
      });
  }

  function togglePinned(item: MarketNews) {
    setPinnedNewsIds((prev) => {
      const next = prev.includes(item.id)
        ? prev.filter((id) => id !== item.id)
        : [item.id, ...prev].slice(0, 8);
      try {
        localStorage.setItem(PINNED_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  function resetLocalSettings() {
    try {
      localStorage.removeItem(WATCHLIST_KEY);
      localStorage.removeItem(THRESHOLD_KEY);
      localStorage.removeItem(AI_STOCK_THRESHOLD_KEY);
      localStorage.removeItem(PINNED_KEY);
      localStorage.removeItem(QUICK_MENU_KEY);
    } catch {
      // ignore
    }
    setWatchThemes(defaultThemes);
    setWatchStocks(defaultStocks);
    setThreshold(82);
    setAiStockThreshold(60);
    setPinnedNewsIds([]);
    setQuickMenuVisible(true);
    setThemeQuery("");
    setStockQuery("");
    setThemeSuggestOpen(false);
    setInterestChipsExpanded(false);
    watchlistRef.current = defaultThemes;
    void loadNews(true, false, defaultThemes);
  }

  function closeMobileDrawer() {
    if (!mobileSearchOpen) return;
    setMobileDrawerClosing(true);
    window.setTimeout(() => {
      setMobileSearchOpen(false);
      setMobileDrawerClosing(false);
    }, 580);
  }

  function openMode(mode: FeedMode) {
    closeMobileDrawer();
    setFeedMode(mode);
    setVisibleCount(PAGE_SIZE);
    if (mode === "stocks" && watchStocks.length > 0) {
      window.setTimeout(() => loadNews(false, true, watchlistRef.current), 0);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function revealNewsOnHome(item: MarketNews) {
    setAlertsOpen(false);
    setSelectedNews(null);
    setCountry("all");
    setFeedMode("home");
    const sortedIndex = sortedNews.findIndex(
      (newsItem) => newsItem.id === item.id,
    );
    if (sortedIndex >= 0) setVisibleCount(Math.max(PAGE_SIZE, sortedIndex + 1));
    window.setTimeout(() => {
      const target = document.getElementById(`news-card-${item.id}`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("news-card-highlight");
        window.setTimeout(
          () => target.classList.remove("news-card-highlight"),
          1800,
        );
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }, 180);
  }

  function navItems() {
    return [
      { mode: "home" as const, label: "홈", icon: <Home size={19} /> },
      {
        mode: "stocks" as const,
        label: "내 주식",
        icon: <BriefcaseBusiness size={19} />,
      },
      {
        mode: "aiStocks" as const,
        label: "AI 추천",
        icon: <Sparkles size={19} />,
      },
      { mode: "alerts" as const, label: "알림", icon: <Bell size={19} /> },
      {
        mode: "settings" as const,
        label: "설정",
        icon: <Settings size={19} />,
      },
    ];
  }

  const renderStockSearchBox = (compactBox = false) => (
    <div
      className={compactBox ? "stock-search-box compact" : "stock-search-box"}
    >
      <Search size={18} />
      <input
        ref={stockInputRef}
        value={stockQuery}
        onFocus={() => setStockSearchFocused(true)}
        onBlur={() =>
          window.setTimeout(() => setStockSearchFocused(false), 220)
        }
        onChange={(event) => {
          const nextQuery = event.target.value;
          setStockQuery(nextQuery);
          const query = nextQuery.trim();
          setStockSuggestions(
            query ? findStockSuggestions(query, 8, stockCatalog) : [],
          );
          setStockSearchFocused(true);
        }}
        onCompositionStart={() => setStockSearchFocused(true)}
        onCompositionEnd={() => {
          setStockSearchFocused(true);
          window.requestAnimationFrame(() =>
            stockInputRef.current?.focus({ preventScroll: true }),
          );
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") addStock(stockSuggestions[0]?.name);
        }}
        autoComplete="off"
        spellCheck={false}
        placeholder="종목명 또는 티커 입력"
      />
      {stockQuery && (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setStockQuery("");
            stockInputRef.current?.focus({ preventScroll: true });
          }}
          aria-label="검색어 지우기"
        >
          <X size={16} />
        </button>
      )}
      <button
        type="button"
        className="add-round"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => addStock(stockSuggestions[0]?.name)}
        aria-label="관심 종목 추가"
      >
        <Plus size={18} />
      </button>
      {stockQuery && stockSearchFocused && (
        <div className="suggestion-popover">
          {stockSuggestions.length > 0 ? (
            stockSuggestions.map((stock) => (
              <button
                type="button"
                key={`${stock.code}-${stock.name}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addStock(stock.name)}
              >
                <span>
                  <strong>{stock.name}</strong>
                  <em>
                    {stock.code} · {stock.market}
                  </em>
                </span>
                <small>{stock.sector}</small>
              </button>
            ))
          ) : (
            <div className="suggestion-empty">
              일치하는 종목을 찾는 중입니다.
            </div>
          )}
        </div>
      )}
    </div>
  );

  function ThemeSearchBox() {
    const shouldShowThemes = themeSuggestOpen && dynamicThemes.length > 0;
    return (
      <div className="stock-search-box">
        <Sparkles size={18} />
        <input
          ref={themeInputRef}
          value={themeQuery}
          onFocus={() => {
            setThemeSuggestOpen(true);
            setThemeSearchFocused(true);
          }}
          onBlur={() =>
            window.setTimeout(() => {
              setThemeSuggestOpen(false);
              setThemeSearchFocused(false);
            }, 220)
          }
          onChange={(event) => {
            setThemeQuery(event.target.value);
            setThemeSuggestOpen(true);
            setThemeSearchFocused(true);
          }}
          onCompositionEnd={() => {
            setThemeSearchFocused(true);
            window.requestAnimationFrame(() =>
              themeInputRef.current?.focus({ preventScroll: true }),
            );
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") addTheme(dynamicThemes[0] || themeQuery);
          }}
          placeholder="관심 테마 입력"
        />
        <button
          type="button"
          className="add-round"
          onClick={() => addTheme(dynamicThemes[0] || themeQuery)}
        >
          <Plus size={18} />
        </button>
        {shouldShowThemes && (
          <div className="suggestion-popover compact-scroll">
            {dynamicThemes.slice(0, 5).map((theme) => (
              <button
                type="button"
                key={theme}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addTheme(theme)}
              >
                <span>
                  <strong>#{theme}</strong>
                  <em>뉴스에서 감지됨</em>
                </span>
                <small>테마</small>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  function ThresholdSlider({ dense = false }: { dense?: boolean }) {
    const percent = Math.max(0, Math.min(100, ((threshold - 50) / 45) * 100));
    const handle = (
      event: ChangeEvent<HTMLInputElement> | FormEvent<HTMLInputElement>,
    ) => changeThreshold(Number(event.currentTarget.value));
    return (
      <div
        className={dense ? "threshold-card dense" : "threshold-card"}
        style={{ "--range": `${percent}%` } as CSSProperties}
      >
        <div className="threshold-head">
          <span>알림 중요도</span>
          <strong>{Math.round(threshold)}%</strong>
        </div>
        <input
          type="range"
          min="50"
          max="95"
          step="1"
          value={threshold}
          onInput={handle}
          onChange={handle}
        />
        <div className="threshold-scale">
          <span>50</span>
          <span>65</span>
          <span>80</span>
          <span>95</span>
        </div>
        {!dense && (
          <p>
            종합점수는 중요도, 신뢰도, 최신성을 더하고 의견성은 감점해
            계산합니다.
          </p>
        )}
      </div>
    );
  }

  function StatusCard() {
    return (
      <div className="status-card">
        <div className="status-title">
          <i className={sourceMode === "live" ? "live" : "fallback"} /> 실제
          뉴스 연동 중
        </div>
        <p>마지막 갱신 {formatTime(generatedAt)}</p>
        <div className="status-pills">
          <span>{sortedNews.length}건 수신</span>
          <span>{latencyMs !== null ? `${latencyMs}ms` : "응답 대기"}</span>
        </div>
        {error && <small>{error}</small>}
      </div>
    );
  }

  function DesktopSidebar() {
    return (
      <aside className="desktop-sidebar">
        <div className="side-brand">
          <span className="brand-wave">S</span>
          <strong>SKIM</strong>
        </div>
        <nav>
          {navItems().map((item) => (
            <button
              key={item.mode}
              type="button"
              className={feedMode === item.mode ? "active" : ""}
              onClick={() => openMode(item.mode)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <StatusCard />
      </aside>
    );
  }

  function RightPanel() {
    return (
      <aside className="right-panel">
        <div className="panel-top">
          <h2>필터 설정</h2>
          <button type="button" onClick={() => openMode("settings")}>
            <X size={16} />
          </button>
        </div>
        {ThresholdSlider({})}
        <div className="interest-card dark">
          <strong>테마 {watchThemes.length}</strong>
          <span>{watchThemes.join(" · ") || "없음"}</span>
        </div>
        <div className="interest-card dark">
          <strong>종목 {watchStocks.length}</strong>
          <span>{watchStocks.join(" · ") || "없음"}</span>
        </div>
        <div className="interest-card dark">
          <strong>키워드 {watchlist.length}</strong>
          <span>{watchlist.slice(0, 5).join(" · ") || "없음"}</span>
        </div>
        {/* <button type="button" className="settings-link" onClick={() => openMode("settings")}><SlidersHorizontal size={17} /> 설정 관리</button> */}
      </aside>
    );
  }

  function SummaryGrid() {
    return (
      <section ref={summaryGridRef} className="summary-grid">
        {summaryCards.map((card) => (
          <button
            type="button"
            className="summary-card"
            key={card.label}
            onClick={card.action}
          >
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>
              {card.icon}
              {card.sub}
            </small>
          </button>
        ))}
      </section>
    );
  }

  function WatchStockCards() {
    return (
      <section className="watch-section">
        <div className="section-title-row">
          <h2>관심 종목 요약</h2>
          <button type="button" onClick={() => openMode("stocks")}>
            전체 보기 <ChevronRight size={15} />
          </button>
        </div>
        <div ref={watchCardRowRef} className="watch-card-row">
          {watchStockItems.map((item) => {
            const quote = stockQuotes[item.code];
            return (
              <div
                className="stock-mini-card"
                key={`${item.name}-${item.code}`}
              >
                <button
                  type="button"
                  className="mini-star"
                  onClick={() => removeStock(item.name)}
                  aria-label={`${item.name} 관심 종목 제거`}
                >
                  <Star size={14} fill="currentColor" />
                </button>
                <strong>{item.name}</strong>
                <span>{item.code}</span>
                <b>{quote?.priceText || "시세 확인 중"}</b>
                <em
                  className={
                    quote?.changeRate !== null &&
                    quote?.changeRate !== undefined &&
                    quote.changeRate < 0
                      ? "down"
                      : ""
                  }
                >
                  {quote?.changeText || "실시간 연동"}
                </em>
                <i />
              </div>
            );
          })}
          <button
            type="button"
            className="stock-add-card"
            onClick={() => openMode("search")}
          >
            <Plus size={22} />
            종목 추가
          </button>
        </div>
      </section>
    );
  }

  function NewsListSection({
    title = "실시간 주요 뉴스",
    items = visibleNews,
  }: {
    title?: string;
    items?: MarketNews[];
  }) {
    const isHomeMain = feedMode === "home" && title === "실시간 주요 뉴스";
    const sectionTotal =
      title === "내 주식 관련 뉴스" ? myStockNews.length : filteredNews.length;
    const sectionHasMore = visibleCount < sectionTotal;
    return (
      <section className="news-section">
        <div className="section-title-row">
          <h2>{title}</h2>
          <div className="list-actions">
            <button
              type="button"
              className={compact ? "active compact-toggle" : "compact-toggle"}
              onClick={() => setCompact(!compact)}
            >
              {compact ? "자세히" : "간략히"}
            </button>
            {isHomeMain && (
              <button
                type="button"
                className="desktop-refresh-action"
                onClick={() => loadNews(true, false, watchlistRef.current)}
              >
                <RefreshCw size={15} /> 새로고침
              </button>
            )}
          </div>
        </div>
        <div className="country-filter-row">
          <button
            className={country === "all" ? "active" : ""}
            onClick={() => setCountry("all")}
          >
            전체
          </button>
          <button
            className={country === "korea" ? "active" : ""}
            onClick={() => setCountry("korea")}
          >
            한국
          </button>
          <button
            className={country === "us" ? "active" : ""}
            onClick={() => setCountry("us")}
          >
            미국
          </button>
          <button
            className={country === "global" ? "active" : ""}
            onClick={() => setCountry("global")}
          >
            글로벌
          </button>
        </div>
        {loading && items.length === 0 ? (
          <div className="skeleton-stack">
            <div />
            <div />
            <div />
          </div>
        ) : items.length === 0 ? (
          <div className="empty-card">표시할 뉴스가 없습니다.</div>
        ) : (
          <div className="commerce-news-list">
            {items.map((item) => (
              <NewsCard
                key={item.id}
                news={item}
                threshold={threshold}
                watchSet={watchSet}
                compact={compact}
                pinned={pinnedNewsIds.includes(item.id)}
                onTogglePin={() => togglePinned(item)}
                onToggleTheme={toggleTheme}
                onToggleStock={toggleStock}
                onOpenDetail={
                  feedMode === "alerts"
                    ? (target) => {
                        window.open(
                          target.originalUrl,
                          "_blank",
                          "noopener,noreferrer",
                        );
                      }
                    : setSelectedNews
                }
              />
            ))}
          </div>
        )}
        {sectionHasMore && (
          <button
            type="button"
            className="load-more-commerce"
            onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
          >
            <Plus size={17} /> 뉴스 더 보기
          </button>
        )}
      </section>
    );
  }

  function HomeView() {
    return (
      <>
        <div className="greeting-row">
          <div>
            <h1>안녕하세요! 👋</h1>
            <p>시장을 움직이는 중요한 뉴스를 놓치지 마세요.</p>
          </div>
          <button
            type="button"
            className="bell-button"
            onClick={() => setAlertsOpen(true)}
          >
            <Bell size={20} />
            <span>{alertNews.length}</span>
          </button>
        </div>
        {SummaryGrid()}
        {NewsListSection({ items: visibleNews })}
        {WatchStockCards()}
      </>
    );
  }

  function StocksView() {
    return (
      <div className="page-card light-page-card">
        <div className="back-title">
          <h1>관심 종목</h1>
          <p>등록한 종목과 관련 뉴스를 한곳에서 확인합니다.</p>
        </div>
        {renderStockSearchBox()}
        <div className="chip-board">
          {watchStocks.length === 0 ? (
            <span className="empty-chip">관심 종목이 없습니다.</span>
          ) : (
            watchStocks.map((stock) => (
              <span className="managed-chip" key={stock}>
                {stock}
                <small>
                  {getStockSearchTokens(stock, stockCatalog)
                    .slice(0, 2)
                    .join(" · ")}
                </small>
                <button onClick={() => removeStock(stock)}>
                  <X size={13} />
                </button>
              </span>
            ))
          )}
        </div>
        {NewsListSection({
          title: "내 주식 관련 뉴스",
          items: myStockNews.slice(0, visibleCount),
        })}
      </div>
    );
  }

  function SearchView() {
    return (
      <div className="mobile-page-stack">
        <section className="search-hero">
          <button
            type="button"
            className="back-btn"
            onClick={() => openMode("home")}
          >
            <ChevronRight size={17} />
          </button>
          <h1>
            관심 종목을
            <br />
            추가해 보세요
          </h1>
          <p>
            종목명 또는 티커로 빠르게 검색하고 내 주식 피드에 바로 반영합니다.
          </p>
          {renderStockSearchBox()}
          <div className="recommend-row">
            {[
              "삼성전자",
              "엔비디아",
              "LS",
              "현대차",
              "SK하이닉스",
              "한국전력",
            ].map((item) => (
              <button type="button" key={item} onClick={() => addStock(item)}>
                {item}
              </button>
            ))}
          </div>
          <div className="search-illustration">
            <Search size={96} />
          </div>
        </section>
      </div>
    );
  }

  function ScannerView() {
    return (
      <div className="page-card">
        <div className="back-title">
          <h1>AI 스캐너</h1>
          <p>종합점수 {Math.round(threshold)}점 이상 뉴스를 우선 표시합니다.</p>
        </div>
        {SummaryGrid()}
        {NewsListSection({
          title: "고중요도 뉴스",
          items: importantNews.slice(0, visibleCount),
        })}
      </div>
    );
  }

  function AiStockThresholdSlider() {
    const percent = Math.max(
      0,
      Math.min(100, ((aiStockThreshold - 40) / 55) * 100),
    );
    return (
      <div
        className="threshold-card dense ai-threshold-card"
        style={{ "--range": `${percent}%` } as CSSProperties}
      >
        <div className="threshold-head">
          <span>AI 추천 점수</span>
          <strong>{Math.round(aiStockThreshold)}점 이상</strong>
        </div>
        <div
          className="ai-range-hitarea"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            changeAiStockThresholdByPointer(event);
          }}
          onPointerMove={(event) => {
            if (event.buttons === 1) changeAiStockThresholdByPointer(event);
          }}
        >
          <input
            type="range"
            min="40"
            max="95"
            step="1"
            value={aiStockThreshold}
            onInput={(event) =>
              changeAiStockThreshold(Number(event.currentTarget.value))
            }
            onChange={(event) =>
              changeAiStockThreshold(Number(event.currentTarget.value))
            }
          />
        </div>
        <div className="threshold-scale">
          <span>40</span>
          <span>60</span>
          <span>80</span>
          <span>95</span>
        </div>
      </div>
    );
  }

  function AiStocksView() {
    return (
      <div className="page-card light-page-card ai-stock-page">
        <div className="back-title ai-title-row">
          <div>
            <div className="ai-title-head">
              <h1>AI 추천</h1>
              <button
                type="button"
                className="ai-desc-toggle"
                onClick={() => setAiDescriptionOpen((open) => !open)}
              >
                + 설명
              </button>
            </div>
            <p
              className={
                aiDescriptionOpen ? "ai-description open" : "ai-description"
              }
            >
              오늘 수집된 뉴스와 관심 키워드를 기준으로 주목할 만한 종목을
              추렸습니다.
            </p>
            <small>
              카드를 클릭하시면 관심종목에 추가되고 관련 뉴스로 이동합니다.
            </small>
          </div>
          <button
            type="button"
            className="desktop-refresh-action ai-refresh-action press-motion"
            onClick={refreshAiRecommendations}
          >
            <RefreshCw size={15} /> 실시간 추천 새로고침
          </button>
        </div>
        <AiStockThresholdSlider />
        {aiStockRecommendations.length === 0 ? (
          <div className="empty-card">
            추천 후보를 분석 중입니다. 뉴스 새로고침 후에도 비어 있으면 관심
            테마를 추가해 주세요.
          </div>
        ) : (
          <div className="ai-stock-list enhanced">
            {aiStockRecommendations.map((item, index) => (
              <button
                type="button"
                key={`${item.code || item.name}-${index}`}
                onClick={() => addAiStockAndReveal(item)}
              >
                <div className="ai-rank-row">
                  <span>TOP {index + 1}</span>
                  <strong>{item.score}/100</strong>
                </div>
                <strong className="ai-stock-name-line">
                  {item.name}
                  {item.code ? <small>{item.code}</small> : null}
                </strong>
                <b>
                  {item.news?.title
                    ? item.news.title.slice(0, 58)
                    : "관련 뉴스 기반 추천"}
                </b>
                <i
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    addAiStockOnly(item.name);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.stopPropagation();
                      addAiStockOnly(item.name);
                    }
                  }}
                >
                  + 추가
                </i>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  function SettingsView() {
    const quickLabel = quickMenuVisible ? "빠른모음 안보기" : "빠른모음 보기";
    const allInterests = [
      ...watchThemes.map((value) => ({ type: "theme" as const, value })),
      ...watchStocks.map((value) => ({ type: "stock" as const, value })),
    ];
    const chipLimit = 6;
    const visibleInterests = interestChipsExpanded
      ? allInterests
      : allInterests.slice(0, chipLimit);
    const hasHiddenInterests = allInterests.length > chipLimit;

    return (
      <div className="settings-screen">
        <div className="settings-mobile-head">
          <h1>설정</h1>
          <span>v9.7</span>
        </div>
        <section className="settings-list-card">
          <h2>일반</h2>
          <button
            type="button"
            onClick={() => setQuickMenuVisible((visible) => !visible)}
          >
            <SlidersHorizontal size={17} />
            {quickLabel}
            <span>{quickMenuVisible ? "표시 중" : "숨김"}</span>
          </button>
          <button
            type="button"
            onClick={() =>
              setAppTheme((theme) =>
                theme === "musinsa" ? "light" : "musinsa",
              )
            }
          >
            <Moon size={17} />
            테마 변경
            <span>
              {appTheme === "musinsa" ? "무신사 블랙" : "라이트 퍼플"}
            </span>
          </button>
          <button
            type="button"
            onClick={() =>
              loadNews(true, feedMode === "stocks", watchlistRef.current)
            }
          >
            <DatabaseZap size={17} />
            데이터 동기화<span>실시간</span>
          </button>
        </section>
        <section className="settings-list-card interest-settings-card">
          <h2>관심 설정</h2>
          {ThemeSearchBox()}
          <div
            className={
              interestChipsExpanded
                ? "chip-board compact expanded"
                : "chip-board compact collapsed"
            }
          >
            {visibleInterests.map((item) => (
              <span
                className={
                  item.type === "theme" ? "managed-chip theme" : "managed-chip"
                }
                key={`${item.type}-${item.value}`}
              >
                {item.value}
                <button
                  onClick={() =>
                    item.type === "theme"
                      ? removeTheme(item.value)
                      : removeStock(item.value)
                  }
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
          {hasHiddenInterests && (
            <button
              type="button"
              className="interest-expand-tab"
              onClick={() => setInterestChipsExpanded((expanded) => !expanded)}
            >
              {interestChipsExpanded
                ? "− 줄이기"
                : `+ ${allInterests.length - chipLimit}개 더보기`}
            </button>
          )}
        </section>
        <section className="settings-list-card">
          <h2>알림 기준</h2>
          {ThresholdSlider({})}
        </section>
        <button
          type="button"
          className="logout-btn"
          onClick={resetLocalSettings}
        >
          <LogOut size={17} /> 로컬 설정 초기화
        </button>
      </div>
    );
  }

  function AlertsModal() {
    const alertItems = alertNews.slice(0, 30);
    return (
      <div className="alerts-backdrop" onClick={() => setAlertsOpen(false)}>
        <section
          className="alerts-modal"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="alerts-head">
            <div>
              <span>ALERTS</span>
              <h2>알림 뉴스</h2>
            </div>
            <div className="alerts-head-actions">
              <button
                type="button"
                className="alert-clear-btn"
                onClick={clearAllAlerts}
                disabled={alertItems.length === 0}
              >
                모두제거
              </button>
              <button
                type="button"
                className="alert-close-btn"
                onClick={() => setAlertsOpen(false)}
              >
                <X size={17} />
              </button>
            </div>
          </div>
          {alertItems.length === 0 ? (
            <div className="empty-card">
              현재 알림 기준에 맞는 뉴스가 없습니다.
            </div>
          ) : (
            <div className="alerts-list">
              {alertItems.map((item) => (
                <button
                  type="button"
                  key={`alert-${item.id}`}
                  onClick={() => revealNewsOnHome(item)}
                >
                  <strong>{item.title}</strong>
                  <span>
                    {item.source} · {formatTime(item.publishedAt)} ·{" "}
                    {item.finalScore ?? item.importanceScore}/100
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  function AlertsView() {
    const alertItems = alertNews.slice(0, 30);
    return (
      <div className="page-card alerts-page-card">
        <div className="back-title alerts-page-title">
          <div>
            <h1>알림</h1>
            <p>알림 기준을 넘은 뉴스의 핵심 문구와 점수만 정리했습니다.</p>
          </div>
          <button
            type="button"
            className="alert-clear-btn page-clear"
            onClick={clearAllAlerts}
            disabled={alertItems.length === 0}
          >
            알림 모두제거
          </button>
        </div>
        {alertItems.length === 0 ? (
          <div className="empty-card">
            현재 알림 기준에 맞는 뉴스가 없습니다.
          </div>
        ) : (
          <div className="alerts-list page-alerts-list">
            {alertItems.map((item) => (
              <button
                type="button"
                key={`alerts-page-${item.id}`}
                onClick={() => revealNewsOnHome(item)}
              >
                <strong>{item.title}</strong>
                <span>
                  {item.source} · {formatTime(item.publishedAt)} ·{" "}
                  {item.finalScore ?? item.importanceScore}/100
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  function MainContent() {
    if (feedMode === "stocks") return StocksView();
    if (feedMode === "aiStocks") return AiStocksView();
    if (feedMode === "scanner") return ScannerView();
    if (feedMode === "news")
      return NewsListSection({ title: "전체 뉴스", items: visibleNews });
    if (feedMode === "search") return SearchView();
    if (feedMode === "alerts") return AlertsView();
    if (feedMode === "settings") return SettingsView();
    return HomeView();
  }

  return (
    <main className="v7-shell">
      {fullRefreshVisible && (
        <div className="refresh-screen">
          <div>
            <span className="sync-loader">
              <Loader2 className="spin" size={30} />
            </span>
            <strong>{refreshMessage}</strong>
            <em>최신 뉴스와 관심 종목 흐름을 다시 정렬합니다.</em>
            <i />
          </div>
        </div>
      )}
      {DesktopSidebar()}
      <section className="content-canvas">
        <div
          className={
            mobileHeaderHidden ? "mobile-topbar is-hidden" : "mobile-topbar"
          }
        >
          <button
            type="button"
            onClick={() => {
              setMobileDrawerClosing(false);
              setMobileSearchOpen(true);
            }}
            aria-label="메뉴 열기"
          >
            <Menu size={20} />
          </button>
          <strong>SKIM</strong>
          <div className="mobile-topbar-actions">
            <button
              type="button"
              className="mobile-alert-btn press-motion"
              onClick={() => setAlertsOpen(true)}
              aria-label="알림 열기"
            >
              <Bell size={18} />
              <span>{alertNews.length}</span>
            </button>
            <button
              type="button"
              className="press-motion"
              onClick={() =>
                loadNews(true, feedMode === "stocks", watchlistRef.current)
              }
              aria-label="새로고침"
            >
              <RefreshCw size={19} />
            </button>
          </div>
        </div>
        {(pullDistance > 0 || pullRefreshing) && (
          <div
            className="pull-refresh-meter"
            style={
              {
                "--pull": `${Math.min(100, Math.round((pullDistance / 86) * 100))}%`,
              } as CSSProperties
            }
          >
            <Loader2 className={pullRefreshing ? "spin" : ""} size={18} />
            <span>
              {pullRefreshing
                ? "새로고침 중"
                : pullDistance >= 86
                  ? "놓으면 새로고침"
                  : "아래로 당겨 새로고침"}
            </span>
          </div>
        )}
        {MainContent()}
      </section>
      <button
        type="button"
        className="fixed-refresh-button press-motion"
        onClick={() =>
          loadNews(true, feedMode === "stocks", watchlistRef.current)
        }
        aria-label="뉴스 새로고침"
      >
        <RefreshCw size={21} />
      </button>
      {RightPanel()}

      <nav
        className={
          quickMenuVisible ? "mobile-bottom-nav" : "mobile-bottom-nav is-hidden"
        }
        aria-hidden={!quickMenuVisible}
      >
        <button
          className={feedMode === "home" ? "active" : ""}
          onClick={() => openMode("home")}
        >
          <Home size={19} />
          <span>홈</span>
        </button>
        <button
          className={feedMode === "stocks" ? "active" : ""}
          onClick={() => openMode("stocks")}
        >
          <ChartNoAxesCombined size={19} />
          <span>내 주식</span>
        </button>
        <button className="center-action" onClick={() => openMode("search")}>
          <Plus size={24} />
        </button>
        <button
          className={feedMode === "aiStocks" ? "active" : ""}
          onClick={() => openMode("aiStocks")}
        >
          <Sparkles size={19} />
          <span>AI 추천</span>
        </button>
        <button
          className={feedMode === "settings" ? "active" : ""}
          onClick={() => openMode("settings")}
        >
          <Settings size={19} />
          <span>설정</span>
        </button>
      </nav>

      {mobileSearchOpen && (
        <div
          className={
            mobileDrawerClosing
              ? "mobile-drawer-backdrop is-closing"
              : "mobile-drawer-backdrop"
          }
          onClick={closeMobileDrawer}
        >
          <aside
            className={
              mobileDrawerClosing ? "mobile-drawer is-closing" : "mobile-drawer"
            }
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="drawer-close"
              onClick={closeMobileDrawer}
            >
              <X size={17} />
            </button>
            {DesktopSidebar()}
          </aside>
        </div>
      )}

      {alertsOpen && AlertsModal()}

      {selectedNews && (
        <div className="detail-backdrop" onClick={() => setSelectedNews(null)}>
          <article
            className="news-detail-sheet premium-detail"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="drawer-close"
              onClick={() => setSelectedNews(null)}
            >
              <X size={17} />
            </button>
            <div className="detail-hero-row">
              <span className="label top">TOP</span>
              <span className="detail-source-pill">
                {selectedNews.source} · {formatTime(selectedNews.publishedAt)}
              </span>
            </div>
            <h1>{selectedNews.title}</h1>
            <div className="detail-visual-card">
              <div className="detail-image">
                <span>{selectedNews.source.slice(0, 1)}</span>
              </div>
              <div className="detail-score-card">
                <strong>{selectedNews.finalScore}</strong>
                <span>/100</span>
                <i
                  style={{
                    width: `${Math.max(8, Math.min(100, selectedNews.finalScore))}%`,
                  }}
                />
              </div>
            </div>
            <section className="detail-summary-card">
              <b>AI 요약</b>
              <p>{selectedNews.summary}</p>
            </section>
            <div className="detail-metrics premium">
              <span>
                <b>{selectedNews.importanceScore}</b>중요도
              </span>
              <span>
                <b>{selectedNews.reliabilityScore}</b>신뢰도
              </span>
              <span>
                <b>{selectedNews.freshnessScore}</b>최신성
              </span>
              <span>
                <b>{selectedNews.opinionScore}</b>의견성
              </span>
            </div>
            <a
              className="detail-primary-link"
              href={selectedNews.originalUrl}
              target="_blank"
              rel="noreferrer"
            >
              기사 원문 보기
            </a>
          </article>
        </div>
      )}
    </main>
  );
}
