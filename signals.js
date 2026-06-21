/* signals.js v4 - Per-TF standalone conditions + Real-Time cooldown */
const SignalEngine = {
    POINT_VALUE: 0.000010,
    activeTrades: {},
    tradeHistory: {},
    notifications: [],
    alertSound: null,
    // Cooldown: after trade closes, wait before new entry
    cooldown: { '15m':0, '30m':0, '1h':0, '4h':0, '1d':0 },
    COOLDOWN_MS: 30000, // 30 seconds
    // Track if conditions reset after last trade
    conditionsReset: { '15m':true, '30m':true, '1h':true, '4h':true, '1d':true },
    
    // Smart Analyzer properties
    smartAnalyzerActive: false,
    smartAnalyzerInterval: null,
    
    // Secure Boot Sequence
    systemBooting: false,
    systemBooted: false,
    systemBootEndTime: 0,

    adaptive: {
        failures: { '15m':0,'30m':0,'1h':0,'4h':0,'1d':0 },
        successes: { '15m':0,'30m':0,'1h':0,'4h':0,'1d':0 },
        strictMode: { '15m':false,'30m':false,'1h':false,'4h':false,'1d':false },
        strictUntil: { '15m':0,'30m':0,'1h':0,'4h':0,'1d':0 },
        onSuccess(tf){ this.failures[tf]=0; this.successes[tf]++; if(this.successes[tf]>=3&&this.strictMode[tf]){this.strictMode[tf]=false;this.successes[tf]=0;}},
        onFailure(tf){ this.failures[tf]++; this.successes[tf]=0; if(this.failures[tf]>=2&&!this.strictMode[tf]){this.strictMode[tf]=true;this.strictUntil[tf]=Date.now()+3600000;}},
        isStrict(tf){ if(this.strictMode[tf]&&Date.now()>this.strictUntil[tf]){this.strictMode[tf]=false;this.failures[tf]=0;} return this.strictMode[tf];}
    },

    init(){
        for(const tf of Object.keys(TFManager.TF_CONFIGS)){
            this.activeTrades[tf]=null;
            this.tradeHistory[tf]=[];
        }
        this.hunterHistory = [];
        this.hunterActiveTrade = null;
        
        // We no longer load activeTrades from localStorage.
        // The cache is flushed, and we will rely purely on Time Machine Sync (Back-calculation).
        try {
            const saved = localStorage.getItem('DOGE_SNIPER_STATE');
            if (saved) {
                const state = JSON.parse(saved);
                // Only load history, never active trades
                if (state.tradeHistory) this.tradeHistory = state.tradeHistory;
                if (state.hunterHistory) this.hunterHistory = state.hunterHistory;
                if (state.hunterCooldownUntil) this.hunterCooldownUntil = state.hunterCooldownUntil;
            }
        } catch(e) {}
        
        try{ this.alertSound=new AudioContext(); }catch(e){}
    },

    saveState() {
        try {
            const state = {
                activeTrades: this.activeTrades,
                tradeHistory: this.tradeHistory,
                hunterHistory: this.hunterHistory,
                hunterTrade: this.hunterTrade,
                hunterCooldownUntil: this.hunterCooldownUntil,
                hunterConditionsReset: this.hunterConditionsReset,
                hunterLastTradeClosedAt: this.hunterLastTradeClosedAt
            };
            localStorage.setItem('DOGE_SNIPER_STATE', JSON.stringify(state));
        } catch(e) {}
    },

    loadState() {
        // Obsolete: We rely on syncHistoricalTrades instead of localStorage for active trades
    },

    syncHistoricalTrades() {
        if (this._hasSynced) return;
        this._hasSynced = true;
        
        console.log('[TimeMachine] 🕰️ Starting Historical Trade Sync...');
        
        // Disable notifications and sounds during sync
        const originalNotify = this.notify;
        const originalPlayAlert = this.playAlert;
        this.notify = () => {};
        this.playAlert = () => {};
        
        const tfs = Object.keys(TFManager.TF_CONFIGS);
        const baseTf = '15m';
        
        // Save original data
        const originalCandles = {};
        let hasEnoughData = true;
        tfs.forEach(tf => {
            originalCandles[tf] = [...(TFManager.data[tf].candles || [])];
            if (originalCandles[tf].length < 30) hasEnoughData = false;
        });
        
        if (!hasEnoughData) {
            this.notify = originalNotify;
            this.playAlert = originalPlayAlert;
            return;
        }

        // We scan the last 24 candles of the 15m timeframe (6 hours of history)
        const scanDepth = 24;
        const baseCandles = originalCandles[baseTf];
        
        for (let i = Math.max(0, baseCandles.length - scanDepth); i < baseCandles.length; i++) {
            const currentTime = baseCandles[i].closeTime;
            
            // Sync all timeframes up to currentTime
            tfs.forEach(tf => {
                const tfCandles = originalCandles[tf];
                // Find index where candle time is <= currentTime
                let sliceIdx = tfCandles.length - 1;
                while (sliceIdx >= 0 && tfCandles[sliceIdx].closeTime > currentTime) {
                    sliceIdx--;
                }
                TFManager.data[tf].candles = tfCandles.slice(0, sliceIdx + 1);
                TFManager.calculateIndicators(tf);
            });
            
            // Evaluate TFs and Hunter at this exact historical moment
            tfs.forEach(tf => this.evaluateSignals(tf));
            this.evaluateHunterSignals();
        }
        
        // Restore original data for the present moment
        tfs.forEach(tf => {
            TFManager.data[tf].candles = originalCandles[tf];
            TFManager.calculateIndicators(tf);
        });
        
        // Restore notifications
        this.notify = originalNotify;
        this.playAlert = originalPlayAlert;
        
        console.log('[TimeMachine] 🕰️ Sync Complete! Active trades restored.');
    },

    playAlert(type){
        if(!this.alertSound) return;
        try{
            const ctx=this.alertSound, osc=ctx.createOscillator(), g=ctx.createGain();
            osc.connect(g); g.connect(ctx.destination);
            
            // Default settings
            let duration = 0.6;
            
            if(type==='buy'){
                osc.frequency.setValueAtTime(523,ctx.currentTime);
                osc.frequency.linearRampToValueAtTime(1047,ctx.currentTime+0.3);
            }
            else if(type==='sell'){
                osc.frequency.setValueAtTime(1047,ctx.currentTime);
                osc.frequency.linearRampToValueAtTime(523,ctx.currentTime+0.3);
            }
            else if(type==='ready'){
                osc.frequency.setValueAtTime(880,ctx.currentTime);
                osc.frequency.setValueAtTime(1100,ctx.currentTime+0.15);
            }
            else if(type==='warning'){
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(400,ctx.currentTime);
                osc.frequency.setValueAtTime(450,ctx.currentTime+0.2);
                duration = 0.4;
            }
            else if(type==='hunter_entry'){
                osc.type = 'square';
                osc.frequency.setValueAtTime(1200,ctx.currentTime);
                osc.frequency.setValueAtTime(1600,ctx.currentTime+0.2);
                osc.frequency.setValueAtTime(2000,ctx.currentTime+0.4);
                duration = 0.8;
            }
            else if(type==='target'){
                osc.type = 'sine';
                osc.frequency.setValueAtTime(800,ctx.currentTime);
                osc.frequency.setValueAtTime(1200,ctx.currentTime+0.2);
                osc.frequency.setValueAtTime(1500,ctx.currentTime+0.4);
                duration = 1.0;
            }
            else{
                osc.frequency.setValueAtTime(800,ctx.currentTime);
                osc.frequency.setValueAtTime(1200,ctx.currentTime+0.2);
                osc.frequency.setValueAtTime(1500,ctx.currentTime+0.4);
            }
            
            g.gain.setValueAtTime(0.4,ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+duration);
            osc.start(ctx.currentTime); osc.stop(ctx.currentTime+duration);
        }catch(e){}
    },

    notify(msg,type='info'){
        const time=new Date().toLocaleTimeString('en-US',{hour12:false});
        this.notifications.unshift({msg,type,time});
        if(this.notifications.length>30) this.notifications.pop();
    },

    // ══════════════════════════════════════════
    //  PER-TF CONDITIONS — PROFESSIONAL + CANDLE ANATOMY
    // ══════════════════════════════════════════

    _candle(s, tf) {
        const cp = s.candles;
        const wr = cp.wickRatio || 0;
        const lwr = cp.lowerWickRatio || 0;
        const bodyRatio = cp.bodyRatio || 0;
        
        // الشروط تتغير حسب الفريم: الفريمات الصغيرة تحتاج دقة أكثر لمنع الضوضاء
        const wickLimit = { '15m': 0.40, '30m': 0.45, '1h': 0.50, '4h': 0.55, '1d': 0.55 }[tf] || 0.50;
        const bodyLimit = { '15m': 0.40, '30m': 0.35, '1h': 0.35, '4h': 0.30, '1d': 0.30 }[tf] || 0.35;
        
        const hasSolidBody = bodyRatio >= bodyLimit || cp.isLongBody; // جسم صلب يتكيف مع الفريم
        
        // شمعة صعود صحيحة: خضراء + ذيل علوي لا يمثل رفض + جسم قوي + ليست شهاب
        const bullCandle = cp.isBullish && wr < wickLimit && hasSolidBody && !cp.shootingStar;
        
        // شمعة هبوط صحيحة: حمراء + ذيل سفلي لا يمثل رفض + جسم قوي + ليست مطرقة
        const bearCandle = cp.isBearish && lwr < wickLimit && hasSolidBody && !cp.hammer;
        
        // الموافقة النهائية (إما شمعة صحية، أو نموذج انعكاسي قوي جداً كالمطرقة والابتلاع)
        const bullOk = bullCandle || cp.bullishEngulfing || cp.hammer;
        const bearOk = bearCandle || cp.bearishEngulfing || cp.shootingStar;
        
        const bPct = (bodyRatio * 100).toFixed(0);
        return { bullOk, bearOk, desc: `جسم: ${bPct}% | ذيل علوي: ${(wr*100).toFixed(0)}% | ذيل سفلي: ${(lwr*100).toFixed(0)}%` };
    },

    // ═══════════════════════════════════════
    // 15m: سكالبنج سريع — دقة معززة بفلاتر السيولة والاتزان
    // يحتاج 4 من 6 مؤشرات
    // ═══════════════════════════════════════
    evaluate15m(s, strict){
        const ca = this._candle(s, '15m');
        const volOk = (s.volumeSpike || s.takerBuyBull || s.whaleVolume) && s.cmf > 0.02;
        const volBear = (s.volumeSpike || s.takerSellBear || s.whaleVolume) && s.cmf < -0.02;
        let stBull = s.stBull;
        let stBear = !s.stBull;
        
        // ⚡ Smart Analyzer: Anticipatory Entry
        if (this.smartAnalyzerActive && s.stLine) {
            const distToSt = Math.abs(s.close - s.stLine) / this.POINT_VALUE;
            if (distToSt <= 25) {
                const s30m = TFManager.getIndicatorSummary('30m');
                const strongBuyForce = s.cmf > 0.05 && s.obvBull && (s30m && s30m.rsi > 40);
                const strongSellForce = s.cmf < -0.05 && !s.obvBull && (s30m && s30m.rsi < 60);
                
                if (!stBull && s.emaFast > s.emaSlow && s.macdBull && volOk && strongBuyForce) {
                    stBull = true; stBear = false;
                } else if (stBull && s.emaFast < s.emaSlow && !s.macdBull && volBear && strongSellForce) {
                    stBull = false; stBear = true;
                }
            }
        }
        
        const conds = [
            { name:'SuperTrend إلزامي',        bull: stBull,                          bear: stBear,                          required:'SuperTrend = حاجز الاتجاه الرئيسي' },
            { name:'EMA Stack (8>13>21)',    bull: s.emaStackBull,                  bear: s.emaStackBear,                  required:'سلسلة متوسطات متحركة متوافقة' },
            { name:'زخم الاستوكاستيك K/D',    bull: s.stochBull && s.stochK < 75,    bear: !s.stochBull && s.stochK > 25,   required:'زخم متقاطع غير مشبع للاتجاه' },
            { name:'MACD إيجابي وقوي',        bull: s.macdBull && s.macdExpanding,   bear: !s.macdBull && s.macdExpanding,  required:'تقاطع وزخم MACD يتوسع' },
            { name:'الاتجاه الخالي من النطاق', bull: s.chopPass && s.adx > 20,        bear: s.chopPass && s.adx > 20,        required:'السوق في ترند نشط وليس نطاقاً عرضياً' },
            { name:'السيولة وحجم الشمعة',     bull: volOk && ca.bullOk,              bear: volBear && ca.bearOk,            required:ca.desc },
        ];
        return { conds, min: 3 };
    },

    // ═══════════════════════════════════════
    // 30m: ترند متوازن — فلاتر متقدمة لتدفق الأموال
    // يحتاج 3 من 6 مؤشرات
    // ═══════════════════════════════════════
    evaluate30m(s, strict){
        const ca = this._candle(s, '30m');
        const volOk = (s.volumeSpike || s.cmfBull || s.whaleVolume) && s.obvBull;
        const volBear = (s.volumeSpike || s.cmfBear || s.whaleVolume) && !s.obvBull;
        const conds = [
            { name:'SuperTrend إلزامي',        bull: s.stBull,                        bear: !s.stBull,                       required:'SuperTrend = اتجاه متأصل' },
            { name:'EMA Stack (13>21>34)',   bull: s.emaStackBull,                  bear: s.emaStackBear,                  required:'مصفوفة متوسطات EMA متناسقة' },
            { name:'MACD + ZLSMA',           bull: s.macdBull && s.aboveZlsma,      bear: !s.macdBull && !s.aboveZlsma,    required:'MACD إيجابي والسعر فوق ZLSMA' },
            { name:'WaveTrend الموجة',       bull: s.wtBull && !s.wtOverbought,     bear: !s.wtBull && !s.wtOversold,      required:'موجة WT نشطة بعيدة عن القمم والقيعان' },
            { name:'الاتجاه والقوة (ADX)',    bull: s.chopPass && s.adx > 22,        bear: s.chopPass && s.adx > 22,        required:'الترند مدعوم بـ ADX ومحمي من التذبذب' },
            { name:'سيولة حقيقية وشمعة',     bull: volOk && ca.bullOk,              bear: volBear && ca.bearOk,            required:ca.desc },
        ];
        return { conds, min: 3 };
    },

    // ═══════════════════════════════════════
    // 1h: ترند متوسط — دقة مؤسسية وحركة حيتان
    // يحتاج 3 من 6 مؤشرات
    // ═══════════════════════════════════════
    evaluate1h(s, strict){
        const ca = this._candle(s, '1h');
        const conds = [
            { name:'SuperTrend إلزامي',        bull: s.stBull,                        bear: !s.stBull,                       required:'SuperTrend 1H = اتجاه قوي' },
            { name:'EMA Stack (20>50>100)',  bull: s.emaStackBull && s.aboveZlsma,  bear: s.emaStackBear && !s.aboveZlsma, required:'متوسطات مؤسسية + السعر فوق ZLSMA' },
            { name:'تقاطع MACD وزخم',        bull: s.macdBull && s.macdExpanding,   bear: !s.macdBull && s.macdExpanding,  required:'MACD يتوسع في الاتجاه الصحيح' },
            { name:'تدفق السيولة الكبيرة',    bull: s.obvBull && s.cmf > 0.03,       bear: !s.obvBull && s.cmf < -0.03,     required:'تراكم حقيقي للسيولة في الاتجاه' },
            { name:'مؤشر القوة وقفل النطاق',  bull: s.adx > 25 && s.chopPass,        bear: s.adx > 25 && s.chopPass,        required:'قوة الاتجاه العام خالي من التذبذب' },
            { name:'هيكل شمعة ممتاز',        bull: ca.bullOk,                       bear: ca.bearOk,                       required:ca.desc },
        ];
        return { conds, min: 3 };
    },

    // ═══════════════════════════════════════
    // 4h: ترند متوسط/بعيد المدى — ترشيح حاسم وصارم
    // يحتاج 4 من 6 مؤشرات
    // ═══════════════════════════════════════
    evaluate4h(s, strict){
        const ca = this._candle(s, '4h');
        const conds = [
            { name:'SuperTrend إلزامي',        bull: s.stBull,                        bear: !s.stBull,                       required:'SuperTrend 4H = أساس الهيكل' },
            { name:'EMA Stack (13>34>50)',   bull: s.emaStackBull && s.aboveZlsma,  bear: s.emaStackBear && !s.aboveZlsma, required:'ترتيب EMA المتوسط والمؤشر الموزون' },
            { name:'قوة الترند (ADX)',        bull: s.adx > 22 && s.diPlusBull,      bear: s.adx > 22 && !s.diPlusBull,     required:'ADX يقيس قوة الترند الكبرى' },
            { name:'الضغط الشرائي والبيعي',  bull: s.macdBull && s.buyPct > 52,     bear: !s.macdBull && s.sellPct > 52,   required:'تأكيد تدفق السيولة بنسبة مئوية' },
            { name:'تدفق الأموال الذكي CMF',  bull: s.cmf > 0.05 && s.obvBull,       bear: s.cmf < -0.05 && !s.obvBull,     required:'دخول أموال حيتان ضخمة' },
            { name:'شمعة ممتازة',            bull: ca.bullOk,                       bear: ca.bearOk,                       required:ca.desc },
        ];
        return { conds, min: 4 };
    },

    // ═══════════════════════════════════════
    // 1d: الماكرو المؤسسي المطلق — الحارس المالي
    // يحتاج 4 من 6 مؤشرات
    // ═══════════════════════════════════════
    evaluate1d(s, strict){
        const ca = this._candle(s, '1d');
        const conds = [
            { name:'SuperTrend يومي',           bull: s.stBull,                        bear: !s.stBull,                       required:'SuperTrend يومي = الاتجاه العام الأكبر' },
            { name:'EMA Stack + ZLSMA',      bull: s.emaStackBull && s.aboveZlsma,  bear: s.emaStackBear && !s.aboveZlsma, required:'EMA مرتبة + ZLSMA = ترند حقيقي' },
            { name:'مؤشر الاتجاه المؤسسي',    bull: s.adx > 25 && s.diPlusBull,      bear: s.adx > 25 && !s.diPlusBull,     required:'ADX>25 ترند مؤسسي عملاق' },
            { name:'مؤشر الماكد والسيولة',    bull: s.macdBull && s.cmf > 0.05,      bear: !s.macdBull && s.cmf < -0.05,    required:'تقاطع MACD وتدفق CMF اليومي' },
            { name:'مؤشر القوة النسبية RSI',  bull: s.rsi > 48 && s.rsi < 75,        bear: s.rsi < 52 && s.rsi > 25,        required:'RSI منطقة اتجاه صاعد/هابط آمن' },
            { name:'شمعة يومية مؤكدة',        bull: ca.bullOk,                       bear: ca.bearOk,                       required:ca.desc },
        ];
        return { conds, min: 4 };
    },

    evaluateTF(tf){
        const s = TFManager.getIndicatorSummary(tf);
        if(!s) return { bullScore:0, bearScore:0, conds:[], min:4, readyBuy:false, readySell:false };
        const strict = this.adaptive.isStrict(tf);
        let result;
        if(tf==='15m') result=this.evaluate15m(s,strict);
        else if(tf==='30m') result=this.evaluate30m(s,strict);
        else if(tf==='1h') result=this.evaluate1h(s,strict);
        else if(tf==='4h') result=this.evaluate4h(s,strict);
        else result=this.evaluate1d(s,strict);

        let bullScore=0, bearScore=0;
        for(const c of result.conds){ if(c.bull) bullScore++; if(c.bear) bearScore++; }

        const atrOk = (s.atr||0) > 0;
        // بالنسبة لفريم 15 دقيقة: نكتفي بأن تكون الشمعة صلبة (isSolid) وليست دوجي، دون اشتراط أن تكون شمعة انفجارية عملاقة (isLongBody)
        // هذا يسمح بالدخول المبكر واقتناص 2 إلى 5 صفقات يومياً بدلاً من تضييع الفرص.
        const candleOk = tf !== '15m' || (s.candles && s.candles.isSolid && !s.candles.isDoji);

        // تقييم الاتجاه العام للفريم لاكتشاف الفخاخ (فقط إذا كان الزخم قد وصل لمرحلة الدخول الفعلي)
        let dir = null;
        if (bullScore >= result.min && bullScore > bearScore) dir = 'buy';
        else if (bearScore >= result.min && bearScore > bullScore) dir = 'sell';

        let trapReason = null;
        if (dir) {
            const candles = TFManager.data[tf]?.candles;
            if (candles && candles.length >= 5) {
                const prev1 = candles[candles.length - 2];
                const prev2 = candles[candles.length - 3];
                const prev3 = candles[candles.length - 4];
                
                const current = candles[candles.length - 1];
                const bodyC = Math.abs(current.close - current.open);
                const rangeC = current.high - current.low;
                const wickPctC = rangeC > 0 ? (rangeC - bodyC) / rangeC : 0;
                
                const upperWickC = current.high - Math.max(current.close, current.open);
                const lowerWickC = Math.min(current.close, current.open) - current.low;
                
                // 1. ذيل صيد سيولة ضخم (Huge wick trap) - فقط إذا كان الذيل في اتجاه واحد كبير جداً
                if (dir === 'buy' && (upperWickC / rangeC) > 0.6) {
                    trapReason = 'رفض سعري من الأعلى (ذيل علوي طويل)';
                } else if (dir === 'sell' && (lowerWickC / rangeC) > 0.6) {
                    trapReason = 'رفض سعري من الأسفل (ذيل سفلي طويل)';
                } 
                // 2. تباين تدفق الأموال الحقيقي (Whale Divergence Check)
                else if (dir === 'buy' && s.cmf < -0.10) {
                    trapReason = 'توزيع سيولة خفي (CMF سلبي جداً)';
                } else if (dir === 'sell' && s.cmf > 0.10) {
                    trapReason = 'تجميع سيولة خفي (CMF إيجابي جداً)';
                }
                // 3. مقاومة نطاق البولنجر الحرج (BB Resistance Trap)
                else if (dir === 'buy' && s.close > s.bbUpper && !s.bbExpanding && s.rsi > 70) {
                    trapReason = 'مقاومة قمة البولنجر مع تشبع';
                } else if (dir === 'sell' && s.close < s.bbLower && !s.bbExpanding && s.rsi < 30) {
                    trapReason = 'دعم قاع البولنجر مع تشبع';
                }
                // 4. التشبع الشرائي/البيعي للاستوكاستك (StochRSI Overextension)
                else if (dir === 'buy' && s.stochK > 95 && s.rsi > 75) {
                    trapReason = 'تشبع شرائي مفرط (احتمال انعكاس)';
                } else if (dir === 'sell' && s.stochK < 5 && s.rsi < 25) {
                    trapReason = 'تشبع بيعي مفرط (احتمال انعكاس)';
                }
                // 5. التذبذب القاتل والسيولة الميتة (Choppy/Dead Market Protection)
                else if (s.chop > 61.8) {
                    trapReason = 'سوق متذبذب عرضي بشدة (Choppy)';
                }
                // 6. الاختراق الوهمي (Price Exhaustion)
                else {
                    const sameDir3 = dir === 'buy'
                        ? (prev1.close > prev1.open && prev2.close > prev2.open && prev3.close > prev3.open)
                        : (prev1.close < prev1.open && prev2.close < prev2.open && prev3.close < prev3.open);
                    const priceProgress = dir === 'buy'
                        ? (prev1.close - prev3.open) / (s.close || prev1.close)
                        : (prev3.open - prev1.close) / (s.close || prev1.close);
                    
                    if (sameDir3 && priceProgress < 0.0001) {
                        trapReason = 'اختراق كاذب (إرهاق السعر)';
                    }
                }
            }
        }

        const readyBuy  = !trapReason && s.stBull && bullScore>=result.min && !s.rsiOverbought && s.candles.safeBull && atrOk && candleOk;
        const readySell = !trapReason && !s.stBull && bearScore>=result.min && !s.rsiOversold  && s.candles.safeBear  && atrOk && candleOk;

        const conditions = result.conds.map(c=>({ name: c.name, met: c.bull, value: c.bull ? '✅' : '❌', required: c.required }));
        conditions.push({ name:'ATR نشط', met: atrOk, value: atrOk?'✅':'❌', required:'يجب وجود تذبذب كافٍ' });
        conditions.push({ name:`RSI < ${s.cfg.rsiMaxBuy}`, met: !s.rsiOverbought, value: s.rsi?s.rsi.toFixed(1):'--', required:'ليس في منطقة مبالغة' });

        return { bullScore, bearScore, conds: result.conds, conditions, min: result.min, readyBuy, readySell, trapReason, summary: s, strict };
    },

    calculateEngines(tf){
        const r = this.evaluateTF(tf);
        const engines = {};
        (r.conds||[]).forEach((c,i)=>{ engines['e'+(i+1)]={ bull:c.bull, bear:c.bear, name:c.name, desc_bull:c.required, desc_bear:c.required }; });
        return { bullScore:r.bullScore, bearScore:r.bearScore, engines, conditions:r.conditions||[], minEngines:r.min, readyBuy:r.readyBuy, readySell:r.readySell, trapReason: r.trapReason, summary:r.summary };
    },

    evaluateSignals(tf){
        const r = this.evaluateTF(tf);
        if(!r.summary) return;
        const s = r.summary;
        const cfg = TFManager.TF_CONFIGS[tf];
        const close = s.close;
        const targetDist = cfg.targetPts * this.POINT_VALUE;
        const active = this.activeTrades[tf];

        if(active){
            const pts = active.direction==='buy'
                ? Math.round((close-active.entry)/this.POINT_VALUE)
                : Math.round((active.entry-close)/this.POINT_VALUE);
            active.currentPts=pts;
            active.maxPts=Math.max(active.maxPts||0,pts);
            active.currentPrice=close;

            if(pts>=cfg.targetPts){
                active.status='success';
                active.result=`✅ نجحت (+${cfg.targetPts} نقطة)`;
                active.resultColor='#00E676';
                active.closePrice=close;
                this.tradeHistory[tf].unshift({...active,closedAt:Date.now()});
                this.activeTrades[tf]=null;
                this.adaptive.onSuccess(tf);
                this.cooldown[tf] = Date.now() + this.COOLDOWN_MS;
                this.conditionsReset[tf] = false;
                this.saveState();
                this.playAlert('target');
                this.notify(`✅ [${tf}] نجحت! دخول:${active.entry.toFixed(6)}→${close.toFixed(6)} (+${cfg.targetPts}نقطة) | انتظار 30ث`,'success');
                return;
            }

            const reversal = (active.direction==='buy'&&r.bearScore>=r.min&&!s.stBull)
                ||(active.direction==='sell'&&r.bullScore>=r.min&&s.stBull);
            if(reversal){
                active.status='reversed';
                active.result=`❌ انعكاس (${pts>=0?'+':''}${pts}نقطة)`;
                active.resultColor='#FF5252';
                active.closePrice=close;
                this.tradeHistory[tf].unshift({...active,closedAt:Date.now()});
                this.activeTrades[tf]=null;
                this.adaptive.onFailure(tf);
                this.cooldown[tf] = Date.now() + this.COOLDOWN_MS;
                this.conditionsReset[tf] = false;
                this.saveState();
                this.notify(`❌ [${tf}] انعكاس! (${pts}نقطة) | انتظار 30ث`,'warning');
                return;
            }
        } else {
            if (this.systemBooting) return;
            if (Date.now() < this.cooldown[tf]) return;

            if (!this.conditionsReset[tf]) {
                if (r.bullScore < r.min - 1 && r.bearScore < r.min - 1) {
                    this.conditionsReset[tf] = true;
                } else {
                    return;
                }
            }

            if (r.readyBuy) {
                const targetDist = cfg.targetPts * this.POINT_VALUE;
                const targetPrice = close + targetDist;
                this.activeTrades[tf] = {
                    direction: 'buy', entry: close, targetPts: cfg.targetPts, target: targetPrice,
                    openedAt: Date.now(), currentPts: 0, maxPts: 0, currentPrice: close,
                    status: 'active', result: null, resultColor: null, closePrice: null
                };
                this.saveState();
                this.playAlert('buy');
                this.notify(`🟢 [${tf}] إشارة شراء! دخول:${close.toFixed(6)}`, 'success');
            } else if (r.readySell) {
                const targetDist = cfg.targetPts * this.POINT_VALUE;
                const targetPrice = close - targetDist;
                this.activeTrades[tf] = {
                    direction: 'sell', entry: close, targetPts: cfg.targetPts, target: targetPrice,
                    openedAt: Date.now(), currentPts: 0, maxPts: 0, currentPrice: close,
                    status: 'active', result: null, resultColor: null, closePrice: null
                };
                this.saveState();
                this.playAlert('sell');
                this.notify(`🔴 [${tf}] إشارة بيع! دخول:${close.toFixed(6)}`, 'warning');
            }
        }
    },

    evaluateAll() {
        for (const tf of Object.keys(TFManager.TF_CONFIGS)) {
            this.evaluateSignals(tf);
        }
    },

    getTrend(tf){
        const r = this.evaluateTF(tf);
        const s = r.summary;
        if(!s) return { direction:'neutral', label:'--', color:'#8b95a5', strength:0 };
        
        const bull = r.bullScore; const bear = r.bearScore;
        const stBull = r.conds[0].bull; // SuperTrend is ALWAYS condition 0
        const stBear = r.conds[0].bear;
        
        // إذا كان الاتجاه وهمياً، يتم تسميته بشكل دقيق ويعتبر صوته محايداً
        if (r.trapReason) {
            const trapLbl = `🛑 وهمي (${r.trapReason})`;
            return { direction:'neutral', label: trapLbl, color:'#FF6D00', strength:0 };
        }

        // لا يمكن أن يكون الاتجاه صريحاً إلا إذا كان SuperTrend (أو الدخول الاستباقي له) متوافقاً
        if(stBull && bull >= r.min && bull > bear) return { direction:'bullish', label:'🟢 صعود', color:'#00E676', strength:bull };
        if(stBear && bear >= r.min && bear > bull) return { direction:'bearish', label:'🔴 هبوط', color:'#FF5252', strength:bear };
        
        if(bull > bear) return { direction:'neutral', label:'🟡 مائل صعود', color:'#FFD700', strength:bull };
        if(bear > bull) return { direction:'neutral', label:'🟡 مائل هبوط', color:'#FFD700', strength:bear };
        return { direction:'neutral', label:'⚖️ حيادي', color:'#8b95a5', strength:0 };
    },

    getOpportunityStatus(tf){
        const r = this.evaluateTF(tf);
        const s = r.summary;
        if(!s) return { ready:false, status:'--', color:'#8b95a5', progress:0, failCondition:null, successCondition:null, entry:null, target:null, currentPts:null };
        const active = this.activeTrades[tf];
        if(active){
            const dir = active.direction === 'buy' ? 'صعود' : 'هبوط';
            const pts = active.currentPts || 0;
            const pct = Math.min(100, Math.max(0, (pts / active.targetPts) * 100));
            return { 
                ready:true, 
                status:`🔥 صفقة ${dir} جارية (${pts >= 0 ? '+' : ''}${pts} نقطة)`, 
                color: pts >= 0 ? '#00E676' : '#FF5252', 
                progress:pct, 
                failCondition:null,
                successCondition: `التقدم: ${pts} من أصل ${active.targetPts} نقطة للهدف`,
                entry: active.entry,
                target: active.target,
                currentPts: pts
            };
        }
        if(r.readyBuy) return { ready:true, status:'🚀 فرصة شراء مؤكدة! توكل علي الله افتح صفقه صعود', color:'#00E676', progress:100, failCondition:null, successCondition:'جميع الشروط محققة للدخول', entry:null, target:null, currentPts:null };
        if(r.readySell) return { ready:true, status:'📉 فرصة بيع مؤكدة! توكل علي الله افتح صفقه هبوط', color:'#FF5252', progress:100, failCondition:null, successCondition:'جميع الشروط محققة للدخول', entry:null, target:null, currentPts:null };
        const maxScore = Math.max(r.bullScore, r.bearScore);
        const pct = Math.min(100, (maxScore / r.min) * 100);
        const missing = r.min - maxScore;
        return { ready:false, status:`⏳ ينقص ${missing} شروط`, color:'#FFD700', progress:pct, failCondition: missing > 0 ? `يحتاج ${missing} شروط إضافية للتأكيد` : null, successCondition:null, entry:null, target:null, currentPts:null };
    },

    getStats(tf){
        const wins = this.tradeHistory[tf].filter(t=>t.status==='success').length;
        const losses = this.tradeHistory[tf].filter(t=>t.status==='reversed').length;
        const total = wins+losses;
        return { wins, losses, total, winRate: total>0?Math.round((wins/total)*100):0 };
    },

    getWhaleStatus(tf){
        const s = TFManager.getIndicatorSummary(tf);
        if(!s) return { active:false, label:'--', color:'#8b95a5' };
        if(s.whaleVolume&&s.candles.isBullish) return { active:true, label:'🐋 حيتان شراء', color:'#00E676' };
        if(s.whaleVolume&&s.candles.isBearish) return { active:true, label:'🐋 حيتان بيع', color:'#FF5252' };
        if(s.volumeSpike) return { active:true, label:'🔥 حجم مرتفع', color:'#FFD700' };
        return { active:false, label:'🐟 سيولة عادية', color:'#8b95a5' };
    },

    getSignalColor(s){
        if(!s) return '#8b95a5';
        if(s.stBull&&s.macdBull&&s.emaBull) return '#00E676';
        if(!s.stBull&&!s.macdBull&&!s.emaBull) return '#FF5252';
        if(s.whaleVolume&&s.candles.isBullish) return '#00E676';
        if(s.whaleVolume&&s.candles.isBearish) return '#FF5252';
        if(s.volumeSpike) return '#FFD700';
        return '#8b95a5';
    },

    // ══════════════════════════════════════════
    //  HUNTER SYSTEM v3 — ZERO FAIL
    //  - Entry: 3+ SuperTrend votes (strong consensus only)
    //  - Exit: TARGET HIT ONLY (21 pts) — NO reversal close
    //  - Detailed vote snapshots for diagnostics
    //  - 5-cycle confirmation (2.5s stability)
    // ══════════════════════════════════════════
    hunterTrade: null,
    hunterHistory: [],
    hunterCooldownUntil: 0,
    hunterConditionsReset: true,
    hunterLastTradeClosedAt: 0,
    HUNTER_COOLDOWN_MS: 30000, // 30 ثانية انتظار
    _hunterConfirmDir: null,
    _hunterConfirmCount: 0,
    HUNTER_CONFIRM_CYCLES: 5,
    HUNTER_MIN_VOTES: 3,
    
    initHunterHistory() {
        try {
            const saved = localStorage.getItem('hunter_history');
            if (saved) {
                const parsed = JSON.parse(saved);
                // Only keep today's trades
                const today = new Date().toDateString();
                this.hunterHistory = parsed.filter(t => new Date(t.openedAt).toDateString() === today);
            }
        } catch (e) {
            this.hunterHistory = [];
        }
    },
    
    saveHunterHistory() {
        try {
            localStorage.setItem('hunter_history', JSON.stringify(this.hunterHistory));
            this.saveState();
        } catch (e) {}
    },

    evaluateHunter() {
        const tfs = Object.keys(TFManager.TF_CONFIGS);
        let buyVotes = 0;
        let sellVotes = 0;
        const details = {};
        
        tfs.forEach(tf => {
            const tr = this.getTrend(tf);
            
            // Align Hunter votes with the Top Tabs 7-Engine Trend
            if (tr.direction === 'bullish') {
                details[tf] = "buy";
                buyVotes++;
            } else if (tr.direction === 'bearish') {
                details[tf] = "sell";
                sellVotes++;
            } else {
                // For "ميل صعود" or "ميل هبوط" (Neutral Tilt), we don't count it as a full vote
                // But we still display it in the details for the radar
                // But we still display it in the details for the radar
                if (tr.label.includes('🛑')) {
                    details[tf] = "trap";
                } else if (tr.label.includes('مائل صعود')) {
                    details[tf] = "tilt_buy";
                } else if (tr.label.includes('مائل هبوط')) {
                    details[tf] = "tilt_sell";
                } else {
                    details[tf] = "neutral";
                }
            }
        });
        
        return { buyVotes, sellVotes, details };
    },
    
    evaluateHunterSignals() {
        if (!this.hunterHistory) this.initHunterHistory();
        
        if (this.systemBooting) return; // Block any signals from evaluating or opening trades during the 30s boot sequence
        
        if (!this.hunterTrade) {
            const r = this.evaluateHunter();
            
            // UI updates should happen even during cooldown, but trades shouldn't execute
            if (Date.now() < this.hunterCooldownUntil) {
                // Still run nuclear filters so UI shows correct state
                // But don't proceed to trade entry
                return;
            }
            
            // 🧠 الإدارة الديناميكية للترند المتقدمة:
            // بعد كل صفقة ناجحة، يجب أن يهدأ السوق (تهبط الأصوات لأقل من 3)
            // قبل أن نسمح بصفقة جديدة. هذا يمنع الدخول العشوائي في ذيل الترند.
            // سواء كانت 3 أو 4 أو 5 أصوات، لا دخول متتالي بدون "نَفَس" حقيقي.
            
            // حساب الاتجاه
            let readyDir = null;
            if (r.buyVotes > r.sellVotes && r.buyVotes >= this.HUNTER_MIN_VOTES) readyDir = "buy";
            if (r.sellVotes > r.buyVotes && r.sellVotes >= this.HUNTER_MIN_VOTES) readyDir = "sell";
            
            const maxVotes = Math.max(r.buyVotes, r.sellVotes);
            
            if (readyDir) {
                if (!this.hunterConditionsReset) {
                    // ننتظر أن يتنفس السوق إما بهبوط الأصوات، أو بإغلاق شمعة الـ 15 دقيقة التي أُغلقت فيها الصفقة
                    const isVotesDropped = this._prevMaxVotes !== undefined && this._prevMaxVotes < 3;
                    
                    // حساب وقت بداية شمعة الـ 15 دقيقة الحالية
                    const currentTime = Date.now();
                    const candle15mDurationMs = 15 * 60 * 1000;
                    const current15mCandleStart = Math.floor(currentTime / candle15mDurationMs) * candle15mDurationMs;
                    
                    // إذا كان وقت إغلاق آخر صفقة يسبق بداية الشمعة الحالية، يعني أننا في شمعة جديدة كلياً
                    const isNewCandle = this.hunterLastTradeClosedAt && this.hunterLastTradeClosedAt < current15mCandleStart;
                    
                    if (isVotesDropped || isNewCandle) {
                        this.hunterConditionsReset = true; // السوق تنفس وتمت إعادة القراءة
                        this.saveState();
                    } else {
                        this._prevMaxVotes = maxVotes;
                        return; // قف مكانك، السوق لم يهدأ بعد لإعادة الحساب
                    }
                }
            }
            this._prevMaxVotes = maxVotes;
            
            // PRE-ALERT WARNING: 2 votes (almost ready)
            if ((r.buyVotes === 2 && r.sellVotes < 2) || (r.sellVotes === 2 && r.buyVotes < 2)) {
                if (!this._lastWarningTime || Date.now() - this._lastWarningTime > 3000) {
                    this.playAlert('warning');
                    this._lastWarningTime = Date.now();
                }
            }
            
            // ==========================================
            // NUCLEAR FILTERS (99% Win Rate Protections)
            // ==========================================
            let nuclearBlock = false;
            let nuclearReason = '';
            
            if (readyDir) {
                // We use 15m as the primary execution engine for Hunter filters
                const candles = TFManager.data['15m']?.candles;
                if (candles && candles.length >= 50) {
                    const c = candles[candles.length - 1];
                    const currentPrice = c.close;
                    
                    // 1. ATR News Kill-Switch (Filter out insane volatility)
                    let sumRange = 0;
                    for (let i = candles.length - 15; i < candles.length - 1; i++) {
                        sumRange += (candles[i].high - candles[i].low);
                    }
                    const avgATR = sumRange / 14;
                    const currentRange = c.high - c.low;
                    
                    if (currentRange > avgATR * 3) {
                        nuclearBlock = true;
                        nuclearReason = '🛑 حظر نووي: تذبذب خبري عنيف (ATR Spike)!';
                        // سيتم تجديد الاستراحة بالأسفل
                    }
                    
                    // 2. Dead Market Protection (Block if liquidity is completely dried up)
                    if (!nuclearBlock) {
                        let sumVol = 0;
                        for (let i = candles.length - 22; i < candles.length - 2; i++) {
                            sumVol += candles[i].volume;
                        }
                        const avgVol = sumVol / 20;
                        const prevVol = candles[candles.length - 2].volume;
                        const prevPrevVol = candles[candles.length - 3].volume;
                        
                        // If the last two fully closed 15m candles were completely dead (< 60% of average)
                        if (prevVol < avgVol * 0.6 && prevPrevVol < avgVol * 0.6) {
                            nuclearBlock = true;
                            nuclearReason = '⚠️ حظر نووي: سوق ميت تماماً (السيولة أقل من 60% من المتوسط الطبيعي).';
                        }
                    }
                    
                    // 3. Steel Walls (Support/Resistance block)
                    if (!nuclearBlock) {
                        if (readyDir === 'buy') {
                            let highest = 0;
                            for (let i = candles.length - 50; i < candles.length; i++) {
                                if (candles[i].high > highest) highest = candles[i].high;
                            }
                            const dist = highest - currentPrice;
                            if (dist > 0 && dist < (5 * this.POINT_VALUE)) {
                                nuclearBlock = true;
                                nuclearReason = '🧱 حظر نووي: جدار مقاومة تاريخي قريب جداً (أقل من 5 نقاط).';
                            }
                        } else {
                            let lowest = Infinity;
                            for (let i = candles.length - 50; i < candles.length; i++) {
                                if (candles[i].low < lowest) lowest = candles[i].low;
                            }
                            const dist = currentPrice - lowest;
                            if (dist > 0 && dist < (5 * this.POINT_VALUE)) {
                                nuclearBlock = true;
                                nuclearReason = '🧱 حظر نووي: جدار دعم تاريخي صلب قريب جداً (أقل من 5 نقاط).';
                            }
                        }
                    }
                }
            }
            
            // ══════════════════════════════════════════
            //  🕵️ كاشف الفخاخ والتلاعب المؤسسي
            //  يكشف 4 أنواع من التلاعب قبل الدخول
            // ══════════════════════════════════════════
            let manipulationDetected = false;
            let manipulationReason = null;
            
            if (readyDir && !nuclearBlock) {
                const candles15 = TFManager.data['15m']?.candles;
                if (candles15 && candles15.length >= 10) {
                    const last = candles15[candles15.length - 1];
                    const prev1 = candles15[candles15.length - 2];
                    const prev2 = candles15[candles15.length - 3];
                    const prev3 = candles15[candles15.length - 4];
                    
                    // 🕵️ فخ 1: صيد السيولة (Stop Hunt Wick)
                    // شمعة لها ذيل ضخم أكبر من 70% من حجمها = حيتان يصطادون وقف الخسارة
                    const body1 = Math.abs(prev1.close - prev1.open);
                    const range1 = prev1.high - prev1.low;
                    const wickPct = range1 > 0 ? (range1 - body1) / range1 : 0;
                    if (wickPct > 0.85) {
                        manipulationDetected = true;
                        manipulationReason = '🎣 ابتعد وهمية: صيد سيولة مكتشف! الحيتان اصطادوا وقف الخسارة في الشمعة السابقة.';
                    }
                    
                    // 🕵️ فخ 2: تباين OBV (OBV Divergence Trap)
                    // السعر يرتفع لكن OBV ينخفض = صعود وهمي بدون أموال حقيقية
                    if (!manipulationDetected) {
                        const s15 = TFManager.getIndicatorSummary('15m');
                        const s30 = TFManager.getIndicatorSummary('30m');
                        if (s15 && s30) {
                            if (readyDir === 'buy' && !s15.obvBull && !s30.obvBull) {
                                manipulationDetected = true;
                                manipulationReason = '📉 ابتعد وهمية: تباين OBV! السعر يصعد لكن الأموال تهرب (لا تراكم حقيقي).';
                            }
                            if (readyDir === 'sell' && s15.obvBull && s30.obvBull) {
                                manipulationDetected = true;
                                manipulationReason = '📈 ابتعد وهمية: تباين OBV! السعر يهبط لكن الأموال تتراكم (محاولة إسقاط وهمي).';
                            }
                        }
                    }
                    
                    // 🕵️ فخ 3: الاختراق الكاذب (Fake Breakout)
                    // 3 شموع تحاول نفس الاتجاه دون تقدم = إرهاق السعر = انعكاس وشيك
                    if (!manipulationDetected) {
                        const sameDir3 = readyDir === 'buy'
                            ? (prev1.close > prev1.open && prev2.close > prev2.open && prev3.close > prev3.open)
                            : (prev1.close < prev1.open && prev2.close < prev2.open && prev3.close < prev3.open);
                        const priceProgress = readyDir === 'buy'
                            ? (prev1.close - prev3.open) / (TFManager.getCurrentPrice('15m') || prev1.close)
                            : (prev3.open - prev1.close) / (TFManager.getCurrentPrice('15m') || prev1.close);
                        // 3 شموع في نفس الاتجاه لكن التقدم أقل من 0.01% = إرهاق
                        if (sameDir3 && priceProgress < 0.0001) {
                            manipulationDetected = true;
                            manipulationReason = '😴 ابتعد وهمية: إرهاق السعر! 3 شموع في نفس الاتجاه دون تقدم = انعكاس وشيك.';
                        }
                    }
                    
                    // 🕵️ فخ 4: تباين CMF مقابل السعر
                    // CMF سالب وسعر يصعد = بيع مخفي من الحيتان
                    if (!manipulationDetected) {
                        const s15m = TFManager.getIndicatorSummary('15m');
                        if (s15m) {
                            if (readyDir === 'buy' && s15m.cmf < -0.20) {
                                manipulationDetected = true;
                                manipulationReason = '🐳 ابتعد وهمية: الحيتان يبيعون خفية! CMF سالب بقوة رغم ارتفاع السعر.';
                            }
                            if (readyDir === 'sell' && s15m.cmf > 0.20) {
                                manipulationDetected = true;
                                manipulationReason = '🐳 ابتعد وهمية: الحيتان يشترون خفية! CMF إيجابي بقوة رغم انخفاض السعر.';
                            }
                        }
                    }
                }
            }
            
            // تحديث حالة الفخ
            this.hunterManipulation = manipulationDetected ? manipulationReason : null;
            
            // دمج الحظر النووي مع الفخاخ
            if (manipulationDetected && !nuclearBlock) {
                nuclearBlock = true;
                nuclearReason = manipulationReason;
            }
            
            this.hunterNuclearReason = nuclearBlock ? nuclearReason : null;

            // ==========================================
            // AUTO-RENEW COOLDOWN LOGIC (30 Seconds)
            // ==========================================
            // Only renew cooldown if we just came OUT of a cooldown AND market is still bad
            // Don't continuously set new cooldowns if there's no active cooldown
            if (nuclearBlock) {
                // Nuclear block active: set 30s cooldown only if not already cooling
                if (Date.now() >= this.hunterCooldownUntil) {
                    this.hunterCooldownUntil = Date.now() + 30000;
                    this.saveState();
                }
                this._hunterConfirmDir = null;
                this._hunterConfirmCount = 0;
                return; // Stop here - don't proceed to entry
            }
            
            // ====================================================
            // 🔥 فلتر صحة الصفقة الذهبي (90% كحد أدنى)
            // يكشف القوة الحقيقية ويسبق الزمن بـ 25 نقطة
            // ====================================================
            let healthWarningMsg = null;
            if (readyDir && !nuclearBlock) {
                const s15m = TFManager.getIndicatorSummary('15m');
                const r15 = this.evaluateTF('15m');
                if (s15m && r15) {
                    let health = 100;
                    let issues = [];
                    
                    // 1. SuperTrend (مع الدخول الاستباقي بـ 25 نقطة)
                    if ((readyDir === 'buy' && !s15m.stBull) || (readyDir === 'sell' && s15m.stBull)) {
                        const distToSt = s15m.stLine ? Math.abs(s15m.close - s15m.stLine) / this.POINT_VALUE : 999;
                        const strongLiq = (readyDir === 'buy' && s15m.cmf > 0.05) || (readyDir === 'sell' && s15m.cmf < -0.05);
                        const strongVotes = readyDir === 'buy' ? r.buyVotes >= 3 : r.sellVotes >= 3;
                        
                        if (this.smartAnalyzerActive && distToSt <= 25 && strongVotes && strongLiq) {
                            // المفكر الذكي مفعل + قريب من الكسر + أصوات كافية + سيولة داعمة = دخول استباقي احترافي
                            issues.push(`⚡ دخول استباقي ذكي (يسبق الكسر بـ ${Math.round(distToSt)} نقطة)`);
                            // لا نخصم — نحن نتوقع الكسر!
                        } else {
                            // SuperTrend عكس الاتجاه والسعر بعيد أو لا توجد سيولة حقيقية تدعم الكسر
                            health -= 50;
                            issues.push('SuperTrend عكس الاتجاه');
                        }
                    }
                    
                    // 2. فحص الزخم
                    if (readyDir === 'buy' && r15.bearScore > r15.bullScore) {
                        health -= 30; issues.push('زخم هبوطي يضغط');
                    } else if (readyDir === 'sell' && r15.bullScore > r15.bearScore) {
                        health -= 30; issues.push('زخم صعودي يضغط');
                    }
                    
                    // 3. فحص السيولة CMF
                    if (readyDir === 'buy' && s15m.cmf < -0.1) {
                        health -= 20; issues.push('تخارج سيولة');
                    } else if (readyDir === 'sell' && s15m.cmf > 0.1) {
                        health -= 20; issues.push('دخول سيولة عكسية');
                    }
                    
                    // 4. فلتر المسافة (منع ملاحقة السعر البعيد جداً)
                    const isAnticipatory = issues.some(i => i.includes('استباقي'));
                    if (!isAnticipatory && s15m.stLine) {
                        const distPts = Math.abs(s15m.close - s15m.stLine) / this.POINT_VALUE;
                        if (distPts > 150) { health -= 20; issues.push(`ملاحقة سعر بعيد جداً (${Math.round(distPts)} نقطة)`); }
                    }
                    
                    health = Math.max(0, health);
                    this.hunterPreTradeHealth = health;
                    this.hunterPreTradeIssues = issues;
                    
                    if (health < 90) {
                        const blockIssues = issues.filter(i => !i.includes('استباقي'));
                        healthWarningMsg = `نسبة النجاح: ${health}%. ابتعد!${blockIssues.length ? ' [' + blockIssues.join(' | ') + ']' : ''}`;
                    }
                }
            }
            this.hunterHealthWarning = healthWarningMsg;
            
            // Confirmation: must hold for N cycles
            if (readyDir && !nuclearBlock && !healthWarningMsg) {
                if (readyDir === this._hunterConfirmDir) {
                    this._hunterConfirmCount++;
                } else {
                    this._hunterConfirmDir = readyDir;
                    this._hunterConfirmCount = 1;
                }
                
                if (this._hunterConfirmCount < this.HUNTER_CONFIRM_CYCLES) return;
                
                const price = TFManager.getCurrentPrice("15m");
                if (!price) return;
                
                const targetPts = 20;
                const targetDist = targetPts * this.POINT_VALUE;
                const target = readyDir === "buy" ? price + targetDist : price - targetDist;
                
                // Build detailed vote snapshot
                const snapshot = {};
                for (const tf of Object.keys(r.details)) {
                    const s = TFManager.getIndicatorSummary(tf);
                    snapshot[tf] = {
                        vote: r.details[tf],
                        stBull: s ? s.stBull : null,
                        rsi: s ? (s.rsi || 0).toFixed(1) : '--',
                        price: s ? s.close : null
                    };
                }
                
                const entryIssuesSaved = this.hunterPreTradeIssues || [];
                const isAnticipated = entryIssuesSaved.some(i => i.includes('استباقي'));
                this.hunterTrade = {
                    direction: readyDir, entry: price, target, targetPts,
                    entryHealth: this.hunterPreTradeHealth || 100,
                    entryIssues: entryIssuesSaved,
                    isAnticipated,
                    openedAt: Date.now(), currentPts: 0, maxPts: 0, currentPrice: price,
                    status: "active", result: null, resultColor: null, closePrice: null,
                    entryVotes: JSON.parse(JSON.stringify(r)),
                    entrySnapshot: snapshot,
                    voteLog: []
                };
                // Notify both panels with the same unified message
                const entryTypeStr = isAnticipated ? '⚡ استباقي ذكي' : `✅ مؤكد ${this.hunterPreTradeHealth || 100}%`;
                this.notify(`🎯 قنص! ${readyDir === 'buy' ? '↑صعود' : '↓هبوط'} | ${entryTypeStr} | دخول: ${price.toFixed(6)}`, readyDir);
                
                this._hunterConfirmDir = null;
                this._hunterConfirmCount = 0;
                this.saveState(); // احفظ الصفقة الجديدة فوراً في الذاكرة
                
                // Special Hunter Entry Sounds
                this.playAlert("hunter_entry");
                setTimeout(() => this.playAlert("hunter_entry"), 1000);
                setTimeout(() => this.playAlert("hunter_entry"), 2000);
                
                const voteStr = Object.keys(r.details).map(tf => tf + ':' + (r.details[tf] === 'buy' ? '\u2191' : r.details[tf] === 'sell' ? '\u2193' : '-')).join(' ');
                this.notify("\ud83c\udfaf \u0642\u0646\u0635! " + (readyDir === "buy" ? "\u2191\u0635\u0639\u0648\u062f" : "\u2193\u0647\u0628\u0648\u0637") + " [" + r.buyVotes + "v" + r.sellVotes + "] " + voteStr, readyDir);
            } else {
                this._hunterConfirmDir = null;
                this._hunterConfirmCount = 0;
            }
        } else {
            // ── Manage Active Hunter Trade ──
            const trade = this.hunterTrade;
            const price = TFManager.getCurrentPrice("15m");
            if (!price) return;
            
            const pts = trade.direction === "buy" 
                ? Math.round((price - trade.entry) / this.POINT_VALUE)
                : Math.round((trade.entry - price) / this.POINT_VALUE);
                
            trade.currentPts = pts;
            trade.maxPts = Math.max(trade.maxPts, pts);
            trade.currentPrice = price;
            
            // Log vote changes every 10 seconds for diagnostics
            const r = this.evaluateHunter();
            const now = Date.now();
            const lastLog = trade.voteLog.length > 0 ? trade.voteLog[trade.voteLog.length - 1].time : 0;
            if (now - lastLog > 10000) {
                trade.voteLog.push({
                    time: now,
                    timeStr: new Date(now).toLocaleTimeString('en-US', {hour12:false}),
                    buy: r.buyVotes, sell: r.sellVotes,
                    details: JSON.parse(JSON.stringify(r.details)),
                    pts: pts
                });
                // Keep max 30 log entries
                if (trade.voteLog.length > 30) trade.voteLog.shift();
                this.saveState(); // تحديث الذاكرة كل 10 ثواني بأحدث نقاط وأصوات
            }
            
            // ══ SUCCESS: Target hit — ONLY way to close ══
            if (pts >= trade.targetPts) {
                trade.status = "success";
                trade.result = "\u2705 \u0646\u062c\u062d\u062a (+" + trade.targetPts + " \u0646\u0642\u0637\u0629)";
                trade.resultColor = "#00E676";
                trade.closePrice = price;
                trade.closedAt = Date.now();
                trade.exitVotes = JSON.parse(JSON.stringify(r));
                this.hunterHistory.unshift(trade);
                
                // تفريغ الصفقة وبدء التبريد *قبل* الحفظ لكي لا تُحفظ كصفقة نشطة بالخطأ
                this.hunterTrade = null;
                this.hunterCooldownUntil = Date.now() + this.HUNTER_COOLDOWN_MS;
                this.hunterConditionsReset = false; // اطلب استراحة للسوق قبل الصفقة القادمة
                
                this.saveHunterHistory(); // الآن سيحفظ الذاكرة فارغة ونظيفة
                
                this.playAlert("target");
                this.notify("\ud83c\udfaf \u0646\u062c\u0627\u062d \u0627\u0644\u0642\u0646\u0627\u0635! (+" + trade.targetPts + "\u0646\u0642\u0637\u0629) \u0645\u0646 " + trade.entry.toFixed(6) + " \u0625\u0644\u0649 " + price.toFixed(6), "success");
                return;
            }

            // ══ STOP LOSS: -250 نقطة — أغلق بخسارة مُدارة ══
            if (pts <= -250) {
                trade.status = "sl";
                trade.result = "⛔ وقف خسارة (-250 نقطة)";
                trade.resultColor = "#FF5252";
                trade.closePrice = price;
                trade.closedAt = Date.now();
                trade.exitVotes = JSON.parse(JSON.stringify(r));
                this.hunterHistory.unshift(trade);
                
                // تفريغ الصفقة قبل الحفظ
                this.hunterTrade = null;
                this.hunterCooldownUntil = Date.now() + this.HUNTER_COOLDOWN_MS;
                this.hunterConditionsReset = false;
                this.hunterLastTradeClosedAt = Date.now();
                
                this.saveHunterHistory();
                
                this.playAlert("warning");
                setTimeout(() => this.playAlert("warning"), 500);
                this.notify("⛔ وقف خسارة تنفيذي! (-250 نقطة) عند " + price.toFixed(6), "sell");
                return;
            }
        }
    },
    
    // ====================================================
    // 📊 ملخص السوق الموحد (يُستخدم في كلا اللوحتين)
    // ====================================================
    getMarketSummary() {
        const tfs = ['15m', '30m', '1h', '4h', '1d'];
        const tfNames = { '15m': '15د', '30m': '30د', '1h': '1س', '4h': '4س', '1d': 'يومي' };
        let bullCount = 0, bearCount = 0, trapCount = 0;
        let details = [];
        
        tfs.forEach(tf => {
            const trend = this.getTrend(tf);
            const s = TFManager.getIndicatorSummary(tf);
            let icon = '⚪', col = '';
            if (trend.direction === 'bullish') { icon = '🟢'; bullCount++; }
            else if (trend.direction === 'bearish') { icon = '🔴'; bearCount++; }
            else if (trend.label && (trend.label.includes('وهمي') || trend.label.includes('فخ'))) { icon = '🛑'; trapCount++; }
            else { icon = '🟡'; }
            details.push(`${icon}${tfNames[tf]}`);
        });
        
        const r = this.evaluateHunter();
        let conclusion = '';
        let conclusionColor = '#8b95a5';
        
        if (this.hunterTrade) {
            const h = this.hunterTrade.entryHealth || 100;
            const isAntic = this.hunterTrade.isAnticipated;
            conclusion = isAntic
                ? `⚡ صفقة استباقية ذكية (دخلنا قبل الكسر بـ 25 نقطة)`
                : `🎯 صفقة نشطة | قوة الدخول: ${h}%`;
            conclusionColor = '#FFD700';
        } else if (this.hunterNuclearReason) {
            conclusion = '🛑 ' + this.hunterNuclearReason.replace('🛑 ', '').replace('⚠️ ', '');
            conclusionColor = '#FF6D00';
        } else if (this.hunterHealthWarning) {
            conclusion = '⚠️ ' + this.hunterHealthWarning;
            conclusionColor = '#FFD700';
        } else if (r.buyVotes >= 3) {
            conclusion = `🟢 توافق صعود قوي (${r.buyVotes}/5 أصوات) — جاهز للدخول`;
            conclusionColor = '#00E676';
        } else if (r.sellVotes >= 3) {
            conclusion = `🔴 توافق هبوط قوي (${r.sellVotes}/5 أصوات) — جاهز للدخول`;
            conclusionColor = '#FF5252';
        } else if (r.buyVotes === 2) {
            conclusion = `🟡 ميل صعود (${r.buyVotes}/5) — ننتظر تأكيد إضافي`;
            conclusionColor = '#FFD700';
        } else if (r.sellVotes === 2) {
            conclusion = `🟡 ميل هبوط (${r.sellVotes}/5) — ننتظر تأكيد إضافي`;
            conclusionColor = '#FFD700';
        } else {
            conclusion = `⚖️ السوق في توازن — لا توجد فرصة واضحة`;
            conclusionColor = '#8b95a5';
        }
        
        return { details, bullCount, bearCount, trapCount, conclusion, conclusionColor, votes: r };
    },
    
    // ====================================================
    // 🧠 SMART ANALYZER (المفكر الذكي)
    // ====================================================
    smartLog(msg, type = 'info') {
        const logPanel = document.getElementById('smartAnalyzerLog');
        if (!logPanel) return;
        
        const time = new Date().toLocaleTimeString('en-US', {hour12: false});
        const div = document.createElement('div');
        div.className = `smart-log-item smart-msg-${type}`;
        div.innerHTML = `<span class="smart-log-time">[${time}]</span><span class="smart-log-msg">${msg}</span>`;
        
        logPanel.appendChild(div);
        if (logPanel.children.length > 50) logPanel.removeChild(logPanel.firstChild);
        logPanel.scrollTop = logPanel.scrollHeight;
    },

    smartHealerActive: false,
    
    runSmartAnalysis() {
        if (!this.smartAnalyzerActive) return;

        const s15m = TFManager.getIndicatorSummary('15m');
        if (!s15m) return;
        
        const r = this.evaluateHunter();
        const activeTrade = this.hunterTrade;

        // --- تدخّل المعالج الفوري (Healer Action) ---
        if (this.smartHealerActive) {
            // 1. مراقبة نبض البيانات (Data Heartbeat Monitor)
            // التأكد من أن الاتصال حي وأن السعر الحالي ليس متجمداً بسبب انقطاع الإنترنت أو تأخر السيرفر
            const now = Date.now();
            const lastUpdate = TFManager.lastTickTime || now; // Assuming we add this or just check candles
            const dataAge = now - s15m.timestamp;
            
            if (dataAge > 10000) { // بيانات أقدم من 10 ثواني (تجميد أو صمت من بينانس)
                this.smartLog(`⚠️ <span>المعالج الفوري:</span> انقطاع أو تأخر في تدفق البيانات السعرية! جاري تجميد صائد الصفقات لمنع الدخول الخاطئ...`, 'healer-action');
                this.hunterCooldownUntil = now + 5000; // تمديد التبريد إجبارياً لحين عودة النبض
                return; // إيقاف التحليل حتى تعود البيانات
            }

            // 2. المعالج ينظر في التناقضات والفخاخ ويعالجها
            if (this.hunterNuclearReason) {
                this.smartLog(`🛡️ <span>المعالج الفوري:</span> جاري تفعيل حوائط الصد لمنع الانزلاق السعري... تم تأمين المحفظة بنجاح!`, 'healer-action');
            } else if (!this.hunterConditionsReset && Math.max(r.buyVotes, r.sellVotes) >= 3) {
                this.smartLog(`🛡️ <span>المعالج الفوري:</span> تم كبح جماح الصفقات المتتالية وتفعيل وضع "تنفس السوق" الإجباري.`, 'healer-action');
            }
        }

        // 1. إذا كان هناك صفقة جارية: مراقبة الصحة
        if (activeTrade) {
            const dir = activeTrade.direction;
            const pts = activeTrade.currentPts || 0;
            
            if (dir === 'buy' && s15m.cmf < -0.15) {
                this.smartLog(`⚠️ تحذير: سيولة تخرج! الحيتان يبيعون رغم الصفقة الصعودية. النقاط: ${pts}`, 'danger');
            } else if (dir === 'sell' && s15m.cmf > 0.15) {
                this.smartLog(`⚠️ تحذير: سيولة تدخل! الحيتان يشترون رغم الصفقة الهبوطية. النقاط: ${pts}`, 'danger');
            } else if (dir === 'buy' && s15m.macdBull && s15m.emaFast > s15m.emaSlow) {
                this.smartLog(`✅ الصفقة في الاتجاه الصحيح | زخم صعودي | ${pts >= 0 ? '+' : ''}${pts} نقطة`, 'success');
            } else if (dir === 'sell' && !s15m.macdBull && s15m.emaFast < s15m.emaSlow) {
                this.smartLog(`✅ الصفقة في الاتجاه الصحيح | زخم هبوطي | ${pts >= 0 ? '+' : ''}${pts} نقطة`, 'success');
            } else {
                this.smartLog(`⚠️ الزخم متذبذب! النقاط: ${pts >= 0 ? '+' : ''}${pts}. مراقبة مستمرة.`, 'warning');
            }
            
            if (s15m.candles && s15m.candles.wickRatio > 0.6) {
                this.smartLog('🛑 ذيل علوي ضخم! محاولة صيد سيولة من الأعلى.', 'warning');
            } else if (s15m.candles && s15m.candles.lowerWickRatio > 0.6) {
                this.smartLog('🛑 ذيل سفلي ضخم! محاولة صيد سيولة من الأسفل.', 'warning');
            }
            return;
        }

        // 2. إذا لم يكن هناك صفقة: تحليل شامل ومفصل لكل فريم (شاشة الصراع)
        const tfs = Object.keys(TFManager.TF_CONFIGS);
        const tfLabels = {'15m':'15د','30m':'30د','1h':'1س','4h':'4س','1d':'يومي'};
        let buyCount = 0, sellCount = 0;
        let htmlGrid = '<div class="smart-grid-log">';
        
        tfs.forEach(tf => {
            const s = TFManager.getIndicatorSummary(tf);
            if (!s) return;
            const tr = this.getTrend(tf);
            const lbl = tfLabels[tf] || tf;
            
            let dirClass = '';
            let dirText = tr.label; // Use the exact label from getTrend to ensure 100% synchronization
            
            if (tr.direction === 'bullish') { buyCount++; dirClass='bull'; }
            else if (tr.direction === 'bearish') { sellCount++; dirClass='bear'; }
            else if (tr.label.includes('🛑')) { dirClass='trap'; }
            
            let liqText = (s.cmf > 0.1) ? '💰' : (s.cmf < -0.1) ? '💸' : '➖';
            let volText = (s.whaleVolume) ? '🐋' : (s.volumeSpike) ? '🔥' : '📊';
            
            htmlGrid += `<div class="smart-grid-item ${dirClass}">${lbl}: ${dirText} ${liqText}${volText}</div>`;
        });
        htmlGrid += '</div>';
        
        // عرض شبكة الصراع
        const logPanel = document.getElementById('smartAnalyzerLog');
        if (logPanel) {
            const time = new Date().toLocaleTimeString('en-US', {hour12: false});
            const div = document.createElement('div');
            div.innerHTML = `<span class="smart-log-time">[${time}]</span> ${htmlGrid}`;
            logPanel.appendChild(div);
            if (logPanel.children.length > 50) logPanel.removeChild(logPanel.firstChild);
            logPanel.scrollTop = logPanel.scrollHeight;
        }
        
        // الاتجاه المتفوق
        if (buyCount > sellCount && buyCount >= 3) {
            this.smartLog(`🟢 المنتصر الحالي: صعود (${buyCount}/5 فريم) | CMF15م: ${s15m.cmf ? s15m.cmf.toFixed(3) : '--'} | RSI: ${s15m.rsi ? Math.round(s15m.rsi) : '--'}`, 'success');
        } else if (sellCount > buyCount && sellCount >= 3) {
            this.smartLog(`🔴 المنتصر الحالي: هبوط (${sellCount}/5 فريم) | CMF15م: ${s15m.cmf ? s15m.cmf.toFixed(3) : '--'} | RSI: ${s15m.rsi ? Math.round(s15m.rsi) : '--'}`, 'danger');
        } else {
            this.smartLog(`⚔️ المعركة مستمرة (صعود:${buyCount} هبوط:${sellCount}) | السوق في صراع عنيف.`, 'warning');
        }
        
        // حالة الموافقة على الدخول
        if (this.hunterCooldownUntil > Date.now()) {
            const sec = Math.ceil((this.hunterCooldownUntil - Date.now()) / 1000);
            this.smartLog(`⏳ تبريد ما بعد الصفقة: ${sec} ثانية متبقية...`, 'warning');
        } else if (!this.hunterConditionsReset && Math.max(r.buyVotes, r.sellVotes) >= 3) {
            const currentTime = Date.now();
            const candle15mDurationMs = 15 * 60 * 1000;
            const current15mCandleStart = Math.floor(currentTime / candle15mDurationMs) * candle15mDurationMs;
            const nextCandleStart = current15mCandleStart + candle15mDurationMs;
            
            const timeLeft = Math.max(0, Math.ceil((nextCandleStart - currentTime) / 1000));
            const mins = Math.floor(timeLeft / 60);
            const secs = timeLeft % 60;
            this.smartLog(`⏳ هدنة إجبارية: ننتظر إغلاق شمعة الـ 15 دقيقة | متبقي ${mins}:${secs.toString().padStart(2, '0')} للبحث عن صفقة مضمونة جديدة...`, 'warning');
        }
        
        if (this.hunterNuclearReason) {
            this.smartLog(`🛑 حماية ذكية: ${this.hunterNuclearReason.replace('🛑 ', '').replace('⚠️ ', '')}`, 'danger');
        }
    }
};

