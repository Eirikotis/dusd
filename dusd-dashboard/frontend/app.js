const fmtNum = (x, digits = 2) => {
  if (x === null || x === undefined || Number.isNaN(x)) return "N/A";
  try {
    return Number(x).toLocaleString(undefined, { maximumFractionDigits: digits });
  } catch {
    return String(x);
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
  burnWindowHint: document.getElementById("burnWindowHint"),
  tradeVolume: document.getElementById("tradeVolume"),
  tradeVolumeLabel: document.getElementById("tradeVolumeLabel"),
  priceUsd: document.getElementById("priceUsd"),
  liquidityUsd: document.getElementById("liquidityUsd"),
  priceChange: document.getElementById("priceChange"),
  liqChange: document.getElementById("liqChange"),
  burnTable: document.getElementById("burnTable"),
  statusLine: document.getElementById("statusLine"),
  refreshBurns: document.getElementById("refreshBurns"),
};

let burnWindow = "24h";
let tradeWindow = "24h";
let currentPriceUsd = null;

function fmtIso(ts) {
  if (!ts || !Number.isFinite(Number(ts))) return "—";
  return new Date(Number(ts) * 1000).toISOString().replace(".000Z", "Z");
}

function setActiveButtons(attr, value) {
  document.querySelectorAll(`button[${attr}]`).forEach((b) => {
    b.classList.toggle("is-active", b.getAttribute(attr) === value);
  });
}

function windowLabel(metrics) {
  if (!metrics) return "";
  if (metrics.has_enough_history) return "";
  return metrics.tracking_started_ts ? "Since tracking began (insufficient history for full window)" : "N/A (no tracking history yet)";
}

async function loadCurrent() {
  const cur = await getJson("/api/current");
  els.totalBurned.textContent = cur.total_burned === null ? "N/A" : `${fmtNum(cur.total_burned, 6)} DUSD`;
  els.burnedValue.textContent = cur.burned_value_usd_at_current_price === null ? "N/A" : fmtUsd(cur.burned_value_usd_at_current_price, 2);
  els.priceUsd.textContent = cur.price_usd === null ? "N/A" : fmtUsd(cur.price_usd, 8);
  els.liquidityUsd.textContent = cur.liquidity_usd === null ? "N/A" : fmtUsd(cur.liquidity_usd, 2);
  currentPriceUsd = cur.price_usd === null || cur.price_usd === undefined ? null : Number(cur.price_usd);
  if (els.currentSupply) {
    els.currentSupply.textContent = cur.current_supply === null ? "N/A" : `${fmtNum(cur.current_supply, 6)} DUSD`;
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

async function loadBurnWindow() {
  const m = await getJson(`/api/metrics?window=${encodeURIComponent(burnWindow)}`);
  if (m.burned_in_window === null) {
    els.burnWindowAmount.textContent = "N/A";
  } else {
    const amount = Number(m.burned_in_window);
    if (!Number.isFinite(amount) || currentPriceUsd === null || !Number.isFinite(currentPriceUsd)) {
      els.burnWindowAmount.textContent = `${fmtNum(m.burned_in_window, 6)} DUSD`;
    } else {
      const burnedUsd = amount * currentPriceUsd;
      const burnedUsdText = fmtNum(burnedUsd, 2);
      els.burnWindowAmount.innerHTML =
        `${fmtNum(amount, 1)} DUSD <span class="v-usd">($${burnedUsdText})</span>`;
    }
  }
  if (m.holder_change === null) {
    els.holderChange.textContent = "N/A";
    els.holderChange.className = "v";
  } else {
    const cls = m.holder_change > 0 ? "pos" : m.holder_change < 0 ? "neg" : "";
    const sign = m.holder_change > 0 ? "+" : "";
    els.holderChange.textContent = `${sign}${fmtNum(m.holder_change, 0)}`;
    els.holderChange.className = `v ${cls}`;
  }
  els.burnPerSecond.textContent =
    m.avg_burn_per_second === null ? "N/A" : `${fmtNum(m.avg_burn_per_second, 6)} DUSD/s`;
  els.timeToZero.textContent = fmtDuration(m.projected_time_to_zero_seconds);
  els.burnPctCirc.textContent =
    m.burn_as_pct_of_circulating_in_window === null ? "N/A" : fmtPct(m.burn_as_pct_of_circulating_in_window, 4);
  els.burnWindowHint.textContent = windowLabel(m);
}

async function loadTradingWindow() {
  const t = await getJson(`/api/trading?window=${encodeURIComponent(tradeWindow)}`);

  els.tradeVolume.textContent = t.volume === null ? "N/A" : fmtUsd(t.volume, 2);
  els.tradeVolumeLabel.textContent = t.volume_label || "";

  const pc = fmtDeltaPct(t.price_change_pct);
  els.priceChange.textContent = pc.text;
  els.priceChange.className = `v ${pc.cls}`;

  const lc = fmtDeltaPct(t.liquidity_change_pct);
  els.liqChange.textContent = lc.text;
  els.liqChange.className = `v ${lc.cls}`;
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

async function loadBurns() {
  const data = await getJson("/api/burns?limit=40");
  const items = data.items || [];
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

async function loadStatus() {
  try {
    const h = await getJson("/api/health");
    const seed = h.seed || {};
    const seedText =
      seed.seeded === true
        ? `seeded CSV (${seed.inserted} inserted)`
        : seed.reason === "already_seeded"
          ? "seed already done"
          : seed.reason || "seed unknown";
    els.statusLine.textContent = `Status: ${h.ok ? "OK" : "ERR"} · ${seedText} · last seen sig: ${h.last_seen_burn_signature || "—"}`;
  } catch {
    els.statusLine.textContent = "Status: API unreachable. Start the backend server.";
  }
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
  els.refreshBurns.addEventListener("click", loadBurns);
}

async function boot() {
  bind();
  await loadStatus();
  await loadCurrent();
  await loadBurnWindow();
  await loadTradingWindow();
  await loadBurns();
  setInterval(loadStatus, 30_000);
}

boot().catch(async () => {
  await loadStatus();
});

