export type StockCandidate = {
  name: string;
  code: string;
  market: 'KOSPI' | 'KOSDAQ' | 'KONEX' | 'NYSE' | 'NASDAQ' | 'AMEX' | 'UNKNOWN';
  sector: string;
  aliases: string[];
};

export function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()\[\].,·ㆍ\-_]/g, '')
    .trim();
}

export function isValidStockCandidate(stock: StockCandidate) {
  const name = stock.name.trim();
  if (name.length < 2 || name.length > 42) return false;
  if (/^\d+$/.test(name)) return false;
  if (/\d/.test(name) && /^[A-Z0-9]{1,3}$/.test(name)) return false;
  if (/^[A-Z]{1}$/.test(name)) return false;
  return Boolean(name);
}

function isHangulQuery(value: string) {
  return /[가-힣]/.test(value);
}

function exactStockHit(query: string, stock: StockCandidate) {
  const keyword = normalizeText(query);
  if (!keyword) return false;
  return normalizeText(stock.name) === keyword ||
    normalizeText(stock.code) === keyword ||
    stock.aliases.some((alias) => normalizeText(alias) === keyword);
}

function rankSearchToken(token: string, stockName: string, stockCode: string) {
  const normalized = normalizeText(token);
  if (normalizeText(stockName) === normalized) return 0;
  if (/[가-힣]/.test(token)) return 1;
  if (/^[A-Za-z][A-Za-z\s&.+-]{3,}$/.test(token)) return 2;
  if (normalized === normalizeText(stockCode)) return 9;
  if (/^\d{6}$/.test(token)) return 10;
  return 5;
}

export function getStockSearchTokens(stockName: string, universe: StockCandidate[] = []) {
  const normalized = normalizeText(stockName);
  const found = universe.find((stock) =>
    normalizeText(stock.name) === normalized ||
    normalizeText(stock.code) === normalized ||
    stock.aliases.some((alias) => normalizeText(alias) === normalized)
  );

  if (!found) return [stockName];
  return Array.from(new Set([found.name, ...found.aliases, found.code]))
    .filter(Boolean)
    .sort((a, b) => rankSearchToken(a, found.name, found.code) - rankSearchToken(b, found.name, found.code) || a.length - b.length);
}

export function expandStockKeywords(stocks: string[], universe: StockCandidate[] = []) {
  return Array.from(
    new Set(stocks.flatMap((stock) => getStockSearchTokens(stock, universe)).map((value) => value.trim()).filter(Boolean))
  );
}

function stockSearchFields(stock: StockCandidate) {
  const names = [stock.name, ...(stock.aliases || [])].filter(Boolean);
  const compactNames = names.map(normalizeText).filter(Boolean);
  const wordTokens = names.flatMap((value) =>
    value
      .toLowerCase()
      .split(/[^가-힣a-z0-9]+/i)
      .map((token) => token.trim())
      .filter(Boolean)
  );
  return {
    names,
    compactNames,
    wordTokens,
    code: normalizeText(stock.code)
  };
}

export function matchesStockQuery(query: string, stock: StockCandidate) {
  const rawKeyword = query.trim();
  const keyword = normalizeText(rawKeyword);
  if (!keyword) return false;

  const { compactNames, wordTokens, code } = stockSearchFields(stock);

  if (compactNames.some((value) => value === keyword) || code === keyword) return true;

  const hasHangul = /[가-힣]/.test(rawKeyword);
  const isNumeric = /^[0-9]+$/.test(rawKeyword);
  const isLatin = /^[A-Za-z\s]+$/.test(rawKeyword);

  if (hasHangul) {
    return compactNames.some((value) => value.includes(keyword));
  }

  if (isNumeric) {
    return code.startsWith(keyword) || (keyword.length >= 3 && code.includes(keyword));
  }

  if (isLatin) {
    // LS, DB, CJ처럼 짧은 영문 검색은 임의 포함 검색을 금지합니다.
    // 예: LS 검색 시 S-Oil, GKL S, DL S가 뜨면 안 되고, LS/LS ELECTRIC처럼
    // 단어 또는 compact 이름이 LS로 시작하는 종목만 보여야 합니다.
    if (keyword.length <= 2) {
      return compactNames.some((value) => value.startsWith(keyword)) ||
        wordTokens.some((token) => normalizeText(token).startsWith(keyword));
    }

    // LS E, LS ELE처럼 공백이 있는 검색은 compact startsWith를 우선합니다.
    if (/\s/.test(rawKeyword)) {
      return compactNames.some((value) => value.startsWith(keyword));
    }

    return compactNames.some((value) => value.startsWith(keyword) || value.includes(keyword)) ||
      wordTokens.some((token) => normalizeText(token).startsWith(keyword));
  }

  return compactNames.some((value) => value.includes(keyword));
}

export function findStockSuggestions(query: string, limit = 8, universe: StockCandidate[] = []) {
  const rawKeyword = query.trim();
  const keyword = normalizeText(rawKeyword);
  const candidates = universe.filter(isValidStockCandidate);

  if (!keyword) return [];

  const exactMatches = candidates.filter((stock) => exactStockHit(rawKeyword, stock));
  if (exactMatches.length > 0 && (keyword.length >= 3 || isHangulQuery(rawKeyword) || /^\d{6}$/.test(rawKeyword))) {
    return exactMatches
      .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name, 'ko'))
      .slice(0, Math.min(limit, 4));
  }

  return candidates
    .filter((stock) => matchesStockQuery(rawKeyword, stock))
    .map((stock) => {
      const { compactNames, wordTokens, code } = stockSearchFields(stock);
      const normalizedName = normalizeText(stock.name);
      let score = 0;

      if (normalizedName === keyword) score += 1200;
      if (code === keyword) score += 1100;
      if (compactNames.some((value) => value === keyword)) score += 1050;

      if (normalizedName.startsWith(keyword)) score += 920;
      if (compactNames.some((value) => value.startsWith(keyword))) score += 860;
      if (wordTokens.some((token) => normalizeText(token).startsWith(keyword))) score += 760;
      if (/^[0-9]/.test(keyword) && code.startsWith(keyword)) score += 700;

      if (keyword.length >= 3) {
        if (normalizedName.includes(keyword)) score += 420;
        if (compactNames.some((value) => value.includes(keyword))) score += 360;
        if (/^[0-9]{3,}$/.test(keyword) && code.includes(keyword)) score += 180;
      }

      if (isHangulQuery(rawKeyword) && /[가-힣]/.test(stock.name)) score += 80;
      if (/^[A-Za-z\s]{2,}$/.test(rawKeyword) && /^[A-Za-z]/.test(stock.name)) score += 40;
      if (/^[A-Za-z]{2}$/.test(rawKeyword) && normalizeText(stock.name) === keyword) score += 140;

      score -= Math.max(0, stock.name.length - 20) * 0.8;

      return { stock, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.stock.name.length - b.stock.name.length || a.stock.name.localeCompare(b.stock.name, 'ko'))
    .slice(0, limit)
    .map((item) => item.stock);
}
