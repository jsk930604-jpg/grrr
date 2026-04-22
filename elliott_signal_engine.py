import pandas as pd
import numpy as np

# =========================
# CONFIG
# =========================
EMA_FAST = 50
EMA_SLOW = 200
RSI_PERIOD = 14
VOL_PERIOD = 20
ATR_PERIOD = 14

ZIGZAG_THRESHOLD = 0.05

VOL_Z_TH = 1.5
RSI_TH = 55

FIB_MIN = 0.5
FIB_MAX = 0.786

SCORE_TH = 7


# =========================
# INDICATORS
# =========================
def add_indicators(df):
    df = df.copy()

    df["ema50"] = df["close"].ewm(span=EMA_FAST).mean()
    df["ema200"] = df["close"].ewm(span=EMA_SLOW).mean()
    df["ema_slope"] = df["ema50"].diff()

    delta = df["close"].diff()
    gain = delta.clip(lower=0).rolling(RSI_PERIOD).mean()
    loss = -delta.clip(upper=0).rolling(RSI_PERIOD).mean()
    rs = gain / loss
    df["rsi"] = 100 - (100 / (1 + rs))

    vol_ma = df["volume"].rolling(VOL_PERIOD).mean()
    vol_std = df["volume"].rolling(VOL_PERIOD).std()
    df["vol_z"] = (df["volume"] - vol_ma) / vol_std

    tr = np.maximum(
        df["high"] - df["low"],
        np.maximum(
            abs(df["high"] - df["close"].shift()),
            abs(df["low"] - df["close"].shift()),
        ),
    )
    df["atr"] = pd.Series(tr).rolling(ATR_PERIOD).mean()

    return df


# =========================
# ZIGZAG
# =========================
def zigzag(df, threshold=ZIGZAG_THRESHOLD):
    closes = df["close"].values
    pivots = []

    last_pivot = closes[0]
    last_idx = 0
    trend = None

    for i in range(1, len(closes)):
        change = (closes[i] - last_pivot) / last_pivot

        if trend is None:
            if abs(change) > threshold:
                trend = "up" if change > 0 else "down"
                pivots.append((last_idx, last_pivot))
                last_pivot = closes[i]
                last_idx = i

        elif trend == "up":
            if closes[i] > last_pivot:
                last_pivot = closes[i]
                last_idx = i
            elif (last_pivot - closes[i]) / last_pivot > threshold:
                pivots.append((last_idx, last_pivot))
                trend = "down"
                last_pivot = closes[i]
                last_idx = i

        elif trend == "down":
            if closes[i] < last_pivot:
                last_pivot = closes[i]
                last_idx = i
            elif (closes[i] - last_pivot) / last_pivot > threshold:
                pivots.append((last_idx, last_pivot))
                trend = "up"
                last_pivot = closes[i]
                last_idx = i

    pivots.append((last_idx, last_pivot))
    return pivots


# =========================
# ABC (ZIGZAG)
# =========================
def detect_abc(df, pivots):
    signals = []

    for i in range(3, len(pivots)):
        try:
            a = pivots[i - 3]
            b = pivots[i - 2]
            c = pivots[i - 1]

            # zigzag 구조 (5-3-5 근사)
            if not (b[1] < a[1] and c[1] < b[1]):
                continue

            length_a = abs(a[1] - b[1])
            length_c = abs(b[1] - c[1])

            if length_c >= length_a * 0.9:
                signals.append(
                    {"date": df.index[c[0]], "price": c[1], "type": "ABC_CORRECTION"}
                )
        except Exception:
            continue

    return pd.DataFrame(signals)


# =========================
# EXPANDING DIAGONAL
# =========================
def detect_diagonal(df, pivots):
    signals = []

    for i in range(5, len(pivots)):
        try:
            p1, p2, p3, p4, p5 = pivots[i - 5 : i]

            cond1 = p3[1] > p1[1] and p5[1] > p3[1]
            cond2 = p4[1] < p2[1]

            w1 = abs(p2[1] - p1[1])
            w3 = abs(p3[1] - p2[1])
            w5 = abs(p5[1] - p4[1])

            cond3 = w3 > w1 and w5 > w3

            if cond1 and cond2 and cond3:
                signals.append(
                    {"date": df.index[p5[0]], "price": p5[1], "type": "DIAGONAL"}
                )
        except Exception:
            continue

    return pd.DataFrame(signals)


# =========================
# IMPULSE (WAVE3)
# =========================
def detect_wave3(df, pivots):
    signals = []

    for i in range(3, len(pivots)):
        try:
            p1 = pivots[i - 3]
            p2 = pivots[i - 2]
            p3 = pivots[i - 1]

            # 상승 구조
            if not (p2[1] > p1[1] and p3[1] < p2[1]):
                continue

            fib = (p3[1] - p1[1]) / (p2[1] - p1[1])
            if not (FIB_MIN <= fib <= FIB_MAX):
                continue

            for j in range(p3[0], min(p3[0] + 20, len(df))):
                row = df.iloc[j]

                score = 0

                if row["ema50"] > row["ema200"] and row["ema_slope"] > 0:
                    score += 2

                if row["vol_z"] > VOL_Z_TH:
                    score += 3

                if row["close"] > p2[1]:
                    score += 3

                if row["rsi"] > RSI_TH:
                    score += 1

                # 횡보 제거
                if row["atr"] < df["atr"].rolling(50).mean().iloc[j]:
                    continue

                if score >= SCORE_TH:
                    signals.append(
                        {
                            "date": df.index[j],
                            "price": row["close"],
                            "score": score,
                            "type": "IMPULSE_W3",
                        }
                    )
                    break

        except Exception:
            continue

    return pd.DataFrame(signals)


# =========================
# WEEKLY FILTER
# =========================
def to_weekly(df):
    return (
        df.resample("W")
        .agg(
            {
                "open": "first",
                "high": "max",
                "low": "min",
                "close": "last",
                "volume": "sum",
            }
        )
        .dropna()
    )


def weekly_filter(wdf):
    wdf = add_indicators(wdf)
    last = wdf.iloc[-1]

    return last["ema50"] > last["ema200"] and wdf["ema50"].diff().iloc[-1] > 0


# =========================
# MAIN RUN
# =========================
def run(df, use_weekly=True):
    df = add_indicators(df)

    pivots = zigzag(df)

    wave3 = detect_wave3(df, pivots)
    diag = detect_diagonal(df, pivots)
    abc = detect_abc(df, pivots)

    signals = pd.concat([wave3, diag, abc])

    # 주봉 필터
    if use_weekly:
        wdf = to_weekly(df)
        if not weekly_filter(wdf):
            return pd.DataFrame()

    return signals.sort_values(by="date")
