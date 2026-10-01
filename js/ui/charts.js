/* ================================================================
   CHARTS — גרפים. שני כלים, לפי סוג הגרף:

   · סדרות זמן (שווי התיק, מול המדד, צבירה) — TradingView Lightweight
     Charts 5.2.1. אושרה ב-29.9.2026. נטענת מה-CDN רק כשמסך צריך גרף.
     קו חוצה עם העכבר, זום וגלילה — מה שנותן תחושה של Koyfin.
     הרישיון (Apache 2.0) מחייב ייחוס ל-TradingView; הלוגו הקטן בפינת
     הגרף הוא הייחוס, ולכן הוא נשאר.
   · גרפים קטנים וסטטיים (ספארקליין, פס חלוקה) — SVG/HTML שלנו, בלי
     ספרייה. אין סיבה לטעון 45KB בשביל קו של 88 פיקסלים.

   הצבעים נקראים מהטוקנים (css/tokens.css) ברגע הציור, כך שמצב כהה
   ומצב בהיר מקבלים את הצבעים הנכונים.
   ================================================================ */
import { h } from './dom.js';

const LWC_URL = 'https://cdn.jsdelivr.net/npm/lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js';
let loading = null;

export function loadCharts() {
  if (globalThis.LightweightCharts) return Promise.resolve(globalThis.LightweightCharts);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LWC_URL;
      s.onload = () => resolve(globalThis.LightweightCharts);
      s.onerror = () => { loading = null; reject(new Error('ספריית הגרפים לא נטענה. בדוק חיבור ונסה שוב.')); };
      document.head.append(s);
    });
  }
  return loading;
}

export const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* גרף סדרות זמן.
   series: [{ name, color: '--s-1', data: [{ time: 'YYYY-MM-DD', value }], kind: 'area'|'line', dashed }]
   format: v => טקסט לציר ולתווית                                       */
export async function timeChart(el, { series, format = v => v.toFixed(0), height }) {
  const L = await loadCharts();
  if (height) el.style.height = `${height}px`;
  const grid = token('--grid'), muted = token('--muted'), fg = token('--fg-2');
  const chart = L.createChart(el, {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: muted, fontFamily: token('--mono') || 'monospace', fontSize: 11 },
    grid: { vertLines: { color: grid }, horzLines: { color: grid } },
    rightPriceScale: { borderColor: grid, scaleMargins: { top: 0.08, bottom: 0.04 } },
    timeScale: { borderColor: grid, timeVisible: false, rightOffset: 2 },
    crosshair: { mode: 0, vertLine: { color: fg, width: 1, style: 3, labelBackgroundColor: token('--chrome') }, horzLine: { color: fg, width: 1, style: 3, labelBackgroundColor: token('--chrome') } },
    localization: { priceFormatter: format, locale: 'en-US' },
    handleScale: { axisPressedMouseMove: false },
  });
  series.forEach(s => {
    const color = s.color.startsWith('--') ? token(s.color) : s.color;
    const opts = { color, lineColor: color, lineWidth: s.kind === 'area' ? 2 : 2, priceLineVisible: false, lastValueVisible: true, lineStyle: s.dashed ? 2 : 0,
      priceFormat: { type: 'custom', formatter: format } };
    const ser = s.kind === 'area'
      ? chart.addSeries(L.AreaSeries, { ...opts, topColor: hexA(color, .22), bottomColor: hexA(color, 0) })
      : chart.addSeries(L.LineSeries, opts);
    ser.setData(s.data);
  });
  chart.timeScale().fitContent();
  return chart;
}

/* גרף נייר: קו סגירות + נקודות כניסה (▲ ירוק, מתחת) ויציאה (▼ אדום,
   מעל) + קו מקווקו של העלות הממוצעת של מה שעדיין מוחזק.
   closes: [{ date, close }] · markers: [{ date, side, qty, price }]
   נקודה בתאריך שאין לו סגירה (סוף שבוע, חור) נצמדת לסגירה הקודמת. */
export async function tradeChart(el, { closes, markers = [], avgCost = null, height = 300 }) {
  const L = await loadCharts();
  el.style.height = `${height}px`;
  const grid = token('--grid'), muted = token('--muted'), fg = token('--fg-2');
  const fmt = v => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const chart = L.createChart(el, {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: muted, fontFamily: token('--mono') || 'monospace', fontSize: 11 },
    grid: { vertLines: { color: grid }, horzLines: { color: grid } },
    rightPriceScale: { borderColor: grid, scaleMargins: { top: 0.1, bottom: 0.08 } },
    timeScale: { borderColor: grid, timeVisible: false, rightOffset: 4 },
    crosshair: { mode: 0, vertLine: { color: fg, width: 1, style: 3, labelBackgroundColor: token('--chrome') }, horzLine: { color: fg, width: 1, style: 3, labelBackgroundColor: token('--chrome') } },
    localization: { priceFormatter: fmt, locale: 'en-US' },
    handleScale: { axisPressedMouseMove: false },
  });
  const line = token('--s-1') || '#2563eb';
  const ser = chart.addSeries(L.AreaSeries, { lineColor: line, topColor: hexA(line, 0.16), bottomColor: hexA(line, 0), lineWidth: 2, priceLineVisible: false, lastValueVisible: true, priceFormat: { type: 'custom', formatter: fmt } });
  const data = closes.map(c => ({ time: c.date, value: c.close }));
  ser.setData(data);
  const times = data.map(d => d.time);
  const snap = date => { let t = null; for (const x of times) { if (x <= date) t = x; else break; } return t || times[0]; };
  const up = token('--up'), down = token('--down');
  if (markers.length && L.createSeriesMarkers) {
    const ms = markers.map(m => ({
      time: snap(m.date), position: m.side === 'buy' ? 'belowBar' : 'aboveBar', color: m.side === 'buy' ? up : down,
      shape: m.side === 'buy' ? 'arrowUp' : 'arrowDown', text: `${m.side === 'buy' ? '+' : '−'}${Math.round(m.qty)}`,
    })).sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    L.createSeriesMarkers(ser, ms);
  }
  if (avgCost > 0) ser.createPriceLine({ price: avgCost, color: fg, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'עלות' });
  chart.timeScale().fitContent();
  return chart;
}

