require("dotenv").config();

const { KisApi } = require("./api");
const { logger } = require("./logger");
const { normalizeCandles, buildIndicatorSnapshot } = require("./indicators");
const { scoreStock, rankTop } = require("./scoring");

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return fallback;
}

function formatDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function formatKoreanDateTime(date) {
  return date.toLocaleString("ko-KR", { hour12: false });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function extractCode(row) {
  const keys = ["stck_shrn_iscd", "mksc_shrn_iscd", "pdno", "iscd"];
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim().padStart(6, "0");
    }
  }
  return "";
}

function extractName(row) {
  const keys = ["hts_kor_isnm", "prdt_name"];
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function extractInstitutionNetBuy(row) {
  const keys = ["orgn_ntby_qty", "inst_ntby_qty", "ntby_qty"];
  for (const key of keys) {
    const raw = Number(String(row?.[key] ?? "").replace(/,/g, ""));
    if (Number.isFinite(raw)) return raw;
  }
  return 0;
}

function extractForeignNetBuy(row) {
  const keys = ["frgn_ntby_qty", "forn_ntby_qty", "frgn_ntby_tr_pbmn", "frgn_ntby_tr_amt"];
  for (const key of keys) {
    const raw = Number(String(row?.[key] ?? "").replace(/,/g, ""));
    if (Number.isFinite(raw)) return raw;
  }
  return 0;
}

function extractPrice(row) {
  const keys = ["stck_clpr", "close"];
  for (const key of keys) {
    const text = String(row?.[key] ?? "").trim();
    if (!text) continue;
    const raw = Number(text.replace(/,/g, ""));
    if (Number.isFinite(raw)) return raw;
  }
  return NaN;
}

function dedupeCandidatesWithRows(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const row of list) {
      const code = extractCode(row);
      if (!code) continue;
      const name = extractName(row) || code;
      const prev = map.get(code);
      if (!prev) {
        map.set(code, { code, name, rows: [row] });
        continue;
      }
      prev.rows.push(row);
      if ((!prev.name || prev.name === code) && name) {
        prev.name = name;
      }
    }
  }
  return Array.from(map.values());
}

function isEtfLikeName(name) {
  const text = String(name || "").toUpperCase();
  if (!text) return false;
  const markers = [
    "ETF",
    "ETN",
    "KODEX",
    "TIGER",
    "KOSEF",
    "KBSTAR",
    "HANARO",
    "ARIRANG",
    "ACE ",
    "SOL ",
    "TIMEFOLIO",
    "인버스",
    "레버리지"
  ];
  return markers.some((marker) => text.includes(marker));
}

function isInvestmentCaution(candidate) {
  if (String(candidate.name || "").includes("투자주의")) return true;

  const cautionKeys = [
    "mrkt_warn_cls_name",
    "mrkt_warn_cls_code",
    "invst_warn_cls_name",
    "invst_warn_cls_code",
    "investment_warning",
    "warning_code",
    "warning_text"
  ];

  for (const row of candidate.rows) {
    for (const key of cautionKeys) {
      const value = row?.[key];
      if (value === undefined || value === null || String(value).trim() === "") continue;
      const text = String(value).trim();
      if (text.includes("투자주의")) return true;
      if (key.toLowerCase().includes("warn") && text === "1") return true;
    }
  }

  return false;
}

function isEtfOrEtn(candidate) {
  if (isEtfLikeName(candidate.name)) return true;
  for (const row of candidate.rows) {
    const etfFlag = String(row?.etf_yn ?? "").trim().toUpperCase();
    const etnFlag = String(row?.etn_yn ?? "").trim().toUpperCase();
    if (etfFlag === "Y" || etnFlag === "Y") return true;
    const productText = `${row?.prdt_type_name ?? ""} ${row?.prdt_type_cd ?? ""}`.toUpperCase();
    if (productText.includes("ETF") || productText.includes("ETN")) return true;
  }
  return false;
}

