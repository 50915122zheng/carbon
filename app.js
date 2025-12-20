/* EcoCampus – Carbon Footprint Calculator (Front-end only)
 * - Data stored in localStorage
 * - Charts: last 7 days trend + category split
 */

// -----------------------------
// Utilities (Local Date safe)
// -----------------------------
const pad2 = (n) => String(n).padStart(2, '0');

function localISO(d = new Date()) {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}`;
}

function parseISOToLocalDate(iso) {
  // iso: YYYY-MM-DD
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDaysISO(iso, deltaDays) {
  const d = parseISOToLocalDate(iso);
  d.setDate(d.getDate() + deltaDays);
  return localISO(d);
}

function startOfWeekISO(iso = localISO()) {
  const d = parseISOToLocalDate(iso);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const diffToMon = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diffToMon);
  return localISO(d);
}

function fmtMMDD(iso) {
  const [, m, d] = iso.split('-');
  return `${m}-${d}`;
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

function clamp0(x) {
  return Number.isFinite(x) ? Math.max(0, x) : 0;
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

// -----------------------------
// Storage
// -----------------------------
const KEYS = {
  records: 'ecocampus_records_v1',
  factors: 'ecocampus_factors_v1',
};

// Factors are editable in "碳排資料庫".
// Units are per unit (km, kWh, meal, hr, piece, stick, times)
const DEFAULT_FACTORS = {
  transport: {
    walk_km:   { label: '步行', unit: 'km', value: 0 },
    bike_km:   { label: '騎腳踏車', unit: 'km', value: 0 },
    mrt_km:    { label: '捷運', unit: 'km', value: 0.04 },
    bus_km:    { label: '公車', unit: 'km', value: 0.04 },
    scooter_km:{ label: '機車', unit: 'km', value: 0.1 },
    car_km:    { label: '汽車', unit: 'km', value: 0.17 },
  },
  electricity: {
    grid_kwh:  { label: '用電（台電）', unit: 'kWh', value: 0.509 },
  },
  diet: {
    veg_meal:      { label: '蔬食/素食（餐）', unit: 'meal', value: 0.7 },
    redmeat_meal:  { label: '紅肉（牛/豬/羊）餐', unit: 'meal', value: 2.5 },
    chicken_meal:  { label: '雞肉餐', unit: 'meal', value: 1.2 },
  },
  activity: {
    club_hr:   { label: '社團/活動', unit: 'hr', value: 0.12 },
    gym_hr:    { label: '健身房', unit: 'hr', value: 0.18 },
  },
  custom: {
    cigarette_stick: { label: '抽菸', unit: 'stick', value: 0.014 },
    fart_time:       { label: '放屁', unit: 'time', value: 0.00032 },
    smokebomb_piece: { label: '煙霧彈', unit: 'piece', value: 0.031 },
  }
};

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function loadFactors() {
  try {
    const raw = localStorage.getItem(KEYS.factors);
    if (!raw) {
      const init = deepClone(DEFAULT_FACTORS);
      localStorage.setItem(KEYS.factors, JSON.stringify(init));
      return init;
    }
    const parsed = JSON.parse(raw);
    // merge defaults (in case of future updates)
    const merged = deepClone(DEFAULT_FACTORS);
    for (const cat of Object.keys(parsed)) {
      merged[cat] ??= {};
      for (const k of Object.keys(parsed[cat] || {})) {
        merged[cat][k] = parsed[cat][k];
      }
    }
    localStorage.setItem(KEYS.factors, JSON.stringify(merged));
    return merged;
  } catch {
    const init = deepClone(DEFAULT_FACTORS);
    localStorage.setItem(KEYS.factors, JSON.stringify(init));
    return init;
  }
}

function saveFactors(factors) {
  localStorage.setItem(KEYS.factors, JSON.stringify(factors));
}

function loadRecords() {
  try {
    const raw = localStorage.getItem(KEYS.records);
    if (!raw) return [];
    return JSON.parse(raw) || [];
  } catch {
    return [];
  }
}

function saveRecords(records) {
  localStorage.setItem(KEYS.records, JSON.stringify(records));
}

// -----------------------------
// App State
// -----------------------------
let factors = loadFactors();
let records = loadRecords();

// Seed demo data if empty
if (records.length === 0) {
  const today = localISO();
  const demo = [];
  for (let i = 0; i < 7; i++) {
    const d = addDaysISO(today, -i);
    if (i % 2 === 0) demo.push(makeRecord({ date: d, category: 'transport', itemKey: 'mrt_km', amount: 6, note: '上課通勤' }));
    if (i % 3 === 0) demo.push(makeRecord({ date: d, category: 'diet', itemKey: 'veg_meal', amount: 1, note: '午餐' }));
    if (i % 4 === 0) demo.push(makeRecord({ date: d, category: 'electricity', itemKey: 'grid_kwh', amount: 2, note: '冷氣/插座' }));
  }
  records = demo;
  saveRecords(records);
}

// -----------------------------
// DOM helpers
// -----------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function showToast(msg) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove('hidden');
  toast.classList.add('opacity-100');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 2200);
}

// -----------------------------
// Record creation & calculation
// -----------------------------
function getFactor(category, itemKey) {
  return factors?.[category]?.[itemKey] || null;
}

function calcCO2e(category, itemKey, amount) {
  const f = getFactor(category, itemKey);
  const v = Number(amount);
  if (!f || !Number.isFinite(v)) return 0;
  return v * Number(f.value);
}

function makeRecord({ date, category, itemKey, amount, note = '' }) {
  const f = getFactor(category, itemKey);
  const co2e = calcCO2e(category, itemKey, amount);
  return {
    id: uid(),
    date,
    category,
    itemKey,
    itemLabel: f?.label || itemKey,
    unit: f?.unit || '',
    amount: Number(amount),
    co2e,
    note,
    createdAt: Date.now(),
  };
}

function addRecord(rec) {
  records.unshift(rec);
  saveRecords(records);
  refreshAll();
}

function deleteRecord(id) {
  records = records.filter(r => r.id !== id);
  saveRecords(records);
  refreshAll();
}

// -----------------------------
// Navigation
// -----------------------------
function setActiveNav(pageId) {
  $$('#sideNav .nav-item').forEach(a => {
    const isActive = a.dataset.page === pageId;
    a.classList.toggle('bg-green-600', isActive);
    a.classList.toggle('text-white', isActive);
    a.classList.toggle('text-gray-400', !isActive);
    a.classList.toggle('hover:bg-slate-800', !isActive);
  });
}

function showPage(pageId) {
  $$('.page').forEach(p => p.classList.remove('active'));
  const el = document.getElementById(`page-${pageId}`);
  if (el) el.classList.add('active');
  setActiveNav(pageId);
  // Some pages need render now
  if (pageId === 'database') renderFactorTable();
  if (pageId === 'records') renderRecordsTable();
  if (pageId === 'simulator') calcSimulator();
  if (pageId === 'leaderboard') renderLeaderboard();
}

// -----------------------------
// Dashboard summary + charts
// -----------------------------
let trendChart = null;
let categoryChart = null;
let simChart = null;

function totalsByDay(lastNDays = 7) {
  const today = localISO();
  const days = [];
  for (let i = lastNDays - 1; i >= 0; i--) {
    days.push(addDaysISO(today, -i));
  }
  const map = new Map(days.map(d => [d, 0]));
  for (const r of records) {
    if (map.has(r.date)) map.set(r.date, map.get(r.date) + Number(r.co2e || 0));
  }
  return { days, values: days.map(d => round2(map.get(d) || 0)) };
}

function totalsByCategorySince(startISO) {
  const cats = { transport: 0, electricity: 0, diet: 0, activity: 0, custom: 0 };
  for (const r of records) {
    if (r.date >= startISO) {
      cats[r.category] = (cats[r.category] || 0) + Number(r.co2e || 0);
    }
  }
  return cats;
}

function renderCharts() {
  const { days, values } = totalsByDay(7);
  const labels = days.map(fmtMMDD);

  const ctx1 = document.getElementById('trendChart')?.getContext('2d');
  if (ctx1) {
    if (trendChart) trendChart.destroy();
    trendChart = new Chart(ctx1, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: '碳排放量 (kg)',
          data: values,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.10)',
          fill: true,
          tension: 0.35,
          pointRadius: 4,
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: true }
        },
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  }

  const weekStart = addDaysISO(localISO(), -6);
  const cats = totalsByCategorySince(weekStart);
  const ctx2 = document.getElementById('categoryChart')?.getContext('2d');
  if (ctx2) {
    if (categoryChart) categoryChart.destroy();
    categoryChart = new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels: ['交通', '電力', '飲食', '活動', '其他'],
        datasets: [{
          data: [cats.transport, cats.electricity, cats.diet, cats.activity, cats.custom].map(round2),
          backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#64748b']
        }]
      },
      options: {
        plugins: { legend: { position: 'bottom' } }
      }
    });
  }
}

function renderSummary() {
  const today = localISO();
  const weekStart = startOfWeekISO(today);

  const todayTotal = records.filter(r => r.date === today).reduce((s, r) => s + Number(r.co2e || 0), 0);
  const weekTotal = records.filter(r => r.date >= weekStart).reduce((s, r) => s + Number(r.co2e || 0), 0);

  setText('kpiToday', round2(todayTotal));
  setText('kpiWeek', round2(weekTotal));

  // Simple points model (demo): lower weekly emission => higher points
  const pts = Math.max(0, Math.round(1000 - weekTotal * 40));
  setText('kpiPoints', pts);
}


function populateCategorySelects() {
  const catOrder = ['transport','electricity','diet','activity','custom'];
  const catZh = { transport: '交通', electricity: '電力', diet: '飲食', activity: '活動', custom: '其他' };

  const recSel = $('#recCategory');
  const filterSel = $('#filterCategory');
  const newSel = $('#newFactorCategory');

  if (recSel && recSel.options.length === 0) {
    catOrder.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = catZh[c] || c;
      recSel.appendChild(opt);
    });
    recSel.value = 'transport';
  }

  if (filterSel && filterSel.options.length === 0) {
    const optAll = document.createElement('option');
    optAll.value = 'all';
    optAll.textContent = '全部';
    filterSel.appendChild(optAll);
    catOrder.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = catZh[c] || c;
      filterSel.appendChild(opt);
    });
    filterSel.value = 'all';
  }

  if (newSel && newSel.options.length === 0) {
    catOrder.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = catZh[c] || c;
      newSel.appendChild(opt);
    });
    newSel.value = 'custom';
  }
}

// -----------------------------
// Records page
// -----------------------------
function buildItemOptions(category) {
  const items = factors[category] || {};
  const sel = $('#recType');
  if (!sel) return;
  sel.innerHTML = '';
  for (const [k, v] of Object.entries(items)) {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = v.label;
    sel.appendChild(opt);
  }
  updateUnitHint();
}

function updateUnitHint() {
  const cat = $('#recCategory')?.value;
  const item = $('#recType')?.value;
  const f = getFactor(cat, item);

  const unitInput = $('#recUnit');
  const hint = $('#recFactorHint');

  const unitZh = (u) => ({ km: '公里', kWh: '度(kWh)', meal: '餐', hr: '小時', stick: '根', time: '次', piece: '顆' }[u] || u);

  if (unitInput) unitInput.value = f ? unitZh(f.unit) : '-';
  if (hint) {
    hint.textContent = f ? `係數：${f.value} kgCO₂e / ${unitZh(f.unit)}` : '';
  }
}

function buildSimModeOptions() {
  const fromSel = $('#simFromMode');
  const toSel = $('#simToMode');
  if (!fromSel || !toSel) return;

  const items = factors.transport || {};
  const entries = Object.entries(items);

  const curFrom = fromSel.value || 'car_km';
  const curTo = toSel.value || 'mrt_km';

  fromSel.innerHTML = '';
  toSel.innerHTML = '';

  for (const [k, v] of entries) {
    const opt1 = document.createElement('option');
    opt1.value = k;
    opt1.textContent = v.label;
    fromSel.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = k;
    opt2.textContent = v.label;
    toSel.appendChild(opt2);
  }

  // reasonable defaults
  fromSel.value = entries.some(([k]) => k === curFrom) ? curFrom : (entries.some(([k]) => k === 'car_km') ? 'car_km' : (entries[0]?.[0] || ''));
  toSel.value = entries.some(([k]) => k === curTo) ? curTo : (entries.some(([k]) => k === 'mrt_km') ? 'mrt_km' : (entries[0]?.[0] || ''));
}


function renderRecordsTable() {
  const tbody = $('#recordsTbody');
  if (!tbody) return;

  const q = ($('#filterText')?.value || '').trim();
  const catFilter = $('#filterCategory')?.value || 'all';
  const dateFilter = ($('#filterDate')?.value || '').trim();

  let list = records.slice();
  if (catFilter !== 'all') list = list.filter(r => r.category === catFilter);
  if (dateFilter) list = list.filter(r => r.date === dateFilter);
  if (q) {
    list = list.filter(r => (r.itemLabel || '').includes(q) || (r.note || '').includes(q) || (r.date || '').includes(q));
  }

  tbody.innerHTML = '';
  if (list.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="p-4 text-gray-400" colspan="6">目前沒有符合條件的紀錄</td>`;
    tbody.appendChild(tr);
    return;
  }

  for (const r of list) {
    const tr = document.createElement('tr');
    tr.className = 'border-t';
    const catZh = ({ transport: '交通', electricity: '電力', diet: '飲食', activity: '活動', custom: '其他' }[r.category] || r.category);
    tr.innerHTML = `
      <td class="p-3 whitespace-nowrap text-sm text-gray-700">${r.date}</td>
      <td class="p-3 whitespace-nowrap text-sm">${catZh}</td>
      <td class="p-3 text-sm">${r.itemLabel}</td>
      <td class="p-3 whitespace-nowrap text-sm">${r.amount} ${r.unit}</td>
      <td class="p-3 whitespace-nowrap text-sm font-semibold text-gray-800">${round2(r.co2e)} kg</td>
      <td class="p-3 text-sm text-gray-600">${r.note || ''}</td>
      <td class="p-3 whitespace-nowrap text-sm">
        <button class="text-red-600 hover:underline" data-del="${r.id}">刪除</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  // bind delete
  tbody.querySelectorAll('button[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      deleteRecord(btn.dataset.del);
      showToast('已刪除紀錄');
    });
  });
}

function exportJSON() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    factors,
    records,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ecocampus_export_${localISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importJSON(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (data?.factors) {
    factors = data.factors;
    saveFactors(factors);
  }
  if (Array.isArray(data?.records)) {
    records = data.records;
    saveRecords(records);
  }
  refreshAll();
  showToast('匯入完成');
}


// -----------------------------
// Leaderboard (Demo)
// -----------------------------
function renderLeaderboard() {
  const tbody = $('#leaderTbody');
  if (!tbody) return;

  const weekStart = startOfWeekISO(localISO());
  const weekTotal = records.filter(r => r.date >= weekStart).reduce((s, r) => s + Number(r.co2e || 0), 0);
  const myPts = Math.max(0, Math.round(1000 - weekTotal * 40));

  const demo = [
    { name: '陳小明', pts: myPts, week: round2(weekTotal) },
    { name: '林小華', pts: 920, week: 2.1 },
    { name: '王同學', pts: 860, week: 3.5 },
    { name: '張同學', pts: 780, week: 5.4 },
    { name: '李同學', pts: 640, week: 9.2 },
  ].sort((a, b) => b.pts - a.pts);

  tbody.innerHTML = '';
  demo.forEach((r, idx) => {
    const tr = document.createElement('tr');
    tr.className = 'border-t';
    tr.innerHTML = `
      <td class="p-3">${idx + 1}</td>
      <td class="p-3">${r.name}</td>
      <td class="p-3 font-semibold text-amber-700">${r.pts}</td>
      <td class="p-3">${r.week} kgCO₂e</td>
    `;
    tbody.appendChild(tr);
  });
}

// -----------------------------
// Database page
// -----------------------------
function renderFactorTable() {
  const wrap = $('#factorsContainer');
  if (!wrap) return;

  const catOrder = ['transport', 'electricity', 'diet', 'activity', 'custom'];
  const catZh = { transport: '交通', electricity: '電力', diet: '飲食', activity: '活動', custom: '其他' };

  wrap.innerHTML = '';
  for (const cat of catOrder) {
    const box = document.createElement('div');
    box.className = 'bg-white p-6 rounded-2xl shadow-sm border';

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between mb-4';
    header.innerHTML = `
      <div>
        <h3 class="font-bold text-gray-800">${catZh[cat] || cat}</h3>
        <p class="text-xs text-gray-400">單位可在下方查看（不可更改），係數可直接修改</p>
      </div>
    `;

    const table = document.createElement('div');
    table.className = 'table-wrap';

    const items = factors[cat] || {};
    const rows = Object.entries(items).map(([k, v]) => {
      return `
        <tr class="border-t">
          <td class="p-3 text-sm text-gray-700">${v.label}</td>
          <td class="p-3 text-sm text-gray-500">${v.unit}</td>
          <td class="p-3">
            <input data-factor-cat="${cat}" data-factor-key="${k}" type="number" step="0.0001" min="0" value="${Number(v.value)}"
              class="w-40 border p-2 rounded-lg" />
          </td>
        </tr>
      `;
    }).join('');

    table.innerHTML = `
      <table class="w-full">
        <thead>
          <tr class="text-left text-xs text-gray-400">
            <th class="p-3">項目</th>
            <th class="p-3">單位</th>
            <th class="p-3">係數（kgCO₂e/單位）</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr class="border-t"><td class="p-3 text-gray-400" colspan="3">目前沒有項目</td></tr>`}</tbody>
      </table>
    `;

    box.appendChild(header);
    box.appendChild(table);
    wrap.appendChild(box);
  }

  // bind edits
  wrap.querySelectorAll('input[data-factor-cat]').forEach(inp => {
    inp.addEventListener('change', () => {
      const cat = inp.dataset.factorCat;
      const key = inp.dataset.factorKey;
      const v = clamp0(Number(inp.value));
      if (!factors[cat] || !factors[cat][key]) return;
      factors[cat][key].value = v;
      saveFactors(factors);
      // recalculates all records with updated factor (only those matching)
      recalcRecordsFor(cat, key);
      refreshAll();
      showToast('係數已更新');
    });
  });
}

