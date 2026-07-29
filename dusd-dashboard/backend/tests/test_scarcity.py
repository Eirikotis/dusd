from __future__ import annotations

import sqlite3
import unittest
from datetime import date
from unittest.mock import patch

from app.db import migrate
from app.scarcity import build_gold_observations, scarcity_dashboard


def _memory_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    migrate(conn)
    return conn


class ScarcityMetricsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.conn = _memory_conn()

    def tearDown(self) -> None:
        self.conn.close()

    @patch("app.scarcity._utc_today", return_value=date(2026, 7, 28))
    def test_gold_backfill_is_daily_and_expanding(self, _: object) -> None:
        rows = build_gold_observations(days=141)
        self.assertEqual(len(rows), 141)
        self.assertEqual(rows[0]["observed_on"], "2026-03-10")
        self.assertEqual(rows[-1]["observed_on"], "2026-07-28")
        self.assertTrue(rows[-1]["value"] > rows[0]["value"])
        self.assertTrue(all(row["is_estimated"] for row in rows))

    @patch("app.scarcity._utc_today", return_value=date(2026, 7, 28))
    def test_common_index_and_m2_ratio(self, _: object) -> None:
        fixtures = {
            "DUSD": [("2026-07-26", 700_000_000), ("2026-07-27", 690_000_000), ("2026-07-28", 680_000_000)],
            "BTC": [("2026-07-26", 19_900_000), ("2026-07-27", 19_900_100), ("2026-07-28", 19_900_200)],
            "GOLD": [("2026-07-26", 220_000), ("2026-07-27", 220_010), ("2026-07-28", 220_020)],
            "M2": [("2026-07-01", 23_000)],
        }
        for asset, points in fixtures.items():
            for observed_on, value in points:
                self.conn.execute(
                    """
                    INSERT INTO scarcity_observations(
                        asset, observed_on, value, unit, source, source_frequency,
                        is_estimated, methodology, fetched_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (asset, observed_on, value, asset, "test", "test", asset == "GOLD", "test", 1),
                )
        self.conn.commit()

        payload = scarcity_dashboard(self.conn)
        self.assertEqual(payload["window"]["start"], "2026-07-26")
        self.assertEqual(payload["window"]["days"], 3)
        dusd = next(row for row in payload["series"] if row["asset"] == "DUSD")
        self.assertAlmostEqual(dusd["points"][0]["index"], 100.0)
        self.assertAlmostEqual(dusd["points"][-1]["index"], 97.142857, places=5)
        self.assertAlmostEqual(payload["ratio"]["current"], 680_000_000 / (23_000 * 1000))
        self.assertEqual(payload["ratio"]["period_days"], 3)
        expected_annualized = ((680_000_000 / 700_000_000) ** (365.2425 / 2) - 1) * 100
        self.assertAlmostEqual(payload["ratio"]["annualized_change_pct"], expected_annualized)

    @patch("app.scarcity._utc_today", return_value=date(2026, 7, 28))
    def test_window_uses_first_dusd_observation_without_a_maximum(self, _: object) -> None:
        fixtures = {
            "DUSD": [("2025-07-28", 800_000_000), ("2026-07-28", 680_000_000)],
            "BTC": [("2025-07-28", 19_800_000), ("2026-07-28", 19_900_200)],
            "GOLD": [("2025-07-28", 218_000), ("2026-07-28", 220_020)],
            "M2": [("2025-07-01", 22_000), ("2026-07-01", 23_000)],
        }
        for asset, points in fixtures.items():
            for observed_on, value in points:
                self.conn.execute(
                    """
                    INSERT INTO scarcity_observations(
                        asset, observed_on, value, unit, source, source_frequency,
                        is_estimated, methodology, fetched_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (asset, observed_on, value, asset, "test", "test", asset == "GOLD", "test", 1),
                )
        self.conn.commit()

        payload = scarcity_dashboard(self.conn)
        self.assertEqual(payload["window"]["start"], "2025-07-28")
        self.assertEqual(payload["window"]["days"], 366)

    @patch("app.scarcity._utc_today", return_value=date(2026, 7, 28))
    def test_market_cap_parity_uses_current_dusd_supply(self, _: object) -> None:
        observations = {
            "DUSD": ("2026-07-28", 680_000_000),
            "BTC": ("2026-07-28", 20_000_000),
            "GOLD": ("2026-07-28", 220_000),
            "M2": ("2026-07-01", 23_000),
        }
        for asset, (observed_on, value) in observations.items():
            self.conn.execute(
                """
                INSERT INTO scarcity_observations(
                    asset, observed_on, value, unit, source, source_frequency,
                    is_estimated, methodology, fetched_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (asset, observed_on, value, asset, "test", "test", asset == "GOLD", "test", 1),
            )
        self.conn.execute(
            """
            INSERT INTO token_snapshots_hourly(
                hour_ts, captured_at, dusd_mint, current_supply, price_usd
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (1, 100, "mint", 680_000_000, 0.00012),
        )
        for asset, price in (("BTC", 120_000), ("GOLD", 3_500)):
            self.conn.execute(
                """
                INSERT INTO scarcity_market_prices(
                    asset, price_usd, proxy_asset, source, source_url,
                    source_updated_at, fetched_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (asset, price, asset, "test", "https://example.com", 90, 100),
            )
        self.conn.commit()

        payload = scarcity_dashboard(self.conn)
        market = payload["market_cap"]
        self.assertAlmostEqual(market["current"]["market_cap_usd"], 81_600)
        scenarios = {row["asset"]: row for row in market["scenarios"]}
        self.assertAlmostEqual(scenarios["BTC"]["market_cap_usd"], 2_400_000_000_000)
        self.assertAlmostEqual(
            scenarios["BTC"]["implied_dusd_price_usd"],
            2_400_000_000_000 / 680_000_000,
        )
        self.assertAlmostEqual(scenarios["M2"]["market_cap_usd"], 23_000_000_000_000)


if __name__ == "__main__":
    unittest.main()
