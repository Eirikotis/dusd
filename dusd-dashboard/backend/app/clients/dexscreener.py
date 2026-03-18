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
                "price_change_24h_pct": None,
            }

        tx24 = ((best_pair.get("txns") or {}).get("h24") or {})
        vol = (best_pair.get("volume") or {})
        liq = (best_pair.get("liquidity") or {})
        pc = (best_pair.get("priceChange") or {})

        def f(x) -> float | None:
            try:
                return float(x)
            except Exception:
                return None

        def i(x) -> int | None:
            try:
                return int(x)
            except Exception:
                return None

        return {
            "dex_chain_id": best_pair.get("chainId"),
            "dex_id": best_pair.get("dexId"),
            "dex_pair_address": best_pair.get("pairAddress"),
            "price_usd": f(best_pair.get("priceUsd")),
            "liquidity_usd": f(liq.get("usd")),
            "volume_24h": f(vol.get("h24")),
            "buys_24h": i(tx24.get("buys")),
            "sells_24h": i(tx24.get("sells")),
            "price_change_24h_pct": f(pc.get("h24")),
        }