function recalcRecordsFor(category, itemKey) {
  records = records.map(r => {
    if (r.category === category && r.itemKey === itemKey) {
      r.itemLabel = getFactor(category, itemKey)?.label || r.itemLabel;
      r.unit = getFactor(category, itemKey)?.unit || r.unit;
      r.co2e = calcCO2e(category, itemKey, r.amount);
    }
    return r;
  });
  saveRecords(records);
}

function addNewFactor() {
  const cat = $('#newFactorCategory')?.value;
  const label = ($('#newFactorName')?.value || '').trim();
  const unit = $('#newFactorUnit')?.value;
  const value = clamp0(Number($('#newFactorValue')?.value));

  if (!cat || !label || !unit) {
    showToast('請填完整：類別 / 名稱 / 單位');
    return;
  }

  const key = `${label}_${unit}`.replace(/\s+/g, '_').replace(/[()（）]/g, '').toLowerCase() + '_' + Math.random().toString(36).slice(2, 6);
  factors[cat] ??= {};
  factors[cat][key] = { label, unit, value };
  saveFactors(factors);

  // update selects
  buildItemOptions($('#recCategory')?.value || 'transport');
  renderFactorTable();
  showToast('已新增到資料庫');

  $('#newFactorName').value = '';
  $('#newFactorValue').value = '';
}

