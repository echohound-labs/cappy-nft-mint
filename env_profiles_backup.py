"""
Capybara NFT — Per-Environment Compositing Profiles
=====================================================
Each background gets its own physics: ground type, light color, atmosphere density,
foot contact behavior. No more "swamp settings on lava rock."

Profiles are loaded by the Compositor and override its defaults.
"""

from dataclasses import dataclass, field
from typing import Tuple, Optional


@dataclass
class EnvProfile:
    """Environment-specific compositing configuration.
    
    Every field maps directly to a Compositor class constant.
    Only override what differs from the swamp defaults.
    """
    name: str
    
    # === Character placement ===
    width_pct: float = 0.8075          # character width as % of frame
    bottom_margin_pct: float = 0.04    # feet distance from bottom
    h_shift: int = 10                  # horizontal offset (px right of center)
    foot_sink_pct: float = 0.0         # how much the feet sink into the ground (% of char height)
    
    # === Ground contact ===
    ground_type: str = "water"         # water, rock, concrete, grid, moss
    shadow_strength: float = 1.0       # multiplier on all shadow alpha values
    shadow_width_pct: float = 0.42     # shadow width as % of character width
    shadow_height_pct: float = 0.018   # shadow height as % of frame
    
    # Foot shadows
    foot_shadow_strength: float = 1.0  # multiplier
    foot_width_pct: float = 0.085
    
    # Toe contact
    toe_contact_strength: float = 1.0  # multiplier on toe shadow alpha
    toe_offsets: Tuple = (-0.33, 0.0, 0.33)
    
    # Ground compression color (what the ground looks like where feet press)
    mud_color: Tuple = (12, 18, 8)
    mud_strength: float = 1.0          # multiplier
    
    # Ground ring colors (surface disturbance)
    inner_ring_color: Tuple = (18, 32, 14)
    outer_ring_color: Tuple = (8, 38, 18)
    ring_strength: float = 1.0
    
    # Water/liquid effects (set to 0 for dry environments)
    water_shimmer_strength: float = 1.0
    water_color: Tuple = (45, 65, 35)
    dark_water_strength: float = 1.0
    dark_water_color: Tuple = (4, 18, 6)
    
    # Reflection
    reflection_strength: float = 1.0   # 0 = no reflection (dry ground), 1 = full
    reflection_color: Tuple = None      # None = auto-sample from background
    reflection_fragments: int = 18
    reflection_height_pct: float = 0.035
    reflection_width_pct: float = 0.55
    
    # === Atmosphere ===
    haze_start_pct: float = 0.55
    haze_max_intensity: float = 0.08
    haze_edge_boost: float = 0.5
    
    edge_diffusion_min: float = 0.02
    edge_diffusion_max: float = 0.05
    edge_diffusion_start_y: float = 0.30
    
    mist_start_pct: float = 0.75
    mist_max_alpha: int = 6
    mist_color: Tuple = (22, 36, 20)
    
    # === Lighting ===
    bounce_color: Tuple = (15.0, 45.0, 25.0)  # RGB bounce from environment
    bounce_max_intensity: float = 0.015
    bounce_start_pct: float = 0.45
    bounce_luminance_threshold: int = 120
    
    rim_left_warm: int = 10      # green shift from left
    rim_left_cool: int = 25      # blue shift from left
    rim_right_warm: int = 35     # red shift from right
    rim_right_green: int = 5
    rim_intensity: float = 0.02
    
    # === Foot-ground blend ===
    blend_height_pct: float = 0.05
    blend_max: float = 0.14
    blend_red_factor: float = 0.30
    blend_green_factor: float = 0.05
    blend_blue_add: int = 12
    
    # Mud staining on feet
    mud_stain_zone_pct: float = 0.06
    mud_stain_start: float = 0.6
    mud_stain_red: float = 0.06
    mud_stain_green: float = 0.02
    mud_stain_blue: float = 0.03


# ============================================================
# LOCKED PROFILES
# ============================================================

