export type NewsSentiment = 'positive' | 'negative' | 'neutral';

export type MarketRegion = 'korea' | 'us' | 'global' | 'unknown';

export type ContentType =
  | 'official_news'
  | 'market_report'
  | 'press_release'
  | 'blog_opinion'
  | 'community_post'
  | 'unknown';

export type MarketNews = {
  id: string;
  title: string;
  summary: string;
  source: string;
  originalUrl: string;
  publishedAt: string;
  importanceScore: number;
  reliabilityScore: number;
  opinionScore: number;
  freshnessScore: number;
  finalScore: number;
  contentType: ContentType;
  marketRegion: MarketRegion;
  marketRegionLabel: string;
  qualityLabel: string;
  sentiment: NewsSentiment;
  tags: string[];
  relatedStocks: string[];
  reason: string;
};

export type NewsApiResponse = {
  news: MarketNews[];
  generatedAt: string;
  sourceMode: 'live' | 'fallback';
  provider?: string;
  warnings?: string[];
  error?: string;
  latencyMs?: number;
  cacheHit?: boolean;
  stale?: boolean;
};