// -----------------------------
// AI parser (simple rules)
// -----------------------------
function simulateAI() {
  const input = ($('#aiInput')?.value || '').trim();
  const box = $('#aiResult');
  if (!box) return;

  if (!input) {
    box.classList.remove('hidden');
    box.textContent = '請輸入一句描述（例如：走 2 公里、搭捷運 8 公里、抽菸 2 根、放屁 3 次...）';
    return;
  }

  const created = [];
  const today = localISO();

  const add = (category, itemKey, amount, note) => {
    const r = makeRecord({ date: today, category, itemKey, amount, note });
    created.push(r);
  };

  // Walking
  if (/(走路|步行|走到|走去)/.test(input)) {
    const m = input.match(/(\d+(?:\.\d+)?)\s*(km|公里)/i);
    const km = m ? Number(m[1]) : 1;
    add('transport', 'walk_km', km, 'AI：步行');
  }

  // MRT
  if (/(捷運|地鐵)/.test(input)) {
    const m = input.match(/(\d+(?:\.\d+)?)\s*(km|公里)/i);
    const km = m ? Number(m[1]) : 6;
    add('transport', 'mrt_km', km, 'AI：捷運');
  }

  // Bus
  if (/(公車|巴士)/.test(input)) {
    const m = input.match(/(\d+(?:\.\d+)?)\s*(km|公里)/i);
    const km = m ? Number(m[1]) : 5;
    add('transport', 'bus_km', km, 'AI：公車');
  }

  // Scooter / car
  if (/(機車|騎車)/.test(input)) {
    const m = input.match(/(\d+(?:\.\d+)?)\s*(km|公里)/i);
    const km = m ? Number(m[1]) : 5;
    add('transport', 'scooter_km', km, 'AI：機車');
  }
  if (/(開車|汽車)/.test(input)) {
    const m = input.match(/(\d+(?:\.\d+)?)\s*(km|公里)/i);
    const km = m ? Number(m[1]) : 8;
    add('transport', 'car_km', km, 'AI：汽車');
  }

  // Diet
  if (/(吃素|蔬食|素食)/.test(input)) {
    const m = input.match(/(\d+)\s*(餐|次)/);
    const n = m ? Number(m[1]) : 1;
    add('diet', 'veg_meal', n, 'AI：蔬食');
  }
  if (/(牛肉|豬肉|羊肉|紅肉)/.test(input)) {
    const m = input.match(/(\d+)\s*(餐|次)/);
    const n = m ? Number(m[1]) : 1;
    add('diet', 'redmeat_meal', n, 'AI：紅肉');
  }

  // Electricity / AC
  if (/(冷氣|空調)/.test(input)) {
    const m = input.match(/(\d+(?:\.\d+)?)\s*(小時|hr|h)/i);
    const hrs = m ? Number(m[1]) : 2;
    // demo: assume 1 kW => kWh = hrs
    add('electricity', 'grid_kwh', hrs, 'AI：冷氣用電（估算）');
  }

  // Smoking
  if (/(抽菸|抽煙)/.test(input)) {
    const m = input.match(/(\d+)\s*(根|支)/);
    const n = m ? Number(m[1]) : 1;
    add('custom', 'cigarette_stick', n, 'AI：抽菸');
  }

  // Fart
  if (/(放屁)/.test(input)) {
    const m = input.match(/(\d+)\s*(次)?/);
    const n = m ? Number(m[1]) : 1;
    add('custom', 'fart_time', n, 'AI：放屁');
  }

  // Smoke bomb
  if (/(煙霧彈)/.test(input)) {
    const m = input.match(/(\d+)\s*(顆|枚|個)?/);
    const n = m ? Number(m[1]) : 1;
    add('custom', 'smokebomb_piece', n, 'AI：煙霧彈');
  }

  if (created.length === 0) {
    box.classList.remove('hidden');
    box.textContent = '✨ AI 解析：沒有偵測到可轉成紀錄的關鍵字（可試：走路/捷運/公車/冷氣/吃素/紅肉/抽菸/放屁/煙霧彈）';
    return;
  }

  // Commit
  const total = created.reduce((s, r) => s + r.co2e, 0);
  records = [...created, ...records];
  saveRecords(records);
  refreshAll();

  box.classList.remove('hidden');
  box.textContent = `✨ AI 解析完成：新增 ${created.length} 筆紀錄，合計 ${round2(total)} kgCO₂e（已加入今日紀錄）`;
  showToast('AI 已新增紀錄');
}

