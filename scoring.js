function detectEarlyTrendReversalBreakout(indicators) {
  const close = Number(indicators.close);
  const ema50 = Number(indicators.ema50);
  const ema200 = Number(indicators.ema200);
  const ema50Past5 = Number(indicators.ema50Past5);
  const return20d = Number(indicators.return20d);
  const return60d = Number(indicators.return60d);
  const priceTo120High = Number(indicators.priceTo120High);

  const trendPositionPass =
    Number.isFinite(close) &&
    Number.isFinite(ema50) &&
    Number.isFinite(ema50Past5) &&
    close > ema50 &&
    ema50 >= ema50Past5;

  const emaStructurePass =
    Number.isFinite(ema50) &&
    Number.isFinite(ema200) &&
    ema200 > 0 &&
    (Math.abs(ema50 - ema200) / ema200) < 0.15;

  const breakoutPass =
    Boolean(indicators.breakoutWithin3Days) &&
    Boolean(indicators.breakoutDayBullish) &&
    Boolean(indicators.breakoutCloseAbovePrev20High);

  const volumePass =
    Boolean(indicators.breakoutVolumePass) &&
    Boolean(indicators.breakoutPreVolumeContractionPass);

  const overheatPass =
    Number.isFinite(return20d) &&
    Number.isFinite(return60d) &&
    Number.isFinite(priceTo120High) &&
    return20d < 12 &&
    return60d < 25 &&
    priceTo120High < 0.92;

  return {
    pass: trendPositionPass && emaStructurePass && breakoutPass && volumePass && overheatPass,
    trendPositionPass,
    emaStructurePass,
    breakoutPass,
    volumePass,
    overheatPass
  };
}

function scoreStock(input) {
  const { code, name, indicators } = input;
  if (!indicators) return null;

  const checks = detectEarlyTrendReversalBreakout(indicators);
  if (!checks.pass) return null;

  let score = 70;
  const emaCrossBonus = indicators.ema50CrossedAboveEma200Within15Days ? 10 : 0;
  const pullbackBonus = indicators.pullbackNearEma50BeforeBreakout ? 10 : 0;
  const rsiBonus = Number.isFinite(indicators.rsi14) && indicators.rsi14 >= 45 && indicators.rsi14 <= 65 ? 10 : 0;
  score += emaCrossBonus + pullbackBonus + rsiBonus;
  score = Math.min(100, score);

  return {
    code,
    name,
    price: indicators.close,
    score,
    signal: score >= 90 ? "BUY" : "OBSERVE",
    stopLossPct: -5,
    takeProfitPctMin: 8,
    takeProfitPctMax: 20,
    maxHoldingDays: 20,
    ema50: indicators.ema50,
    ema200: indicators.ema200,
    return20d: indicators.return20d,
    return60d: indicators.return60d,
    breakoutStatus: checks.breakoutPass ? "Yes" : "No",
    volumeMultiple: indicators.breakoutVolumeMultiple,
    breakdown: {
      base: 70,
      emaCrossBonus,
      pullbackBonus,
      rsiBonus,
      trendPositionPass: checks.trendPositionPass,
      emaStructurePass: checks.emaStructurePass,
      breakoutPass: checks.breakoutPass,
      volumePass: checks.volumePass,
      overheatPass: checks.overheatPass
    }
  };
}

function rankTop(scoredStocks, topN = 15) {
  return scoredStocks
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

module.exports = {
  detectEarlyTrendReversalBreakout,
  scoreStock,
  rankTop
};
