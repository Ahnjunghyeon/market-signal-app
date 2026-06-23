import type { CSSProperties } from 'react';
import { ArrowUpRight, BadgeCheck, Clock3, Flame, Globe2, Minus, Newspaper, Pin, ShieldAlert, Star, TrendingDown, TrendingUp, UserRoundPen, Zap } from 'lucide-react';
import type { MarketNews } from '@/types/news';

function sentimentIcon(sentiment: MarketNews['sentiment']) {
  if (sentiment === 'positive') return <TrendingUp size={15} />;
  if (sentiment === 'negative') return <TrendingDown size={15} />;
  return <Minus size={15} />;
}

function qualityIcon(type: MarketNews['contentType']) {
  if (type === 'blog_opinion' || type === 'community_post') return <UserRoundPen size={14} />;
  if (type === 'official_news' || type === 'press_release') return <BadgeCheck size={14} />;
  return <Newspaper size={14} />;
}

function scoreTier(score: number) {
  if (score >= 88) return 'critical';
  if (score >= 75) return 'high';
  if (score >= 60) return 'watch';
  return 'normal';
}

function scoreLabel(score: number) {
  if (score >= 88) return '긴급';
  if (score >= 75) return '중요';
  if (score >= 60) return '관찰';
  return '보통';
}

function metricTier(value: number, inverse = false) {
  const score = inverse ? 100 - value : value;
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'strong';
  if (score >= 50) return 'medium';
  return 'low';
}

function metricLabel(value: number, inverse = false) {
  const score = inverse ? 100 - value : value;
  if (score >= 85) return '매우 높음';
  if (score >= 70) return '높음';
  if (score >= 50) return '보통';
  return '낮음';
}

function MetricGauge({ label, value, inverse = false }: { label: string; value: number; inverse?: boolean }) {
  const safeValue = Math.max(0, Math.min(100, value));
  const tier = metricTier(safeValue, inverse);
  const ariaText = `${label} ${safeValue}점, ${metricLabel(safeValue, inverse)}`;

  return (
    <span className={`metric-gauge metric-${tier} ${inverse ? 'inverse' : ''}`} aria-label={ariaText}>
      <span className="metric-head">
        <em>{label}</em>
        <b>{safeValue}</b>
      </span>
      <span className="metric-track">
        <i style={{ width: `${Math.max(4, safeValue)}%` }} />
      </span>
    </span>
  );
}

type NewsCardProps = {
  news: MarketNews;
  threshold: number;
  isNew?: boolean;
  watchSet?: Set<string>;
  onToggleTheme?: (tag: string) => void;
  onToggleStock?: (stock: string) => void;
  compact?: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;
};

