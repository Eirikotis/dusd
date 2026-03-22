from __future__ import annotations

from typing import Any

import httpx


class DexScreenerClient:
    def __init__(self):
        self._http = httpx.Client(timeout=httpx.Timeout(30.0))

    def close(self) -> None:
        self._http.close()

    def fetch_pairs(self, *, chain_id: str, token_address: str) -> list[dict[str, Any]]:
        url = f"https://api.dexscreener.com/token-pairs/v1/{chain_id}/{token_address}"
        r = self._http.get(url)
        r.raise_for_status()
        data = r.json()
        return list(data or [])

    @staticmethod
    def choose_best_pair_by_liquidity_usd(pairs: list[dict[str, Any]]) -> dict[str, Any] | None:
        if not pairs:
            return None

        def liq_usd(p: dict[str, Any]) -> float:
            liq = p.get("liquidity") or {}
            try:
                return float(liq.get("usd") or 0)
            except Exception:
                return 0.0

        return sorted(pairs, key=liq_usd, reverse=True)[0]

    @staticmethod
    def parse_snapshot(best_pair: dict[str, Any] | None) -> dict[str, Any]:
        if not best_pair:
            return {
                "dex_chain_id": None,
                "dex_id": None,
                "dex_pair_address": None,
                "price_usd": None,
                "liquidity_usd": None,
                "volume_24h": None,
                "buys_24h": None,
                "sells_24h": None,
                "trades_24h": None,
                "price_change_24h_pct": None,
            }

        vol = (best_pair.get("volume") or {})
        liq = (best_pair.get("liquidity") or {})

        def f(x) -> float | None:
            try:
                return float(x)
            except Exception:
                return None

        # Exact Dex mapping: trades only null when `txns` is missing (key absent or null).
        txns_raw = best_pair.get("txns")
        buys_24h: int | None
        sells_24h: int | None
        trades_24h: int | None
        if txns_raw is None:
            buys_24h = sells_24h = trades_24h = None
        else:
            txns_24h = ((txns_raw or {}).get("h24") or {})
            if not isinstance(txns_24h, dict):
                txns_24h = {}
            buys_24h = int(txns_24h.get("buys") or 0)
            sells_24h = int(txns_24h.get("sells") or 0)
            trades_24h = buys_24h + sells_24h

        price_change_24h_pct = float(((best_pair.get("priceChange") or {}).get("h24")) or 0)

        return {
            "dex_chain_id": best_pair.get("chainId"),
            "dex_id": best_pair.get("dexId"),
            "dex_pair_address": best_pair.get("pairAddress"),
            "price_usd": f(best_pair.get("priceUsd")),
            "liquidity_usd": f(liq.get("usd")),
            "volume_24h": f(vol.get("h24")),
            "buys_24h": buys_24h,
            "sells_24h": sells_24h,
            "trades_24h": trades_24h,
            "price_change_24h_pct": price_change_24h_pct,
        }

