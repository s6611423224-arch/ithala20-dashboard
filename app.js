// ===== CONFIG — แก้ตรงนี้ =====
const SUPABASE_URL  = 'https://ndcdpkkptbyeosgkcvgy.supabase.co';
const SUPABASE_ANON = 'sb_publishable_wS5AkPa-ce-XY-YstP6DRw_wjr8TU1O';
const STATION_ID    = 'ITHALA20-PHUKET-01';
const STATION_LAT   = 7.8804;   // พิกัดสถานี (ปรับตามจุดวางจริง)
const STATION_LNG   = 98.3923;
const REFRESH_MS    = 60 * 1000; // รีเฟรชทุก 60 วินาที

// ===== ดึงข้อมูลจาก Supabase =====
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

// ===== อัปเดตการ์ด =====
function updateCards(latest) {
  document.getElementById('val-temp').textContent  = latest.temperature?.toFixed(1) ?? '--';
  document.getElementById('val-hum').textContent   = latest.humidity?.toFixed(1)    ?? '--';
  document.getElementById('val-lux').textContent   = latest.light_lux?.toFixed(0)   ?? '--';
  document.getElementById('val-uv').textContent    = latest.uv_raw                  ?? '--';
  document.getElementById('val-rain').textContent  = latest.rain_raw                ?? '--';

  const t = new Date(latest.created_at).toLocaleString('th-TH');
  document.getElementById('last-update').textContent = `อัปเดตล่าสุด: ${t}`;
}

// ===== Status dot =====
function setStatus(online) {
  const dot  = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  dot.className  = 'status-dot ' + (online ? 'online' : 'offline');
  text.textContent = online ? 'ออนไลน์' : 'ออฟไลน์';
}

// ===== กราฟ =====
const charts = {};

const CHART_DEFAULTS = {
  responsive: true,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { labels: { color: '#94a3b8', boxWidth: 12 } }
  },
  scales: {
    x: {
      type: 'time',
      time: { tooltipFormat: 'HH:mm dd/MM', displayFormats: { hour: 'HH:mm' } },
      ticks: { color: '#64748b', maxTicksLimit: 8 },
      grid:  { color: '#1e3a5f22' }
    },
    y: {
      ticks: { color: '#64748b' },
      grid:  { color: '#33415533' }
    }
  }
};

function upsertChart(id, labels, datasets, extraOptions = {}) {
  const ctx = document.getElementById(id).getContext('2d');
  const options = { ...CHART_DEFAULTS, ...extraOptions };

  if (charts[id]) {
    charts[id].data.labels   = labels;
    charts[id].data.datasets = datasets;
    charts[id].update('none');
    return;
  }

  charts[id] = new Chart(ctx, { type: 'line', data: { labels, datasets }, options });
}

function renderCharts(rows) {
  const labels = rows.map(r => new Date(r.created_at));

  // กราฟ 1: อุณหภูมิ + ความชื้น (2 แกน Y)
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
    scales: {
      ...CHART_DEFAULTS.scales,
      y:  { ...CHART_DEFAULTS.scales.y, title: { display: true, text: '°C', color: '#f87171' } },
      y1: { position: 'right', ticks: { color: '#38bdf8' }, grid: { drawOnChartArea: false },
            title: { display: true, text: '%', color: '#38bdf8' } }
    }
  });

  // กราฟ 2: ความสว่าง + UV
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
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

  const icon = L.divIcon({
    html: '<div style="font-size:28px">📡</div>',
    iconSize: [32, 32], iconAnchor: [16, 16], className: ''
  });

  L.marker([STATION_LAT, STATION_LNG], { icon })
    .addTo(map)
    .bindPopup(`
      <b>ITHALA20-PHUKET-01</b><br>
      สถานีตรวจอากาศ ITHALA20<br>
      ภูเก็ต ประเทศไทย
    `)
    .openPopup();
}

// ===== Main Refresh =====
async function refresh() {
  try {
    const rows = await fetchReadings(100);
    if (rows.length === 0) return;
    updateCards(rows[rows.length - 1]);
    renderCharts(rows);
    setStatus(true);
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