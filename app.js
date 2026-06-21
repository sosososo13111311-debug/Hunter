/* ============================================
   DOGE/USDC Binance Futures - ZERO LATENCY Engine v3
   Integrates: Price Engine + Timeframes + Signals + UI
   ============================================ */

(function () {
    'use strict';

    const CONFIG = {
        SYMBOL: 'dogeusdc',
        SYMBOL_UPPER: 'DOGEUSDC',
        REST_BASE: 'https://fapi.binance.com/fapi/v1',
        MAX_TRADES: 50,
        MAX_CHART_POINTS: 150,
        RECONNECT_DELAY_MS: 1000,
        RECONNECT_MAX_DELAY_MS: 15000,
        PRICE_DECIMALS: 6,
        QTY_DECIMALS: 0,
    };

    const WS_URL = 'wss://fstream.binance.com/ws/'
        + CONFIG.SYMBOL + '@aggTrade/'
        + CONFIG.SYMBOL + '@bookTicker/'
        + CONFIG.SYMBOL + '@ticker';

    const state = {
        ws: null, lastPrice: null, tickerCount: 0,
        tradeCountWindow: [], chartPrices: [],
        reconnectAttempts: 0, reconnectTimer: null,
        isConnected: false, _priceColorTimer: null,
        stats: { open: null },
    };

    // ── DOM ──
    const DOM = {};
    [
        'statusIndicator', 'statusText', 'latency', 'liveBadge', 'clock',
        'priceValue', 'priceChange', 'changeValue', 'changePercent',
        'lastUpdate', 'priceFlash', 'high24h', 'low24h', 'volume24h',
        'quoteVolume', 'openPrice', 'tradeCount', 'tradesFeed',
        'tradesPerSec', 'tickerCount', 'priceChart',
        'bidPrice', 'askPrice', 'spread',
        // New MTF elements
        'tfTabs', 'tfPanel', 'tfPrice', 'tfCountdown', 'tfTarget',
        'tfCandleChart', 'enginesGrid', 'engineScore', 'tradeHistoryList',
        // Assistant elements
        'assistantTfLabel'
    ].forEach(id => { 
        const el = document.getElementById(id);
        if (el) DOM[id] = el;
    });

    // ── Utilities ──
    function fmtPrice(v) { const n = parseFloat(v); return isNaN(n) ? '--' : n.toFixed(CONFIG.PRICE_DECIMALS); }
    function fmtVol(v) { const n = parseFloat(v); if (isNaN(n)) return '--'; if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'; if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return n.toFixed(2); }
    function fmtNum(v) { const n = parseFloat(v); return isNaN(n) ? '--' : n.toLocaleString('en-US'); }
    function fmtTime() { return new Date().toLocaleTimeString('en-US', { hour12: false }); }
    function fmtTimeMs(ts) { const d = new Date(ts); return d.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0'); }

    // ── Price Update ──
    function updateMainPrice(price, timestamp) {
        const prev = state.lastPrice;
        state.lastPrice = price;
        DOM.priceValue.textContent = price.toFixed(CONFIG.PRICE_DECIMALS);
        if (prev !== null && price !== prev) {
            const up = price > prev;
            DOM.priceValue.className = up ? 'price-value price-up' : 'price-value price-down';
            DOM.priceFlash.className = up ? 'price-flash flash-green' : 'price-flash flash-red';
            clearTimeout(state._priceColorTimer);
            state._priceColorTimer = setTimeout(() => { DOM.priceValue.className = 'price-value'; }, 300);
        }
        if (state.stats.open !== null) {
            const change = price - state.stats.open;
            const pct = (change / state.stats.open) * 100;
            const pos = change >= 0;
            DOM.changeValue.textContent = (pos ? '+' : '') + change.toFixed(CONFIG.PRICE_DECIMALS);
            DOM.changePercent.textContent = '(' + (pos ? '+' : '') + pct.toFixed(2) + '%)';
            DOM.priceChange.className = 'price-change ' + (pos ? 'positive' : 'negative');
        }
        if (timestamp) DOM.lastUpdate.textContent = 'آخر تحديث: ' + fmtTimeMs(timestamp);
        state.tickerCount++;
        DOM.tickerCount.textContent = state.tickerCount.toLocaleString() + ' تحديث';
    }

    // ── Clock ──
    setInterval(() => { DOM.clock.textContent = fmtTime(); }, 1000);
    DOM.clock.textContent = fmtTime();

    // ── Trades/sec ──
    setInterval(() => {
        const now = Date.now();
        state.tradeCountWindow = state.tradeCountWindow.filter(t => now - t < 1000);
        DOM.tradesPerSec.textContent = state.tradeCountWindow.length;
    }, 250);

    // ── Particles ──
    (function () {
        const c = document.getElementById('particles');
        for (let i = 0; i < 30; i++) {
            const p = document.createElement('div');
            p.classList.add('particle');
            p.style.left = Math.random() * 100 + '%';
            p.style.animationDuration = (8 + Math.random() * 15) + 's';
            p.style.animationDelay = (Math.random() * 10) + 's';
            p.style.width = p.style.height = (1 + Math.random() * 2) + 'px';
            c.appendChild(p);
        }
    })();

    // ── Price Chart (aggTrade) ──
    const chartCtx = DOM.priceChart ? DOM.priceChart.getContext('2d') : null;
    let chartRAF = null;
    function resizeChart() {
        const box = DOM.priceChart.parentElement;
        const dpr = window.devicePixelRatio || 1;
        DOM.priceChart.width = box.clientWidth * dpr;
        DOM.priceChart.height = box.clientHeight * dpr;
        chartCtx.scale(dpr, dpr);
        drawChart();
    }
    window.addEventListener('resize', resizeChart);
    setTimeout(resizeChart, 100);

    function drawChart() {
        const dpr = window.devicePixelRatio || 1;
        const w = DOM.priceChart.width / dpr, h = DOM.priceChart.height / dpr;
        chartCtx.clearRect(0, 0, w, h);
        const prices = state.chartPrices;
        if (prices.length < 2) { chartCtx.fillStyle = '#5a6577'; chartCtx.font = '13px Cairo'; chartCtx.textAlign = 'center'; chartCtx.fillText('في انتظار بيانات الرسم البياني...', w / 2, h / 2); return; }
        const min = Math.min(...prices), max = Math.max(...prices), range = max - min || 0.000001;
        const pad = 10, cw = w - pad * 2, ch = h - pad * 2;
        const up = prices[prices.length - 1] >= prices[0]; const col = up ? '#00E676' : '#FF5252';
        const pts = prices.map((p, i) => ({ x: pad + (i / (prices.length - 1)) * cw, y: pad + ch - ((p - min) / range) * ch }));
        const g = chartCtx.createLinearGradient(0, pad, 0, h - pad);
        g.addColorStop(0, up ? 'rgba(0,230,118,0.15)' : 'rgba(255,82,82,0.15)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        chartCtx.beginPath(); chartCtx.moveTo(pts[0].x, pts[0].y);
        pts.forEach((p, i) => { if (i) chartCtx.lineTo(p.x, p.y); });
        chartCtx.lineTo(pts[pts.length - 1].x, h - pad); chartCtx.lineTo(pts[0].x, h - pad); chartCtx.closePath();
        chartCtx.fillStyle = g; chartCtx.fill();
        chartCtx.beginPath(); chartCtx.moveTo(pts[0].x, pts[0].y);
        pts.forEach((p, i) => { if (i) chartCtx.lineTo(p.x, p.y); });
        chartCtx.strokeStyle = col; chartCtx.lineWidth = 1.5; chartCtx.lineJoin = 'round'; chartCtx.stroke();
        const last = pts[pts.length - 1];
        chartCtx.beginPath(); chartCtx.arc(last.x, last.y, 3, 0, Math.PI * 2); chartCtx.fillStyle = col; chartCtx.fill();
        chartCtx.fillStyle = '#5a6577'; chartCtx.font = '10px JetBrains Mono, monospace'; chartCtx.textAlign = 'left';
        chartCtx.fillText(max.toFixed(CONFIG.PRICE_DECIMALS), pad + 4, pad + 12);
        chartCtx.fillText(min.toFixed(CONFIG.PRICE_DECIMALS), pad + 4, h - pad - 4);
    }

    function setStatus(connected, text) {
        state.isConnected = connected;
        DOM.statusIndicator.className = 'status-indicator ' + (connected ? 'connected' : 'disconnected');
        DOM.statusText.textContent = text;
    }

    // ── aggTrade handler ──
    function handleAggTrade(d, isHistorical) {
        const price = parseFloat(d.p), qty = parseFloat(d.q);
        if (isNaN(price) || isNaN(qty)) return;
        if (!isHistorical) {
            updateMainPrice(price, d.E || d.T);
            state.tradeCountWindow.push(Date.now());
            // ── LIVE candle update: update current candle close price ──
            for (const tf of Object.keys(TFManager.TF_CONFIGS)) {
                const candles = TFManager.data[tf].candles;
                if (candles.length > 0) {
                    const cur = candles[candles.length - 1];
                    cur.close = price;
                    cur.high  = Math.max(cur.high, price);
                    cur.low   = Math.min(cur.low,  price);
                    // Update active trade P&L live
                    const trade = SignalEngine.activeTrades[tf];
                    if (trade) {
                        trade.currentPrice = price;
                        trade.currentPts = trade.direction === 'buy'
                            ? Math.round((price - trade.entry) / SignalEngine.POINT_VALUE)
                            : Math.round((trade.entry - price) / SignalEngine.POINT_VALUE);
                        trade.maxPts = Math.max(trade.maxPts || 0, trade.currentPts);
                    }
                }
            }
        }
        state.chartPrices.push(price);
        if (state.chartPrices.length > CONFIG.MAX_CHART_POINTS) state.chartPrices.shift();
        if (!chartRAF) { chartRAF = requestAnimationFrame(() => { drawChart(); chartRAF = null; }); }
        const row = document.createElement('div');
        row.className = 'trade-row ' + (d.m ? 'sell' : 'buy');
        if (!isHistorical) row.style.animation = 'trade-in 0.3s ease-out';
        row.innerHTML = '<span class="trade-price">' + fmtPrice(price) + '</span><span class="trade-qty">' + qty.toFixed(CONFIG.QTY_DECIMALS) + '</span><span class="trade-total">' + fmtVol(price * qty) + '</span><span class="trade-time">' + fmtTimeMs(d.T) + '</span>';
        const ph = DOM.tradesFeed.querySelector('.trade-placeholder'); if (ph) ph.remove();
        DOM.tradesFeed.insertBefore(row, DOM.tradesFeed.firstChild);
        while (DOM.tradesFeed.children.length > CONFIG.MAX_TRADES) DOM.tradesFeed.removeChild(DOM.tradesFeed.lastChild);
    }

    // ── bookTicker handler ──
    function handleBookTicker(d) {
        const bid = parseFloat(d.b), ask = parseFloat(d.a);
        if (isNaN(bid) || isNaN(ask)) return;
        if (DOM.bidPrice) DOM.bidPrice.textContent = fmtPrice(bid);
        if (DOM.askPrice) DOM.askPrice.textContent = fmtPrice(ask);
        if (DOM.spread) DOM.spread.textContent = ((ask - bid) / bid * 100).toFixed(4) + '%';
        updateMainPrice((bid + ask) / 2, d.E || Date.now());
    }

    // ── ticker handler ──
    function handleTicker(d) {
        state.stats.open = parseFloat(d.o);
        DOM.high24h.textContent = fmtPrice(d.h); DOM.low24h.textContent = fmtPrice(d.l);
        DOM.volume24h.textContent = fmtVol(d.v); DOM.quoteVolume.textContent = fmtVol(d.q);
        DOM.openPrice.textContent = fmtPrice(d.o); DOM.tradeCount.textContent = fmtNum(d.n);
    }

    // ══════════════════════════════════════════
    //  WebSocket
    // ══════════════════════════════════════════
    function connect() {
        if (state.ws) { try { state.ws.close(); } catch (e) {} }
        setStatus(false, 'جاري الاتصال بـ Binance Futures...');
        try { state.ws = new WebSocket(WS_URL); } catch (err) { scheduleReconnect(); return; }
        state.ws.onopen = () => { state.reconnectAttempts = 0; setStatus(true, 'متصل بـ Binance Futures'); };
        state.ws.onmessage = (event) => {
            try {
                const raw = JSON.parse(event.data);
                let data = (raw.stream && raw.data) ? raw.data : raw.e ? raw : null;
                if (!data) return;
                const et = data.E || data.T;
                if (et) { const lat = Date.now() - et; if (lat >= 0 && lat < 60000) DOM.latency.textContent = lat + 'ms'; }
                if (data.e === 'aggTrade') handleAggTrade(data, false);
                else if (data.e === 'bookTicker') handleBookTicker(data);
                else if (data.e === '24hrTicker') handleTicker(data);
            } catch (err) { console.error('[WS] Error:', err); }
        };
        state.ws.onerror = () => {};
        state.ws.onclose = () => { setStatus(false, 'انقطع الاتصال'); scheduleReconnect(); };
    }

    function scheduleReconnect() {
        if (state.reconnectTimer) return;
        state.reconnectAttempts++;
        const delay = Math.min(CONFIG.RECONNECT_DELAY_MS * Math.pow(1.5, state.reconnectAttempts - 1), CONFIG.RECONNECT_MAX_DELAY_MS);
        setStatus(false, `إعادة الاتصال خلال ${Math.round(delay / 1000)} ثوانٍ...`);
        state.reconnectTimer = setTimeout(() => { state.reconnectTimer = null; connect(); }, delay);
    }

    // ── REST init ──
    async function fetchInitialData() {
        try {
            const res = await fetch(CONFIG.REST_BASE + '/ticker/24hr?symbol=' + CONFIG.SYMBOL_UPPER);
            if (res.ok) { const d = await res.json(); state.stats.open = parseFloat(d.openPrice); handleTicker({ o: d.openPrice, h: d.highPrice, l: d.lowPrice, v: d.volume, q: d.quoteVolume, n: d.count }); updateMainPrice(parseFloat(d.lastPrice), Date.now()); }
        } catch (e) {}
        try {
            const res = await fetch(CONFIG.REST_BASE + '/aggTrades?symbol=' + CONFIG.SYMBOL_UPPER + '&limit=' + CONFIG.MAX_TRADES);
            if (res.ok) { const trades = await res.json(); if (Array.isArray(trades)) trades.forEach(t => handleAggTrade(t, true)); }
        } catch (e) {}
        try {
            const res = await fetch(CONFIG.REST_BASE + '/ticker/bookTicker?symbol=' + CONFIG.SYMBOL_UPPER);
            if (res.ok) { const d = await res.json(); handleBookTicker({ b: d.bidPrice, a: d.askPrice }); }
        } catch (e) {}
    }

    // ══════════════════════════════════════════
    //  MTF UI: Tab switching + Rendering
    // ══════════════════════════════════════════

    // Tab click handler
    document.querySelectorAll('.tf-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tf-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            TFManager.activeTab = btn.dataset.tf;
            
            const hunterPanel = document.getElementById('hunterPanel');
            const tfPanel = document.getElementById('tfPanel');
            const asstSection = document.querySelector('.assistant-section');
            
            if (btn.dataset.tf === 'hunter') {
                if (hunterPanel) hunterPanel.style.display = 'block';
                if (tfPanel) tfPanel.style.display = 'none';
            } else {
                if (hunterPanel) hunterPanel.style.display = 'none';
                if (tfPanel) tfPanel.style.display = 'block';
            }
            
            renderTFPanel();
        });
    });

    // ── Candlestick Chart ──
    const candleCtx = DOM.tfCandleChart ? DOM.tfCandleChart.getContext('2d') : null;

    function resizeCandleChart() {
        if (!DOM.tfCandleChart) return;
        const box = DOM.tfCandleChart.parentElement;
        const dpr = window.devicePixelRatio || 1;
        DOM.tfCandleChart.width = box.clientWidth * dpr;
        DOM.tfCandleChart.height = box.clientHeight * dpr;
        candleCtx.scale(dpr, dpr);
    }
    window.addEventListener('resize', resizeCandleChart);
    setTimeout(resizeCandleChart, 200);

    function drawCandleChart(candles) {
        if (!candleCtx) return;
        const dpr = window.devicePixelRatio || 1;
        const w = DOM.tfCandleChart.width / dpr, h = DOM.tfCandleChart.height / dpr;
        candleCtx.clearRect(0, 0, w, h);

        if (!candles || candles.length < 2) {
            candleCtx.fillStyle = '#5a6577'; candleCtx.font = '13px Cairo';
            candleCtx.textAlign = 'center'; candleCtx.fillText('في انتظار بيانات الشموع...', w / 2, h / 2);
            return;
        }

        const pad = 10;
        const cw = w - pad * 2, ch = h - pad * 2;
        let allHigh = -Infinity, allLow = Infinity;
        candles.forEach(c => { if (c.high > allHigh) allHigh = c.high; if (c.low < allLow) allLow = c.low; });
        const range = allHigh - allLow || 0.000001;
        const candleW = Math.max(2, (cw / candles.length) * 0.7);
        const gap = cw / candles.length;

        candles.forEach((c, idx) => {
            const x = pad + idx * gap + gap / 2;
            const yH = pad + ch - ((c.high - allLow) / range) * ch;
            const yL = pad + ch - ((c.low - allLow) / range) * ch;
            const yO = pad + ch - ((c.open - allLow) / range) * ch;
            const yC = pad + ch - ((c.close - allLow) / range) * ch;
            const bull = c.close >= c.open;
            const color = bull ? '#00E676' : '#FF5252';

            // Wick
            candleCtx.beginPath();
            candleCtx.moveTo(x, yH); candleCtx.lineTo(x, yL);
            candleCtx.strokeStyle = color; candleCtx.lineWidth = 1; candleCtx.stroke();

            // Body
            const bodyTop = Math.min(yO, yC);
            const bodyH = Math.max(1, Math.abs(yO - yC));
            candleCtx.fillStyle = bull ? color : color;
            candleCtx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
        });

        // Price labels
        candleCtx.fillStyle = '#5a6577'; candleCtx.font = '10px JetBrains Mono';
        candleCtx.textAlign = 'left';
        candleCtx.fillText(allHigh.toFixed(CONFIG.PRICE_DECIMALS), pad + 4, pad + 12);
        candleCtx.fillText(allLow.toFixed(CONFIG.PRICE_DECIMALS), pad + 4, h - pad - 4);
    }

    // ── Render TF Panel ──
    function renderTFPanel() {
        const tf = TFManager.activeTab;
        
        // If Hunter tab is active, render hunter panel instead
        if (tf === 'hunter') {
            renderHunterPanel();
            return;
        }
        
        const cfg = TFManager.TIMEFRAMES[tf];
        const candles = TFManager.getLastCandles(tf, 30);
        const price = TFManager.getCurrentPrice(tf);

        // Price
        DOM.tfPrice.textContent = price ? price.toFixed(CONFIG.PRICE_DECIMALS) : '--';
        DOM.tfTarget.textContent = cfg.targetPts + ' نقطة';

        // ── Active Trade Banner ──
        const activeTrade = SignalEngine.activeTrades[tf];
        const banner = document.getElementById('activeTradeBanner');
        if (banner) {
            if (activeTrade) {
                const isBuy = activeTrade.direction === 'buy';
                banner.style.display = 'flex';
                banner.className = 'active-trade-banner ' + (isBuy ? 'bull' : 'bear');
                const atbLabel = document.getElementById('atbLabel');
                const atbEntry = document.getElementById('atbEntry');
                const atbTarget = document.getElementById('atbTarget');
                const atbPts = document.getElementById('atbPts');
                if (atbLabel) atbLabel.textContent = (isBuy ? '🟢 صفقة صعود جارية' : '🔴 صفقة هبوط جارية');
                if (atbEntry) atbEntry.textContent = 'دخول: ' + activeTrade.entry.toFixed(6);
                if (atbTarget) atbTarget.textContent = 'هدف: ' + activeTrade.target.toFixed(6);
                const pts = activeTrade.currentPts || 0;
                const ptsStr = (pts >= 0 ? '+' : '') + pts;
                if (atbPts) {
                    atbPts.textContent = ptsStr + ' / ' + cfg.targetPts + ' نقطة';
                    atbPts.style.color = pts >= 0 ? 'var(--green)' : 'var(--red)';
                }
            } else {
                banner.style.display = 'none';
            }
        }

        // Candle chart
        drawCandleChart(candles);

        // Engines — show per-TF min requirement + adaptive mode
        const { bullScore, bearScore, engines, minEngines } = SignalEngine.calculateEngines(tf);
        const grid = DOM.enginesGrid;
        grid.innerHTML = '';

        const strict = SignalEngine.adaptive.isStrict(tf);
        const engineTitle = document.querySelector('.engine-title');
        if (engineTitle) {
            const statsNow = SignalEngine.getStats(tf);
            engineTitle.innerHTML = `المحركات السبعة &nbsp;<span style="color:var(--cyan);font-size:0.7rem">${bullScore}↑ ${bearScore}↓ / يحتاج ${minEngines}</span>${strict ? ' <span style="color:#FF8C00;font-size:0.65rem">⚠️ وضع صارم</span>' : ''}`;
        }

        const engineIcons = ['⚡', '🔥', '💰', '🧠', '🌊', '📊', '🕯️'];
        let idx = 0;
        for (const key of Object.keys(engines)) {
            const eng = engines[key];
            const bullActive = eng.bull;
            const bearActive = eng.bear;
            // Prioritize by current market direction
            const isActive = bullScore >= bearScore ? bullActive : bearActive;
            const cls = bullActive ? 'bull' : bearActive ? 'bear' : 'off';

            const chip = document.createElement('div');
            chip.className = 'engine-chip ' + cls;
            chip.title = bullActive ? eng.desc_bull : (bearActive ? eng.desc_bear : 'غير نشط');
            chip.innerHTML = '<span class="engine-chip-icon">' + engineIcons[idx] + '</span><span>' + eng.name + '</span>';
            grid.appendChild(chip);
            idx++;
        }

        const statsEl = SignalEngine.getStats(tf);
        DOM.engineScore.textContent = `↑${bullScore}/7 | ↓${bearScore}/7 | نجح: ${statsEl.wins} فشل: ${statsEl.losses} (${statsEl.winRate}%)`;

        // Trade history with entry/target/exit prices
        const history = SignalEngine.tradeHistory[tf] || [];
        const histList = DOM.tradeHistoryList;
        histList.innerHTML = '';
        if (history.length === 0) {
            histList.innerHTML = '<div class="trade-placeholder">لا توجد صفقات بعد</div>';
        } else {
            history.slice(0, 10).forEach(t => {
                const row = document.createElement('div');
                const success = t.status === 'success';
                row.className = 'th-row ' + (success ? 'success' : 'fail');
                const dir = t.direction === 'buy' ? '🟢 صعود' : '🔴 هبوط';
                const time = new Date(t.closedAt || t.openedAt).toLocaleTimeString('en-US', { hour12: false });
                const engStr = `${t.bullScore || 0}↑ ${t.bearScore || 0}↓`;
                const adaptStr = t.adaptiveMode ? ' ⚠️' : '';
                row.innerHTML = '<span class="th-dir">' + dir + '</span>'
                    + '<span style="color:#8b95a5;font-size:0.65rem">دخول: ' + (t.entry ? t.entry.toFixed(6) : '--') + ' → ' + (t.target ? t.target.toFixed(6) : '--') + '</span>'
                    + '<span class="th-result" style="color:' + (t.resultColor || '#fff') + '">' + (t.result || '--') + adaptStr + '</span>'
                    + '<span style="color:#5a6577;font-size:0.62rem">' + time + ' [' + engStr + ']</span>';
                histList.appendChild(row);
            });
        }

        // Tab statuses + FIRE indicators
        for (const tfKey of Object.keys(TFManager.TF_CONFIGS)) {
            const trend      = SignalEngine.getTrend(tfKey);
            const statusEl   = document.getElementById('tabStatus-' + tfKey);
            const tabEl      = document.getElementById('tab-' + tfKey);
            const fireEl     = document.getElementById('fire-' + tfKey);
            const hasTrade   = !!SignalEngine.activeTrades[tfKey];
            const r          = SignalEngine.evaluateTF(tfKey);
            const isReady    = !hasTrade && (r.readyBuy || r.readySell);
            const strict     = SignalEngine.adaptive.isStrict(tfKey);

            if (statusEl) {
                statusEl.textContent = trend.label + (strict ? ' ⚠️' : '');
                statusEl.className   = 'tf-tab-status ' + (trend.direction === 'bullish' ? 'bull' : trend.direction === 'bearish' ? 'bear' : 'neutral');
            }

            if (fireEl) {
                if (hasTrade) {
                    fireEl.textContent  = '🔥';
                    fireEl.className    = 'tab-fire fire-active';
                } else if (isReady) {
                    fireEl.textContent  = '🔥';
                    fireEl.className    = 'tab-fire fire-ready';
                } else {
                    fireEl.textContent  = '';
                    fireEl.className    = 'tab-fire';
                }
            }

            if (tabEl) {
                tabEl.classList.remove('has-fire-ready', 'has-fire-active');
                if (hasTrade)   tabEl.classList.add('has-fire-active');
                else if (isReady) tabEl.classList.add('has-fire-ready');
            }
        }
    }




    // ══════════════════════════════════════════
    //  HUNTER PANEL
    // ══════════════════════════════════════════
    
    function updateHunterTabStatus() {
        const statusEl = document.getElementById('tabStatus-hunter');
        const fireEl = document.getElementById('fire-hunter');
        if (!statusEl || !fireEl) return;
        
        if (SignalEngine.hunterTrade) {
            statusEl.textContent = SignalEngine.hunterTrade.direction === 'buy' ? '🟢 قنص صعود' : '🔴 قنص هبوط';
            statusEl.style.color = SignalEngine.hunterTrade.direction === 'buy' ? 'var(--green)' : 'var(--red)';
            fireEl.textContent = '🔥';
            fireEl.className = 'tab-fire fire-active';
        } else {
            const r = SignalEngine.evaluateHunter();
            let readyDir = null;
            if (r.buyVotes > r.sellVotes && r.buyVotes >= 2) readyDir = 'buy';
            if (r.sellVotes > r.buyVotes && r.sellVotes >= 2) readyDir = 'sell';
            
            if (readyDir) {
                statusEl.textContent = readyDir === 'buy' ? '🟢 جاهز' : '🔴 جاهز';
                statusEl.style.color = readyDir === 'buy' ? 'var(--green)' : 'var(--red)';
                fireEl.textContent = '🔥';
                fireEl.className = 'tab-fire fire-ready';
            } else {
                statusEl.textContent = '⏳ مراقبة';
                statusEl.style.color = '';
                fireEl.textContent = '';
                fireEl.className = 'tab-fire';
            }
        }
    }
    
    function renderHunterPanel() {
        const r = SignalEngine.evaluateHunter();
        
        // Render Radar Boxes
        const radar = document.getElementById('hunterRadar');
        if (!radar) return;
        radar.innerHTML = '';
        
        const tfLabels = { '15m': '15 دقيقة', '30m': '30 دقيقة', '1h': '1 ساعة', '4h': '4 ساعات', '1d': 'يومي' };
        
        for (const tf of Object.keys(TFManager.TF_CONFIGS)) {
            const vote = r.details[tf];
            const tfEval = SignalEngine.evaluateTF(tf);
            const bull = tfEval.bullScore;
            const bear = tfEval.bearScore;
            const minReq = tfEval.min;
            
            const box = document.createElement('div');
            
            // Base class
            let boxClass = 'radar-box';
            if (vote === 'buy' || vote === 'tilt_buy') boxClass += ' bull';
            else if (vote === 'sell' || vote === 'tilt_sell') boxClass += ' bear';
            box.className = boxClass;
            
            let label = '--';
            let color = 'var(--text-muted)';
            let icon = '⚪';
            let subtext = '';
            
            if (tfEval && tfEval.summary && tfEval.summary.close) {
                const currentPrice = tfEval.summary.close;
                // نستخدم EMA21 كدعم/مقاومة ديناميكي أكثر دقة
                const emaRef = tfEval.summary.emaSlow || tfEval.summary.stLine;
                const pts = emaRef ? Math.round(Math.abs(currentPrice - emaRef) / 0.000010) : 0;
                const isSupport = emaRef ? currentPrice > emaRef : true;

                if (vote === 'trap') {
                    const trend = SignalEngine.getTrend(tf);
                    label = trend.label.replace('🛑', '').trim();
                    color = '#FF6D00';
                    icon = '🛑';
                    boxClass = 'radar-box trap';
                    subtext = `<span style="font-size:0.65rem; color:#FF6D00; font-weight:bold;">احذر الفخاخ</span>`;
                }
                else if (vote === 'buy') { 
                    label = 'صعود'; color = 'var(--green)'; icon = '🟢'; 
                    subtext = `<span style="font-size:0.65rem; color:#8b95a5">مستوى دعم يبعد ${pts} نقطة ⬇️</span>`;
                }
                else if (vote === 'sell') { 
                    label = 'هبوط'; color = 'var(--red)'; icon = '🔴'; 
                    subtext = `<span style="font-size:0.65rem; color:#8b95a5">مستوى مقاومة يبعد ${pts} نقطة ⬆️</span>`;
                }
                else if (vote === 'tilt_buy') { 
                    label = 'مائل صعود'; color = '#FFD700'; icon = '🟡'; 
                    subtext = isSupport 
                        ? `<span style="font-size:0.65rem; color:#8b95a5">دعم يبعد ${pts} نقطة ⬇️</span>` 
                        : `<span style="font-size:0.65rem; color:#8b95a5">لكسر الاتجاه ينقصه ${pts} نقطة ⬆️</span>`;
                }
                else if (vote === 'tilt_sell') { 
                    label = 'مائل هبوط'; color = '#FFD700'; icon = '🟡'; 
                    subtext = !isSupport 
                        ? `<span style="font-size:0.65rem; color:#8b95a5">مقاومة تبعد ${pts} نقطة ⬆️</span>` 
                        : `<span style="font-size:0.65rem; color:#8b95a5">لكسر الاتجاه ينقصه ${pts} نقطة ⬇️</span>`;
                }
                else { 
                    label = 'حيادي'; 
                    subtext = isSupport 
                        ? `<span style="font-size:0.65rem; color:#8b95a5">دعم يبعد ${pts} نقطة ⬇️</span>` 
                        : `<span style="font-size:0.65rem; color:#8b95a5">مقاومة تبعد ${pts} نقطة ⬆️</span>`;
                }
            }
            
            box.innerHTML = '<div class="radar-tf">' + (tfLabels[tf] || tf) + '</div>'
                + '<div class="radar-status" style="color:' + color + '">' + icon + ' ' + label + '</div>'
                + '<div>' + subtext + '</div>';
            radar.appendChild(box);
        }
        
        // Render Decision
        const votesEl = document.getElementById('hunterVotes');
        const statusEl = document.getElementById('hunterStatus');
        if (!votesEl || !statusEl) return;
        
        votesEl.textContent = '🟢 صعود: ' + r.buyVotes + ' | 🔴 هبوط: ' + r.sellVotes;
        
        if (SignalEngine.hunterTrade) {
            const trade = SignalEngine.hunterTrade;
            const isBuy = trade.direction === 'buy';
            statusEl.textContent = `🔥 جاري قنص الهدف (${trade.targetPts || 20} نقطة) 🔥`;
            statusEl.className = 'hunter-status';
            statusEl.style.color = '#FFD700';
            statusEl.style.textShadow = '0 0 15px rgba(255,215,0,0.8)';
            statusEl.style.fontSize = '1.5rem';
            statusEl.style.fontWeight = 'bold';
            
            // Show entry quality label
            const entryH = trade.entryHealth || 100;
            const isAntic = trade.isAnticipated;
            const entryLabel = isAntic
                ? `⚡ دخول استباقي ذكي (قبل الكسر بـ 25 نقطة) | أمان: ${entryH}%`
                : `✅ دخول مؤكد (${entryH}%) | هدف: ${trade.targetPts || 20} نقطة`;
            const entryLabelEl = document.getElementById('hunterEntryQuality');
            if (entryLabelEl) {
                entryLabelEl.textContent = entryLabel;
                entryLabelEl.style.color = isAntic ? '#00BFFF' : '#00E676';
            }
            
            const banner = document.getElementById('hunterTradeBanner');
            if (banner) {
                banner.style.display = 'block';
                banner.className = 'active-trade-banner ' + (isBuy ? 'bull' : 'bear');
                banner.style.fontSize = '1.2rem';
                banner.style.padding = '20px';
                banner.style.boxShadow = isBuy ? '0 0 30px rgba(0,230,118,0.8)' : '0 0 30px rgba(255,82,82,0.8)';
            }
            
            const atbLabel = document.getElementById('hunterAtbLabel');
            if (atbLabel) atbLabel.textContent = (isBuy ? '🟢 توكل علي الله افتح صفقه صعود 🟢' : '🔴 توكل علي الله افتح صفقه هبوط 🔴');
            
            const atbEntry = document.getElementById('hunterAtbEntry');
            if (atbEntry) atbEntry.textContent = 'دخول: ' + trade.entry.toFixed(6);
            
            const atbTarget = document.getElementById('hunterAtbTarget');
            if (atbTarget) atbTarget.textContent = 'هدف: ' + trade.target.toFixed(6);
            
            const atbPts = document.getElementById('hunterAtbPts');
            if (atbPts) {
                const pts = trade.currentPts || 0;
                atbPts.textContent = (pts >= 0 ? '+' : '') + pts + ' / ' + (trade.targetPts || 20) + ' نقطة';
                atbPts.style.color = pts >= 0 ? 'var(--green)' : 'var(--red)';
            }
            
            const atbLog = document.getElementById('hunterAtbLog');
            if (atbLog) {
                let logHtml = '<strong>📊 المراقبة الحية للاتجاه:</strong><br>';
                if (trade.voteLog && trade.voteLog.length > 0) {
                    trade.voteLog.slice(-5).forEach(log => {
                        let tfStr = '';
                        for (const tf of Object.keys(log.details)) {
                            const v = log.details[tf];
                            tfStr += tf + ':' + (v === 'buy' ? '<span style="color:var(--green)">↑</span>' : v === 'sell' ? '<span style="color:var(--red)">↓</span>' : '<span>-</span>') + ' ';
                        }
                        logHtml += `<div style="margin-top:4px"><span style="color:#6b7585">[${log.timeStr}]</span> أصوات: صعود ${log.buy} | هبوط ${log.sell} — ${tfStr} </div>`;
                    });
                } else {
                    logHtml += '<span style="color:#6b7585">جاري جمع البيانات...</span>';
                }
                atbLog.innerHTML = logHtml;
            }
        } else {
            const banner = document.getElementById('hunterTradeBanner');
            if (banner) banner.style.display = 'none';
            
            // Check if both engines are active
            const radar = document.getElementById('hunterRadar');
            if (!SignalEngine.smartAnalyzerActive || !SignalEngine.smartHealerActive) {
                statusEl.innerHTML = `⚠️ <b>يرجى تفعيل (المفكر الذكي) و (المعالج الفوري) لبدء قراءة السوق</b>`;
                statusEl.className = 'hunter-status';
                statusEl.style.color = '#8b95a5';
                statusEl.style.textShadow = '';
                statusEl.style.fontSize = '0.9rem';
                if (radar) radar.style.opacity = '0.2';
                return; // Stop rendering further if not active
            }
            
            // Check boot sequence
            if (SignalEngine.systemBooting) {
                const now = Date.now();
                if (now >= SignalEngine.systemBootEndTime) {
                    SignalEngine.systemBooting = false;
                    SignalEngine.systemBooted = true;
                    // Will continue to normal rendering
                } else {
                    const secLeft = Math.ceil((SignalEngine.systemBootEndTime - now) / 1000);
                    statusEl.innerHTML = `⏳ <b>جاري قراءة السوق والشموع والمؤشرات والفلاتر ومطابقتها... يرجى الانتظار (${secLeft} ثانية)</b>`;
                    statusEl.className = 'hunter-status';
                    statusEl.style.color = '#FFD700';
                    statusEl.style.textShadow = '0 0 10px rgba(255,215,0,0.5)';
                    statusEl.style.fontSize = '0.85rem';
                    if (radar) radar.style.opacity = '0.2';
                    return; // Block signals during boot
                }
            }
            
            if (radar) radar.style.opacity = '1';
            
            // Check if nuclear filter is blocking
            const nuclearReason = SignalEngine.hunterNuclearReason;
            
            let readyDir = null;
            let isConfirmed = false;
            
            if (r.buyVotes > r.sellVotes && r.buyVotes >= 2) readyDir = 'buy';
            if (r.sellVotes > r.buyVotes && r.sellVotes >= 2) readyDir = 'sell';
            
            if (readyDir === 'buy' && r.buyVotes >= SignalEngine.HUNTER_MIN_VOTES) isConfirmed = true;
            if (readyDir === 'sell' && r.sellVotes >= SignalEngine.HUNTER_MIN_VOTES) isConfirmed = true;
            
            const now = Date.now();
            let isCoolingDown = false;
            let cooldownMsg = '';
            
            const maxVotes = Math.max(r.buyVotes, r.sellVotes);
            
            if (SignalEngine.hunterCooldownUntil > now) {
                isCoolingDown = true;
                const sec = Math.ceil((SignalEngine.hunterCooldownUntil - now) / 1000);
                cooldownMsg = `⏳ استراحة إجبارية لحماية الأرباح: ${sec} ثانية...`;
            } else if (!SignalEngine.hunterConditionsReset && isConfirmed) {
                isCoolingDown = true;
                cooldownMsg = '⏳ إعادة قراءة للسوق: ننتظر هدوء الزخم وتأكيد السيولة لدورة جديدة...';
            }
            
            if (isCoolingDown) {
                statusEl.innerHTML = `<b>${cooldownMsg}</b>`;
                statusEl.className = 'hunter-status';
                statusEl.style.color = '#FFD700';
                statusEl.style.textShadow = '';
                statusEl.style.fontSize = '0.9rem';
                statusEl.style.fontWeight = 'bold';
            } else if (nuclearReason) {
                statusEl.textContent = nuclearReason;
                statusEl.className = 'hunter-status';
                statusEl.style.color = '#FF6D00';
                statusEl.style.textShadow = '0 0 10px rgba(255,109,0,0.5)';
                statusEl.style.fontSize = '0.85rem';
                statusEl.style.fontWeight = 'bold';
            } else if (SignalEngine.hunterHealthWarning) {
                statusEl.innerHTML = `⚠️ <b>${SignalEngine.hunterHealthWarning}</b>`;
                statusEl.className = 'hunter-status';
                statusEl.style.color = '#FFD700';
                statusEl.style.textShadow = '0 0 8px rgba(255,215,0,0.4)';
                statusEl.style.fontSize = '0.85rem';
                statusEl.style.fontWeight = 'bold';
            } else if (readyDir === 'buy') {
                if (isConfirmed) {
                    statusEl.innerHTML = `🟢 <b>صعود مؤكد 100% | توكل علي الله ان شاء الله صفقه ناجحه</b> 🟢`;
                    statusEl.className = 'hunter-status ready-bull';
                    statusEl.style.color = '#00ff88';
                    statusEl.style.textShadow = '0 0 10px rgba(0,255,136,0.5)';
                    statusEl.style.fontSize = '0.95rem';
                } else {
                    statusEl.innerHTML = `⏳ <b>الفرمات المتواجده حاليا شروطها صحيحه خليك مستعد ان شاء الله</b>`;
                    statusEl.className = 'hunter-status';
                    statusEl.style.color = '#FFD700';
                    statusEl.style.textShadow = '';
                    statusEl.style.fontSize = '0.85rem';
                }
                statusEl.style.fontWeight = 'bold';
            } else if (readyDir === 'sell') {
                if (isConfirmed) {
                    statusEl.innerHTML = `🔴 <b>هبوط مؤكد 100% | توكل علي الله ان شاء الله صفقه ناجحه</b> 🔴`;
                    statusEl.className = 'hunter-status ready-bear';
                    statusEl.style.color = '#ff3366';
                    statusEl.style.textShadow = '0 0 10px rgba(255,51,102,0.5)';
                    statusEl.style.fontSize = '0.95rem';
                } else {
                    statusEl.innerHTML = `⏳ <b>الفرمات المتواجده حاليا شروطها صحيحه خليك مستعد ان شاء الله</b>`;
                    statusEl.className = 'hunter-status';
                    statusEl.style.color = '#FFD700';
                    statusEl.style.textShadow = '';
                    statusEl.style.fontSize = '0.85rem';
                }
                statusEl.style.fontWeight = 'bold';
            } else if (r.buyVotes > 0 || r.sellVotes > 0) {
                statusEl.innerHTML = `✅ <b>تم قراءة السوق والمؤشرات والفلاتر بنجاح. جاري إرسال البيانات اللحظية كل 3 ثواني</b>`;
                statusEl.className = 'hunter-status';
                statusEl.style.color = '#00E676';
                statusEl.style.textShadow = '';
                statusEl.style.fontSize = '0.85rem';
                statusEl.style.fontWeight = 'normal';
            } else {
                statusEl.innerHTML = `✅ <b>تم قراءة السوق والمؤشرات والفلاتر بنجاح. جاري إرسال البيانات لحظة بلحظة (Tick-by-Tick)</b>`;
                statusEl.className = 'hunter-status';
                statusEl.style.color = '#00E676';
                statusEl.style.textShadow = '';
                statusEl.style.fontSize = '0.85rem';
                statusEl.style.fontWeight = 'normal';
            }
        }
        
        // Render Hunter History
        const list = document.getElementById('hunterHistoryList');
        if (!list) return;
        
        if (!SignalEngine.hunterHistory) {
            SignalEngine.initHunterHistory();
        }
        
        const history = SignalEngine.hunterHistory;
        if (!history || history.length === 0) {
            list.innerHTML = '<div class="trade-placeholder">\u0644\u0627 \u062a\u0648\u062c\u062f \u0635\u0641\u0642\u0627\u062a \u0642\u0646\u0635 \u0628\u0639\u062f</div>';
        } else {
            list.innerHTML = '';
            // Show all trades for the day
            history.forEach(t => {
                const row = document.createElement('div');
                const success = t.status === 'success';
                row.className = 'th-row ' + (success ? 'success' : 'fail');
                row.style.cssText = 'padding:10px;margin-bottom:8px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid ' + (success ? 'rgba(0,230,118,0.3)' : 'rgba(255,82,82,0.3)');
                const dir = t.direction === 'buy' ? '\ud83d\udfe2 \u0635\u0639\u0648\u062f' : '\ud83d\udd34 \u0647\u0628\u0648\u0637';
                const time = new Date(t.closedAt || t.openedAt).toLocaleTimeString('en-US', { hour12: false });
                const openTime = new Date(t.openedAt).toLocaleTimeString('en-US', { hour12: false });
                
                // Build TF vote detail at entry
                let entryVoteHtml = '';
                if (t.entryVotes && t.entryVotes.details) {
                    entryVoteHtml = '<div style="margin-top:4px;font-size:0.65rem;color:#8b95a5">\u062a\u0635\u0648\u064a\u062a \u0627\u0644\u062f\u062e\u0648\u0644: ';
                    for (const tf of Object.keys(t.entryVotes.details)) {
                        const v = t.entryVotes.details[tf];
                        const icon = v === 'buy' ? '<span style="color:var(--green)">\u2191</span>' : v === 'sell' ? '<span style="color:var(--red)">\u2193</span>' : '<span>-</span>';
                        entryVoteHtml += tf + ':' + icon + ' ';
                    }
                    entryVoteHtml += '</div>';
                }
                
                // Build vote log summary (show last 5 entries)
                let logHtml = '';
                if (t.voteLog && t.voteLog.length > 0) {
                    logHtml = '<div style="margin-top:4px;font-size:0.6rem;color:#5a6577;border-top:1px solid rgba(255,255,255,0.05);padding-top:4px">';
                    logHtml += '\ud83d\udcca \u0633\u062c\u0644 \u0627\u0644\u062a\u063a\u064a\u0631\u0627\u062a:<br>';
                    t.voteLog.slice(-5).forEach(log => {
                        let tfStr = '';
                        for (const tf of Object.keys(log.details)) {
                            const v = log.details[tf];
                            tfStr += tf + ':' + (v === 'buy' ? '\u2191' : '\u2193') + ' ';
                        }
                        logHtml += '<span style="color:#6b7585">' + log.timeStr + '</span> [' + log.buy + 'v' + log.sell + '] ' + tfStr + ' (' + (log.pts >= 0 ? '+' : '') + log.pts + '\u0646\u0642\u0637\u0629)<br>';
                    });
                    logHtml += '</div>';
                }
                
                row.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center">'
                    + '<span class="th-dir" style="font-weight:bold">' + dir + ' (\u0642\u0646\u0627\u0635)</span>'
                    + '<span class="th-result" style="color:' + (t.resultColor || '#fff') + ';font-weight:bold">' + (t.result || '--') + '</span>'
                    + '</div>'
                    + '<div style="color:#8b95a5;font-size:0.65rem;margin-top:4px">\u062f\u062e\u0648\u0644: ' + (t.entry ? t.entry.toFixed(6) : '--') + ' \u2192 \u0647\u062f\u0641: ' + (t.target ? t.target.toFixed(6) : '--') + (t.closePrice ? ' | \u0625\u063a\u0644\u0627\u0642: ' + t.closePrice.toFixed(6) : '') + '</div>'
                    + '<div style="color:#5a6577;font-size:0.62rem">\u0641\u062a\u062d: ' + openTime + ' | \u0623\u0642\u0635\u0649: +' + (t.maxPts || 0) + '\u0646\u0642\u0637\u0629</div>'
                    + entryVoteHtml
                    + logHtml;
                list.appendChild(row);
            });
        }
    }

    // ══════════════════════════════════════════
    //  MAIN UPDATE LOOP
    // ══════════════════════════════════════════
    const _prevFireState = {};

    function mainLoop() {
        try { 
            for (const tf of Object.keys(TFManager.TF_CONFIGS)) {
                if (TFManager.data[tf].candles.length > 0) {
                    TFManager.calculateIndicators(tf);
                }
            }
            SignalEngine.evaluateAll(); 
        } catch(e) { console.warn('[mainLoop] evaluateAll error:', e); }
        try { SignalEngine.evaluateHunterSignals(); } catch(e) { console.warn('[mainLoop] hunterSignals error:', e); }

        // Fire sound triggers (once per state change)
        try {
            for (const tfKey of Object.keys(TFManager.TF_CONFIGS)) {
                const hasTrade  = !!SignalEngine.activeTrades[tfKey];
                const r         = SignalEngine.evaluateTF(tfKey);
                const isReady   = !hasTrade && (r.readyBuy || r.readySell);
                const prev      = _prevFireState[tfKey] || { hasTrade: false, isReady: false };
                if (isReady && !prev.isReady && !prev.hasTrade) SignalEngine.playAlert('ready');
                _prevFireState[tfKey] = { hasTrade, isReady };
            }
        } catch(e) {}
        
        try { updateHunterTabStatus(); } catch(e) {}
        try { renderTFPanel(); } catch(e) { console.warn('[mainLoop] renderTFPanel error:', e); }
    }


    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && (!state.ws || state.ws.readyState !== WebSocket.OPEN)) connect();
    });

    // ══════════════════════════════════════════
    //  SMART ANALYZER TOGGLE
    // ══════════════════════════════════════════
    const btnSmart = document.getElementById('btnSmartAnalyzer');
    const btnHealer = document.getElementById('btnSmartHealer');
    const logPanel = document.getElementById('smartAnalyzerLogPanel');

    function checkBootSequence() {
        if (SignalEngine.smartAnalyzerActive && SignalEngine.smartHealerActive) {
            if (!SignalEngine.systemBooted && !SignalEngine.systemBooting) {
                SignalEngine.systemBooting = true;
                SignalEngine.systemBootEndTime = Date.now() + 30000;
                if (logPanel && logPanel.style.display !== 'none') {
                    SignalEngine.smartLog('🚀 بدء الإقلاع الآمن: جاري قراءة السوق والشموع والمؤشرات والفلاتر ومطابقتها... يرجى الانتظار 30 ثانية', 'healer-action');
                }
            }
        } else {
            SignalEngine.systemBooting = false;
            SignalEngine.systemBooted = false;
            SignalEngine.systemBootEndTime = 0;
        }
    }

    if (btnSmart) {
        btnSmart.addEventListener('click', () => {
            SignalEngine.smartAnalyzerActive = !SignalEngine.smartAnalyzerActive;
            
            if (SignalEngine.smartAnalyzerActive) {
                btnSmart.className = 'btn-smart-active';
                btnSmart.textContent = '🧠 المفكر الذكي: يعمل 🟢';
                logPanel.style.display = 'block';
                SignalEngine.smartLog('تم تفعيل المفكر الذكي. يتم فحص السوق كل 3 ثواني...', 'success');
                SignalEngine.runSmartAnalysis();
                
                if (SignalEngine.smartAnalyzerInterval) clearInterval(SignalEngine.smartAnalyzerInterval);
                SignalEngine.smartAnalyzerInterval = setInterval(() => {
                    SignalEngine.runSmartAnalysis();
                }, 3000);
            } else {
                btnSmart.className = 'btn-smart-inactive';
                btnSmart.textContent = '🧠 تشغيل المفكر الذكي';
                SignalEngine.smartLog('تم إيقاف المفكر الذكي.', 'warning');
                setTimeout(() => { if (!SignalEngine.smartAnalyzerActive) logPanel.style.display = 'none'; }, 2000);
                
                if (SignalEngine.smartAnalyzerInterval) clearInterval(SignalEngine.smartAnalyzerInterval);
                SignalEngine.smartAnalyzerInterval = null;
            }
            checkBootSequence();
        });
    }

    if (btnHealer) {
        btnHealer.addEventListener('click', () => {
            SignalEngine.smartHealerActive = !SignalEngine.smartHealerActive;
            if (SignalEngine.smartHealerActive) {
                btnHealer.className = 'btn-healer-active';
                btnHealer.innerHTML = '🛡️ المعالج الفوري: يعمل';
                if (SignalEngine.smartAnalyzerActive) {
                    SignalEngine.smartLog('🛡️ تم تفعيل المعالج الفوري: جاري تنقية الشوائب ومعالجة تناقضات الفريمات لحظياً...', 'success');
                }
            } else {
                btnHealer.className = 'btn-healer-inactive';
                btnHealer.innerHTML = '🛡️ تشغيل المعالج الفوري';
                if (SignalEngine.smartAnalyzerActive) {
                    SignalEngine.smartLog('⚠️ تم إيقاف المعالج الفوري.', 'warning');
                }
            }
            checkBootSequence();
        });
    }

    // ══════════════════════════════════════════
    //  INIT
    // ══════════════════════════════════════════
    console.log('[DOGE/USDC Futures] Initializing v4 - Real-Time MTF Sniper...');
    SignalEngine.init();
    TFManager.init();
    // Speed up Long/Short to every 5 seconds
    clearInterval(TFManager._lsInterval);
    TFManager._lsInterval = setInterval(() => TFManager.fetchLongShortAll(), 5000);
    fetchInitialData();
    connect();
    // Run every 500ms for near real-time updates
    setInterval(mainLoop, 500);
    setTimeout(mainLoop, 3000);
    console.log('[DOGE/USDC Futures] ✅ Engine v4 ready - Real-Time Mode');
})();

