from __future__ import annotations

import csv
import io
import math
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

import httpx

from .db import tx


ASSET_ORDER = ("DUSD", "BTC", "GOLD", "M2")
DEFAULT_DAYS = 141
SECONDS_PER_DAY = 86_400
SECONDS_PER_YEAR = 365.2425 * SECONDS_PER_DAY

BLOCKCHAIN_CHART_URL = "https://api.blockchain.info/charts/total-bitcoins"
FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=M2SL"
COINGECKO_SIMPLE_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price"
COINGECKO_SOURCE_URL = "https://www.coingecko.com/"
TROY_OUNCES_PER_METRIC_TONNE = 32_150.7465686

# World Gold Council, end-2025 above-ground stock and 2025 mine production.
GOLD_BASE_DATE = date(2025, 12, 31)
GOLD_BASE_TONNES = 219_891.0
GOLD_ANNUAL_MINE_TONNES = 3_671.6

SOURCE_META = {
    "DUSD": {
        "label": "DUSD",
        "unit": "DUSD",
        "source": "DUSD burn ledger",
        "source_url": "",
        "frequency": "daily",
        "quality": "observed",
        "methodology": "Daily supply reconstructed from the latest observed supply and subsequent on-chain burns.",
    },
    "BTC": {
        "label": "Bitcoin",
        "unit": "BTC",
        "source": "Blockchain.com",
        "source_url": "https://www.blockchain.com/explorer/charts/total-bitcoins",
        "frequency": "daily",
        "quality": "observed",
        "methodology": "Daily circulating Bitcoin reported by Blockchain.com.",
    },
    "GOLD": {
        "label": "Gold",
        "unit": "tonnes",
        "source": "World Gold Council",
        "source_url": "https://www.gold.org/goldhub/data/how-much-gold",
        "frequency": "annual estimate",
        "quality": "estimated",
        "methodology": "End-2025 above-ground stock plus the latest annual mine-production pace; recycled gold is excluded.",
    },
    "M2": {
        "label": "US M2",
        "unit": "USD billions",
        "source": "FRED M2SL",
        "source_url": "https://fred.stlouisfed.org/series/M2SL",
        "frequency": "monthly",
        "quality": "official step",
        "methodology": "Official monthly, seasonally adjusted US M2 observations, forward-filled between releases.",
    },
}


def _utc_today() -> date:
    return datetime.now(timezone.utc).date()


def _date_to_ts(day: date) -> int:
    return int(datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp())


def _iter_days(start: date, end: date) -> Iterable[date]:
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def _tracking_start(conn, *, initial_days: int = DEFAULT_DAYS) -> date:
    existing = conn.execute(
        """
        SELECT MIN(observed_on) AS first_day
        FROM scarcity_observations
        WHERE asset = 'DUSD'
        """
    ).fetchone()
    if existing and existing["first_day"]:
        return date.fromisoformat(str(existing["first_day"]))

    today = _utc_today()
    requested_start = today - timedelta(days=max(2, initial_days) - 1)
    first_burn = conn.execute(
        "SELECT MIN(timestamp) AS first_ts FROM burn_events WHERE timestamp IS NOT NULL"
    ).fetchone()
    if first_burn and first_burn["first_ts"] is not None:
        first_burn_day = datetime.fromtimestamp(int(first_burn["first_ts"]), timezone.utc).date()
        return max(requested_start, first_burn_day)
    return requested_start


def _upsert_observations(conn, rows: Iterable[dict[str, Any]]) -> int:
    fetched_at = int(time.time())
    count = 0
    with tx(conn):
        for row in rows:
            conn.execute(
                """
                INSERT INTO scarcity_observations(
                    asset, observed_on, value, unit, source, source_frequency,
                    is_estimated, methodology, fetched_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(asset, observed_on) DO UPDATE SET
                    value=excluded.value,
                    unit=excluded.unit,
                    source=excluded.source,
                    source_frequency=excluded.source_frequency,
                    is_estimated=excluded.is_estimated,
                    methodology=excluded.methodology,
                    fetched_at=excluded.fetched_at
                """,
                (
                    row["asset"],
                    row["observed_on"],
                    float(row["value"]),
                    row["unit"],
                    row["source"],
                    row["source_frequency"],
                    1 if row.get("is_estimated") else 0,
                    row.get("methodology"),
                    fetched_at,
                ),
            )
            count += 1
    return count


