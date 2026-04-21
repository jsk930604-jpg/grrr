function scoreStock(input) {
  const { code, name, indicators, marketSync, institutionalNetBuy, foreignNetBuy } = input;
  if (!indicators) return null;

  const close = Number(indicators.close);
  const recentHigh = Number(indicators.recentHigh);
  const ma50 = Number(indicators.ma50);
  const ma200 = Number(indicators.ma200);
  const ma50Prev = Number(indicators.ma50Prev ?? indicators.ma50Past ?? indicators.ma50_5dAgo);
  const ma200Prev = Number(indicators.ma200Prev ?? indicators.ma200Past ?? indicators.ma200_5dAgo);
  const daysSinceMaCross = Number(indicators.daysSinceMaCross ?? indicators.daysSinceGoldenCross ?? indicators.maCrossAge);
  const return3d = Number(indicators.return3d);
  const return60d = Number(indicators.return60d);
  const return120d = Number(indicators.return120d);
  const rsi14 = Number(indicators.rsi14);
  const daysSinceBreakout = Number(indicators.daysSinceBreakout);

  const position = Number.isFinite(close) && Number.isFinite(recentHigh) && recentHigh > 0
    ? close / recentHigh
    : NaN;

  const pullbackPct = Number.isFinite(position) ? (1 - position) * 100 : NaN;
  const breakoutFresh = Number.isFinite(daysSinceBreakout) && daysSinceBreakout <= 5;
  const breakout = Boolean(indicators.breakout) && breakoutFresh;

  const ma50Above200 = Number.isFinite(ma50) && Number.isFinite(ma200) && ma50 > ma200;
  const crossedFromBelow = Number.isFinite(ma50Prev) && Number.isFinite(ma200Prev) && ma50Prev <= ma200Prev && ma50Above200;
  const crossRecentByAge = ma50Above200 && Number.isFinite(daysSinceMaCross) && daysSinceMaCross >= 0 && daysSinceMaCross <= 20;
  const earlyTrend = (crossedFromBelow || crossRecentByAge) && Number.isFinite(return60d) && return60d < 15;

  const trendScore =
    (earlyTrend ? 30 : 0) +
    (ma50Above200 ? 8 : 0) +
    (breakout ? 8 : 0); // max 46

  let pullbackScore = 0;
  if (Number.isFinite(position) && position >= 0.7 && position <= 0.85) pullbackScore += 20;
  if (Number.isFinite(pullbackPct) && pullbackPct >= 3 && pullbackPct <= 10) pullbackScore += 10;
  else if (Number.isFinite(pullbackPct) && pullbackPct > 10 && pullbackPct <= 15) pullbackScore += 4; // max 30

  const volumeScore = indicators.volumeSpike ? 10 : 0; // max 10
  const momentumScore =
    (Number.isFinite(rsi14) && rsi14 >= 45 && rsi14 <= 65 ? 6 : 0) +
    (Number.isFinite(return3d) && return3d >= -2 && return3d <= 5 ? 4 : 0); // max 10
  const flowScore = (institutionalNetBuy > 0 ? 5 : 0) + (foreignNetBuy > 0 ? 5 : 0); // max 10
  const marketScore = marketSync ? 8 : 0; // max 8

  let penalty = 0;
  if (Number.isFinite(position) && position > 0.9) penalty += 20;
  if (Number.isFinite(return60d) && return60d > 30) penalty += 20;
  if (Number.isFinite(return120d) && return120d > 50) penalty += 20;
  if (!earlyTrend) penalty += 10;
  if (Number.isFinite(return60d) && return60d >= 15) penalty += 8;
  if (Number.isFinite(pullbackPct) && pullbackPct < 2) penalty += 8;
  if (Number.isFinite(rsi14) && rsi14 > 70) penalty += 6;
  if (Number.isFinite(daysSinceBreakout) && daysSinceBreakout > 10) penalty += 6;
  penalty = Math.min(70, penalty);

  const score = trendScore + pullbackScore + volumeScore + momentumScore + flowScore + marketScore - penalty;

  const signal = score >= 70 ? "BUY" : score >= 62 ? "OBSERVE" : "DROP";

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
      momentum: momentumScore,
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
  scoreStock,
  rankTop
};
