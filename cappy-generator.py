#!/usr/bin/env python3
"""
CAPPY NFT Generator — Layered Trait System v2
3 tier bases → environment-aware tinting → unique combos per mint, derived from Geiger entropy bytes.

Usage:
  python3 cappy-generator.py <mint_id> <entropy_hex>
  python3 cappy-generator.py batch <count> [output_dir]

Output: composite PNG + metadata JSON
"""

import json
import os
import sys
import hashlib
from pathlib import Path

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

# ── Config ──────────────────────────────────────────────
TRAITS_DIR = Path(__file__).parent / "public" / "traits"
OUTPUT_DIR = Path(__file__).parent / "public" / "generated"
IMG_WIDTH = 1000
IMG_HEIGHT = 1000

# ── Supply Cap ─────────────────────────────────────────
MAX_SUPPLY = 1000

# ── Trait Definitions with LOCKED Rarity Weights ───────
TRAIT_DEFS = {
    "background": {
        "order": 0,
        "options": {
            "swamp":      1/6,
            "forest":     1/6,
            "lava_core":  1/6,
            "neon_city":  1/6,
            "ocean_lab":  1/6,
            "space_grid": 1/6,
        },
    },
    "expression": {
        "order": 1,
        "options": {
            "chill":      0.28,
            "happy":      0.25,
            "smug":       0.20,
            "surprised":  0.13,
            "zen":        0.08,
            "derp":       0.06,
        },
    },
    "hat": {
        "order": 2,
        "options": {
            "none":          0.35,
            "beanie":        0.22,
            "bucket_hat":    0.17,
            "safari":        0.12,
            "flower_crown":  0.07,
            "top_hat":       0.04,
            "crown":         0.03,
        },
    },
    "accessory": {
        "order": 3,
        "options": {
            "none":             0.35,
            "dog_tags":         0.22,
            "scarf":            0.17,
            "tactical_goggles": 0.12,
            "bandolier":        0.07,
            "monocle":          0.04,
            "earring":          0.03,
        },
    },
    "companion": {
        "order": 4,
        "options": {
            "none":       0.55,
            "duck":       0.15,
            "turtle":     0.12,
            "frog":       0.08,
            "butterfly":  0.06,
            "bird":       0.04,
        },
    },
}

# ── Tier mapping (locked: 70/25/5) ────────────────────
def tier_from_value(val):
    if val < 0.05:
        return "LEGENDARY"
    elif val < 0.30:
        return "MYTHIC"
    else:
        return "COMMON"

# ── Environment-Aware Tint Palettes ────────────────────
TINT_PALETTES = {
    "swamp":      {"hue_shift": 90,  "saturation": 1.2, "brightness": 0.85, "glow_color": [100, 200, 80, 40],  "style": "mossy, organic, vine-covered, bioluminescent"},
    "forest":     {"hue_shift": 60,  "saturation": 1.1, "brightness": 0.9,  "glow_color": [80, 160, 60, 30],   "style": "bark-textured, leafy, trail-worn"},
    "lava_core":  {"hue_shift": -20, "saturation": 1.4, "brightness": 1.1,  "glow_color": [255, 100, 20, 60],  "style": "molten, ember-glow, soot-stained, heat shimmer"},
    "neon_city":  {"hue_shift": 180, "saturation": 1.5, "brightness": 1.15, "glow_color": [0, 255, 255, 50],   "style": "chrome, LED strips, holographic, matte black"},
    "ocean_lab":  {"hue_shift": 150, "saturation": 1.2, "brightness": 0.95, "glow_color": [60, 180, 200, 35],  "style": "coral, sea-glass, salt-crusted, bubble accents"},
    "space_grid": {"hue_shift": 210, "saturation": 0.8, "brightness": 1.2,  "glow_color": [180, 200, 255, 45],  "style": "silver, starlight, reflective, constellation patterns"},
}