def build_dusd_observations(conn, *, days: int = DEFAULT_DAYS) -> list[dict[str, Any]]:
    latest = conn.execute(
        """
        SELECT current_supply, captured_at
        FROM token_snapshots_hourly
        WHERE current_supply IS NOT NULL
        ORDER BY hour_ts DESC
        LIMIT 1
        """
    ).fetchone()
    if latest is None:
        return []

    today = _utc_today()
    requested_start = today - timedelta(days=max(2, days) - 1)
    first_burn = conn.execute(
        "SELECT MIN(timestamp) AS first_ts FROM burn_events WHERE timestamp IS NOT NULL"
    ).fetchone()
    if first_burn and first_burn["first_ts"] is not None:
        tracked_start = datetime.fromtimestamp(int(first_burn["first_ts"]), timezone.utc).date()
        start = max(requested_start, tracked_start)
    else:
        start = requested_start

    burn_rows = conn.execute(
        """
        SELECT date(timestamp, 'unixepoch') AS day, SUM(COALESCE(amount_ui, 0)) AS amount
        FROM burn_events
        WHERE timestamp >= ?
        GROUP BY day
        ORDER BY day ASC
        """,
        (_date_to_ts(start),),
    ).fetchall()
    burns_by_day = {str(r["day"]): float(r["amount"] or 0) for r in burn_rows}

    current_supply = float(latest["current_supply"])
    running_supply = current_supply
    supplies: dict[str, float] = {}
    # Current supply is the latest observed value. Walk backwards by restoring
    # each later day's burns to reconstruct historical end-of-day supply.
    for day in reversed(list(_iter_days(start, today))):
        supplies[day.isoformat()] = running_supply
        running_supply += burns_by_day.get(day.isoformat(), 0.0)

    meta = SOURCE_META["DUSD"]
    return [
        {
            "asset": "DUSD",
            "observed_on": day,
            "value": value,
            "unit": meta["unit"],
            "source": meta["source"],
            "source_frequency": meta["frequency"],
            "is_estimated": False,
            "methodology": meta["methodology"],
        }
        for day, value in sorted(supplies.items())
    ]


def fetch_bitcoin_observations(*, days: int = DEFAULT_DAYS) -> list[dict[str, Any]]:
    with httpx.Client(timeout=25, follow_redirects=True) as client:
        response = client.get(
            BLOCKCHAIN_CHART_URL,
            params={"timespan": f"{max(days + 7, 35)}days", "format": "json", "sampled": "false"},
        )
        response.raise_for_status()
        values = response.json().get("values") or []

    cutoff = _utc_today() - timedelta(days=days - 1)
    meta = SOURCE_META["BTC"]
    by_day: dict[str, float] = {}
    for item in values:
        try:
            observed = datetime.fromtimestamp(int(item["x"]), timezone.utc).date()
            value = float(item["y"])
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
        if observed < cutoff or not math.isfinite(value):
            continue
        by_day[observed.isoformat()] = value

    return [
        {
            "asset": "BTC",
            "observed_on": observed_on,
            "value": value,
            "unit": meta["unit"],
            "source": meta["source"],
            "source_frequency": meta["frequency"],
            "is_estimated": False,
            "methodology": meta["methodology"],
        }
        for observed_on, value in sorted(by_day.items())
    ]


def fetch_m2_observations() -> list[dict[str, Any]]:
    with httpx.Client(timeout=25, follow_redirects=True) as client:
        response = client.get(FRED_CSV_URL)
        response.raise_for_status()

    meta = SOURCE_META["M2"]
    rows: list[dict[str, Any]] = []
    cutoff = _utc_today() - timedelta(days=430)
    for item in csv.DictReader(io.StringIO(response.text)):
        observed_raw = item.get("observation_date") or item.get("DATE")
        value_raw = item.get("M2SL")
        if not observed_raw or not value_raw or value_raw == ".":
            continue
        try:
            observed = date.fromisoformat(observed_raw)
            value = float(value_raw)
        except (TypeError, ValueError):
            continue
        if observed < cutoff or not math.isfinite(value):
            continue
        rows.append(
            {
                "asset": "M2",
                "observed_on": observed.isoformat(),
                "value": value,
                "unit": meta["unit"],
                "source": meta["source"],
                "source_frequency": meta["frequency"],
                "is_estimated": False,
                "methodology": meta["methodology"],
            }
        )
    return rows


