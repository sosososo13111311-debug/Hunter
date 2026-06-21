/* ============================================
   Technical Analysis Library for DOGE/USDC
   All indicators calculated in pure JavaScript
   Matches TradingView/Pine Script calculations
   ============================================ */

const TA = {
    // ── SMA: Simple Moving Average ──
    sma(data, period) {
        const result = new Array(data.length).fill(null);
        for (let i = period - 1; i < data.length; i++) {
            let sum = 0;
            for (let j = 0; j < period; j++) sum += data[i - j];
            result[i] = sum / period;
        }
        return result;
    },

    // ── EMA: Exponential Moving Average ──
    ema(data, period) {
        const result = new Array(data.length).fill(null);
        const k = 2 / (period + 1);
        // Seed with SMA
        let sum = 0;
        for (let i = 0; i < period && i < data.length; i++) sum += data[i];
        if (data.length < period) return result;
        result[period - 1] = sum / period;
        for (let i = period; i < data.length; i++) {
            result[i] = data[i] * k + result[i - 1] * (1 - k);
        }
        return result;
    },

    // ── WMA: Weighted Moving Average ──
    wma(data, period) {
        const result = new Array(data.length).fill(null);
        const denom = (period * (period + 1)) / 2;
        for (let i = period - 1; i < data.length; i++) {
            let sum = 0;
            for (let j = 0; j < period; j++) {
                sum += data[i - j] * (period - j);
            }
            result[i] = sum / denom;
        }
        return result;
    },

    // ── HMA: Hull Moving Average (Zero-Lag) ──
    hma(data, period) {
        const halfLen = Math.floor(period / 2);
        const sqrtLen = Math.floor(Math.sqrt(period));
        const wma1 = this.wma(data, halfLen);
        const wma2 = this.wma(data, period);
        // 2*WMA(half) - WMA(full)
        const diff = new Array(data.length).fill(null);
        for (let i = 0; i < data.length; i++) {
            if (wma1[i] !== null && wma2[i] !== null) {
                diff[i] = 2 * wma1[i] - wma2[i];
            }
        }
        // WMA of diff
        const filtered = diff.filter(v => v !== null);
        if (filtered.length < sqrtLen) return new Array(data.length).fill(null);
        const hmaRaw = this.wma(filtered, sqrtLen);
        // Re-align
        const result = new Array(data.length).fill(null);
        const offset = data.length - filtered.length;
        for (let i = 0; i < hmaRaw.length; i++) {
            result[i + offset] = hmaRaw[i];
        }
        return result;
    },

    // ── RSI: Relative Strength Index ──
    rsi(data, period = 14) {
        const result = new Array(data.length).fill(null);
        if (data.length < period + 1) return result;

        const gains = [];
        const losses = [];
        for (let i = 1; i < data.length; i++) {
            const change = data[i] - data[i - 1];
            gains.push(change > 0 ? change : 0);
            losses.push(change < 0 ? -change : 0);
        }

        // First average
        let avgGain = 0, avgLoss = 0;
        for (let i = 0; i < period; i++) {
            avgGain += gains[i];
            avgLoss += losses[i];
        }
        avgGain /= period;
        avgLoss /= period;

        result[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

        // Smoothed (Wilder's method)
        for (let i = period; i < gains.length; i++) {
            avgGain = (avgGain * (period - 1) + gains[i]) / period;
            avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
            result[i + 1] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
        }
        return result;
    },

    // ── Stochastic (generic) ──
    stoch(data, period) {
        const result = new Array(data.length).fill(null);
        for (let i = period - 1; i < data.length; i++) {
            let hi = -Infinity, lo = Infinity;
            for (let j = 0; j < period; j++) {
                if (data[i - j] > hi) hi = data[i - j];
                if (data[i - j] < lo) lo = data[i - j];
            }
            result[i] = hi === lo ? 50 : ((data[i] - lo) / (hi - lo)) * 100;
        }
        return result;
    },

    // ── StochRSI ──
    stochRsi(data, rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3) {
        const rsiVals = this.rsi(data, rsiPeriod);
        const rsiClean = rsiVals.map(v => v === null ? 0 : v);
        const rawK = this.stoch(rsiClean, stochPeriod);
        const k = this.sma(rawK.map(v => v === null ? 0 : v), kSmooth);
        const d = this.sma(k.map(v => v === null ? 0 : v), dSmooth);
        return { k, d };
    },

    // ── MACD ──
    macd(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
        const emaFast = this.ema(data, fastPeriod);
        const emaSlow = this.ema(data, slowPeriod);
        const macdLine = new Array(data.length).fill(null);
        for (let i = 0; i < data.length; i++) {
            if (emaFast[i] !== null && emaSlow[i] !== null) {
                macdLine[i] = emaFast[i] - emaSlow[i];
            }
        }
        const macdClean = macdLine.map(v => v === null ? 0 : v);
        const signalLine = this.ema(macdClean, signalPeriod);
        const histogram = new Array(data.length).fill(null);
        for (let i = 0; i < data.length; i++) {
            if (macdLine[i] !== null && signalLine[i] !== null) {
                histogram[i] = macdLine[i] - signalLine[i];
            }
        }
        return { macd: macdLine, signal: signalLine, histogram };
    },

    // ── ATR: Average True Range ──
    atr(highs, lows, closes, period = 14) {
        const result = new Array(highs.length).fill(null);
        const tr = new Array(highs.length).fill(0);

        tr[0] = highs[0] - lows[0];
        for (let i = 1; i < highs.length; i++) {
            tr[i] = Math.max(
                highs[i] - lows[i],
                Math.abs(highs[i] - closes[i - 1]),
                Math.abs(lows[i] - closes[i - 1])
            );
        }

        // First ATR is SMA of TR
        let sum = 0;
        for (let i = 0; i < period && i < tr.length; i++) sum += tr[i];
        if (highs.length < period) return result;
        result[period - 1] = sum / period;

        // Smoothed (Wilder's)
        for (let i = period; i < tr.length; i++) {
            result[i] = (result[i - 1] * (period - 1) + tr[i]) / period;
        }
        return result;
    },

    // ── SuperTrend ──
    superTrend(highs, lows, closes, atrPeriod = 10, multiplier = 3) {
        const atrVals = this.atr(highs, lows, closes, atrPeriod);
        const len = closes.length;
        const upperBand = new Array(len).fill(null);
        const lowerBand = new Array(len).fill(null);
        const direction = new Array(len).fill(1); // 1 = bull, -1 = bear
        const stLine = new Array(len).fill(null);

        for (let i = 0; i < len; i++) {
            if (atrVals[i] === null) continue;
            const hl2 = (highs[i] + lows[i]) / 2;
            const basicUpper = hl2 + multiplier * atrVals[i];
            const basicLower = hl2 - multiplier * atrVals[i];

            upperBand[i] = (i > 0 && upperBand[i - 1] !== null)
                ? (basicUpper < upperBand[i - 1] || closes[i - 1] > upperBand[i - 1]) ? basicUpper : upperBand[i - 1]
                : basicUpper;

            lowerBand[i] = (i > 0 && lowerBand[i - 1] !== null)
                ? (basicLower > lowerBand[i - 1] || closes[i - 1] < lowerBand[i - 1]) ? basicLower : lowerBand[i - 1]
                : basicLower;

            if (i === 0) {
                direction[i] = 1;
            } else {
                const prevDir = direction[i - 1];
                if (prevDir === 1) {
                    direction[i] = closes[i] < lowerBand[i] ? -1 : 1;
                } else {
                    direction[i] = closes[i] > upperBand[i] ? 1 : -1;
                }
            }

            stLine[i] = direction[i] === 1 ? lowerBand[i] : upperBand[i];
        }

        return { direction, stLine, upperBand, lowerBand };
    },

    // ── Bollinger Bands ──
    bollingerBands(data, period = 20, mult = 2) {
        const middle = this.sma(data, period);
        const upper = new Array(data.length).fill(null);
        const lower = new Array(data.length).fill(null);
        const bandwidth = new Array(data.length).fill(null);

        for (let i = period - 1; i < data.length; i++) {
            let sumSq = 0;
            for (let j = 0; j < period; j++) {
                const diff = data[i - j] - middle[i];
                sumSq += diff * diff;
            }
            const stdev = Math.sqrt(sumSq / period);
            upper[i] = middle[i] + mult * stdev;
            lower[i] = middle[i] - mult * stdev;
            bandwidth[i] = middle[i] !== 0 ? stdev / middle[i] : 0;
        }

        return { upper, middle, lower, bandwidth };
    },

    // ── CMF: Chaikin Money Flow ──
    cmf(highs, lows, closes, volumes, period = 20) {
        const result = new Array(closes.length).fill(null);
        for (let i = period - 1; i < closes.length; i++) {
            let mfvSum = 0, volSum = 0;
            for (let j = 0; j < period; j++) {
                const idx = i - j;
                const range = highs[idx] - lows[idx];
                const mfm = range === 0 ? 0 : ((closes[idx] - lows[idx]) - (highs[idx] - closes[idx])) / range;
                mfvSum += mfm * volumes[idx];
                volSum += volumes[idx];
            }
            result[i] = volSum === 0 ? 0 : mfvSum / volSum;
        }
        return result;
    },

    // ── OBV: On-Balance Volume ──
    obv(closes, volumes) {
        const result = new Array(closes.length).fill(0);
        result[0] = volumes[0];
        for (let i = 1; i < closes.length; i++) {
            if (closes[i] > closes[i - 1]) result[i] = result[i - 1] + volumes[i];
            else if (closes[i] < closes[i - 1]) result[i] = result[i - 1] - volumes[i];
            else result[i] = result[i - 1];
        }
        return result;
    },

    // ── Choppiness Index ──
    choppiness(highs, lows, closes, period = 14) {
        const atr1 = new Array(closes.length).fill(0);
        atr1[0] = highs[0] - lows[0];
        for (let i = 1; i < closes.length; i++) {
            atr1[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
        }

        const result = new Array(closes.length).fill(null);
        for (let i = period - 1; i < closes.length; i++) {
            let atrSum = 0, hh = -Infinity, ll = Infinity;
            for (let j = 0; j < period; j++) {
                atrSum += atr1[i - j];
                if (highs[i - j] > hh) hh = highs[i - j];
                if (lows[i - j] < ll) ll = lows[i - j];
            }
            const range = hh - ll;
            result[i] = range === 0 ? 100 : (100 * Math.log10(atrSum / range)) / Math.log10(period);
        }
        return result;
    },

    // ── WaveTrend Oscillator ──
    waveTrend(hlc3Data, chanLen = 10, avgLen = 21) {
        const esa = this.ema(hlc3Data, chanLen);
        const d = [];
        for (let i = 0; i < hlc3Data.length; i++) {
            d.push(esa[i] !== null ? Math.abs(hlc3Data[i] - esa[i]) : 0);
        }
        const dd = this.ema(d, chanLen);
        const ci = [];
        for (let i = 0; i < hlc3Data.length; i++) {
            const dv = dd[i] !== null && dd[i] !== 0 ? dd[i] : 1;
            ci.push(esa[i] !== null ? (hlc3Data[i] - esa[i]) / (0.015 * dv) : 0);
        }
        const wt1 = this.ema(ci, avgLen);
        const wt2 = this.sma(wt1.map(v => v === null ? 0 : v), 4);
        return { wt1, wt2 };
    },

    // ── Squeeze Momentum ──
    squeezeMomentum(highs, lows, closes, period = 20) {
        const hh = this.highest(highs, period);
        const ll = this.lowest(lows, period);
        const smaC = this.sma(closes, period);
        const result = new Array(closes.length).fill(null);

        for (let i = period - 1; i < closes.length; i++) {
            if (hh[i] === null || ll[i] === null || smaC[i] === null) continue;
            const avg = (hh[i] + ll[i]) / 2;
            const mid = (avg + smaC[i]) / 2;
            const val = closes[i] - mid;
            result[i] = val;
        }
        // Linear regression smoothing
        return this.linreg(result.map(v => v === null ? 0 : v), period);
    },

    // ── ZLSMA: Zero Lag Smoothed MA ──
    zlsma(data, period = 34) {
        const lsma1 = this.linreg(data, period);
        const lsma2 = this.linreg(lsma1, period);
        const result = new Array(data.length).fill(null);
        for (let i = 0; i < data.length; i++) {
            if (lsma1[i] !== null && lsma2[i] !== null) {
                result[i] = lsma1[i] + (lsma1[i] - lsma2[i]);
            }
        }
        return result;
    },

    // ── Linear Regression ──
    linreg(data, period = 20) {
        const result = new Array(data.length).fill(null);
        for (let i = period - 1; i < data.length; i++) {
            let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
            for (let j = 0; j < period; j++) {
                const x = j;
                const y = data[i - period + 1 + j] || 0;
                sumX += x;
                sumY += y;
                sumXY += x * y;
                sumX2 += x * x;
            }
            const denom = period * sumX2 - sumX * sumX;
            if (denom === 0) { result[i] = data[i]; continue; }
            const slope = (period * sumXY - sumX * sumY) / denom;
            const intercept = (sumY - slope * sumX) / period;
            result[i] = intercept + slope * (period - 1);
        }
        return result;
    },

    // ── ADX: Average Directional Index ──
    adx(highs, lows, closes, period = 14) {
        const len = closes.length;
        const diPlus = new Array(len).fill(null);
        const diMinus = new Array(len).fill(null);
        const adxResult = new Array(len).fill(null);

        const trArr = [highs[0] - lows[0]];
        const dmPlus = [0];
        const dmMinus = [0];

        for (let i = 1; i < len; i++) {
            trArr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
            const upMove = highs[i] - highs[i - 1];
            const downMove = lows[i - 1] - lows[i];
            dmPlus.push(upMove > downMove && upMove > 0 ? upMove : 0);
            dmMinus.push(downMove > upMove && downMove > 0 ? downMove : 0);
        }

        // Smoothed TR, DM+, DM-
        let smoothTR = 0, smoothDMp = 0, smoothDMm = 0;
        for (let i = 0; i < period; i++) {
            smoothTR += trArr[i];
            smoothDMp += dmPlus[i];
            smoothDMm += dmMinus[i];
        }

        let prevDX = [];
        for (let i = period; i < len; i++) {
            smoothTR = smoothTR - smoothTR / period + trArr[i];
            smoothDMp = smoothDMp - smoothDMp / period + dmPlus[i];
            smoothDMm = smoothDMm - smoothDMm / period + dmMinus[i];

            diPlus[i] = smoothTR === 0 ? 0 : (smoothDMp / smoothTR) * 100;
            diMinus[i] = smoothTR === 0 ? 0 : (smoothDMm / smoothTR) * 100;

            const diSum = diPlus[i] + diMinus[i];
            const dx = diSum === 0 ? 0 : Math.abs(diPlus[i] - diMinus[i]) / diSum * 100;
            prevDX.push(dx);

            if (prevDX.length === period) {
                adxResult[i] = prevDX.reduce((a, b) => a + b, 0) / period;
            } else if (prevDX.length > period) {
                adxResult[i] = (adxResult[i - 1] * (period - 1) + dx) / period;
            }
        }

        return { diPlus, diMinus, adx: adxResult };
    },

    // ── Efficiency Ratio (Kaufman) ──
    efficiencyRatio(data, period = 10) {
        const result = new Array(data.length).fill(null);
        for (let i = period; i < data.length; i++) {
            const change = Math.abs(data[i] - data[i - period]);
            let volatility = 0;
            for (let j = 0; j < period; j++) {
                volatility += Math.abs(data[i - j] - data[i - j - 1]);
            }
            result[i] = volatility === 0 ? 0 : change / volatility;
        }
        return result;
    },

    // ── Helpers ──
    highest(data, period) {
        const result = new Array(data.length).fill(null);
        for (let i = period - 1; i < data.length; i++) {
            let max = -Infinity;
            for (let j = 0; j < period; j++) if (data[i - j] > max) max = data[i - j];
            result[i] = max;
        }
        return result;
    },

    lowest(data, period) {
        const result = new Array(data.length).fill(null);
        for (let i = period - 1; i < data.length; i++) {
            let min = Infinity;
            for (let j = 0; j < period; j++) if (data[i - j] < min) min = data[i - j];
            result[i] = min;
        }
        return result;
    },

    // ── Crossover/Crossunder ──
    crossover(a, b) {
        // Returns array of booleans
        const result = new Array(a.length).fill(false);
        for (let i = 1; i < a.length; i++) {
            if (a[i] !== null && b[i] !== null && a[i - 1] !== null && b[i - 1] !== null) {
                result[i] = a[i] > b[i] && a[i - 1] <= b[i - 1];
            }
        }
        return result;
    },

    crossunder(a, b) {
        const result = new Array(a.length).fill(false);
        for (let i = 1; i < a.length; i++) {
            if (a[i] !== null && b[i] !== null && a[i - 1] !== null && b[i - 1] !== null) {
                result[i] = a[i] < b[i] && a[i - 1] >= b[i - 1];
            }
        }
        return result;
    },

    // ── Last valid value ──
    last(arr) {
        for (let i = arr.length - 1; i >= 0; i--) {
            if (arr[i] !== null && !isNaN(arr[i])) return arr[i];
        }
        return null;
    },

    // ── Previous to last ──
    prev(arr, offset = 1) {
        let count = 0;
        for (let i = arr.length - 1; i >= 0; i--) {
            if (arr[i] !== null && !isNaN(arr[i])) {
                if (count === offset) return arr[i];
                count++;
            }
        }
        return null;
    }
};
