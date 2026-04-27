#!/usr/bin/env python3
"""
CAPPY NFT Generator — Layered Trait System
3 tier bases → unique combos per mint, derived from Geiger entropy bytes.

Usage:
  python3 cappy-generator.py <mint_id> <entropy_hex>

Output: composite PNG + metadata JSON
"""

import json
import os
import sys
import hashlib
from pathlib import Path
from PIL import Image

# ── Config ──────────────────────────────────────────────
TRAITS_DIR = Path(__file__).parent / "public" / "traits"
OUTPUT_DIR = Path(__file__).parent / "public" / "generated"
IMG_WIDTH = 1000
IMG_HEIGHT = 1000

# ── Tier mapping (same odds as frontend) ────────────────
def tier_from_value(val):
    """val is 0.0-1.0 float derived from entropy bytes"""
    if val < 0.05:
        return "LEGENDARY"
    elif val < 0.30:
        return "MYTHIC"
    else:
        return "COMMON"

# ── Trait Definitions ───────────────────────────────────
TRAIT_DEFS = {
    "background": {
        "order": 0,
        "options": ["swamp", "forest", "hotspring", "sunset", "riverbank", "tropical"],
    },
    "hat": {
        "order": 1,
        "options": ["none", "crown", "flower", "bucket_hat", "top_hat", "beanie", "safari"],
    },
    "accessory": {
        "order": 2,
        "options": ["none", "necklace", "sunglasses", "monocle", "scarf", "earring"],
    },
    "expression": {
        "order": 3,
        "options": ["chill", "surprised", "smug", "zen", "derp", "happy"],
    },
    "companion": {
        "order": 4,
        "options": ["none", "duck", "turtle", "butterfly", "frog", "bird"],
    },
}

# ── Entropy → Trait Selection ──────────────────────────
def entropy_to_traits(entropy_hex: str) -> dict:
    """
    Derive tier + all traits from Geiger entropy bytes.
    Uses different byte ranges for each trait to avoid correlation.
    """
    entropy_bytes = bytes.fromhex(entropy_hex[:64])  # first 32 bytes

    # Tier from first 8 bytes
    tier_val = int.from_bytes(entropy_bytes[0:8], 'big') / (2**64)
    tier = tier_from_value(tier_val)

    traits = {"tier": tier}

    # Each trait uses 4 bytes from a different offset
    for i, (trait_name, trait_def) in enumerate(TRAIT_DEFS.items()):
        offset = 8 + (i * 4)
        chunk = entropy_bytes[offset:offset+4]
        val = int.from_bytes(chunk, 'big') % len(trait_def["options"])
        traits[trait_name] = trait_def["options"][val]

    return traits

# ── Image Composition ───────────────────────────────────
def compose_image(traits: dict, output_path: str):
    """
    Layer trait PNGs on top of tier base.
    Each trait is a transparent PNG with the same dimensions.
    """
    canvas = Image.new("RGBA", (IMG_WIDTH, IMG_HEIGHT), (0, 0, 0, 0))

    # Layer order: base → background → hat → accessory → expression → companion
    layers = ["background", "hat", "accessory", "expression", "companion"]

    # Tier base first
    base_path = TRAITS_DIR / "base" / f"{traits['tier'].lower()}.png"
    if base_path.exists():
        canvas = Image.alpha_composite(canvas, Image.open(base_path).convert("RGBA").resize((IMG_WIDTH, IMG_HEIGHT)))

    # Then trait layers
    for trait_name in layers:
        trait_value = traits.get(trait_name, "none")
        if trait_value == "none":
            continue
        layer_path = TRAITS_DIR / trait_name / f"{trait_value}.png"
        if layer_path.exists():
            layer = Image.open(layer_path).convert("RGBA").resize((IMG_WIDTH, IMG_HEIGHT))
            canvas = Image.alpha_composite(canvas, layer)

    canvas.save(output_path, "PNG")

# ── Metadata Generation ────────────────────────────────
def generate_metadata(mint_id: str, traits: dict, image_url: str) -> dict:
    """Generate Metaplex-compatible metadata JSON"""
    tier_emoji = {"COMMON": "🦫", "MYTHIC": "✨", "LEGENDARY": "👑"}[traits["tier"]]

    attributes = []
    # Tier as attribute
    attributes.append({"trait_type": "Tier", "value": traits["tier"].capitalize()})
    # Other traits
    for trait_name in ["background", "hat", "accessory", "expression", "companion"]:
        val = traits.get(trait_name, "none")
        if val != "none":
            attributes.append({"trait_type": trait_name.replace("_", " ").title(), "value": val.replace("_", " ").title()})

    return {
        "name": f"{tier_emoji} Cappy #{mint_id}",
        "symbol": "CAPPY",
        "description": f"A {traits['tier'].lower()} Cappy NFT — unique capybara on X1 Network, born from Geiger entropy.",
        "image": image_url,
        "attributes": attributes,
        "properties": {
            "files": [{"uri": image_url, "type": "image/png"}],
            "category": "image",
            "creators": [],
        },
    }

# ── Main ────────────────────────────────────────────────
def main():
    if len(sys.argv) < 3:
        print("Usage: python3 cappy-generator.py <mint_id> <entropy_hex>")
        sys.exit(1)

    mint_id = sys.argv[1]
    entropy_hex = sys.argv[2]

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    traits = entropy_to_traits(entropy_hex)

    # Generate image
    img_path = OUTPUT_DIR / f"{mint_id}.png"
    compose_image(traits, str(img_path))

    # Generate metadata
    # In production, image_url would point to the hosted file
    image_url = f"https://cappy-nft-mint.vercel.app/generated/{mint_id}.png"
    metadata = generate_metadata(mint_id, traits, image_url)

    meta_path = OUTPUT_DIR / f"{mint_id}.json"
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"✅ Cappy #{mint_id}")
    print(f"   Tier: {traits['tier']}")
    print(f"   Traits: {', '.join(f'{k}={v}' for k, v in traits.items() if k != 'tier')}")
    print(f"   Image: {img_path}")
    print(f"   Metadata: {meta_path}")

if __name__ == "__main__":
    main()