def build_gold_observations(*, days: int = DEFAULT_DAYS) -> list[dict[str, Any]]:
    today = _utc_today()
    start = today - timedelta(days=days - 1)
    daily_mine_tonnes = GOLD_ANNUAL_MINE_TONNES / 365.2425
    meta = SOURCE_META["GOLD"]
    return [
        {
            "asset": "GOLD",
            "observed_on": observed.isoformat(),
            "value": GOLD_BASE_TONNES + (observed - GOLD_BASE_DATE).days * daily_mine_tonnes,
            "unit": meta["unit"],
            "source": meta["source"],
            "source_frequency": meta["frequency"],
            "is_estimated": True,
            "methodology": meta["methodology"],
        }
        for observed in _iter_days(start, today)
    ]


def sync_scarcity_market_prices(
    conn, *, coingecko_api_key: str | None = None
) -> dict[str, Any]:
    headers = {"accept": "application/json"}
    if coingecko_api_key:
        headers["x-cg-demo-api-key"] = coingecko_api_key

    with httpx.Client(timeout=20, follow_redirects=True, headers=headers) as client:
        response = client.get(
            COINGECKO_SIMPLE_PRICE_URL,
            params={
                "ids": "bitcoin,pax-gold",
                "vs_currencies": "usd",
                "include_last_updated_at": "true",
                "precision": "full",
            },
        )
        response.raise_for_status()
        payload = response.json()

    fetched_at = int(time.time())
    mappings = (
        ("BTC", "bitcoin", "Bitcoin"),
        ("GOLD", "pax-gold", "PAX Gold / one troy ounce proxy"),
    )
    rows: list[tuple[Any, ...]] = []
    for asset, coin_id, proxy_asset in mappings:
        item = payload.get(coin_id) or {}
        try:
            price_usd = float(item["usd"])
            source_updated_at = int(item.get("last_updated_at") or fetched_at)
        except (KeyError, TypeError, ValueError):
            continue
        if not math.isfinite(price_usd) or price_usd <= 0:
            continue
        rows.append(
            (
                asset,
                price_usd,
                proxy_asset,
                "CoinGecko",
                COINGECKO_SOURCE_URL,
                source_updated_at,
                fetched_at,
            )
        )

    if len(rows) != len(mappings):
        raise RuntimeError("CoinGecko returned incomplete BTC/gold pricing")

    with tx(conn):
        conn.executemany(
            """
            INSERT INTO scarcity_market_prices(
                asset, price_usd, proxy_asset, source, source_url,
                source_updated_at, fetched_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(asset) DO UPDATE SET
                price_usd=excluded.price_usd,
                proxy_asset=excluded.proxy_asset,
                source=excluded.source,
                source_url=excluded.source_url,
                source_updated_at=excluded.source_updated_at,
                fetched_at=excluded.fetched_at
            """,
            rows,
        )

    return {"ok": True, "assets": [row[0] for row in rows], "fetched_at": fetched_at}


def _store_rate(
    conn,
    *,
    asset: str,
    base_value: float,
    base_timestamp: int,
    rate_per_second: float,
    calculation_window: str,
    methodology: str,
    unit: str,
) -> None:
    conn.execute(
        """
        INSERT INTO scarcity_rates(
            asset, base_value, base_timestamp, rate_per_second, unit,
            calculation_window, methodology, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(asset) DO UPDATE SET
            base_value=excluded.base_value,
            base_timestamp=excluded.base_timestamp,
            rate_per_second=excluded.rate_per_second,
            unit=excluded.unit,
            calculation_window=excluded.calculation_window,
            methodology=excluded.methodology,
            updated_at=excluded.updated_at
        """,
        (
            asset,
            base_value,
            base_timestamp,
            rate_per_second,
            unit,
            calculation_window,
            methodology,
            int(time.time()),
        ),
    )


