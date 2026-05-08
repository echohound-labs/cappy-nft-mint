"""
Capybara NFT Compositor v1.0 — LOCKED v18 Standard
====================================================
Definitive compositing pipeline for the Capybara NFT collection.

Based on v18 (swamp) final lock — all parameters tuned through 18 iterations.

PIPELINE PASSES (in order):
1. Character scale & position
2. Subtle widening (stance weight)
3. Ground layer (shadows, mud compression, surface disturbance)
4. Broken reflection
5. Atmospheric haze (lower body → environment blend)
6. Edge diffusion (silhouette humidity softness)
7. Environmental bounce light (swamp green in shadows)
8. Foot-ground blend (color merge at contact)
9. Mud staining (feet)
10. Rim lighting
11. Swamp mist (frame bottom)

USAGE:
    from compositor import Compositor
    comp = Compositor(
        background_path="public/traits/background/swamp.png",
        character_path="public/traits/base/common.png",
        width_pct=0.8075,
        bottom_margin_pct=0.04,
    )
    result = comp.compose()
    result.save("output.png")
"""

from PIL import Image, ImageDraw, ImageFilter
import numpy as np


class Compositor:
    """Cinematic NFT compositor for the Capybara collection."""

    # ===== LOCKED v18 PARAMETERS =====
    # Character scale
    DEFAULT_WIDTH_PCT = 0.8075       # 80.75% of frame width
    DEFAULT_BOTTOM_MARGIN = 0.04      # 4% from bottom (feet position)
    DEFAULT_H_SHIFT = 10              # pixels right of center

    # Widening (stance weight)
    WIDEN_THRESHOLDS = [0.55, 0.70, 0.85, 1.0]
    WIDEN_FACTORS = [0.00, 0.02, 0.04, 0.05]  # 0% at hips → 5% at feet

    # Ground shadows
    SHADOW_WIDTH_PCT = 0.42           # shadow width as % of character width
    SHADOW_HEIGHT_PCT = 0.018         # shadow height as % of frame
    SHADOW_LAYERS = 20
    SHADOW_MAX_ALPHA = 12

    # Concentrated foot shadows
    FOOT_SHADOW_LAYERS = 14
    FOOT_SHADOW_MAX_ALPHA = 28
    FOOT_WIDTH_PCT = 0.085            # foot width as % of character width

    # Toe contact points
    TOE_OFFSETS = [-0.33, 0.0, 0.33] # relative to foot center (in foot widths)
    TOE_SHADOW_LAYERS = 6
    TOE_SHADOW_MAX_ALPHA = 35

    # Mud compression
    MUD_LAYERS = 8
    MUD_MAX_ALPHA = 18
    MUD_COLOR = (12, 18, 8)

    # Swamp depression rings
    INNER_RING_LAYERS = 5
    INNER_RING_MAX_ALPHA = 10
    INNER_RING_COLOR = (18, 32, 14)
    OUTER_RING_LAYERS = 7
    OUTER_RING_MAX_ALPHA = 6
    OUTER_RING_COLOR = (8, 38, 18)

    # Water shimmer
    WATER_LAYERS = 4
    WATER_MAX_ALPHA = 4
    WATER_COLOR = (45, 65, 35)

    # Dark water between feet
    DARK_WATER_LAYERS = 12
    DARK_WATER_MAX_ALPHA = 5
    DARK_WATER_COLOR = (4, 18, 6)
    DARK_WATER_WIDTH_PCT = 0.28

    # Broken reflection
    REFLECTION_FRAGMENTS = 18
    REFLECTION_HEIGHT_PCT = 0.035
    REFLECTION_WIDTH_PCT = 0.55

    # Atmospheric haze
    HAZE_START_PCT = 0.55             # starts at 55% down visible height
    HAZE_MAX_INTENSITY = 0.08         # max 8% blend
    HAZE_EDGE_BOOST = 0.5            # 50% more at edges

    # Edge diffusion
    EDGE_DIFFUSION_MIN = 0.02         # top of edge zone
    EDGE_DIFFUSION_MAX = 0.05         # bottom of edge zone
    EDGE_DIFFUSION_START_Y = 0.30     # below 30% = head zone, keep sharp
    EDGE_KERNEL_SIZE = 7

    # Bounce light
    BOUNCE_START_PCT = 0.45           # below 45% of visible height
    BOUNCE_MAX_INTENSITY = 0.015       # max 1.5%
    BOUNCE_COLOR = (15.0, 45.0, 25.0) # subtle swamp green
    BOUNCE_LUMINANCE_THRESHOLD = 120  # only in shadow regions

    # Foot-ground blend
    BLEND_HEIGHT_PCT = 0.05           # 5% of character height
    BLEND_MAX = 0.14
    BLEND_RED_FACTOR = 0.30
    BLEND_GREEN_FACTOR = 0.05
    BLEND_BLUE_ADD = 12

    # Mud staining
    MUD_STAIN_ZONE_PCT = 0.06         # 6% of character height
    MUD_STAIN_START = 0.6             # starts at 60% into stain zone
    MUD_STAIN_RED = 0.06
    MUD_STAIN_GREEN = 0.02
    MUD_STAIN_BLUE = 0.03

    # Rim lighting
    RIM_LEFT_WARM = 10               # green shift from left light
    RIM_LEFT_COOL = 25                # blue shift from left light
    RIM_RIGHT_WARM = 35               # red shift from right light
    RIM_RIGHT_GREEN = 5
    RIM_INTENSITY = 0.02

    # Swamp mist
    MIST_START_PCT = 0.75             # starts at 75% of frame height
    MIST_MAX_ALPHA = 6
    MIST_COLOR = (22, 36, 20)

    # Foot positions (relative to character width)
    LEFT_FOOT_PCT = 0.28
    RIGHT_FOOT_PCT = 0.54

    def __init__(
        self,
        background_path: str,
        character_path: str,
        width_pct: float = None,
        bottom_margin_pct: float = None,
        h_shift: int = None,
    ):
        self.bg = Image.open(background_path).convert('RGBA')
        self.capy = Image.open(character_path).convert('RGBA')
        self.frame_w, self.frame_h = self.bg.size
        self.width_pct = width_pct or self.DEFAULT_WIDTH_PCT
        self.bottom_margin_pct = bottom_margin_pct or self.DEFAULT_BOTTOM_MARGIN
        self.h_shift = h_shift if h_shift is not None else self.DEFAULT_H_SHIFT

    def _scale_character(self) -> tuple:
        """Scale character and return (scaled_img, x, y, feet_y, scaled_h, target_w)."""
        target_w = int(self.frame_w * self.width_pct)
        scale = target_w / self.capy.width
        scaled_h = int(self.capy.height * scale)
        capy_scaled = self.capy.resize((target_w, scaled_h), Image.LANCZOS)
        return capy_scaled, target_w, scale, scaled_h

    def _widen_stance(self, capy_scaled: Image.Image) -> Image.Image:
        """Apply subtle widening from hips to feet for grounded weight."""
        capy_arr = np.array(capy_scaled.convert('RGBA'), dtype=np.float32)
        h_img, w_img = capy_arr.shape[:2]
        ys_v, xs_v = np.where(capy_arr[:,:,3] > 128)
        center_x = (int(xs_v.min()) + int(xs_v.max())) // 2
        y_start, y_end = int(ys_v.min()), int(ys_v.max())
        body_h = y_end - y_start

        warped = np.zeros_like(capy_arr)
        for y_row in range(h_img):
            progress = (y_row - y_start) / max(1, body_h)
            # Interpolate widening
            if progress < self.WIDEN_THRESHOLDS[0]:
                widen = 1.0 + self.WIDEN_FACTORS[0]
            elif progress < self.WIDEN_THRESHOLDS[1]:
                t = (progress - self.WIDEN_THRESHOLDS[0]) / (self.WIDEN_THRESHOLDS[1] - self.WIDEN_THRESHOLDS[0])
                widen = 1.0 + self.WIDEN_FACTORS[0] + t * (self.WIDEN_FACTORS[1] - self.WIDEN_FACTORS[0])
            elif progress < self.WIDEN_THRESHOLDS[2]:
                t = (progress - self.WIDEN_THRESHOLDS[1]) / (self.WIDEN_THRESHOLDS[2] - self.WIDEN_THRESHOLDS[1])
                widen = 1.0 + self.WIDEN_FACTORS[1] + t * (self.WIDEN_FACTORS[2] - self.WIDEN_FACTORS[1])
            else:
                t = (progress - self.WIDEN_THRESHOLDS[2]) / (1.0 - self.WIDEN_THRESHOLDS[2])
                widen = 1.0 + self.WIDEN_FACTORS[2] + t * (self.WIDEN_FACTORS[3] - self.WIDEN_FACTORS[2])

            for x_col in range(w_img):
                dx = x_col - center_x
                orig_x = center_x + dx / widen
                ox0 = int(np.floor(orig_x))
                frac = orig_x - ox0
                ox1 = ox0 + 1
                if 0 <= ox0 < w_img and 0 <= ox1 < w_img:
                    for c in range(4):
                        warped[y_row, x_col, c] = capy_arr[y_row, ox0, c]*(1-frac) + capy_arr[y_row, ox1, c]*frac

        warped = np.clip(warped, 0, 255).astype(np.uint8)
        return Image.fromarray(warped, 'RGBA')

    def _build_ground_layer(self, target_w: int, x: int, feet_y: int, lf_cx: int, rf_cx: int) -> Image.Image:
        """Build all ground effects: shadows, mud, rings, water, reflection."""
        ground = Image.new('RGBA', self.bg.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(ground)
        foot_w = int(target_w * self.FOOT_WIDTH_PCT)
        shadow_w = int(target_w * self.SHADOW_WIDTH_PCT)
        shadow_h = int(self.frame_h * self.SHADOW_HEIGHT_PCT)
        shadow_x = x + (target_w - shadow_w) // 2
        shadow_y = feet_y - int(self.frame_h * 0.004)

        # 1. Primary shadow
        for i in range(self.SHADOW_LAYERS, 0, -1):
            alpha_v = int(self.SHADOW_MAX_ALPHA * (1 - (i/self.SHADOW_LAYERS)**0.5))
            ox = int(i * 2.0)
            oy = int(i * 0.6)
            draw.ellipse([shadow_x-ox, shadow_y-oy, shadow_x+shadow_w+ox, shadow_y+shadow_h+oy],
                        fill=(0, 0, 0, alpha_v))

        # 2. Concentrated foot shadows
        for i in range(self.FOOT_SHADOW_LAYERS, 0, -1):
            alpha_v = int(self.FOOT_SHADOW_MAX_ALPHA * (1 - (i/self.FOOT_SHADOW_LAYERS)**0.55))
            ox = int(i * 1.2)
            oy = int(i * 0.5)
            for cx in [lf_cx, rf_cx]:
                draw.ellipse([cx-foot_w-ox, feet_y-int(self.frame_h*0.005)-oy,
                              cx+foot_w+ox, feet_y+int(self.frame_h*0.006)+oy],
                             fill=(0, 0, 0, alpha_v))

        # 3. Toe contact points
        for cx in [lf_cx, rf_cx]:
            for toe_offset in self.TOE_OFFSETS:
                tx = cx + int(foot_w * toe_offset)
                for i in range(self.TOE_SHADOW_LAYERS, 0, -1):
                    alpha_v = int(self.TOE_SHADOW_MAX_ALPHA * (1 - (i/self.TOE_SHADOW_LAYERS)**0.6))
                    r = int(i * 0.8)
                    draw.ellipse([tx-r, feet_y-int(self.frame_h*0.002)-int(i*0.3),
                                  tx+r, feet_y+int(self.frame_h*0.003)+int(i*0.3)],
                                 fill=(0, 0, 0, alpha_v))

        # 4. Mud compression
        for cx in [lf_cx, rf_cx]:
            for i in range(self.MUD_LAYERS, 0, -1):
                alpha_v = int(self.MUD_MAX_ALPHA * (1 - (i/self.MUD_LAYERS)**0.7))
                mw = foot_w + int(i * 2)
                mh = int(self.frame_h * 0.004) + int(i * 0.8)
                draw.ellipse([cx-mw, feet_y+int(i*0.3), cx+mw, feet_y+mh+int(i*0.3)],
                             fill=(*self.MUD_COLOR, alpha_v))

        # 5. Swamp depression rings (inner + outer)
        for cx in [lf_cx, rf_cx]:
            for i in range(self.INNER_RING_LAYERS, 0, -1):
                alpha_v = int(self.INNER_RING_MAX_ALPHA * (1 - i/self.INNER_RING_LAYERS))
                rw = foot_w + int(i * 3)
                rh = int(self.frame_h * 0.005) + int(i * 1.5)
                draw.ellipse([cx-rw, feet_y-int(i*0.5), cx+rw, feet_y+rh+int(i*2)],
                             fill=(*self.INNER_RING_COLOR, alpha_v))
            for i in range(self.OUTER_RING_LAYERS, 0, -1):
                alpha_v = int(self.OUTER_RING_MAX_ALPHA * (1 - i/self.OUTER_RING_LAYERS))
                rw = foot_w + int(i * 5)
                rh = int(self.frame_h * 0.003) + int(i * 2)
                draw.ellipse([cx-rw, feet_y+int(i*0.8), cx+rw, feet_y+rh+int(i*3)],
                             fill=(*self.OUTER_RING_COLOR, alpha_v))

        # 6. Water shimmer
        for cx in [lf_cx, rf_cx]:
            for i in range(self.WATER_LAYERS, 0, -1):
                alpha_v = int(self.WATER_MAX_ALPHA * (1 - i/self.WATER_LAYERS))
                rw = foot_w + int(i * 6)
                rh = int(self.frame_h * 0.003) + int(i * 2.5)
                draw.ellipse([cx-rw, feet_y+int(i), cx+rw, feet_y+rh+int(i*3)],
                             fill=(*self.WATER_COLOR, alpha_v))

        # 7. Dark water between feet
        bcx = (lf_cx + rf_cx) // 2
        for i in range(self.DARK_WATER_LAYERS, 0, -1):
            alpha_v = int(self.DARK_WATER_MAX_ALPHA * (1 - i/self.DARK_WATER_LAYERS))
            bw = int(target_w * self.DARK_WATER_WIDTH_PCT) + int(i * 3)
            bh = int(self.frame_h * 0.008) + int(i * 1.5)
            draw.ellipse([bcx-bw, feet_y-int(i*0.3), bcx+bw, feet_y+bh+int(i*2)],
                         fill=(*self.DARK_WATER_COLOR, alpha_v))

        # 8. Broken reflection
        import random
        random.seed(42)
        refl_y_start = feet_y + 2
        refl_height = int(self.frame_h * self.REFLECTION_HEIGHT_PCT)
        refl_width = int(target_w * self.REFLECTION_WIDTH_PCT)
        refl_cx = (lf_cx + rf_cx) // 2

        for _ in range(self.REFLECTION_FRAGMENTS):
            frag_x = refl_cx + random.randint(-refl_width//2, refl_width//3)
            frag_y = refl_y_start + random.randint(2, refl_height)
            frag_len = random.randint(int(foot_w*0.3), int(foot_w*1.2))
            frag_alpha = random.randint(2, 6)
            for dx in range(-2, frag_len + 2):
                px = frag_x + dx
                py = frag_y + random.randint(-1, 1)
                if 0 <= px < self.frame_w and 0 <= py < self.frame_h:
                    draw.point((px, py), fill=(30+random.randint(-5,5),
                                                50+random.randint(-8,8),
                                                25+random.randint(-5,5), frag_alpha))

        # Reflection smear
        for i in range(10, 0, -1):
            alpha_v = int(3 * (1 - i/10))
            draw.ellipse([refl_cx-refl_width//2-int(i*2), refl_y_start+int(i*0.5),
                          refl_cx+refl_width//3+int(i*2), refl_y_start+refl_height+int(i*1.5)],
                         fill=(15, 30, 15, alpha_v))

        return ground

    def _sample_swamp_color(self, arr: np.ndarray, alpha_arr: np.ndarray, feet_y: int) -> tuple:
        """Sample the dominant swamp atmosphere color from background near feet."""
        bg_rgb = np.array(self.bg.convert('RGB'), dtype=np.float32)
        y1 = min(feet_y + 5, self.frame_h - 1)
        y2 = min(feet_y + 40, self.frame_h)
        x1 = int(self.frame_w * 0.3)
        x2 = int(self.frame_w * 0.7)
        swatch = bg_rgb[y1:y2, x1:x2]
        return (np.median(swatch[:,:,0]), np.median(swatch[:,:,1]), np.median(swatch[:,:,2]))

    def _apply_haze(self, arr: np.ndarray, alpha_arr: np.ndarray, feet_y: int, swamp_color: tuple) -> np.ndarray:
        """Atmospheric haze on lower body (below 55% of visible height)."""
        vis_ys = np.where(alpha_arr > 0.5)[0]
        if len(vis_ys) == 0:
            return arr
        vis_top = int(vis_ys.min())
        haze_start = vis_top + int((int(vis_ys.max()) - vis_top) * self.HAZE_START_PCT)
        haze_end = min(feet_y + 10, self.frame_h)
        sr, sg, sb = swamp_color

        for py in range(haze_start, haze_end):
            if py < 0: continue
            progress = (py - haze_start) / max(1, (feet_y + 10 - haze_start))
            haze = progress * self.HAZE_MAX_INTENSITY
            row_mask = alpha_arr[py, :] > 0.5
            capy_xs = np.where(row_mask)[0]
            if len(capy_xs) == 0: continue
            left_edge = capy_xs[0]
            right_edge = capy_xs[-1]
            row_width = right_edge - left_edge

            for px in capy_xs:
                dist_from_left = (px - left_edge) / max(1, row_width)
                edge_factor = min(dist_from_left, 1 - dist_from_left)
                edge_haze = haze * (1.0 + (1.0 - edge_factor * 2) * self.HAZE_EDGE_BOOST)
                edge_haze = min(0.15, edge_haze)
                arr[py, px, 0] = arr[py, px, 0] * (1 - edge_haze) + sr * edge_haze
                arr[py, px, 1] = arr[py, px, 1] * (1 - edge_haze) + sg * edge_haze
                arr[py, px, 2] = arr[py, px, 2] * (1 - edge_haze) + sb * edge_haze
        return arr

    def _apply_edge_diffusion(self, arr: np.ndarray, alpha_arr: np.ndarray, feet_y: int, swamp_color: tuple) -> np.ndarray:
        """Humidity softness on silhouette edges (not face/center)."""
        from scipy import ndimage
        alpha_binary = (alpha_arr > 0.3).astype(np.float32)
        inner_edge = ndimage.binary_erosion(alpha_binary.astype(bool), iterations=2)
        edge_band = (alpha_binary > 0.3) & (~inner_edge | ((alpha_arr > 0.1) & (alpha_arr < 0.95)))

        vis_ys = np.where(alpha_arr > 0.5)[0]
        if len(vis_ys) == 0:
            return arr
        vis_top = int(vis_ys.min())
        vis_height = int(vis_ys.max()) - vis_top
        y_midpoint = vis_top + int(vis_height * self.EDGE_DIFFUSION_START_Y)
        sr, sg, sb = swamp_color

        for py in range(y_midpoint, min(feet_y + 5, self.frame_h)):
            if py < 0: continue
            progress = (py - y_midpoint) / max(1, (feet_y + 5 - y_midpoint))
            edge_strength = self.EDGE_DIFFUSION_MIN + progress * (self.EDGE_DIFFUSION_MAX - self.EDGE_DIFFUSION_MIN)
            for px in np.where(edge_band[py, :])[0]:
                if alpha_arr[py, px] < 0.3: continue
                arr[py, px, 0] = arr[py, px, 0] * (1 - edge_strength) + sr * edge_strength
                arr[py, px, 1] = arr[py, px, 1] * (1 - edge_strength) + sg * edge_strength
                arr[py, px, 2] = arr[py, px, 2] * (1 - edge_strength) + sb * edge_strength
        return arr

    def _apply_bounce_light(self, arr: np.ndarray, alpha_arr: np.ndarray, feet_y: int) -> np.ndarray:
        """Faint swamp green bounce light in shadow regions."""
        vis_ys = np.where(alpha_arr > 0.5)[0]
        if len(vis_ys) == 0:
            return arr
        vis_top = int(vis_ys.min())
        vis_height = int(vis_ys.max()) - vis_top
        bounce_start_y = vis_top + int(vis_height * self.BOUNCE_START_PCT)
        br, bg_c, bb = self.BOUNCE_COLOR

        for py in range(bounce_start_y, min(feet_y, self.frame_h)):
            progress = (py - bounce_start_y) / max(1, (feet_y - bounce_start_y))
            bounce_intensity = self.BOUNCE_MAX_INTENSITY * progress
            row_mask = alpha_arr[py, :] > 0.5
            for px in np.where(row_mask)[0]:
                luminance = arr[py, px, 0] * 0.299 + arr[py, px, 1] * 0.587 + arr[py, px, 2] * 0.114
                if luminance < self.BOUNCE_LUMINANCE_THRESHOLD:
                    shadow_factor = (self.BOUNCE_LUMINANCE_THRESHOLD - luminance) / self.BOUNCE_LUMINANCE_THRESHOLD
                    actual = bounce_intensity * shadow_factor
                    arr[py, px, 0] = min(255, arr[py, px, 0] + br * actual)
                    arr[py, px, 1] = min(255, arr[py, px, 1] + bg_c * actual)
                    arr[py, px, 2] = min(255, arr[py, px, 2] + bb * actual)
        return arr

    def _apply_foot_blend(self, arr: np.ndarray, alpha_arr: np.ndarray, feet_y: int, scaled_h: int,
                          lf_x: int, rf_x: int, foot_w: int) -> np.ndarray:
        """Color merge at foot-ground contact."""
        blend_start = feet_y - int(scaled_h * self.BLEND_HEIGHT_PCT)
        blend_end = feet_y + int(self.frame_h * 0.005)

        for py in range(max(0, blend_start), min(blend_end, self.frame_h)):
            if py <= feet_y:
                progress = (py - blend_start) / max(1, (feet_y - blend_start))
            else:
                progress = 1.0 + (py - feet_y) / max(1, (blend_end - feet_y))
            blend = min(self.BLEND_MAX, progress * self.BLEND_MAX)
            row_mask = alpha_arr[py, :] > 0.5
            for px in np.where(row_mask)[0]:
                arr[py, px, 0] = max(0, arr[py, px, 0] * (1 - blend * self.BLEND_RED_FACTOR))
                arr[py, px, 1] = min(255, arr[py, px, 1] * (1 - blend * self.BLEND_GREEN_FACTOR))
                arr[py, px, 2] = min(255, arr[py, px, 2] + blend * self.BLEND_BLUE_ADD)
        return arr

    def _apply_mud_stain(self, arr: np.ndarray, alpha_arr: np.ndarray, feet_y: int, scaled_h: int,
                         lf_x: int, rf_x: int, foot_w: int) -> np.ndarray:
        """Mud staining on feet — green-dark tint."""
        foot_zone_top = feet_y - int(scaled_h * self.MUD_STAIN_ZONE_PCT)
        for py in range(max(0, foot_zone_top), min(feet_y, self.frame_h)):
            progress = (py - foot_zone_top) / max(1, (feet_y - foot_zone_top))
            if progress < self.MUD_STAIN_START: continue
            stain = (progress - self.MUD_STAIN_START) / (1.0 - self.MUD_STAIN_START)
            for px in range(max(0, lf_x-5), min(lf_x+foot_w+5, self.frame_w)):
                if alpha_arr[py, px] > 0.5:
                    arr[py, px, 0] = max(0, arr[py, px, 0] * (1 - stain * self.MUD_STAIN_RED))
                    arr[py, px, 1] = min(255, arr[py, px, 1] * (1 + stain * self.MUD_STAIN_GREEN))
                    arr[py, px, 2] = min(255, arr[py, px, 2] * (1 + stain * self.MUD_STAIN_BLUE))
            for px in range(max(0, rf_x-5), min(rf_x+foot_w+5, self.frame_w)):
                if alpha_arr[py, px] > 0.5:
                    arr[py, px, 0] = max(0, arr[py, px, 0] * (1 - stain * self.MUD_STAIN_RED))
                    arr[py, px, 1] = min(255, arr[py, px, 1] * (1 + stain * self.MUD_STAIN_GREEN))
                    arr[py, px, 2] = min(255, arr[py, px, 2] * (1 + stain * self.MUD_STAIN_BLUE))
        return arr

    def _apply_rim_lighting(self, arr: np.ndarray, alpha_arr: np.ndarray) -> np.ndarray:
        """Cinematic rim lighting — warm right, cool left."""
        ys, xs = np.where(alpha_arr > 0.5)
        if len(ys) == 0:
            return arr
        vis_xmin, vis_xmax = int(xs.min()), int(xs.max())
        vis_w = vis_xmax - vis_xmin
        norm_x = ((xs - vis_xmin) / max(1, vis_w)).astype(np.float32)
        left_w = (1.0 - norm_x) * alpha_arr[ys, xs] * self.RIM_INTENSITY
        right_w = norm_x * alpha_arr[ys, xs] * self.RIM_INTENSITY

        for i in range(len(ys)):
            py, px = int(ys[i]), int(xs[i])
            lw = float(left_w[i])
            rw = float(right_w[i])
            arr[py, px, 0] = min(255, arr[py, px, 0] + rw * self.RIM_RIGHT_WARM)
            arr[py, px, 1] = min(255, arr[py, px, 1] + lw * self.RIM_LEFT_WARM + rw * self.RIM_RIGHT_GREEN)
            arr[py, px, 2] = min(255, arr[py, px, 2] + lw * self.RIM_LEFT_COOL)
        return arr

    def _build_mist_layer(self) -> Image.Image:
        """Faint swamp mist in lower frame."""
        mist = Image.new('RGBA', self.bg.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(mist)
        y_start = int(self.frame_h * self.MIST_START_PCT)
        for py in range(y_start, self.frame_h):
            progress = (py - y_start) / (self.frame_h - y_start)
            alpha_v = int(self.MIST_MAX_ALPHA * progress)
            draw.line([(0, py), (self.frame_w, py)], fill=(*self.MIST_COLOR, alpha_v))
        return mist

    def compose(self) -> Image.Image:
        """Run the full compositing pipeline and return final image."""
        # 1. Scale & widen
        capy_scaled, target_w, scale, scaled_h = self._scale_character()
        capy_warped = self._widen_stance(capy_scaled)

        # Position
        capy_alpha = np.array(capy_warped.split()[3])
        capy_bottom = int(np.where(capy_alpha > 128)[0].max())
        x = (self.frame_w - target_w) // 2 + self.h_shift
        y = self.frame_h - capy_bottom - int(self.frame_h * self.bottom_margin_pct)
        feet_y = y + capy_bottom

        # Foot positions
        foot_w = int(target_w * self.FOOT_WIDTH_PCT)
        lf_x = x + int(target_w * self.LEFT_FOOT_PCT)
        rf_x = x + int(target_w * self.RIGHT_FOOT_PCT)
        lf_cx = lf_x + foot_w // 2
        rf_cx = rf_x + foot_w // 2

        # 2. Ground layer
        ground = self._build_ground_layer(target_w, x, feet_y, lf_cx, rf_cx)
        composite = Image.alpha_composite(self.bg, ground)

        # 3. Place character
        capy_layer = Image.new('RGBA', self.bg.size, (0, 0, 0, 0))
        capy_layer.paste(capy_warped, (x, y), capy_warped)
        composite = Image.alpha_composite(composite, capy_layer)

        # 4. Pixel-level passes
        arr = np.array(composite.convert('RGB'), dtype=np.float32)
        alpha_arr = np.array(composite.split()[3], dtype=np.float32) / 255.0
        swamp_color = self._sample_swamp_color(arr, alpha_arr, feet_y)

        # 5. Atmospheric haze
        arr = self._apply_haze(arr, alpha_arr, feet_y, swamp_color)

        # 6. Edge diffusion
        arr = self._apply_edge_diffusion(arr, alpha_arr, feet_y, swamp_color)

        # 7. Bounce light
        arr = self._apply_bounce_light(arr, alpha_arr, feet_y)

        # 8. Foot-ground blend
        arr = self._apply_foot_blend(arr, alpha_arr, feet_y, scaled_h, lf_x, rf_x, foot_w)

        # 9. Mud staining
        arr = self._apply_mud_stain(arr, alpha_arr, feet_y, scaled_h, lf_x, rf_x, foot_w)

        # 10. Rim lighting
        arr = self._apply_rim_lighting(arr, alpha_arr)

        # 11. Clip & alpha
        arr = np.clip(arr, 0, 255).astype(np.uint8)
        result = Image.fromarray(arr).convert('RGBA')
        result.putalpha(composite.split()[3])

        # 12. Swamp mist
        mist = self._build_mist_layer()
        result = Image.alpha_composite(result, mist)

        return result


def compose_single(background_path: str, character_path: str, output_path: str,
                   width_pct: float = None, bottom_margin_pct: float = None) -> str:
    """Convenience function: compose and save."""
    comp = Compositor(background_path, character_path, width_pct, bottom_margin_pct)
    result = comp.compose()
    result.save(output_path)
    return output_path


if __name__ == '__main__':
    import sys
    bg_path = sys.argv[1] if len(sys.argv) > 1 else 'public/traits/background/swamp.png'
    char_path = sys.argv[2] if len(sys.argv) > 2 else 'public/traits/base/common.png'
    out_path = sys.argv[3] if len(sys.argv) > 3 else 'public/composite_swamp_pipeline.png'

    result_path = compose_single(bg_path, char_path, out_path)
    img = Image.open(result_path)
    print(f"Composited: {img.size} → {result_path}")