// -----------------------------
// Reduction Simulator
// -----------------------------
function calcSimulator() {
  // Enabled flags
  const meatOn = $('#simMeatEnabled') ? $('#simMeatEnabled').checked : true;
  const acOn = $('#simAcEnabled') ? $('#simAcEnabled').checked : true;
  const transOn = $('#simTransEnabled') ? $('#simTransEnabled').checked : true;

  // Pull default factors from DB
  const redDefault = getFactor('diet', 'redmeat_meal')?.value ?? 2.5;
  const vegDefault = getFactor('diet', 'veg_meal')?.value ?? 0.7;
  const gridDefault = getFactor('electricity', 'grid_kwh')?.value ?? 0.509;

  // Sync factor inputs (only fill when empty)
  if ($('#simMeatFactor') && !String($('#simMeatFactor').value || '').trim()) $('#simMeatFactor').value = String(redDefault);
  if ($('#simAltMealFactor') && !String($('#simAltMealFactor').value || '').trim()) $('#simAltMealFactor').value = String(vegDefault);
  if ($('#simGridFactor') && !String($('#simGridFactor').value || '').trim()) $('#simGridFactor').value = String(gridDefault);

  // 1) Reduce red meat meals
  const mealsReduced = clamp0(Number($('#simMeatMeals')?.value));
  const redFactor = clamp0(Number($('#simMeatFactor')?.value || redDefault));
  const altFactor = clamp0(Number($('#simAltMealFactor')?.value || vegDefault));
  const redMealSave = meatOn ? mealsReduced * Math.max(0, redFactor - altFactor) : 0;

  // 2) AC electricity shift
  const acKwh = clamp0(Number($('#simAcKwh')?.value));
  const oldKwhFactor = clamp0(Number($('#simGridFactor')?.value || gridDefault));
  const newKwhFactor = clamp0(Number($('#simBatteryFactor')?.value || 0));
  const acSave = acOn ? acKwh * Math.max(0, oldKwhFactor - newKwhFactor) : 0;

  // 3) Switch to public transport
  const km = clamp0(Number($('#simKm')?.value));
  const fromKey = $('#simFromMode')?.value;
  const toKey = $('#simToMode')?.value;
  const fromF = fromKey ? (getFactor('transport', fromKey)?.value ?? 0) : 0;
  const toF = toKey ? (getFactor('transport', toKey)?.value ?? 0) : 0;
  const transportSave = transOn ? km * Math.max(0, fromF - toF) : 0;

  const totalWeek = redMealSave + acSave + transportSave;
  const totalYear = totalWeek * 52;

  setText('simWeekly', round2(totalWeek));
  setText('simYearly', round2(totalYear));

  // Equivalence (rough): convert to "car passenger-km avoided"
  const carFactor = getFactor('transport', 'car_km')?.value ?? 0.19; // kg / p-km
  const carKm = totalYear > 0 && carFactor > 0 ? Math.round(totalYear / carFactor) : 0;
  setText('simCarKm', carKm);

  // Very rough tree equivalence: ~21 kg CO2 per tree-year
  const trees = totalYear > 0 ? Math.max(0, Math.round(totalYear / 21)) : 0;
  setText('simTrees', trees);

  // Composition chart
  const ctx = document.getElementById('simChart')?.getContext('2d');
  if (ctx) {
    if (simChart) simChart.destroy();
    simChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['飲食（紅肉）', '用電（冷氣）', '交通（轉乘）'],
        datasets: [{
          data: [round2(redMealSave), round2(acSave), round2(transportSave)]
        }]
      },
      options: {
        plugins: { legend: { position: 'bottom' } }
      }
    });
  }
}