def refresh_scarcity_rates(conn) -> None:
    with tx(conn):
        for asset in ("DUSD", "BTC"):
            rows = conn.execute(
                """
                SELECT observed_on, value
                FROM scarcity_observations
                WHERE asset = ?
                ORDER BY observed_on DESC
                LIMIT 31
                """,
                (asset,),
            ).fetchall()
            if len(rows) < 2:
                continue
            latest = rows[0]
            prior = rows[-1]
            latest_day = date.fromisoformat(str(latest["observed_on"]))
            prior_day = date.fromisoformat(str(prior["observed_on"]))
            elapsed = max(SECONDS_PER_DAY, (latest_day - prior_day).days * SECONDS_PER_DAY)
            _store_rate(
                conn,
                asset=asset,
                base_value=float(latest["value"]),
                base_timestamp=(
                    int(time.time())
                    if asset == "DUSD"
                    else min(int(time.time()), _date_to_ts(latest_day + timedelta(days=1)))
                ),
                rate_per_second=(float(latest["value"]) - float(prior["value"])) / elapsed,
                calculation_window=f"trailing {(latest_day - prior_day).days} days",
                methodology=(
                    "Trailing realised burn pace from the internal ledger."
                    if asset == "DUSD"
                    else "Trailing realised Bitcoin issuance pace from daily circulating supply."
                ),
                unit=SOURCE_META[asset]["unit"],
            )

        latest_gold = conn.execute(
            """
            SELECT observed_on, value FROM scarcity_observations
            WHERE asset = 'GOLD' ORDER BY observed_on DESC LIMIT 1
            """
        ).fetchone()
        if latest_gold:
            gold_day = date.fromisoformat(str(latest_gold["observed_on"]))
            _store_rate(
                conn,
                asset="GOLD",
                base_value=float(latest_gold["value"]),
                base_timestamp=int(time.time()),
                rate_per_second=GOLD_ANNUAL_MINE_TONNES / SECONDS_PER_YEAR,
                calculation_window="2025 annual mine production",
                methodology="Latest published annual mine production accrued evenly; estimated.",
                unit=SOURCE_META["GOLD"]["unit"],
            )

        m2_rows = conn.execute(
            """
            SELECT observed_on, value FROM scarcity_observations
            WHERE asset = 'M2' ORDER BY observed_on DESC LIMIT 14
            """
        ).fetchall()
        if len(m2_rows) >= 2:
            latest = m2_rows[0]
            latest_day = date.fromisoformat(str(latest["observed_on"]))
            target = latest_day - timedelta(days=365)
            prior = min(
                m2_rows[1:],
                key=lambda row: abs((date.fromisoformat(str(row["observed_on"])) - target).days),
            )
            prior_day = date.fromisoformat(str(prior["observed_on"]))
            elapsed = max(SECONDS_PER_DAY, (latest_day - prior_day).days * SECONDS_PER_DAY)
            _store_rate(
                conn,
                asset="M2",
                base_value=float(latest["value"]),
                base_timestamp=_date_to_ts(latest_day),
                rate_per_second=(float(latest["value"]) - float(prior["value"])) / elapsed,
                calculation_window="latest 12-month official change",
                methodology="Latest year-over-year change in official monthly M2, expressed as a reference pace.",
                unit=SOURCE_META["M2"]["unit"],
            )


def sync_scarcity_data(conn) -> dict[str, Any]:
    results: dict[str, Any] = {}
    tracking_start = _tracking_start(conn)
    tracking_days = (_utc_today() - tracking_start).days + 1

    local_series = {
        "DUSD": build_dusd_observations(conn, days=tracking_days),
        "GOLD": build_gold_observations(days=tracking_days),
    }
    for asset, rows in local_series.items():
        results[asset] = {"ok": True, "rows": _upsert_observations(conn, rows)}

    for asset, fetcher in (
        ("BTC", lambda: fetch_bitcoin_observations(days=tracking_days)),
        ("M2", fetch_m2_observations),
    ):
        try:
            rows = fetcher()
            if not rows:
                raise RuntimeError(f"{asset} source returned no observations")
            results[asset] = {"ok": True, "rows": _upsert_observations(conn, rows)}
        except Exception as exc:
            # Preserve prior observations when a public source is temporarily unavailable.
            results[asset] = {"ok": False, "error": str(exc)}

    refresh_scarcity_rates(conn)
    results["window"] = {
        "start": tracking_start.isoformat(),
        "end": _utc_today().isoformat(),
        "days": tracking_days,
    }
    return results


def _rows_by_asset(conn, *, start: date, end: date) -> dict[str, list[dict[str, Any]]]:
    rows = conn.execute(
        """
        SELECT asset, observed_on, value, is_estimated
        FROM scarcity_observations
        WHERE observed_on <= ?
          AND (observed_on >= ? OR asset = 'M2')
        ORDER BY asset, observed_on
        """,
        (end.isoformat(), (start - timedelta(days=370)).isoformat()),
    ).fetchall()
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[str(row["asset"])].append(dict(row))
    return grouped


