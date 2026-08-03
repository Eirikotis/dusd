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
  totalBurnedMirror: document.getElementById("totalBurnedMirror"),
  burnEstimateStatus: document.getElementById("burnEstimateStatus"),
  burnedValue: document.getElementById("burnedValue"),
  currentSupply: document.getElementById("currentSupply"),
  currentSupplyMirror: document.getElementById("currentSupplyMirror"),
  supplyEstimateStatus: document.getElementById("supplyEstimateStatus"),
  priceMultiple: document.getElementById("priceMultiple"),
  burnedPctMirror: document.getElementById("burnedPctMirror"),
  totalBurnedBar: document.getElementById("totalBurnedBar"),
  currentSupplyBar: document.getElementById("currentSupplyBar"),
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
const liveBurnEstimate = {
  baseBurned: null,
  baseSupply: null,
  burnPerSecond: null,
  anchoredAtMs: null,
  renderTimer: null,
  refreshTimer: null,
};
/** Full list from API; rendering uses slice when collapsed. */
let burnItems = [];
let showAllBurns = false;
const BURNS_PREVIEW = 8;

/** Calendar days excluded only from Daily Burn chart display (e.g. single-day outlier). */
const DAILY_BURN_CHART_EXCLUDED_DAYS = new Set(["2026-03-10"]);

/** Plot geometry for the shared burn and price chart hover. */
let dailyBurnPlotState = null;

/** Raw API rows; chart mode and range controls derive non-mutating views. */
let dailyBurnPointsRaw = [];
/** daily | cumulative | price */
let dailyChartMode = "daily";
/** 30d | 90d | all */
let dailyBurnChartRange = "30d";

const DAILY_CHART_MODE_CONFIG = {
  daily: { key: "total_ui", color: "#ff5a14" },
  cumulative: { key: "cumulative_ui", color: "#ff8b45" },
  price: { key: "price_usd", color: "#35e66f" },
};

let scarcityData = null;
let scarcityMode = "indexed";
let scarcityChartGeometry = null;
let scarcityClockTimer = null;
let scarcityDataRefreshTimer = null;
let scarcityBootstrapRetryTimer = null;
let scarcityBootstrapRetryDelayMs = 2_000;
const scarcityPageOpenedAt = Date.now();
const SCARCITY_COLORS = {
  DUSD: "#ff8b45",
  BTC: "#e6ece5",
  GOLD: "#d6a34b",
  M2: "#35e66f",
};
function buildDailyChartSeries(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  let cumulative = 0;
  return arr
    .map((p) => ({
      day: p.day,
      total_ui: p.total_ui == null ? 0 : Number(p.total_ui),
      cumulative_ui: p.cumulative_ui == null ? NaN : Number(p.cumulative_ui),
      price_usd: p.price_usd == null ? NaN : Number(p.price_usd),
    }))
    .filter((p) => p.day && Number.isFinite(p.total_ui))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .map((p) => {
      cumulative += p.total_ui;
      return {
        ...p,
        cumulative_ui: Number.isFinite(p.cumulative_ui) ? p.cumulative_ui : cumulative,
      };
    });
}

/** Calendar-day slice inclusive, ending at the latest available day. */
function sliceDailyChartLastDays(points, dayCount) {
  if (!points.length) return points;
  const lastDay = points[points.length - 1].day;
  const [y, m, d] = lastDay.split("-").map(Number);
  if (!y || !m || !d) return points;
  const endMs = Date.UTC(y, m - 1, d);
  const startMs = endMs - (dayCount - 1) * 86400000;
  return points.filter((p) => {
    const [py, pm, pd] = p.day.split("-").map(Number);
    if (!py || !pm || !pd) return false;
    const t = Date.UTC(py, pm - 1, pd);
    return t >= startMs && t <= endMs;
  });
}

