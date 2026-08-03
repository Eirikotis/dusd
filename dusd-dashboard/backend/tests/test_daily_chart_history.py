"""Coverage for the shared burn and daily-price chart history."""

import sqlite3
import unittest
from datetime import UTC, datetime

from app.db import migrate
from app.metrics import daily_burn_totals


MINT = "So11111111111111111111111111111111111111112"


def _utc_ts(value: str) -> int:
    return int(datetime.strptime(value, "%Y-%m-%d %H:%M").replace(tzinfo=UTC).timestamp())


class DailyChartHistoryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        migrate(self.conn)

    def tearDown(self) -> None:
        self.conn.close()

    def _snapshot(self, captured_at: int, price: float, mint: str = MINT) -> None:
        hour_ts = captured_at - (captured_at % 3600)
        self.conn.execute(
            """
            INSERT INTO token_snapshots_hourly(hour_ts, captured_at, dusd_mint, price_usd)
            VALUES (?, ?, ?, ?)
            """,
            (hour_ts, captured_at, mint, price),
        )

    def _burn(self, timestamp: int, amount: float, signature: str) -> None:
        self.conn.execute(
            """
            INSERT INTO burn_events(signature, timestamp, amount_ui, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (signature, timestamp, amount, timestamp),
        )

    def test_uses_daily_close_and_keeps_cumulative_total(self) -> None:
        self._burn(_utc_ts("2026-07-01 08:00"), 10.0, "burn-1")
        self._burn(_utc_ts("2026-07-03 08:00"), 5.0, "burn-2")
        self._snapshot(_utc_ts("2026-07-01 09:00"), 0.10)
        self._snapshot(_utc_ts("2026-07-01 22:00"), 0.12)
        self._snapshot(_utc_ts("2026-07-02 22:00"), 0.15)
        self.conn.commit()

        points = daily_burn_totals(self.conn, days=90, dusd_mint=MINT)

        self.assertEqual(
            [point["day"] for point in points],
            ["2026-07-01", "2026-07-02", "2026-07-03"],
        )
        self.assertEqual([point["total_ui"] for point in points], [10.0, 0.0, 5.0])
        self.assertEqual([point["cumulative_ui"] for point in points], [10.0, 10.0, 15.0])
        self.assertEqual(points[0]["price_usd"], 0.12)
        self.assertEqual(points[1]["price_usd"], 0.15)
        self.assertIsNone(points[2]["price_usd"])

    def test_ignores_price_snapshots_for_other_mints(self) -> None:
        self._snapshot(_utc_ts("2026-07-01 20:00"), 0.12)
        self._snapshot(_utc_ts("2026-07-02 20:00"), 99.0, mint="other-mint")
        self.conn.commit()

        points = daily_burn_totals(self.conn, days=90, dusd_mint=MINT)

        self.assertEqual(len(points), 1)
        self.assertEqual(points[0]["price_usd"], 0.12)


if __name__ == "__main__":
    unittest.main()