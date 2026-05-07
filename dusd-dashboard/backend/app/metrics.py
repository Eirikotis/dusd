from __future__ import annotations

import logging
import time
from collections.abc import Sequence
from typing import Any

from .clients.dexscreener import DexScreenerClient

log = logging.getLogger("dusd.metrics")


WINDOWS: dict[str, int] = {
    "24h": 24 * 3600,
    "7d": 7 * 24 * 3600,
    "30d": 30 * 24 * 3600,
}


def _hour_floor(ts: int) -> int:
    """UTC hour-aligned bucket boundary (SQLite snapshot hour_ts convention)."""

    return int(ts - (ts % 3600))


def _dex_activity_estimate_from_snapshots(
    snapshots: Sequence[dict[str, Any]],
    *,
    window_seconds: float,
    label: str = "",
) -> dict[str, Any]:
    """Estimate period totals from hourly Dex-derived rolling-*24h* fields.

    Dex store ``volume_24h`` / ``buys_24h`` / ``sells_24h`` reported at each hourly capture.
    Exact period sums would require swap-level data; absent that, approximate each rolling
    field as representative of USD volume/trade-intensity across the horizon, multiply the
    *mean* sampled value by the calendar length of the period (matching pre-existing 7d/30d UX).

    This is used only when ``window_key`` is not ``24h`` — the 24h window uses successive
    two-point rolling-24h values (current vs ~24h ago) from snapshots/live Dex.
    """
    rows = [dict(r) if not isinstance(r, dict) else r for r in snapshots]
    days = window_seconds / 86400.0
    empty = {"volume": None, "buys": None, "sells": None, "trades": None, "samples": 0}
    if not rows:
        return empty | {"explain": label or "dex_snapshot_mean_x_days_approx"}

    vols = [
        float(r["volume_24h"])
        for r in rows
        if r.get("volume_24h") is not None and _is_finite_float(r["volume_24h"])
    ]
    buy_ns = [
        float(int(r["buys_24h"]))
        for r in rows
        if r.get("buys_24h") is not None and int(r["buys_24h"] or 0) >= 0
    ]
    sell_ns = [
        float(int(r["sells_24h"]))
        for r in rows
        if r.get("sells_24h") is not None and int(r["sells_24h"] or 0) >= 0
    ]
    txn_vals: list[float] = []
    for r in rows:
        b_, s_ = r.get("buys_24h"), r.get("sells_24h")
        if b_ is None and s_ is None:
            continue
        txn_vals.append(float(int(b_ or 0) + int(s_ or 0)))

    volume_est = (sum(vols) / len(vols)) * days if vols else None
    buys_est = (sum(buy_ns) / len(buy_ns)) * days if buy_ns else None
    sells_est = (sum(sell_ns) / len(sell_ns)) * days if sell_ns else None
    trades_est = (sum(txn_vals) / len(txn_vals)) * days if txn_vals else None
    out = {
        "volume": volume_est,
        "buys": buys_est,
        "sells": sells_est,
        "trades": trades_est,
        "samples": len(rows),
        "explain": label or "dex_snapshot_mean_x_days_approx",
    }
    return out


def _fetch_snapshots_for_activity_window(
    conn, *, dusd_mint: str, period_begin_ts: int, period_until_ts_exclusive: int | None
) -> list[dict[str, Any]]:
    """Snapshots with ``hour_ts`` in [_hour_floor(period_begin), period_until_exclusive)."""

    lo = _hour_floor(period_begin_ts)
    if period_until_ts_exclusive is None:
        rows = conn.execute(
            """
            SELECT * FROM token_snapshots_hourly
            WHERE dusd_mint = ? AND hour_ts >= ?
            ORDER BY hour_ts ASC
            """,
            (dusd_mint, lo),
        ).fetchall()
    else:
        hi_ex = _hour_floor(period_until_ts_exclusive)
        rows = conn.execute(
            """
            SELECT * FROM token_snapshots_hourly
            WHERE dusd_mint = ? AND hour_ts >= ? AND hour_ts < ?
            ORDER BY hour_ts ASC
            """,
            (dusd_mint, lo, hi_ex),
        ).fetchall()
    return [dict(r) for r in rows]


def _is_finite_float(v: Any) -> bool:
    try:
        return float("-inf") < float(v) < float("inf")
    except Exception:
        return False


def _now_ts() -> int:
    return int(time.time())


def _get_latest_snapshot(conn, *, dusd_mint: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM token_snapshots_hourly WHERE dusd_mint = ? ORDER BY hour_ts DESC LIMIT 1",
        (dusd_mint,),
    ).fetchone()
    return None if row is None else dict(row)


