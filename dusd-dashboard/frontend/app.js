const fmtNum = (x, digits = 2) => {
  if (x === null || x === undefined || Number.isNaN(x)) return "N/A";
  try {
    return Number(x).toLocaleString(undefined, { maximumFractionDigits: digits });
  } catch {
    return String(x);
  }
};

/** Recent burns Amount column: grouped, always 2 decimal places. */
function fmtBurnAmountDisplay(x) {
  if (x === null || x === undefined || Number.isNaN(Number(x))) return "—";
  const n = Number(x);
  try {
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return String(x);
  }
}

const fmtNumFixed1 = (x) => {
  if (x === null || x === undefined || Number.isNaN(x)) return "N/A";
  try {
    return Number(x).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  } catch {
    return String(x);
  }
};

const fmtUsdFixed1 = (x) => {
  if (x === null || x === undefined || Number.isNaN(x)) return "N/A";
  const n = Number(x);
  try {
    return `$${n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
  } catch {
    return `$${String(x)}`;
  }
};

const fmtUsd = (x, digits = 6) => {
  if (x === null || x === undefined || Number.isNaN(x)) return "N/A";
  const n = Number(x);
  const d = n >= 1 ? 4 : digits;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: d })}`;
};

/** Trading section volume (24h / 7d / 30d): exactly one decimal, grouped. */
const fmtUsdTradingVolume = (x) => {
  if (x === null || x === undefined || Number.isNaN(Number(x))) return "N/A";
  const n = Number(x);
  try {
    return `$${n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
  } catch {
    return `$${String(x)}`;
  }
};

const fmtPct = (x, digits = 2) => {
  if (x === null || x === undefined || Number.isNaN(x)) return "N/A";
  const n = Number(x);
  const s = `${n.toLocaleString(undefined, { maximumFractionDigits: digits })}%`;
  return s;
};

const fmtDeltaPct = (x) => {
  if (x === null || x === undefined || Number.isNaN(x)) return { text: "N/A", cls: "" };
  const n = Number(x);
  const cls = n > 0 ? "pos" : n < 0 ? "neg" : "";
  const sign = n > 0 ? "+" : "";
  return { text: `${sign}${fmtPct(n)}`, cls };
};

const fmtDuration = (seconds) => {
  // Display as years + months (approx) for "time to zero"
  if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return "N/A";
  const totalDays = Math.floor(Number(seconds) / 86400);
  const years = Math.floor(totalDays / 365);
  const months = Math.floor((totalDays % 365) / 30);
  if (years <= 0 && months <= 0) return "<1m";
  if (years <= 0) return `${months}m`;
  return `${years}y ${months}m`;
};

const TZ_NY = "America/New_York";

/**
 * Parse API values: ISO-8601 strings or unix seconds (number).
 * @param {string | number | null | undefined} value
 * @returns {Date | null}
 */
function parseTimestampInput(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000);
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) {
      const n = parseInt(s, 10);
      if (!Number.isFinite(n)) return null;
      return new Date(n * 1000);
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function _pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * UK-style date + 24h UTC with America/New_York secondary time.
 * Secondary label is always "EST"; wall-clock reflects DST.
 * @param {string | number | null | undefined} value
 * @returns {string}
 */
function fmtTimestampDual(value) {
  const d = parseTimestampInput(value);
  if (!d) return "—";

  const datePart = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  const utcH = _pad2(d.getUTCHours());
  const utcM = _pad2(d.getUTCMinutes());

  const nyFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ_NY,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = nyFmt.formatToParts(d);
  let nyH = "00";
  let nyM = "00";
  for (const p of parts) {
    if (p.type === "hour") nyH = _pad2(Number.parseInt(p.value, 10));
    if (p.type === "minute") nyM = _pad2(Number.parseInt(p.value, 10));
  }

  return `${datePart}, ${utcH}:${utcM} UTC (${nyH}:${nyM} EST)`;
}

/** Prefer ISO from API when parseable; else unix `timestamp`. */
function burnRowTimestampFormatted(it) {
  const iso = it.datetime_utc != null && String(it.datetime_utc).trim() !== "" ? it.datetime_utc : null;
  if (iso && parseTimestampInput(iso)) return fmtTimestampDual(iso);
  if (it.timestamp != null && it.timestamp !== "") return fmtTimestampDual(it.timestamp);
  return "—";
}

async function getJson(path) {
  const r = await fetch(path, { headers: { "cache-control": "no-cache" } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return await r.json();
}

const els = {
  totalBurned: document.getElementById("totalBurned"),
  burnedValue: document.getElementById("burnedValue"),
  currentSupply: document.getElementById("currentSupply"),
  burnedPct: document.getElementById("burnedPct"),
  supplyRing: document.getElementById("supplyRing"),
  lastUpdatedPill: document.getElementById("lastUpdatedPill"),
  burnWindowAmount: document.getElementById("burnWindowAmount"),
  holderChange: document.getElementById("holderChange"),
  burnPerSecond: document.getElementById("burnPerSecond"),
  timeToZero: document.getElementById("timeToZero"),
  burnPctCirc: document.getElementById("burnPctCirc"),
  tradeVolume: document.getElementById("tradeVolume"),
  priceUsd: document.getElementById("priceUsd"),
  liquidityUsd: document.getElementById("liquidityUsd"),
  tradeTrades: document.getElementById("tradeTrades"),
  burnTable: document.getElementById("burnTable"),
  burnsViewToggle: document.getElementById("burnsViewToggle"),
};

let burnWindow = "24h";
/** Active day count when `burnWindow === "custom"`. */
let burnCustomDays = 7;
/** Max days allowed for custom burn window (from API / burn history). */
let burnMaxHistoryDays = 366;
let tradeWindow = "24h";
let currentPriceUsd = null;
/** Full list from API; rendering uses slice when collapsed. */
let burnItems = [];
let showAllBurns = false;
const BURNS_PREVIEW = 8;

/** Calendar days excluded only from Daily Burn chart display (e.g. single-day outlier). */
const DAILY_BURN_CHART_EXCLUDED_DAYS = new Set(["2026-03-10"]);

/** Plot geometry for daily burn chart hover. */
let dailyBurnPlotState = null;

/** Raw API rows for daily burn; range toggles derive a non-mutating view. */
let dailyBurnPointsRaw = [];
/** `"30d"` | `"all"` — default 30D. */
let dailyBurnChartRange = "30d";

function buildDailyBurnCleanedSeries(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((p) => ({
      day: p.day,
      total_ui: p.total_ui == null ? NaN : Number(p.total_ui),
    }))
    .filter((p) => p.day && Number.isFinite(p.total_ui) && !DAILY_BURN_CHART_EXCLUDED_DAYS.has(p.day))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** Last 30 calendar days inclusive ending at the latest day in `cleaned`. */
function sliceDailyBurnLast30Days(cleaned) {
  if (!cleaned.length) return cleaned;
  const lastDay = cleaned[cleaned.length - 1].day;
  const [y, m, d] = lastDay.split("-").map(Number);
  if (!y || !m || !d) return cleaned;
  const endMs = Date.UTC(y, m - 1, d);
  const startMs = endMs - 29 * 86400000;
  return cleaned.filter((p) => {
    const [py, pm, pd] = p.day.split("-").map(Number);
    if (!py || !pm || !pd) return false;
    const t = Date.UTC(py, pm - 1, pd);
    return t >= startMs && t <= endMs;
  });
}

function applyDailyBurnChartView() {
  const cleaned = buildDailyBurnCleanedSeries(dailyBurnPointsRaw);
  const view = dailyBurnChartRange === "all" ? cleaned : sliceDailyBurnLast30Days(cleaned);
  renderDailyBurnChart(view);
}

/** Daily burn Y-axis: compact K / M (e.g. 20.43K, 1.2M). */
function fmtChartAxisYBurn(v) {
  const x = Number(v);
  if (!Number.isFinite(x)) return "0";
  if (Math.abs(x) < 1e-12) return "0";
  /** @param {number} n */
  const trimNum = (n) => {
    const t = n.toFixed(2);
    return t.replace(/\.?0+$/, "");
  };
  const ax = Math.abs(x);
  const sign = x < 0 ? "-" : "";
  if (ax >= 1e9) return `${sign}${trimNum(ax / 1e9)}B`;
  if (ax >= 1e6) return `${sign}${trimNum(ax / 1e6)}M`;
  if (ax >= 1e3) return `${sign}${trimNum(ax / 1e3)}K`;
  if (ax >= 1) return `${sign}${trimNum(ax)}`;
  return `${sign}${trimNum(ax)}`;
}

/** X-axis date: "11 Mar" (UTC, en-GB). */
function formatDayLabelAxis(ymd) {
  if (!ymd || typeof ymd !== "string") return "—";
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  try {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  } catch {
    return ymd;
  }
}

/** Indices for x-axis ticks: 0/25/50/75/100% of range; mobile uses start/mid/end when narrow. */
function dailyBurnXLabelIndices(n, sparseMobile) {
  if (n <= 1) return [0];
  if (sparseMobile) {
    if (n === 2) return [0, 1];
    return [0, Math.floor((n - 1) / 2), n - 1];
  }
  const fracs = [0, 0.25, 0.5, 0.75, 1];
  const idxs = fracs.map((f) => Math.round(f * (n - 1)));
  return [...new Set(idxs)].sort((a, b) => a - b);
}

function uniqueSortedYTicks(scaleMax, fracs) {
  const eps = Math.max(Number(scaleMax) * 1e-9, 1e-12);
  const raw = fracs.map((f) => f * scaleMax);
  const out = [];
  for (const yv of raw) {
    if (out.length && Math.abs(yv - out[out.length - 1]) < eps) continue;
    out.push(yv);
  }
  return out;
}

function formatDayLabel(ymd) {
  if (!ymd || typeof ymd !== "string") return "—";
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  try {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  } catch {
    return ymd;
  }
}

/** UK-style calendar day from YYYY-MM-DD (UTC), e.g. 3 May 2026 */
function formatCalendarDayUk(ymd) {
  if (!ymd || typeof ymd !== "string") return "—";
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  try {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return ymd;
  }
}

function buildDailyBurnLinePath(xs, ys) {
  if (xs.length === 0) return "";
  if (xs.length === 1) return `M ${xs[0]} ${ys[0]}`;
  const n = xs.length;
  let d = `M ${xs[0]} ${ys[0]}`;
  for (let i = 0; i < n - 1; i++) {
    const x0 = xs[i];
    const y0 = ys[i];
    const x1 = xs[i + 1];
    const y1 = ys[i + 1];
    const c1x = x0 + (x1 - x0) / 3;
    const c2x = x1 - (x1 - x0) / 3;
    d += ` C ${c1x} ${y0}, ${c2x} ${y1}, ${x1} ${y1}`;
  }
  return d;
}

function setupDailyBurnInteractions() {
  const svg = document.getElementById("dailyBurnSvg");
  const body = svg?.closest(".daily-burn-panel__body");
  const tip = document.getElementById("dailyBurnTooltip");
  if (!svg || !body || !tip || body.dataset.hoverBound === "1") return;
  body.dataset.hoverBound = "1";
  body.addEventListener("mousemove", (e) => {
    if (!dailyBurnPlotState || !dailyBurnPlotState.pts?.length) {
      tip.hidden = true;
      return;
    }
    const { pts } = dailyBurnPlotState;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const cur = pt.matrixTransform(ctm.inverse());
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const dx = cur.x - pts[i].x;
      const dist = Math.abs(dx);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    const p = pts[best];
    tip.textContent = `${formatCalendarDayUk(p.day)} · ${fmtNum(p.v, 4)} DUSD`;
    tip.hidden = false;
    const bodyRect = body.getBoundingClientRect();
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox?.baseVal;
    if (!vb || !vb.width) return;
    const sx = rect.left + (p.x / vb.width) * rect.width - bodyRect.left;
    const sy = rect.top + (p.y / vb.height) * rect.height - bodyRect.top;
    tip.style.left = `${sx}px`;
    tip.style.top = `${sy}px`;
  });
  body.addEventListener("mouseleave", () => {
    tip.hidden = true;
  });
}

function renderDailyBurnChart(points) {
  const svg = document.getElementById("dailyBurnSvg");
  const tip = document.getElementById("dailyBurnTooltip");
  if (!svg) return;
  dailyBurnPlotState = null;
  if (tip) tip.hidden = true;

  const compact =
    typeof window.matchMedia !== "undefined" && window.matchMedia("(max-width: 980px)").matches;
  const narrowMobile =
    typeof window.matchMedia !== "undefined" && window.matchMedia("(max-width: 768px)").matches;

  const raw = Array.isArray(points) ? points : [];
  const cleaned = raw
    .map((p) => ({
      day: p.day,
      v: p.total_ui == null ? NaN : Number(p.total_ui),
    }))
    .filter((p) => p.day && Number.isFinite(p.v));

  if (!cleaned.length) {
    svg.innerHTML = "";
    svg.setAttribute("viewBox", "0 0 800 240");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    return;
  }

  /* Mobile: taller viewBox + meet → ~230px tall plot on narrow widths without stretch/clipping. */
  const bodyEl = svg.closest(".daily-burn-panel__body");
  let H = 240;
  if (narrowMobile) {
    const rect = bodyEl?.getBoundingClientRect();
    const targetDisplayPx = 228;
    const innerW = rect && rect.width > 48 ? rect.width - 18 : 0;
    const bw = innerW > 0 ? innerW : 320;
    H = Math.round((800 * targetDisplayPx) / Math.max(260, bw));
    H = Math.min(520, Math.max(300, H));
  }
  svg.setAttribute("viewBox", `0 0 800 ${H}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.innerHTML = "";

  const W = 800;
  const padL = narrowMobile ? 58 : compact ? 46 : 54;
  const padR = narrowMobile ? 12 : compact ? 10 : 14;
  const padT = narrowMobile ? 14 : compact ? 10 : 12;
  const padB = narrowMobile ? 38 : compact ? 34 : 40;
  const gw = W - padL - padR;
  const gh = H - padT - padB;
  const maxV = Math.max(...cleaned.map((p) => p.v), 1e-12);
  const minV = 0;
  /* Slight headroom above peak; still beginAtZero (minV = 0). */
  const yScaleMax = narrowMobile ? maxV * 1.06 : maxV;
  const plotVertFrac = narrowMobile ? 0.82 : 0.92;
  const xLabelY = narrowMobile ? H - 12 : H - 10;
  const yLabelInset = narrowMobile ? 10 : 8;
  const n = cleaned.length;
  const xs = cleaned.map((_, i) => (n === 1 ? padL + gw / 2 : padL + (gw * i) / (n - 1)));
  const ys = cleaned.map(
    (p) => padT + gh - ((p.v - minV) / (yScaleMax - minV)) * gh * plotVertFrac,
  );

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
  filter.setAttribute("id", "dailyBurnGlow");
  filter.setAttribute("x", "-25%");
  filter.setAttribute("y", "-25%");
  filter.setAttribute("width", "150%");
  filter.setAttribute("height", "150%");
  const blur = document.createElementNS("http://www.w3.org/2000/svg", "feGaussianBlur");
  blur.setAttribute("in", "SourceGraphic");
  blur.setAttribute("stdDeviation", "0.85");
  blur.setAttribute("result", "blur");
  const merge = document.createElementNS("http://www.w3.org/2000/svg", "feMerge");
  const mn1 = document.createElementNS("http://www.w3.org/2000/svg", "feMergeNode");
  mn1.setAttribute("in", "blur");
  const mn2 = document.createElementNS("http://www.w3.org/2000/svg", "feMergeNode");
  mn2.setAttribute("in", "SourceGraphic");
  merge.appendChild(mn1);
  merge.appendChild(mn2);
  filter.appendChild(blur);
  filter.appendChild(merge);
  defs.appendChild(filter);
  svg.appendChild(defs);

  const axisColor = "rgba(255,255,255,.22)";
  const tickColor = "rgba(255,255,255,.38)";
  const baseline = document.createElementNS("http://www.w3.org/2000/svg", "line");
  baseline.setAttribute("x1", String(padL));
  baseline.setAttribute("x2", String(W - padR));
  baseline.setAttribute("y1", String(padT + gh));
  baseline.setAttribute("y2", String(padT + gh));
  baseline.setAttribute("stroke", axisColor);
  baseline.setAttribute("stroke-width", "1");
  svg.appendChild(baseline);

  const xTickFs = narrowMobile ? "11" : compact ? "10" : "11";

  const xLabelIndices = dailyBurnXLabelIndices(n, narrowMobile);
  const xLabels = xLabelIndices.map((i) => [xs[i], cleaned[i].day]);
  for (const [lx, dayStr] of xLabels) {
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("x", String(lx));
    t.setAttribute("y", String(xLabelY));
    t.setAttribute("fill", tickColor);
    t.setAttribute("font-size", xTickFs);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-family", "system-ui, Segoe UI, sans-serif");
    t.textContent = formatDayLabelAxis(dayStr);
    svg.appendChild(t);
  }

  const yticks = uniqueSortedYTicks(yScaleMax, [0, 0.25, 0.5, 0.75, 1]);
  const yTickFs = narrowMobile ? "10" : compact ? "10" : "11";
  yticks.forEach((yv, i) => {
    const ly = padT + gh - ((yv - minV) / (yScaleMax - minV)) * gh * plotVertFrac;
    const yt = document.createElementNS("http://www.w3.org/2000/svg", "text");
    yt.setAttribute("x", String(padL - yLabelInset));
    yt.setAttribute("y", String(ly + 4));
    yt.setAttribute("fill", tickColor);
    yt.setAttribute("font-size", yTickFs);
    yt.setAttribute("text-anchor", "end");
    yt.setAttribute("font-family", "system-ui, Segoe UI, sans-serif");
    yt.textContent = fmtChartAxisYBurn(yv);
    svg.appendChild(yt);
  });

  const lineStroke = narrowMobile ? 2.65 : compact ? 2.75 : 2.35;
  const glowStroke = narrowMobile ? 3.6 : compact ? 3.75 : 3.4;
  const lineD = buildDailyBurnLinePath(xs, ys);
  const glowPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  glowPath.setAttribute("d", lineD);
  glowPath.setAttribute("fill", "none");
  glowPath.setAttribute("stroke", "#ff5a14");
  glowPath.setAttribute("stroke-width", String(glowStroke));
  glowPath.setAttribute("stroke-linecap", "round");
  glowPath.setAttribute("stroke-linejoin", "round");
  glowPath.setAttribute("opacity", "0.14");
  glowPath.setAttribute("filter", "url(#dailyBurnGlow)");
  svg.appendChild(glowPath);

  const linePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  linePath.setAttribute("d", lineD);
  linePath.setAttribute("fill", "none");
  linePath.setAttribute("stroke", "#ff5a14");
  linePath.setAttribute("stroke-width", String(lineStroke));
  linePath.setAttribute("stroke-linecap", "round");
  linePath.setAttribute("stroke-linejoin", "round");
  svg.appendChild(linePath);

  dailyBurnPlotState = {
    pts: cleaned.map((p, i) => ({ day: p.day, v: p.v, x: xs[i], y: ys[i] })),
  };
  setupDailyBurnInteractions();
}

async function loadDailyBurnsChart() {
  if (!document.getElementById("dailyBurnSvg")) return;
  try {
    const data = await getJson("/api/burns/daily?days=366");
    dailyBurnPointsRaw = data.points || [];
  } catch {
    dailyBurnPointsRaw = [];
  }
  setActiveButtons("data-daily-chart-range", dailyBurnChartRange);
  applyDailyBurnChartView();
}

function setActiveButtons(attr, value) {
  document.querySelectorAll(`button[${attr}]`).forEach((b) => {
    b.classList.toggle("is-active", b.getAttribute(attr) === value);
  });
}

async function loadCurrent() {
  const cur = await getJson("/api/current");
  els.totalBurned.textContent = cur.total_burned === null ? "N/A" : `${fmtNumFixed1(cur.total_burned)} DUSD`;
  els.burnedValue.textContent = cur.burned_value_usd_at_current_price === null ? "N/A" : fmtUsdFixed1(cur.burned_value_usd_at_current_price);
  els.priceUsd.textContent = cur.price_usd === null ? "N/A" : fmtUsd(cur.price_usd, 8);
  els.liquidityUsd.textContent = cur.liquidity_usd === null ? "N/A" : fmtUsd(cur.liquidity_usd, 2);
  currentPriceUsd = cur.price_usd === null || cur.price_usd === undefined ? null : Number(cur.price_usd);
  if (els.currentSupply) {
    els.currentSupply.textContent = cur.current_supply === null ? "N/A" : `${fmtNumFixed1(cur.current_supply)} DUSD`;
  }

  const pct = cur.burned_pct_of_original === null ? null : Number(cur.burned_pct_of_original);
  if (els.burnedPct) {
    els.burnedPct.textContent = pct === null || Number.isNaN(pct) ? "—" : `${fmtNum(pct, 2)}%`;
  }
  if (pct !== null && Number.isFinite(pct) && els.supplyRing) {
    const clamped = Math.max(0, Math.min(100, pct));
    els.supplyRing.style.setProperty("--burnedPct", `${clamped}%`);
  }
  if (els.lastUpdatedPill) {
    els.lastUpdatedPill.textContent = `last updated: ${fmtTimestampDual(cur.captured_at_ts)}`;
  }
  return cur;
}

function fmtUsdBurnWindow(amountUsd) {
  const n = Number(amountUsd);
  if (!Number.isFinite(n)) return "N/A";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function metricsUrlForBurnWindow() {
  if (burnWindow === "custom") {
    return `/api/metrics?window=custom&days=${encodeURIComponent(String(burnCustomDays))}`;
  }
  return `/api/metrics?window=${encodeURIComponent(burnWindow)}`;
}

function clampBurnCustomDays(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return Math.min(7, burnMaxHistoryDays);
  return Math.max(1, Math.min(n, burnMaxHistoryDays));
}

function syncBurnCustomDaysInput() {
  const input = document.getElementById("burnWindowCustomDays");
  if (!input) return;
  input.value = String(burnCustomDays);
  input.placeholder = `1–${burnMaxHistoryDays}d`;
  input.setAttribute("aria-valuemin", "1");
  input.setAttribute("aria-valuemax", String(burnMaxHistoryDays));
}

function updateBurnCustomControl() {
  const btn = document.getElementById("burnWindowCustomBtn");
  const label = document.getElementById("burnWindowCustomLabel");
  const field = document.getElementById("burnWindowCustomField");
  const isCustom = burnWindow === "custom";
  if (btn) btn.classList.toggle("is-active", isCustom);
  if (label) label.hidden = isCustom;
  if (field) field.hidden = !isCustom;
  syncBurnCustomDaysInput();
}

function focusBurnCustomInput() {
  const input = document.getElementById("burnWindowCustomDays");
  if (!input || burnWindow !== "custom") return;
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function setBurnWindowUiActive() {
  document.querySelectorAll("[data-burn-window]").forEach((b) => {
    const win = b.getAttribute("data-burn-window");
    if (win === "custom") return;
    b.classList.toggle("is-active", win === burnWindow);
  });
  updateBurnCustomControl();
}

function applyBurnMaxHistoryFromMetrics(m) {
  if (m?.max_history_days != null && Number.isFinite(Number(m.max_history_days))) {
    burnMaxHistoryDays = Math.max(1, Math.round(Number(m.max_history_days)));
    syncBurnCustomDaysInput();
  }
  if (burnWindow === "custom") {
    if (m?.custom_days != null && Number.isFinite(Number(m.custom_days))) {
      burnCustomDays = Math.round(Number(m.custom_days));
    } else {
      burnCustomDays = clampBurnCustomDays(burnCustomDays);
    }
    syncBurnCustomDaysInput();
    updateBurnCustomControl();
  }
}

async function loadBurnWindow() {
  const m = await getJson(metricsUrlForBurnWindow());
  applyBurnMaxHistoryFromMetrics(m);
  if (m.burned_in_window === null || m.burned_in_window === undefined) {
    els.burnWindowAmount.textContent = "N/A";
  } else {
    const amount = Number(m.burned_in_window);
    if (!Number.isFinite(amount)) {
      els.burnWindowAmount.textContent = "N/A";
    } else if (amount === 0) {
      if (currentPriceUsd !== null && Number.isFinite(currentPriceUsd)) {
        els.burnWindowAmount.innerHTML =
          `0.0 DUSD <span class="v-usd">($${fmtUsdBurnWindow(0)})</span>`;
      } else {
        els.burnWindowAmount.textContent = "0.0 DUSD";
      }
    } else if (currentPriceUsd === null || !Number.isFinite(currentPriceUsd)) {
      els.burnWindowAmount.textContent = `${fmtNum(m.burned_in_window, 6)} DUSD`;
    } else {
      const burnedUsd = amount * currentPriceUsd;
      els.burnWindowAmount.innerHTML =
        `${fmtNum(amount, 1)} DUSD <span class="v-usd">($${fmtUsdBurnWindow(burnedUsd)})</span>`;
    }
  }
  if (m.holder_count === null || m.holder_count === undefined) {
    els.holderChange.textContent = "N/A";
    els.holderChange.className = "v holders-line";
  } else {
    const total = Number(m.holder_count);
    const totalStr = fmtNum(total, 0);
    let inner;
    if (m.holder_change === null || m.holder_change === undefined) {
      inner = ` <span class="holders-delta">(N/A)</span>`;
    } else {
      const d = Number(m.holder_change);
      if (d > 0) {
        inner = ` <span class="holders-delta pos">(+${fmtNum(d, 0)})</span>`;
      } else if (d < 0) {
        inner = ` <span class="holders-delta neg">(${fmtNum(d, 0)})</span>`;
      } else {
        inner = ` <span class="holders-delta neg">(0)</span>`;
      }
    }
    els.holderChange.innerHTML = `${totalStr}${inner}`;
    els.holderChange.className = "v holders-line";
  }
  els.burnPerSecond.textContent =
    m.avg_burn_per_second === null || m.avg_burn_per_second === undefined
      ? "N/A"
      : `${fmtNum(m.avg_burn_per_second, 2)} DUSD/s`;
  if (
    m.projected_time_to_zero_seconds != null &&
    Number.isFinite(Number(m.projected_time_to_zero_seconds))
  ) {
    els.timeToZero.textContent = fmtDuration(m.projected_time_to_zero_seconds);
  } else if (Number(m.burned_in_window) === 0) {
    els.timeToZero.textContent = "∞";
  } else {
    els.timeToZero.textContent = "N/A";
  }
  if (m.burn_as_pct_of_circulating_in_window === null || m.burn_as_pct_of_circulating_in_window === undefined) {
    els.burnPctCirc.textContent = "N/A";
  } else {
    const p = Number(m.burn_as_pct_of_circulating_in_window);
    els.burnPctCirc.textContent = p === 0 ? "0.0000%" : fmtPct(p, 4);
  }
}

function tradingChgHtml(pct) {
  if (pct === null || pct === undefined || Number.isNaN(Number(pct))) {
    return `<span class="metric-inline-chg metric-inline-chg--na">(N/A)</span>`;
  }
  const n = Number(pct);
  const abs = Math.abs(n);
  const num = abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signed = (n > 0 ? "+" : n < 0 ? "-" : "") + num + "%";
  const cls =
    n > 0 ? "metric-inline-chg metric-inline-chg--pos" : "metric-inline-chg metric-inline-chg--neg";
  return `<span class="${cls}">(${signed})</span>`;
}

function setTradingMetricLine(el, primaryText, pct) {
  el.innerHTML = `<span class="metric-inline-primary">${primaryText}</span><span class="metric-inline-secondary">${tradingChgHtml(pct)}</span>`;
}

/** 24h trades total: prefer API trades_24h, else buys+sells (older / partial JSON). */
function trading24hTradesTotal(t) {
  if (typeof t.trades_24h === "number" && !Number.isNaN(t.trades_24h)) return t.trades_24h;
  if (typeof t.trades_count === "number" && !Number.isNaN(t.trades_count)) return t.trades_count;
  const b = t.buys_24h;
  const s = t.sells_24h;
  if (b != null && s != null) {
    const nb = Number(b);
    const ns = Number(s);
    if (Number.isFinite(nb) && Number.isFinite(ns)) return nb + ns;
  }
  return null;
}

/** 24h price %: coalesce field names from API. */
function trading24hPriceChangePct(t) {
  const candidates = [t.price_change_pct, t.price_change_24h_pct];
  for (const p of candidates) {
    if (p !== null && p !== undefined && !Number.isNaN(Number(p))) return Number(p);
  }
  return null;
}

async function loadTradingWindow() {
  const t = await getJson(`/api/trading?window=${encodeURIComponent(tradeWindow)}`);

  const pMain = t.price_usd === null || t.price_usd === undefined ? "N/A" : fmtUsd(t.price_usd, 8);
  const priceChg =
    tradeWindow === "24h" ? trading24hPriceChangePct(t) : t.price_change_pct;
  setTradingMetricLine(els.priceUsd, pMain, priceChg);

  const volMain = t.volume === null || t.volume === undefined ? "N/A" : fmtUsdTradingVolume(t.volume);
  setTradingMetricLine(els.tradeVolume, volMain, t.volume_change_pct);

  const lMain = t.liquidity_usd === null || t.liquidity_usd === undefined ? "N/A" : fmtUsd(t.liquidity_usd, 2);
  setTradingMetricLine(els.liquidityUsd, lMain, t.liquidity_change_pct);

  if (els.tradeTrades) {
    if (tradeWindow === "24h") {
      const tt = trading24hTradesTotal(t);
      if (tt !== null && !Number.isNaN(tt)) {
        setTradingMetricLine(els.tradeTrades, fmtNum(tt, 0), t.trades_change_pct);
      } else {
        els.tradeTrades.innerHTML = `<span class="metric-inline-primary">N/A</span><span class="metric-inline-secondary">${tradingChgHtml(null)}</span>`;
      }
    } else if (t.trades_count === null || t.trades_count === undefined) {
      els.tradeTrades.innerHTML = `<span class="metric-inline-primary">N/A</span><span class="metric-inline-secondary">${tradingChgHtml(
        t.trades_change_pct,
      )}</span>`;
    } else {
      const tc = Number(t.trades_count);
      const main =
        Number.isFinite(tc) && Math.abs(tc - Math.round(tc)) < 0.001 ? fmtNum(Math.round(tc), 0) : fmtNum(tc, 1);
      setTradingMetricLine(els.tradeTrades, main, t.trades_change_pct);
    }
  }
}

function sigLink(sig) {
  const s = String(sig || "");
  const short = s.length > 10 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
  const a = document.createElement("a");
  a.href = `https://solscan.io/tx/${encodeURIComponent(s)}`;
  a.target = "_blank";
  a.rel = "noreferrer";
  a.className = "sig";
  a.textContent = short;
  return a;
}

function renderBurnRows(items) {
  els.burnTable.innerHTML = "";
  if (!items.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.className = "muted";
    td.textContent = "No burns stored yet.";
    tr.appendChild(td);
    els.burnTable.appendChild(tr);
    return;
  }

  for (const it of items) {
    const tr = document.createElement("tr");

    const tdTs = document.createElement("td");
    tdTs.textContent = burnRowTimestampFormatted(it);

    const tdAmt = document.createElement("td");
    if (it.amount_ui === null || it.amount_ui === undefined || Number.isNaN(Number(it.amount_ui))) {
      tdAmt.textContent = "—";
    } else {
      const amount = Number(it.amount_ui);
      tdAmt.className = "burn-amount-cell";
      const dusdLabel =
        amount >= 1 ? `${fmtNum(amount, 0)} DUSD` : `${fmtBurnAmountDisplay(amount)} DUSD`;
      if (currentPriceUsd !== null && Number.isFinite(currentPriceUsd)) {
        const usd = amount * currentPriceUsd;
        tdAmt.innerHTML = `${dusdLabel} <span class="burn-amount-usd">($${fmtUsdBurnWindow(usd)})</span>`;
      } else {
        tdAmt.textContent = dusdLabel;
      }
    }

    const tdSig = document.createElement("td");
    tdSig.appendChild(sigLink(it.signature));

    const tdDesc = document.createElement("td");
    tdDesc.textContent = it.description || "";
    tdDesc.className = "muted";

    tr.appendChild(tdTs);
    tr.appendChild(tdAmt);
    tr.appendChild(tdSig);
    tr.appendChild(tdDesc);
    els.burnTable.appendChild(tr);
  }
}

function updateBurnsToggleUi() {
  const btn = els.burnsViewToggle;
  if (!btn) return;
  const n = burnItems.length;
  if (n <= BURNS_PREVIEW) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  btn.textContent = showAllBurns ? "View less" : "View more";
}

function renderBurns() {
  const visible = showAllBurns ? burnItems : burnItems.slice(0, BURNS_PREVIEW);
  renderBurnRows(visible);
  updateBurnsToggleUi();
}

async function loadBurns() {
  const data = await getJson("/api/burns?limit=40");
  burnItems = data.items || [];
  showAllBurns = false;
  renderBurns();
}

function bindBurnWindowControls() {
  const customInput = document.getElementById("burnWindowCustomDays");
  const customBtn = document.getElementById("burnWindowCustomBtn");

  const commitCustomDays = async () => {
    if (!customInput) return;
    const next = clampBurnCustomDays(customInput.value);
    const changed = next !== burnCustomDays || burnWindow !== "custom";
    burnCustomDays = next;
    burnWindow = "custom";
    syncBurnCustomDaysInput();
    setBurnWindowUiActive();
    if (!changed) return;
    await loadBurnWindow();
  };

  document.querySelectorAll("[data-burn-window]").forEach((b) => {
    b.addEventListener("click", async (ev) => {
      const win = b.getAttribute("data-burn-window") || "24h";
      if (win === "custom") {
        if (ev.target === customInput) return;
        const wasCustom = burnWindow === "custom";
        burnWindow = "custom";
        burnCustomDays = clampBurnCustomDays(burnCustomDays);
        setBurnWindowUiActive();
        focusBurnCustomInput();
        if (!wasCustom) await loadBurnWindow();
        return;
      }
      burnWindow = win;
      setBurnWindowUiActive();
      await loadBurnWindow();
    });
  });

  if (customInput) {
    customInput.addEventListener("blur", () => {
      commitCustomDays().catch(() => {});
    });
    customInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        customInput.blur();
      }
    });
    customInput.addEventListener("click", (ev) => {
      ev.stopPropagation();
    });
  }

  if (customBtn && customInput) {
    customBtn.addEventListener("mousedown", (ev) => {
      if (burnWindow === "custom" && ev.target === customInput) {
        ev.preventDefault();
        customInput.focus();
      }
    });
  }
}

function bind() {
  bindBurnWindowControls();
  document.querySelectorAll("[data-trade-window]").forEach((b) => {
    b.addEventListener("click", async () => {
      tradeWindow = b.getAttribute("data-trade-window");
      setActiveButtons("data-trade-window", tradeWindow);
      await loadTradingWindow();
    });
  });
  document.querySelectorAll("[data-daily-chart-range]").forEach((b) => {
    b.addEventListener("click", () => {
      dailyBurnChartRange = b.getAttribute("data-daily-chart-range") || "30d";
      setActiveButtons("data-daily-chart-range", dailyBurnChartRange);
      applyDailyBurnChartView();
    });
  });
  if (els.burnsViewToggle) {
    els.burnsViewToggle.addEventListener("click", () => {
      showAllBurns = !showAllBurns;
      renderBurns();
    });
  }
}

async function boot() {
  bind();
  syncBurnCustomDaysInput();
  setBurnWindowUiActive();
  await loadCurrent();
  await loadBurnWindow();
  await loadTradingWindow();
  await loadBurns();
  await loadDailyBurnsChart();
}

boot().catch(() => {});

