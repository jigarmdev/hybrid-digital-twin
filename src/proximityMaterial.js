import * as THREE from "three";

/**
 * applyProximityGlow(material)
 * -----------------------------
 * Uses Three.js's onBeforeCompile hook to inject a `uProximity` uniform and
 * a small fragment-shader patch into an existing material (so you keep all
 * of its normal lighting behavior — this is additive, not a full custom
 * ShaderMaterial rewrite).
 *
 * uProximity is expected to be a 0..1 float: 0 = far from any dense splat
 * region, 1 = very close / touching. Update it once per frame from your
 * render loop (see main.js) after querying the SpatialGrid.
 *
 * Returns the uniforms object so the caller can update `.value` each frame.
 */
export function applyProximityGlow(material, {
  glowColor = new THREE.Color(0x36e2ff),
  maxEmissiveIntensity = 2.2,
} = {}) {
  const uniforms = {
    uProximity: { value: 0.0 },
    uGlowColor: { value: glowColor },
    uMaxEmissive: { value: maxEmissiveIntensity },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `
        #include <common>
        uniform float uProximity;
        uniform vec3 uGlowColor;
        uniform float uMaxEmissive;
        `
      )
      .replace(
        "#include <dithering_fragment>",
        `
        #include <dithering_fragment>
        // Phase 3: proximity-driven glow. uProximity is written from JS each
        // frame based on distance to the nearest dense splat region.
        float glowStrength = smoothstep(0.0, 1.0, uProximity);
        gl_FragColor.rgb += uGlowColor * glowStrength * uMaxEmissive;
        `
      );
  };

  // Force Three.js to recompile the shader with our injected code.
  material.needsUpdate = true;

  return uniforms;
}

/**
 * Maps a raw world-space distance to a 0..1 proximity value.
 * @param {number} distance - distance to nearest dense splat point
 * @param {number} nearDistance - distance at which glow is fully maxed (1.0)
 * @param {number} farDistance - distance beyond which glow is 0.0
 */
export function distanceToProximity(distance, nearDistance = 0.15, farDistance = 1.5) {
  if (!Number.isFinite(distance)) return 0;
  const t = 1.0 - (distance - nearDistance) / (farDistance - nearDistance);
  return Math.min(1, Math.max(0, t));
}
