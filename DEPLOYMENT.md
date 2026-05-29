# Capy Warriors — Full Deployment Guide

## Important Addresses

| Item | Value |
|------|-------|
| Program ID | `9TjTjyiz3gpRrTaeGvxi2LTrjjsYmDers7VQVDxo9Zdh` |
| Mint State PDA | `Gpbu72gYwMPbYyaFQjdxAt2c7KV3hzCMqPWPfDYo7DSx` |
| Mint Authority Wallet | `2EMbtMasbwBW4MA3pwqNtQguDJLh5k3GuQ3h4nubtktX` |
| LP Treasury Wallet | `GZuBHE3fQCQ6eSTLMwWKrK15CjtWfA58BmxdtWwG5mJJ` |
| Oracle Operator (Geiger) | `HGFisVbULNKqogtPuGTfcHG9y6i5nboZabYwifkiiodo` |
| Geiger Program | `BxUNg2yo5371BQMZPkfcxdCptFRDHkhvEXNM1QNPBRYU` |

## Keypair File Locations

| Keypair | Path |
|---------|------|
| Mint Authority | `~/.config/solana/capy-mint-authority.json` |
| LP Treasury | `~/.config/solana/capy-lp-treasury.json` |
| Program Keypair | `~/cappy-nft-mint/contract/target/deploy/cappy_mint-keypair.json` |

## Contract Details

| Item | Value |
|------|-------|
| Max Supply | 500 |
| Symbol | CAPY |
| Royalty | 5% (500 basis points) |
| Wave 1 Price | 10 XNT (first 150 mints) |
| Wave 2 Price | 12 XNT (next 150 mints) |
| Wave 3 Price | 15 XNT (final 200 mints) |
| LP Split | 90% of mint price |
| Geiger Split | 10% of mint price |

## Tier System

| Tier | Token Range | Count |
|------|-------------|-------|
| Mythic | 1-30 | 30 |
| Legendary | 31-150 | 120 |
| Common | 151-500 | 350 |

## Metadata API

- **Base URL:** `https://capy-nft-mint.vercel.app/api/metadata/`
- **Example:** `https://capy-nft-mint.vercel.app/api/metadata/1`
- **Metadata CIDs:** `~/cappy-nft-mint/public/metadata-cids.json`

## IPFS Storage (Lighthouse)

- **Images:** 500 files uploaded individually, each with own CID
- **CID Map:** `~/cappy-nft-mint/public/metadata-cids.json`
- **Image tiers:** Mythic 5016x5016 PNG, Legendary 4096x4096 PNG, Common 1024x1024 JPEG
- **Lighthouse Dashboard:** https://files.lighthouse.storage

## DNS Fix (WSL)

If Lighthouse or other services are unreachable from WSL:
```bash
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
```

## Full Deployment Steps

### Step 1 — Prerequisites

```bash
# Check Rust toolchain
rustup show

# Check Anchor version
anchor --version

# Check Solana CLI
solana --version
```

### Step 2 — Configure Solana CLI

```bash
solana config set --keypair /home/skywalker/.config/solana/capy-mint-authority.json
solana config set --url https://rpc.testnet.x1.xyz
solana config get
```

### Step 3 — Build Contract

```bash
cd ~/cappy-nft-mint/contract
anchor build
```

### Step 4 — Deploy Contract

```bash
# This is the command that works reliably:
anchor deploy --provider.cluster https://rpc.testnet.x1.xyz --provider.wallet /home/skywalker/.config/solana/capy-mint-authority.json

# For mainnet:
anchor deploy --provider.cluster https://rpc.mainnet.x1.xyz --provider.wallet /home/skywalker/.config/solana/capy-mint-authority.json
```

### Step 5 — Install Dependencies

```bash
cd ~/cappy-nft-mint/contract
yarn install
```

### Step 6 — Initialize Mint State

```bash
node scripts/initialize.js
```

Saves:
- Mint State PDA: `Gpbu72gYwMPbYyaFQjdxAt2c7KV3hzCMqPWPfDYo7DSx`

### Step 7 — Test Mint

```bash
node scripts/test-mint.js
```

### Step 8 — Verify on Explorer

Check testnet explorer for program and transactions.

## Metadata Setup

### Files Location
```
~/cappy-nft-mint/public/metadata/     ← 500 JSON files (1.json to 500.json)
~/cappy-nft-mint/public/metadata-cids.json  ← CID map
```

### Vercel API Route
```
~/cappy-nft-mint/api/metadata/[id].js  ← not used (static files)
~/cappy-nft-mint/vercel.json           ← rewrites /api/metadata/:id → /metadata/:id.json
```

### Test API
```bash
curl "https://capy-nft-mint.vercel.app/api/metadata/1"
curl "https://capy-nft-mint.vercel.app/api/metadata/31"
curl "https://capy-nft-mint.vercel.app/api/metadata/151"
```

## Image Upload (Lighthouse)

### Upload all 500 images individually
```bash
python3 << 'EOF'
from lighthouseweb3 import Lighthouse
import os, json

KEY = "YOUR_LIGHTHOUSE_API_KEY"
lh = Lighthouse(token=KEY)
images_folder = "/mnt/c/X1/capy/all_images/"
metadata_folder = "/mnt/c/X1/capy/all_metadata/"
cid_map = {}

files = sorted(os.listdir(images_folder), key=lambda x: int(x.split('.')[0]))

for f in files:
    filepath = os.path.join(images_folder, f)
    print(f"Uploading {f}...")
    result = lh.upload(source=filepath)
    cid = result['data']['Hash']
    cid_map[f] = cid
    
    token = f.split('.')[0]
    meta_path = os.path.join(metadata_folder, f"{token}.json")
    if os.path.exists(meta_path):
        with open(meta_path, 'r') as mf:
            data = json.load(mf)
        data['image'] = f"ipfs://{cid}"
        with open(meta_path, 'w') as mf:
            json.dump(data, mf, indent=2, ensure_ascii=False)

with open('/mnt/c/X1/capy/cid_map.json', 'w') as f:
    json.dump(cid_map, f, indent=2)
print("DONE!")
EOF
```

## Mainnet Checklist

Before deploying to mainnet:
- [ ] Test mint works on testnet
- [ ] Images load correctly from IPFS
- [ ] Metadata API returns correct data
- [ ] Wave pricing is correct (10/12/15 XNT)
- [ ] 90/10 split verified in test mint
- [ ] Wallet connect works on website
- [ ] Geiger Oracle addresses are mainnet addresses
- [ ] LP Treasury wallet is funded/ready
- [ ] Website updated with mainnet program ID and PDA

## Wallet Private Keys

Store these securely — NEVER share or commit to git:
- Mint Authority private key: export with `python3 -c "import json,base58; print(base58.b58encode(bytes(json.load(open('/home/skywalker/.config/solana/capy-mint-authority.json')))).decode())"`
- LP Treasury private key: export with `python3 -c "import json,base58; print(base58.b58encode(bytes(json.load(open('/home/skywalker/.config/solana/capy-lp-treasury.json')))).decode())"`
