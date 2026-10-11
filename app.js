// ===== CONFIG =====
const SUPABASE_URL  = 'https://ndcdpkkptbyeosgkcvgy.supabase.co';
const SUPABASE_ANON = 'sb_publishable_wS5AkPa-ce-XY-YstP6DRw_wjr8TU1O';
const STATION_ID    = 'ITHALA20-PHUKET-01';
const STATION_LAT   = 7.8804;
const STATION_LNG   = 98.3923;
const REFRESH_MS    = 60 * 1000;
const AI_API_URL    = 'https://ithala20-ai-api.onrender.com';

// ===== ดึงข้อมูลเซนเซอร์ =====
async function fetchReadings(limit = 100) {
  const url = `${SUPABASE_URL}/rest/v1/sensor_readings`
    + `?station_id=eq.${STATION_ID}`
    + `&order=created_at.desc`
    + `&limit=${limit}`;
  const res = await fetch(url, {
    headers: {
      'apikey':        SUPABASE_ANON,
      'Authorization': `Bearer ${SUPABASE_ANON}`,
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.reverse();
}

// ===== ดึงผลพยากรณ์ AI =====
async function fetchPrediction(latest) {
  try {
    const res = await fetch(`${AI_API_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        temperature: latest.temperature,
        humidity:    latest.humidity,
        light_lux:   latest.light_lux,
        uv_raw:      latest.uv_raw,
        rain_raw:    latest.rain_raw,
      })
    });
    return await res.json();
  } catch (err) {
    console.error('AI API error:', err);
    return null;
  }
}

// ===== อัปเดตการ์ดค่าปัจจุบัน =====
function updateCards(latest) {
  document.getElementById('val-temp').textContent  = latest.temperature?.toFixed(1) ?? '--';
  document.getElementById('val-hum').textContent   = latest.humidity?.toFixed(1)    ?? '--';
  document.getElementById('val-lux').textContent   = latest.light_lux?.toFixed(0)   ?? '--';
  document.getElementById('val-uv').textContent    = latest.uv_raw                  ?? '--';
  document.getElementById('val-rain').textContent  = latest.rain_raw                ?? '--';
  const t = new Date(latest.created_at).toLocaleString('th-TH');
  document.getElementById('last-update').textContent = `อัปเดตล่าสุด: ${t}`;
}

// ===== อัปเดตการ์ด AI =====
function updatePrediction(pred) {
  if (!pred) return;

  const prob = pred.rain_probability;
  document.getElementById('pred-rain-prob').textContent  = `${prob}%`;
  document.getElementById('pred-rain-label').textContent = pred.rain_label;
  document.getElementById('pred-uv').textContent         = pred.uv_index;
  document.getElementById('pred-advice').textContent     = pred.advice;

  // สีการ์ดตามโอกาสฝน
  const cards = document.querySelectorAll('.ai-card');
  cards.forEach(c => {
    c.style.borderColor = prob >= 70 ? '#38bdf8' : '#4a5568';
    c.style.background  = prob >= 70 ? 'rgba(56,189,248,0.08)' : '';
  });

  // แถบเตือน
  const alertBox = document.getElementById('alert-box');
  const alerts = [];
  if (prob >= 70) alerts.push('🌧️ มีโอกาสฝนตกสูง ควรเตรียมร่ม');
  if (pred.uv_index >= 8) alerts.push('🔆 UV สูงมาก ควรทาครีมกันแดด SPF 50+');

  if (alerts.length > 0) {
    alertBox.style.display    = 'block';
    alertBox.style.background = 'rgba(248,113,113,0.1)';
    alertBox.style.border     = '1px solid #f87171';
    alertBox.style.color      = '#fca5a5';
    alertBox.innerHTML        = '⚠️ ' + alerts.join('&nbsp;&nbsp;|&nbsp;&nbsp;');
  } else {
    alertBox.style.display = 'none';
  }
}

// ===== Status dot =====
function setStatus(online) {
  const dot  = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  dot.className    = 'status-dot ' + (online ? 'online' : 'offline');
  text.textContent = online ? 'ออนไลน์' : 'ออฟไลน์';
}

// ===== กราฟ =====
const charts = {};

const CHART_DEFAULTS = {
  responsive: true,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { labels: { color: '#94a3b8', boxWidth: 12 } } },
  scales: {
    x: {
      type: 'time',
      time: { tooltipFormat: 'HH:mm dd/MM',
        displayFormats: { hour: 'HH:mm' } },
      ticks: { color: '#64748b', maxTicksLimit: 8 },
      grid:  { color: '#1e3a5f22' }
    },
    y: {
      ticks: { color: '#64748b' },
      grid:  { color: '#33415533' }
    }
  }
};

function upsertChart(id, labels, datasets, extraScales = {}) {
  const ctx = document.getElementById(id).getContext('2d');
  const options = JSON.parse(JSON.stringify(CHART_DEFAULTS));
  options.scales = { ...options.scales, ...extraScales };

  if (charts[id]) {
    charts[id].data.labels   = labels;
    charts[id].data.datasets = datasets;
    if (extraScales.y1) charts[id].options.scales.y1 = extraScales.y1;
    charts[id].update('none');
    return;
  }
  charts[id] = new Chart(ctx, { type: 'line', data: { labels, datasets }, options });
}

function renderCharts(rows) {
  const labels = rows.map(r => new Date(r.created_at));

  // กราฟ 1: อุณหภูมิ + ความชื้น
  upsertChart('chart-temp-hum', labels, [
    {
      label: 'อุณหภูมิ (°C)',
      data: rows.map(r => r.temperature),
      borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,0.08)',
      tension: 0.3, yAxisID: 'y',
    },
    {
      label: 'ความชื้น (%)',
      data: rows.map(r => r.humidity),
      borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.08)',
      tension: 0.3, yAxisID: 'y1',
    }
  ], {
    y:  { ticks: { color: '#64748b' }, grid: { color: '#33415533' },
      title: { display: true, text: '°C', color: '#f87171' } },
    y1: { position: 'right', ticks: { color: '#38bdf8' },
      grid: { drawOnChartArea: false },
      title: { display: true, text: '%', color: '#38bdf8' } },
    x:  CHART_DEFAULTS.scales.x,
  });

  // กราฟ 2: แสง + UV
  upsertChart('chart-light', labels, [
    {
      label: 'ความสว่าง (lux)',
      data: rows.map(r => r.light_lux),
      borderColor: '#fbbf24', backgroundColor: 'rgba(251,191,36,0.08)',
      tension: 0.3,
    },
    {
      label: 'UV raw',
      data: rows.map(r => r.uv_raw),
      borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,0.08)',
      tension: 0.3,
    }
  ]);

  // กราฟ 3: ฝน
  upsertChart('chart-rain', labels, [
    {
      label: 'สัญญาณฝน (raw) — ยิ่งต่ำ = เปียกมากขึ้น',
      data: rows.map(r => r.rain_raw),
      borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.12)',
      tension: 0.3, fill: true,
    }
  ]);
}

// ===== แผนที่ =====
let map = null;

function initMap() {
  if (map) return;
  map = L.map('map').setView([STATION_LAT, STATION_LNG], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors', maxZoom: 19,
  }).addTo(map);

  const icon = L.divIcon({
    html: '<div style="font-size:28px">📡</div>',
    iconSize: [32, 32], iconAnchor: [16, 16], className: ''
  });

  L.marker([STATION_LAT, STATION_LNG], { icon })
    .addTo(map)
    .bindPopup('<b>ITHALA20-PHUKET-01</b><br>สถานีตรวจอากาศ ITHALA20<br>ภูเก็ต ประเทศไทย')
    .openPopup();
}

// ===== Main Refresh =====
async function refresh() {
  try {
    const rows = await fetchReadings(100);
    if (rows.length === 0) return;
    const latest = rows[rows.length - 1];

    updateCards(latest);
    renderCharts(rows);
    setStatus(true);

    // AI พยากรณ์
    const pred = await fetchPrediction(latest);
    updatePrediction(pred);

  } catch (err) {
    console.error('Fetch error:', err);
    setStatus(false);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  refresh();
  setInterval(refresh, REFRESH_MS);
});
