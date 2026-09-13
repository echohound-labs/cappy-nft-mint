# CAPY Warriors — IPFS Manifest

## Metadata directory CID
bafybeiffef6y4pknukwq7di27yeux7dx3p27q654d35qp7t23u2up3ngnq
- 500 files, 504,613 bytes, `<CID>/N.json` for N in 1..500
- Source: `public/metadata/` in this repo
- Uploaded to Lighthouse 2026-09-04 via web UI (folder upload)

## Art CIDs
See `cid_map.json` — 500 entries keyed by token ID.
`1.png`–`150.png` (Mythic + Legendary), `151.jpg`–`500.jpg` (Commons).

## Masters
9.7GB, not in this repo. `all_images/` (150) + `common_output/` (350).

## Recovery
CIDs derive from content. Re-upload the same files to any pinning
service and the identical CIDs come back — no on-chain change needed.

## Reproducing CIDs — VERIFIED 2026-09-13

All 500 art CIDs in `cid_map.json` reproduce exactly from the masters using:

    ipfs add -q --cid-version 0 --chunker=size-1048576 <file>

Note the 1MB chunker — kubo's 256KB default produces DIFFERENT CIDs.

Source files: `all_images/` — `1.png`–`150.png` (Mythic + Legendary),
`151.jpg`–`500.jpg` (Commons). Masters are byte-identical to what is
hosted (verified by sha256 against the gateway copy).

Census result: MATCH 500, MISMATCH 0, MISSING 0.

Recovery: re-upload the same files to any pinning service with these
flags — identical CIDs come back, every NFT resolves, no on-chain
change and no keys required.