SWAMP = EnvProfile(
    name="swamp",
    # Character placement (v18 locked)
    width_pct=0.8075,
    bottom_margin_pct=0.04,
    h_shift=10,
    foot_sink_pct=0.0,
    # Ground: water/mud
    ground_type="water",
    shadow_strength=1.0,
    shadow_width_pct=0.42,
    shadow_height_pct=0.018,
    foot_shadow_strength=1.0,
    foot_width_pct=0.085,
    toe_contact_strength=1.0,
    mud_color=(12, 18, 8),
    mud_strength=1.0,
    inner_ring_color=(18, 32, 14),
    outer_ring_color=(8, 38, 18),
    ring_strength=1.0,
    water_shimmer_strength=1.0,
    water_color=(45, 65, 35),
    dark_water_strength=1.0,
    dark_water_color=(4, 18, 6),
    reflection_strength=1.0,
    reflection_fragments=18,
    reflection_height_pct=0.035,
    reflection_width_pct=0.55,
    # Atmosphere
    haze_start_pct=0.55,
    haze_max_intensity=0.08,
    haze_edge_boost=0.5,
    edge_diffusion_min=0.02,
    edge_diffusion_max=0.05,
    edge_diffusion_start_y=0.30,
    mist_start_pct=0.75,
    mist_max_alpha=6,
    mist_color=(22, 36, 20),
    # Lighting
    bounce_color=(15.0, 45.0, 25.0),
    bounce_max_intensity=0.015,
    bounce_start_pct=0.45,
    bounce_luminance_threshold=120,
    rim_left_warm=10,
    rim_left_cool=25,
    rim_right_warm=35,
    rim_right_green=5,
    rim_intensity=0.02,
    # Blend
    blend_height_pct=0.05,
    blend_max=0.14,
    blend_red_factor=0.30,
    blend_green_factor=0.05,
    blend_blue_add=12,
    mud_stain_zone_pct=0.06,
    mud_stain_start=0.6,
    mud_stain_red=0.06,
    mud_stain_green=0.02,
    mud_stain_blue=0.03,
)

LAVA_CORE = EnvProfile(
    name="lava_core",
    # Character placement — slightly lower into rock
    width_pct=0.8075,
    bottom_margin_pct=0.02,          # feet closer to bottom (sitting into rock)
    h_shift=10,
    foot_sink_pct=0.015,             # feet sink slightly into rock surface
    # Ground: volcanic rock (dry, no water)
    ground_type="rock",
    shadow_strength=1.4,              # stronger shadows on dark rock
    shadow_width_pct=0.40,
    shadow_height_pct=0.015,
    foot_shadow_strength=1.6,         # heavier contact shadows
    foot_width_pct=0.09,              # slightly wider (flat rock contact)
    toe_contact_strength=1.8,         # sharp contact on hard surface
    mud_color=(30, 16, 8),           # hot rock compression
    mud_strength=0.7,                # less "mud", more "compression"
    inner_ring_color=(35, 18, 10),    # rock fracture
    outer_ring_color=(18, 10, 25),    # purple lava glow
    ring_strength=0.6,                # less ring on solid rock
    water_shimmer_strength=0.0,      # NO water on lava rock
    water_color=(80, 40, 15),
    dark_water_strength=0.0,         # NO dark water
    dark_water_color=(12, 8, 4),
    # Reflection: heat shimmer instead of water reflection
    reflection_strength=0.15,         # minimal — heat haze, not water mirror
    reflection_fragments=8,           # fewer, more scattered (heat distortion)
    reflection_height_pct=0.02,       # shorter
    reflection_width_pct=0.40,       # narrower
    # Atmosphere: heat haze
    haze_start_pct=0.50,             # starts higher (heat rises)
    haze_max_intensity=0.06,          # less intense than swamp
    haze_edge_boost=0.3,             # subtler edges
    edge_diffusion_min=0.015,
    edge_diffusion_max=0.035,        # less diffusion (dry air, less humidity)
    edge_diffusion_start_y=0.32,
    mist_start_pct=0.78,             # lower mist (heat rises, not fog)
    mist_max_alpha=4,                # very subtle heat shimmer
    mist_color=(40, 22, 12),         # warm haze
    # Lighting: warm lava glow
    bounce_color=(50.0, 18.0, 8.0),  # strong warm orange bounce
    bounce_max_intensity=0.022,       # stronger bounce (lava is bright)
    bounce_start_pct=0.40,           # starts higher (light rises from lava)
    bounce_luminance_threshold=130,   # affects more of the body
    rim_left_warm=8,
    rim_left_cool=15,                # some cool from above
    rim_right_warm=55,               # strong warm from lava glow right
    rim_right_green=12,
    rim_intensity=0.025,
    # Blend: warm rock contact
    blend_height_pct=0.05,
    blend_max=0.16,                  # slightly stronger
    blend_red_factor=0.35,           # more red shift
    blend_green_factor=0.03,
    blend_blue_add=5,                # less blue
    # Staining: volcanic ash/dust
    mud_stain_zone_pct=0.07,         # wider stain zone
    mud_stain_start=0.55,
    mud_stain_red=0.08,              # more red (volcanic dust)
    mud_stain_green=0.01,
    mud_stain_blue=0.0,              # no blue
)