/* גרף עמודות לרווח לפי תקופה: ירוק מעל 0, אדום מתחת.
   bars: [{ time: 'YYYY-MM-DD', value }] */
export async function barChart(el, { bars, format = v => v.toFixed(0), height = 260 }) {
  const L = await loadCharts();
  el.style.height = `${height}px`;
  const grid = token('--grid'), muted = token('--muted'), fg = token('--fg-2');
  const chart = L.createChart(el, {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: muted, fontFamily: token('--mono') || 'monospace', fontSize: 11 },
    grid: { vertLines: { visible: false }, horzLines: { color: grid } },
    rightPriceScale: { borderColor: grid, scaleMargins: { top: 0.08, bottom: 0.08 } },
    timeScale: { borderColor: grid, timeVisible: false, rightOffset: 1 },
    crosshair: { mode: 0, vertLine: { color: fg, width: 1, style: 3, labelBackgroundColor: token('--chrome') }, horzLine: { color: fg, width: 1, style: 3, labelBackgroundColor: token('--chrome') } },
    localization: { priceFormatter: format, locale: 'en-US' },
    handleScale: { axisPressedMouseMove: false },
  });
  const up = token('--up'), down = token('--down');
  const ser = chart.addSeries(L.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: { type: 'custom', formatter: format }, base: 0 });
  ser.setData(bars.map(b => ({ time: b.time, value: b.value, color: b.value >= 0 ? up : down })));
  chart.timeScale().fitContent();
  return chart;
}

/* מקרא לגרף — HTML ולא בתוך הקנבס, כדי שיהיה בעברית ונגיש. */
export function legend(items) {
  return h('div', { class: 'legend' }, items.map(i =>
    h('span', null, h('i', { style: { background: i.color.startsWith('--') ? `var(${i.color})` : i.color, ...(i.dashed ? { backgroundImage: 'none', height: '0', borderTop: `2px dashed var(${i.color})` } : {}) } }), i.label)));
}

/* ספארקליין SVG. values = מערך מספרים. הצבע לפי הכיוון מתחילה לסוף. */
export function sparkline(values, { width = 88, height = 22 } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'spark');
  svg.setAttribute('aria-hidden', 'true');
  const v = (values || []).filter(x => isFinite(x));
  if (v.length < 2) return svg;
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = v.map((y, i) => `${(i / (v.length - 1)) * (width - 2) + 1},${height - 2 - ((y - min) / span) * (height - 4)}`);
  const up = v[v.length - 1] >= v[0];
  const path = document.createElementNS(ns, 'polyline');
  path.setAttribute('points', pts.join(' '));
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', up ? 'var(--up)' : 'var(--down)');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  const dot = document.createElementNS(ns, 'circle');
  const [lx, ly] = pts[pts.length - 1].split(',');
  dot.setAttribute('cx', lx); dot.setAttribute('cy', ly); dot.setAttribute('r', '2');
  dot.setAttribute('fill', up ? 'var(--up)' : 'var(--down)');
  svg.append(dot);
  return svg;
}

/* פלטת קטגוריות — לפס החלוקה. סדר קבוע, כדי שאותו נייר יקבל אותו צבע. */
export const PALETTE = ['#2563eb', '#7c3aed', '#0891b2', '#f59e0b', '#db2777', '#16a34a', '#64748b', '#ea580c', '#0d9488', '#9333ea'];

/* פס חלוקה + רשימה. parts: [{ label, value, text }] */
export function allocation(parts, { max = 8 } = {}) {
  const sorted = parts.filter(p => p.value > 0).sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, max);
  const rest = sorted.slice(max).reduce((s, p) => s + p.value, 0);
  if (rest > 0) top.push({ label: `אחרים (${sorted.length - max})`, value: rest, other: true });
  const total = top.reduce((s, p) => s + p.value, 0) || 1;
  const color = (p, i) => (p.other ? '#94a3b8' : PALETTE[i % PALETTE.length]);
  return h('div', { style: { display: 'grid', gap: '10px' } },
    h('div', { class: 'allocbar', role: 'img', 'aria-label': top.map(p => `${p.label} ${((p.value / total) * 100).toFixed(1)}%`).join(', ') },
      top.map((p, i) => h('span', { style: { width: `${(p.value / total) * 100}%`, background: color(p, i) }, title: p.label }))),
    h('div', { class: 'alloclist' }, top.map((p, i) => h('div', null,
      h('i', { style: { background: color(p, i) } }),
      h('span', null, p.label),
      h('span', { class: 'num muted' }, p.text || ''),
      h('span', { class: 'num' }, `${((p.value / total) * 100).toFixed(1)}%`)))));
}

function hexA(hex, a) {
  const m = String(hex).trim().match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`;
}
