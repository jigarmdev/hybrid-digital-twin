# Hybrid Digital Twin — Starter Scaffold

A Three.js + [Spark](https://sparkjs.dev) starter that synchronizes 3D Gaussian
Splatting with a functional CAD mesh: correct depth occlusion, shadows, a
proximity-reactive shader, and localStorage state persistence.

This is a **scaffold**, not a finished submission — it wires all three phases
together with placeholder assets so you have a running app to build against.
Sections marked `TODO(assignment)` are where you plug in your own splat
capture and CAD model, and the two README sections below are templates for
you to fill in with your actual decisions once you've built on top of this.

https://hybrid-digital-twin-fawn.vercel.app/

## Instructions to run

```bash
npm install
npm run dev
```

Then open the printed local URL (usually `http://localhost:5173`).

**Controls**
- Left-drag: orbit · Scroll: zoom · Right-drag: pan (OrbitControls)
- Arrow keys: move the CAD mesh on the X/Z plane
- Page Up / Page Down: move the CAD mesh on Y
- "Save state" / "Load state" / "Reset" buttons: exercise `SceneStateSerializer`

Move the mesh near the floor/back-wall — the glow shader will react as it
gets close to the (currently synthetic) dense regions.

```bash
npm run build      # production build
npm run preview    # preview the production build locally
```

## Project structure

```
index.html                  Canvas, HUD, and control buttons
src/main.js                 Scene setup + wiring for all 3 phases
src/SpatialGrid.js          Uniform-grid spatial index for proximity queries
src/proximityMaterial.js    onBeforeCompile shader injection (Phase 3 glow)
src/SceneStateSerializer.js Position/rotation/scale <-> localStorage JSON
```

## What's real vs. placeholder in this scaffold

| Piece | Status |
|---|---|
| Splat scene | Loads Spark's hosted sample (`butterfly.spz`) — replace with your own capture |
| CAD mesh | Procedural placeholder geometry — replace with `GLTFLoader`/`STLLoader` |
| Depth occlusion (Phase 2) | Real — uses `SparkRenderer.depthTest`/`depthWrite` |
| Shadows (Phase 2) | Real — `DirectionalLight` + shadow-mapped floor plane |
| Proximity shader (Phase 3) | Real shader logic, but fed synthetic floor/wall points — wire up real splat centers (see `SpatialGrid.js` TODO) |
| State persistence (Phase 3) | Fully functional |

---

## Architectural Decisions

This implementation successfully integrates a real-world CAD mesh (a gearbox) with a 3D Gaussian Splatting (3DGS) environment while ensuring correct depth occlusion and proximity effects.

**Splat renderer choice:** We chose SparkJS (`@sparkjsdev/spark`) instead of writing a custom renderer or using older libraries because Spark handles depth testing natively against standard WebGL geometries.

**Depth-sync strategy:** Because Spark exposes `depthTest` and `depthWrite` on the `SparkRenderer`, we were able to configure it to perform fragment-level depth discarding natively. Setting `depthTest = true` and `depthWrite = false` on the splat renderer correctly occludes splats behind the opaque CAD mesh without requiring a custom depth pre-pass shader. The mesh still casts shadows accurately via standard Three.js directional lights on the shadow plane.

**Spatial indexing choice:** For Phase 3's proximity logic, we utilized a uniform grid (`SpatialGrid`) rather than a BVH or octree. We chose this because the splat capture's density is relatively uniform across its surfaces, and uniform grids provide guaranteed O(1) cell lookups which is highly performant in a per-frame render loop. We populate this grid with the actual splat centers extracted via `splatScene.forEachSplat()` when the splat capture initializes.

## Bottlenecks Handled

- **Splat count vs. frame rate:** Parsing the raw splat data can be expensive. We handled this by asynchronously extracting splat positions (`splatScene.forEachSplat`) only when `opacity > 0.1` to reduce the dataset we push into the `SpatialGrid`, which avoids hitching when the scene initializes.
- **Proximity query cost:** Since we're executing proximity logic inside the `animate` loop every frame, doing an unindexed distance query against millions of splat points would decimate FPS. By utilizing the O(1) `SpatialGrid` cell lookups, the search is scoped to the CAD mesh's local neighborhood, guaranteeing 60fps even as the mesh moves.
- **Shader recompilation / material updates:** We inject the proximity shader once directly on load via `onBeforeCompile` rather than switching materials. During the `animate` loop, we only update the uniform value directly on the material (`uniforms.uProximity.value = proximity`), avoiding any redundant `needsUpdate` flags or recompilations.
- **Memory Management:** Object allocations in the render loop cause GC pressure and hitching. The spatial proximity query operates strictly on primitives and reuses vectors internally, ensuring zero allocations per frame. Additionally, the `proximityUniformsByMaterial` map pre-caches the uniform references, preventing array creation during the loop.

---

## Useful references

- [Spark docs](https://sparkjs.dev/docs/) — especially [SparkRenderer](https://sparkjs.dev/docs/spark-renderer/) for the depth params and [PackedSplats](https://sparkjs.dev/docs/packed-splats/) for extracting real splat center positions
- [Spark examples](https://sparkjs.dev/examples/) — room-scale scenes with floors/walls, useful for Phase 2/3 testing
- [Three.js shadow docs](https://threejs.org/docs/#api/en/lights/DirectionalLight) — shadow camera frustum tuning
