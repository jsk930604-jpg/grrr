const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { logger } = require("./logger");

class KisApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "KisApiError";
    this.status = options.status;
    this.code = options.code;
    this.payload = options.payload;
  }
}

class KisApi {
  constructor(config) {
    this.config = config;
    this.http = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeoutMs
    });
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.tokenPromise = null;
    this.tokenCachePath = config.tokenCachePath
      ? path.resolve(config.tokenCachePath)
      : path.resolve(process.cwd(), ".kis_token_cache.json");
    this.loadTokenCache();
  }

  static toArray(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    return [value];
  }

  static toNumber(value) {
    const num = Number(String(value ?? "").replace(/,/g, ""));
    return Number.isFinite(num) ? num : 0;
  }

  static extractErrorCode(error) {
    return error?.response?.data?.error_code || error?.response?.data?.msg_cd || error?.code || "";
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  loadTokenCache() {
    try {
      if (!this.tokenCachePath || !fs.existsSync(this.tokenCachePath)) return;
      const raw = fs.readFileSync(this.tokenCachePath, "utf8");
      const parsed = JSON.parse(raw);
      const token = String(parsed?.accessToken || "");
      const expiresAt = Number(parsed?.tokenExpiresAt);
      if (!token || !Number.isFinite(expiresAt)) return;
      if (Date.now() >= expiresAt) return;
      this.accessToken = token;
      this.tokenExpiresAt = expiresAt;
    } catch (error) {
      logger.warn(`Failed to read token cache: ${error.message}`);
    }
  }

  saveTokenCache() {
    try {
      if (!this.tokenCachePath || !this.accessToken || !this.tokenExpiresAt) return;
      const payload = {
        accessToken: this.accessToken,
        tokenExpiresAt: this.tokenExpiresAt
      };
      fs.writeFileSync(this.tokenCachePath, JSON.stringify(payload), "utf8");
    } catch (error) {
      logger.warn(`Failed to write token cache: ${error.message}`);
    }
  }

  clearTokenCache() {
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    try {
      if (this.tokenCachePath && fs.existsSync(this.tokenCachePath)) {
        fs.unlinkSync(this.tokenCachePath);
      }
    } catch (error) {
      logger.warn(`Failed to clear token cache: ${error.message}`);
    }
  }

  isRetryable(error) {
    if (!error) return false;
    const errorCode = KisApi.extractErrorCode(error);
    if (error.response && error.response.status >= 500) return true;
    if (error.code === "ECONNABORTED") return true;
    if (error.code === "ENOTFOUND") return true;
    if (error.code === "ECONNRESET") return true;
    if (error.code === "ETIMEDOUT") return true;
    if (error.code === "EGW00201") return true;
    if (errorCode === "EGW00133") return true;
    if (error.status && error.status >= 500) return true;
    if (error.status === 429) return true;
    return !error.response && !error.status;
  }

  async withRetry(fn, label) {
    let lastError;
    const retryCount = Math.max(1, this.config.retryCount);
    for (let attempt = 1; attempt <= retryCount; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const retryable = this.isRetryable(error) && attempt < retryCount;
        const message = error.message || "unknown error";
        if (!retryable) {
          logger.error(`${label} failed (attempt ${attempt}/${retryCount}): ${message}`);
          throw error;
        }
        const errorCode = KisApi.extractErrorCode(error);
        const baseDelay = this.config.retryBaseDelayMs * (2 ** (attempt - 1));
        const delay = errorCode === "EGW00133" ? Math.max(65000, baseDelay) : baseDelay;
        logger.warn(`${label} retry ${attempt}/${retryCount} after ${delay}ms: ${message}`);
        await this.sleep(delay);
      }
    }
    throw lastError;
  }

  async issueAccessToken(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && !this.accessToken) {
      // Another process may have refreshed the token cache file.
      this.loadTokenCache();
    }
    if (!forceRefresh && this.accessToken && now < this.tokenExpiresAt) {
      return this.accessToken;
    }
    if (!forceRefresh && this.tokenPromise) {
      return this.tokenPromise;
    }

    this.tokenPromise = (async () => {
      const body = await this.withRetry(async () => {
        const response = await this.http.post(
          this.config.tokenPath,
          {
            grant_type: "client_credentials",
            appkey: this.config.appKey,
            appsecret: this.config.appSecret
          },
          {
            headers: {
              "content-type": "application/json; charset=utf-8"
            }
          }
        );
        return response.data;
      }, "KIS token");

      if (!body?.access_token) {
        throw new KisApiError("KIS token response missing access_token", {
          payload: body
        });
      }

      const expiresIn = KisApi.toNumber(body.expires_in) || 3600;
      this.accessToken = body.access_token;
      this.tokenExpiresAt = Date.now() + Math.max(60, expiresIn - 60) * 1000;
      this.saveTokenCache();
      return this.accessToken;
    })();

    try {
      return await this.tokenPromise;
    } finally {
      this.tokenPromise = null;
    }
  }

  async request({ method, url, params, data, trId, trCont = "" }) {
    return this.withRetry(async () => {
      let token = await this.issueAccessToken();
      try {
        const response = await this.http.request({
          method,
          url,
          params,
          data,
          headers: {
            authorization: `Bearer ${token}`,
            appkey: this.config.appKey,
            appsecret: this.config.appSecret,
            tr_id: trId,
            custtype: this.config.customerType,
            tr_cont: trCont
          }
        });
        const payload = response.data;
        if (!payload || payload.rt_cd !== "0") {
          throw new KisApiError(payload?.msg1 || "KIS API returned failure", {
            status: response.status,
            code: payload?.msg_cd || payload?.rt_cd,
            payload
          });
        }
        return payload;
      } catch (error) {
        const unauthorized = error.response?.status === 401 || error.status === 401;
        if (unauthorized) {
          this.clearTokenCache();
          token = await this.issueAccessToken(true);
          const secondTry = await this.http.request({
            method,
            url,
            params,
            data,
            headers: {
              authorization: `Bearer ${token}`,
              appkey: this.config.appKey,
              appsecret: this.config.appSecret,
              tr_id: trId,
              custtype: this.config.customerType,
              tr_cont: trCont
            }
          });
          const payload = secondTry.data;
          if (!payload || payload.rt_cd !== "0") {
            throw new KisApiError(payload?.msg1 || "KIS API returned failure", {
              status: secondTry.status,
              code: payload?.msg_cd || payload?.rt_cd,
              payload
            });
          }
          return payload;
        }
        throw error;
      }
    }, `${method.toUpperCase()} ${url}`);
  }

  async getVolumeRank(limit = 30) {
    const payload = await this.request({
      method: "GET",
      url: "/uapi/domestic-stock/v1/quotations/volume-rank",
      trId: this.config.trVolumeRank,
      params: {
        FID_COND_MRKT_DIV_CODE: this.config.rankMarketCode,
        FID_COND_SCR_DIV_CODE: "20171",
        FID_INPUT_ISCD: "0000",
        FID_DIV_CLS_CODE: "0",
        FID_BLNG_CLS_CODE: "0",
        FID_TRGT_CLS_CODE: "111111111",
        FID_TRGT_EXLS_CLS_CODE: "0000000000",
        FID_INPUT_PRICE_1: "0",
        FID_INPUT_PRICE_2: "0",
        FID_VOL_CNT: "0",
        FID_INPUT_DATE_1: "0"
      }
    });
    return KisApi.toArray(payload.output).slice(0, limit);
  }

  async getFluctuationRank(limit = 30) {
    const payload = await this.request({
      method: "GET",
      url: "/uapi/domestic-stock/v1/ranking/fluctuation",
      trId: this.config.trFluctuation,
      params: {
        fid_cond_mrkt_div_code: this.config.rankMarketCode,
        fid_cond_scr_div_code: "20170",
        fid_input_iscd: "0000",
        fid_rank_sort_cls_code: "0",
        fid_input_cnt_1: String(limit),
        fid_prc_cls_code: "0",
        fid_input_price_1: "",
        fid_input_price_2: "",
        fid_vol_cnt: "0",
        fid_trgt_cls_code: "0",
        fid_trgt_exls_cls_code: "0",
        fid_div_cls_code: "0",
        fid_rsfl_rate1: "",
        fid_rsfl_rate2: ""
      }
    });
    return KisApi.toArray(payload.output).slice(0, limit);
  }

  async getDailyItemChart(code, fromDate, toDate) {
    const payload = await this.request({
      method: "GET",
      url: "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
      trId: this.config.trItemChart,
      params: {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: code,
        FID_INPUT_DATE_1: fromDate,
        FID_INPUT_DATE_2: toDate,
        FID_PERIOD_DIV_CODE: "D",
        FID_ORG_ADJ_PRC: "1"
      }
    });
    return KisApi.toArray(payload.output2);
  }

  async getDailyIndexChart(indexCode, fromDate, toDate, marketCode = "U") {
    const params = {
      fid_cond_mrkt_div_code: marketCode,
      fid_input_iscd: indexCode,
      fid_period_div_code: "D"
    };
    if (fromDate) params.fid_input_date_1 = fromDate;
    if (toDate) params.fid_input_date_2 = toDate;

    const payload = await this.request({
      method: "GET",
      url: "/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice",
      trId: this.config.trIndexChart,
      params
    });
    return KisApi.toArray(payload.output2 || payload.output);
  }

  async getInstitutionRank() {
    const payload = await this.request({
      method: "GET",
      url: "/uapi/domestic-stock/v1/quotations/foreign-institution-total",
      trId: this.config.trForeignInstitutionTotal,
      params: {
        FID_COND_MRKT_DIV_CODE: "V",
        FID_COND_SCR_DIV_CODE: "16449",
        FID_INPUT_ISCD: "0000",
        FID_DIV_CLS_CODE: "0",
        FID_RANK_SORT_CLS_CODE: "0",
        FID_ETC_CLS_CODE: "2"
      }
    });
    return KisApi.toArray(payload.output);
  }

  async sendTelegramAlert(text) {
    if (!this.config.telegramBotToken || !this.config.telegramChatId) {
      logger.info("Telegram alert skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set");
      return false;
    }

    await this.withRetry(async () => {
      await axios.post(
        `https://api.telegram.org/bot${this.config.telegramBotToken}/sendMessage`,
        {
          chat_id: this.config.telegramChatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true
        },
        { timeout: this.config.timeoutMs }
      );
    }, "Telegram send");

    return true;
  }
}

module.exports = { KisApi, KisApiError };