function applyDailyBurnChartView() {
  const config = DAILY_CHART_MODE_CONFIG[dailyChartMode] || DAILY_CHART_MODE_CONFIG.daily;
  let points = buildDailyChartSeries(dailyBurnPointsRaw).filter((p) =>
    Number.isFinite(Number(p[config.key])),
  );
  if (dailyChartMode === "daily") {
    points = points.filter((p) => !DAILY_BURN_CHART_EXCLUDED_DAYS.has(p.day));
  }
  if (dailyBurnChartRange !== "all") {
    points = sliceDailyChartLastDays(points, dailyBurnChartRange === "90d" ? 90 : 30);
  }

  const panel = document.querySelector(".chart-panel[data-chart-mode]");
  if (panel) panel.setAttribute("data-chart-mode", dailyChartMode);
  renderDailyBurnChart(points.map((p) => ({ day: p.day, total_ui: Number(p[config.key]) })));
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

function fmtChartAxisYPrice(v) {
  const x = Number(v);
  if (!Number.isFinite(x) || x === 0) return "$0";
  if (Math.abs(x) >= 1) return "$" + x.toFixed(2).replace(/\.?0+$/, "");
  const decimals = Math.min(8, Math.max(2, Math.ceil(-Math.log10(Math.abs(x))) + 2));
  return "$" + x.toFixed(decimals).replace(/\.?0+$/, "");
}

function formatDailyChartValue(v, mode) {
  return mode === "price" ? fmtUsd(v, 8) : fmtNum(v, mode === "daily" ? 4 : 1) + " DUSD";
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
    tip.textContent = formatCalendarDayUk(p.day) + " / " + formatDailyChartValue(p.v, dailyBurnPlotState.mode);
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
  const chartConfig = DAILY_CHART_MODE_CONFIG[dailyChartMode] || DAILY_CHART_MODE_CONFIG.daily;
  const chartColor = chartConfig.color;
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
  const rawMaxV = Math.max(...cleaned.map((p) => p.v), 1e-12);
  const rawMinV = Math.min(...cleaned.map((p) => p.v));
  const priceSpread = Math.max(rawMaxV - rawMinV, rawMaxV * 0.08, 1e-12);
  const minV = dailyChartMode === "price" ? Math.max(0, rawMinV - priceSpread * 0.15) : 0;
  const yScaleMax =
    dailyChartMode === "price"
      ? rawMaxV + priceSpread * 0.15
      : narrowMobile
        ? rawMaxV * 1.06
        : rawMaxV;
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

  const yTickFractions = [0, 0.25, 0.5, 0.75, 1];
  const yticks =
    dailyChartMode === "price"
      ? yTickFractions.map((fraction) => minV + fraction * (yScaleMax - minV))
      : uniqueSortedYTicks(yScaleMax, yTickFractions);
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
    yt.textContent = dailyChartMode === "price" ? fmtChartAxisYPrice(yv) : fmtChartAxisYBurn(yv);
    svg.appendChild(yt);
  });

  const lineStroke = narrowMobile ? 2.65 : compact ? 2.75 : 2.35;
  const glowStroke = narrowMobile ? 3.6 : compact ? 3.75 : 3.4;
  const lineD = buildDailyBurnLinePath(xs, ys);
  const glowPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  glowPath.setAttribute("d", lineD);
  glowPath.setAttribute("fill", "none");
  glowPath.setAttribute("stroke", chartColor);
  glowPath.setAttribute("stroke-width", String(glowStroke));
  glowPath.setAttribute("stroke-linecap", "round");
  glowPath.setAttribute("stroke-linejoin", "round");
  glowPath.setAttribute("opacity", "0.14");
  glowPath.setAttribute("filter", "url(#dailyBurnGlow)");
  svg.appendChild(glowPath);

  const linePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  linePath.setAttribute("d", lineD);
  linePath.setAttribute("fill", "none");
  linePath.setAttribute("stroke", chartColor);
  linePath.setAttribute("stroke-width", String(lineStroke));
  linePath.setAttribute("stroke-linecap", "round");
  linePath.setAttribute("stroke-linejoin", "round");
  svg.appendChild(linePath);

  dailyBurnPlotState = {
    mode: dailyChartMode,
    pts: cleaned.map((p, i) => ({ day: p.day, v: p.v, x: xs[i], y: ys[i] })),
  };
  setupDailyBurnInteractions();
}

async function loadDailyBurnsChart() {
  if (!document.getElementById("dailyBurnSvg")) return;
  try {
    const data = await getJson("/api/burns/daily?days=10000");
    dailyBurnPointsRaw = data.points || [];
  } catch {
    dailyBurnPointsRaw = [];
  }
  setActiveButtons("data-daily-chart-mode", dailyChartMode);
  setActiveButtons("data-daily-chart-range", dailyBurnChartRange);
  applyDailyBurnChartView();
}

function setActiveButtons(attr, value) {
  document.querySelectorAll(`button[${attr}]`).forEach((b) => {
    const active = b.getAttribute(attr) === value;
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-selected", String(active));
  });
}

function applyCurrent(cur) {
  const totalBurnedText = cur.total_burned === null ? "N/A" : `${fmtNumFixed1(cur.total_burned)} DUSD`;
  els.totalBurned.textContent = totalBurnedText;
  if (els.totalBurnedMirror) els.totalBurnedMirror.textContent = totalBurnedText;
  els.burnedValue.textContent = cur.burned_value_usd_at_current_price === null ? "N/A" : fmtUsdFixed1(cur.burned_value_usd_at_current_price);
  els.priceUsd.textContent = cur.price_usd === null ? "N/A" : fmtUsd(cur.price_usd, 8);
  els.liquidityUsd.textContent = cur.liquidity_usd === null ? "N/A" : fmtUsd(cur.liquidity_usd, 2);
  currentPriceUsd = cur.price_usd === null || cur.price_usd === undefined ? null : Number(cur.price_usd);
  if (els.priceMultiple) {
    const price = cur.price_usd == null ? NaN : Number(cur.price_usd);
    els.priceMultiple.textContent = Number.isFinite(price) && price > 0 ? `${fmtNumFixed1(1 / price)}x` : "N/A";
  }
  if (els.currentSupply) {
    const currentSupplyText = cur.current_supply === null ? "N/A" : `${fmtNumFixed1(cur.current_supply)} DUSD`;
    els.currentSupply.textContent = currentSupplyText;
    if (els.currentSupplyMirror) els.currentSupplyMirror.textContent = currentSupplyText;
  }

  const pct = cur.burned_pct_of_original === null ? null : Number(cur.burned_pct_of_original);
  const burnedPctText = pct === null || Number.isNaN(pct) ? "—" : `${fmtNum(pct, 2)}%`;
  if (els.burnedPctMirror) {
    els.burnedPctMirror.textContent = burnedPctText;
  }
  setCoreSupplyBars(Number.isFinite(pct) ? pct : NaN);
  if (pct !== null && Number.isFinite(pct) && els.supplyRing) {
    const clamped = Math.max(0, Math.min(100, pct));
    els.supplyRing.style.setProperty("--burnedPct", `${clamped}%`);
  }
  if (els.lastUpdatedPill) {
    els.lastUpdatedPill.textContent = `SYNC / ${fmtTimestampDual(cur.captured_at_ts)}`;
  }
  return cur;
}

