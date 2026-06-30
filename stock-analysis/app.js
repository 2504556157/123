 const express = require('express');
 const path = require('path');
 const cron = require('node-cron');
 let notifier;
try { notifier = require('node-notifier'); } catch (e) { notifier = null; }
 const dayjs = require('dayjs');
 const dbPromise = require('./db');
let db;
 
const app = express();
const PORT = process.env.PORT || 3001;

 // ─── Detect LAN IP ──────────────────────────────────────────────────
 const os = require('os');
 function getLanIp() {
   const ifaces = os.networkInterfaces();
   for (const name of Object.keys(ifaces)) {
     for (const iface of ifaces[name]) {
       if (iface.family === 'IPv4' && !iface.internal) {
         return iface.address;
       }
     }
   }
   return 'localhost';
 }
 const LAN_IP = getLanIp();
 
 // Middleware
 app.use(express.json());
 app.use(express.urlencoded({ extended: true }));
 app.use(express.static(path.join(__dirname, 'public')));
 
 // Set EJS as view engine
 app.set('view engine', 'ejs');
 app.set('views', path.join(__dirname, 'views'));
 
 // ─── Helper ──────────────────────────────────────────────────────────
 function today() {
   return dayjs().format('YYYY-MM-DD');
 }
 
 

async function main() {
  db = await dbPromise;
// ─── Routes ──────────────────────────────────────────────────────────
 
 // Dashboard
 app.get('/', (req, res) => {
   const date = today();
 
   // Get today's checkin status
   const checkin = db.prepare('SELECT * FROM daily_checkins WHERE checkin_date = ?').get(date);
 
   // Get all stocks/sectors with their latest analysis
   const stocks = db.prepare(`
     SELECT s.*, a.id as analysis_id, a.analysis_date, a.chan_theory, a.volume_price
     FROM stocks s
     LEFT JOIN analysis a ON a.stock_id = s.id AND a.analysis_date = ?
     ORDER BY s.type, s.name
   `).all(date);
 
   // Get recent predictions (last 30 days) with accuracy stats
   const recentPredictions = db.prepare(`
     SELECT p.*, s.name as stock_name, s.code as stock_code, a.analysis_date
     FROM predictions p
     JOIN analysis a ON p.analysis_id = a.id
     JOIN stocks s ON a.stock_id = s.id
     WHERE a.analysis_date >= ?
     ORDER BY p.created_at DESC
   `).all(dayjs().subtract(14, 'day').format('YYYY-MM-DD'));
 
   // Calculate accuracy for last 14 days
   const accuracyStats = db.prepare(`
     SELECT
       COUNT(*) as total,
       SUM(CASE WHEN p.is_correct = 1 THEN 1 ELSE 0 END) as correct,
       SUM(CASE WHEN p.is_correct = 0 THEN 1 ELSE 0 END) as incorrect,
       SUM(CASE WHEN p.is_correct IS NULL THEN 1 ELSE 0 END) as pending
     FROM predictions p
     JOIN analysis a ON p.analysis_id = a.id
     WHERE a.analysis_date >= ?
   `).get(dayjs().subtract(14, 'day').format('YYYY-MM-DD'));
 
   // Get daily accuracy breakdown for the chart
   const dailyAccuracy = db.prepare(`
     SELECT a.analysis_date,
       COUNT(*) as total,
       SUM(CASE WHEN p.is_correct = 1 THEN 1 ELSE 0 END) as correct,
       SUM(CASE WHEN p.is_correct = 0 THEN 1 ELSE 0 END) as incorrect,
       SUM(CASE WHEN p.is_correct IS NULL THEN 1 ELSE 0 END) as pending
     FROM predictions p
     JOIN analysis a ON p.analysis_id = a.id
     WHERE a.analysis_date >= ?
     GROUP BY a.analysis_date
     ORDER BY a.analysis_date DESC
   `).all(dayjs().subtract(14, 'day').format('YYYY-MM-DD'));
 
    res.render('index', {
      date,
      checkin,
      stocks,
      recentPredictions,
      accuracyStats,
      dailyAccuracy,
      dayjs,
      lanIp: LAN_IP,
      port: PORT
    });
 });
 
 // ─── Stock API ────────────────────────────────────────────────────────
 
 // List all stocks/sectors
 app.get('/api/stocks', (req, res) => {
   const stocks = db.prepare('SELECT * FROM stocks ORDER BY type, name').all();
   res.json(stocks);
 });
 
 // Add stock/sector
 app.post('/api/stocks', (req, res) => {
   const { code, name, type } = req.body;
   if (!code || !name) {
     return res.status(400).json({ error: '股票代码和名称不能为空' });
   }
   try {
     const stmt = db.prepare('INSERT INTO stocks (code, name, type) VALUES (?, ?, ?)');
     const result = stmt.run(code, name, type || 'stock');
     res.json({ id: result.lastInsertRowid, code, name, type: type || 'stock' });
   } catch (e) {
     if (e.message.includes('UNIQUE')) {
       return res.status(409).json({ error: '该股票/板块已存在' });
     }
     res.status(500).json({ error: e.message });
   }
 });
 
 // Delete stock
 app.delete('/api/stocks/:id', (req, res) => {
   const { id } = req.params;
   // Delete related analysis and predictions first
   const analyses = db.prepare('SELECT id FROM analysis WHERE stock_id = ?').all(id);
   const analysisIds = analyses.map(a => a.id);
   if (analysisIds.length > 0) {
     db.prepare(`DELETE FROM predictions WHERE analysis_id IN (${analysisIds.map(() => '?').join(',')})`).run(...analysisIds);
     db.prepare(`DELETE FROM analysis WHERE stock_id = ?`).run(id);
   }
   db.prepare('DELETE FROM stocks WHERE id = ?').run(id);
   res.json({ success: true });
 });
 
 // ─── Analysis API ─────────────────────────────────────────────────────
 
 // Submit analysis
 app.post('/api/analysis', (req, res) => {
   const { stock_id, chan_theory, volume_price } = req.body;
   const date = today();
 
   if (!stock_id) {
     return res.status(400).json({ error: '请选择股票' });
   }
 
   try {
     const stmt = db.prepare(`
       INSERT INTO analysis (stock_id, analysis_date, chan_theory, volume_price)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(stock_id, analysis_date) DO UPDATE SET
         chan_theory = excluded.chan_theory,
         volume_price = excluded.volume_price
     `);
     const result = stmt.run(stock_id, date, chan_theory || '', volume_price || '');
 
     // Get the analysis ID
     const analysis = db.prepare('SELECT id FROM analysis WHERE stock_id = ? AND analysis_date = ?').get(stock_id, date);
 
     res.json({ id: analysis.id, stock_id, date });
   } catch (e) {
     res.status(500).json({ error: e.message });
   }
 });
 
 // Get analysis history for a stock
 app.get('/api/analysis/:stockId', (req, res) => {
   const { stockId } = req.params;
   const analyses = db.prepare(`
     SELECT a.*, p.id as prediction_id, p.direction, p.reason, p.actual_result, p.is_correct, p.verified_at
     FROM analysis a
     LEFT JOIN predictions p ON p.analysis_id = a.id
     WHERE a.stock_id = ?
     ORDER BY a.analysis_date DESC
     LIMIT 30
   `).all(stockId);
   res.json(analyses);
 });
 
 // Get today's analysis for all tracked stocks
 app.get('/api/analysis-today', (req, res) => {
   const date = today();
   const analyses = db.prepare(`
     SELECT a.*, s.name as stock_name, s.code as stock_code, s.type as stock_type,
            p.id as prediction_id, p.direction, p.reason, p.actual_result, p.is_correct
     FROM analysis a
     JOIN stocks s ON a.stock_id = s.id
     LEFT JOIN predictions p ON p.analysis_id = a.id
     WHERE a.analysis_date = ?
     ORDER BY s.type, s.name
   `).all(date);
   res.json(analyses);
 });
 
 // ─── Prediction API ──────────────────────────────────────────────────
 
 // Submit prediction
 app.post('/api/predictions', (req, res) => {
   const { analysis_id, direction, reason } = req.body;
   if (!analysis_id || !direction) {
     return res.status(400).json({ error: '分析ID和预测方向不能为空' });
   }
   if (!['up', 'down', 'sideways'].includes(direction)) {
     return res.status(400).json({ error: '预测方向无效' });
   }
 
   try {
     const stmt = db.prepare(`
       INSERT INTO predictions (analysis_id, direction, reason)
       VALUES (?, ?, ?)
     `);
     const result = stmt.run(analysis_id, direction, reason || '');
     res.json({ id: result.lastInsertRowid });
   } catch (e) {
     res.status(500).json({ error: e.message });
   }
 });
 
 // Verify prediction (mark actual result)
 app.post('/api/predictions/:id/verify', (req, res) => {
   const { id } = req.params;
   const { actual_result } = req.body;
 
   if (!['up', 'down', 'sideways'].includes(actual_result)) {
     return res.status(400).json({ error: '实际结果无效' });
   }
 
   try {
     const prediction = db.prepare('SELECT * FROM predictions WHERE id = ?').get(id);
     if (!prediction) {
       return res.status(404).json({ error: '预测记录不存在' });
     }
 
     const is_correct = prediction.direction === actual_result ? 1 : 0;
 
     db.prepare(`
       UPDATE predictions SET actual_result = ?, is_correct = ?, verified_at = datetime('now', 'localtime')
       WHERE id = ?
     `).run(actual_result, is_correct, id);
 
     res.json({ success: true, is_correct: !!is_correct });
   } catch (e) {
     res.status(500).json({ error: e.message });
   }
 });
 
 // ─── Check-in API ────────────────────────────────────────────────────
 
 // Get today's checkin status
 app.get('/api/checkin', (req, res) => {
   const checkin = db.prepare('SELECT * FROM daily_checkins WHERE checkin_date = ?').get(today());
   res.json({ checked_in: !!checkin, checkin });
 });
 
 // Do check-in
 app.post('/api/checkin', (req, res) => {
   const { notes } = req.body;
   try {
     db.prepare('INSERT INTO daily_checkins (checkin_date, notes) VALUES (?, ?)')
       .run(today(), notes || '');
     // Send checkin notification
     sendNotification('✅ 打卡成功', `已完成 ${today()} 的股票分析打卡`);
     res.json({ success: true, date: today() });
   } catch (e) {
     if (e.message.includes('UNIQUE')) {
       return res.status(409).json({ error: '今日已打卡' });
     }
     res.status(500).json({ error: e.message });
   }
 });
 
 // ─── Notification ────────────────────────────────────────────────────
 
 function sendNotification(title, message) {
  if (!notifier) return;
   notifier.notify({
     title: title || '股票分析助手',
     message: message || '',
     icon: path.join(__dirname, 'public', 'icon.png'),
     sound: true,
     wait: false,
     timeout: 10
   });
 }
 
 // ─── Cron: Nightly reminder at 20:00 (8 PM) ─────────────────────────
 

// ─── Auto-verify unverified predictions ────────────────────────────
app.post('/api/auto-verify', async (req, res) => {
  try {
    const unverified = db.prepare(`
      SELECT p.id, p.direction, p.reference_price, p.price_date, p.created_at,
             s.code as stock_code, s.name as stock_name, a.analysis_date
      FROM predictions p
      JOIN analysis a ON p.analysis_id = a.id
      JOIN stocks s ON a.stock_id = s.id
      WHERE p.is_correct IS NULL AND s.type = 'stock'
        AND p.created_at < datetime('now', '-1 day')
        AND p.reference_price IS NOT NULL
    `).all();

    const results = [];
    for (const pred of unverified) {
      try {
        const priceData = await fetchStockPrice(pred.stock_code);
        if (!priceData || !priceData.current) continue;

        const refPrice = pred.reference_price;
        const curPrice = priceData.current;
        const changePct = ((curPrice - refPrice) / refPrice) * 100;

        let actualResult;
        if (changePct > 1.0) actualResult = 'up';
        else if (changePct < -1.0) actualResult = 'down';
        else actualResult = 'sideways';

        const isCorrect = pred.direction === actualResult ? 1 : 0;

        db.prepare(`
          UPDATE predictions SET actual_result = ?, is_correct = ?, verified_at = datetime('now', 'localtime')
          WHERE id = ?
        `).run(actualResult, isCorrect, pred.id);

        results.push({
          id: pred.id,
          stock: pred.stock_name + ' (' + pred.stock_code + ')',
          predicted: pred.direction,
          actual: actualResult,
          change: Math.round(changePct * 100) / 100 + '%',
          correct: !!isCorrect
        });
      } catch (e) {
        console.error('Auto-verify error for', pred.stock_code, ':', e.message);
      }
    }

    res.json({ verified: results.length, details: results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

cron.schedule('0 20 * * *', () => {
   const todayStr = today();
   const checkin = db.prepare('SELECT * FROM daily_checkins WHERE checkin_date = ?').get(todayStr);
 
   if (!checkin) {
     sendNotification(
       '🌙 每日分析提醒',
       `今日（${todayStr}）尚未进行股票分析打卡，请打开应用完成分析！`
     );
   } else {
     // Check if all stocks have been analyzed today
     const stocks = db.prepare('SELECT COUNT(*) as count FROM stocks').get();
     const analyzed = db.prepare('SELECT COUNT(*) as count FROM analysis WHERE analysis_date = ?').get(todayStr);
     if (stocks.count > 0 && analyzed.count < stocks.count) {
       sendNotification(
         '📊 部分股票尚未分析',
         `今日已分析 ${analyzed.count}/${stocks.count} 只股票，还有 ${stocks.count - analyzed.count} 只待分析`
       );
     }
   }
 });
 
 // ─── Also remind at 21:00 (9 PM) if still not done ──────────────────
 cron.schedule('0 21 * * *', () => {
   const todayStr = today();
   const checkin = db.prepare('SELECT * FROM daily_checkins WHERE checkin_date = ?').get(todayStr);
   if (!checkin) {
     sendNotification(
       '⚠️ 夜间提醒',
       `已经晚上9点了！今日（${todayStr}）股票分析尚未完成，请尽快打卡！`
     );
   }
 });
 
 // ─── Start server ────────────────────────────────────────────────────
 
// ─── Auto-verify cron: 16:10 weekdays (after market close) ─────────
cron.schedule('10 16 * * 1-5', async () => {
  console.log('[Auto-Verify] Running daily verification at', new Date().toLocaleString());
  try {
    const unverified = db.prepare(`
      SELECT p.id, p.direction, p.reference_price,
             s.code as stock_code, s.name as stock_name
      FROM predictions p
      JOIN analysis a ON p.analysis_id = a.id
      JOIN stocks s ON a.stock_id = s.id
      WHERE p.is_correct IS NULL AND s.type = 'stock'
        AND p.created_at < datetime('now', '-1 day')
        AND p.reference_price IS NOT NULL
    `).all();

    let verified = 0;
    for (const pred of unverified) {
      try {
        const priceData = await fetchStockPrice(pred.stock_code);
        if (!priceData || !priceData.current) continue;

        const refPrice = pred.reference_price;
        const curPrice = priceData.current;
        const changePct = ((curPrice - refPrice) / refPrice) * 100;

        let actualResult;
        if (changePct > 1.0) actualResult = 'up';
        else if (changePct < -1.0) actualResult = 'down';
        else actualResult = 'sideways';

        const isCorrect = pred.direction === actualResult ? 1 : 0;

        db.prepare(`
          UPDATE predictions SET actual_result = ?, is_correct = ?, verified_at = datetime('now', 'localtime')
          WHERE id = ?
        `).run(actualResult, isCorrect, pred.id);
        verified++;
      } catch (e) { /* skip individual errors */ }
    }
    console.log('[Auto-Verify] Verified', verified, 'predictions');
  } catch (e) {
    console.error('[Auto-Verify] Error:', e.message);
  }
});


app.listen(PORT, () => {
   console.log(`📈 股票分析助手服务已启动: http://localhost:${PORT}`);
   console.log(`⏰ 自动验证已设置: 工作日 16:10 运行`);
 });
 // ─── Check-in Calendar API ──────────────────────────────────────────
 
 // Get all check-in dates (for calendar)
 app.get('/api/checkins', (req, res) => {
   const checkins = db.prepare('SELECT checkin_date FROM daily_checkins ORDER BY checkin_date').all();
   res.json(checkins.map(c => c.checkin_date));
 });
 
 // ─── Stock Search API (proxy to East Money) ─────────────────────────
 
 app.get('/api/stock-search', async (req, res) => {
   const { q } = req.query;
   if (!q || q.length < 1) return res.json([]);
 
   try {
     const url = `https://searchadapter.eastmoney.com/api/suggest/get?input=${encodeURIComponent(q)}&type=14&token=D9BFEBEBB0B142A3E6D33C4BB158C9BB`;
     const response = await fetch(url, {
       headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
     });
     const data = await response.json();
     const table = data.QuotationCodeTable && data.QuotationCodeTable.Data;
     if (!table) return res.json([]);
 
      const results = table
        .filter(item => item.SecurityType !== 8)
        .map(item => {
          const isSector = item.SecurityType === 9 || (item.SecurityTypeName && item.SecurityTypeName.includes("板块"));
          const codeNum = item.Code || "";
          let fullCode = codeNum;
          if (!isSector) {
            fullCode = codeNum + (item.MarketType === "1" ? ".SH" : ".SZ");
          }
          return {
            code: fullCode,
            name: item.Name || "",
            exchange: item.MarketType === "1" ? "SH" : "SZ",
            type: isSector ? "sector" : "stock"
          };
        });
      res.json(results);
    } catch (e) {
      console.error("Stock search error:", e.message);
      res.json([]);
    }
  });
}

main().catch(err => { console.error('Failed to start:', err.message); process.exit(1); });