# ── Hat × Environment Detail Map ──────────────────────
HAT_ENV_DETAILS = {
    "beanie":        {"swamp": "mossy knit, vine stitch pattern",       "forest": "dark green wool, bark texture",          "lava_core": "burnt orange, soot stains, ember thread",      "neon_city": "matte black with cyan LED stripe",             "ocean_lab": "teal knit, water bead droplets",             "space_grid": "silver thermal, star patch"},
    "bucket_hat":    {"swamp": "camo, mud stains, swamp gear",        "forest": "bark brown, leaf print band",            "lava_core": "charcoal, ember dots, heat vents",            "neon_city": "holographic UV, neon rim",                    "ocean_lab": "navy, salt-crusted, coral band",             "space_grid": "void black, constellation pattern"},
    "safari":        {"swamp": "worn khaki, swamp mud, mosquito net",  "forest": "deep green, trail dust, leaf pockets",   "lava_core": "desert tan, heat shimmer, vented crown",      "neon_city": "matte black, neon visor, comms patch",       "ocean_lab": "white, coral accent, waterproof",             "space_grid": "white, reflective strip, mission patch"},
    "flower_crown":  {"swamp": "living orchids, dripping moss",        "forest": "autumn leaves and berries",              "lava_core": "flame petals, smoking stems",                  "neon_city": "neon pixel flowers, LED bloom",               "ocean_lab": "sea anemone bloom, pearl accents",           "space_grid": "crystal ice flowers, stardust pollen"},
    "top_hat":       {"swamp": "mossy velvet, vine band",             "forest": "bark textured, leaf carving",            "lava_core": "obsidian, lava vein stripe",                   "neon_city": "chrome, LED band, holographic",              "ocean_lab": "deep sea blue, pearl band, bubble accents",  "space_grid": "matte white, glow ring, constellation"},
    "crown":         {"swamp": "ancient gold, moss patina, hanging vines", "forest": "dark bronze, leaf carvings, bark inlay", "lava_core": "molten metal, ember glow, fire tips",      "neon_city": "chrome, cyan LED strip, holographic sheen",  "ocean_lab": "coral gold, bubble tips, pearl accents",     "space_grid": "white gold, starlight shimmer, constellation band"},
}

# ── Accessory × Environment Detail Map ─────────────────
ACCESSORY_ENV_DETAILS = {
    "dog_tags":         {"swamp": "tarnished brass, mud-smeared",      "forest": "olive drab, bark scratches",            "lava_core": "blackened metal, ember glow",                "neon_city": "matte black, glowing engraving",             "ocean_lab": "coral-accented, water droplet",              "space_grid": "silver, laser-etched, star map"},
    "scarf":            {"swamp": "mossy green, damp, vine-wrapped",   "forest": "earthy brown, leaf pattern",            "lava_core": "charcoal, ember thread, heat-resistant",      "neon_city": "black, neon stripe, LED weave",              "ocean_lab": "teal, water-beaded, coral clasp",            "space_grid": "silver thermal, star pattern"},
    "tactical_goggles":{"swamp": "fogged lenses, moss strap",         "forest": "amber lenses, bark frame",               "lava_core": "smoked lenses, heat vent frame",              "neon_city": "holographic visor, LED HUD",                  "ocean_lab": "polarized blue, salt-cracked",               "space_grid": "UV visor, constellation HUD"},
    "bandolier":        {"swamp": "rotting leather, vine loops",       "forest": "bark-leather, moss pouches",             "lava_core": "heat-forged metal, ember pouches",           "neon_city": "carbon fiber, LED pouch indicators",         "ocean_lab": "coral buckle, waterproof pods",              "space_grid": "sleek alloy, magnetic clasps"},
    "monocle":          {"swamp": "tarnished gold, vine chain",        "forest": "wood frame, leaf engraving",             "lava_core": "obsidian rim, ember lens tint",              "neon_city": "chrome rim, holographic lens",              "ocean_lab": "pearl frame, blue lens tint",                 "space_grid": "platinum, star map lens"},
    "earring":          {"swamp": "mossy hoop, bioluminescent",       "forest": "leaf-shaped, bark texture",              "lava_core": "ember drop, fire glow",                      "neon_city": "LED stud, holographic",                      "ocean_lab": "pearl drop, bubble accent",                  "space_grid": "starlight gem, constellation"},
}