NEON_CITY = EnvProfile(
    name="neon_city",
    # Character placement — standard, standing on concrete
    width_pct=0.8075,
    bottom_margin_pct=0.04,
    h_shift=10,
    foot_sink_pct=0.0,               # no sinking — hard concrete
    # Ground: wet concrete
    ground_type="concrete",
    shadow_strength=1.1,              # moderate shadow on concrete
    shadow_width_pct=0.42,
    shadow_height_pct=0.016,
    foot_shadow_strength=1.3,         # hard surface = crisp shadows
    foot_width_pct=0.085,
    toe_contact_strength=1.5,         # sharp on hard surface
    mud_color=(18, 22, 28),          # concrete dust/compression
    mud_strength=0.5,                # subtle — it's concrete
    inner_ring_color=(22, 32, 38),    # wet concrete ring
    outer_ring_color=(12, 28, 35),    # neon reflection on wet ground
    ring_strength=0.8,
    water_shimmer_strength=0.4,       # wet concrete has some shimmer
    water_color=(35, 58, 68),        # neon-tinted puddle
    dark_water_strength=0.6,
    dark_water_color=(6, 14, 20),     # dark wet concrete
    # Reflection: neon reflections on wet concrete
    reflection_strength=0.6,          # moderate — wet concrete reflects
    reflection_fragments=14,          # some fragments
    reflection_height_pct=0.030,
    reflection_width_pct=0.50,
    # Atmosphere: urban haze
    haze_start_pct=0.55,
    haze_max_intensity=0.05,          # less haze (urban, not swamp)
    haze_edge_boost=0.4,
    edge_diffusion_min=0.015,
    edge_diffusion_max=0.04,
    edge_diffusion_start_y=0.30,
    mist_start_pct=0.72,
    mist_max_alpha=5,                # urban haze
    mist_color=(18, 28, 38),        # cool urban
    # Lighting: neon cyan/magenta
    bounce_color=(22.0, 38.0, 48.0), # cyan bounce from neon lights
    bounce_max_intensity=0.018,
    bounce_start_pct=0.45,
    bounce_luminance_threshold=125,
    rim_left_warm=6,
    rim_left_cool=42,                # strong cyan from left
    rim_right_warm=48,               # warm magenta from right
    rim_right_green=6,
    rim_intensity=0.022,
    # Blend: concrete contact
    blend_height_pct=0.04,           # less — hard surface
    blend_max=0.12,
    blend_red_factor=0.25,
    blend_green_factor=0.04,
    blend_blue_add=10,
    # Staining: urban grime
    mud_stain_zone_pct=0.05,
    mud_stain_start=0.65,
    mud_stain_red=0.04,
    mud_stain_green=0.03,
    mud_stain_blue=0.02,
)

