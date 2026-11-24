# Fixtures (Capy Warriors freeze tests)

All `.so` dumps were taken read-only on 2026-11-24 from X1 mainnet (`solana program dump`, RPC
`http://45.136.213.50:8899`). The two Metaplex/SPL dumps are byte-identical to the fixtures of the
same name in `rise-phoenix-contract/tests/svm/fixtures` (3dbbed3).

| File | sha256 | Source |
|---|---|---|
| `capy_live_19d455a.so` | `879fecabe61ae8441a305010c413588440f11cf03955c120904506bef912e130` | `cargo build-sbf` of commit `19d455a` (clean `git archive`, offline), 425,904 B. Equal to the mainnet program `6r9HZKQR…` (429,528 B program data, last deployed slot 80,523,850) with its trailing zero padding removed; the first 425,904 bytes are identical and the remaining 3,624 bytes are zero. `setup()` builds the test state with this binary (it still has `create_collection`, `create_member_master_edition`, `verify_collection`), then upgrades in place to the freeze build. |
| `mpl_token_metadata_x1_mainnet.so` | `bb0842f6d5740eabe8f9fb3b723b9ecd89cadf9f48ef9ad6a9dc6cfa8a9658e4` | X1 mainnet Token Metadata `metaqbxx…`, 1,295,344 B, programdata `PwDiXFxQ…`, last deployed slot 28,828,865, upgrade authority `X1TMEC99KMa4MGEKfcrSJ6HZTiwvPVyrwQczZjuCoLV`. Used by EVERY test (it writes the 607-byte metadata accounts mainnet has). |
| `spl_token_x1_mainnet.so` | `8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce1f806f2b6237f3311a98f697` | X1 mainnet SPL Token `Tokenkeg…`, 108,600 B, last deployed slot 85,798,112, upgrade authority **none**. Used by every test (replaces LiteSVM's bundled copy). |
| `mainnet/member1_GZuB_100bps.bin` | `f1f6ae4fb584b308562e6b41f44c81a3647ea30070b38fd94cca0e2a77626e4e` | Metadata `35RvpUn7…EZUU` of "Capy Warrior #1" (mint `2pniefwo…qAu8`), 607 B: 100 bps, `[GZuB:100 verified]`, collection `HC8zqrya…` verified, uri on `ipfs.x1forge.xyz`. All 500 members have this shape. |
| `mainnet/collection_Cx6vNq7.bin` | `b7f2098bb8deb1594d37023058b99d2f612194fdbf0b14a3125d2fab440b4a36` | Collection NFT metadata `Cx6vNq7c…YvfW` (mint `HC8zqrya…`), 607 B: "CAPY Warriors", 500 bps, `[mint_state:100 verified]`, uri `https://capy-nft-mint.vercel.app/api/metadata/collection`, sized collection, size 500. |

The freeze build under test is NOT a fixture: `$CAPY_FREEZE_SO`, else `../../target/deploy/cappy_mint.so`.
The harness refuses to run if that file is the live binary.
