from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any


WINDOWS: dict[str, int] = {
    "24h": 24 * 3600,
    "7d": 7 * 24 * 3600,
    "30d": 30 * 24 * 3600,
}


def _now_ts() -> int:
    return int(time.time())


def _get_latest_snapshot(conn) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM token_snapshots_hourly ORDER BY hour_ts DESC LIMIT 1"
    ).fetchone()
    return None if row is None else dict(row)


def _get_snapshot_at_or_before(conn, ts: int) -> dict[str, Any] | None:
    hour_ts = ts - (ts % 3600)
    row = conn.execute(
        "SELECT * FROM token_snapshots_hourly WHERE hour_ts <= ? ORDER BY hour_ts DESC LIMIT 1",
        (hour_ts,),
    ).fetchone()
    return None if row is None else dict(row)


def _sum_burns_since(conn, since_ts: int) -> float | None:
    row = conn.execute(
        "SELECT SUM(COALESCE(amount_ui, 0)) AS s FROM burn_events WHERE timestamp >= ?",
        (since_ts,),
    ).fetchone()
    if row is None:
        return None
    v = row["s"]
    return None if v is None else float(v)


def _tracking_start_ts(conn) -> int | None:
    row = conn.execute("SELECT MIN(hour_ts) AS m FROM token_snapshots_hourly").fetchone()
    return None if row is None else (int(row["m"]) if row["m"] is not None else None)


def _holder_change(conn, start_ts: int) -> int | None:
    latest = _get_latest_snapshot(conn)
    past = _get_snapshot_at_or_before(conn, start_ts)
    if not latest or not past:
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


def timeframe_metrics(conn, *, window_key: str) -> dict[str, Any]:
    window_s = WINDOWS.get(window_key)
    if window_s is None:
        raise ValueError("invalid window")

    now = _now_ts()
    start = now - window_s

    latest = _get_latest_snapshot(conn) or {}
    tracking_start = _tracking_start_ts(conn)

    burns = _sum_burns_since(conn, start)
    holder_delta = _holder_change(conn, start)

    if burns is None and tracking_start is not None:
        burns = _sum_burns_since(conn, tracking_start)  # fallback

    supply_now = latest.get("current_supply")
    burned_pct_circ = None
    if burns is not None and supply_now not in (None, 0):
        burned_pct_circ = float(burns) / float(supply_now) * 100.0

    burn_per_sec = None
    if burns is not None:
        burn_per_sec = float(burns) / float(window_s)

    projected_time_to_zero_s = None
    if burn_per_sec and burn_per_sec > 0 and supply_now not in (None, 0):
        projected_time_to_zero_s = float(supply_now) / float(burn_per_sec)

    return {
        "window": window_key,
        "window_seconds": window_s,
        "since_ts": start,
        "burned_in_window": burns,
        "holder_change": holder_delta,
        "avg_burn_per_second": burn_per_sec,
        "projected_time_to_zero_seconds": projected_time_to_zero_s,
        "burn_as_pct_of_circulating_in_window": burned_pct_circ,
        "tracking_started_ts": tracking_start,
        "has_enough_history": tracking_start is not None and tracking_start <= start,
    }


def trading_metrics(conn, *, window_key: str) -> dict[str, Any]:
    window_s = WINDOWS.get(window_key)
    if window_s is None:
        raise ValueError("invalid window")

    now = _now_ts()
    start = now - window_s

    latest = _get_latest_snapshot(conn) or {}
    past = _get_snapshot_at_or_before(conn, start) or {}
    tracking_start = _tracking_start_ts(conn)

    price_now = latest.get("price_usd")
    liq_now = latest.get("liquidity_usd")

    price_then = past.get("price_usd")
    liq_then = past.get("liquidity_usd")

    # 24h volume: show current DEX Screener volume_24h directly
    vol_24h_now = latest.get("volume_24h")

    # 7d/30d: estimate total volume as (avg volume_24h over window) * days
    est_total = None
    est_label = None
    if window_key == "24h":
        est_total = vol_24h_now
        est_label = "24h (DEX Screener)"
    else:
        rows = conn.execute(
            "SELECT volume_24h FROM token_snapshots_hourly WHERE hour_ts >= ? AND volume_24h IS NOT NULL",
            (start - (start % 3600),),
        ).fetchall()
        vols = [float(r["volume_24h"]) for r in rows if r and r["volume_24h"] is not None]
        if vols:
            avg_daily = sum(vols) / len(vols)
            days = window_s / 86400.0
            est_total = avg_daily * days
            est_label = "estimated from hourly 24h-volume snapshots"

    return {
        "window": window_key,
        "window_seconds": window_s,
        "price_usd": price_now,
        "liquidity_usd": liq_now,
        "volume": est_total,
        "volume_label": est_label,
        "buys_24h": latest.get("buys_24h"),
        "sells_24h": latest.get("sells_24h"),
        "price_change_pct": _pct_change(price_now, price_then),
        "liquidity_change_pct": _pct_change(liq_now, liq_then),
        "tracking_started_ts": tracking_start,
        "has_enough_history": tracking_start is not None and tracking_start <= start,
    }


def current_overview(conn, *, original_supply: float) -> dict[str, Any]:
    latest = _get_latest_snapshot(conn) or {}
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

