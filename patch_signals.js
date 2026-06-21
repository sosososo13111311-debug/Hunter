const fs = require('fs');
let content = fs.readFileSync('signals.js', 'utf8');

// Find where getSignalColor ends
const match = content.match(/getSignalColor\(s\)\{[\s\S]*?return '#8b95a5';\s*\}/);
if (match) {
    const splitIndex = match.index + match[0].length;
    content = content.substring(0, splitIndex) + ",\n";
    
    // Add evaluateAll and evaluateHunter
    content += 
    evaluateAll() {
        for (const tf of Object.keys(TFManager.TF_CONFIGS)) {
            this.evaluateSignals(tf);
        }
    },

    // ══════════════════════════════════════════
    //  HUNTER SYSTEM (MTF Consensus)
    // ══════════════════════════════════════════
    hunterTrade: null,
    hunterHistory: [],
    
    evaluateHunter() {
        const tfs = Object.keys(TFManager.TF_CONFIGS);
        let buyVotes = 0;
        let sellVotes = 0;
        const details = {};
        
        tfs.forEach(tf => {
            const active = this.activeTrades[tf];
            const r = this.evaluateTF(tf);
            let vote = 'neutral';
            
            if (active) {
                vote = active.direction;
                if (vote === 'buy') buyVotes++; else sellVotes++;
            } else if (r.readyBuy) {
                vote = 'buy';
                buyVotes++;
            } else if (r.readySell) {
                vote = 'sell';
                sellVotes++;
            } else {
                if (r.bullScore >= r.min && r.bullScore > r.bearScore) { vote = 'buy'; buyVotes++; }
                else if (r.bearScore >= r.min && r.bearScore > r.bullScore) { vote = 'sell'; sellVotes++; }
            }
            details[tf] = vote;
        });
        
        return { buyVotes, sellVotes, details };
    },
    
    evaluateHunterSignals() {
        if (!this.hunterTrade) {
            const r = this.evaluateHunter();
            
            let readyDir = null;
            if (r.buyVotes > r.sellVotes && r.buyVotes >= 2) readyDir = 'buy';
            if (r.sellVotes > r.buyVotes && r.sellVotes >= 2) readyDir = 'sell';
            
            if (readyDir) {
                const price = TFManager.getCurrentPrice('15m');
                if (!price) return;
                
                const targetPts = 21;
                const targetDist = targetPts * this.POINT_VALUE;
                const target = readyDir === 'buy' ? price + targetDist : price - targetDist;
                
                this.hunterTrade = {
                    direction: readyDir, entry: price, target, targetPts,
                    openedAt: Date.now(), currentPts: 0, maxPts: 0, currentPrice: price,
                    status: 'active', result: null, resultColor: null, closePrice: null,
                    votes: 'صعود ' + r.buyVotes + ' - هبوط ' + r.sellVotes
                };
                
                this.playAlert('ready');
                setTimeout(() => this.playAlert('ready'), 500);
                setTimeout(() => this.playAlert('ready'), 1000);
                
                this.notify('🎯 صفقة قنص كبرى! اتجاه: ' + (readyDir === 'buy' ? 'صعود' : 'هبوط') + ' (' + this.hunterTrade.votes + ')', readyDir);
            }
        } else {
            const trade = this.hunterTrade;
            const price = TFManager.getCurrentPrice('15m');
            if (!price) return;
            
            const pts = trade.direction === 'buy' 
                ? Math.round((price - trade.entry) / this.POINT_VALUE)
                : Math.round((trade.entry - price) / this.POINT_VALUE);
                
            trade.currentPts = pts;
            trade.maxPts = Math.max(trade.maxPts, pts);
            trade.currentPrice = price;
            
            if (pts >= trade.targetPts) {
                trade.status = 'success';
                trade.result = '✅ نجحت (+' + trade.targetPts + ' نقطة)';
                trade.resultColor = '#00E676';
                trade.closePrice = price;
                trade.closedAt = Date.now();
                this.hunterHistory.unshift(trade);
                this.hunterTrade = null;
                this.playAlert('target');
                this.notify('🎯 نجاح صفقة القناص! (+' + trade.targetPts + ' نقطة)', 'success');
                return;
            }
            
            const r = this.evaluateHunter();
            const reversal = (trade.direction === 'buy' && r.sellVotes > r.buyVotes && r.sellVotes >= 2) ||
                             (trade.direction === 'sell' && r.buyVotes > r.sellVotes && r.buyVotes >= 2);
                             
            if (reversal) {
                trade.status = 'reversed';
                trade.result = '❌ انعكاس (' + (pts >= 0 ? '+' : '') + pts + ' نقطة)';
                trade.resultColor = '#FF5252';
                trade.closePrice = price;
                trade.closedAt = Date.now();
                this.hunterHistory.unshift(trade);
                this.hunterTrade = null;
                this.notify('🎯 فشل صفقة القناص - تغير الاتجاه المجمع!', 'warning');
            }
        }
    }
};
;

    fs.writeFileSync('signals.js', content, 'utf8');
    console.log("Updated signals.js successfully!");
} else {
    console.log("Could not find insertion point in signals.js");
}