# ── Companion × Environment Detail Map ─────────────────
COMPANION_ENV_DETAILS = {
    "duck":      {"swamp": "swamp duck, mossy feathers",              "forest": "wood duck, leafy camo",               "lava_core": "ceramic heat-resistant, ember beak",         "neon_city": "LED duck, neon outline",                     "ocean_lab": "rubber duck, classic",                       "space_grid": "zero-G floating, silver feathers"},
    "turtle":    {"swamp": "mossy shell, algae-covered",             "forest": "bark shell, leaf pattern",             "lava_core": "obsidian shell, ember cracks",               "neon_city": "chrome shell, LED grid",                    "ocean_lab": "coral shell, bubble trail",                 "space_grid": "starmap shell, constellation"},
    "frog":      {"swamp": "bioluminescent, tree frog",              "forest": "green tree frog, mossy",               "lava_core": "fire belly toad, ember spots",               "neon_city": "neon poison dart, LED spots",              "ocean_lab": "translucent, bubble skin",                  "space_grid": "crystal frog, ice glint"},
    "butterfly": {"swamp": "bioluminescent moth, green glow",       "forest": "monarch, leaf wing pattern",           "lava_core": "fire butterfly, ember trail",                 "neon_city": "holographic wings, LED veins",             "ocean_lab": "sea butterfly, translucent",                "space_grid": "crystal wings, stardust"},
    "bird":      {"swamp": "heron, mossy plumage",                  "forest": "owl, bark feathers",                   "lava_core": "phoenix wren, ember tail",                   "neon_city": "drone bird, LED eyes",                     "ocean_lab": "seagull, salt-crusted",                     "space_grid": "starling, silver feathers"},
}

# ── Weighted Random Selection from Entropy ─────────────
def weighted_select(entropy_val, options_dict):
    items = list(options_dict.items())
    cumulative = 0.0
    cumulative_list = []
    for name, weight in items:
        cumulative += weight
        cumulative_list.append((name, cumulative))
    total = cumulative
    target = entropy_val * total
    for name, cum_val in cumulative_list:
        if target <= cum_val:
            return name
    return items[-1][0]

# ── Entropy → Trait Selection ──────────────────────────
def entropy_to_traits(entropy_hex: str) -> dict:
    entropy_bytes = bytes.fromhex(entropy_hex[:64])

    tier_val = int.from_bytes(entropy_bytes[0:8], 'big') / (2**64)
    tier = tier_from_value(tier_val)

    bg_val = int.from_bytes(entropy_bytes[8:12], 'big') / (2**32)
    background = weighted_select(bg_val, TRAIT_DEFS["background"]["options"])

    expr_val = int.from_bytes(entropy_bytes[12:16], 'big') / (2**32)
    expression = weighted_select(expr_val, TRAIT_DEFS["expression"]["options"])

    hat_val = int.from_bytes(entropy_bytes[16:20], 'big') / (2**32)
    hat = weighted_select(hat_val, TRAIT_DEFS["hat"]["options"])

    acc_val = int.from_bytes(entropy_bytes[20:24], 'big') / (2**32)
    accessory = weighted_select(acc_val, TRAIT_DEFS["accessory"]["options"])

    comp_val = int.from_bytes(entropy_bytes[24:28], 'big') / (2**32)
    companion = weighted_select(comp_val, TRAIT_DEFS["companion"]["options"])

    return {
        "tier": tier,
        "background": background,
        "expression": expression,
        "hat": hat,
        "accessory": accessory,
        "companion": companion,
    }

# ── Rarity Score Calculation ───────────────────────────
def calculate_rarity_score(traits: dict) -> float:
    score = 0.0
    tier_weights = {"COMMON": 0.70, "MYTHIC": 0.25, "LEGENDARY": 0.05}
    score += 1.0 / tier_weights[traits["tier"]]
    for trait_name in ["background", "expression", "hat", "accessory", "companion"]:
        val = traits[trait_name]
        weight = TRAIT_DEFS[trait_name]["options"].get(val, 0.5)
        score += 1.0 / weight
    return round(score, 2)

