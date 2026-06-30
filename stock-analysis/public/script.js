 // ─── Toast ──────────────────────────────────────────────────────────
 function toast(msg, type = 'info') {
   const t = document.createElement('div');
   t.className = `toast ${type}`;
   t.textContent = msg;
   document.body.appendChild(t);
   setTimeout(() => t.remove(), 3000);
 }
 
 // ─── Modal helpers ──────────────────────────────────────────────────
 function openModal(id) { document.getElementById(id).style.display = 'flex'; }
 function closeModal() { document.getElementById('analysisModal').style.display = 'none'; }
 function closeAddStock() { document.getElementById('addStockModal').style.display = 'none'; }
 
 // ─── Check-in ───────────────────────────────────────────────────────
 async function doCheckin() {
   try {
     const res = await fetch('/api/checkin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
     const data = await res.json();
     if (data.success) {
       toast('✅ 打卡成功！', 'success');
       location.reload();
     } else {
       toast(data.error || '打卡失败', 'error');
     }
   } catch (e) {
     toast('网络错误', 'error');
   }
 }
 
 // ─── Add Stock ──────────────────────────────────────────────────────
 function showAddStock() { openModal('addStockModal'); }
 
async function addStock(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  // Auto-detect type from code
  const code = (data.code || '').toUpperCase();
  if (code.startsWith('BK') || code.startsWith('板块') || code.startsWith('BK')) {
    data.type = 'sector';
  }
  try {
    const res = await fetch('/api/stocks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
     if (res.ok) {
       toast('✅ 添加成功', 'success');
       closeAddStock();
       form.reset();
       location.reload();
     } else {
       const err = await res.json();
       toast(err.error || '添加失败', 'error');
     }
   } catch (e) {
     toast('网络错误', 'error');
   }
 }
 
 async function deleteStock(id, name) {
   if (!confirm(`确定删除「${name}」及其所有分析记录？`)) return;
   try {
     const res = await fetch(`/api/stocks/${id}`, { method: 'DELETE' });
     if (res.ok) {
       toast('✅ 已删除', 'success');
       location.reload();
     } else {
       toast('删除失败', 'error');
     }
   } catch (e) {
     toast('网络错误', 'error');
   }
 }
 
 // ─── Analysis ───────────────────────────────────────────────────────
 function openAnalysis(stockId, stockName) {
   document.getElementById('stockId').value = stockId;
   document.getElementById('modalTitle').textContent = `📝 ${stockName} 分析`;
   document.getElementById('chanTheory').value = '';
   document.getElementById('volumePrice').value = '';
   document.getElementById('predictionReason').value = '';
   // Uncheck all radio buttons
   document.querySelectorAll('input[name="direction"]').forEach(r => r.checked = false);
   openModal('analysisModal');
 }
 
 async function submitAnalysis(e) {
   e.preventDefault();
   const form = e.target;
   const stockId = document.getElementById('stockId').value;
   const chanTheory = document.getElementById('chanTheory').value.trim();
   const volumePrice = document.getElementById('volumePrice').value.trim();
   const direction = document.querySelector('input[name="direction"]:checked');
   const reason = document.getElementById('predictionReason').value.trim();
 
   if (!chanTheory && !volumePrice) {
     toast('请至少填写一种分析内容', 'error');
     return;
   }
   if (!direction) {
     toast('请选择预测方向', 'error');
     return;
   }
 
   try {
     // Save analysis
     const analysisRes = await fetch('/api/analysis', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ stock_id: stockId, chan_theory: chanTheory, volume_price: volumePrice })
  });

     const analysisData = await analysisRes.json();
     if (!analysisData.id) {
       toast(analysisData.error || '分析保存失败', 'error');
       return;
     }
 
     // Save prediction
     const predRes = await fetch('/api/predictions', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ analysis_id: analysisData.id, direction: direction.value, reason })
     });
     const predData = await predRes.json();
     if (!predData.id) {
       toast(predData.error || '预测保存失败', 'error');
       return;
     }
 
     toast('✅ 分析与预测已保存！', 'success');
     closeModal();
     location.reload();
   } catch (e) {
     toast('网络错误', 'error');
   }
 }
 
 // ─── Verify Prediction ─────────────────────────────────────────────
 async function verifyPrediction(id, actualResult) {
   const labels = { up: '看涨', down: '看跌', sideways: '震荡' };
   if (!confirm(`确定标记结果为「${labels[actualResult]}」？此操作不可撤销。`)) return;
 
   try {
     const res = await fetch(`/api/predictions/${id}/verify`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ actual_result: actualResult })
     });
     const data = await res.json();
     if (data.success) {
       toast(data.is_correct ? '✅ 预测正确！' : '❌ 预测错误', data.is_correct ? 'success' : 'error');
       location.reload();
     } else {
       toast(data.error || '验证失败', 'error');
     }
   } catch (e) {
     toast('网络错误', 'error');
   }
 }
 
 // ─── Load Today's Analysis Summary ──────────────────────────────────
 document.addEventListener('DOMContentLoaded', async () => {
   const container = document.getElementById('todayAnalysis');
   try {
     const res = await fetch('/api/analysis-today');
     const analyses = await res.json();
 
     if (analyses.length === 0) {
       container.innerHTML = '<div class="empty-state"><p>今日尚未分析任何股票</p></div>';
       return;
     }
 
     container.innerHTML = analyses.map(a => {
       const predLabel = a.direction ? { up: '📈 看涨', down: '📉 看跌', sideways: '➡️ 震荡' }[a.direction] : '';
       const predClass = a.direction || '';
       const chanPreview = a.chan_theory ? a.chan_theory.slice(0, 60) + (a.chan_theory.length > 60 ? '...' : '') : '';
       const vpPreview = a.volume_price ? a.volume_price.slice(0, 60) + (a.volume_price.length > 60 ? '...' : '') : '';
 
       return `<div class="analysis-mini-item">
         <div class="analysis-mini-header">
           <span class="analysis-mini-stock">${a.stock_name} (${a.stock_code})</span>
           ${predLabel ? `<span class="analysis-mini-pred ${predClass}">${predLabel}</span>` : ''}
         </div>
         ${chanPreview ? `<div class="analysis-mini-text">🐉 ${chanPreview}</div>` : ''}
         ${vpPreview ? `<div class="analysis-mini-text">📊 ${vpPreview}</div>` : ''}
       </div>`;
     }).join('');
   } catch (e) {
     container.innerHTML = '<div class="empty-state"><p>加载失败</p></div>';
   }
 });
 
 // ─── Keyboard shortcut: Escape closes modals ───────────────────────
 document.addEventListener('keydown', (e) => {
   if (e.key === 'Escape') {
     closeModal();
     closeAddStock();
   }
 });