OCEAN_LAB = EnvProfile(
    name="ocean_lab",
    # Character placement — standing on wet lab floor
    width_pct=0.8075,
    bottom_margin_pct=0.04,
    h_shift=10,
    foot_sink_pct=0.005,              # minimal — wet floor
    # Ground: wet lab floor
    ground_type="water",
    shadow_strength=1.0,
    shadow_width_pct=0.42,
    shadow_height_pct=0.016,
    foot_shadow_strength=1.2,
    foot_width_pct=0.085,
    toe_contact_strength=1.3,
    mud_color=(10, 18, 24),          # wet floor compression
    mud_strength=0.6,
    inner_ring_color=(12, 25, 34),
    outer_ring_color=(8, 22, 32),
    ring_strength=0.7,
    water_shimmer_strength=0.7,      # wet floor shimmer
    water_color=(28, 52, 72),
    dark_water_strength=0.8,
    dark_water_color=(4, 12, 20),
    # Reflection: clear water reflection on wet floor
    reflection_strength=0.7,
    reflection_fragments=16,
    reflection_height_pct=0.032,
    reflection_width_pct=0.52,
    # Atmosphere: cold clinical
    haze_start_pct=0.56,
    haze_max_intensity=0.06,
    haze_edge_boost=0.4,
    edge_diffusion_min=0.018,
    edge_diffusion_max=0.04,
    edge_diffusion_start_y=0.30,
    mist_start_pct=0.74,
    mist_max_alpha=5,
    mist_color=(14, 24, 40),        # cold blue mist
    # Lighting: cold blue/white
    bounce_color=(14.0, 28.0, 52.0), # cold blue bounce
    bounce_max_intensity=0.016,
    bounce_start_pct=0.45,
    bounce_luminance_threshold=118,
    rim_left_warm=6,
    rim_left_cool=38,                # blue left
    rim_right_warm=32,               # white/warm right
    rim_right_green=8,
    rim_intensity=0.02,
    # Blend: cold wet floor
    blend_height_pct=0.05,
    blend_max=0.13,
    blend_red_factor=0.20,           # less red shift
    blend_green_factor=0.04,
    blend_blue_add=18,               # more blue shift
    # Staining: wet floor
    mud_stain_zone_pct=0.06,
    mud_stain_start=0.6,
    mud_stain_red=0.03,
    mud_stain_green=0.03,
    mud_stain_blue=0.04,
)

FOREST = EnvProfile(
    name="forest",
    # Character placement — standing on moss/earth
    width_pct=0.8075,
    bottom_margin_pct=0.04,
    h_shift=10,
    foot_sink_pct=0.008,              # slight — soft earth
    # Ground: moss/earth
    ground_type="moss",
    shadow_strength=1.2,              # strong shadows in dappled forest
    shadow_width_pct=0.42,
    shadow_height_pct=0.018,
    foot_shadow_strength=1.3,
    foot_width_pct=0.088,             # slightly wider on soft ground
    toe_contact_strength=1.4,
    mud_color=(16, 22, 10),          # earth/moss
    mud_strength=0.8,
    inner_ring_color=(22, 30, 14),
    outer_ring_color=(12, 35, 16),
    ring_strength=0.9,
    water_shimmer_strength=0.3,      # slight dew on moss
    water_color=(38, 58, 30),
    dark_water_strength=0.4,
    dark_water_color=(6, 16, 8),
    # Reflection: almost none (moss doesn't reflect)
    reflection_strength=0.08,
    reflection_fragments=6,
    reflection_height_pct=0.015,
    reflection_width_pct=0.35,
    # Atmosphere: forest canopy
    haze_start_pct=0.52,             # starts earlier (canopy depth)
    haze_max_intensity=0.09,         # more humid than swamp
    haze_edge_boost=0.6,
    edge_diffusion_min=0.02,
    edge_diffusion_max=0.055,
    edge_diffusion_start_y=0.28,
    mist_start_pct=0.72,             # lower mist (ground fog)
    mist_max_alpha=8,
    mist_color=(20, 32, 16),        # green forest mist
    # Lighting: dappled warm
    bounce_color=(20.0, 42.0, 16.0), # forest green bounce
    bounce_max_intensity=0.016,
    bounce_start_pct=0.42,
    bounce_luminance_threshold=115,
    rim_left_warm=14,                 # warm dappled light left
    rim_left_cool=22,
    rim_right_warm=42,               # warm right
    rim_right_green=8,
    rim_intensity=0.02,
    # Blend: earth contact
    blend_height_pct=0.05,
    blend_max=0.15,
    blend_red_factor=0.28,
    blend_green_factor=0.06,
    blend_blue_add=10,
    # Staining: moss/earth
    mud_stain_zone_pct=0.07,
    mud_stain_start=0.55,
    mud_stain_red=0.05,
    mud_stain_green=0.04,
    mud_stain_blue=0.02,
)

