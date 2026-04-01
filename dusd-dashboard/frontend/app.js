const fmtNum = (x, digits = 2) => {
  if (x === null || x === undefined || Number.isNaN(x)) return "N/A";
  try {
    return Number(x).toLocaleString(undefined, { maximumFractionDigits: digits });
  } catch {
    return String(x);
  }
};

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
let tradeWindow = "24h";
let currentPriceUsd = null;
/** Full list from API; rendering uses slice when collapsed. */
let burnItems = [];
let showAllBurns = false;
const BURNS_PREVIEW = 8;

/** Plot geometry for daily burn chart hover (desktop). */
let dailyBurnPlotState = null;

function fmtChartAxisY(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0";
  const a = Math.abs(x);
  if (a >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(x / 1e3).toFixed(2)}K`;
  return fmtNum(x, x >= 100 ? 0 : 2);
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
    tip.textContent = `${formatDayLabel(p.day)} · ${fmtNum(p.v, 4)} DUSD`;
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
  svg.innerHTML = "";

  const raw = Array.isArray(points) ? points : [];
  const cleaned = raw
    .map((p) => ({
      day: p.day,
      v: p.total_ui == null ? NaN : Number(p.total_ui),
    }))
    .filter((p) => p.day && Number.isFinite(p.v));

  if (!cleaned.length) {
    return;
  }

  const W = 800;
  const H = 240;
  const padL = 54;
  const padR = 14;
  const padT = 12;
  const padB = 40;
  const gw = W - padL - padR;
  const gh = H - padT - padB;
  const maxV = Math.max(...cleaned.map((p) => p.v), 1e-12);
  const minV = 0;
  const n = cleaned.length;
  const xs = cleaned.map((_, i) => (n === 1 ? padL + gw / 2 : padL + (gw * i) / (n - 1)));
  const ys = cleaned.map((p) => padT + gh - ((p.v - minV) / (maxV - minV)) * gh * 0.92);

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
  filter.setAttribute("id", "dailyBurnGlow");
  filter.setAttribute("x", "-25%");
  filter.setAttribute("y", "-25%");
  filter.setAttribute("width", "150%");
  filter.setAttribute("height", "150%");
  const blur = document.createElementNS("http://www.w3.org/2000/svg", "feGaussianBlur");
  blur.setAttribute("in", "SourceGraphic");
  blur.setAttribute("stdDeviation", "2");
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

  const xLabels = [[xs[0], cleaned[0].day]];
  if (n > 2) {
    const mid = Math.floor(n / 2);
    xLabels.push([xs[mid], cleaned[mid].day]);
  }
  if (n > 1) {
    xLabels.push([xs[n - 1], cleaned[n - 1].day]);
  }
  for (const [lx, dayStr] of xLabels) {
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("x", String(lx));
    t.setAttribute("y", String(H - 10));
    t.setAttribute("fill", tickColor);
    t.setAttribute("font-size", "11");
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-family", "system-ui, Segoe UI, sans-serif");
    t.textContent = formatDayLabel(dayStr);
    svg.appendChild(t);
  }

  const yticks = [minV, maxV * 0.5, maxV];
  yticks.forEach((yv, i) => {
    const ly = padT + gh - ((yv - minV) / (maxV - minV)) * gh * 0.92;
    const yt = document.createElementNS("http://www.w3.org/2000/svg", "text");
    yt.setAttribute("x", String(padL - 8));
    yt.setAttribute("y", String(ly + 4));
    yt.setAttribute("fill", tickColor);
    yt.setAttribute("font-size", "11");
    yt.setAttribute("text-anchor", "end");
    yt.setAttribute("font-family", "system-ui, Segoe UI, sans-serif");
    yt.textContent = fmtChartAxisY(yv);
    svg.appendChild(yt);
  });

  const lineD = buildDailyBurnLinePath(xs, ys);
  const glowPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  glowPath.setAttribute("d", lineD);
  glowPath.setAttribute("fill", "none");
  glowPath.setAttribute("stroke", "#ff5a14");
  glowPath.setAttribute("stroke-width", "5");
  glowPath.setAttribute("stroke-linecap", "round");
  glowPath.setAttribute("stroke-linejoin", "round");
  glowPath.setAttribute("opacity", "0.35");
  glowPath.setAttribute("filter", "url(#dailyBurnGlow)");
  svg.appendChild(glowPath);

  const linePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  linePath.setAttribute("d", lineD);
  linePath.setAttribute("fill", "none");
  linePath.setAttribute("stroke", "#ff5a14");
  linePath.setAttribute("stroke-width", "2.25");
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
    const data = await getJson("/api/burns/daily?days=90");
    renderDailyBurnChart(data.points);
  } catch {
    renderDailyBurnChart([]);
  }
}

function fmtIso(ts) {
  if (!ts || !Number.isFinite(Number(ts))) return "—";
  return new Date(Number(ts) * 1000).toISOString().replace(".000Z", "Z");
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
    els.lastUpdatedPill.textContent = `last updated: ${fmtIso(cur.captured_at_ts)}`;
  }
  return cur;
}

function fmtUsdBurnWindow(amountUsd) {
  const n = Number(amountUsd);
  if (!Number.isFinite(n)) return "N/A";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadBurnWindow() {
  const m = await getJson(`/api/metrics?window=${encodeURIComponent(burnWindow)}`);
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

  const volMain = t.volume === null || t.volume === undefined ? "N/A" : fmtUsd(t.volume, 2);
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
    tdTs.textContent = it.datetime_utc || (it.timestamp ? new Date(it.timestamp * 1000).toISOString() : "—");

    const tdAmt = document.createElement("td");
    tdAmt.textContent = it.amount_ui === null ? "—" : fmtNum(it.amount_ui, 6);

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

function bind() {
  document.querySelectorAll("[data-burn-window]").forEach((b) => {
    b.addEventListener("click", async () => {
      burnWindow = b.getAttribute("data-burn-window");
      setActiveButtons("data-burn-window", burnWindow);
      await loadBurnWindow();
    });
  });
  document.querySelectorAll("[data-trade-window]").forEach((b) => {
    b.addEventListener("click", async () => {
      tradeWindow = b.getAttribute("data-trade-window");
      setActiveButtons("data-trade-window", tradeWindow);
      await loadTradingWindow();
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
  await loadCurrent();
  await loadBurnWindow();
  await loadTradingWindow();
  await loadBurns();
  await loadDailyBurnsChart();
}

boot().catch(() => {});

