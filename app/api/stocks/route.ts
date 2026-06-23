import { NextResponse } from 'next/server';
import AdmZip from 'adm-zip';
import iconv from 'iconv-lite';
import { findStockSuggestions, type StockCandidate } from '@/lib/stockUniverse';

export const dynamic = 'force-dynamic';

type StockApiResponse = {
  stocks: StockCandidate[];
  generatedAt: string;
  sourceMode: 'kis-master' | 'unavailable';
  cacheHit?: boolean;
  error?: string;
};

const CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const MIN_KIS_STOCK_COUNT = 300;
let memoryCache: { expiresAt: number; payload: StockApiResponse } | null = null;

const MASTER_SOURCES = [
  { market: 'KOSPI' as const, url: 'https://new.real.download.dws.co.kr/common/master/kospi_code.mst.zip' },
  { market: 'KOSDAQ' as const, url: 'https://new.real.download.dws.co.kr/common/master/kosdaq_code.mst.zip' }
];

function withTimeout<T>(promise: Promise<T>, ms: number, label: string) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout`)), ms))
  ]);
}

function inferSector(name: string) {
  if (/반도체|ips|하이닉스|전자|테크|소부장|솔루션|qnc|머트리얼즈/i.test(name)) return '반도체/IT';
  if (/전력|전기|electric|전선|에너지|파워|중공업|산전/i.test(name)) return '전력/에너지';
  if (/조선|중공업|해양|마린|선박/i.test(name)) return '조선/해양';
  if (/차|모빌리티|모비스|auto|motor|기아/i.test(name)) return '자동차/모빌리티';
  if (/바이오|제약|헬스|메디/i.test(name)) return '바이오/헬스케어';
  if (/금융|은행|증권|보험|카드/i.test(name)) return '금융';
  return '국내주식';
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}


function normalizeForSearch(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()\[\].,·ㆍ\-_]/g, '')
    .trim();
}

function looksLikeMetaToken(value: string) {
  const text = value.trim();
  if (!text) return true;
  if (/^(KOSPI|KOSDAQ|KONEX|KRX|ETF|ETN|ELW|ST|보통주|우선주)$/i.test(text)) return true;
  if (/^KR[0-9A-Z]{10}/i.test(text)) return true;
  if (/^KYG[0-9A-Z]{9}/i.test(text)) return true;
  if (/^\d{6,12}$/.test(text)) return true;
  if (/^[A-Z0-9]{1,2}$/.test(text) && !['LS','DB','CJ','HL'].includes(text)) return true;
  return false;
}

function collapseInternalNameSpaces(value: string) {
  // KIS MST의 영문 종목명은 고정폭 필드 안에서 LS        ELECTRIC처럼
  // 단어 사이 공백이 과도하게 들어오는 경우가 있습니다.
  // 기존처럼 두 칸 이상 공백 뒤를 잘라버리면 LS ELECTRIC이 LS로 축약됩니다.
  return value.replace(/\s+/g, ' ').trim();
}

function cleanAlias(value: string) {
  return collapseInternalNameSpaces(cleanStockName(value));
}

function isPlausibleAlias(value: string) {
  const text = cleanAlias(value);
  if (looksLikeMetaToken(text)) return false;
  if (text.length < 2 || text.length > 42) return false;
  if (/^KR[0-9A-Z]/i.test(text)) return false;
  if (/^[A-Z0-9]{1,2}$/.test(text) && !['LS','DB','CJ','HL'].includes(text)) return false;
  return /[가-힣A-Za-z]/.test(text);
}

function extractAliasesFromLine(line: string, code: string, name: string) {
  const normalized = line.replace(/\0/g, ' ');
  const aliases: string[] = [];

  // KIS MST 안에는 단축명과 긴 영문명/한글명이 함께 들어있는 경우가 있어,
  // 전체 라인에서 그럴듯한 명칭 토큰을 보조 alias로 수집합니다.
  const textAfterCode = normalized
    .replace(/^\s*\d{6}/, ' ')
    .replace(/KR[0-9A-Z]{10}/gi, ' ')
    .replace(/KYG[0-9A-Z]{9}/gi, ' ')
    .replace(new RegExp(code, 'g'), ' ')
    .replace(/[\t\r\n]+/g, ' ');

  const englishMatches = textAfterCode.match(/[A-Za-z][A-Za-z0-9&.+\-/ ]{1,40}/g) || [];
  const koreanMatches = textAfterCode.match(/[가-힣][가-힣A-Za-z0-9&.+\-/ ]{1,40}/g) || [];
  aliases.push(...englishMatches, ...koreanMatches);

  return unique(aliases.map(cleanAlias).filter((alias) => {
    if (!isPlausibleAlias(alias)) return false;
    const normalizedAlias = normalizeForSearch(alias);
    const normalizedName = normalizeForSearch(name);
    if (!normalizedAlias || normalizedAlias === normalizedName) return false;
    // 너무 넓은 메타 토큰은 제거하되, LS ELECTRIC처럼 단축명 확장 alias는 허용합니다.
    if (normalizedName.length >= 2 && (normalizedAlias.startsWith(normalizedName) || normalizedAlias.includes(normalizedName))) return true;
    if (normalizedAlias.includes(normalizeForSearch(code))) return false;
    return /[가-힣]/.test(alias) && alias.length <= 20;
  }));
}

function chooseDisplayName(name: string, aliases: string[]) {
  const clean = cleanStockName(name);
  const normalizedName = normalizeForSearch(clean);
  if (!normalizedName) return clean;

  // 예: KIS 단축명이 LS로 잡혔지만 alias에 LS ELECTRIC이 있으면 더 설명적인 이름을 노출합니다.
  if (/^[A-Za-z]{2,4}$/.test(clean)) {
    const better = aliases
      .filter((alias) => /^[A-Za-z][A-Za-z0-9&.+\-/ ]{3,40}$/.test(alias))
      .filter((alias) => normalizeForSearch(alias).startsWith(normalizedName) && normalizeForSearch(alias).length > normalizedName.length)
      .sort((a, b) => a.length - b.length)[0];
    if (better) return better;
  }

  return clean;
}

function buildDynamicAliases(name: string, code: string) {
  const compact = name.replace(/\s+/g, '');
  const candidates = [
    code,
    compact,
    `${name}(${code})`,
    `${compact}(${code})`
  ];

  // 수동 종목 사전이 아니라, 영문/한글 표기 차이를 일반 규칙으로만 확장합니다.
  const genericPairs: Array<[RegExp, string]> = [
    [/ELECTRIC/gi, '일렉트릭'],
    [/ELECTRIC/gi, '전기'],
    [/ELECTRIC/gi, '산전'],
    [/HOLDINGS/gi, '홀딩스'],
    [/MATERIALS/gi, '머트리얼즈'],
    [/QNC/gi, '큐엔씨'],
    [/IPS/gi, '아이피에스'],
    [/BIOLOGICS/gi, '바이오로직스'],
    [/MOBIS/gi, '모비스'],
    [/MOTOR/gi, '모터'],
    [/HEAVY\s*INDUSTRIES/gi, '중공업'],
    [/MARINE/gi, '마린'],
    [/SOLUTION(S)?/gi, '솔루션'],
    [/ENERGY/gi, '에너지']
  ];

  for (const [pattern, replacement] of genericPairs) {
    const converted = name.replace(pattern, replacement).replace(/\s+/g, ' ').trim();
    const convertedCompact = converted.replace(/\s+/g, '');
    if (converted && converted !== name) candidates.push(converted);
    if (convertedCompact && convertedCompact !== compact) candidates.push(convertedCompact);
  }

  return unique(candidates).filter((alias) => alias !== name);
}

function stripLeadingIdentifiers(value: string) {
  let text = value
    .replace(/\0/g, ' ')
    .replace(/^\s+/, '');

  // ISIN, 단축코드, 레코드 앞부분의 숫자/식별자를 최대한 제거합니다.
  for (let i = 0; i < 4; i += 1) {
    const before = text;
    text = text
      .replace(/^KR[0-9A-Z]{10}/i, '')
      .replace(/^KYG[0-9A-Z]{9}/i, '')
      .replace(/^[A-Z]{1,2}\d{6}/, '')
      .replace(/^\d{6,12}(?=[가-힣A-Za-z])/, '')
      .replace(/^[^가-힣A-Za-z]+/, '')
      .trimStart();
    if (text === before) break;
  }

  return text;
}

function cleanStockName(raw: string) {
  const stripped = stripLeadingIdentifiers(raw)
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // ISIN/표준코드가 종목명 앞에 붙어버린 경우를 한 번 더 방어합니다.
  const withoutPrefix = stripped
    .replace(/^KR[0-9A-Z]{10}(?=[가-힣A-Za-z])/i, '')
    .replace(/^KYG[0-9A-Z]{9}(?=[가-힣A-Za-z])/i, '')
    .replace(/^\d{6,12}(?=[가-힣A-Za-z])/, '')
    .trim();

  // 이름 뒤에 붙은 지나치게 긴 숫자/메타 필드 제거
  // 기존 정규식은 "LS ELECTRIC"의 ELECTRIC을 메타 필드로 오인해
  // 종목명을 "LS"로 잘라버렸습니다. 실제 종목명에는 영문 대문자 단어가
  // 포함될 수 있으므로, 숫자/ISIN/코드성 토큰이 따라올 때만 제거합니다.
  return withoutPrefix
    .replace(/\s+(?:KR[0-9A-Z]{10}|KYG[0-9A-Z]{9}|[0-9]{6,12})(?:\s+.*)?$/i, '')
    .replace(/\s+[A-Z]{2,}\d[A-Z0-9]{3,}.*$/, '')
    .trim();
}


function extractFixedWidthFields(line: string) {
  const normalized = line.replace(/\0/g, ' ');
  const first9 = normalized.slice(0, 9).trim();
  const first6 = normalized.slice(0, 6).trim();
  const code = /^\d{6}$/.test(first6) ? first6 : first9.replace(/[^0-9]/g, '').slice(-6);

  const nameCandidates = [
    normalized.slice(21, 61),
    normalized.slice(22, 62),
    normalized.slice(18, 58),
    normalized.slice(9, 49),
    normalized.slice(21, 81),
    normalized.slice(18, 78)
  ]
    .map((value) => cleanStockName(value))
    .filter((value) => isPlausibleStockName(value));

  const name = nameCandidates
    .sort((a, b) => {
      const aKorean = /[가-힣]/.test(a) ? 1 : 0;
      const bKorean = /[가-힣]/.test(b) ? 1 : 0;
      return bKorean - aKorean || a.length - b.length;
    })[0] || '';

  return { code: /^\d{6}$/.test(code) ? code : '', name };
}

function isPlausibleStockName(name: string) {
  const clean = cleanStockName(name);
  if (clean.length < 2 || clean.length > 42) return false;
  if (/^\d+$/.test(clean)) return false;
  if (/\d/.test(clean) && /^[A-Z0-9]{1,4}$/.test(clean)) return false; // 1D, 1F 같은 오파싱 방어
  if (/^KR[0-9A-Z]/i.test(clean)) return false;
  if (/스팩|기업인수목적|관리종목|투자주의|주권/i.test(clean)) return false;
  if (/^[A-Z]{1}$/.test(clean)) return false;
  // LS처럼 실제 영문 종목명은 허용하되, 숫자가 섞인 짧은 토큰은 배제합니다.
  if (/^[A-Z]{2,8}$/.test(clean)) return true;
  return /[가-힣A-Za-z]/.test(clean);
}

function candidateScoreForName(value: string) {
  const name = cleanStockName(value);
  if (!isPlausibleStockName(name)) return -1;
  let score = 0;
  if (/[가-힣]/.test(name)) score += 20;
  if (/[A-Za-z]/.test(name)) score += 8;
  if (/^[A-Z]{2,8}$/.test(name)) score += 5;
  if (/^KR/i.test(value)) score -= 10;
  if (/\d{6}/.test(name)) score -= 12;
  score -= Math.max(0, name.length - 24) * 0.2;
  return score;
}

function extractNameCandidate(line: string, code: string) {
  const normalizedLine = line.replace(/\0/g, ' ');
  const candidates: string[] = [];

  // KIS MST는 대체로 단축코드(6) + 표준코드(12) + 종목명 형태가 많습니다.
  const codeIndex = normalizedLine.indexOf(code);
  if (codeIndex >= 0) {
    candidates.push(normalizedLine.slice(codeIndex + code.length, codeIndex + code.length + 70));
    candidates.push(normalizedLine.slice(codeIndex + code.length + 12, codeIndex + code.length + 12 + 70));
  }

  const isinMatch = normalizedLine.match(/KR[0-9A-Z]{10}/i);
  if (isinMatch?.index !== undefined) {
    candidates.push(normalizedLine.slice(isinMatch.index + isinMatch[0].length, isinMatch.index + isinMatch[0].length + 70));
  }

  // 자주 쓰이는 고정폭 위치 후보도 함께 검사합니다.
  candidates.push(
    normalizedLine.slice(18, 70),
    normalizedLine.slice(21, 73),
    normalizedLine.slice(12, 64),
    normalizedLine.slice(9, 61),
    normalizedLine
  );

  // 정규식으로도 이름 후보를 분리합니다.
  const regexMatches = normalizedLine.match(/(?:KR[0-9A-Z]{10})?(?:\d{6})?\s*[가-힣A-Za-z][가-힣A-Za-z0-9&.()+\-\s]{1,44}/g) || [];
  candidates.push(...regexMatches);

  let best = '';
  let bestScore = -1;
  for (const candidate of candidates) {
    const name = cleanStockName(candidate);
    const score = candidateScoreForName(candidate);
    if (score > bestScore) {
      best = name;
      bestScore = score;
    }
  }

  return bestScore >= 0 ? best : '';
}

function extractOfficialKisRow(line: string, market: 'KOSPI' | 'KOSDAQ') {
  // 한국투자증권 공식 샘플의 구조를 따릅니다.
  // part1 = row[0:len(row)-228]
  // 단축코드 = part1[0:9], 표준코드 = part1[9:21], 종목명 = part1[21:].
  const row = line.replace(/\0/g, ' ');
  if (row.length < 40) return null;

  const part1 = row.length > 228 ? row.slice(0, row.length - 228) : row;
  const shortCodeRaw = part1.slice(0, 9).trim();
  const standardCode = part1.slice(9, 21).trim();
  const rawName = part1.slice(21).trim();

  const shortCodeDigits = shortCodeRaw.replace(/[^0-9]/g, '');
  const standardDigits = standardCode.replace(/[^0-9]/g, '');
  const code = shortCodeDigits.length >= 6
    ? shortCodeDigits.slice(-6)
    : standardDigits.slice(-6);

  const name = cleanStockName(rawName);
  if (!/^\d{6}$/.test(code) || !isPlausibleStockName(name)) return null;

  return { code, name, standardCode, market };
}

function parseMasterText(text: string, market: 'KOSPI' | 'KOSDAQ') {
  const result: StockCandidate[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.length < 40) continue;

    const official = extractOfficialKisRow(line, market);
    if (!official || seen.has(official.code)) continue;

    const { code, name } = official;
    const lineAliases = extractAliasesFromLine(line, code, name);
    const displayName = chooseDisplayName(name, lineAliases);
    const aliases = unique([
      name,
      ...lineAliases,
      ...buildDynamicAliases(displayName, code),
      ...buildDynamicAliases(name, code)
    ]).filter((alias) => normalizeForSearch(alias) !== normalizeForSearch(displayName));

    seen.add(code);
    result.push({
      name: displayName,
      code,
      market,
      sector: inferSector(`${displayName} ${aliases.join(' ')}`),
      aliases
    });
  }

  return result;
}

function validateParsedStocks(stocks: StockCandidate[]) {
  if (stocks.length < MIN_KIS_STOCK_COUNT) {
    throw new Error(`KIS 종목 마스터 파싱 결과가 부족합니다: ${stocks.length}개`);
  }

  const badNames = stocks.filter((stock) => /^KR[0-9A-Z]/i.test(stock.name) || /\d/.test(stock.name) && /^[A-Z0-9]{1,5}$/.test(stock.name));
  if (badNames.length > stocks.length * 0.08) {
    throw new Error(`KIS 종목 마스터 파싱 품질이 낮습니다: 비정상명 ${badNames.length}개`);
  }
}

async function fetchKisMaster() {
  const batches = await Promise.all(MASTER_SOURCES.map(async (source) => {
    const response = await fetch(source.url, {
      cache: 'no-store',
      headers: {
        'User-Agent': 'MarketSignal/5.4 stock-master-loader',
        'Accept': 'application/zip,application/octet-stream,*/*'
      }
    });
    if (!response.ok) throw new Error(`KIS 종목 마스터 다운로드 실패: ${source.market} ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const zip = new AdmZip(buffer);
    const entry = zip.getEntries().find((item) => item.entryName.toLowerCase().endsWith('.mst')) || zip.getEntries()[0];
    if (!entry) return [] as StockCandidate[];
    const decoded = iconv.decode(entry.getData(), 'euc-kr');
    return parseMasterText(decoded, source.market);
  }));

  const uniqueStocks = new Map<string, StockCandidate>();
  for (const stock of batches.flat().filter((stock) => isPlausibleStockName(stock.name))) {
    if (!uniqueStocks.has(stock.code)) uniqueStocks.set(stock.code, stock);
  }

  const stocks = Array.from(uniqueStocks.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  validateParsedStocks(stocks);
  return stocks;
}