function formatEstimatedDusd(value) {
  if (!Number.isFinite(value)) return "N/A";
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} DUSD`;
}

function setCoreSupplyBars(burnedPct) {
  if (!Number.isFinite(burnedPct)) {
    if (els.totalBurnedBar) els.totalBurnedBar.style.setProperty("--barPct", "0%");
    if (els.currentSupplyBar) els.currentSupplyBar.style.setProperty("--barPct", "0%");
    return;
  }
  const burned = Math.max(0, Math.min(100, burnedPct));
  const remaining = Math.max(0, Math.min(100, 100 - burned));
  if (els.totalBurnedBar) els.totalBurnedBar.style.setProperty("--barPct", `${burned}%`);
  if (els.currentSupplyBar) els.currentSupplyBar.style.setProperty("--barPct", `${remaining}%`);
}

function setEstimateIndicators(active) {
  if (els.burnEstimateStatus) els.burnEstimateStatus.hidden = !active;
  if (els.supplyEstimateStatus) els.supplyEstimateStatus.hidden = !active;
  els.totalBurned?.closest(".stat-cell")?.classList.toggle("is-estimating", active);
  els.currentSupply?.closest(".stat-cell")?.classList.toggle("is-estimating", active);
}

function deactivateLiveBurnEstimate() {
  liveBurnEstimate.baseBurned = null;
  liveBurnEstimate.baseSupply = null;
  liveBurnEstimate.burnPerSecond = null;
  liveBurnEstimate.anchoredAtMs = null;
  setEstimateIndicators(false);
}

function renderLiveBurnEstimate() {
  const { baseBurned, baseSupply, burnPerSecond, anchoredAtMs } = liveBurnEstimate;
  if (
    !Number.isFinite(baseBurned) ||
    !Number.isFinite(baseSupply) ||
    !Number.isFinite(burnPerSecond) ||
    burnPerSecond <= 0 ||
    !Number.isFinite(anchoredAtMs)
  ) {
    return;
  }

  const elapsedSeconds = Math.max(0, (Date.now() - anchoredAtMs) / 1000);
  const estimatedBurn = Math.min(baseSupply, burnPerSecond * elapsedSeconds);
  const burnedNow = baseBurned + estimatedBurn;
  const supplyNow = Math.max(0, baseSupply - estimatedBurn);
  const originalSupply = baseBurned + baseSupply;
  const burnedPctNow = originalSupply > 0 ? (burnedNow / originalSupply) * 100 : NaN;
  const burnedText = formatEstimatedDusd(burnedNow);
  const supplyText = formatEstimatedDusd(supplyNow);

  els.totalBurned.textContent = burnedText;
  if (els.currentSupply) els.currentSupply.textContent = supplyText;
  setCoreSupplyBars(burnedPctNow);
}

function anchorLiveBurnEstimate(current, metrics30d) {
  const baseBurned = current?.total_burned == null ? NaN : Number(current.total_burned);
  const baseSupply = current?.current_supply == null ? NaN : Number(current.current_supply);
  const burnPerSecond =
    metrics30d?.avg_burn_per_second == null ? NaN : Number(metrics30d.avg_burn_per_second);
  const active =
    Number.isFinite(baseBurned) &&
    Number.isFinite(baseSupply) &&
    baseSupply > 0 &&
    Number.isFinite(burnPerSecond) &&
    burnPerSecond > 0;

  if (!active) {
    deactivateLiveBurnEstimate();
    return;
  }
  liveBurnEstimate.baseBurned = baseBurned;
  liveBurnEstimate.baseSupply = baseSupply;
  liveBurnEstimate.burnPerSecond = burnPerSecond;
  liveBurnEstimate.anchoredAtMs = Date.now();
  setEstimateIndicators(true);
  renderLiveBurnEstimate();
}

async function refreshLiveBurnEstimate() {
  try {
    const [current, metrics30d] = await Promise.all([
      getJson("/api/current"),
      getJson("/api/metrics?window=30d"),
    ]);
    applyCurrent(current);
    anchorLiveBurnEstimate(current, metrics30d);
  } catch {
    deactivateLiveBurnEstimate();
  }
}

function startLiveBurnEstimate() {
  if (liveBurnEstimate.renderTimer === null) {
    const renderEveryMs = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1000 : 100;
    liveBurnEstimate.renderTimer = window.setInterval(() => {
      if (!document.hidden) renderLiveBurnEstimate();
    }, renderEveryMs);
  }
  if (liveBurnEstimate.refreshTimer === null) {
    liveBurnEstimate.refreshTimer = window.setInterval(refreshLiveBurnEstimate, 60_000);
  }
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
    return `<span class="metric-inline-chg metric-inline-chg--na">N/A</span>`;
  }
  const n = Number(pct);
  const abs = Math.abs(n);
  const num = abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const direction = n > 0 ? "▲" : n < 0 ? "▼" : "•";
  const signed = (n > 0 ? "+" : n < 0 ? "-" : "") + num + "%";
  const state = n > 0 ? "pos" : n < 0 ? "neg" : "flat";
  return `<span class="metric-inline-chg metric-inline-chg--${state}"><span aria-hidden="true">${direction}</span>${signed}</span>`;
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

function scarcitySvgNode(name, attrs = {}, text = null) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (text !== null) node.textContent = text;
  return node;
}

function scarcityValueLabel(asset, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  if (asset === "DUSD") return `${fmtNum(n, 1)} DUSD`;
  if (asset === "BTC") return `${fmtNum(n, 3)} BTC`;
  if (asset === "GOLD") return `${fmtNum(n, 1)} t`;
  if (asset === "M2") return `$${fmtNum(n / 1000, 3)}T`;
  return fmtNum(n, 2);
}

function scarcitySigned(value, digits = 2, suffix = "%") {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}${suffix}`;
}

