import type { ContentType, MarketNews, NewsSentiment, MarketRegion } from '@/types/news';
import { expandStockKeywords } from '@/lib/stockUniverse';

export const impactKeywords = [
  '금리', 'FOMC', 'CPI', 'PCE', '환율', '달러', '엔화', '연준', 'Fed', 'BOJ',
  '전쟁', '휴전', '관세', '제재', '유가', '인플레이션', '국채', '수익률',
  '실적', '가이던스', '어닝', '수주', '공급계약', '공시', '합병', '인수',
  'AI', 'HBM', '반도체', 'NVIDIA', '엔비디아', '데이터센터', '전력', '원전',
  '방산', '조선', 'LNG', '구리', 'tariff', 'inflation', 'earnings', 'guidance',
  'semiconductor', 'oil', 'rates', 'treasury', 'contract', 'supply'
];

const koreaKeywords = [
  '한국', '국내', '코스피', '코스닥', '원화', '원/달러', '원·달러', '한은', '한국은행', '금융위원회', '금감원',
  'KOSPI', 'KOSDAQ', 'South Korea', 'Korea stocks', 'KRW'
];

const usKeywords = [
  '미국', '뉴욕증시', '나스닥', '다우', 'S&P500', 'S&P 500', '월가', '연준', 'Fed', 'FOMC', 'CPI', 'PCE',
  '미 국채', '국채금리', '달러', '미 증시', 'US stocks', 'Wall Street', 'Treasury'
];

const globalKeywords = [
  '중국', '일본', '유럽', 'ECB', 'BOJ', '중동', '유가', 'OPEC', '환율', '글로벌', '세계', '수출', '관세', '전쟁',
  'China', 'Japan', 'Europe', 'global', 'oil', 'tariff', 'war'
];

const trustedSources = [
  '연합뉴스', '뉴스1', '한국경제', '매일경제', '서울경제', '머니투데이', '아시아경제', '이데일리',
  '조선비즈', 'Chosunbiz', '파이낸셜뉴스', '헤럴드경제', '디지털타임스', '전자신문', 'ZDNet Korea',
  '연합인포맥스', 'Investing.com', 'Reuters', 'Bloomberg', 'CNBC', 'MarketWatch'
];

const reportSources = ['증권', '리서치', '인포맥스', 'Investing', 'TradingView', 'TradingKey'];
const weakSources = ['브런치', '티스토리', '네이버 블로그', '블로그', '카페', '프리미엄콘텐츠', '뉴닉', '데일리바이트'];
const communitySources = ['디시', '에펨코리아', '뽐뿌', '클리앙', 'reddit', 'x.com', 'twitter'];

const opinionKeywords = [
  '전망', '관련주', '수혜주', '대장주', '추천', '매수', '매도', '급등', '상한가', '대박', '세력', '작전',
  '날아오를까', '오를까', '제 생각', '개인적인 생각', '정리해보면', '투자 아이디어', '주가 1편', '주가 2편'
];

const stopWords = new Set([
  '뉴스', '기사', '관련', '시장', '주식', '투자', '오늘', '전망', '종목', '경제', '한국', '미국', '기자', '제공', '사진',
  '단독', '속보', '종합', '오전', '오후', '지난', '올해', '내년', '이번', '최근', '증시', '코스피', '코스닥'
]);

function includesAny(text: string, words: string[]) {
  const normalized = text.toLowerCase();
  return words.some((word) => normalized.includes(word.toLowerCase()));
}

function clamp(score: number) {
  return Math.max(1, Math.min(100, Math.round(score)));
}