def _snapshot_for_period_compare(
    conn, *, target_ts: int, latest_hour_ts: int, dusd_mint: str
) -> dict[str, Any] | None:
    """Newest snapshot at or before target_ts (hour-aligned), strictly older than latest_hour_ts.

    Without ``hour_ts < latest_hour_ts``, a sparse DB can return the same row as "latest" for both
    endpoints, yielding 0% price/liquidity change and a bogus holder delta.
    """
    target_hour = target_ts - (target_ts % 3600)
    row = conn.execute(
        """
        SELECT * FROM token_snapshots_hourly
        WHERE dusd_mint = ? AND hour_ts <= ? AND hour_ts < ?
        ORDER BY hour_ts DESC
        LIMIT 1
        """,
        (dusd_mint, target_hour, int(latest_hour_ts)),
    ).fetchone()
    return None if row is None else dict(row)


def _sum_burns_since(conn, since_ts: int) -> float:
    # SQLite SUM() returns NULL when no rows match; that means zero burned, not "unknown".
    row = conn.execute(
        "SELECT COALESCE(SUM(COALESCE(amount_ui, 0)), 0) AS s FROM burn_events WHERE timestamp >= ?",
        (since_ts,),
    ).fetchone()
    if row is None or row["s"] is None:
        return 0.0
    return float(row["s"])


def _tracking_start_ts(conn, *, dusd_mint: str) -> int | None:
    row = conn.execute(
        "SELECT MIN(hour_ts) AS m FROM token_snapshots_hourly WHERE dusd_mint = ?",
        (dusd_mint,),
    ).fetchone()
    return None if row is None else (int(row["m"]) if row["m"] is not None else None)


def _holder_change(conn, start_ts: int, *, dusd_mint: str) -> int | None:
    latest = _get_latest_snapshot(conn, dusd_mint=dusd_mint)
    if not latest or latest.get("hour_ts") is None:
        return None
    past = _snapshot_for_period_compare(
        conn, target_ts=start_ts, latest_hour_ts=int(latest["hour_ts"]), dusd_mint=dusd_mint
    )
    if not past:
        return None
    if latest.get("holder_count") is None or past.get("holder_count") is None:
        return None
    return int(latest["holder_count"]) - int(past["holder_count"])


def _pct_change(latest: float | None, past: float | None) -> float | None:
    if latest is None or past is None:
        return None
    if past == 0:
        return None
    return (latest - past) / past * 100.0


def _txns_sum_from_snap(row: dict[str, Any]) -> int | None:
    b, s = row.get("buys_24h"), row.get("sells_24h")
    if b is None and s is None:
        return None
    return int(b or 0) + int(s or 0)


def timeframe_metrics(conn, *, window_key: str, dusd_mint: str) -> dict[str, Any]:
    window_s = WINDOWS.get(window_key)
    if window_s is None:
        raise ValueError("invalid window")

    now = _now_ts()
    start = now - window_s

    latest = _get_latest_snapshot(conn, dusd_mint=dusd_mint) or {}
    tracking_start = _tracking_start_ts(conn, dusd_mint=dusd_mint)

    burns = _sum_burns_since(conn, start)
    holder_delta = _holder_change(conn, start, dusd_mint=dusd_mint)
    holder_count_out: int | None = None
    if latest.get("holder_count") is not None:
        holder_count_out = int(latest["holder_count"])

    supply_now = latest.get("current_supply")
    burned_pct_circ = None
    if supply_now not in (None, 0):
        burned_pct_circ = float(burns) / float(supply_now) * 100.0

    burn_per_sec = None
    if burns > 0:
        burn_per_sec = float(burns) / float(window_s)

    projected_time_to_zero_s = None
    if burn_per_sec and burn_per_sec > 0 and supply_now not in (None, 0):
        projected_time_to_zero_s = float(supply_now) / float(burn_per_sec)

    return {
        "window": window_key,
        "window_seconds": window_s,
        "since_ts": start,
        "burned_in_window": burns,
        "holder_count": holder_count_out,
        "holder_change": holder_delta,
        "avg_burn_per_second": burn_per_sec,
        "projected_time_to_zero_seconds": projected_time_to_zero_s,
        "burn_as_pct_of_circulating_in_window": burned_pct_circ,
        "tracking_started_ts": tracking_start,
        "has_enough_history": tracking_start is not None and tracking_start <= start,
    }


