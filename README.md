# Market Signal v5.4

## 수정 내용

- KIS 실데이터 기반 자동완성 유지
- 앱 내부 하드코딩 종목/테마 추천 제거 유지
- `LS ELECTRIC`이 `LS`로 잘리는 근본 원인 수정
- `cleanStockName()`이 대문자 영문 단어를 메타 필드로 오인해 삭제하던 문제 해결
- `LS E`, `LS ELE`, `LS ELECTRIC` 검색 시 후보가 유지되도록 보정
- `S-Oil`, `GKL S`, `DL S`처럼 짧은 영문 검색어의 무관 포함 검색 방어 유지

## 실행

```bash
npm install
npm run dev
```

기존 `.env.local`은 그대로 사용하면 됩니다.


## v5.7

- MY STOCK FEED를 전체 70건 필터링이 아니라 관심 종목 기준 별도 뉴스 검색 파이프라인으로 분리했습니다.
- 관심 종목별 Google News RSS 직접 검색 쿼리를 생성합니다.
- GDELT도 관심 종목 watchlist를 포함해 별도 조회합니다.
- 내 주식 모드에서는 서버에서 받은 관심 종목 검색 결과를 다시 전체 피드 필터링으로 탈락시키지 않습니다.
- 관심 종목 추가/삭제 후 내 주식 뉴스 재검색 흐름을 개선했습니다.
- npm run typecheck / npm run build 통과.
