from __future__ import annotations

import os
from dataclasses import dataclass


def _env(key: str, default: str | None = None) -> str | None:
    v = os.getenv(key)
    if v is None or v == "":
        return default
    return v


@dataclass(frozen=True)
class Settings:
    dusd_mint: str
    helius_api_key: str | None

    seed_burn_csv: str
    sqlite_path: str

    host: str
    port: int

    run_scheduler: bool
    sync_on_start: bool

    sig_page_size: int
    max_sig_pages: int
    parse_batch_size: int
    helius_sleep_s: float

    original_supply: float

    @property
    def helius_rpc_url(self) -> str | None:
        if not self.helius_api_key:
            return None
        return f"https://mainnet.helius-rpc.com/?api-key={self.helius_api_key}"

    @property
    def helius_parse_tx_url(self) -> str | None:
        if not self.helius_api_key:
            return None
        return f"https://api-mainnet.helius-rpc.com/v0/transactions?api-key={self.helius_api_key}"


def load_settings() -> Settings:
    dusd_mint = _env("DUSD_MINT", "").strip()
    if not dusd_mint:
        raise RuntimeError("Missing DUSD_MINT in environment.")

    helius_api_key = _env("HELIUS_API_KEY")

    return Settings(
        dusd_mint=dusd_mint,
        helius_api_key=helius_api_key,
        seed_burn_csv=_env("SEED_BURN_CSV", "../data/dusd_burn_log.csv") or "../data/dusd_burn_log.csv",
        sqlite_path=_env("SQLITE_PATH", "./data/dusd.db") or "./data/dusd.db",
        host=_env("HOST", "127.0.0.1") or "127.0.0.1",
        port=int(_env("PORT", "8787") or "8787"),
        run_scheduler=(_env("RUN_SCHEDULER", "1") or "1") == "1",
        sync_on_start=(_env("SYNC_ON_START", "1") or "1") == "1",
        sig_page_size=int(_env("SIG_PAGE_SIZE", "1000") or "1000"),
        max_sig_pages=int(_env("MAX_SIG_PAGES", "5") or "5"),
        parse_batch_size=int(_env("PARSE_BATCH_SIZE", "100") or "100"),
        helius_sleep_s=float(_env("HELIUS_SLEEP_S", "0.35") or "0.35"),
        original_supply=float(_env("ORIGINAL_SUPPLY", "1000000000") or "1000000000"),
    )

