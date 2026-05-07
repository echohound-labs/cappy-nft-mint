/**
 * CAPPY Trait Resolver — Deterministic trait selection from Geiger entropy bytes
 * 
 * Locked rarity weights (2026-05-07):
 *   Tier:       COMMON 70%, MYTHIC 25%, LEGENDARY 5%
 *   Background: equal 1/6 each
 *   Expression:  chill 28%, happy 25%, smug 20%, surprised 13%, zen 8%, derp 6%
 *   Hat:         none 35%, beanie 22%, bucket_hat 17%, safari 12%, flower_crown 7%, top_hat 4%, crown 3%
 *   Accessory:   none 35%, dog_tags 22%, scarf 17%, tactical_goggles 12%, bandolier 7%, monocle 4%, earring 3%
 *   Companion:   none 55%, duck 15%, turtle 12%, frog 8%, butterfly 6%, bird 4%
 * 
 * Entropy byte mapping:
 *   Bytes 0-7:   tier
 *   Bytes 8-11:  background
 *   Bytes 12-15: expression
 *   Bytes 16-19: hat
 *   Bytes 20-23: accessory
 *   Bytes 24-27: companion
 *   Bytes 28-31: reserved (rarity score salt)
 */

const TRAIT_DEFS = {
  background: {
    options: {
      swamp:      1/6,
      forest:     1/6,
      lava_core:  1/6,
      neon_city:  1/6,
      ocean_lab:  1/6,
      space_grid: 1/6,
    },
  },
  expression: {
    options: {
      chill:      0.28,
      happy:      0.25,
      smug:       0.20,
      surprised:  0.13,
      zen:        0.08,
      derp:       0.06,
    },
  },
  hat: {
    options: {
      none:          0.35,
      beanie:        0.22,
      bucket_hat:   0.17,
      safari:       0.12,
      flower_crown: 0.07,
      top_hat:      0.04,
      crown:        0.03,
    },
  },
  accessory: {
    options: {
      none:             0.35,
      dog_tags:         0.22,
      scarf:            0.17,
      tactical_goggles: 0.12,
      bandolier:        0.07,
      monocle:          0.04,
      earring:          0.03,
    },
  },
  companion: {
    options: {
      none:       0.55,
      duck:       0.15,
      turtle:     0.12,
      frog:       0.08,
      butterfly:  0.06,
      bird:       0.04,
    },
  },
};

// Pre-compute cumulative distributions for fast weighted selection
const CUMULATIVE = {};
for (const [traitName, def] of Object.entries(TRAIT_DEFS)) {
  const items = Object.entries(def.options);
  let cumulative = 0;
  CUMULATIVE[traitName] = items.map(([name, weight]) => {
    cumulative += weight;
    return { name, cumulative };
  });
}

/**
 * Convert entropy bytes to a 0-1 float from a byte range
 */
function bytesToFloat(bytes, start, len) {
  let val = 0n;
  for (let i = 0; i < len; i++) {
    val = (val << 8n) | BigInt(bytes[start + i]);
  }
  const maxVal = (1n << BigInt(len * 8)) - 1n;
  return Number(val) / Number(maxVal);
}

/**
 * Weighted random selection using cumulative distribution
 */
function weightedSelect(entropyVal, traitName) {
  const dist = CUMULATIVE[traitName];
  const total = dist[dist.length - 1].cumulative;
  const target = entropyVal * total;
  
  for (const { name, cumulative } of dist) {
    if (target <= cumulative) return name;
  }
  return dist[dist.length - 1].name;
}

/**
 * Determine tier from entropy value
 */
function tierFromValue(val) {
  if (val < 0.05) return 'LEGENDARY';
  if (val < 0.30) return 'MYTHIC';
  return 'COMMON';
}

/**
 * Resolve all traits from Geiger entropy bytes
 * @param {Uint8Array} entropyBytes - 32 bytes from Geiger oracle
 * @returns {Object} All resolved traits
 */
