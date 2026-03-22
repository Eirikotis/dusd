from __future__ import annotations

import csv
import hashlib
import os
import sqlite3
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


@dataclass(frozen=True)
class Db:
    path: str


def _now_ts() -> int:
    return int(time.time())


def _ensure_parent_dir(db_path: str) -> None:
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)


def connect(db: Db) -> sqlite3.Connection:
    _ensure_parent_dir(db.path)
    conn = sqlite3.connect(db.path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn


@contextmanager
def tx(conn: sqlite3.Connection):
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def migrate(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS burn_events (
            signature TEXT PRIMARY KEY,
            timestamp INTEGER,
            datetime_utc TEXT,
            slot INTEGER,
            source TEXT,
            fee_lamports INTEGER,
            amount_raw INTEGER,
            amount_ui REAL,
            decimals INTEGER,
            from_user TEXT,
            from_token_account TEXT,
            description TEXT,
            created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_burn_events_timestamp ON burn_events(timestamp DESC);

        CREATE TABLE IF NOT EXISTS token_snapshots_hourly (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hour_ts INTEGER NOT NULL UNIQUE,
            captured_at INTEGER NOT NULL,
            current_supply REAL,
            total_burned REAL,
            holder_count INTEGER,
            price_usd REAL,
            liquidity_usd REAL,
            volume_24h REAL,
            buys_24h INTEGER,
            sells_24h INTEGER,
            price_change_24h_pct REAL,
            dex_chain_id TEXT,
            dex_id TEXT,
            dex_pair_address TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_snapshots_hour_ts ON token_snapshots_hourly(hour_ts DESC);

        CREATE TABLE IF NOT EXISTS app_state (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        """
    )
    conn.commit()
    snap_cols = {row[1] for row in conn.execute("PRAGMA table_info(token_snapshots_hourly)")}
    if "dusd_mint" not in snap_cols:
        conn.execute("ALTER TABLE token_snapshots_hourly ADD COLUMN dusd_mint TEXT")
        # Legacy rows had no mint; mixing them with a new mint corrupts period metrics.
        conn.execute("DELETE FROM token_snapshots_hourly WHERE dusd_mint IS NULL")
        conn.commit()


def purge_hourly_snapshots_if_mint_changed(conn: sqlite3.Connection, *, dusd_mint: str) -> None:
    key = "sync_active_mint"
    prev = state_get(conn, key)
    if prev is not None and prev != dusd_mint:
        conn.execute("DELETE FROM token_snapshots_hourly")
        conn.commit()
    state_set(conn, key, dusd_mint)


def state_get(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM app_state WHERE key = ?", (key,)).fetchone()
    return None if row is None else str(row["value"])


def state_set(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO app_state(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )


def _file_sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def seed_burn_events_from_csv_once(
    *,
    conn: sqlite3.Connection,
    csv_path: str,
    expected_symbol: str = "DUSD",
) -> dict[str, Any]:
    seeded = state_get(conn, "seeded_from_csv")
    if seeded == "1":
        return {"seeded": False, "reason": "already_seeded"}

    if not os.path.exists(csv_path):
        return {"seeded": False, "reason": "csv_missing", "csv_path": csv_path}

    csv_sha = _file_sha256(csv_path)

    inserted = 0
    skipped = 0
    newest_sig = None
    newest_ts = None

    with tx(conn):
        with open(csv_path, "r", newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                sig = (row.get("signature") or "").strip()
                if not sig:
                    skipped += 1
                    continue

                typ = (row.get("type") or "").strip().upper()
                if typ and typ != "BURN":
                    skipped += 1
                    continue

                desc = (row.get("description") or "").strip()
                if expected_symbol and expected_symbol not in desc:
                    # The provided CSV may include burns for other tokens due to
                    # broad signature parsing; keep DUSD-only by default.
                    skipped += 1
                    continue

                ts = row.get("timestamp")
                try:
                    ts_i = int(float(ts)) if ts else None
                except Exception:
                    ts_i = None

                amount_ui = row.get("amount_ui")
                try:
                    amount_ui_f = float(amount_ui) if amount_ui not in (None, "", "nan") else None
                except Exception:
                    amount_ui_f = None

                amount_raw = row.get("amount_raw")
                try:
                    amount_raw_i = int(amount_raw) if amount_raw not in (None, "", "nan") else None
                except Exception:
                    amount_raw_i = None

                decimals = row.get("decimals")
                try:
                    decimals_i = int(decimals) if decimals not in (None, "", "nan") else None
                except Exception:
                    decimals_i = None

                slot = row.get("slot")
                try:
                    slot_i = int(slot) if slot not in (None, "", "nan") else None
                except Exception:
                    slot_i = None

                fee = row.get("fee_lamports")
                try:
                    fee_i = int(fee) if fee not in (None, "", "nan") else None
                except Exception:
                    fee_i = None

                cur = conn.execute(
                    """
                    INSERT OR IGNORE INTO burn_events(
                        signature, timestamp, datetime_utc, slot, source, fee_lamports,
                        amount_raw, amount_ui, decimals, from_user, from_token_account,
                        description, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        sig,
                        ts_i,
                        (row.get("datetime_utc") or None),
                        slot_i,
                        (row.get("source") or None),
                        fee_i,
                        amount_raw_i,
                        amount_ui_f,
                        decimals_i,
                        (row.get("from_user") or None),
                        (row.get("from_token_account") or None),
                        desc or None,
                        _now_ts(),
                    ),
                )
                if cur.rowcount == 1:
                    inserted += 1
                else:
                    skipped += 1

                if ts_i is not None and (newest_ts is None or ts_i > newest_ts):
                    newest_ts = ts_i
                    newest_sig = sig

        state_set(conn, "seeded_from_csv", "1")
        state_set(conn, "seed_csv_sha256", csv_sha)
        state_set(conn, "seed_csv_path", csv_path)
        if newest_sig:
            state_set(conn, "last_seen_burn_signature", newest_sig)

    return {
        "seeded": True,
        "inserted": inserted,
        "skipped": skipped,
        "csv_sha256": csv_sha,
        "newest_signature": newest_sig,
        "newest_timestamp": newest_ts,
        "csv_path": csv_path,
    }


def insert_burn_events(conn: sqlite3.Connection, rows: Iterable[dict[str, Any]]) -> int:
    inserted = 0
    with tx(conn):
        for r in rows:
            sig = r.get("signature")
            if not sig:
                continue
            cur = conn.execute(
                """
                INSERT OR IGNORE INTO burn_events(
                    signature, timestamp, datetime_utc, slot, source, fee_lamports,
                    amount_raw, amount_ui, decimals, from_user, from_token_account,
                    description, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    sig,
                    r.get("timestamp"),
                    r.get("datetime_utc"),
                    r.get("slot"),
                    r.get("source"),
                    r.get("fee_lamports"),
                    r.get("amount_raw"),
                    r.get("amount_ui"),
                    r.get("decimals"),
                    r.get("from_user"),
                    r.get("from_token_account"),
                    r.get("description"),
                    _now_ts(),
                ),
            )
            if cur.rowcount == 1:
                inserted += 1
    return inserted


def upsert_hourly_snapshot(
    conn: sqlite3.Connection, *, hour_ts: int, snapshot: dict[str, Any], dusd_mint: str
) -> bool:
    """
    Upsert snapshot for a given hour bucket.

    This prevents "N/A on first page load" by allowing a startup fetch to populate
    the current hour even if a row already exists, and keeps the "last updated"
    timestamp fresh within the hour.
    """
    with tx(conn):
        cur = conn.execute(
            """
            INSERT INTO token_snapshots_hourly(
                hour_ts, captured_at, dusd_mint, current_supply, total_burned, holder_count,
                price_usd, liquidity_usd, volume_24h, buys_24h, sells_24h,
                price_change_24h_pct, dex_chain_id, dex_id, dex_pair_address
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(hour_ts) DO UPDATE SET
                captured_at=excluded.captured_at,
                dusd_mint=excluded.dusd_mint,
                current_supply=COALESCE(excluded.current_supply, token_snapshots_hourly.current_supply),
                total_burned=COALESCE(excluded.total_burned, token_snapshots_hourly.total_burned),
                holder_count=COALESCE(excluded.holder_count, token_snapshots_hourly.holder_count),
                price_usd=COALESCE(excluded.price_usd, token_snapshots_hourly.price_usd),
                liquidity_usd=COALESCE(excluded.liquidity_usd, token_snapshots_hourly.liquidity_usd),
                volume_24h=COALESCE(excluded.volume_24h, token_snapshots_hourly.volume_24h),
                buys_24h=COALESCE(excluded.buys_24h, token_snapshots_hourly.buys_24h),
                sells_24h=COALESCE(excluded.sells_24h, token_snapshots_hourly.sells_24h),
                price_change_24h_pct=COALESCE(excluded.price_change_24h_pct, token_snapshots_hourly.price_change_24h_pct),
                dex_chain_id=COALESCE(excluded.dex_chain_id, token_snapshots_hourly.dex_chain_id),
                dex_id=COALESCE(excluded.dex_id, token_snapshots_hourly.dex_id),
                dex_pair_address=COALESCE(excluded.dex_pair_address, token_snapshots_hourly.dex_pair_address)
            """,
            (
                hour_ts,
                _now_ts(),
                dusd_mint,
                snapshot.get("current_supply"),
                snapshot.get("total_burned"),
                snapshot.get("holder_count"),
                snapshot.get("price_usd"),
                snapshot.get("liquidity_usd"),
                snapshot.get("volume_24h"),
                snapshot.get("buys_24h"),
                snapshot.get("sells_24h"),
                snapshot.get("price_change_24h_pct"),
                snapshot.get("dex_chain_id"),
                snapshot.get("dex_id"),
                snapshot.get("dex_pair_address"),
            ),
        )
        return cur.rowcount == 1