function applyStockQuery(stocks: StockCandidate[], query: string | null, limitParam?: string | null) {
  const keyword = (query || '').trim();
  const limit = Math.max(1, Math.min(Number(limitParam || 12) || 12, 20));
  if (!keyword) return stocks;
  return findStockSuggestions(keyword, limit, stocks);
}

export async function GET(request: Request) {
  const now = Date.now();
  const url = new URL(request.url);
  const query = url.searchParams.get('q');
  const limitParam = url.searchParams.get('limit');

  if (memoryCache && memoryCache.expiresAt > now) {
    return NextResponse.json(
      { ...memoryCache.payload, stocks: applyStockQuery(memoryCache.payload.stocks, query, limitParam), cacheHit: true },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const stocks = await withTimeout(fetchKisMaster(), 5500, 'KIS 종목 마스터');
    const payload: StockApiResponse = {
      stocks,
      generatedAt: new Date().toISOString(),
      sourceMode: 'kis-master'
    };
    memoryCache = { expiresAt: now + CACHE_TTL_MS, payload };
    return NextResponse.json(
      { ...payload, stocks: applyStockQuery(payload.stocks, query, limitParam) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const payload: StockApiResponse = {
      stocks: [],
      generatedAt: new Date().toISOString(),
      sourceMode: 'unavailable',
      error: error instanceof Error ? error.message : '종목 마스터를 불러오지 못했습니다.'
    };
    memoryCache = { expiresAt: now + 1000 * 60 * 2, payload };
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  }
}