// ═══ Calendar ═════════════════════════════════════════════════════

let calendarYear, calendarMonth, checkinDates = [];

async function loadCheckinDates() {
  try {
    const res = await fetch('/api/checkins');
    checkinDates = await res.json();
  } catch (e) { checkinDates = []; }
}

function renderCalendar() {
  const title = document.getElementById('calendarTitle');
  const grid = document.getElementById('calendarGrid');
  if (!title || !grid) return;

  const now = new Date();
  const year = calendarYear || now.getFullYear();
  const month = calendarMonth !== undefined ? calendarMonth : now.getMonth();

  title.textContent = `${year}年${month + 1}月`;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayParts = todayStr.split('-');
  const todayDate = parseInt(todayParts[2]);
  const todayMonth = parseInt(todayParts[1]) - 1;
  const todayYear = parseInt(todayParts[0]);

  let html = '';
  for (let i = 0; i < firstDay; i++) {
    html += '<div class="cal-cell empty"></div>';
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = d === todayDate && month === todayMonth && year === todayYear;
    const isChecked = checkinDates.includes(dateStr);
    let cls = 'cal-cell';
    if (isToday) cls += ' today';
    if (isChecked) cls += ' checked';
    if (isToday && isChecked) cls += ' both';
    html += `<div class="${cls}"><span class="cal-day">${d}</span>${isChecked ? '<span class="cal-dot"></span>' : ''}</div>`;
  }

  grid.innerHTML = html;
}