function prefilterCandidates(candidates, minPrice) {
  const rejected = {
    etfOrEtn: 0,
    lowPrice: 0,
    investmentCaution: 0
  };

  const eligible = [];
  for (const candidate of candidates) {
    const etfOrEtn = isEtfOrEtn(candidate);
    const investmentCaution = isInvestmentCaution(candidate);
    const basePrice = candidate.rows.map((row) => extractPrice(row)).find((price) => Number.isFinite(price));
    const lowPrice = Number.isFinite(basePrice) && basePrice <= minPrice;

    if (etfOrEtn) rejected.etfOrEtn += 1;
    if (lowPrice) rejected.lowPrice += 1;
    if (investmentCaution) rejected.investmentCaution += 1;

    if (!etfOrEtn && !lowPrice && !investmentCaution) {
      eligible.push({
        ...candidate,
        basePrice: Number.isFinite(basePrice) ? basePrice : NaN
      });
    }
  }

  return { eligible, rejected };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function getMA(candles, period = 20) {
  if (!Array.isArray(candles) || candles.length < period) return NaN;
  const closes = candles.slice(-period).map((c) => Number(c?.close));
  if (closes.some((value) => !Number.isFinite(value))) return NaN;
  return closes.reduce((sum, value) => sum + value, 0) / period;
}

function getMarketStatus(kospiCandles, kosdaqCandles) {
  const kospiMA20 = getMA(kospiCandles, 20);
  const kosdaqMA20 = getMA(kosdaqCandles, 20);

  const kospiNow = Number(kospiCandles?.[kospiCandles.length - 1]?.close);
  const kosdaqNow = Number(kosdaqCandles?.[kosdaqCandles.length - 1]?.close);
  const kospiPast5 = Number(kospiCandles?.[kospiCandles.length - 6]?.close);
  const kosdaqPast5 = Number(kosdaqCandles?.[kosdaqCandles.length - 6]?.close);

  let score = 0;
  if (Number.isFinite(kospiNow) && Number.isFinite(kospiMA20) && kospiNow > kospiMA20) score += 5;
  if (Number.isFinite(kosdaqNow) && Number.isFinite(kosdaqMA20) && kosdaqNow > kosdaqMA20) score += 5;
  if (Number.isFinite(kospiNow) && Number.isFinite(kospiPast5) && kospiNow > kospiPast5) score += 5;
  if (Number.isFinite(kosdaqNow) && Number.isFinite(kosdaqPast5) && kosdaqNow > kosdaqPast5) score += 5;

  if (score >= 15) return { status: "ON", score };
  if (score >= 10) return { status: "NEUTRAL", score };
  return { status: "OFF", score };
}

function buildTelegramMessage(stocks, options) {
  const { topN, marketStatus, marketScore, minPrice, filteredSummary } = options;
  const marketStatusText = marketStatus === "ON"
    ? "🟢 ON"
    : marketStatus === "NEUTRAL"
      ? "🟡 NEUTRAL"
      : "⚪ OFF";

  const formatNum = (value, digits = 2) => (Number.isFinite(value) ? value.toFixed(digits) : "-");
  const top = stocks.slice(0, topN);

  const lines = [
    `📊 <b>Early Trend Reversal Breakout Top ${topN}</b>`,
    `🕒 <b>기준시각</b> <code>${escapeHtml(formatKoreanDateTime(new Date()))}</code>`,
    `🧭 <b>시장상태</b> ${marketStatusText} <code>(score ${marketScore})</code>`,
    `🧹 <b>필터</b> ETF/ETN 제외 | ${minPrice.toLocaleString("ko-KR")}원 초과 | 투자주의 제외`,
    `🚫 <b>제외건수</b> ETF/ETN ${filteredSummary.etfOrEtn} | 저가 ${filteredSummary.lowPrice} | 투자주의 ${filteredSummary.investmentCaution}`,
    "",
    "<b>Columns</b>",
    "<code>Ticker | Name | Price | EMA50 | EMA200 | 20D% | 60D% | VolX | Breakout | Score</code>",
    "━━━━━━━━━━━━"
  ];

  if (!top.length) {
    lines.push("조건을 모두 통과한 종목이 없습니다.");
    return lines.join("\n");
  }

  top.forEach((stock) => {
    lines.push(
      `<code>${escapeHtml(stock.code)} | ${escapeHtml(stock.name)} | ${formatNum(stock.price)} | ${formatNum(stock.ema50)} | ${formatNum(stock.ema200)} | ${formatNum(stock.return20d)} | ${formatNum(stock.return60d)} | ${formatNum(stock.volumeMultiple)} | ${escapeHtml(stock.breakoutStatus)} | ${formatNum(stock.score, 0)}</code>`
    );
  });

  lines.push("━━━━━━━━━━━━");
  lines.push("<b>TOP 5 Summary</b>");
  top.slice(0, 5).forEach((stock, idx) => {
    const entryReasons = [];
    if (stock.breakdown?.emaCrossBonus) entryReasons.push("EMA50>EMA200 recent cross");
    if (stock.breakdown?.pullbackBonus) entryReasons.push("pullback near EMA50");
    if (stock.breakdown?.rsiBonus) entryReasons.push("RSI(14) in 45~65");
    const entryText = entryReasons.length
      ? `Core breakout + ${entryReasons.join(", ")}`
      : "Core breakout rules passed with valid volume expansion";
    lines.push(`<b>${idx + 1}. ${escapeHtml(stock.code)} ${escapeHtml(stock.name)}</b>`);
    lines.push(`- Entry: ${escapeHtml(entryText)}`);
    lines.push("- Invalidation: Daily close below EMA50");
  });

  return lines.join("\n");
}

function buildMarketSkipMessage() {
  return [
    "📊 <b>Swing Top 10 (장마감)</b>",
    `🕒 <b>기준시각</b> <code>${escapeHtml(formatKoreanDateTime(new Date()))}</code>`,
    "🧭 <b>시장상태</b> ⚪ OFF",
    "",
    "⛔ <b>오늘은 시장 조건 미충족으로 종목 선정을 스킵합니다.</b>",
    "규칙: <code>if (!allowBuy) sendWatchlist(stocks)</code>"
  ].join("\n");
}

function buildNoMatchMessage(options) {
  const { marketStatus, marketScore, minPrice, filteredSummary, reason } = options;
  const marketStatusText = marketStatus === "ON"
    ? "🟢 ON"
    : marketStatus === "NEUTRAL"
      ? "🟡 NEUTRAL"
      : "⚪ OFF";

  return [
    "📊 <b>Early Trend Reversal Breakout</b>",
    `🕒 <b>기준시각</b> <code>${escapeHtml(formatKoreanDateTime(new Date()))}</code>`,
    `🧭 <b>시장상태</b> ${marketStatusText} <code>(score ${marketScore})</code>`,
    `🧹 <b>필터</b> ETF/ETN 제외 | ${minPrice.toLocaleString("ko-KR")}원 초과 | 투자주의 제외`,
    `🚫 <b>제외건수</b> ETF/ETN ${filteredSummary.etfOrEtn} | 저가 ${filteredSummary.lowPrice} | 투자주의 ${filteredSummary.investmentCaution}`,
    "",
    `ℹ️ <b>결과</b> ${escapeHtml(reason)}`
  ].join("\n");
}

async function runOnce() {
  const config = {
    baseUrl: process.env.KIS_BASE_URL || "https://openapi.koreainvestment.com:9443",
    appKey: requiredEnv("KIS_APP_KEY"),
    appSecret: requiredEnv("KIS_APP_SECRET"),
    customerType: process.env.KIS_CUSTOMER_TYPE || "P",
    timeoutMs: toInt(process.env.KIS_TIMEOUT_MS, 12000),
    retryCount: toInt(process.env.KIS_RETRY_COUNT, 4),
    retryBaseDelayMs: toInt(process.env.KIS_RETRY_BASE_DELAY_MS, 600),
    tokenCachePath: process.env.KIS_TOKEN_CACHE_FILE || ".kis_token_cache.json",
    tokenPath: process.env.KIS_TOKEN_PATH || "/oauth2/tokenP",
    trVolumeRank: process.env.KIS_TR_VOLUME_RANK || "FHPST01710000",
    trFluctuation: process.env.KIS_TR_FLUCTUATION || "FHPST01700000",
    trItemChart: process.env.KIS_TR_ITEM_CHART || "FHKST03010100",
    trIndexChart: process.env.KIS_TR_INDEX_CHART || "FHKUP03500100",
    trForeignInstitutionTotal: process.env.KIS_TR_FOREIGN_INST_TOTAL || "FHPTJ04400000",
    rankMarketCode: process.env.KIS_RANK_MARKET_CODE || "J",
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
    telegramChatId: process.env.TELEGRAM_CHAT_ID || ""
  };

  const api = new KisApi(config);
  const historyDays = toInt(process.env.KIS_HISTORY_DAYS, 220);
  const topN = Math.max(1, toInt(process.env.KIS_TOP_N, 15));
  const minPrice = Math.max(0, toInt(process.env.KIS_MIN_PRICE, 1000));
  const candidateLimit = Math.max(topN * 4, toInt(process.env.KIS_CANDIDATE_LIMIT, 60));
  const concurrency = toInt(process.env.KIS_CONCURRENCY, 4);

  const toDate = formatDate(new Date());
  const fromDate = formatDate(daysAgo(historyDays));

  logger.info(`Fetching market and ranking data: ${fromDate} ~ ${toDate}`);

  const [kospiRaw, kosdaqRaw, volumeRankRaw, fluctuationRaw, institutionRaw] = await Promise.all([
    api.getDailyIndexChart(
      process.env.KIS_INDEX_CODE_KOSPI || "0001",
      fromDate,
      toDate,
      process.env.KIS_INDEX_MARKET_CODE_KOSPI || "U"
    ),
    api.getDailyIndexChart(
      process.env.KIS_INDEX_CODE_KOSDAQ || "1001",
      fromDate,
      toDate,
      process.env.KIS_INDEX_MARKET_CODE_KOSDAQ || "U"
    ),
    api.getVolumeRank(candidateLimit),
    api.getFluctuationRank(candidateLimit),
    api.getInstitutionRank()
  ]);

  const kospiCandles = normalizeCandles(kospiRaw);
  const kosdaqCandles = normalizeCandles(kosdaqRaw);
  const marketEvaluation = getMarketStatus(kospiCandles, kosdaqCandles);
  const marketStatus = marketEvaluation.status;
  const marketScore = marketEvaluation.score;
  const marketSync = marketStatus !== "OFF";
  logger.info(`Market status: status=${marketStatus}, score=${marketScore}`);

  const candidates = dedupeCandidatesWithRows(volumeRankRaw, fluctuationRaw).slice(0, candidateLimit);
  if (!candidates.length) {
    const text = buildNoMatchMessage({
      marketStatus,
      marketScore,
      minPrice,
      filteredSummary: { etfOrEtn: 0, lowPrice: 0, investmentCaution: 0 },
      reason: "후보 종목 데이터가 없어 선정을 스킵했습니다."
    });
    console.log(text);
    await api.sendTelegramAlert(text);
    logger.warn("No candidate stocks from ranking APIs");
    return;
  }

  const filtered = prefilterCandidates(candidates, minPrice);
  const filteredSummary = { ...filtered.rejected, lowPriceAfterScoring: 0 };
  if (!filtered.eligible.length) {
    const text = buildNoMatchMessage({
      marketStatus,
      marketScore,
      minPrice,
      filteredSummary,
      reason: "필터(ETF/가격/투자주의) 통과 종목이 없어 선정을 스킵했습니다."
    });
    console.log(text);
    await api.sendTelegramAlert(text);
    logger.warn("No candidate stocks after ETF/price/caution filtering");
    return;
  }

  const institutionMap = new Map();
  const foreignMap = new Map();
  for (const row of institutionRaw) {
    const code = extractCode(row);
    if (!code) continue;
    institutionMap.set(code, extractInstitutionNetBuy(row));
    foreignMap.set(code, extractForeignNetBuy(row));
  }

  logger.info(`Scoring candidates: ${filtered.eligible.length} symbols (filtered from ${candidates.length})`);

  const scored = await mapWithConcurrency(filtered.eligible, concurrency, async (candidate) => {
    try {
      const chart = await api.getDailyItemChart(candidate.code, fromDate, toDate);
      const candles = normalizeCandles(chart, { strictClose: true });
      const indicators = buildIndicatorSnapshot(candles);
      if (!indicators) return null;
      const scoredStock = scoreStock({
        code: candidate.code,
        name: candidate.name,
        indicators,
        marketSync,
        institutionalNetBuy: institutionMap.get(candidate.code) || 0,
        foreignNetBuy: foreignMap.get(candidate.code) || 0
      });
      if (!scoredStock) return null;
      if (scoredStock.price <= minPrice) {
        filteredSummary.lowPriceAfterScoring += 1;
        return null;
      }
      return scoredStock;
    } catch (error) {
      logger.warn(`Failed candidate ${candidate.code}: ${error.message}`);
      return null;
    }
  });

  filteredSummary.lowPrice += filteredSummary.lowPriceAfterScoring;

  const scoredSorted = scored
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  if (!scoredSorted.length) {
    const text = buildNoMatchMessage({
      marketStatus,
      marketScore,
      minPrice,
      filteredSummary,
      reason: "전략 코어 조건을 모두 통과한 종목이 없어 오늘은 알림 후보가 없습니다."
    });
    console.log(text);
    await api.sendTelegramAlert(text);
    logger.warn("No scored stocks produced");
    return;
  }

  const alertText = buildTelegramMessage(
    scoredSorted,
    {
      topN,
      marketStatus,
      marketScore,
      minPrice,
      filteredSummary
    }
  );

  console.log(alertText);
  await api.sendTelegramAlert(alertText);
  logger.info("Run completed");
}

function isWeekday(date) {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

function nextScheduleDate(hour, minute, weekdaysOnly) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);

  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  if (weekdaysOnly) {
    while (!isWeekday(next)) {
      next.setDate(next.getDate() + 1);
    }
  }

  return next;
}

