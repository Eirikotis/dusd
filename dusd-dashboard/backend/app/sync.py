from __future__ import annotations

import logging
import time
from typing import Any

from .clients.dexscreener import DexScreenerClient
from .clients.helius import HeliusClient, count_unique_nonzero_holders, extract_burn_rows
from .config import Settings
from .db import insert_burn_events, state_get, state_set, upsert_hourly_snapshot

log = logging.getLogger("dusd.sync")


def _hour_floor_ts(ts: int | None = None) -> int:
    t = int(ts or time.time())
    return t - (t % 3600)


def _chunk(items: list[str], n: int) -> list[list[str]]:
    return [items[i : i + n] for i in range(0, len(items), n)]


def sync_incremental_burns(*, settings: Settings, helius: HeliusClient, conn) -> dict[str, Any]:
    last_seen = state_get(conn, "last_seen_burn_signature")

    all_new_sigs: list[str] = []
    before = None
    reached_last_seen = False

    log.info("burn_sync.start last_seen=%s", (last_seen[:12] + "…") if last_seen else None)
    for _page in range(settings.max_sig_pages):
        t0 = time.time()
        infos = helius.get_signatures_for_address(settings.dusd_mint, before=before, limit=settings.sig_page_size)
        log.info("burn_sync.signatures fetched=%s before=%s dt_ms=%d", len(infos or []), (before[:12] + "…") if before else None, int((time.time() - t0) * 1000))
        if not infos:
            break

        sigs = [x.get("signature") for x in infos if isinstance(x, dict) and x.get("signature")]
        if not sigs:
            break

        if last_seen and last_seen in sigs:
            idx = sigs.index(last_seen)
            all_new_sigs.extend(sigs[:idx])
            reached_last_seen = True
            break

        all_new_sigs.extend(sigs)
        before = sigs[-1]
        time.sleep(settings.helius_sleep_s)

    # Parse only unseen signatures; keep only BURN transactions for the mint.
    burn_rows: list[dict[str, Any]] = []
    for batch in _chunk(all_new_sigs, settings.parse_batch_size):
        t0 = time.time()
        parsed = helius.parse_transactions(batch)
        log.info("burn_sync.parse batch=%d dt_ms=%d", len(batch), int((time.time() - t0) * 1000))
        burn_rows.extend(extract_burn_rows(parsed, mint=settings.dusd_mint))
        time.sleep(settings.helius_sleep_s)

    inserted = insert_burn_events(conn, burn_rows)
    # Advance only after every batch was parsed and stored. A transient parser
    # failure must not skip signatures on the next run.
    if all_new_sigs:
        state_set(conn, "last_seen_burn_signature", all_new_sigs[0])
        conn.commit()
    log.info(
        "burn_sync.end scanned=%d parsed_burns=%d inserted=%d reached_last_seen=%s last_seen_after=%s",
        len(all_new_sigs),
        len(burn_rows),
        inserted,
        reached_last_seen,
        (state_get(conn, "last_seen_burn_signature") or "")[:12] + "…",
    )

    return {
        "last_seen_before": last_seen,
        "new_signatures_scanned": len(all_new_sigs),
        "reached_last_seen": reached_last_seen,
        "burn_rows_parsed": len(burn_rows),
        "burn_rows_inserted": inserted,
        "last_seen_after": state_get(conn, "last_seen_burn_signature"),
    }


def fetch_current_holder_count(*, settings: Settings, helius: HeliusClient) -> int | None:
    try:
        t0 = time.time()
        accounts = helius.iter_token_accounts_for_mint_v2(settings.dusd_mint, limit=1000)
        n = count_unique_nonzero_holders(accounts)
        log.info("holders.ok count=%d dt_s=%.2f", n, time.time() - t0)
        return n
    except Exception as e:
        log.exception("holders.fail err=%s", str(e))
        return None


