/* ============================================
   Timeframe Manager v2 - Per-TF Indicator Configs
   Each timeframe has its own optimized settings
   ============================================ */

const TFManager = {
    REST_BASE: 'https://fapi.binance.com/fapi/v1',
    FUTURES_DATA: 'https://fapi.binance.com/futures/data',
    SYMBOL: 'DOGEUSDC',
    KLINE_LIMIT: 120,

    // ══════════════════════════════════════════
    //  PER-TIMEFRAME INDICATOR CONFIGS
    //  Each TF has its own optimized settings
    // ══════════════════════════════════════════
    TF_CONFIGS: {
        '15m': {
            label: '15 دقيقة', interval: '15m', targetPts: 20,
            ms: 15 * 60 * 1000,
            klineLimit: 80, // Max EMA is 21 -> 21*3 convergence = ~63, 80 is perfect
            // 🚀 Scalping: Fibonacci fast moving averages
            emaFast: 8, emaSlow: 13, emaTrend: 21,
            rsiPeriod: 7, // Fast RSI for momentum bursts
            stochRsi: { rsi: 14, stoch: 14, k: 3, d: 3 }, // Standard Stoch to filter noise
            macd: { fast: 8, slow: 21, signal: 5 }, // Fibonacci MACD to ignore small chop
            atrPeriod: 10,
            superTrend: { atr: 10, mult: 2.0 }, // Sensitive but not jumpy
            bb: { period: 20, mult: 2.0 },
            chopPeriod: 14,
            cmfPeriod: 20,
            waveTrend: { chan: 9, avg: 12 },
            squeezePeriod: 20,
            adxPeriod: 14,
            zlsmaPeriod: 21,
            hmaPeriod: 14,
            volSmaPeriod: 20,
            chopMax: 61.8, // Fibonacci ratio for chop
            rsiMaxBuy: 80,
            rsiMinSell: 20,
            adxMin: 20,
            atrFactor: 0.4,
            waitForClose: true,
        },
        '30m': {
            label: '30 دقيقة', interval: '30m', targetPts: 30,
            ms: 30 * 60 * 1000,
            klineLimit: 120, // Max EMA is 34 -> 34*3 = 102, 120 is perfect
            // ⚔️ Intraday: Medium Fibonacci
            emaFast: 13, emaSlow: 21, emaTrend: 34,
            rsiPeriod: 10,
            stochRsi: { rsi: 14, stoch: 14, k: 3, d: 3 },
            macd: { fast: 12, slow: 26, signal: 9 }, // Standard MACD
            atrPeriod: 14,
            superTrend: { atr: 10, mult: 2.5 },
            bb: { period: 20, mult: 2.0 },
            chopPeriod: 14,
            cmfPeriod: 20,
            waveTrend: { chan: 10, avg: 21 },
            squeezePeriod: 20,
            adxPeriod: 14,
            zlsmaPeriod: 34,
            hmaPeriod: 21,
            volSmaPeriod: 20,
            chopMax: 61.8,
            rsiMaxBuy: 75,
            rsiMinSell: 25,
            adxMin: 22,
            atrFactor: 0.5,
            waitForClose: true,
        },
        '1h': {
            label: '1 ساعة', interval: '1h', targetPts: 40,
            ms: 60 * 60 * 1000,
            klineLimit: 250, // Max EMA=100 → 100*2.5=250 شمعة = ~10 أيام (مثالي لتأكيد الترند)
            // 🏦 Swing: Institutional Key Levels (20, 50, 100)
            emaFast: 20, emaSlow: 50, emaTrend: 100,
            rsiPeriod: 14,
            stochRsi: { rsi: 14, stoch: 14, k: 3, d: 3 },
            macd: { fast: 12, slow: 26, signal: 9 },
            atrPeriod: 14,
            superTrend: { atr: 14, mult: 3.0 }, // Standard strict
            bb: { period: 20, mult: 2.0 },
            chopPeriod: 14, cmfPeriod: 20,
            waveTrend: { chan: 10, avg: 21 },
            squeezePeriod: 20, adxPeriod: 14, zlsmaPeriod: 50, hmaPeriod: 21, volSmaPeriod: 20,
            chopMax: 61.8, rsiMaxBuy: 70, rsiMinSell: 30, adxMin: 25, atrFactor: 0.6,
            waitForClose: true,
        },
        '4h': {
            label: '4 ساعات', interval: '4h', targetPts: 40,
            ms: 4 * 60 * 60 * 1000,
            klineLimit: 200, // Max EMA=50 → 50*3=150+buffer=200 شمعة = ~33 يوم (كافي لقراءة الترند الكبير)
            // 🐋 Big Swing: Scalping-Optimized Macro
            emaFast: 13, emaSlow: 34, emaTrend: 50,
            rsiPeriod: 14,
            stochRsi: { rsi: 14, stoch: 14, k: 3, d: 3 },
            macd: { fast: 12, slow: 26, signal: 9 },
            atrPeriod: 14,
            superTrend: { atr: 14, mult: 3.0 },
            bb: { period: 20, mult: 2.0 },
            chopPeriod: 14, cmfPeriod: 20,
            waveTrend: { chan: 10, avg: 21 },
            squeezePeriod: 20, adxPeriod: 14, zlsmaPeriod: 50, hmaPeriod: 21, volSmaPeriod: 20,
            chopMax: 61.8, rsiMaxBuy: 70, rsiMinSell: 30, adxMin: 25, atrFactor: 0.7,
            waitForClose: true,
        },
        '1d': {
            label: 'يومي', interval: '1d', targetPts: 50,
            ms: 24 * 60 * 60 * 1000,
            klineLimit: 150, // Max EMA=50 → 50*3=150 شمعة = ~5 أشهر (كافي لقراءة الاتجاه العام)
            // 🌍 Macro: Daily Trend Confirmation
            emaFast: 13, emaSlow: 21, emaTrend: 50,
            rsiPeriod: 14,
            stochRsi: { rsi: 14, stoch: 14, k: 3, d: 3 },
            macd: { fast: 12, slow: 26, signal: 9 },
            atrPeriod: 14,
            superTrend: { atr: 14, mult: 4.0 }, // Very strict for macro trend
            bb: { period: 20, mult: 2.0 },
            chopPeriod: 14, cmfPeriod: 20,
            waveTrend: { chan: 10, avg: 21 },
            squeezePeriod: 20, adxPeriod: 14, zlsmaPeriod: 50, hmaPeriod: 21, volSmaPeriod: 20,
            chopMax: 61.8, rsiMaxBuy: 70, rsiMinSell: 30, adxMin: 25, atrFactor: 0.8,
            waitForClose: true,
        },
    },

    // For backward compat
    get TIMEFRAMES() { return this.TF_CONFIGS; },

    data: {},
    indicators: {},
    activeTab: '15m',
    longShortRatio: {},

    init() {
        for (const tf of Object.keys(this.TF_CONFIGS)) {
            this.data[tf] = { candles: [], lastUpdate: 0 };
            this.indicators[tf] = {};
            this.longShortRatio[tf] = { longPct: 50, shortPct: 50 };
        }
        this.fetchAll();
        setInterval(() => this.fetchAll(), 5000);
        setInterval(() => this.fetchLongShortAll(), 15000);
        this.fetchLongShortAll();
        setInterval(() => this.updateCountdowns(), 1000);
    },

    async fetchAll() {
        await Promise.allSettled(Object.keys(this.TF_CONFIGS).map(tf => this.fetchKlines(tf)));
        if (typeof SignalEngine !== 'undefined' && !SignalEngine._hasSynced) {
            SignalEngine.syncHistoricalTrades();
        }
    },

    async fetchKlines(tf) {
        try {
            const cfg = this.TF_CONFIGS[tf];
            const limit = cfg.klineLimit || 120;
            const url = `${this.REST_BASE}/klines?symbol=${this.SYMBOL}&interval=${cfg.interval}&limit=${limit}`;
            const res = await fetch(url);
            if (!res.ok) return;
            const raw = await res.json();
            if (!Array.isArray(raw) || raw.length < 30) return;
            const candles = raw.map(k => ({
                time: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
                low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]),
                closeTime: k[6], quoteVol: parseFloat(k[7]), trades: parseInt(k[8]),
                takerBuyVol: parseFloat(k[9]), takerBuyQuoteVol: parseFloat(k[10]),
            }));
            this.data[tf].candles = candles;
            this.data[tf].lastUpdate = Date.now();
            this.calculateIndicators(tf);
        } catch (err) {
            console.warn(`[TF] Failed to fetch ${tf}:`, err);
        }
    },

    async fetchLongShortAll() {
        for (const tf of Object.keys(this.TF_CONFIGS)) {
            try {
                const period = { '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '4h': '4h', '1d': '1d' }[tf];
                const url = `${this.FUTURES_DATA}/globalLongShortAccountRatio?symbol=${this.SYMBOL}&period=${period}&limit=1`;
                const res = await fetch(url);
                if (!res.ok) continue;
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) {
                    const ratio = parseFloat(data[0].longShortRatio);
                    const longPct = (ratio / (1 + ratio)) * 100;
                    this.longShortRatio[tf] = { longPct, shortPct: 100 - longPct, ratio };
                }
            } catch (err) { /* silent */ }
        }
    },

    // ══════════════════════════════════════════
    //  CALCULATE INDICATORS (PER-TF SETTINGS)
    // ══════════════════════════════════════════
    calculateIndicators(tf) {
        const candles = this.data[tf].candles;
        const C = this.TF_CONFIGS[tf]; // per-TF config
        if (candles.length < 30) return;

        const closes  = candles.map(c => c.close);
        const highs   = candles.map(c => c.high);
        const lows    = candles.map(c => c.low);
        const volumes = candles.map(c => c.volume);
        const opens   = candles.map(c => c.open);
        const hlc3    = candles.map(c => (c.high + c.low + c.close) / 3);

        const ind = {};

        // ── EMA (per-TF periods) ──
        ind.emaFast  = TA.ema(closes, C.emaFast);
        ind.emaSlow  = TA.ema(closes, C.emaSlow);
        ind.emaTrend = TA.ema(closes, C.emaTrend);

        // ── RSI ──
        ind.rsi = TA.rsi(closes, C.rsiPeriod);

        // ── StochRSI ──
        ind.stochRsi = TA.stochRsi(closes, C.stochRsi.rsi, C.stochRsi.stoch, C.stochRsi.k, C.stochRsi.d);

        // ── MACD ──
        ind.macdData = TA.macd(closes, C.macd.fast, C.macd.slow, C.macd.signal);

        // ── ATR ──
        ind.atr = TA.atr(highs, lows, closes, C.atrPeriod);

        // ── SuperTrend ──
        ind.superTrend = TA.superTrend(highs, lows, closes, C.superTrend.atr, C.superTrend.mult);

        // ── Bollinger Bands ──
        ind.bb = TA.bollingerBands(closes, C.bb.period, C.bb.mult);

        // ── CMF ──
        ind.cmf = TA.cmf(highs, lows, closes, volumes, C.cmfPeriod);

        // ── OBV ──
        ind.obv = TA.obv(closes, volumes);
        ind.obvEma = TA.ema(ind.obv, C.volSmaPeriod);

        // ── Choppiness ──
        ind.chop = TA.choppiness(highs, lows, closes, C.chopPeriod);

        // ── HMA ──
        ind.hma = TA.hma(closes, C.hmaPeriod);

        // ── ADX ──
        ind.adxData = TA.adx(highs, lows, closes, C.adxPeriod);

        // ── ZLSMA ──
        ind.zlsma = TA.zlsma(closes, C.zlsmaPeriod);

        // ── Volume SMA ──
        ind.volSma = TA.sma(volumes, C.volSmaPeriod);

        // ── WaveTrend ──
        ind.waveTrend = TA.waveTrend(hlc3, C.waveTrend.chan, C.waveTrend.avg);

        // ── Squeeze Momentum ──
        ind.squeeze = TA.squeezeMomentum(highs, lows, closes, C.squeezePeriod);

        // ── Efficiency Ratio ──
        ind.er = TA.efficiencyRatio(closes, C.atrPeriod);

        // ── MACD Histogram direction (expanding = momentum) ──
        const macdHist = ind.macdData.histogram;
        const lastH = TA.last(macdHist) || 0;
        const prevH = TA.prev(macdHist) || 0;
        ind.macdExpanding = Math.abs(lastH) > Math.abs(prevH);
        ind.macdHistPos   = lastH > 0;

        // ── Stoch crossover ──
        const kArr = ind.stochRsi.k;
        const dArr = ind.stochRsi.d;
        const crossArr = TA.crossover(kArr, dArr);
        const crossUnderArr = TA.crossunder(kArr, dArr);
        ind.stochCross     = crossArr[crossArr.length - 1] || crossArr[crossArr.length - 2];
        ind.stochCrossUnder= crossUnderArr[crossUnderArr.length - 1] || crossUnderArr[crossUnderArr.length - 2];

        // ── Candlestick Patterns ──
        const i = candles.length - 1;
        const body = Math.abs(closes[i] - opens[i]);
        const candleRange = highs[i] - lows[i];
        const upperWick = highs[i] - Math.max(closes[i], opens[i]);
        const lowerWick = Math.min(closes[i], opens[i]) - lows[i];
        const avgBody = TA.last(TA.sma(candles.map(c => Math.abs(c.close - c.open)), C.bb.period)) || body;
        const bodyRatio = candleRange > 0 ? body / candleRange : 0;

        ind.candlePatterns = {
            bullishEngulfing: closes[i] > opens[i] && closes[i-1] < opens[i-1] && closes[i] > opens[i-1] && opens[i] < closes[i-1],
            bearishEngulfing: closes[i] < opens[i] && closes[i-1] > opens[i-1] && closes[i] < opens[i-1] && opens[i] > closes[i-1],
            hammer:       closes[i] > opens[i] && lowerWick > body * 2 && upperWick < body * 0.5,
            shootingStar: closes[i] < opens[i] && upperWick > body * 2 && lowerWick < body * 0.5,
            isBullish: closes[i] > opens[i],
            isBearish: closes[i] < opens[i],
            isDoji: candleRange > 0 && body < candleRange * 0.10, // Doji = جسم أقل من 10% = تردد السوق
            isLongBody: body > avgBody * 1.5,
            bodyRatio: bodyRatio,
            isSolid: bodyRatio >= 0.35, // الجسم يمثل على الأقل 35% من الشمعة (ليست دوجي أو قمة دوارة)
            // Adaptive wick filter per TF (shorter TF = more strict)
            wickRatio: candleRange > 0 ? upperWick / candleRange : 0,
            lowerWickRatio: candleRange > 0 ? lowerWick / candleRange : 0,
            safeBull: candleRange > 0 ? (upperWick / candleRange) < (tf === '15m' ? 0.5 : 0.6) : true,
            safeBear: candleRange > 0 ? (lowerWick / candleRange) < (tf === '15m' ? 0.5 : 0.6) : true,
        };

        // ── Volume analysis ──
        const lastVol = volumes[i];
        const lastVolSma = TA.last(ind.volSma) || lastVol;
        ind.volumeSpike  = lastVol > lastVolSma * 1.3;
        ind.whaleVolume  = lastVol > lastVolSma * 2.5;
        ind.volumeRatio  = lastVolSma > 0 ? lastVol / lastVolSma : 1;

        // ── Buy/Sell pressure ──
        const buyPressure = candleRange > 0 ? (closes[i] - lows[i]) / candleRange : 0.5;
        ind.buyPct  = buyPressure * 100;
        ind.sellPct = (1 - buyPressure) * 100;

        // ── BB squeeze detection ──
        const bbBandwidth = TA.last(ind.bb.bandwidth);
        const prevBbBandwidth = TA.prev(ind.bb.bandwidth);
        ind.bbExpanding = bbBandwidth > (prevBbBandwidth || 0);

        // ── Taker buy ratio (smart money) ──
        const totalTakerBuy = candles.slice(-C.cmfPeriod).reduce((s, c) => s + c.takerBuyVol, 0);
        const totalVol      = candles.slice(-C.cmfPeriod).reduce((s, c) => s + c.volume, 0);
        ind.takerBuyRatio = totalVol > 0 ? totalTakerBuy / totalVol : 0.5;

        // ── Store config reference ──
        ind.cfg = C;

        // ── Raw arrays ──
        ind.closes  = closes;
        ind.highs   = highs;
        ind.lows    = lows;
        ind.volumes = volumes;
        ind.opens   = opens;

        this.indicators[tf] = ind;
    },

    // ── Countdown ──
    getCountdown(tf) {
        const candles = this.data[tf].candles;
        if (!candles.length) return { text: '--:--', seconds: 0 };
        const remaining = Math.max(0, candles[candles.length - 1].closeTime - Date.now());
        const totalSec = Math.floor(remaining / 1000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        const text = h > 0
            ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
            : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        return { text, seconds: totalSec };
    },

    updateCountdowns() {
        const el = document.getElementById('tfCountdown');
        if (el) {
            const cd = this.getCountdown(this.activeTab);
            el.textContent = cd.text;
            el.className = 'countdown-value' + (cd.seconds < 10 ? ' countdown-critical' : '');
        }
    },

    getLastCandles(tf, count = 30) {
        return this.data[tf].candles.slice(-count);
    },

    getCurrentPrice(tf) {
        const c = this.data[tf].candles;
        return c.length ? c[c.length - 1].close : null;
    },

    // ── Indicator Summary (per-TF) ──
    getIndicatorSummary(tf) {
        const ind = this.indicators[tf];
        if (!ind || !ind.closes || !ind.cfg) return null;
        const C = ind.cfg;
        const i = ind.closes.length - 1;
        const close = ind.closes[i];

        const rsi  = TA.last(ind.rsi);
        const stK  = TA.last(ind.stochRsi.k);
        const stD  = TA.last(ind.stochRsi.d);
        const macdL = TA.last(ind.macdData.macd);
        const macdS = TA.last(ind.macdData.signal);
        const cmfV  = TA.last(ind.cmf);
        const chop  = TA.last(ind.chop);
        const adxV  = TA.last(ind.adxData.adx);
        const atrV  = TA.last(ind.atr);
        const emaF  = TA.last(ind.emaFast);
        const emaS  = TA.last(ind.emaSlow);
        const emaT  = TA.last(ind.emaTrend);
        const zlsma = TA.last(ind.zlsma);
        const hmaLast = TA.last(ind.hma);
        const hmaPrev = TA.prev(ind.hma);
        const wt1   = TA.last(ind.waveTrend.wt1);
        const wt2   = TA.last(ind.waveTrend.wt2);
        const sqzV  = TA.last(ind.squeeze);
        const sqzP  = TA.prev(ind.squeeze);

        return {
            close,
            // EMA
            emaFast: emaF, emaSlow: emaS, emaTrend: emaT,
            emaBull: emaF > emaS,
            emaStackBull: emaF > emaS && emaS > emaT,
            emaStackBear: emaF < emaS && emaS < emaT,
            // RSI (using per-TF thresholds)
            rsi, rsiPeriod: C.rsiPeriod,
            rsiOverbought: rsi > C.rsiMaxBuy,
            rsiOversold: rsi < C.rsiMinSell,
            rsiBullZone: rsi > 50 && rsi < C.rsiMaxBuy,
            rsiBearZone: rsi < 50 && rsi > C.rsiMinSell,
            // StochRSI
            stochK: stK, stochD: stD,
            stochBull: stK > stD,
            stochCross: ind.stochCross,
            stochCrossUnder: ind.stochCrossUnder,
            stochOversold: stK < 20 && stD < 20,
            stochOverbought: stK > 80 && stD > 80,
            // MACD
            macdLine: macdL, macdSignal: macdS,
            macdBull: macdL > macdS,
            macdHistPos: ind.macdHistPos,
            macdExpanding: ind.macdExpanding,
            // SuperTrend
            stBull: ind.superTrend.direction[i] === 1,
            stLine: TA.last(ind.superTrend.stLine),
            // BB
            bbUpper: TA.last(ind.bb.upper),
            bbLower: TA.last(ind.bb.lower),
            bbWidth: TA.last(ind.bb.bandwidth),
            bbExpanding: ind.bbExpanding,
            priceNearBbLower: close < (TA.last(ind.bb.middle) || close),
            priceNearBbUpper: close > (TA.last(ind.bb.middle) || close),
            // ATR
            atr: atrV,
            // CMF
            cmf: cmfV,
            cmfBull: cmfV > 0.02,
            cmfBear: cmfV < -0.02,
            // OBV
            obvBull: TA.last(ind.obv) > TA.last(ind.obvEma),
            // Choppiness
            chop, chopPass: chop < C.chopMax,
            // ADX
            adx: adxV,
            adxStrong: adxV > C.adxMin,
            diPlusBull: (TA.last(ind.adxData.diPlus) || 0) > (TA.last(ind.adxData.diMinus) || 0),
            // Volume
            volumeSpike: ind.volumeSpike,
            whaleVolume: ind.whaleVolume,
            volumeRatio: ind.volumeRatio,
            takerBuyBull: ind.takerBuyRatio > 0.55,
            takerSellBear: ind.takerBuyRatio < 0.45,
            // ZLSMA
            zlsma, aboveZlsma: close > (zlsma || close),
            // HMA
            hmaBull: hmaLast > hmaPrev,
            // WaveTrend
            wt1, wt2,
            wtBull: wt1 > wt2,
            wtCrossUp:   wt1 > wt2 && (TA.prev(ind.waveTrend.wt1) || 0) <= (TA.prev(ind.waveTrend.wt2) || 0),
            wtCrossDown: wt1 < wt2 && (TA.prev(ind.waveTrend.wt1) || 0) >= (TA.prev(ind.waveTrend.wt2) || 0),
            wtOversold:  wt1 < -53,
            wtOverbought: wt1 > 53,
            // Squeeze
            sqzVal: sqzV,
            sqzBull: sqzV > 0 && sqzV > sqzP,
            sqzBear: sqzV < 0 && sqzV < sqzP,
            // Buy/Sell pressure
            buyPct: ind.buyPct, sellPct: ind.sellPct,
            // Candle
            candles: ind.candlePatterns,
            // Config ref
            cfg: C,
            // Timestamp for Healer heartbeat
            timestamp: this.data[tf]?.lastUpdate || Date.now(),
        };
    },
};
