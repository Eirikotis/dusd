"""Regression coverage for `/api/trading` period-over-period activity metrics."""

import sqlite3
import unittest
from unittest.mock import patch

from app.db import migrate
from app.metrics import trading_metrics


MINT = "So11111111111111111111111111111111111111112"


def _memory_conn() -> sqlite3.Connection:
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    migrate(c)
    return c


def _insert_snapshot(
    conn: sqlite3.Connection,
    *,
    hour_ts: int,
    mint: str = MINT,
    price_usd: float = 1.0,
    liquidity_usd: float = 10_000.0,
    volume_24h: float = 1_000.0,
    buys_24h: int = 100,
    sells_24h: int = 50,
    price_change_24h_pct: float = 0.0,
) -> None:
    conn.execute(
        """
        INSERT INTO token_snapshots_hourly(
            hour_ts, captured_at, dusd_mint, price_usd, liquidity_usd,
            volume_24h, buys_24h, sells_24h, price_change_24h_pct
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            hour_ts,
            hour_ts + 120,
            mint,
            price_usd,
            liquidity_usd,
            volume_24h,
            buys_24h,
            sells_24h,
            price_change_24h_pct,
        ),
    )
    conn.commit()


class TradingMetricsPeriodOverPeriodTest(unittest.TestCase):
    NOW = 3_628_800_000  # hour-aligned (604800 hours / multiple of 3600)

    def setUp(self) -> None:
        assert self.NOW % 3600 == 0, "fixtures assume hour-aligned now"
        self.conn = _memory_conn()

    def tearDown(self) -> None:
        self.conn.close()

    @patch("app.metrics._now_ts", return_value=NOW)
    def test_volume_trades_percent_7d_compares_windows(self, _: object) -> None:
        conn = self.conn
        seven = 7 * 24 * 3600
        # Previous 7d window snapshot (single sample baseline).
        prev_h = self.NOW - seven - seven // 2
        _insert_snapshot(conn, hour_ts=prev_h, volume_24h=200.0, buys_24h=20, sells_24h=20)
        # Current 7d window snapshot (doubled Dex rolling fields → expect +100%).
        curr_h = self.NOW - seven // 3
        _insert_snapshot(conn, hour_ts=curr_h, volume_24h=400.0, buys_24h=40, sells_24h=40)
        latest_h = self.NOW
        _insert_snapshot(
            conn,
            hour_ts=latest_h,
            price_usd=1.23,
            liquidity_usd=50_000.0,
            volume_24h=400.0,
            buys_24h=40,
            sells_24h=40,
            price_change_24h_pct=1.11,
        )
        anchor_h = self.NOW - seven
        _insert_snapshot(
            conn,
            hour_ts=anchor_h,
            price_usd=1.0,
            liquidity_usd=42_424.24,
            # Rolling Dex fields aligned with activity samples — this snapshot is ON the boundary
            # and is included in the current-window estimator.
            volume_24h=400.0,
            buys_24h=40,
            sells_24h=40,
            price_change_24h_pct=0.42,
        )

        row = trading_metrics(conn, window_key="7d", dusd_mint=MINT)
        # One prior-window sample at 200 vs two current-window samples both at 400 → mean doubles → +100%.
        self.assertAlmostEqual(row["volume_change_pct"], 100.0, places=9)
        self.assertAlmostEqual(row["trades_change_pct"], 100.0, places=9)
        self.assertAlmostEqual(row["buys_change_pct"], 100.0, places=9)
        self.assertAlmostEqual(row["sells_change_pct"], 100.0, places=9)

        self.assertAlmostEqual(row["price_change_pct"], (1.23 - 1.0) / 1.0 * 100.0, places=9)
        self.assertAlmostEqual(
            row["liquidity_change_pct"], (50000 - 42424.24) / 42424.24 * 100.0, places=9
        )

    @patch("app.metrics._now_ts", return_value=NOW)
    def test_volume_percent_30d_compares_windows(self, _: object) -> None:
        conn = self.conn
        thirty = 30 * 24 * 3600
        prev_sample = self.NOW - thirty - thirty // 2
        _insert_snapshot(conn, hour_ts=prev_sample, volume_24h=100.0, buys_24h=11, sells_24h=9)
        current_sample = self.NOW - thirty // 2
        _insert_snapshot(conn, hour_ts=current_sample, volume_24h=300.0, buys_24h=33, sells_24h=27)
        anchor = self.NOW - thirty
        _insert_snapshot(
            conn,
            hour_ts=anchor,
            price_usd=2.22,
            liquidity_usd=9_876.54,
            volume_24h=300.0,
            buys_24h=33,
            sells_24h=27,
            price_change_24h_pct=0.07,
        )
        latest = self.NOW
        _insert_snapshot(
            conn,
            hour_ts=latest,
            price_usd=4.44,
            liquidity_usd=12_345.67,
            volume_24h=300.0,
            buys_24h=33,
            sells_24h=27,
            price_change_24h_pct=0.8,
        )
        row = trading_metrics(conn, window_key="30d", dusd_mint=MINT)
        self.assertAlmostEqual(row["volume_change_pct"], 200.0, places=9)
        self.assertAlmostEqual(row["price_change_pct"], (4.44 - 2.22) / 2.22 * 100.0, places=9)

    @patch("app.metrics._now_ts", return_value=NOW)
    def test_day_volume_compares_consecutive_hours(self, _: object) -> None:
        conn = self.conn
        day = 86400
        past_h = self.NOW - day
        anchor_h = past_h - (past_h % 3600)
        _insert_snapshot(
            conn,
            hour_ts=anchor_h,
            price_usd=4.56,
            liquidity_usd=8_080.81,
            volume_24h=500.0,
            buys_24h=51,
            sells_24h=49,
            price_change_24h_pct=0.51,
        )
        latest_h = self.NOW
        latest_h -= latest_h % 3600
        _insert_snapshot(
            conn,
            hour_ts=latest_h,
            price_usd=4.92,
            liquidity_usd=8_989.89,
            volume_24h=1_000.0,
            buys_24h=60,
            sells_24h=40,
            price_change_24h_pct=-1.73,
        )
        row = trading_metrics(conn, window_key="24h", dusd_mint=MINT)
        self.assertAlmostEqual(row["volume_change_pct"], ((1000 - 500) / 500) * 100.0)
        trades_prev = 51 + 49
        trades_curr = 60 + 40
        self.assertAlmostEqual(row["trades_change_pct"], ((trades_curr - trades_prev) / trades_prev * 100.0))
        self.assertAlmostEqual(row["liquidity_change_pct"], ((8989.89 - 8080.81) / 8080.81 * 100.0), places=5)


if __name__ == "__main__":
    unittest.main()