def trading_metrics(
    conn, *, window_key: str, dusd_mint: str, dexs: DexScreenerClient | None = None
) -> dict[str, Any]:
    window_s = WINDOWS.get(window_key)
    if window_s is None:
        raise ValueError("invalid window")

    now = _now_ts()
    start = now - window_s

    latest_row = _get_latest_snapshot(conn, dusd_mint=dusd_mint)
    latest = latest_row or {}
    tracking_start = _tracking_start_ts(conn, dusd_mint=dusd_mint)

    price_now = latest.get("price_usd")
    liq_now = latest.get("liquidity_usd")

    past: dict[str, Any] = {}
    price_then = None
    liq_then = None
    if latest_row and latest_row.get("hour_ts") is not None:
        past_row = _snapshot_for_period_compare(
            conn, target_ts=start, latest_hour_ts=int(latest_row["hour_ts"]), dusd_mint=dusd_mint
        )
        if past_row:
            past = past_row
            price_then = past.get("price_usd")
            liq_then = past.get("liquidity_usd")

    live_snap: dict[str, Any] | None = None
    if dexs is not None:
        try:
            pairs = dexs.fetch_pairs(chain_id="solana", token_address=dusd_mint)
            best = dexs.choose_best_pair_by_liquidity_usd(pairs)
            live_snap = DexScreenerClient.parse_snapshot(best) if best else None
        except Exception:
            log.exception("trading.live_dex_fetch_failed mint=%s", dusd_mint[:8])

    if live_snap is not None:
        t_live = live_snap.get("trades_24h")
        trades_24h = int(t_live) if t_live is not None else _txns_sum_from_snap(latest)
    else:
        trades_24h = _txns_sum_from_snap(latest)

    if window_key == "24h":
        if live_snap is not None:
            price_change_pct = float(live_snap.get("price_change_24h_pct") or 0)
        else:
            pc24 = latest.get("price_change_24h_pct")
            price_change_pct = float(pc24) if pc24 is not None else None
    else:
        price_change_pct = _pct_change(price_now, price_then)

    liquidity_change_pct = _pct_change(liq_now, liq_then)

    vol_24h_now = latest.get("volume_24h")
    # Activity metrics (volume/trades/buys/sells) use period-over-period rolling windows aligned to window_key.
    # Field names (`buys_24h`, …) remain legacy Dex labels; percentages follow the selected window semantics.
    est_total: float | None = None
    trades_count: float | None = None
    volume_change_pct: float | None = None
    trades_change_pct: float | None = None
    buys_change_pct: float | None = None
    sells_change_pct: float | None = None

    if window_key == "24h":
        vol_curr = (
            float(live_snap["volume_24h"])
            if live_snap is not None and live_snap.get("volume_24h") is not None
            else (float(vol_24h_now) if vol_24h_now is not None else None)
        )
        est_total = vol_curr
        buys_curr = (
            float(int(live_snap["buys_24h"]))
            if live_snap is not None and live_snap.get("buys_24h") is not None
            else (float(int(latest["buys_24h"])) if latest.get("buys_24h") is not None else None)
        )
        sells_curr = (
            float(int(live_snap["sells_24h"]))
            if live_snap is not None and live_snap.get("sells_24h") is not None
            else (float(int(latest["sells_24h"])) if latest.get("sells_24h") is not None else None)
        )
        trades_curr = float(trades_24h) if trades_24h is not None else None
        trades_count = trades_curr

        vol_prev_f = (
            float(past["volume_24h"]) if past and past.get("volume_24h") is not None else None
        )
        buys_prev_f = (
            float(int(past["buys_24h"])) if past and past.get("buys_24h") is not None else None
        )
        sells_prev_f = (
            float(int(past["sells_24h"])) if past and past.get("sells_24h") is not None else None
        )
        trades_prev_f = (
            float(_txns_sum_from_snap(past)) if past and _txns_sum_from_snap(past) is not None else None
        )

        volume_change_pct = _pct_change(vol_curr, vol_prev_f)
        trades_change_pct = _pct_change(trades_curr, trades_prev_f)
        buys_change_pct = _pct_change(buys_curr, buys_prev_f)
        sells_change_pct = _pct_change(sells_curr, sells_prev_f)
    else:
        curr_snapshots = _fetch_snapshots_for_activity_window(
            conn, dusd_mint=dusd_mint, period_begin_ts=start, period_until_ts_exclusive=None
        )
        prev_snapshots = _fetch_snapshots_for_activity_window(
            conn,
            dusd_mint=dusd_mint,
            period_begin_ts=now - (2 * window_s),
            period_until_ts_exclusive=start,
        )
        curr_act = _dex_activity_estimate_from_snapshots(
            curr_snapshots,
            window_seconds=float(window_s),
            label=f"{window_key}_current_estimate",
        )
        prev_act = _dex_activity_estimate_from_snapshots(
            prev_snapshots,
            window_seconds=float(window_s),
            label=f"{window_key}_previous_estimate",
        )
        est_total = curr_act["volume"]
        trades_count = curr_act["trades"]
        volume_change_pct = _pct_change(curr_act["volume"], prev_act["volume"])
        trades_change_pct = _pct_change(curr_act["trades"], prev_act["trades"])
        buys_change_pct = _pct_change(curr_act["buys"], prev_act["buys"])
        sells_change_pct = _pct_change(curr_act["sells"], prev_act["sells"])

    log.info(
        "trading.period window=%s latest_hour=%s anchor_hour=%s "
        "price_chg=%s liq_chg=%s vol_chg=%s trades_chg=%s buys_chg=%s sells_chg=%s "
        "trades_rolling_24h=%s volume_current_display=%s trades_current_display=%s",
        window_key,
        latest.get("hour_ts"),
        past.get("hour_ts"),
        price_change_pct,
        liquidity_change_pct,
        volume_change_pct,
        trades_change_pct,
        buys_change_pct,
        sells_change_pct,
        trades_24h,
        est_total,
        trades_count,
    )

    if live_snap is not None:
        buys_out = live_snap.get("buys_24h")
        sells_out = live_snap.get("sells_24h")
    else:
        buys_out = latest.get("buys_24h")
        sells_out = latest.get("sells_24h")

    return {
        "window": window_key,
        "window_seconds": window_s,
        "price_usd": price_now,
        "liquidity_usd": liq_now,
        "volume": est_total,
        "volume_label": None,
        "buys_24h": buys_out,
        "sells_24h": sells_out,
        "trades_24h": trades_24h,
        "price_change_pct": price_change_pct,
        # Alias for 24h window (same numeric source as price_change_pct); helps stale clients / debugging.
        "price_change_24h_pct": price_change_pct if window_key == "24h" else None,
        "liquidity_change_pct": liquidity_change_pct,
        "volume_change_pct": volume_change_pct,
        "trades_count": trades_count,
        "trades_change_pct": trades_change_pct,
        "buys_change_pct": buys_change_pct,
        "sells_change_pct": sells_change_pct,
        "dex_live": live_snap is not None,
        "tracking_started_ts": tracking_start,
        "has_enough_history": tracking_start is not None and tracking_start <= start,
    }