function scarcityDateMs(day) {
  const [year, month, dateNum] = String(day).split("-").map(Number);
  return Date.UTC(year, month - 1, dateNum);
}

function renderScarcityLegend() {
  const legend = document.getElementById("scarcityLegend");
  if (!legend || !scarcityData) return;
  legend.innerHTML = "";
  scarcityData.series.forEach((series) => {
    const item = document.createElement("span");
    item.style.setProperty("--series-color", SCARCITY_COLORS[series.asset]);
    const quality =
      series.asset === "M2" ? "MONTHLY / STEP" : series.quality === "estimated" ? "ESTIMATED" : "OBSERVED";
    item.innerHTML = `<i></i>${series.label}<small>${quality}</small>`;
    legend.appendChild(item);
  });
}

function renderScarcityIndexed() {
  const svg = document.getElementById("scarcitySvg");
  const body = svg?.closest(".scarcity-chart-body");
  if (!svg || !body || !scarcityData?.series?.length) return;

  const width = Math.max(340, Math.round(body.clientWidth - 4));
  const compact = width < 620;
  const height = compact ? 292 : 350;
  const margin = { top: 16, right: compact ? 10 : 20, bottom: 34, left: compact ? 42 : 54 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = "";

  const allPoints = scarcityData.series.flatMap((series) => series.points || []);
  const allIndexes = allPoints.map((point) => Number(point.index)).filter(Number.isFinite);
  if (!allIndexes.length) return;
  const rawMin = Math.min(...allIndexes);
  const rawMax = Math.max(...allIndexes);
  let yMin = Math.floor(rawMin - 0.75);
  let yMax = Math.ceil(rawMax + 0.75);
  if (yMax - yMin < 4) {
    const mid = (yMax + yMin) / 2;
    yMin = mid - 2;
    yMax = mid + 2;
  }

  const startMs = scarcityDateMs(scarcityData.window.start);
  const endMs = scarcityDateMs(scarcityData.window.end);
  const spanMs = Math.max(86_400_000, endMs - startMs);
  const xFor = (day) => margin.left + ((scarcityDateMs(day) - startMs) / spanMs) * plotW;
  const yFor = (value) => margin.top + ((yMax - Number(value)) / (yMax - yMin)) * plotH;

  for (let i = 0; i <= 4; i++) {
    const value = yMin + ((yMax - yMin) * i) / 4;
    const y = yFor(value);
    svg.appendChild(
      scarcitySvgNode("line", {
        x1: margin.left,
        y1: y,
        x2: width - margin.right,
        y2: y,
        stroke: Math.abs(value - 100) < 0.01 ? "rgba(255,104,28,.28)" : "rgba(255,255,255,.075)",
        "stroke-width": Math.abs(value - 100) < 0.01 ? 1.2 : 1,
        "stroke-dasharray": Math.abs(value - 100) < 0.01 ? "4 5" : "0",
      }),
    );
    svg.appendChild(
      scarcitySvgNode(
        "text",
        { x: margin.left - 8, y: y + 3, fill: "#707a70", "font-size": 8, "text-anchor": "end" },
        value.toFixed(1),
      ),
    );
  }

  const xLabels = [
    scarcityData.window.start,
    new Date(startMs + spanMs / 2).toISOString().slice(0, 10),
    scarcityData.window.end,
  ];
  xLabels.forEach((day, index) => {
    const x = xFor(day);
    svg.appendChild(
      scarcitySvgNode(
        "text",
        {
          x,
          y: height - 9,
          fill: "#707a70",
          "font-size": 8,
          "text-anchor": index === 0 ? "start" : index === 2 ? "end" : "middle",
        },
        formatDayLabel(day).toUpperCase(),
      ),
    );
  });

  const plotted = [];
  scarcityData.series.forEach((series) => {
    const points = (series.points || []).filter((point) => Number.isFinite(Number(point.index)));
    if (!points.length) return;
    const coords = points.map((point) => ({ ...point, x: xFor(point.date), y: yFor(point.index) }));
    let path = `M ${coords[0].x} ${coords[0].y}`;
    for (let i = 1; i < coords.length; i++) {
      if (series.asset === "M2") path += ` H ${coords[i].x} V ${coords[i].y}`;
      else path += ` L ${coords[i].x} ${coords[i].y}`;
    }
    svg.appendChild(
      scarcitySvgNode("path", {
        d: path,
        fill: "none",
        stroke: SCARCITY_COLORS[series.asset],
        "stroke-width": series.asset === "DUSD" ? 2.4 : 1.6,
        "stroke-dasharray": series.asset === "GOLD" ? "6 5" : "0",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        opacity: series.asset === "DUSD" ? 1 : 0.83,
      }),
    );
    const last = coords[coords.length - 1];
    svg.appendChild(
      scarcitySvgNode("circle", {
        cx: last.x,
        cy: last.y,
        r: series.asset === "DUSD" ? 3.5 : 2.5,
        fill: SCARCITY_COLORS[series.asset],
      }),
    );
    plotted.push({ ...series, coords });
  });

  const hoverLine = scarcitySvgNode("line", {
    x1: margin.left,
    y1: margin.top,
    x2: margin.left,
    y2: height - margin.bottom,
    stroke: "rgba(255,255,255,.28)",
    "stroke-width": 1,
    "stroke-dasharray": "3 4",
    opacity: 0,
  });
  svg.appendChild(hoverLine);
  scarcityChartGeometry = { width, height, margin, plotW, startMs, spanMs, plotted, hoverLine };
}

function setupScarcityChartInteractions() {
  const svg = document.getElementById("scarcitySvg");
  const body = svg?.closest(".scarcity-chart-body");
  const tooltip = document.getElementById("scarcityTooltip");
  if (!svg || !body || !tooltip || body.dataset.scarcityBound === "1") return;
  body.dataset.scarcityBound = "1";

  body.addEventListener("pointermove", (event) => {
    if (!scarcityChartGeometry?.plotted?.length) return;
    const geometry = scarcityChartGeometry;
    const rect = svg.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * geometry.width;
    const clampedX = Math.max(geometry.margin.left, Math.min(geometry.width - geometry.margin.right, svgX));
    const targetMs = geometry.startMs + ((clampedX - geometry.margin.left) / geometry.plotW) * geometry.spanMs;
    const rows = geometry.plotted.map((series) => {
      let nearest = series.coords[0];
      let nearestDistance = Infinity;
      series.coords.forEach((point) => {
        const distance = Math.abs(scarcityDateMs(point.date) - targetMs);
        if (distance < nearestDistance) {
          nearest = point;
          nearestDistance = distance;
        }
      });
      return { series, point: nearest };
    });
    if (!rows.length) return;
    const dateLabel = rows[0].point.date;
    geometry.hoverLine.setAttribute("x1", clampedX);
    geometry.hoverLine.setAttribute("x2", clampedX);
    geometry.hoverLine.setAttribute("opacity", "1");
    tooltip.innerHTML =
      `<strong>${formatCalendarDayUk(dateLabel)}</strong>` +
      rows
        .map(({ series, point }) => {
          const change = Number(point.index) - 100;
          return `<span><i style="color:${SCARCITY_COLORS[series.asset]}">${series.label}</i><b>${Number(point.index).toFixed(2)} / ${scarcityValueLabel(series.asset, point.value)} / ${scarcitySigned(change)}</b></span>`;
        })
        .join("");
    const bodyRect = body.getBoundingClientRect();
    tooltip.style.left = `${Math.max(105, Math.min(bodyRect.width - 105, event.clientX - bodyRect.left))}px`;
    tooltip.style.top = `${Math.max(82, event.clientY - bodyRect.top)}px`;
    tooltip.hidden = false;
  });
  body.addEventListener("pointerleave", () => {
    tooltip.hidden = true;
    if (scarcityChartGeometry?.hoverLine) scarcityChartGeometry.hoverLine.setAttribute("opacity", "0");
  });
}

function renderScarcityGrowth() {
  const root = document.getElementById("scarcityGrowthBars");
  if (!root || !scarcityData?.growth) return;
  root.innerHTML = "";
  const maxAbs = Math.max(0.01, ...scarcityData.growth.map((row) => Math.abs(Number(row.change_pct) || 0)));
  scarcityData.growth.forEach((row) => {
    const value = Number(row.change_pct);
    const width = Math.min(49, (Math.abs(value) / maxAbs) * 47);
    const element = document.createElement("div");
    element.className = "growth-row";
    element.style.setProperty("--series-color", SCARCITY_COLORS[row.asset]);
    element.innerHTML = `
      <div class="growth-row-label"><strong>${row.label}</strong><small>${scarcityValueLabel(row.asset, row.end_value)}</small></div>
      <div class="growth-track"><i class="growth-fill ${value < 0 ? "is-negative" : "is-positive"}" style="width:${width}%"></i></div>
      <div class="growth-value ${value < 0 ? "neg" : value > 0 ? "pos" : ""}">${scarcitySigned(value)}</div>
    `;
    root.appendChild(element);
  });
}

function renderScarcityRatio() {
  const ratio = scarcityData?.ratio;
  const value = document.getElementById("scarcityRatioValue");
  const change = document.getElementById("scarcityRatioChange");
  const annual = document.getElementById("scarcityRatioAnnual");
  const period = document.getElementById("scarcityRatioPeriod");
  const svg = document.getElementById("scarcityRatioSvg");
  const wrap = svg?.closest(".ratio-chart-wrap");
  if (!ratio || !svg || !value || !change || !annual || !period) return;
  value.textContent = Number.isFinite(Number(ratio.current)) ? `${fmtNum(Number(ratio.current), 2)}M DUSD / $1T` : "--";
  const delta = Number(ratio.change_pct);
  change.textContent = scarcitySigned(delta);
  change.className = delta < 0 ? "neg" : delta > 0 ? "pos" : "";
  const annualized = Number(ratio.annualized_change_pct);
  annual.textContent = scarcitySigned(annualized);
  annual.className = annualized < 0 ? "neg" : annualized > 0 ? "pos" : "";
  period.textContent = `TRACKED / ${Number(ratio.period_days) || scarcityData.window.days}D`;

  const points = (ratio.points || []).filter((point) => Number.isFinite(Number(point.value)));
  svg.innerHTML = "";
  if (points.length < 2) return;
  const W = Math.max(300, Math.round((wrap?.clientWidth || 620) - 2));
  const H = 166;
  const compact = W < 520;
  const margin = { top: 12, right: 8, bottom: 27, left: compact ? 40 : 50 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const values = points.map((point) => Number(point.value));
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const rawSpan = Math.max(0.001, rawMax - rawMin);
  const min = rawMin - rawSpan * 0.08;
  const max = rawMax + rawSpan * 0.08;
  const span = max - min;
  const coords = points.map((point, index) => ({
    x: margin.left + (index / (points.length - 1)) * plotW,
    y: margin.top + ((max - Number(point.value)) / span) * plotH,
  }));

  for (let i = 0; i < 4; i++) {
    const tickValue = min + (span * i) / 3;
    const y = margin.top + ((max - tickValue) / span) * plotH;
    svg.appendChild(
      scarcitySvgNode("line", {
        x1: margin.left,
        y1: y,
        x2: W - margin.right,
        y2: y,
        stroke: "rgba(255,255,255,.075)",
        "stroke-width": 1,
      }),
    );
    svg.appendChild(
      scarcitySvgNode(
        "text",
        {
          x: margin.left - 7,
          y: y + 3,
          fill: "#707a70",
          "font-size": 8,
          "text-anchor": "end",
        },
        `${tickValue.toFixed(2)}M`,
      ),
    );
  }

  const datePoints = [points[0], points[Math.floor((points.length - 1) / 2)], points[points.length - 1]];
  datePoints.forEach((point, index) => {
    const x = margin.left + ([0, 0.5, 1][index] || 0) * plotW;
    svg.appendChild(
      scarcitySvgNode(
        "text",
        {
          x,
          y: H - 7,
          fill: "#707a70",
          "font-size": 8,
          "text-anchor": index === 0 ? "start" : index === 2 ? "end" : "middle",
        },
        formatDayLabel(point.date).toUpperCase(),
      ),
    );
  });

  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const area = `${line} L ${coords[coords.length - 1].x} ${H - margin.bottom} L ${coords[0].x} ${H - margin.bottom} Z`;
  svg.appendChild(scarcitySvgNode("path", { d: area, fill: "rgba(255,104,28,.065)" }));
  svg.appendChild(
    scarcitySvgNode("path", {
      d: line,
      fill: "none",
      stroke: "#ff8b45",
      "stroke-width": 2,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  );
  const last = coords[coords.length - 1];
  svg.appendChild(scarcitySvgNode("circle", { cx: last.x, cy: last.y, r: 3, fill: "#ff8b45" }));
}

function formatCompactUsd(value, maximumFractionDigits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  const magnitude = Math.abs(n);
  const units = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  const unit = units.find(([threshold]) => magnitude >= threshold);
  if (unit) {
    return `$${(n / unit[0]).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits,
    })}${unit[1]}`;
  }
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatParityPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  const digits = n >= 100 ? 2 : n >= 1 ? 4 : 8;
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  })}`;
}

function formatParityMultiple(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M×`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K×`;
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}×`;
}

function scarcityHoldingsAmount() {
  const raw = document.getElementById("scarcityHoldingsInput")?.value || "";
  const value = Number(String(raw).replace(/[,\s]/g, ""));
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function formatHoldingsAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function renderScarcityHoldings() {
  const root = document.getElementById("holdingsResults");
  const scenarios = scarcityData?.market_cap?.scenarios || [];
  if (!root) return;
  const amount = scarcityHoldingsAmount();
  if (!scenarios.length) {
    root.innerHTML = '<div><span>MARKET DATA</span><strong>--</strong></div>';
    return;
  }
  root.innerHTML = scenarios
    .map(
      (scenario) => `
        <div data-asset="${scenario.asset}">
          <h4>${scenario.label}</h4>
          <small>${formatHoldingsAmount(amount)} DUSD × ${formatParityPrice(scenario.implied_dusd_price_usd)}</small>
          <strong>${formatCompactUsd(amount * Number(scenario.implied_dusd_price_usd))}</strong>
        </div>
      `,
    )
    .join("");
}

function renderScarcityParity() {
  const market = scarcityData?.market_cap;
  const capNode = document.getElementById("parityDusdMarketCap");
  const contextNode = document.getElementById("parityDusdContext");
  const scenariosNode = document.getElementById("parityScenarios");
  const updatedNode = document.getElementById("parityUpdated");
  if (!capNode || !contextNode || !scenariosNode || !updatedNode) return;

  if (!market?.current) {
    capNode.textContent = "--";
    contextNode.textContent = "CURRENT SUPPLY OR PRICE UNAVAILABLE";
    scenariosNode.innerHTML = '<div class="parity-empty">AWAITING MARKET DATA...</div>';
    renderScarcityHoldings();
    return;
  }

  capNode.textContent = formatCompactUsd(market.current.market_cap_usd);
  contextNode.innerHTML = `
    <span>CURRENT DUSD PRICE / <strong>${fmtUsd(Number(market.current.price_usd), 8)}</strong></span>
    <span>CIRCULATING SUPPLY / <strong>${fmtNum(Number(market.current.supply), 1)} DUSD</strong></span>
  `;

  const scenarios = market.scenarios || [];
  scenariosNode.innerHTML = scenarios.length
    ? scenarios
        .map(
          (scenario) => `
            <div class="parity-scenario" data-asset="${scenario.asset}">
              <span>AT ${scenario.label.toUpperCase()} SCALE</span>
              <h4>${scenario.label}</h4>
              <div class="parity-cap">${scenario.label.toUpperCase()} ${scenario.asset === "M2" ? "VALUE" : "MARKET VALUE"} / ${formatCompactUsd(scenario.market_cap_usd)}</div>
              <span class="parity-price-label">DUSD PRICE AT PARITY</span>
              <div class="parity-price">${formatParityPrice(scenario.implied_dusd_price_usd)}</div>
              <div class="parity-multiple">${formatParityMultiple(scenario.multiple_from_current)} TODAY</div>
              <div class="parity-method">${String(scenario.methodology || "").toUpperCase()}</div>
            </div>
          `,
        )
        .join("")
    : '<div class="parity-empty">AWAITING BITCOIN / GOLD MARKET DATA...</div>';

  if (market.updated_at) {
    const updated = new Date(Number(market.updated_at) * 1000);
    updatedNode.textContent = `MARKET DATA / ${updated.toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).toUpperCase()}`;
  } else {
    updatedNode.textContent = "MARKET DATA / --";
  }
  renderScarcityHoldings();
}

function scarcityClockMain(asset, value) {
  if (!Number.isFinite(value)) return "--";
  if (asset === "DUSD") return `${fmtNum(value, 1)} DUSD`;
  if (asset === "BTC") return `${value.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} BTC`;
  if (asset === "GOLD") return `${value.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} t`;
  return `$${(value / 1000).toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 6 })}T`;
}

function scarcityClockMovement(asset, value) {
  if (!Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const magnitude = Math.abs(value);
  if (asset === "DUSD") return `${sign}${fmtNum(magnitude, 1)} DUSD`;
  if (asset === "BTC") return `${sign}${magnitude.toFixed(6)} BTC`;
  if (asset === "GOLD") return `${sign}${(magnitude * 1000).toFixed(2)} kg`;
  return `${sign}$${fmtNum(magnitude * 1_000_000_000, 0)}`;
}

function renderScarcityClock() {
  if (!scarcityData?.clock) return;
  const nowMs = Date.now();
  const openSeconds = Math.max(0, (nowMs - scarcityPageOpenedAt) / 1000);
  scarcityData.clock.forEach((row) => {
    const asset = row.asset;
    const rate = Number(row.rate_per_second);
    const base = Number(row.base_value);
    const baseMs = Number(row.base_timestamp) * 1000;
    const sinceBase = Math.max(0, (nowMs - baseMs) / 1000);
    const current = base + rate * sinceBase;
    const main = document.getElementById(`clock${asset}`);
    const delta = document.getElementById(`clockDelta${asset}`);
    const rateNode = document.getElementById(`clockRate${asset}`);
    if (main) main.textContent = scarcityClockMain(asset, current);
    if (delta) delta.textContent = `SINCE OPEN / ${scarcityClockMovement(asset, rate * openSeconds)}`;
    if (rateNode) rateNode.textContent = `${scarcityClockMovement(asset, rate)} / SEC · ${String(row.calculation_window).toUpperCase()}`;
  });
}

function startScarcityClock() {
  if (scarcityClockTimer) window.clearInterval(scarcityClockTimer);
  renderScarcityClock();
  scarcityClockTimer = window.setInterval(renderScarcityClock, 100);
}

function setScarcityMode(nextMode) {
  scarcityMode = nextMode === "growth" ? "growth" : "indexed";
  document.querySelectorAll("[data-scarcity-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.getAttribute("data-scarcity-mode") === scarcityMode);
  });
  const indexed = document.getElementById("scarcityIndexedView");
  const growth = document.getElementById("scarcityGrowthView");
  if (indexed) indexed.hidden = scarcityMode !== "indexed";
  if (growth) growth.hidden = scarcityMode !== "growth";
  if (scarcityMode === "indexed") renderScarcityIndexed();
}

function renderScarcity() {
  if (!scarcityData) return;
  const windowLabel = document.getElementById("scarcityWindow");
  if (windowLabel) windowLabel.textContent = `COMMON WINDOW / ${scarcityData.window.days}D`;
  renderScarcityIndexed();
  renderScarcityGrowth();
  renderScarcityLegend();
  renderScarcityRatio();
  renderScarcityParity();
  setupScarcityChartInteractions();
  startScarcityClock();
  setScarcityMode(scarcityMode);
}

function scarcityPayloadReady(payload) {
  return (
    (payload?.series?.length || 0) >= 4 &&
    (payload?.clock?.length || 0) >= 4 &&
    (payload?.market_cap?.scenarios?.length || 0) >= 3
  );
}

function scheduleScarcityBootstrapRetry() {
  if (scarcityBootstrapRetryTimer !== null) return;
  const delay = scarcityBootstrapRetryDelayMs;
  scarcityBootstrapRetryDelayMs = Math.min(30_000, delay * 2);
  scarcityBootstrapRetryTimer = window.setTimeout(() => {
    scarcityBootstrapRetryTimer = null;
    if (!document.hidden) {
      loadScarcity().catch((error) => console.error("Scarcity bootstrap retry unavailable", error));
    } else {
      scheduleScarcityBootstrapRetry();
    }
  }, delay);
}

async function loadScarcity() {
  if (scarcityDataRefreshTimer === null) {
    scarcityDataRefreshTimer = window.setInterval(() => {
      if (!document.hidden) {
        loadScarcity().catch((error) => console.error("Scarcity refresh unavailable", error));
      }
    }, 15 * 60_000);
  }
  try {
    scarcityData = await getJson("/api/scarcity");
    renderScarcity();
    if (scarcityPayloadReady(scarcityData)) {
      if (scarcityBootstrapRetryTimer !== null) {
        window.clearTimeout(scarcityBootstrapRetryTimer);
        scarcityBootstrapRetryTimer = null;
      }
      scarcityBootstrapRetryDelayMs = 2_000;
    } else {
      scheduleScarcityBootstrapRetry();
    }
  } catch (error) {
    scheduleScarcityBootstrapRetry();
    throw error;
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
  document.querySelectorAll("[data-daily-chart-mode]").forEach((b) => {
    b.addEventListener("click", () => {
      dailyChartMode = b.getAttribute("data-daily-chart-mode") || "daily";
      setActiveButtons("data-daily-chart-mode", dailyChartMode);
      applyDailyBurnChartView();
    });
  });
  document.querySelectorAll("[data-daily-chart-range]").forEach((b) => {
    b.addEventListener("click", () => {
      dailyBurnChartRange = b.getAttribute("data-daily-chart-range") || "30d";
      setActiveButtons("data-daily-chart-range", dailyBurnChartRange);
      applyDailyBurnChartView();
    });
  });
  document.querySelectorAll("[data-scarcity-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      setScarcityMode(button.getAttribute("data-scarcity-mode"));
    });
  });
  const holdingsInput = document.getElementById("scarcityHoldingsInput");
  if (holdingsInput) {
    holdingsInput.addEventListener("input", renderScarcityHoldings);
    holdingsInput.addEventListener("blur", () => {
      holdingsInput.value = formatHoldingsAmount(scarcityHoldingsAmount());
      renderScarcityHoldings();
    });
  }
  let scarcityResizeFrame = 0;
  window.addEventListener(
    "resize",
    () => {
      if (!scarcityData || scarcityResizeFrame) return;
      scarcityResizeFrame = window.requestAnimationFrame(() => {
        scarcityResizeFrame = 0;
        if (scarcityMode === "indexed") renderScarcityIndexed();
        renderScarcityRatio();
      });
    },
    { passive: true },
  );
  if (els.burnsViewToggle) {
    els.burnsViewToggle.addEventListener("click", () => {
      showAllBurns = !showAllBurns;
      renderBurns();
    });
  }
}

