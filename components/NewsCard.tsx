"use client";

import { useEffect, useState, type KeyboardEvent } from 'react';
import { Bookmark, Clock3, Newspaper, Star, TrendingDown, TrendingUp } from 'lucide-react';
import type { MarketNews } from '@/types/news';

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
  onOpenDetail?: (news: MarketNews) => void;
};

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function scoreClass(score: number) {
  if (score >= 88) return 'critical';
  if (score >= 75) return 'high';
  if (score >= 60) return 'watch';
  return 'normal';
}

function sentimentText(sentiment: MarketNews['sentiment']) {
  if (sentiment === 'positive') return '긍정';
  if (sentiment === 'negative') return '부정';
  return '중립';
}

function sourceLogoUrl(url: string) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=96`;
  } catch {
    return '';
  }
}

function getTagEntries(news: MarketNews) {
  const seen = new Set<string>();
  const entries: Array<{ item: string; type: 'stock' | 'theme' }> = [];

  for (const item of news.relatedStocks || []) {
    const value = item.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    entries.push({ item: value, type: 'stock' });
  }

  for (const item of news.tags || []) {
    const value = item.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    entries.push({ item: value, type: 'theme' });
  }

  return entries;
}

export default function NewsCard({
  news,
  threshold,
  isNew = false,
  watchSet,
  onToggleTheme,
  onToggleStock,
  compact = false,
  pinned = false,
  onTogglePin,
  onOpenDetail,
}: NewsCardProps) {
  const score = news.finalScore ?? news.importanceScore;
  const isHot = score >= threshold;
  const sourceInitial = (news.source || '뉴').trim().slice(0, 1).toUpperCase();
  const logoUrl = sourceLogoUrl(news.originalUrl);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [viewportTagLimit, setViewportTagLimit] = useState(compact ? 3 : 4);

  useEffect(() => {
    const syncTagLimit = () => {
      const width = window.innerWidth;
      if (width <= 420) {
        setViewportTagLimit(2);
        return;
      }
      if (width <= 860) {
        setViewportTagLimit(3);
        return;
      }
      setViewportTagLimit(compact ? 3 : 4);
    };

    syncTagLimit();
    window.addEventListener('resize', syncTagLimit);
    return () => window.removeEventListener('resize', syncTagLimit);
  }, [compact]);

  const tags = getTagEntries(news);
  const defaultTagLimit = viewportTagLimit;
  const visibleTags = tagsExpanded ? tags : tags.slice(0, defaultTagLimit);
  const hiddenTagCount = Math.max(0, tags.length - visibleTags.length);

  const openArticle = () => {
    if (news.originalUrl) window.open(news.originalUrl, '_blank', 'noopener,noreferrer');
  };

  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openArticle();
    }
  };

  return (
    <article
      id={`news-card-${news.id}`}
      className={`commerce-news-card ${scoreClass(score)} ${isHot ? 'is-hot' : ''} ${isNew ? 'is-new' : ''} ${compact ? 'is-compact' : ''}`}
      role="link"
      tabIndex={0}
      onClick={openArticle}
      onKeyDown={handleCardKeyDown}
      aria-label={`${news.title} 기사 열기`}
    >
      <div className="news-thumb-image" aria-hidden="true">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(event) => { event.currentTarget.style.display = 'none'; }}
          />
        ) : null}
        <span>{sourceInitial}</span>
      </div>

      <div className="news-actions-corner">
        <button
          type="button"
          className={pinned ? 'bookmark-btn active' : 'bookmark-btn'}
          onClick={(event) => { event.stopPropagation(); onTogglePin?.(); }}
          aria-label={pinned ? '북마크 해제' : '북마크'}
        >
          <Bookmark size={16} fill={pinned ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="news-body-block">
        <div className="news-card-head">
          <div className="news-labels">
            {isHot && <span className="label top">TOP</span>}
            <span className="label region">{news.marketRegionLabel || '시장'}</span>
            <span className="label quality"><Newspaper size={12} /> {news.qualityLabel || '출처'}</span>
            <span className={`label sentiment-badge ${news.sentiment}`}>
              {news.sentiment === 'negative' ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
              {sentimentText(news.sentiment)}
            </span>
          </div>
        </div>

        <div className="news-title-button">
          <h3>{news.title}</h3>
        </div>

        {!compact && <p className="news-summary-text">{news.summary}</p>}

        <div className="news-meta-line">
          <span>{news.source}</span>
          <span><Clock3 size={12} /> {formatTime(news.publishedAt)}</span>

        </div>

        <div className="commerce-tag-row">
          {visibleTags.map(({ item, type }, index) => {
            const isStock = type === 'stock';
            const watched = watchSet?.has(item);
            const onClick = isStock ? onToggleStock : onToggleTheme;
            return (
              <button
                type="button"
                className={watched ? 'commerce-tag watched' : 'commerce-tag'}
                key={`${news.id}-${type}-${item}-${index}`}
                onClick={(event) => { event.stopPropagation(); onClick?.(item); }}
              >
                {watched && <Star size={11} fill="currentColor" />}
                {isStock ? item : `#${item}`}
              </button>
            );
          })}
          {hiddenTagCount > 0 && (
            <button
              type="button"
              className="tag-more-toggle"
              onClick={(event) => { event.stopPropagation(); setTagsExpanded(true); }}
              aria-label={`${hiddenTagCount}개 태그 더보기`}
            >
              +{hiddenTagCount}
            </button>
          )}
          {tagsExpanded && tags.length > defaultTagLimit && (
            <button
              type="button"
              className="tag-more-toggle is-close"
              onClick={(event) => { event.stopPropagation(); setTagsExpanded(false); }}
              aria-label="태그 줄이기"
            >
              −
            </button>
          )}
        </div>
      </div>

      <div className="news-score-panel">
        <strong>{score}</strong>
        <span>/100</span>
        {!compact && <i style={{ width: `${Math.max(8, Math.min(100, score))}%` }} />}
      </div>


    </article>
  );
}
