/**
 * Traverse an Object3D tree and dispose all GPU resources
 * (geometries, materials, and textures).
 */
export function disposeObject3D(object) {
    if (!object) return;
    object.traverse((child) => {
        if (child.geometry) {
            child.geometry.dispose();
        }
        if (child.material) {
            const materials = Array.isArray(child.material)
                ? child.material : [child.material];
            for (const mat of materials) {
                if (!mat) continue;
                if (mat.map) mat.map.dispose();
                if (mat.normalMap) mat.normalMap.dispose();
                if (mat.roughnessMap) mat.roughnessMap.dispose();
                if (mat.metalnessMap) mat.metalnessMap.dispose();
                if (mat.envMap) mat.envMap.dispose();
                if (mat.emissiveMap) mat.emissiveMap.dispose();
                mat.dispose();
            }
        }
    });
}