# ── Image Composition ─────────────────────────────────
def compose_image(traits: dict, output_path: str):
    if not HAS_PIL:
        print(f"⚠️  PIL not available — skipping image generation for {output_path}")
        return
    canvas = Image.new("RGBA", (IMG_WIDTH, IMG_HEIGHT), (0, 0, 0, 0))
    bg = traits["background"]

    # Layer 1: Background
    bg_path = TRAITS_DIR / "background" / f"{bg}.png"
    if bg_path.exists():
        canvas = Image.alpha_composite(canvas, Image.open(bg_path).convert("RGBA").resize((IMG_WIDTH, IMG_HEIGHT)))

    # Layer 2: Tier base
    base_path = TRAITS_DIR / "base" / f"{traits['tier'].lower()}.png"
    if base_path.exists():
        canvas = Image.alpha_composite(canvas, Image.open(base_path).convert("RGBA").resize((IMG_WIDTH, IMG_HEIGHT)))

    # Layer 3-6: Traits (skip 'none')
    for trait_name in ["expression", "hat", "accessory", "companion"]:
        val = traits.get(trait_name, "none")
        if val == "none":
            continue
        layer_path = TRAITS_DIR / trait_name / f"{val}.png"
        if layer_path.exists():
            layer = Image.open(layer_path).convert("RGBA").resize((IMG_WIDTH, IMG_HEIGHT))
            canvas = Image.alpha_composite(canvas, layer)

    canvas.save(output_path, "PNG")

# ── Metadata Generation ────────────────────────────────
def generate_metadata(mint_id: str, traits: dict, image_url: str) -> dict:
    tier_emoji = {"COMMON": "🦫", "MYTHIC": "✨", "LEGENDARY": "👑"}[traits["tier"]]
    tier_armor = {
        "COMMON": "Light armor — minimal gear",
        "MYTHIC": "Cyber armor — medium plating",
        "LEGENDARY": "Heavy exosuit — full plating",
    }[traits["tier"]]
    rarity_score = calculate_rarity_score(traits)

    attributes = [
        {"trait_type": "Tier", "value": traits["tier"].capitalize()},
        {"trait_type": "Armor", "value": tier_armor},
        {"trait_type": "Rarity Score", "value": rarity_score, "display_type": "number"},
    ]

    bg = traits["background"]
    for trait_name in ["background", "expression", "hat", "accessory", "companion"]:
        val = traits.get(trait_name, "none")
        display_val = val.replace("_", " ").title() if val != "none" else "None"

        env_detail = None
        if val != "none":
            if trait_name == "hat" and val in HAT_ENV_DETAILS:
                env_detail = HAT_ENV_DETAILS[val].get(bg)
            elif trait_name == "accessory" and val in ACCESSORY_ENV_DETAILS:
                env_detail = ACCESSORY_ENV_DETAILS[val].get(bg)
            elif trait_name == "companion" and val in COMPANION_ENV_DETAILS:
                env_detail = COMPANION_ENV_DETAILS[val].get(bg)

        attr = {"trait_type": trait_name.replace("_", " ").title(), "value": display_val}
        if env_detail:
            attr["env_detail"] = f"{bg}: {env_detail}"
        attributes.append(attr)

    return {
        "name": f"{tier_emoji} Cappy #{mint_id}",
        "symbol": "CAPPY",
        "description": f"A {traits['tier'].lower()} Cappy NFT — unique capybara on X1 Network, born from Geiger entropy. Rarity score: {rarity_score}.",
        "image": image_url,
        "external_url": "https://cappy-nft-mint.vercel.app",
        "attributes": attributes,
        "properties": {
            "files": [{"uri": image_url, "type": "image/png"}],
            "category": "image",
            "creators": [],
        },
    }

