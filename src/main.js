import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

import { SpatialGrid } from "./SpatialGrid.js";
import { applyProximityGlow, distanceToProximity } from "./proximityMaterial.js";
import { SceneStateSerializer } from "./SceneStateSerializer.js";

// ---------------------------------------------------------------------------
// Phase 1: base Three.js + Spark scene
// ---------------------------------------------------------------------------

const canvas = document.getElementById("app");
const loadingEl = document.getElementById("loading");
const loadingPctEl = document.getElementById("loading-pct");
const progressFillEl = document.getElementById("progress-fill");
const proximityReadout = document.getElementById("proximity-readout");

let splatProgress = 0;
let meshProgress = 0;

function updateLoadingUI() {
  const totalProgress = (splatProgress + meshProgress) / 2;
  const pct = Math.floor(totalProgress * 100);
  if (loadingPctEl) loadingPctEl.textContent = `${pct}%`;
  if (progressFillEl) progressFillEl.style.width = `${pct}%`;
}

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.05,
  200
);
// Set camera inside the garage at a rough eye-level
camera.position.set(0, 1.5, 0);

// Spark recommends antialias:false — MSAA doesn't help splat rendering and
// costs a lot of perf.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.5, 0);

// SparkRenderer must live in the scene graph — it's what actually draws
// any SplatMesh you add anywhere in the scene.
const spark = new SparkRenderer({ renderer });
scene.add(spark);

// ---------------------------------------------------------------------------
// Phase 1: load the splat environment
// ---------------------------------------------------------------------------
// TODO(assignment): replace this with your own captured .splat/.ply/.spz
// scene — ideally one with a visible floor/walls so Phase 3's "dense area"
// proximity glow has something meaningful to react to. Spark's example
// gallery (https://sparkjs.dev/examples/) has room-scale scenes you can
// swap in during development.
const SPLAT_URL = "/assets/room.splat";

const splatScene = new SplatMesh({ 
  url: SPLAT_URL,
  onProgress: (e) => {
    if (e.total > 0) {
      splatProgress = e.loaded / e.total;
      updateLoadingUI();
    }
  }
});
splatScene.quaternion.set(1, 0, 0, 0);
splatScene.position.set(0, 0, -1.5);
scene.add(splatScene);

splatScene.initialized?.then?.(() => {
  loadingEl.style.opacity = "0";
  setTimeout(() => loadingEl.remove(), 400);
}) ?? setTimeout(() => loadingEl.remove(), 1500); // fallback if not thenable

// ---------------------------------------------------------------------------
// Phase 1: load the CAD mesh
// ---------------------------------------------------------------------------

const cadMesh = new THREE.Group();
// Move down to the expected floor level of room.splat (adjust Y as needed)
cadMesh.position.set(0, -1.2, 0);
scene.add(cadMesh);

let proximityUniformsByMaterial = new Map();

const loader = new GLTFLoader();
loader.load("/assets/gearbox-center.glb", (gltf) => {
  const loadedMesh = gltf.scene;
  // Make the mesh a bit larger as requested
  loadedMesh.scale.set(0.1, 0.1, 0.1);
  loadedMesh.position.set(0, 0, 0);
  
  loadedMesh.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      
      // Phase 3: Apply the glow shader patch to every mesh in the CAD group
      const uniforms = applyProximityGlow(child.material);
      proximityUniformsByMaterial.set(child.material, uniforms);
    }
  });

  cadMesh.add(loadedMesh);
}, (xhr) => {
  if (xhr.total > 0) {
    meshProgress = xhr.loaded / xhr.total;
    updateLoadingUI();
  }
});

// ---------------------------------------------------------------------------
// Phase 2: depth-buffer synchronization
// ---------------------------------------------------------------------------
// The core problem the assignment describes: naive splat renderers alpha-
// blend without respecting/writing depth, so opaque meshes can "bleed
// through". Spark's SparkRenderer exposes this directly instead of forcing
// you to hand-roll a depth pre-pass:
//
//   depthTest  (default true)  — splats are discarded per-fragment when
//                                 they're behind whatever is already in the
//                                 Z-buffer (e.g. our opaque CAD mesh).
//   depthWrite (default false) — splats themselves don't write depth, since
//                                 they're inherently semi-transparent; only
//                                 opaque geometry (our mesh, our floor)
//                                 should write depth.
//
// Because our CAD mesh uses a standard opaque MeshStandardMaterial, it
// writes to the depth buffer normally. Combined with Spark's depthTest,
// splats that are physically behind the mesh get correctly discarded, and
// splats in front continue to alpha-blend over it. This is the "modify the
// rendering loop or shaders" requirement — here it's satisfied by wiring up
// existing renderer parameters correctly rather than patching shaders by
// hand. If your captured scene still shows bleed-through at grazing angles,
// see the README's "Architectural Decisions" section for the manual
// depth-prepass fallback approach.
spark.depthTest = true;
spark.depthWrite = false;