export function resolveTraits(entropyBytes) {
  // Tier from bytes 0-7
  const tierVal = bytesToFloat(entropyBytes, 0, 8);
  const tier = tierFromValue(tierVal);

  // Background from bytes 8-11
  const bgVal = bytesToFloat(entropyBytes, 8, 4);
  const background = weightedSelect(bgVal, 'background');

  // Expression from bytes 12-15
  const exprVal = bytesToFloat(entropyBytes, 12, 4);
  const expression = weightedSelect(exprVal, 'expression');

  // Hat from bytes 16-19
  const hatVal = bytesToFloat(entropyBytes, 16, 4);
  const hat = weightedSelect(hatVal, 'hat');

  // Accessory from bytes 20-23
  const accVal = bytesToFloat(entropyBytes, 20, 4);
  const accessory = weightedSelect(accVal, 'accessory');

  // Companion from bytes 24-27
  const compVal = bytesToFloat(entropyBytes, 24, 4);
  const companion = weightedSelect(compVal, 'companion');

  return { tier, background, expression, hat, accessory, companion };
}

/**
 * Calculate rarity score — lower weight = higher score contribution
 * A common capy with crown + earring + bird can beat a mythic with common traits
 */
export function calculateRarityScore(traits) {
  const tierWeights = { COMMON: 0.70, MYTHIC: 0.25, LEGENDARY: 0.05 };
  let score = 1.0 / tierWeights[traits.tier];

  for (const traitName of ['background', 'expression', 'hat', 'accessory', 'companion']) {
    const val = traits[traitName];
    const weight = TRAIT_DEFS[traitName].options[val] || 0.5;
    score += 1.0 / weight;
  }

  return Math.round(score * 100) / 100;
}

/**
 * Get environment-aware detail description for a trait
 * @param {string} traitName - hat, accessory, or companion
 * @param {string} traitValue - the specific trait value
 * @param {string} background - the environment
 * @returns {string|null} Environment-specific detail
 */
