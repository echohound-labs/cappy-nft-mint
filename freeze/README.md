# Capy Warriors freeze scripts

Port of the audited RISE Phoenix freeze (`rise-phoenix-contract`, branch `feat/freeze-cleanup`, 3dbbed3).
Handover with the full step list: `~/handovers/capy-freeze-build-1.md`.

| Script | Does | Sends? |
|---|---|---|
| `update_royalty.cjs` | final royalty on 500 members + collection; target from `--bps` / `--creator` (required) | only with `--send --confirm-mainnet` |
| `pin_metadata.cjs` | pins the 500 member JSONs + collection image/JSON as bare files, verifies each by GET + sha256, writes `uri_map.json` | uploads only with `--execute` (reads the JWT only then) |
| `make_uri_map.cjs` | builds `uri_map.json` from a CID map (offline) | never |
| `sweep_uri.cjs` | points URIs at the map; `--verify` checks the pinned JSONs and records the map sha256 | only with `--send --confirm-mainnet` |
| `lock_metadata.cjs` | `lock_metadata` (is_mutable = false), gated on the verified map and the royalty target | only with `--send --confirm-mainnet` |
| `vault_collection.cjs` | moves the collection NFT token into ATA(mint_state) after lock-all | only with `--send --confirm-mainnet` |
| `readonly_checks.cjs` | master editions; simulated update after a lock (expects 59) | never |

Every chain script needs `--rpc`. No script reads a keypair unless it is sending.

Content (follow-up 1): every member JSON has `external_url` https://x1forge.xyz/collection/capy and the name
`Capy Warrior #N`; #4 is the Energy Sword version; the collection JSON's image is on the gateway.
What gets pinned = `JSON.stringify(repo file with image on https://ipfs.x1forge.xyz/ipfs/<same CID>, null, 2)`.
`metadata-cids-v3.json` = the 500 member CIDs of that content; `uri_map.expected.json` = those + the collection JSON
(`QmXEiV3L…khPfv`), sha256 `38aac4ccf0df8aed9201e6ba65955856336f87ebdbe17fa47bc47e2f73dea635`
(`node freeze/make_uri_map.cjs --cids freeze/metadata-cids-v3.json --gateway https://ipfs.x1forge.xyz --collection-cid QmXEiV3LR2J6ymj29mLVfomiwxNCVUn4EFCkdzQqMkhPfv`).
`public/metadata-cids-v2.json` = what is on chain before the sweep (the undo map before any lock).

Tests: `node freeze/tests/scripts.offline.cjs` (after `cd contract/tests/svm && cargo test --offline`).
The repo-root `update_royalty.cjs` / `sweep_uri.cjs` are the older pre-freeze tools; do not use them for the freeze.
