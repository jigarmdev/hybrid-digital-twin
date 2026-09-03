/**
 * SceneStateSerializer
 * ---------------------
 * Saves/loads a THREE.Object3D's position, rotation (as Euler), and scale
 * to/from localStorage as a JSON string. Kept framework-agnostic (plain
 * numbers in, plain numbers out) so it's easy to unit test independent of
 * Three.js internals.
 */
export class SceneStateSerializer {
  /**
   * @param {string} storageKey - localStorage key to persist under
   */
  constructor(storageKey = "hybrid-digital-twin:mesh-state") {
    this.storageKey = storageKey;
  }

  /**
   * @param {THREE.Object3D} object3D
   */
  serialize(object3D) {
    const state = {
      position: {
        x: object3D.position.x,
        y: object3D.position.y,
        z: object3D.position.z,
      },
      rotation: {
        x: object3D.rotation.x,
        y: object3D.rotation.y,
        z: object3D.rotation.z,
      },
      scale: {
        x: object3D.scale.x,
        y: object3D.scale.y,
        z: object3D.scale.z,
      },
      savedAt: new Date().toISOString(),
    };
    return JSON.stringify(state);
  }

  save(object3D) {
    try {
      const json = this.serialize(object3D);
      window.localStorage.setItem(this.storageKey, json);
      return true;
    } catch (err) {
      console.error("SceneStateSerializer: failed to save state", err);
      return false;
    }
  }

  /**
   * @returns {object|null} parsed state, or null if nothing was saved / parse failed
   */
  loadRaw() {
    try {
      const json = window.localStorage.getItem(this.storageKey);
      if (!json) return null;
      return JSON.parse(json);
    } catch (err) {
      console.error("SceneStateSerializer: failed to load state", err);
      return null;
    }
  }

  /**
   * Applies saved state directly onto a THREE.Object3D, if any exists.
   * @param {THREE.Object3D} object3D
   * @returns {boolean} whether a saved state was found and applied
   */
  applyTo(object3D) {
    const state = this.loadRaw();
    if (!state) return false;

    object3D.position.set(state.position.x, state.position.y, state.position.z);
    object3D.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
    object3D.scale.set(state.scale.x, state.scale.y, state.scale.z);
    return true;
  }

  clear() {
    window.localStorage.removeItem(this.storageKey);
  }
}