export function getEnvDetail(traitName, traitValue, background) {
  const ENV_DETAILS = {
    hat: {
      beanie:       { swamp: 'mossy knit, vine stitch', forest: 'dark green wool', lava_core: 'burnt orange, soot stains', neon_city: 'matte black, LED stripe', ocean_lab: 'teal knit, water beads', space_grid: 'silver thermal, star patch' },
      bucket_hat:   { swamp: 'camo, mud stains', forest: 'bark brown, leaf print', lava_core: 'charcoal, ember dots', neon_city: 'holographic UV', ocean_lab: 'navy, salt-crusted', space_grid: 'void black, constellation' },
      safari:       { swamp: 'worn khaki, mosquito net', forest: 'deep green, trail dust', lava_core: 'desert tan, heat shimmer', neon_city: 'matte black, neon visor', ocean_lab: 'white, coral band', space_grid: 'white, reflective' },
      flower_crown: { swamp: 'living orchids', forest: 'autumn leaves + berries', lava_core: 'flame petals, smoking', neon_city: 'neon pixel flowers', ocean_lab: 'sea anemone bloom', space_grid: 'crystal ice flowers' },
      top_hat:      { swamp: 'mossy velvet, vine band', forest: 'bark textured', lava_core: 'obsidian, lava veins', neon_city: 'chrome, LED band', ocean_lab: 'deep sea blue, pearls', space_grid: 'matte white, glow ring' },
      crown:        { swamp: 'ancient gold, moss patina, vines', forest: 'dark bronze, leaf carvings', lava_core: 'molten metal, ember glow', neon_city: 'chrome, LED tips', ocean_lab: 'coral gold, bubbles', space_grid: 'white gold, starlight shimmer' },
    },
    accessory: {
      dog_tags:         { swamp: 'tarnished brass, mud-smeared', forest: 'olive drab, bark scratches', lava_core: 'blackened metal, ember glow', neon_city: 'matte black, glowing engraving', ocean_lab: 'coral-accented', space_grid: 'silver, laser-etched' },
      scarf:            { swamp: 'mossy green, vine-wrapped', forest: 'earthy brown, leaf pattern', lava_core: 'charcoal, ember thread', neon_city: 'black, neon stripe', ocean_lab: 'teal, coral clasp', space_grid: 'silver thermal, stars' },
      tactical_goggles: { swamp: 'fogged lenses, moss strap', forest: 'amber lenses, bark frame', lava_core: 'smoked lenses, heat vent', neon_city: 'holographic visor, LED HUD', ocean_lab: 'polarized blue', space_grid: 'UV visor, constellation HUD' },
      bandolier:        { swamp: 'rotting leather, vine loops', forest: 'bark-leather, moss pouches', lava_core: 'heat-forged metal', neon_city: 'carbon fiber, LED indicators', ocean_lab: 'coral buckle, waterproof', space_grid: 'sleek alloy, magnetic' },
      monocle:          { swamp: 'tarnished gold, vine chain', forest: 'wood frame, leaf engraving', lava_core: 'obsidian rim, ember tint', neon_city: 'chrome, holographic lens', ocean_lab: 'pearl frame, blue tint', space_grid: 'platinum, star map lens' },
      earring:          { swamp: 'mossy hoop, bioluminescent', forest: 'leaf-shaped, bark texture', lava_core: 'ember drop, fire glow', neon_city: 'LED stud, holographic', ocean_lab: 'pearl drop, bubble', space_grid: 'starlight gem, constellation' },
    },
    companion: {
      duck:      { swamp: 'swamp duck, mossy feathers', forest: 'wood duck, leafy camo', lava_core: 'ceramic, ember beak', neon_city: 'LED duck, neon outline', ocean_lab: 'rubber duck, classic', space_grid: 'zero-G, silver feathers' },
      turtle:    { swamp: 'mossy shell, algae-covered', forest: 'bark shell, leaf pattern', lava_core: 'obsidian shell, ember cracks', neon_city: 'chrome shell, LED grid', ocean_lab: 'coral shell, bubble trail', space_grid: 'starmap shell' },
      frog:      { swamp: 'bioluminescent, tree frog', forest: 'green tree frog, mossy', lava_core: 'fire belly toad, ember spots', neon_city: 'neon poison dart, LED spots', ocean_lab: 'translucent, bubble skin', space_grid: 'crystal frog, ice glint' },
      butterfly: { swamp: 'bioluminescent moth, green glow', forest: 'monarch, leaf wing pattern', lava_core: 'fire butterfly, ember trail', neon_city: 'holographic wings, LED veins', ocean_lab: 'sea butterfly, translucent', space_grid: 'crystal wings, stardust' },
      bird:      { swamp: 'heron, mossy plumage', forest: 'owl, bark feathers', lava_core: 'phoenix wren, ember tail', neon_city: 'drone bird, LED eyes', ocean_lab: 'seagull, salt-crusted', space_grid: 'starling, silver feathers' },
    },
  };

  const detailMap = ENV_DETAILS[traitName];
  if (!detailMap || !detailMap[traitValue]) return null;
  return detailMap[traitValue][background] || null;
}

/**
 * Format traits for Metaplex metadata attributes
 */
export function traitsToMetadata(traits) {
  const tierEmoji = { COMMON: '🦫', MYTHIC: '✨', LEGENDARY: '👑' }[traits.tier];
  const tierArmor = {
    COMMON: 'Light armor — minimal gear',
    MYTHIC: 'Cyber armor — medium plating',
    LEGENDARY: 'Heavy exosuit — full plating',
  }[traits.tier];
  const rarityScore = calculateRarityScore(traits);

  const attributes = [
    { trait_type: 'Tier', value: traits.tier },
    { trait_type: 'Armor', value: tierArmor },
    { trait_type: 'Rarity Score', value: rarityScore, display_type: 'number' },
  ];

  for (const [traitName, val] of Object.entries(traits)) {
    if (traitName === 'tier') continue;
    const displayVal = val === 'none' ? 'None' : val.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const attr = { trait_type: traitName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), value: displayVal };
    
    const envDetail = getEnvDetail(traitName, val, traits.background);
    if (envDetail) attr.env_detail = `${traits.background}: ${envDetail}`;
    
    attributes.push(attr);
  }

  return {
    name: `${tierEmoji} Cappy`,
    symbol: 'CAPPY',
    description: `A ${traits.tier.toLowerCase()} Cappy NFT — unique capybara on X1 Network, born from Geiger entropy. Rarity score: ${rarityScore}.`,
    attributes,
  };
}

export default { resolveTraits, calculateRarityScore, getEnvDetail, traitsToMetadata, TRAIT_DEFS };