function bindPointerEffects() {
  if (!window.matchMedia("(pointer: fine)").matches) return;

  const aura = document.getElementById("cursorAura");
  const surfaces = document.querySelectorAll(".interactive-surface");
  let frame = 0;
  let pointerX = window.innerWidth / 2;
  let pointerY = window.innerHeight / 3;

  const renderPointer = () => {
    frame = 0;
    document.documentElement.style.setProperty("--mx", `${pointerX}px`);
    document.documentElement.style.setProperty("--my", `${pointerY}px`);
    if (aura) {
      aura.style.left = `${pointerX}px`;
      aura.style.top = `${pointerY}px`;
    }
  };

  window.addEventListener("pointermove", (event) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (aura) aura.classList.add("is-visible");
    if (!frame) frame = window.requestAnimationFrame(renderPointer);
  }, { passive: true });

  document.documentElement.addEventListener("mouseleave", () => {
    if (aura) aura.classList.remove("is-visible");
  });

  surfaces.forEach((surface) => {
    surface.addEventListener("pointermove", (event) => {
      const rect = surface.getBoundingClientRect();
      surface.style.setProperty("--local-x", `${event.clientX - rect.left}px`);
      surface.style.setProperty("--local-y", `${event.clientY - rect.top}px`);
    }, { passive: true });
    surface.addEventListener("pointerenter", () => {
      if (aura) aura.classList.add("is-active");
    });
    surface.addEventListener("pointerleave", () => {
      if (aura) aura.classList.remove("is-active");
    });
  });
}

async function boot() {
  bind();
  bindPointerEffects();
  syncBurnCustomDaysInput();
  setBurnWindowUiActive();
  await refreshLiveBurnEstimate();
  startLiveBurnEstimate();
  await loadBurnWindow();
  await loadTradingWindow();
  await loadBurns();
  await loadDailyBurnsChart();
  await loadScarcity().catch((error) => console.error("Scarcity data unavailable", error));
}

boot().catch((error) => {
  console.error("DUSD dashboard boot failed", error);
});