def _daily_asset_values(
    rows: list[dict[str, Any]], *, start: date, end: date, stepped: bool
) -> list[dict[str, Any]]:
    parsed = [
        (date.fromisoformat(str(row["observed_on"])), float(row["value"]), bool(row["is_estimated"]))
        for row in rows
    ]
    parsed.sort(key=lambda item: item[0])
    if not parsed:
        return []

    result: list[dict[str, Any]] = []
    cursor = 0
    current: tuple[date, float, bool] | None = None
    for day in _iter_days(start, end):
        while cursor < len(parsed) and parsed[cursor][0] <= day:
            current = parsed[cursor]
            cursor += 1
        if current is None:
            continue
        if not stepped and current[0] != day:
            continue
        result.append(
            {
                "date": day.isoformat(),
                "value": current[1],
                "is_estimated": current[2],
                "source_observed_on": current[0].isoformat(),
            }
        )
    return result


def _market_cap_scenarios(
    conn, daily: dict[str, list[dict[str, Any]]]
) -> dict[str, Any]:
    snapshot = conn.execute(
        """
        SELECT current_supply, price_usd, captured_at
        FROM token_snapshots_hourly
        WHERE current_supply IS NOT NULL AND price_usd IS NOT NULL
        ORDER BY hour_ts DESC
        LIMIT 1
        """
    ).fetchone()
    prices = conn.execute(
        """
        SELECT asset, price_usd, proxy_asset, source, source_url,
               source_updated_at, fetched_at
        FROM scarcity_market_prices
        """
    ).fetchall()
    prices_by_asset = {str(row["asset"]): dict(row) for row in prices}

    if snapshot is None:
        return {"current": None, "scenarios": [], "updated_at": None}

    dusd_supply = float(snapshot["current_supply"])
    dusd_price = float(snapshot["price_usd"])
    if dusd_supply <= 0 or dusd_price <= 0:
        return {"current": None, "scenarios": [], "updated_at": None}

    dusd_market_cap = dusd_supply * dusd_price
    current = {
        "asset": "DUSD",
        "supply": dusd_supply,
        "price_usd": dusd_price,
        "market_cap_usd": dusd_market_cap,
        "captured_at": int(snapshot["captured_at"]),
    }

    latest_values = {
        asset: float(points[-1]["value"])
        for asset, points in daily.items()
        if points
    }
    targets: list[dict[str, Any]] = []

    btc_price = prices_by_asset.get("BTC")
    btc_supply = latest_values.get("BTC")
    if btc_price and btc_supply:
        targets.append(
            {
                "asset": "BTC",
                "label": "Bitcoin",
                "market_cap_usd": btc_supply * float(btc_price["price_usd"]),
                "source": btc_price["source"],
                "source_url": btc_price["source_url"],
                "methodology": "Tracked Bitcoin circulating supply multiplied by BTC/USD.",
                "source_updated_at": btc_price["source_updated_at"],
            }
        )

    gold_price = prices_by_asset.get("GOLD")
    gold_tonnes = latest_values.get("GOLD")
    if gold_price and gold_tonnes:
        targets.append(
            {
                "asset": "GOLD",
                "label": "Gold",
                "market_cap_usd": (
                    gold_tonnes
                    * TROY_OUNCES_PER_METRIC_TONNE
                    * float(gold_price["price_usd"])
                ),
                "source": gold_price["source"],
                "source_url": gold_price["source_url"],
                "methodology": "Estimated above-ground gold stock multiplied by the PAXG USD price proxy per troy ounce.",
                "source_updated_at": gold_price["source_updated_at"],
            }
        )

    m2_billions = latest_values.get("M2")
    if m2_billions:
        targets.append(
            {
                "asset": "M2",
                "label": "US M2",
                "market_cap_usd": m2_billions * 1_000_000_000.0,
                "source": "FRED M2SL",
                "source_url": SOURCE_META["M2"]["source_url"],
                "methodology": "Latest official US M2 level; already denominated in US dollars.",
                "source_updated_at": None,
            }
        )

    for target in targets:
        target["implied_dusd_price_usd"] = target["market_cap_usd"] / dusd_supply
        target["multiple_from_current"] = target["market_cap_usd"] / dusd_market_cap

    updated_candidates = [
        int(snapshot["captured_at"]),
        *[
            int(row["fetched_at"])
            for row in prices_by_asset.values()
            if row.get("fetched_at") is not None
        ],
    ]
    return {
        "current": current,
        "scenarios": targets,
        "updated_at": max(updated_candidates),
    }