// ---------------------------------------------------------------------------
// Phase 2: lighting + shadows
// ---------------------------------------------------------------------------
const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x1a1a1a, 0.6);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(2, 3, 1.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 10;
sun.shadow.camera.left = -2;
sun.shadow.camera.right = 2;
sun.shadow.camera.top = 2;
sun.shadow.camera.bottom = -2;
sun.shadow.bias = -0.0015;
scene.add(sun);

// A ground plane to catch the mesh's shadow. If your splat scene already
// has a real captured floor, hide/remove this and instead make sure your
// splat floor's *geometry* proxy (see SpatialGrid section below) still
// exists for shadow receiving — splats themselves cannot receive shadows,
// only regular meshes can.
const floorGeo = new THREE.PlaneGeometry(20, 20);
const floorMat = new THREE.ShadowMaterial({ opacity: 0.35 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0;
floor.receiveShadow = true;
scene.add(floor);

// ---------------------------------------------------------------------------
// Phase 3: proximity-reactive shader
// ---------------------------------------------------------------------------

const proximityGrid = new SpatialGrid(0.25);

// Extract real splat centers once the splat scene is loaded
splatScene.initialized?.then(() => {
  const points = [];
  if (splatScene.forEachSplat) {
    splatScene.forEachSplat((index, center, scales, quaternion, opacity, color) => {
      // Only include points that are relatively opaque and large enough
      // to represent dense surfaces (optional filtering for performance)
      if (opacity > 0.1) {
        points.push(center.x, center.y, center.z);
      }
    });
    proximityGrid.insertPositions(new Float32Array(points));
  }
});

// ---------------------------------------------------------------------------
// Phase 3: state persistence
// ---------------------------------------------------------------------------
const serializer = new SceneStateSerializer();
serializer.applyTo(cadMesh); // restore last saved pose on load, if any

document.getElementById("save-state").addEventListener("click", () => {
  serializer.save(cadMesh);
});
document.getElementById("load-state").addEventListener("click", () => {
  serializer.applyTo(cadMesh);
});
document.getElementById("reset-state").addEventListener("click", () => {
  serializer.clear();
  cadMesh.position.set(0, -1.2, 0);
  cadMesh.rotation.set(0, 0, 0);
  cadMesh.scale.set(1, 1, 1);
});

// ---------------------------------------------------------------------------
// Simple keyboard nudging so you can actually test proximity + persistence
// without building a full transform-gizmo UI.
// ---------------------------------------------------------------------------
const keysDown = new Set();
window.addEventListener("keydown", (e) => keysDown.add(e.code));
window.addEventListener("keyup", (e) => keysDown.delete(e.code));

function updateMeshFromInput(delta) {
  const speed = 1.2 * delta;
  if (keysDown.has("ArrowUp")) cadMesh.position.z -= speed;
  if (keysDown.has("ArrowDown")) cadMesh.position.z += speed;
  if (keysDown.has("ArrowLeft")) cadMesh.position.x -= speed;
  if (keysDown.has("ArrowRight")) cadMesh.position.x += speed;
  if (keysDown.has("PageUp")) cadMesh.position.y += speed;
  if (keysDown.has("PageDown")) cadMesh.position.y -= speed;
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();

function animate() {
  const delta = clock.getDelta();
  updateMeshFromInput(delta);
  controls.update();

  // Phase 3: recompute proximity each frame and push it into the shader
  // uniform. Cheap because SpatialGrid only checks the mesh's own cell +
  // 26 neighbors, not every indexed point.
  const p = cadMesh.position;
  const nearestDist = proximityGrid.nearestDistance(p.x, p.y, p.z);
  const proximity = distanceToProximity(nearestDist, 0.15, 1.2);

  for (const uniforms of proximityUniformsByMaterial.values()) {
    uniforms.uProximity.value = proximity;
  }
  proximityReadout.textContent = `proximity: ${proximity.toFixed(2)} (dist ${nearestDist.toFixed(2)}m)`;

  renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

// ---------------------------------------------------------------------------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
