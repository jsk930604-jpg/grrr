function scoreStock(input) {
  const { code, name, indicators, marketSync, institutionalNetBuy, foreignNetBuy } = input;
  if (!indicators) return null;

  const trendMa = indicators.ma20 > indicators.ma60;
  const trendSlopeUp = indicators.ma20SlopeUp;
  const pullbackFromHigh = indicators.close < indicators.recentHigh * 0.98;
  const pullbackNearMa20 = Number.isFinite(indicators.ma20) &&
    indicators.ma20 > 0 &&
    Math.abs(indicators.close - indicators.ma20) / indicators.ma20 < 0.04;

  const rsiMomentum = indicators.rsi14 >= 50 && indicators.rsi14 <= 65;
  const priceAbovePrevClose = Number.isFinite(indicators.prevClose)
    ? indicators.close > indicators.prevClose
    : indicators.return3d > 0;
  const rangeBreakout = Boolean(indicators.breakout);
  const volumeSpike = Boolean(indicators.volumeSpike || indicators.volumeSpikeStrong);
  const priceUp = Boolean(priceAbovePrevClose);
  const breakout = Boolean(rangeBreakout);

  const trendScore = (trendMa ? 15 : 0) + (trendSlopeUp ? 10 : 0); // max 25
  const pullbackScore = (pullbackFromHigh ? 10 : 0) + (pullbackNearMa20 ? 10 : 0); // max 20
  const volumeScore =
    (volumeSpike && priceUp ? 15 : 0) +
    (volumeSpike && breakout ? 10 : 0); // max 25
  const momentumScore =
    (rsiMomentum ? 10 : 0) +
    (priceAbovePrevClose ? 5 : 0) +
    (rangeBreakout ? 5 : 0); // max 20
  const flowScore = (institutionalNetBuy > 0 ? 5 : 0) + (foreignNetBuy > 0 ? 5 : 0); // max 10
  const marketScore = marketSync ? 10 : 0; // max 10

  let penalty = 0;
  if (indicators.rsi14 > 80) penalty += 12;
  else if (indicators.rsi14 > 75) penalty += 8;
  if (indicators.return3d > 10) penalty += 10;
  if (indicators.gapUpPct > 3) penalty += 6;
  if (indicators.daysSinceBreakout > 5) penalty += 4;
  penalty = Math.min(20, penalty);

  const score = trendScore + pullbackScore + volumeScore + momentumScore + flowScore + marketScore - penalty;

  const signal = score >= 70 ? "BUY" : score >= 65 ? "OBSERVE" : "DROP";

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
