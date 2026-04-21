function detectEarlyTrendReversalBreakout(indicators) {
  const close = Number(indicators.close);
  const ema50 = Number(indicators.ema50);
  const ema200 = Number(indicators.ema200);
  const ema50Past1 = Number(indicators.ema50Past1);

  const trendPositionPass =
    Number.isFinite(close) &&
    Number.isFinite(ema50) &&
    Number.isFinite(ema50Past1) &&
    close > ema50 &&
    ema50 > ema50Past1;

  const earlyGoldenZonePass = Boolean(indicators.earlyGoldenZone);

  const breakoutPass =
    Boolean(indicators.breakoutWithin3Days) &&
    Boolean(indicators.breakoutDayBullish) &&
    Boolean(indicators.breakoutCloseAbovePrev20High);

  const volumePass =
    Boolean(indicators.breakoutVolumePass);

  return {
    pass: trendPositionPass && earlyGoldenZonePass && breakoutPass && volumePass,
    trendPositionPass,
    earlyGoldenZonePass,
    breakoutPass,
    volumePass
  };
}

function scoreStock(input) {
  const { code, name, indicators, useRsiFilter = true } = input;
  if (!indicators) return null;

  const checks = detectEarlyTrendReversalBreakout(indicators);
  const rsiPass = !useRsiFilter || (Number.isFinite(indicators.rsi14) && indicators.rsi14 > 50);
  if (!checks.pass || !rsiPass) return null;

  let score = 70;
  const emaCrossBonus = indicators.ema50CrossedAboveEma200Within15Days ? 10 : 0;
  const pullbackBonus = indicators.pullbackNearEma50BeforeBreakout ? 10 : 0;
  const rsiBonus = Number.isFinite(indicators.rsi14) && indicators.rsi14 > 50 ? 10 : 0;
  const volumeStrengthBonus = Number.isFinite(indicators.breakoutVolumeMultiple)
    ? Math.min(10, Math.max(0, (indicators.breakoutVolumeMultiple - 1) * 5))
    : 0;
  score += emaCrossBonus + pullbackBonus + rsiBonus + volumeStrengthBonus;
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
      volumeStrengthBonus,
      trendPositionPass: checks.trendPositionPass,
      earlyGoldenZonePass: checks.earlyGoldenZonePass,
      breakoutPass: checks.breakoutPass,
      volumePass: checks.volumePass,
      rsiPass
    }
  };
}

function rankTop(scoredStocks, topN = 10) {
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