def current_overview(conn, *, original_supply: float, dusd_mint: str) -> dict[str, Any]:
    latest = _get_latest_snapshot(conn, dusd_mint=dusd_mint) or {}
    current_supply = latest.get("current_supply")
    total_burned = latest.get("total_burned")

    if current_supply is not None and total_burned is None:
        total_burned = float(original_supply) - float(current_supply)

    burned_pct = None
    if total_burned is not None and original_supply:
        burned_pct = float(total_burned) / float(original_supply) * 100.0

    burned_value_usd = None
    price = latest.get("price_usd")
    if total_burned is not None and price is not None:
        burned_value_usd = float(total_burned) * float(price)

    return {
        "as_of_hour_ts": latest.get("hour_ts"),
        "captured_at_ts": latest.get("captured_at"),
        "current_supply": current_supply,
        "total_burned": total_burned,
        "burned_pct_of_original": burned_pct,
        "burned_value_usd_at_current_price": burned_value_usd,
        "holder_count": latest.get("holder_count"),
        "price_usd": price,
        "liquidity_usd": latest.get("liquidity_usd"),
        "volume_24h": latest.get("volume_24h"),
        "buys_24h": latest.get("buys_24h"),
        "sells_24h": latest.get("sells_24h"),
        "dex_pair": {
            "chain_id": latest.get("dex_chain_id"),
            "dex_id": latest.get("dex_id"),
            "pair_address": latest.get("dex_pair_address"),
        },
    }


def recent_burns(conn, *, limit: int = 50) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT signature, timestamp, datetime_utc, amount_ui, description
        FROM burn_events
        ORDER BY timestamp DESC
        LIMIT ?
        """,
        (int(limit),),
    ).fetchall()
    return [dict(r) for r in rows]


def daily_burn_totals(conn, *, days: int = 90) -> list[dict[str, Any]]:
    """UTC calendar-day totals from local burn_events (same DB as /api/burns)."""
    lim = max(1, min(int(days), 366))
    rows = conn.execute(
        """
        SELECT day, total_ui
        FROM (
            SELECT strftime('%Y-%m-%d', timestamp, 'unixepoch') AS day,
                   SUM(COALESCE(amount_ui, 0)) AS total_ui
            FROM burn_events
            WHERE timestamp IS NOT NULL
            GROUP BY day
            ORDER BY day DESC
            LIMIT ?
        ) AS daily_agg
        ORDER BY day ASC
        """,
        (lim,),
    ).fetchall()
    return [dict(r) for r in rows]