def scarcity_dashboard(conn) -> dict[str, Any]:
    end = _utc_today()
    requested_start = _tracking_start(conn)
    grouped = _rows_by_asset(conn, start=requested_start, end=end)

    daily: dict[str, list[dict[str, Any]]] = {}
    for asset in ASSET_ORDER:
        daily[asset] = _daily_asset_values(
            grouped.get(asset, []),
            start=requested_start,
            end=end,
            stepped=asset == "M2",
        )

    starts = [date.fromisoformat(points[0]["date"]) for points in daily.values() if points]
    common_start = max(starts) if starts else requested_start
    series_payload: list[dict[str, Any]] = []
    growth_payload: list[dict[str, Any]] = []
    aligned_values: dict[str, dict[str, float]] = {}

    for asset in ASSET_ORDER:
        points = [point for point in daily.get(asset, []) if point["date"] >= common_start.isoformat()]
        if not points:
            continue
        base = float(points[0]["value"])
        for point in points:
            point["index"] = 100.0 * float(point["value"]) / base if base else None
        last = points[-1]
        change_pct = (float(last["value"]) / base - 1.0) * 100 if base else None
        meta = SOURCE_META[asset]
        series_payload.append(
            {
                "asset": asset,
                **meta,
                "points": points,
            }
        )
        growth_payload.append(
            {
                "asset": asset,
                "label": meta["label"],
                "change_pct": change_pct,
                "start_value": base,
                "end_value": float(last["value"]),
                "unit": meta["unit"],
            }
        )
        aligned_values[asset] = {point["date"]: float(point["value"]) for point in points}

    ratio_points: list[dict[str, Any]] = []
    for day in _iter_days(common_start, end):
        key = day.isoformat()
        dusd = aligned_values.get("DUSD", {}).get(key)
        m2 = aligned_values.get("M2", {}).get(key)
        if dusd is None or m2 is None or m2 <= 0:
            continue
        ratio_points.append({"date": key, "value": dusd / (m2 * 1000.0)})

    ratio_current = ratio_points[-1]["value"] if ratio_points else None
    ratio_change = None
    ratio_annualized_change = None
    ratio_period_days = len(ratio_points)
    if ratio_points and ratio_points[0]["value"]:
        ratio_change = (ratio_points[-1]["value"] / ratio_points[0]["value"] - 1.0) * 100
        ratio_elapsed_days = (
            date.fromisoformat(ratio_points[-1]["date"])
            - date.fromisoformat(ratio_points[0]["date"])
        ).days
        if ratio_elapsed_days > 0 and ratio_points[-1]["value"] > 0:
            ratio_annualized_change = (
                (ratio_points[-1]["value"] / ratio_points[0]["value"])
                ** (365.2425 / ratio_elapsed_days)
                - 1.0
            ) * 100

    rates = conn.execute(
        """
        SELECT asset, base_value, base_timestamp, rate_per_second, unit,
               calculation_window, methodology, updated_at
        FROM scarcity_rates
        """
    ).fetchall()
    rates_by_asset = {str(row["asset"]): dict(row) for row in rates}
    clock = []
    for asset in ASSET_ORDER:
        row = rates_by_asset.get(asset)
        if not row:
            continue
        clock.append({"asset": asset, "label": SOURCE_META[asset]["label"], **row})

    return {
        "window": {
            "start": common_start.isoformat(),
            "end": end.isoformat(),
            "days": (end - common_start).days + 1,
        },
        "series": series_payload,
        "growth": growth_payload,
        "clock": clock,
        "ratio": {
            "label": "DUSD outstanding per $1 trillion of US M2",
            "unit": "M DUSD / $1T",
            "current": ratio_current,
            "change_pct": ratio_change,
            "annualized_change_pct": ratio_annualized_change,
            "period_days": ratio_period_days,
            "points": ratio_points,
        },
        "market_cap": _market_cap_scenarios(conn, daily),
        "updated_at": max((int(row["updated_at"]) for row in rates), default=None),
    }