function scheduleDailyRun(handler, options) {
  const { hour, minute, weekdaysOnly } = options;

  const scheduleNext = () => {
    const next = nextScheduleDate(hour, minute, weekdaysOnly);
    const waitMs = Math.max(1000, next.getTime() - Date.now());
    logger.info(`Next run scheduled at ${formatKoreanDateTime(next)}`);

    setTimeout(async () => {
      try {
        await handler();
      } catch (error) {
        logger.error(error.message);
      } finally {
        scheduleNext();
      }
    }, waitMs);
  };

  scheduleNext();
}

async function bootstrap() {
  const onceMode = process.argv.includes("--once");
  const scheduleEnabled = toBool(process.env.KIS_SCHEDULE_ENABLED, true);

  if (onceMode || !scheduleEnabled) {
    await runOnce();
    return;
  }

  const scheduleHour = Math.max(0, Math.min(23, toInt(process.env.KIS_ALERT_HOUR, 18)));
  const scheduleMinute = Math.max(0, Math.min(59, toInt(process.env.KIS_ALERT_MINUTE, 0)));
  const weekdaysOnly = toBool(process.env.KIS_ALERT_WEEKDAYS_ONLY, true);
  const runOnStartup = toBool(process.env.KIS_RUN_ON_STARTUP, false);

  if (runOnStartup) {
    try {
      await runOnce();
    } catch (error) {
      logger.error(error.message);
    }
  }

  scheduleDailyRun(runOnce, {
    hour: scheduleHour,
    minute: scheduleMinute,
    weekdaysOnly
  });
}

bootstrap().catch((error) => {
  logger.error(error.message);
  process.exitCode = 1;
});