def fetch_current_snapshot(
    *,
    settings: Settings,
    helius: HeliusClient,
    dexs: DexScreenerClient,
    refresh_holders: bool = True,
) -> dict[str, Any]:
    # Helius supply
    supply_ui = None
    try:
        if settings.helius_rpc_url:
            t0 = time.time()
            supply = helius.get_token_supply(settings.dusd_mint)
            supply_ui = float(supply["ui_amount"])
            log.info("supply.ok ui=%s dt_ms=%d", supply_ui, int((time.time() - t0) * 1000))
    except Exception as e:
        log.exception("supply.fail err=%s", str(e))
        supply_ui = None

    total_burned = None
    if supply_ui is not None:
        total_burned = float(settings.original_supply) - float(supply_ui)

    holder_count = (
        fetch_current_holder_count(settings=settings, helius=helius)
        if settings.helius_rpc_url and refresh_holders
        else None
    )

    # DexScreener
    dex_snap: dict[str, Any]
    try:
        t0 = time.time()
        pairs = dexs.fetch_pairs(chain_id="solana", token_address=settings.dusd_mint)
        best = dexs.choose_best_pair_by_liquidity_usd(pairs)
        dex_snap = dexs.parse_snapshot(best)
        log.info("dex.ok pair=%s price=%s liq=%s dt_ms=%d", (dex_snap.get("dex_pair_address") or "")[:10], dex_snap.get("price_usd"), dex_snap.get("liquidity_usd"), int((time.time() - t0) * 1000))
    except Exception:
        dex_snap = dexs.parse_snapshot(None)

    return {
        "current_supply": supply_ui,
        "total_burned": total_burned,
        "holder_count": holder_count,
        **dex_snap,
    }


def _latest_holder_count(conn, *, dusd_mint: str) -> int | None:
    row = conn.execute(
        """
        SELECT holder_count
        FROM token_snapshots_hourly
        WHERE dusd_mint = ? AND holder_count IS NOT NULL
        ORDER BY hour_ts DESC
        LIMIT 1
        """,
        (dusd_mint,),
    ).fetchone()
    return None if row is None else int(row["holder_count"])


def _holder_refresh_due(conn, *, interval_minutes: int, now_ts: int | None = None) -> bool:
    last_raw = state_get(conn, "last_holder_sync_ts")
    if not last_raw:
        return True
    try:
        last_ts = int(last_raw)
    except (TypeError, ValueError):
        return True
    now = int(now_ts or time.time())
    return now - last_ts >= max(1, interval_minutes) * 60


def run_hourly_sync_once(
    *, settings: Settings, helius: HeliusClient, dexs: DexScreenerClient, conn
) -> dict[str, Any]:
    burn_res = None
    if settings.helius_rpc_url and settings.helius_parse_tx_url:
        burn_res = sync_incremental_burns(settings=settings, helius=helius, conn=conn)

    refresh_holders = _holder_refresh_due(
        conn, interval_minutes=settings.holder_sync_interval_minutes
    )
    snap = fetch_current_snapshot(
        settings=settings,
        helius=helius,
        dexs=dexs,
        refresh_holders=refresh_holders,
    )
    if refresh_holders and snap.get("holder_count") is not None:
        state_set(conn, "last_holder_sync_ts", str(int(time.time())))
        conn.commit()
    elif snap.get("holder_count") is None:
        snap["holder_count"] = _latest_holder_count(conn, dusd_mint=settings.dusd_mint)

    hour_ts = _hour_floor_ts()
    inserted = upsert_hourly_snapshot(conn, hour_ts=hour_ts, snapshot=snap, dusd_mint=settings.dusd_mint)
    log.info("snapshot.upsert hour_ts=%d changed=%s", hour_ts, inserted)
    log.info(
        "sync.once.complete mint=%s price_usd=%s liquidity_usd=%s volume_24h=%s holders=%s supply=%s",
        settings.dusd_mint[:8] + "…",
        snap.get("price_usd"),
        snap.get("liquidity_usd"),
        snap.get("volume_24h"),
        snap.get("holder_count"),
        snap.get("current_supply"),
    )

    return {
        "burn_sync": burn_res,
        "snapshot_hour_ts": hour_ts,
        "snapshot_inserted": inserted,
        "holders_refreshed": refresh_holders,
        "snapshot": snap,
    }

