from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Iterable

import httpx


TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"


class HeliusClient:
    def __init__(self, *, rpc_url: str, parse_tx_url: str, sleep_s: float = 0.35):
        self.rpc_url = rpc_url
        self.parse_tx_url = parse_tx_url
        self.sleep_s = sleep_s
        self._http = httpx.Client(timeout=httpx.Timeout(60.0))

    def close(self) -> None:
        self._http.close()

    def rpc_call(self, method: str, params: list[Any]) -> Any:
        payload = {"jsonrpc": "2.0", "id": "1", "method": method, "params": params}
        r = self._http.post(self.rpc_url, json=payload)
        r.raise_for_status()
        data = r.json()
        if isinstance(data, dict) and data.get("error"):
            raise RuntimeError(str(data["error"]))
        return data.get("result")

    def get_token_supply(self, mint: str) -> dict[str, Any]:
        result = self.rpc_call("getTokenSupply", [mint])
        value = result["value"]
        amount_raw = int(value["amount"])
        decimals = int(value["decimals"])
        ui_amount = amount_raw / (10**decimals)
        return {"mint": mint, "amount_raw": amount_raw, "decimals": decimals, "ui_amount": ui_amount}

    def get_signatures_for_address(self, address: str, *, before: str | None = None, limit: int = 1000) -> list[dict[str, Any]]:
        opts: dict[str, Any] = {"limit": limit}
        if before:
            opts["before"] = before
        result = self.rpc_call("getSignaturesForAddress", [address, opts])
        return list(result or [])

    def parse_transactions(self, signatures: list[str]) -> list[dict[str, Any]]:
        if not signatures:
            return []
        r = self._http.post(self.parse_tx_url, json={"transactions": signatures})
        r.raise_for_status()
        out = r.json()
        return list(out or [])

    def iter_token_accounts_for_mint_v2(self, mint: str, *, limit: int = 1000) -> Iterable[dict[str, Any]]:
        pagination_key = None
        while True:
            params_obj: dict[str, Any] = {
                "encoding": "jsonParsed",
                "limit": limit,
                "filters": [
                    {"dataSize": 165},
                    {"memcmp": {"offset": 0, "bytes": mint}},
                ],
            }
            if pagination_key:
                params_obj["paginationKey"] = pagination_key

            result = self.rpc_call("getProgramAccountsV2", [TOKEN_PROGRAM_ID, params_obj])
            accounts = list((result or {}).get("accounts") or [])
            pagination_key = (result or {}).get("paginationKey")

            for a in accounts:
                yield a

            # pacing: holder fetch can be very heavy
            time.sleep(self.sleep_s)

            if not pagination_key:
                break


def extract_burn_rows(parsed_txs: list[dict[str, Any]], *, mint: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []

    for tx in parsed_txs:
        if not isinstance(tx, dict):
            continue

        tx_type = tx.get("type")
        if tx_type != "BURN":
            continue

        signature = tx.get("signature")
        timestamp = tx.get("timestamp")
        dt = datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat() if timestamp else None

        description = tx.get("description")
        slot = tx.get("slot")
        source = tx.get("source")
        fee = tx.get("fee")

        amount_raw = None
        amount_ui = None
        decimals = None
        from_user = None
        from_token = None

        for tr in tx.get("tokenTransfers", []) or []:
            if tr.get("mint") != mint:
                continue

            raw = tr.get("rawTokenAmount")
            ui = tr.get("tokenAmount")
            dec = tr.get("decimals")

            try:
                amount_raw = int(raw) if raw is not None else None
            except Exception:
                amount_raw = None

            try:
                amount_ui = float(ui) if ui is not None else None
            except Exception:
                amount_ui = None

            try:
                decimals = int(dec) if dec is not None else None
            except Exception:
                decimals = None

            from_user = tr.get("fromUserAccount")
            from_token = tr.get("fromTokenAccount")
            break

        if amount_raw is None:
            events = tx.get("events", {}) or {}
            if isinstance(events, dict):
                for _, v in events.items():
                    if isinstance(v, dict) and v.get("mint") == mint:
                        try:
                            amount_raw = int(v["amount"]) if v.get("amount") is not None else None
                        except Exception:
                            amount_raw = None
                        try:
                            amount_ui = float(v["tokenAmount"]) if v.get("tokenAmount") is not None else None
                        except Exception:
                            amount_ui = None
                        break

        if amount_ui is None and amount_raw is not None:
            if decimals is None:
                decimals = 6
            amount_ui = amount_raw / (10**decimals)

        rows.append(
            {
                "signature": signature,
                "timestamp": timestamp,
                "datetime_utc": dt,
                "type": tx_type,
                "slot": slot,
                "source": source,
                "fee_lamports": fee,
                "amount_raw": amount_raw,
                "amount_ui": amount_ui,
                "decimals": decimals,
                "from_user": from_user,
                "from_token_account": from_token,
                "description": description,
            }
        )

    return rows


def count_unique_nonzero_holders(accounts: Iterable[dict[str, Any]]) -> int:
    owners: set[str] = set()
    for acct in accounts:
        info = (
            (acct or {})
            .get("account", {})
            .get("data", {})
            .get("parsed", {})
            .get("info", {})
        )
        owner = info.get("owner")
        token_amount = info.get("tokenAmount") or {}
        raw_amount = token_amount.get("amount", "0")
        if not owner:
            continue
        if raw_amount == "0":
            continue
        owners.add(owner)
    return len(owners)