SPACE_GRID = EnvProfile(
    name="space_grid",
    # Character placement — hovering slightly on grid
    width_pct=0.8075,
    bottom_margin_pct=0.045,          # slightly higher (no sinking on grid)
    h_shift=10,
    foot_sink_pct=0.0,                # no sinking — energy grid
    # Ground: holographic grid (dry, no water)
    ground_type="grid",
    shadow_strength=0.8,               # softer shadows (grid glow undercuts)
    shadow_width_pct=0.40,
    shadow_height_pct=0.014,
    foot_shadow_strength=1.0,          # moderate — grid surface
    foot_width_pct=0.085,
    toe_contact_strength=1.2,
    mud_color=(22, 15, 30),           # grid surface compression
    mud_strength=0.4,                 # minimal — it's energy
    inner_ring_color=(25, 18, 40),
    outer_ring_color=(14, 24, 40),
    ring_strength=0.5,
    water_shimmer_strength=0.0,        # NO water
    water_color=(40, 30, 60),
    dark_water_strength=0.0,
    dark_water_color=(8, 5, 15),
    # Reflection: grid glow reflection (not water)
    reflection_strength=0.25,          # subtle energy reflection
    reflection_fragments=10,            # geometric fragments
    reflection_height_pct=0.020,
    reflection_width_pct=0.40,
    # Atmosphere: minimal (space — no atmosphere)
    haze_start_pct=0.60,               # starts later (less atmosphere)
    haze_max_intensity=0.03,            # very subtle
    haze_edge_boost=0.2,
    edge_diffusion_min=0.01,
    edge_diffusion_max=0.025,          # minimal diffusion (vacuum)
    edge_diffusion_start_y=0.35,
    mist_start_pct=0.82,               # almost no mist
    mist_max_alpha=3,                  # barely there
    mist_color=(18, 12, 32),           # purple energy haze
    # Lighting: cosmic purple/teal
    bounce_color=(28.0, 12.0, 48.0),   # purple bounce
    bounce_max_intensity=0.018,
    bounce_start_pct=0.40,
    bounce_luminance_threshold=125,
    rim_left_warm=6,
    rim_left_cool=52,                  # strong teal/cyan left
    rim_right_warm=45,                # magenta right
    rim_right_green=4,
    rim_intensity=0.022,
    # Blend: energy grid contact
    blend_height_pct=0.04,
    blend_max=0.10,                   # less blend (no mud)
    blend_red_factor=0.20,
    blend_green_factor=0.03,
    blend_blue_add=15,                 # purple shift
    # Staining: none on grid
    mud_stain_zone_pct=0.04,
    mud_stain_start=0.7,              # barely visible
    mud_stain_red=0.03,
    mud_stain_green=0.01,
    mud_stain_blue=0.04,
)


# Registry: background filename → profile
PROFILES = {
    'swamp': SWAMP,
    'lava_core': LAVA_CORE,
    'neon_city': NEON_CITY,
    'ocean_lab': OCEAN_LAB,
    'forest': FOREST,
    'space_grid': SPACE_GRID,
}


def get_profile(bg_name: str) -> EnvProfile:
    """Get the compositing profile for a background."""
    if bg_name in PROFILES:
        return PROFILES[bg_name]
    # Default: swamp
    return SWAMP