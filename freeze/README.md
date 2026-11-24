# Capy Warriors freeze scripts

Port of the audited RISE Phoenix freeze (`rise-phoenix-contract`, branch `feat/freeze-cleanup`, 3dbbed3).
Handover with the full step list: `~/handovers/capy-freeze-build-1.md`.

| Script | Does | Sends? |
|---|---|---|
| `update_royalty.cjs` | final royalty on 500 members + collection; target from `--bps` / `--creator` (required) | only with `--send --confirm-mainnet` |
| `make_uri_map.cjs` | builds `uri_map.json` from a CID map (offline) | never |
| `sweep_uri.cjs` | points URIs at the map; `--verify` checks the pinned JSONs and records the map sha256 | only with `--send --confirm-mainnet` |
| `lock_metadata.cjs` | `lock_metadata` (is_mutable = false), gated on the verified map and the royalty target | only with `--send --confirm-mainnet` |
| `vault_collection.cjs` | moves the collection NFT token into ATA(mint_state) after lock-all | only with `--send --confirm-mainnet` |
| `readonly_checks.cjs` | master editions; simulated update after a lock (expects 59) | never |

Every script needs `--rpc`. No script reads a keypair unless it is sending. `uri_map.expected.json` =
`public/metadata-cids-v2.json` on `https://ipfs.x1forge.xyz` (what is on chain today), sha256 `2c0201cf…adb3`.

Tests: `node freeze/tests/scripts.offline.cjs` (after `cd contract/tests/svm && cargo test --offline`).
The repo-root `update_royalty.cjs` / `sweep_uri.cjs` are the older pre-freeze tools; do not use them for the freeze.