function calendarPrevMonth() {
  if (calendarMonth === undefined) {
    const now = new Date();
    calendarYear = now.getFullYear();
    calendarMonth = now.getMonth();
  }
  calendarMonth--;
  if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
  renderCalendar();
}

function calendarNextMonth() {
  if (calendarMonth === undefined) {
    const now = new Date();
    calendarYear = now.getFullYear();
    calendarMonth = now.getMonth();
  }
  calendarMonth++;
  if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
  renderCalendar();
}

// ─── Stock Code Search ─────────────────────────────────────────────

let searchTimeout = null;

document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('stockSearchInput');
  const resultsDiv = document.getElementById('searchResults');
  if (!searchInput) return;

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = searchInput.value.trim();
    if (q.length < 1) {
      resultsDiv.style.display = 'none';
      return;
    }
    searchTimeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/stock-search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (data.length === 0) {
          resultsDiv.innerHTML = '<div class="search-empty">无匹配结果</div>';
          resultsDiv.style.display = 'block';
          return;
        }
        resultsDiv.innerHTML = data.map(item => `
          <div class="search-item" data-code="${item.code}" data-name="${item.name}" data-type="${item.type}">
            <span class="search-item-code">${item.code}</span>
            <span class="search-item-name">${item.name}</span>
            <span class="search-item-type">${item.type === 'sector' ? '板块' : '股票'}</span>
          </div>
        `).join('');
        resultsDiv.style.display = 'block';
      } catch (e) {
        resultsDiv.style.display = 'none';
      }
    }, 300);
  });

  resultsDiv.addEventListener('click', (e) => {
    const item = e.target.closest('.search-item');
    if (!item) return;
    document.getElementById('selectedCode').value = item.dataset.code;
    document.getElementById('selectedName').value = item.dataset.name;
    document.getElementById('selectedType').value = item.dataset.type;
    resultsDiv.style.display = 'none';
    searchInput.value = item.dataset.name + ' (' + item.dataset.code + ')';
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrapper')) {
      resultsDiv.style.display = 'none';
    }
  });
});

// ─── Auto-detect stock/sector type on code input ───────────────────
document.addEventListener('DOMContentLoaded', () => {
  const codeInput = document.getElementById('selectedCode');
  const typeSelect = document.getElementById('selectedType');
  if (!codeInput || !typeSelect) return;
  codeInput.addEventListener('input', () => {
    const code = codeInput.value.trim().toUpperCase();
    if (code.startsWith('BK')) {
      typeSelect.value = 'sector';
    } else if (code.match(/^\d/)) {
      typeSelect.value = 'stock';
    }
  });
});

// ─── Init Calendar on load ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadCheckinDates();
  renderCalendar();
});

// ─── Auto Verify All Predictions ────────────────────────────────────
async function autoVerifyAll() {
  const btn = document.getElementById('autoVerifyBtn');
  if (!btn) return;
  const origText = btn.textContent;
  btn.textContent = '⏳ 验证中...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/auto-verify', { method: 'POST' });
    const data = await res.json();
    if (data.verified > 0) {
      toast(`✅ 自动验证完成：${data.verified} 条已更新`, 'success');
    } else {
      toast('ℹ️ 没有符合自动验证条件的预测（需持仓过至少1个交易日且有参考价格）', 'info');
    }
  } catch (e) {
    toast('自动验证请求失败', 'error');
  } finally {
    btn.textContent = origText;
    btn.disabled = false;
    location.reload();
  }
}
