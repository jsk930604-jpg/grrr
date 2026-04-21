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

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const multiplier = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;

  for (let i = period; i < values.length; i += 1) {
    const next = ((values[i] - prev) * multiplier) + prev;
    out[i] = next;
    prev = next;
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
  if (candles.length < 200) return null;

  const close = candles.map((c) => c.close);
  const open = candles.map((c) => c.open);
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const volume = candles.map((c) => (Number.isFinite(c.volume) ? c.volume : 0));

  const ema50Series = ema(close, 50);
  const ema200Series = ema(close, 200);
  const rsiSeries = rsi(close, 14);

  const last = close.length - 1;
  const ema50 = ema50Series[last];
  const ema200 = ema200Series[last];
  const ema50Past5 = ema50Series[last - 5];
  const rsi14 = rsiSeries[last];

  if (
    !Number.isFinite(ema50) ||
    !Number.isFinite(ema200) ||
    !Number.isFinite(ema50Past5) ||
    !Number.isFinite(rsi14)
  ) {
    return null;
  }

  const avgVolume5 = mean(volume.slice(last - 4, last + 1));
  const avgVolume20 = mean(volume.slice(last - 19, last + 1));
  const return3d = close.length >= 4 ? ((close[last] / close[last - 3]) - 1) * 100 : NaN;
  const return20d = close.length >= 21 ? ((close[last] / close[last - 20]) - 1) * 100 : NaN;
  const return60d = close.length >= 61 ? ((close[last] / close[last - 60]) - 1) * 100 : NaN;
  const recent20High = Math.max(...high.slice(last - 20, last));
  const high120 = Math.max(...high.slice(last - 119, last + 1));
  const priceTo120High = Number.isFinite(high120) && high120 > 0 ? close[last] / high120 : NaN;

  let breakoutIndex = -1;
  let breakoutVolumeMultiple = NaN;
  let breakoutPrev5To20Ratio = NaN;
  let breakoutPrev20High = NaN;
  for (let i = last; i >= Math.max(20, last - 2); i -= 1) {
    const prev20High = Math.max(...high.slice(i - 20, i));
    const breakout = close[i] > prev20High;
    const bullish = close[i] > open[i];
    const vol20Avg = mean(volume.slice(i - 20, i));
    const prev5Avg = mean(volume.slice(Math.max(0, i - 5), i));
    const volMultiple = Number.isFinite(vol20Avg) && vol20Avg > 0 ? volume[i] / vol20Avg : NaN;
    const prev5Ratio = Number.isFinite(vol20Avg) && vol20Avg > 0 ? prev5Avg / vol20Avg : NaN;
    if (breakout && bullish && Number.isFinite(volMultiple) && Number.isFinite(prev5Ratio)) {
      breakoutIndex = i;
      breakoutVolumeMultiple = volMultiple;
      breakoutPrev5To20Ratio = prev5Ratio;
      breakoutPrev20High = prev20High;
      break;
    }
  }

  const breakoutWithin3Days = breakoutIndex >= 0 && (last - breakoutIndex) <= 2;
  const breakoutDayBullish = breakoutIndex >= 0 ? close[breakoutIndex] > open[breakoutIndex] : false;
  const breakoutCloseAbovePrev20High = breakoutIndex >= 0 ? close[breakoutIndex] > breakoutPrev20High : false;
  const breakoutVolumePass = Number.isFinite(breakoutVolumeMultiple) && breakoutVolumeMultiple >= 1.8;
  const breakoutPreVolumeContractionPass = Number.isFinite(breakoutPrev5To20Ratio) && breakoutPrev5To20Ratio <= 0.8;
  const breakoutAgeDays = breakoutIndex >= 0 ? (last - breakoutIndex) : 999;

  let ema50CrossedAboveEma200Within15Days = false;
  for (let i = Math.max(1, last - 14); i <= last; i += 1) {
    if (!Number.isFinite(ema50Series[i]) || !Number.isFinite(ema200Series[i])) continue;
    if (!Number.isFinite(ema50Series[i - 1]) || !Number.isFinite(ema200Series[i - 1])) continue;
    if (ema50Series[i - 1] <= ema200Series[i - 1] && ema50Series[i] > ema200Series[i]) {
      ema50CrossedAboveEma200Within15Days = true;
      break;
    }
  }

  let pullbackNearEma50BeforeBreakout = false;
  if (breakoutIndex >= 2) {
    for (let i = Math.max(0, breakoutIndex - 5); i < breakoutIndex; i += 1) {
      if (!Number.isFinite(ema50Series[i]) || ema50Series[i] <= 0) continue;
      const distance = Math.abs(low[i] - ema50Series[i]) / ema50Series[i];
      if (distance <= 0.03) {
        pullbackNearEma50BeforeBreakout = true;
        break;
      }
    }
  }

  return {
    close: close[last],
    open: open[last],
    low: low[last],
    high: high[last],
    recentHigh: recent20High,
    high120,
    priceTo120High,
    ema50,
    ema200,
    ema50Past5,
    rsi14,
    return3d,
    return20d,
    return60d,
    volume: volume[last],
    avgVolume5,
    avgVolume20,
    recent20High,
    breakoutWithin3Days,
    breakoutDayBullish,
    breakoutCloseAbovePrev20High,
    breakoutVolumePass,
    breakoutPreVolumeContractionPass,
    breakoutVolumeMultiple,
    breakoutPrev5To20Ratio,
    breakoutAgeDays,
    ema50CrossedAboveEma200Within15Days,
    pullbackNearEma50BeforeBreakout
  };
}

function marketUptrend(candles) {
  const snapshot = buildIndicatorSnapshot(candles);
  if (!snapshot) return false;
  return snapshot.ema50 > snapshot.ema200 && snapshot.close > snapshot.ema50 && snapshot.ema50 >= snapshot.ema50Past5;
}

module.exports = {
  normalizeCandles,
  buildIndicatorSnapshot,
  marketUptrend
};