# ── Batch Generation ───────────────────────────────────
def generate_batch(count: int, output_dir: str = None):
    if output_dir:
        out = Path(output_dir)
    else:
        out = OUTPUT_DIR
    out.mkdir(parents=True, exist_ok=True)

    stats = {"COMMON": 0, "MYTHIC": 0, "LEGENDARY": 0}
    trait_counts = {}

    for i in range(1, count + 1):
        test_entropy = hashlib.sha256(f"cappy-test-{i}".encode()).hexdigest()
        traits = entropy_to_traits(test_entropy)
        stats[traits["tier"]] += 1

        for k, v in traits.items():
            if k != "tier":
                key = f"{k}:{v}"
                trait_counts[key] = trait_counts.get(key, 0) + 1

        img_path = out / f"{i}.png"
        compose_image(traits, str(img_path))

        image_url = f"https://cappy-nft-mint.vercel.app/generated/{i}.png"
        metadata = generate_metadata(str(i), traits, image_url)
        meta_path = out / f"{i}.json"
        with open(meta_path, "w") as f:
            json.dump(metadata, f, indent=2)

    print(f"✅ Generated {count} Cappys")
    print(f"   Tier distribution: {stats}")
    print(f"   Expected: COMMON≈{int(count*0.7)}, MYTHIC≈{int(count*0.25)}, LEGENDARY≈{int(count*0.05)}")
    print(f"\n   Trait counts (top 15):")
    for k, v in sorted(trait_counts.items(), key=lambda x: -x[1])[:15]:
        print(f"     {k}: {v} ({v/count*100:.1f}%)")

# ── Main ────────────────────────────────────────────────
def main():
    if len(sys.argv) < 3:
        print("Usage:")
        print("  python3 cappy-generator.py <mint_id> <entropy_hex>  — generate single Cappy")
        print("  python3 cappy-generator.py batch <count> [output_dir] — generate batch for testing")
        sys.exit(1)

    if sys.argv[1] == "batch":
        count = int(sys.argv[2])
        output_dir = sys.argv[3] if len(sys.argv) > 3 else None
        generate_batch(count, output_dir)
        return

    mint_id = sys.argv[1]
    entropy_hex = sys.argv[2]

    try:
        mint_num = int(mint_id)
        if mint_num < 1 or mint_num > MAX_SUPPLY:
            print(f"❌ Mint ID must be 1-{MAX_SUPPLY}. Got: {mint_num}")
            sys.exit(1)
    except ValueError:
        print(f"❌ Mint ID must be numeric (1-{MAX_SUPPLY}). Got: {mint_id}")
        sys.exit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    traits = entropy_to_traits(entropy_hex)
    rarity_score = calculate_rarity_score(traits)

    img_path = OUTPUT_DIR / f"{mint_id}.png"
    compose_image(traits, str(img_path))

    image_url = f"https://cappy-nft-mint.vercel.app/generated/{mint_id}.png"
    metadata = generate_metadata(mint_id, traits, image_url)
    meta_path = OUTPUT_DIR / f"{mint_id}.json"
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"✅ Cappy #{mint_id}")
    print(f"   Tier: {traits['tier']}")
    print(f"   Rarity Score: {rarity_score}")
    print(f"   Traits: {', '.join(f'{k}={v}' for k, v in traits.items() if k != 'tier')}")
    print(f"   Environment: {traits['background']}")
    for trait_name in ["hat", "accessory", "companion"]:
        val = traits.get(trait_name)
        if val and val != "none":
            bg = traits["background"]
            if trait_name == "hat" and val in HAT_ENV_DETAILS:
                print(f"   {trait_name} detail: {HAT_ENV_DETAILS[val][bg]}")
            elif trait_name == "accessory" and val in ACCESSORY_ENV_DETAILS:
                print(f"   {trait_name} detail: {ACCESSORY_ENV_DETAILS[val][bg]}")
            elif trait_name == "companion" and val in COMPANION_ENV_DETAILS:
                print(f"   {trait_name} detail: {COMPANION_ENV_DETAILS[val][bg]}")
    print(f"   Image: {img_path}")
    print(f"   Metadata: {meta_path}")

if __name__ == "__main__":
    main()