function normalizeTag(raw: string) {
  return raw
    .replace(/^#/, '')
    .replace(/["'“”‘’()[\]{}.,:;!?]/g, '')
    .trim();
}

export function extractTags(title: string, summary = '') {
  const text = `${title} ${summary}`;
  const candidates = new Map<string, number>();

  const add = (raw: string, weight = 1) => {
    const value = normalizeTag(raw);
    if (!value || value.length < 2 || value.length > 18) return;
    if (/^\d+$/.test(value)) return;
    if (stopWords.has(value)) return;
    candidates.set(value, (candidates.get(value) || 0) + weight);
  };

  for (const keyword of impactKeywords) {
    if (includesAny(text, [keyword])) add(keyword, 8);
  }

  const tokens = text.match(/[가-힣A-Za-z0-9+]{2,18}/g) || [];
  for (const token of tokens) {
    if (/[가-힣]/.test(token) || /^[A-Z0-9]{2,8}$/.test(token)) add(token, 1);
  }

  return Array.from(candidates.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
    .slice(0, 6)
    .map(([tag]) => tag);
}

export function extractRelatedStocks(title: string, summary = '', watchlist: string[] = []) {
  const text = `${title} ${summary}`.toLowerCase();
  const matched = new Set<string>();

  // 종목 후보는 앱 내부 하드코딩이 아니라 사용자가 선택한 관심 종목과
  // /api/stocks에서 확장된 별칭 키워드만 사용합니다.
  expandStockKeywords(watchlist).forEach((token) => {
    if (token && text.includes(token.toLowerCase())) matched.add(token);
  });

  return Array.from(matched).slice(0, 5);
}

export function inferSentiment(title: string, summary = ''): NewsSentiment {
  const text = `${title} ${summary}`;
  if (/급락|하락|쇼크|우려|감소|손실|적자|리스크|부진|fall|drop|loss|risk|concern|weak/i.test(text)) return 'negative';
  if (/급등|상승|호조|증가|수주|계약|흑자|강세|beat|gain|surge|strong|record/i.test(text)) return 'positive';
  return 'neutral';
}

export function calculateImportance(title: string, summary = '', watchlist: string[] = []) {
  const text = `${title} ${summary}`;
  const upper = text.toUpperCase();
  let score = 34;
  let hits = 0;

  impactKeywords.forEach((keyword) => {
    if (upper.includes(keyword.toUpperCase())) {
      score += 6;
      hits += 1;
    }
  });

  expandStockKeywords(watchlist).forEach((keyword) => {
    if (keyword && upper.includes(keyword.toUpperCase())) score += 11;
  });

  if (/속보|긴급|breaking|exclusive/i.test(text)) score += 13;
  if (/공시|계약|수주|실적|guidance|earnings|contract|deal/i.test(text)) score += 9;
  if (hits >= 3) score += 7;

  return clamp(score);
}

export function calculateFreshness(publishedAt?: string) {
  const time = publishedAt ? new Date(publishedAt).getTime() : Date.now();
  const diffHours = Math.max(0, (Date.now() - time) / (1000 * 60 * 60));
  if (diffHours <= 1) return 100;
  if (diffHours <= 3) return 90;
  if (diffHours <= 8) return 78;
  if (diffHours <= 24) return 64;
  if (diffHours <= 72) return 45;
  if (diffHours <= 24 * 14) return 25;
  return 10;
}

export function analyzeContentQuality(source: string, title: string, summary = '', url = '') {
  const sourceText = `${source} ${url}`.toLowerCase();
  const bodyText = `${title} ${summary}`;
  let reliabilityScore = 58;
  let opinionScore = 18;
  let contentType: ContentType = 'unknown';

  if (trustedSources.some((item) => sourceText.includes(item.toLowerCase()))) {
    reliabilityScore += 28;
    opinionScore -= 8;
    contentType = 'official_news';
  }

  if (reportSources.some((item) => sourceText.includes(item.toLowerCase()) || bodyText.includes(item))) {
    reliabilityScore += 16;
    contentType = contentType === 'official_news' ? 'official_news' : 'market_report';
  }

  if (/공시|IR|보도자료|press release/i.test(bodyText)) {
    reliabilityScore += 12;
    contentType = 'press_release';
  }

  if (weakSources.some((item) => sourceText.includes(item.toLowerCase()) || bodyText.includes(item))) {
    reliabilityScore -= 28;
    opinionScore += 38;
    contentType = 'blog_opinion';
  }

  if (communitySources.some((item) => sourceText.includes(item.toLowerCase()))) {
    reliabilityScore -= 32;
    opinionScore += 45;
    contentType = 'community_post';
  }

  opinionKeywords.forEach((keyword) => {
    if (bodyText.toLowerCase().includes(keyword.toLowerCase())) {
      opinionScore += 8;
      reliabilityScore -= 3;
    }
  });

  const safeReliability = clamp(reliabilityScore);
  const safeOpinion = clamp(opinionScore);

  return {
    reliabilityScore: safeReliability,
    opinionScore: safeOpinion,
    contentType,
    qualityLabel: contentType === 'official_news' ? '공식뉴스' :
      contentType === 'market_report' ? '시장리포트' :
      contentType === 'press_release' ? '기업발표' :
      contentType === 'blog_opinion' ? '참고의견' :
      contentType === 'community_post' ? '커뮤니티' : '분류중'
  };
}

export function inferMarketRegion(title: string, summary = '', source = '', url = ''): { marketRegion: MarketRegion; marketRegionLabel: string } {
  const text = `${title} ${summary} ${source} ${url}`;
  const koreaScore = koreaKeywords.filter((keyword) => includesAny(text, [keyword])).length;
  const usScore = usKeywords.filter((keyword) => includesAny(text, [keyword])).length;
  const globalScore = globalKeywords.filter((keyword) => includesAny(text, [keyword])).length;

  if (usScore > koreaScore && usScore >= globalScore) return { marketRegion: 'us', marketRegionLabel: '미국경제' };
  if (koreaScore >= usScore && koreaScore >= globalScore && koreaScore > 0) return { marketRegion: 'korea', marketRegionLabel: '한국경제' };
  if (globalScore > 0) return { marketRegion: 'global', marketRegionLabel: '글로벌' };
  return { marketRegion: 'global', marketRegionLabel: '글로벌' };
}

export function calculateFinalScore(importance: number, reliability: number, freshness: number, opinion: number) {
  return clamp(importance * 0.45 + reliability * 0.3 + freshness * 0.2 - opinion * 0.25 + 15);
}

export function buildReason(news: Pick<MarketNews, 'importanceScore' | 'reliabilityScore' | 'opinionScore' | 'tags' | 'relatedStocks'>) {
  if (news.relatedStocks.length > 0) return '관심 종목 또는 관련 종목이 포함되어 우선순위를 높였습니다.';
  if (news.importanceScore >= 86 && news.reliabilityScore >= 70) return '시장 영향 키워드와 신뢰도 높은 출처가 겹쳐 핵심 뉴스로 분류했습니다.';
  if (news.opinionScore >= 60) return '개인 의견성이 높아 참고용으로 분류했습니다.';
  if (news.tags.length > 0) return `${news.tags.slice(0, 2).join(', ')} 테마와 연결되어 중요도를 부여했습니다.`;
  return '제목, 출처, 최신성 기준으로 분류했습니다.';
}

export function sortNews(news: MarketNews[]) {
  return news.slice().sort((a, b) => b.finalScore - a.finalScore || new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}
