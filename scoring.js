function detectGoldenPullback(data) {
  let score = 0;

  // -----------------
  // 1. 골든크로스 (최근 발생)
  // -----------------
  if (
    data.prev_ema50 <= data.prev_ema200 &&
    data.ema50 > data.ema200
  ) {
    score += 30;
  }

  // -----------------
  // 2. 골든 이후 기간 제한 (초기만)
  // -----------------
  if (data.daysSinceGolden <= 10) {
    score += 10;
  } else {
    score -= 10; // 늦은 진입 컷
  }

  // -----------------
  // 3. 눌림 (EMA50 터치)
  // -----------------
  const dist = Math.abs(data.price - data.ema50) / data.ema50;

  if (dist < 0.03) score += 15;

  // -----------------
  // 4. 지지 확인
  // -----------------
  if (
    data.low >= data.ema50 * 0.97 &&
    data.close > data.ema50
  ) {
    score += 15;
  }

  // -----------------
  // 5. 재돌파 (진입 타이밍)
  // -----------------
  if (
    data.price > data.prevHigh &&
    data.volume > data.avgVolume * 1.5
  ) {
    score += 20;
  }

  // -----------------
  // ❗ 과열 제거
  // -----------------
  const position = data.price / data.recentHigh;
  if (position > 0.9) score -= 20;

  return score;
}

function scoreStock(input) {
  const { code, name, indicators, marketSync, institutionalNetBuy, foreignNetBuy } = input;
  if (!indicators) return null;

  const data = {
    prev_ema50: Number(indicators.prev_ema50 ?? indicators.ema50Prev ?? indicators.ma50Prev ?? indicators.ma50Past),
    prev_ema200: Number(indicators.prev_ema200 ?? indicators.ema200Prev ?? indicators.ma200Prev ?? indicators.ma200Past),
    ema50: Number(indicators.ema50 ?? indicators.ma50 ?? indicators.ma60 ?? indicators.ma20),
    ema200: Number(indicators.ema200 ?? indicators.ma200 ?? indicators.ma120 ?? indicators.ma60),
    daysSinceGolden: Number(indicators.daysSinceGolden ?? indicators.daysSinceGoldenCross ?? indicators.daysSinceMaCross ?? indicators.maCrossAge ?? 999),
    price: Number(indicators.price ?? indicators.close),
    low: Number(indicators.low ?? indicators.close),
    close: Number(indicators.close),
    prevHigh: Number(indicators.prevHigh ?? indicators.recentHigh),
    volume: Number(indicators.volume),
    avgVolume: Number(indicators.avgVolume ?? indicators.avgVolume5),
    recentHigh: Number(indicators.recentHigh)
  };

  const strategyScore = detectGoldenPullback(data);
  const flowScore = (institutionalNetBuy > 0 ? 5 : 0) + (foreignNetBuy > 0 ? 5 : 0);
  const marketScore = marketSync ? 10 : 0;
  const score = strategyScore + flowScore + marketScore;
  const signal = score >= 70 ? "BUY" : score >= 60 ? "OBSERVE" : "DROP";

  let trendScore = 0;
  if (data.prev_ema50 <= data.prev_ema200 && data.ema50 > data.ema200) trendScore += 30;
  if (data.daysSinceGolden <= 10) trendScore += 10;

  let pullbackScore = 0;
  const dist = Math.abs(data.price - data.ema50) / data.ema50;
  if (dist < 0.03) pullbackScore += 15;
  if (data.low >= data.ema50 * 0.97 && data.close > data.ema50) pullbackScore += 15;

  const volumeScore = (data.price > data.prevHigh && data.volume > data.avgVolume * 1.5) ? 20 : 0;
  const penalty = (data.daysSinceGolden > 10 ? 10 : 0) + ((data.price / data.recentHigh) > 0.9 ? 20 : 0);

  return {
    code,
    name,
    price: indicators.close,
    score,
    signal,
    stopLossPct: -5,
    takeProfitPctMin: 10,
    takeProfitPctMax: 20,
    maxHoldingDays: 20,
    breakdown: {
      trend: trendScore,
      pullback: pullbackScore,
      volume: volumeScore,
      institution: institutionalNetBuy > 0 ? 5 : 0,
      foreign: foreignNetBuy > 0 ? 5 : 0,
      momentum: 0,
      market: marketScore,
      penalty
    }
  };
}

function rankTop(scoredStocks, topN = 5) {
  return scoredStocks
    .filter(Boolean)
    .filter((stock) => stock.score >= 70)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

module.exports = {
  detectGoldenPullback,
  scoreStock,
  rankTop
};
