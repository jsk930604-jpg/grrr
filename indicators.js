function toNumber(value) {
  const num = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(num) ? num : NaN;
}

function pickFirstNumber(row, keys) {
  for (const key of keys) {
    const num = toNumber(row?.[key]);
    if (Number.isFinite(num)) return num;
  }
  return NaN;
}

function pickFirstString(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function mean(values) {
  if (!values.length) return NaN;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

function sma(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let rolling = 0;
  for (let i = 0; i < values.length; i += 1) {
    rolling += values[i];
    if (i >= period) rolling -= values[i - period];
    if (i >= period - 1) out[i] = rolling / period;
  }
  return out;
}

function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum += Math.abs(diff);
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - (100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    out[i] = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - (100 / (1 + avgGain / avgLoss));
  }

  return out;
}

function atr(high, low, close, period = 14) {
  const tr = new Array(close.length).fill(null);
  const out = new Array(close.length).fill(null);
  if (!close.length) return out;

  tr[0] = high[0] - low[0];
  for (let i = 1; i < close.length; i += 1) {
    const hl = high[i] - low[i];
    const hc = Math.abs(high[i] - close[i - 1]);
    const lc = Math.abs(low[i] - close[i - 1]);
    tr[i] = Math.max(hl, hc, lc);
  }

  if (close.length <= period) return out;
  let seed = 0;
  for (let i = 1; i <= period; i += 1) seed += tr[i];
  out[period] = seed / period;

  for (let i = period + 1; i < close.length; i += 1) {
    out[i] = ((out[i - 1] * (period - 1)) + tr[i]) / period;
  }
  return out;
}

function normalizeCandles(rows, options = {}) {
  const strictClose = Boolean(options.strictClose);
  const closeKeys = strictClose
    ? ["stck_clpr", "close"]
    : ["stck_clpr", "stck_prpr", "bstp_nmix_prpr", "close"];

  const candles = rows
    .map((row) => {
      const date = pickFirstString(row, ["stck_bsop_date", "bsop_date", "date"]);
      const open = pickFirstNumber(row, ["stck_oprc", "bstp_nmix_oprc", "open"]);
      const high = pickFirstNumber(row, ["stck_hgpr", "bstp_nmix_hgpr", "high"]);
      const low = pickFirstNumber(row, ["stck_lwpr", "bstp_nmix_lwpr", "low"]);
      const close = pickFirstNumber(row, closeKeys);
      const volume = pickFirstNumber(row, ["acml_vol", "volume"]);
      return { date, open, high, low, close, volume };
    })
    .filter((c) => c.date && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close))
    .sort((a, b) => a.date.localeCompare(b.date));

  return candles;
}

function buildIndicatorSnapshot(candles) {
  if (candles.length < 70) return null;

  const close = candles.map((c) => c.close);
  const open = candles.map((c) => c.open);
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const volume = candles.map((c) => (Number.isFinite(c.volume) ? c.volume : 0));

  const ma20Series = sma(close, 20);
  const ma60Series = sma(close, 60);
  const rsiSeries = rsi(close, 14);
  const atrSeries = atr(high, low, close, 14);

  const last = close.length - 1;
  const ma20 = ma20Series[last];
  const ma60 = ma60Series[last];
  const ma20Past = ma20Series[last - 5];
  const rsi14 = rsiSeries[last];
  const atr14 = atrSeries[last];

  if (
    !Number.isFinite(ma20) ||
    !Number.isFinite(ma60) ||
    !Number.isFinite(ma20Past) ||
    !Number.isFinite(rsi14) ||
    !Number.isFinite(atr14)
  ) {
    return null;
  }

  const avgVolume5 = mean(volume.slice(-5));
  const return5d = close.length >= 6 ? ((close[last] / close[last - 5]) - 1) * 100 : NaN;
  const return3d = close.length >= 4 ? ((close[last] / close[last - 3]) - 1) * 100 : NaN;
  const gapUpPct = close.length >= 2 ? ((open[last] / close[last - 1]) - 1) * 100 : NaN;
  const previous20High = Math.max(...high.slice(Math.max(0, last - 20), last));
  const breakout = close[last] > previous20High;
  const ma20SlopeUp = ma20 > ma20Past;
  const volumeSpike = Number.isFinite(avgVolume5) && avgVolume5 > 0 && volume[last] > avgVolume5 * 1.5;
  const volumeSpikeStrong = Number.isFinite(avgVolume5) && avgVolume5 > 0 && volume[last] > avgVolume5 * 2.0;

  const atrWindow = atrSeries.slice(Math.max(0, last - 20), last + 1).filter((v) => Number.isFinite(v));
  const atrMean20 = atrWindow.length ? mean(atrWindow) : NaN;
  const stableAtr = Number.isFinite(atrMean20) && atr14 <= atrMean20 * 1.2;

  const returns20 = [];
  const start = Math.max(1, close.length - 20);
  for (let i = start; i < close.length; i += 1) {
    returns20.push(((close[i] / close[i - 1]) - 1) * 100);
  }
  const hasSpike = returns20.some((x) => Math.abs(x) >= 7);
  const last5High = Math.max(...high.slice(-5));
  const last5Low = Math.min(...low.slice(-5));
  const last5RangePct = ((last5High - last5Low) / close[last]) * 100;
  const consolidationAfterSpike = hasSpike && last5RangePct <= 6;

  let breakoutIndex = -1;
  for (let i = Math.max(20, close.length - 60); i <= last; i += 1) {
    const windowHigh = Math.max(...high.slice(i - 20, i));
    if (close[i] > windowHigh) {
      breakoutIndex = i;
    }
  }
  const daysSinceBreakout = breakoutIndex >= 0 ? (last - breakoutIndex) : 999;
  const firstBreakout = breakoutIndex >= 0 && daysSinceBreakout <= 3;
  const overheated = (Number.isFinite(rsi14) && rsi14 > 70) || (Number.isFinite(return3d) && return3d > 10) || (Number.isFinite(gapUpPct) && gapUpPct > 3);

  return {
    close: close[last],
    recentHigh: previous20High,
    ma20,
    ma60,
    ma20SlopeUp,
    rsi14,
    return5d,
    return3d,
    gapUpPct,
    daysSinceBreakout,
    firstBreakout,
    overheated,
    breakout,
    volumeSpike,
    volumeSpikeStrong,
    volume: volume[last],
    avgVolume5,
    atr14,
    stableAtr,
    consolidationAfterSpike
  };
}

function marketUptrend(candles) {
  const snapshot = buildIndicatorSnapshot(candles);
  if (!snapshot) return false;
  return snapshot.ma20 > snapshot.ma60 && snapshot.close > snapshot.ma20 && snapshot.ma20SlopeUp;
}

module.exports = {
  normalizeCandles,
  buildIndicatorSnapshot,
  marketUptrend
};
