// ===== CONFIG =====
const SUPABASE_URL  = 'https://ndcdpkkptbyeosgkcvgy.supabase.co';
const SUPABASE_ANON = 'sb_publishable_wS5AkPa-ce-XY-YstP6DRw_wjr8TU1O';
const STATION_ID    = 'ITHALA20-PHUKET-01';
const STATION_LAT   = 7.8804;
const STATION_LNG   = 98.3923;
const REFRESH_MS    = 60 * 1000;
const AI_API_URL    = 'https://ithala20-ai-api.onrender.com';

// ===== GLOBAL STATE =====
let _dailyRows  = [];   // rows loaded for daily tab
let _modelPreds = [];   // [{row, pred}] for model tab
let _modelDate  = '';

// ===== HELPERS =====
function avg(arr)    { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
function minVal(arr) { return arr.length ? Math.min(...arr) : 0; }
function maxVal(arr) { return arr.length ? Math.max(...arr) : 0; }

function toLocalDateStr(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function toTimeStr(dateStr) {
  return new Date(dateStr).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'});
}
function toHourLabel(h) {
  return `${String(h).padStart(2,'0')}:00`;
}
function fmt(v, d=1) { return (v==null||isNaN(v)) ? '--' : Number(v).toFixed(d); }

// ===== SUPABASE FETCH =====
async function supaFetch(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchReadings(limit=100) {
  const data = await supaFetch(
    `sensor_readings?station_id=eq.${STATION_ID}&order=created_at.desc&limit=${limit}`
  );
  return data.reverse();
}

async function fetchByDate(dateStr) {
  const from = `${dateStr}T00:00:00`;
  const to   = `${dateStr}T23:59:59`;
  const data = await supaFetch(
    `sensor_readings?station_id=eq.${STATION_ID}&created_at=gte.${from}&created_at=lte.${to}&order=created_at.asc&limit=2000`
  );
  return data;
}

// ===== AI FETCH =====
async function fetchPrediction(row) {
  try {
    const res = await fetch(`${AI_API_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        temperature: row.temperature,
        humidity:    row.humidity,
        light_lux:   row.light_lux,
        uv_raw:      row.uv_raw,
        rain_raw:    row.rain_raw,
      })
    });
    if (!res.ok) return null;
    return await res.json();
  } catch(e) { return null; }
}

// ===== TAB SWITCH =====
function switchTab(name, btn) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  if (btn) btn.classList.add('active');

  if (name === 'daily') {
    if (!document.getElementById('daily-date').value) {
      document.getElementById('daily-date').value = toLocalDateStr(new Date());
    }
    if (!_dailyRows.length) loadDailySummary();
  }
  if (name === 'model') {
    renderFeatureImportance();
    if (!document.getElementById('model-date').value) {
      document.getElementById('model-date').value = toLocalDateStr(new Date());
    }
    if (!_modelPreds.length) loadModelPerf();
  }
}

// ===== REALTIME TAB =====
function updateCards(latest) {
  document.getElementById('val-temp').textContent  = latest.temperature?.toFixed(1) ?? '--';
  document.getElementById('val-hum').textContent   = latest.humidity?.toFixed(1)    ?? '--';
  document.getElementById('val-lux').textContent   = latest.light_lux?.toFixed(0)   ?? '--';
  document.getElementById('val-uv').textContent    = latest.uv_raw                  ?? '--';
  document.getElementById('val-rain').textContent  = latest.rain_raw                ?? '--';
  const t = new Date(latest.created_at).toLocaleString('th-TH');
  document.getElementById('last-update').textContent = `อัปเดตล่าสุด: ${t}`;
}

function updatePrediction(pred) {
  if (!pred) return;
  const prob = pred.rain_probability;
  document.getElementById('pred-rain-prob').textContent  = `${prob}%`;
  document.getElementById('pred-rain-label').textContent = pred.rain_label;
  document.getElementById('pred-uv').textContent         = pred.uv_index;
  document.getElementById('pred-advice').textContent     = pred.advice;

  document.querySelectorAll('.ai-card').forEach(c => {
    c.style.borderColor = prob >= 70 ? '#38bdf8' : '#4a5568';
    c.style.background  = prob >= 70 ? 'rgba(56,189,248,0.08)' : '';
  });

  const alertBox = document.getElementById('alert-box');
  const alerts = [];
  if (prob >= 70)          alerts.push('🌧️ มีโอกาสฝนตกสูง ควรเตรียมร่ม');
  if (pred.uv_index >= 8)  alerts.push('🔆 UV สูงมาก ควรทาครีมกันแดด SPF 50+');
  if (alerts.length) {
    alertBox.style.cssText = 'display:block;margin-top:16px;padding:12px 16px;border-radius:8px;font-size:14px;background:rgba(248,113,113,.1);border:1px solid #f87171;color:#fca5a5';
    alertBox.innerHTML = '⚠️ ' + alerts.join('&nbsp;|&nbsp;');
  } else {
    alertBox.style.display = 'none';
  }
}

function setStatus(online) {
  document.getElementById('status-dot').className = 'status-dot ' + (online ? 'online' : 'offline');
  document.getElementById('status-text').textContent = online ? 'ออนไลน์' : 'ออฟไลน์';
}

// ===== CHARTS =====
const charts = {};

const CHART_DEFAULTS = {
  responsive: true,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { labels: { color: '#94a3b8', boxWidth: 12 } } },
  scales: {
    x: {
      type: 'time',
      time: { tooltipFormat: 'HH:mm dd/MM', displayFormats: { hour: 'HH:mm', minute:'HH:mm' } },
      ticks: { color: '#64748b', maxTicksLimit: 8 },
      grid:  { color: '#1e3a5f22' }
    },
    y: { ticks: { color: '#64748b' }, grid: { color: '#33415533' } }
  }
};

function upsertChart(id, labels, datasets, extraScales={}) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  const options = JSON.parse(JSON.stringify(CHART_DEFAULTS));
  options.scales = { ...options.scales, ...extraScales };
  if (charts[id]) {
    charts[id].data.labels   = labels;
    charts[id].data.datasets = datasets;
    Object.assign(charts[id].options.scales, options.scales);
    charts[id].update('none');
    return;
  }
  charts[id] = new Chart(ctx.getContext('2d'), { type: 'line', data: { labels, datasets }, options });
}

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

function renderCharts(rows) {
  const labels = rows.map(r => new Date(r.created_at));

  upsertChart('chart-temp-hum', labels, [
    { label:'อุณหภูมิ (°C)', data:rows.map(r=>r.temperature),
      borderColor:'#f87171', backgroundColor:'rgba(248,113,113,.08)', tension:.3, yAxisID:'y' },
    { label:'ความชื้น (%)', data:rows.map(r=>r.humidity),
      borderColor:'#38bdf8', backgroundColor:'rgba(56,189,248,.08)', tension:.3, yAxisID:'y1' }
  ], {
    y:  { ticks:{color:'#64748b'}, grid:{color:'#33415533'}, title:{display:true,text:'°C',color:'#f87171'} },
    y1: { position:'right', ticks:{color:'#38bdf8'}, grid:{drawOnChartArea:false}, title:{display:true,text:'%',color:'#38bdf8'} },
    x:  CHART_DEFAULTS.scales.x
  });

  const maxLux = Math.max(...rows.map(r=>r.light_lux||0)) || 4095;
  const scale  = maxLux / 4095;
  upsertChart('chart-light', labels, [
    { label:'ความสว่าง (lux)', data:rows.map(r=>r.light_lux),
      borderColor:'#fbbf24', backgroundColor:'rgba(251,191,36,.08)', tension:.3 },
    { label:`UV raw (×${scale.toFixed(1)})`, data:rows.map(r=>r.uv_raw*scale),
      borderColor:'#a78bfa', backgroundColor:'rgba(167,139,250,.08)', tension:.3 }
  ]);

  upsertChart('chart-rain', labels, [
    { label:'สัญญาณฝน (raw) — ยิ่งต่ำ = เปียกมากขึ้น', data:rows.map(r=>r.rain_raw),
      borderColor:'#34d399', backgroundColor:'rgba(52,211,153,.12)', tension:.3, fill:true }
  ]);
}

// ===== MAP =====
let map = null;
function initMap() {
  if (map) return;
  map = L.map('map').setView([STATION_LAT, STATION_LNG], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution:'© OpenStreetMap contributors', maxZoom:19 }).addTo(map);
  L.marker([STATION_LAT, STATION_LNG], {
    icon: L.divIcon({ html:'<div style="font-size:28px">📡</div>', iconSize:[32,32], iconAnchor:[16,16], className:'' })
  }).addTo(map)
    .bindPopup('<b>ITHALA20-PHUKET-01</b><br>สถานีตรวจอากาศ ITHALA20<br>ภูเก็ต')
    .openPopup();
}

// ===== DAILY SUMMARY TAB =====
async function loadDailySummary() {
  const dateStr = document.getElementById('daily-date').value;
  if (!dateStr) return;
  _dailyRows = [];

  const elContent  = document.getElementById('daily-content');
  const elEmpty    = document.getElementById('daily-empty');
  const elLoading  = document.getElementById('daily-loading');
  const elExport   = document.getElementById('btn-export-daily');

  elContent.style.display  = 'none';
  elEmpty.style.display    = 'none';
  elLoading.style.display  = 'block';
  elExport.style.display   = 'none';

  // destroy daily charts so they can re-render
  ['daily-chart-th','daily-chart-uv','daily-chart-rain'].forEach(destroyChart);

  try {
    const rows = await fetchByDate(dateStr);
    elLoading.style.display = 'none';

    if (!rows.length) {
      elEmpty.style.display = 'block';
      return;
    }
    _dailyRows = rows;

    // ── Summary Cards ──
    const temps  = rows.map(r=>r.temperature).filter(v=>v!=null);
    const hums   = rows.map(r=>r.humidity).filter(v=>v!=null);
    const luxes  = rows.map(r=>r.light_lux).filter(v=>v!=null);
    const uvs    = rows.map(r=>r.uv_raw).filter(v=>v!=null);
    const rains  = rows.map(r=>r.rain_raw).filter(v=>v!=null);
    const rainEvents = rains.filter(v=>v<2000).length;
    const rainPct    = rains.length ? ((rainEvents/rains.length)*100).toFixed(1) : 0;

    document.getElementById('daily-cards').innerHTML = [
      { label:'อุณหภูมิเฉลี่ย', val:fmt(avg(temps)),    unit:'°C',   color:'#f87171', sub:`${fmt(minVal(temps))} – ${fmt(maxVal(temps))} °C` },
      { label:'ความชื้นเฉลี่ย',  val:fmt(avg(hums)),     unit:'%',    color:'#38bdf8', sub:`${fmt(minVal(hums))} – ${fmt(maxVal(hums))} %` },
      { label:'แสงสูงสุด',       val:fmt(maxVal(luxes),0),unit:'lux', color:'#fbbf24', sub:`เฉลี่ย ${fmt(avg(luxes),0)} lux` },
      { label:'UV สูงสุด',       val:fmt(maxVal(uvs),0), unit:'raw',  color:'#a78bfa', sub:`เฉลี่ย ${fmt(avg(uvs),0)}` },
      { label:'ตรวจพบฝน',        val:rainEvents,          unit:'ครั้ง',color:'#34d399', sub:`${rainPct}% ของเวลาทั้งหมด` },
      { label:'บันทึกข้อมูล',    val:rows.length,          unit:'แถว', color:'#94a3b8', sub:`วันที่ ${dateStr}` },
    ].map(c=>`
      <div class="sum-card">
        <div class="sc-label">${c.label}</div>
        <div class="sc-val" style="color:${c.color}">${c.val}</div>
        <div class="sc-sub">${c.unit}</div>
        <div class="sc-sub" style="margin-top:2px;font-size:.68rem;opacity:.7">${c.sub}</div>
      </div>`).join('');

    // ── Charts ──
    const labels = rows.map(r=>new Date(r.created_at));
    upsertChart('daily-chart-th', labels, [
      { label:'อุณหภูมิ (°C)', data:rows.map(r=>r.temperature),
        borderColor:'#f87171', backgroundColor:'rgba(248,113,113,.08)', tension:.3, yAxisID:'y' },
      { label:'ความชื้น (%)',  data:rows.map(r=>r.humidity),
        borderColor:'#38bdf8', backgroundColor:'rgba(56,189,248,.08)', tension:.3, yAxisID:'y1' }
    ], {
      y:  { ticks:{color:'#64748b'}, grid:{color:'#33415533'}, title:{display:true,text:'°C',color:'#f87171'} },
      y1: { position:'right', ticks:{color:'#38bdf8'}, grid:{drawOnChartArea:false}, title:{display:true,text:'%',color:'#38bdf8'} },
      x:  CHART_DEFAULTS.scales.x
    });

    const mLux = Math.max(...luxes) || 4095;
    const sc   = mLux / 4095;
    upsertChart('daily-chart-uv', labels, [
      { label:'ความสว่าง (lux)', data:rows.map(r=>r.light_lux),
        borderColor:'#fbbf24', backgroundColor:'rgba(251,191,36,.08)', tension:.3 },
      { label:`UV raw (×${sc.toFixed(1)})`, data:rows.map(r=>r.uv_raw*sc),
        borderColor:'#a78bfa', backgroundColor:'rgba(167,139,250,.08)', tension:.3 }
    ]);

    upsertChart('daily-chart-rain', labels, [
      { label:'สัญญาณฝน (raw)', data:rows.map(r=>r.rain_raw),
        borderColor:'#34d399', backgroundColor:'rgba(52,211,153,.12)', tension:.3, fill:true }
    ]);

    // ── Stats Summary Table ──
    document.getElementById('daily-table-body').innerHTML = [
      { name:'🌡️ อุณหภูมิ', arr:temps,  unit:'°C'  },
      { name:'💧 ความชื้น',  arr:hums,   unit:'%'   },
      { name:'☀️ ความสว่าง', arr:luxes,  unit:'lux' },
      { name:'🔆 UV raw',    arr:uvs,    unit:'raw' },
      { name:'🌧️ Rain raw',  arr:rains,  unit:'raw' },
    ].map(s=>`<tr>
      <td>${s.name}</td>
      <td>${fmt(minVal(s.arr))}</td>
      <td>${fmt(avg(s.arr))}</td>
      <td>${fmt(maxVal(s.arr))}</td>
      <td>${s.unit}</td>
    </tr>`).join('');

    // ── Hourly Breakdown Table ──
    renderHourlyTable(rows);

    elContent.style.display = 'block';
    elExport.style.display  = 'inline-block';

  } catch(e) {
    elLoading.style.display = 'none';
    elEmpty.style.display   = 'block';
    console.error(e);
  }
}

// กลุ่มข้อมูลรายชั่วโมง → แสดงตาราง
function renderHourlyTable(rows) {
  // สร้าง map hour → rows[]
  const byHour = {};
  rows.forEach(r => {
    const h = new Date(r.created_at).getHours();
    if (!byHour[h]) byHour[h] = [];
    byHour[h].push(r);
  });

  const hours = Array.from({length:24}, (_,i)=>i);
  document.getElementById('hourly-table-body').innerHTML = hours.map(h => {
    const hr = byHour[h];
    if (!hr || !hr.length) {
      return `<tr style="opacity:.35">
        <td>${toHourLabel(h)}</td>
        <td colspan="7" style="color:#334155;text-align:center">— ไม่มีข้อมูล —</td>
      </tr>`;
    }
    const temps  = hr.map(r=>r.temperature).filter(v=>v!=null);
    const hums   = hr.map(r=>r.humidity).filter(v=>v!=null);
    const luxes  = hr.map(r=>r.light_lux).filter(v=>v!=null);
    const uvs    = hr.map(r=>r.uv_raw).filter(v=>v!=null);
    const rains  = hr.map(r=>r.rain_raw).filter(v=>v!=null);
    const rainCnt = rains.filter(v=>v<2000).length;
    const isRain  = rainCnt > rains.length * 0.3;

    const rainBadge = isRain
      ? `<span class="badge badge-rain">🌧 ฝนตก (${rainCnt}/${rains.length})</span>`
      : `<span class="badge badge-dry">☀️ ไม่มีฝน</span>`;

    return `<tr>
      <td><strong>${toHourLabel(h)}</strong></td>
      <td>${fmt(avg(temps))} <small style="color:#475569">°C</small></td>
      <td>${fmt(avg(hums))} <small style="color:#475569">%</small></td>
      <td>${fmt(avg(luxes),0)}</td>
      <td>${fmt(avg(uvs),0)}</td>
      <td>${fmt(avg(rains),0)}</td>
      <td>${rainBadge}</td>
      <td style="color:#475569">${hr.length}</td>
    </tr>`;
  }).join('');
}

// Export daily CSV
function exportDailyCSV() {
  if (!_dailyRows.length) return;
  const header = ['created_at','temperature','humidity','light_lux','uv_raw','rain_raw'];
  const rows   = _dailyRows.map(r => header.map(k => r[k] ?? '').join(','));
  const csv    = [header.join(','), ...rows].join('\n');
  downloadText(csv, `ITHALA20_daily_${document.getElementById('daily-date').value}.csv`, 'text/csv');
}

// ===== MODEL PERFORMANCE TAB =====
function renderFeatureImportance() {
  if (charts['chart-feature']) return;
  const features = ['rain_raw','rain_lag','rain_change','humidity','hum_lag','temperature','hour','hum_change','uv_raw','light_lux','month'];
  const values   = [0.321,0.202,0.108,0.101,0.069,0.060,0.040,0.039,0.024,0.024,0.012];
  const colors   = values.map(v => v>=0.2?'#f87171':v>=0.1?'#fbbf24':v>=0.05?'#38bdf8':'#64748b');

  const ctx = document.getElementById('chart-feature');
  if (!ctx) return;
  charts['chart-feature'] = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: {
      labels: features,
      datasets: [{ label:'Importance', data:values, backgroundColor:colors, borderRadius:4 }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: { legend:{display:false}, tooltip:{
        callbacks:{ label: ctx => ` ${(ctx.raw*100).toFixed(1)}%` }
      }},
      scales: {
        x: { ticks:{color:'#64748b',callback:v=>`${(v*100).toFixed(0)}%`}, grid:{color:'#33415533'} },
        y: { ticks:{color:'#94a3b8'} }
      }
    }
  });
}

async function loadModelPerf() {
  const dateStr = document.getElementById('model-date').value;
  if (!dateStr) return;
  _modelPreds = [];
  _modelDate  = dateStr;

  const elContent = document.getElementById('model-content');
  const elEmpty   = document.getElementById('model-empty');
  const elLoading = document.getElementById('model-loading');
  const elExport  = document.getElementById('btn-export-model');

  elContent.style.display = 'none';
  elEmpty.style.display   = 'none';
  elLoading.style.display = 'block';
  elExport.style.display  = 'none';

  destroyChart('model-chart-rain');

  try {
    const rows = await fetchByDate(dateStr);
    if (!rows.length) {
      elLoading.style.display = 'none';
      elEmpty.style.display   = 'block';
      return;
    }

    // sample ทุก 60 แถว (≈ ทุก 1 ชั่วโมง) สูงสุด 24 จุด
    const sampled = rows.filter((_,i) => i % 60 === 0).slice(0, 24);

    elLoading.innerHTML = `⏳ กำลังเรียก AI API (${sampled.length} ชั่วโมง)...`;

    // เรียก API ทีละจุด แต่ขนานกัน (Promise.all)
    const preds = await Promise.all(sampled.map(r => fetchPrediction(r)));
    _modelPreds = sampled.map((r,i)=>({ row:r, pred:preds[i] }));

    elLoading.style.display = 'none';

    // ── Day accuracy summary ──
    let correct=0, total=0, rainCorrect=0, rainTotal=0;
    _modelPreds.forEach(({row,pred}) => {
      if (!pred) return;
      total++;
      const isRain   = row.rain_raw < 2000;
      const predRain = pred.rain_probability >= 50;
      if (isRain === predRain) correct++;
      if (isRain) { rainTotal++; if (predRain) rainCorrect++; }
    });
    const dayAcc    = total ? ((correct/total)*100).toFixed(1) : '--';
    const rainRec   = rainTotal ? ((rainCorrect/rainTotal)*100).toFixed(1) : '--';
    const avgProb   = _modelPreds.filter(d=>d.pred).map(d=>d.pred.rain_probability);
    const avgProbVal= avgProb.length ? fmt(avg(avgProb),1) : '--';

    document.getElementById('model-day-cards').innerHTML = [
      { label:'ความแม่นยำวันนี้', val:dayAcc+'%', color:'#34d399', sub:`${correct}/${total} ชั่วโมงถูกต้อง` },
      { label:'Rain Recall',      val:rainRec+'%', color:'#38bdf8', sub:`${rainCorrect}/${rainTotal} ครั้งจับได้` },
      { label:'โอกาสฝนเฉลี่ย',   val:avgProbVal+'%', color:'#fbbf24', sub:'ค่าเฉลี่ยทั้งวัน' },
      { label:'จุดที่วิเคราะห์',  val:total, color:'#94a3b8', sub:'ชั่วโมง (sample ทุก 60 แถว)' },
    ].map(c=>`
      <div class="sum-card">
        <div class="sc-label">${c.label}</div>
        <div class="sc-val" style="color:${c.color}">${c.val}</div>
        <div class="sc-sub" style="margin-top:2px;font-size:.68rem;opacity:.7">${c.sub}</div>
      </div>`).join('');

    // ── Chart: AI prob vs actual ──
    const labels      = _modelPreds.map(d=>new Date(d.row.created_at));
    const rainProbs   = _modelPreds.map(d=> d.pred ? d.pred.rain_probability : null);
    const rainActual  = _modelPreds.map(d=> d.row.rain_raw < 2000 ? 100 : 0);

    upsertChart('model-chart-rain', labels, [
      { label:'โอกาสฝน AI (%)', data:rainProbs,
        borderColor:'#38bdf8', backgroundColor:'rgba(56,189,248,.1)', tension:.3, spanGaps:true },
      { label:'ฝนจริง (100=มี)', data:rainActual,
        borderColor:'#f87171', backgroundColor:'rgba(248,113,113,.08)', tension:.3, borderDash:[6,4] }
    ], {
      x: CHART_DEFAULTS.scales.x,
      y: { min:0, max:105, ticks:{color:'#64748b',callback:v=>`${v}%`}, grid:{color:'#33415533'} }
    });

    // ── Prediction Table ──
    document.getElementById('model-table-body').innerHTML = _modelPreds.map(({row,pred}) => {
      const prob     = pred ? pred.rain_probability : null;
      const isRain   = row.rain_raw < 2000;
      const predRain = pred ? prob >= 50 : null;
      const correct  = pred ? (predRain === isRain) : null;

      const probBar = prob != null
        ? `<div class="prob-bar-wrap">
            <span style="font-weight:600;color:${prob>=70?'#38bdf8':prob>=40?'#fbbf24':'#94a3b8'};min-width:36px">${prob}%</span>
            <div class="prob-bar"><div class="prob-bar-fill" style="width:${prob}%;background:${prob>=70?'#38bdf8':prob>=40?'#fbbf24':'#94a3b8'}"></div></div>
           </div>`
        : '<span class="badge badge-na">N/A</span>';

      const rainBadge    = `<span class="badge ${isRain?'badge-rain':'badge-dry'}">${isRain?'🌧 มีฝน':'☀️ ไม่มีฝน'}</span>`;
      const correctBadge = correct===null
        ? '<span class="badge badge-na">--</span>'
        : correct
          ? '<span class="badge badge-ok">✓ ถูก</span>'
          : '<span class="badge badge-err">✗ ผิด</span>';

      const predLabel = pred
        ? `<span class="badge ${pred.rain_probability>=50?'badge-rain':'badge-dry'}">${pred.rain_label||'--'}</span>`
        : '<span class="badge badge-na">--</span>';

      return `<tr>
        <td><strong>${toTimeStr(row.created_at)}</strong></td>
        <td>${fmt(row.temperature)} °C</td>
        <td>${fmt(row.humidity)} %</td>
        <td>${row.rain_raw ?? '--'}</td>
        <td>${rainBadge}</td>
        <td>${probBar}</td>
        <td>${pred ? `<span class="badge ${predRain?'badge-rain':'badge-dry'}">${predRain?'🌧 ฝน':'☀️ ไม่ฝน'}</span>` : '<span class="badge badge-na">--</span>'}</td>
        <td>${correctBadge}</td>
      </tr>`;
    }).join('');

    elContent.style.display = 'block';
    elExport.style.display  = 'inline-block';

  } catch(e) {
    elLoading.style.display = 'none';
    elEmpty.style.display   = 'block';
    console.error(e);
  }
}

// Export model CSV
function exportModelCSV() {
  if (!_modelPreds.length) return;
  const header = ['time','temperature','humidity','light_lux','uv_raw','rain_raw','rain_actual','ai_rain_prob','ai_label','correct'];
  const rows = _modelPreds.map(({row,pred}) => {
    const isRain   = row.rain_raw < 2000;
    const predRain = pred ? pred.rain_probability >= 50 : null;
    return [
      toTimeStr(row.created_at),
      row.temperature, row.humidity, row.light_lux, row.uv_raw, row.rain_raw,
      isRain ? 'มีฝน' : 'ไม่มีฝน',
      pred ? pred.rain_probability : '',
      pred ? pred.rain_label : '',
      predRain===null ? '' : predRain===isRain ? 'ถูก' : 'ผิด'
    ].join(',');
  });
  const csv = [header.join(','), ...rows].join('\n');
  downloadText(csv, `ITHALA20_model_${_modelDate}.csv`, 'text/csv');
}

// ===== DOWNLOAD HELPER =====
function downloadText(content, filename, mime) {
  const blob = new Blob(['﻿'+content], { type: mime+';charset=utf-8;' }); // BOM for Thai Excel
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ===== MAIN REFRESH (REALTIME) =====
async function refresh() {
  try {
    const rows = await fetchReadings(100);
    if (!rows.length) return;
    const latest = rows[rows.length - 1];
    updateCards(latest);
    renderCharts(rows);
    setStatus(true);
    const pred = await fetchPrediction(latest);
    updatePrediction(pred);
  } catch(e) {
    console.error(e);
    setStatus(false);
  }
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  refresh();
  setInterval(refresh, REFRESH_MS);
  const today = toLocalDateStr(new Date());
  document.getElementById('daily-date').value = today;
  document.getElementById('model-date').value = today;
});