export default function NewsCard({ news, threshold, isNew = false, watchSet, onToggleTheme, onToggleStock, compact = false, pinned = false, onTogglePin }: NewsCardProps) {
  const displayScore = news.finalScore ?? news.importanceScore;
  const tier = scoreTier(displayScore);
  const hot = displayScore >= threshold;
  const opinion = news.contentType === 'blog_opinion' || news.contentType === 'community_post';
  const time = new Date(news.publishedAt).toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

  return (
    <article className={`news-card score-${tier} ${hot ? 'hot-card' : ''} ${opinion ? 'opinion-card' : ''} ${isNew ? 'new-entry' : ''} ${compact ? 'compact-card' : ''} ${pinned ? 'user-pinned' : ''}`}>
      <div className="news-accent" />
      <div className="news-main">
        <button type="button" className={pinned ? 'pin-card-btn active' : 'pin-card-btn'} onClick={onTogglePin} aria-label={pinned ? '상단 고정 해제' : '중요 뉴스 상단 고정'}><Pin size={14} /> {pinned ? '고정됨' : '고정'}</button>
        <div className="news-topline">
          <div className="pill-group">
            <span className={hot ? 'signal-pill hot' : 'signal-pill'}>
              {hot ? <Flame size={14} /> : <Zap size={14} />}
              {hot ? 'HIGH SIGNAL' : 'MARKET SIGNAL'}
            </span>
            <span className={`quality-pill region ${news.marketRegion || 'unknown'}`}>
              <Globe2 size={14} /> {news.marketRegionLabel || '지역확인'}
            </span>
            <span className={`quality-pill ${opinion ? 'opinion' : 'trusted'}`}>
              {qualityIcon(news.contentType)} {news.qualityLabel || '출처확인'}
            </span>
          </div>
          <span className="time-chip"><Clock3 size={13} /> {time}</span>
        </div>

        <div className="news-title-row">
          <div className="title-stack">
            <div className={`impact-strip score-${tier}`}>
              <span className="impact-label"><ShieldAlert size={14} /> {scoreLabel(displayScore)} 시그널</span>
              <span className="impact-bar"><i style={{ width: `${Math.max(8, Math.min(100, displayScore))}%` }} /></span>
            </div>
            <h2 className="news-title">{news.title}</h2>
          </div>
          <div className={`score-meter score-${tier}`} aria-label={`최종점수 ${displayScore}`}>
            <div className="score-meter-inner">
              <strong>{displayScore}</strong>
            </div>
          </div>
        </div>

        {!compact && <p className="summary">{news.summary}</p>}
        {!compact && <p className="reason">{news.reason}</p>}

        {compact && <div className="compact-signal-strip" aria-label="간략 지표">
          <span className="compact-metric importance" style={{ "--metric": `${Math.max(0, Math.min(100, news.importanceScore))}%` } as CSSProperties}><em>중요</em><b>{news.importanceScore}</b></span>
          <span className="compact-metric reliability" style={{ "--metric": `${Math.max(0, Math.min(100, news.reliabilityScore))}%` } as CSSProperties}><em>신뢰</em><b>{news.reliabilityScore}</b></span>
          <span className="compact-metric freshness" style={{ "--metric": `${Math.max(0, Math.min(100, news.freshnessScore))}%` } as CSSProperties}><em>최신</em><b>{news.freshnessScore}</b></span>
          <span className="compact-metric opinion" style={{ "--metric": `${Math.max(0, Math.min(100, news.opinionScore))}%` } as CSSProperties}><em>의견</em><b>{news.opinionScore}</b></span>
        </div>}

        {!compact && <div className="score-grid score-breakdown metric-grid">
          <MetricGauge label="중요도" value={news.importanceScore} />
          <MetricGauge label="신뢰도" value={news.reliabilityScore} />
          <MetricGauge label="최신성" value={news.freshnessScore} />
          <MetricGauge label="의견성" value={news.opinionScore} inverse />
        </div>}

        <div className="tags interactive-tags">
          {news.tags.map((tag) => {
            const watched = watchSet?.has(tag);
            return (
              <button
                type="button"
                className={watched ? 'tag tag-button watched' : 'tag tag-button'}
                key={tag}
                onClick={() => onToggleTheme?.(tag)}
                title={watched ? '관심 테마 해제' : '관심 테마 추가'}
              >
                {watched && <Star size={12} fill="currentColor" />} #{tag}
              </button>
            );
          })}
          {news.relatedStocks.map((stock) => {
            const watched = watchSet?.has(stock);
            return (
              <button
                type="button"
                className={watched ? 'tag stock tag-button watched' : 'tag stock tag-button'}
                key={stock}
                onClick={() => onToggleStock?.(stock)}
                title={watched ? '관심 종목 해제' : '관심 종목 추가'}
              >
                {watched && <Star size={12} fill="currentColor" />} {stock}
              </button>
            );
          })}
          <span className={`sentiment ${news.sentiment}`}>{sentimentIcon(news.sentiment)} {news.sentiment}</span>
        </div>

        <div className="meta">
          <span>{news.source}</span>
          <a className="read-link" href={news.originalUrl} target="_blank" rel="noreferrer">
            기사 보기 <ArrowUpRight size={15} />
          </a>
        </div>
      </div>
    </article>
  );
}
