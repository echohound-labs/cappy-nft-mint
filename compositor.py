"""
Capybara NFT Compositor v2.0 — Per-Environment Profiles
=========================================================
Definitive compositing pipeline for the Capybara NFT collection.

v18 locked standard with per-environment physics:
- Swamp: water/mud grounding, humidity, green bounce
- Lava Core: rock contact, heat haze, warm glow
- Neon City: wet concrete, neon reflections, urban haze
- Ocean Lab: wet floor, cold blue bounce, clinical
- Forest: moss/earth, canopy depth, dappled warm
- Space Grid: energy grid, minimal atmosphere, cosmic glow

USAGE:
    from compositor import Compositor
    from env_profiles import get_profile
    
    profile = get_profile('lava_core')
    comp = Compositor(
        background_path="public/traits/background/lava_core.png",
        character_path="public/traits/base/common.png",
        profile=profile,
    )
    result = comp.compose()
    result.save("output.png")
"""

from PIL import Image, ImageDraw, ImageFilter
import numpy as np

from env_profiles import EnvProfile, SWAMP


class Compositor:
    """Cinematic NFT compositor with per-environment physics."""

    def __init__(
        self,
        background_path: str,
        character_path: str,
        profile: EnvProfile = None,
    ):
        self.bg = Image.open(background_path).convert('RGBA')
        self.capy = Image.open(character_path).convert('RGBA')
        self.frame_w, self.frame_h = self.bg.size
        self.profile = profile or SWAMP
        self.p = self.profile  # shorthand

    def _scale_character(self) -> tuple:
        """Scale character and return (scaled_img, target_w, scale, scaled_h)."""
        target_w = int(self.frame_w * self.p.width_pct)
        scale = target_w / self.capy.width
        scaled_h = int(self.capy.height * scale)
        capy_scaled = self.capy.resize((target_w, scaled_h), Image.LANCZOS)
        return capy_scaled, target_w, scale, scaled_h

    def _widen_stance(self, capy_scaled: Image.Image) -> Image.Image:
        """Apply subtle widening from hips to feet for grounded weight."""
        WIDEN_THRESHOLDS = [0.55, 0.70, 0.85, 1.0]
        WIDEN_FACTORS = [0.00, 0.02, 0.04, 0.05]

        capy_arr = np.array(capy_scaled.convert('RGBA'), dtype=np.float32)
        h_img, w_img = capy_arr.shape[:2]
        ys_v, xs_v = np.where(capy_arr[:,:,3] > 128)
        center_x = (int(xs_v.min()) + int(xs_v.max())) // 2
        y_start, y_end = int(ys_v.min()), int(ys_v.max())
        body_h = y_end - y_start

        warped = np.zeros_like(capy_arr)
        for y_row in range(h_img):
            progress = (y_row - y_start) / max(1, body_h)
            if progress < WIDEN_THRESHOLDS[0]:
                widen = 1.0 + WIDEN_FACTORS[0]
            elif progress < WIDEN_THRESHOLDS[1]:
                t = (progress - WIDEN_THRESHOLDS[0]) / (WIDEN_THRESHOLDS[1] - WIDEN_THRESHOLDS[0])
                widen = 1.0 + WIDEN_FACTORS[0] + t * (WIDEN_FACTORS[1] - WIDEN_FACTORS[0])
            elif progress < WIDEN_THRESHOLDS[2]:
                t = (progress - WIDEN_THRESHOLDS[1]) / (WIDEN_THRESHOLDS[2] - WIDEN_THRESHOLDS[1])
                widen = 1.0 + WIDEN_FACTORS[1] + t * (WIDEN_FACTORS[2] - WIDEN_FACTORS[1])
            else:
                t = (progress - WIDEN_THRESHOLDS[2]) / (1.0 - WIDEN_THRESHOLDS[2])
                widen = 1.0 + WIDEN_FACTORS[2] + t * (WIDEN_FACTORS[3] - WIDEN_FACTORS[2])

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
        """Build ground effects with per-environment physics."""
        p = self.p
        ground = Image.new('RGBA', self.bg.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(ground)
        foot_w = int(target_w * p.foot_width_pct)
        shadow_w = int(target_w * p.shadow_width_pct)
        shadow_h = int(self.frame_h * p.shadow_height_pct)
        shadow_x = x + (target_w - shadow_w) // 2
        shadow_y = feet_y - int(self.frame_h * 0.004)

        # Primary shadow
        for i in range(20, 0, -1):
            alpha_v = int(12 * p.shadow_strength * (1 - (i/20)**0.5))
            ox = int(i * 2.0)
            oy = int(i * 0.6)
            draw.ellipse([shadow_x-ox, shadow_y-oy, shadow_x+shadow_w+ox, shadow_y+shadow_h+oy],
                        fill=(0, 0, 0, alpha_v))

        # Concentrated foot shadows
        for i in range(14, 0, -1):
            alpha_v = int(28 * p.foot_shadow_strength * (1 - (i/14)**0.55))
            ox = int(i * 1.2)
            oy = int(i * 0.5)
            for cx in [lf_cx, rf_cx]:
                draw.ellipse([cx-foot_w-ox, feet_y-int(self.frame_h*0.005)-oy,
                              cx+foot_w+ox, feet_y+int(self.frame_h*0.006)+oy],
                             fill=(0, 0, 0, alpha_v))

        # Toe contact points
        for cx in [lf_cx, rf_cx]:
            for toe_offset in p.toe_offsets:
                tx = cx + int(foot_w * toe_offset)
                for i in range(6, 0, -1):
                    alpha_v = int(35 * p.toe_contact_strength * (1 - (i/6)**0.6))
                    r = int(i * 0.8)
                    draw.ellipse([tx-r, feet_y-int(self.frame_h*0.002)-int(i*0.3),
                                  tx+r, feet_y+int(self.frame_h*0.003)+int(i*0.3)],
                                 fill=(0, 0, 0, alpha_v))

        # Mud/compression
        for cx in [lf_cx, rf_cx]:
            for i in range(8, 0, -1):
                alpha_v = int(18 * p.mud_strength * (1 - (i/8)**0.7))
                mw = foot_w + int(i * 2)
                mh = int(self.frame_h * 0.004) + int(i * 0.8)
                draw.ellipse([cx-mw, feet_y+int(i*0.3), cx+mw, feet_y+mh+int(i*0.3)],
                             fill=(*p.mud_color, alpha_v))

        # Depression rings
        for cx in [lf_cx, rf_cx]:
            for i in range(5, 0, -1):
                alpha_v = int(10 * p.ring_strength * (1 - i/5))
                rw = foot_w + int(i * 3)
                rh = int(self.frame_h * 0.005) + int(i * 1.5)
                draw.ellipse([cx-rw, feet_y-int(i*0.5), cx+rw, feet_y+rh+int(i*2)],
                             fill=(*p.inner_ring_color, alpha_v))
            for i in range(7, 0, -1):
                alpha_v = int(6 * p.ring_strength * (1 - i/7))
                rw = foot_w + int(i * 5)
                rh = int(self.frame_h * 0.003) + int(i * 2)
                draw.ellipse([cx-rw, feet_y+int(i*0.8), cx+rw, feet_y+rh+int(i*3)],
                             fill=(*p.outer_ring_color, alpha_v))

        # Water shimmer (only for water/wet environments)
        if p.water_shimmer_strength > 0:
            for cx in [lf_cx, rf_cx]:
                for i in range(4, 0, -1):
                    alpha_v = int(4 * p.water_shimmer_strength * (1 - i/4))
                    rw = foot_w + int(i * 6)
                    rh = int(self.frame_h * 0.003) + int(i * 2.5)
                    draw.ellipse([cx-rw, feet_y+int(i), cx+rw, feet_y+rh+int(i*3)],
                                 fill=(*p.water_color, alpha_v))

        # Dark water/pooling between feet
        if p.dark_water_strength > 0:
            bcx = (lf_cx + rf_cx) // 2
            for i in range(12, 0, -1):
                alpha_v = int(5 * p.dark_water_strength * (1 - i/12))
                bw = int(target_w * 0.28) + int(i * 3)
                bh = int(self.frame_h * 0.008) + int(i * 1.5)
                draw.ellipse([bcx-bw, feet_y-int(i*0.3), bcx+bw, feet_y+bh+int(i*2)],
                             fill=(*p.dark_water_color, alpha_v))

        # Reflection
        if p.reflection_strength > 0:
            import random
            random.seed(42)
            refl_y_start = feet_y + 2
            refl_height = int(self.frame_h * p.reflection_height_pct)
            refl_width = int(target_w * p.reflection_width_pct)
            refl_cx = (lf_cx + rf_cx) // 2

            # Fragment count scales with strength
            n_frags = int(p.reflection_fragments * p.reflection_strength)
            for _ in range(n_frags):
                frag_x = refl_cx + random.randint(-refl_width//2, refl_width//3)
                frag_y = refl_y_start + random.randint(2, refl_height)
                frag_len = random.randint(int(foot_w*0.3), int(foot_w*1.2))
                frag_alpha = max(1, int(6 * p.reflection_strength))
                frag_alpha = min(frag_alpha, random.randint(2, 8))

                for dx in range(-2, frag_len + 2):
                    px = frag_x + dx
                    py = frag_y + random.randint(-1, 1)
                    if 0 <= px < self.frame_w and 0 <= py < self.frame_h:
                        draw.point((px, py), fill=(30+random.randint(-5,5),
                                                    50+random.randint(-8,8),
                                                    25+random.randint(-5,5), frag_alpha))

            # Reflection smear
            for i in range(10, 0, -1):
                alpha_v = max(1, int(3 * p.reflection_strength * (1 - i/10)))
                draw.ellipse([refl_cx-refl_width//2-int(i*2), refl_y_start+int(i*0.5),
                              refl_cx+refl_width//3+int(i*2), refl_y_start+refl_height+int(i*1.5)],
                             fill=(15, 30, 15, alpha_v))

        return ground

    def _sample_swamp_color(self, feet_y: int) -> tuple:
        """Sample dominant environment color from background near feet."""
        bg_rgb = np.array(self.bg.convert('RGB'), dtype=np.float32)
        y1 = min(feet_y + 5, self.frame_h - 1)
        y2 = min(feet_y + 40, self.frame_h)
        x1 = int(self.frame_w * 0.3)
        x2 = int(self.frame_w * 0.7)
        swatch = bg_rgb[y1:y2, x1:x2]
        return (np.median(swatch[:,:,0]), np.median(swatch[:,:,1]), np.median(swatch[:,:,2]))

    def _apply_haze(self, arr: np.ndarray, alpha_arr: np.ndarray, feet_y: int, env_color: tuple) -> np.ndarray:
        """Atmospheric haze on lower body."""
        p = self.p
        vis_ys = np.where(alpha_arr > 0.5)[0]
        if len(vis_ys) == 0:
            return arr
        vis_top = int(vis_ys.min())
        vis_height = int(vis_ys.max()) - vis_top
        haze_start = vis_top + int(vis_height * p.haze_start_pct)
        haze_end = min(feet_y + 10, self.frame_h)
        er, eg, eb = env_color

        for py in range(haze_start, haze_end):
            if py < 0: continue
            progress = (py - haze_start) / max(1, (feet_y + 10 - haze_start))
            haze = progress * p.haze_max_intensity
            row_mask = alpha_arr[py, :] > 0.5
            capy_xs = np.where(row_mask)[0]
            if len(capy_xs) == 0: continue
            left_edge = capy_xs[0]
            right_edge = capy_xs[-1]
            row_width = right_edge - left_edge

            for px in capy_xs:
                dist_from_left = (px - left_edge) / max(1, row_width)
                edge_factor = min(dist_from_left, 1 - dist_from_left)
                edge_haze = haze * (1.0 + (1.0 - edge_factor * 2) * p.haze_edge_boost)
                edge_haze = min(0.15, edge_haze)
                arr[py, px, 0] = arr[py, px, 0] * (1 - edge_haze) + er * edge_haze
                arr[py, px, 1] = arr[py, px, 1] * (1 - edge_haze) + eg * edge_haze
                arr[py, px, 2] = arr[py, px, 2] * (1 - edge_haze) + eb * edge_haze
        return arr

    def _apply_edge_diffusion(self, arr: np.ndarray, alpha_arr: np.ndarray, feet_y: int, env_color: tuple) -> np.ndarray:
        """Humidity softness on silhouette edges."""
        p = self.p
        from scipy import ndimage
        alpha_binary = (alpha_arr > 0.3).astype(np.float32)
        inner_edge = ndimage.binary_erosion(alpha_binary.astype(bool), iterations=2)
        edge_band = (alpha_binary > 0.3) & (~inner_edge | ((alpha_arr > 0.1) & (alpha_arr < 0.95)))

        vis_ys = np.where(alpha_arr > 0.5)[0]
        if len(vis_ys) == 0:
            return arr
        vis_top = int(vis_ys.min())
        vis_height = int(vis_ys.max()) - vis_top
        y_midpoint = vis_top + int(vis_height * p.edge_diffusion_start_y)
        er, eg, eb = env_color

        for py in range(y_midpoint, min(feet_y + 5, self.frame_h)):
            if py < 0: continue
            progress = (py - y_midpoint) / max(1, (feet_y + 5 - y_midpoint))
            edge_strength = p.edge_diffusion_min + progress * (p.edge_diffusion_max - p.edge_diffusion_min)
            for px in np.where(edge_band[py, :])[0]:
                if alpha_arr[py, px] < 0.3: continue
                arr[py, px, 0] = arr[py, px, 0] * (1 - edge_strength) + er * edge_strength
                arr[py, px, 1] = arr[py, px, 1] * (1 - edge_strength) + eg * edge_strength
                arr[py, px, 2] = arr[py, px, 2] * (1 - edge_strength) + eb * edge_strength
        return arr

    def _apply_bounce_light(self, arr: np.ndarray, alpha_arr: np.ndarray, feet_y: int) -> np.ndarray:
        """Environment-colored bounce light in shadow regions."""
        p = self.p
        vis_ys = np.where(alpha_arr > 0.5)[0]
        if len(vis_ys) == 0:
            return arr
        vis_top = int(vis_ys.min())
        vis_height = int(vis_ys.max()) - vis_top
        bounce_start_y = vis_top + int(vis_height * p.bounce_start_pct)
        br, bg_c, bb = p.bounce_color

        for py in range(bounce_start_y, min(feet_y, self.frame_h)):
            progress = (py - bounce_start_y) / max(1, (feet_y - bounce_start_y))
            bounce_intensity = p.bounce_max_intensity * progress
            row_mask = alpha_arr[py, :] > 0.5
            for px in np.where(row_mask)[0]:
                luminance = arr[py, px, 0] * 0.299 + arr[py, px, 1] * 0.587 + arr[py, px, 2] * 0.114
                if luminance < p.bounce_luminance_threshold:
                    shadow_factor = (p.bounce_luminance_threshold - luminance) / p.bounce_luminance_threshold
                    actual = bounce_intensity * shadow_factor
                    arr[py, px, 0] = min(255, arr[py, px, 0] + br * actual)
                    arr[py, px, 1] = min(255, arr[py, px, 1] + bg_c * actual)
                    arr[py, px, 2] = min(255, arr[py, px, 2] + bb * actual)
        return arr

    def _apply_foot_blend(self, arr: np.ndarray, alpha_arr: np.ndarray, feet_y: int, scaled_h: int,
                          lf_x: int, rf_x: int, foot_w: int) -> np.ndarray:
        """Color merge at foot-ground contact."""
        p = self.p
        blend_start = feet_y - int(scaled_h * p.blend_height_pct)
        blend_end = feet_y + int(self.frame_h * 0.005)

        for py in range(max(0, blend_start), min(blend_end, self.frame_h)):
            if py <= feet_y:
                progress = (py - blend_start) / max(1, (feet_y - blend_start))
            else:
                progress = 1.0 + (py - feet_y) / max(1, (blend_end - feet_y))
            blend = min(p.blend_max, progress * p.blend_max)
            row_mask = alpha_arr[py, :] > 0.5
            for px in np.where(row_mask)[0]:
                arr[py, px, 0] = max(0, arr[py, px, 0] * (1 - blend * p.blend_red_factor))
                arr[py, px, 1] = min(255, arr[py, px, 1] * (1 - blend * p.blend_green_factor))
                arr[py, px, 2] = min(255, arr[py, px, 2] + blend * p.blend_blue_add)
        return arr

    def _apply_mud_stain(self, arr: np.ndarray, alpha_arr: np.ndarray, feet_y: int, scaled_h: int,
                         lf_x: int, rf_x: int, foot_w: int) -> np.ndarray:
        """Ground staining on feet."""
        p = self.p
        foot_zone_top = feet_y - int(scaled_h * p.mud_stain_zone_pct)
        for py in range(max(0, foot_zone_top), min(feet_y, self.frame_h)):
            progress = (py - foot_zone_top) / max(1, (feet_y - foot_zone_top))
            if progress < p.mud_stain_start: continue
            stain = (progress - p.mud_stain_start) / (1.0 - p.mud_stain_start)
            for px in range(max(0, lf_x-5), min(lf_x+foot_w+5, self.frame_w)):
                if alpha_arr[py, px] > 0.5:
                    arr[py, px, 0] = max(0, arr[py, px, 0] * (1 - stain * p.mud_stain_red))
                    arr[py, px, 1] = min(255, arr[py, px, 1] * (1 + stain * p.mud_stain_green))
                    arr[py, px, 2] = min(255, arr[py, px, 2] * (1 + stain * p.mud_stain_blue))
            for px in range(max(0, rf_x-5), min(rf_x+foot_w+5, self.frame_w)):
                if alpha_arr[py, px] > 0.5:
                    arr[py, px, 0] = max(0, arr[py, px, 0] * (1 - stain * p.mud_stain_red))
                    arr[py, px, 1] = min(255, arr[py, px, 1] * (1 + stain * p.mud_stain_green))
                    arr[py, px, 2] = min(255, arr[py, px, 2] * (1 + stain * p.mud_stain_blue))
        return arr

    def _apply_rim_lighting(self, arr: np.ndarray, alpha_arr: np.ndarray) -> np.ndarray:
        """Cinematic rim lighting — per-environment colors."""
        p = self.p
        ys, xs = np.where(alpha_arr > 0.5)
        if len(ys) == 0:
            return arr
        vis_xmin, vis_xmax = int(xs.min()), int(xs.max())
        vis_w = vis_xmax - vis_xmin
        norm_x = ((xs - vis_xmin) / max(1, vis_w)).astype(np.float32)
        left_w = (1.0 - norm_x) * alpha_arr[ys, xs] * p.rim_intensity
        right_w = norm_x * alpha_arr[ys, xs] * p.rim_intensity

        for i in range(len(ys)):
            py, px = int(ys[i]), int(xs[i])
            lw = float(left_w[i])
            rw = float(right_w[i])
            arr[py, px, 0] = min(255, arr[py, px, 0] + rw * p.rim_right_warm)
            arr[py, px, 1] = min(255, arr[py, px, 1] + lw * p.rim_left_warm + rw * p.rim_right_green)
            arr[py, px, 2] = min(255, arr[py, px, 2] + lw * p.rim_left_cool)
        return arr

    def _build_mist_layer(self) -> Image.Image:
        """Per-environment atmospheric mist."""
        p = self.p
        mist = Image.new('RGBA', self.bg.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(mist)
        y_start = int(self.frame_h * p.mist_start_pct)
        for py in range(y_start, self.frame_h):
            progress = (py - y_start) / (self.frame_h - y_start)
            alpha_v = int(p.mist_max_alpha * progress)
            draw.line([(0, py), (self.frame_w, py)], fill=(*p.mist_color, alpha_v))
        return mist

    def compose(self) -> Image.Image:
        """Run the full compositing pipeline with environment profile."""
        p = self.p

        # 1. Scale & widen
        capy_scaled, target_w, scale, scaled_h = self._scale_character()
        capy_warped = self._widen_stance(capy_scaled)

        # Position (accounting for foot sink)
        capy_alpha = np.array(capy_warped.split()[3])
        capy_bottom = int(np.where(capy_alpha > 128)[0].max())
        x = (self.frame_w - target_w) // 2 + p.h_shift
        y = self.frame_h - capy_bottom - int(self.frame_h * p.bottom_margin_pct)
        # Foot sink: shift character down into ground
        y -= int(scaled_h * p.foot_sink_pct)
        feet_y = y + capy_bottom

        # Foot positions
        foot_w = int(target_w * p.foot_width_pct)
        lf_x = x + int(target_w * 0.28)
        rf_x = x + int(target_w * 0.54)
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
        env_color = self._sample_swamp_color(feet_y)

        # 5. Atmospheric haze (auto-samples background color)
        arr = self._apply_haze(arr, alpha_arr, feet_y, env_color)

        # 6. Edge diffusion
        arr = self._apply_edge_diffusion(arr, alpha_arr, feet_y, env_color)

        # 7. Bounce light (uses profile color)
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

        # 12. Mist
        mist = self._build_mist_layer()
        result = Image.alpha_composite(result, mist)

        return result


def compose_with_profile(background_path: str, character_path: str, profile_name: str, output_path: str) -> str:
    """Compose with a named environment profile."""
    from env_profiles import get_profile
    profile = get_profile(profile_name)
    comp = Compositor(background_path, character_path, profile)
    result = comp.compose()
    result.save(output_path)
    return output_path


if __name__ == '__main__':
    import sys
    bg_path = sys.argv[1] if len(sys.argv) > 1 else 'public/traits/background/swamp.png'
    char_path = sys.argv[2] if len(sys.argv) > 2 else 'public/traits/base/common.png'
    profile_name = sys.argv[3] if len(sys.argv) > 3 else 'swamp'
    out_path = sys.argv[4] if len(sys.argv) > 4 else f'public/composite_{profile_name}_v2.png'

    result_path = compose_with_profile(bg_path, char_path, profile_name, out_path)
    img = Image.open(result_path)
    print(f"Composited ({profile_name}): {img.size} → {result_path}")