// -----------------------------
// Refresh All
// -----------------------------
function refreshAll() {
  populateCategorySelects();
  renderSummary();
  renderCharts();
  renderRecordsTable();
  // keep add-record selects in sync
  buildItemOptions($('#recCategory')?.value || 'transport');
  updateUnitHint();
  buildSimModeOptions();
  calcSimulator();
}

// -----------------------------
// Bind events
// -----------------------------
function bindEvents() {
  // nav
  $('#sideNav')?.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-page]');
    if (!a) return;
    e.preventDefault();
    showPage(a.dataset.page);
  });

  // AI
  $('#btnAI')?.addEventListener('click', simulateAI);
  $('#aiInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') simulateAI();
  });

  // record form
  $('#recDate') && ($('#recDate').value = localISO());

  $('#recCategory')?.addEventListener('change', () => {
    buildItemOptions($('#recCategory').value);
  });
  $('#recType')?.addEventListener('change', updateUnitHint);

  $('#btnAddRecord')?.addEventListener('click', () => {
    const date = $('#recDate')?.value || localISO();
    const category = $('#recCategory')?.value;
    const itemKey = $('#recType')?.value;
    const amount = Number($('#recAmount')?.value);
    const note = ($('#recNote')?.value || '').trim();

    if (!category || !itemKey || !Number.isFinite(amount) || amount <= 0) {
      showToast('請填正確的日期/項目/數量');
      return;
    }

    const rec = makeRecord({ date, category, itemKey, amount, note });
    addRecord(rec);
    showToast('已新增紀錄');

    $('#recAmount').value = '';
    $('#recNote').value = '';
  });

  // records filter
  $('#filterText')?.addEventListener('input', renderRecordsTable);
  $('#filterCategory')?.addEventListener('change', renderRecordsTable);
  $('#filterDate')?.addEventListener('change', renderRecordsTable);

  // export/import
  $('#btnExport')?.addEventListener('click', exportJSON);
  $('#importFile')?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) importJSON(f);
    e.target.value = '';
  });

  // clear all
  $('#btnReset')?.addEventListener('click', () => {
    if (!confirm('確定要清空所有紀錄與係數嗎？')) return;
    localStorage.removeItem(KEYS.records);
    localStorage.removeItem(KEYS.factors);
    factors = deepClone(DEFAULT_FACTORS);
    records = seedDemoRecords();
    saveFactors(factors);
    saveRecords(records);
    refreshAll();
    showToast('已清空並重置');
  });

  // database save/reset
  $('#btnSaveFactors')?.addEventListener('click', () => {
    saveFactors(factors);
    refreshAll();
    showToast('已儲存係數');
  });
  $('#btnResetFactors')?.addEventListener('click', () => {
    if (!confirm('確定要還原預設係數嗎？')) return;
    factors = deepClone(DEFAULT_FACTORS);
    saveFactors(factors);
    renderFactorTable();
    refreshAll();
    showToast('已還原預設係數');
  });

  // simulator run
  $('#btnRunSim')?.addEventListener('click', () => {
    calcSimulator();
    showToast('已更新模擬結果');
  });

  // add factor
  $('#btnAddFactor')?.addEventListener('click', addNewFactor);

  // simulator
  ['simMeatEnabled','simMeatMeals','simMeatFactor','simAltMealFactor','simAcEnabled','simAcKwh','simGridFactor','simBatteryFactor','simTransEnabled','simKm','simFromMode','simToMode'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', calcSimulator);
    document.getElementById(id)?.addEventListener('change', calcSimulator);
  });
}

// -----------------------------
// Init
// -----------------------------
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();

  // Init selects
  populateCategorySelects();
  buildItemOptions($('#recCategory')?.value || 'transport');
  updateUnitHint();
  buildSimModeOptions();

  // Init simulator defaults
  const grid = getFactor('electricity', 'grid_kwh')?.value ?? 0.509;
  const batteryDefault = 0.05;
  $('#simBatteryFactor') && ($('#simBatteryFactor').value = String(batteryDefault));

  // Render
  refreshAll();
  showPage('dashboard');
});
