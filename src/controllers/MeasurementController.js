/**
 * MeasurementController - Measurement feature controller
 * Responsible for distance measurement between objects
 */
import * as THREE from 'three';

export class MeasurementController {
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
        this.selectedObjects = [];
    }

    /**
     * Handle measurement object selection
     */
    handleSelection(object, element, type) {
        const index = this.selectedObjects.findIndex(obj => obj.name === object.name && obj.type === type);

        if (index >= 0) {
            // Deselect
            this.selectedObjects.splice(index, 1);
            element?.classList.remove('measurement-selected');
        } else {
            // Add selection
            if (this.selectedObjects.length >= 2) {
                const firstObj = this.selectedObjects.shift();
                const svgEl = document.getElementById('model-graph-svg');

                if (svgEl) {
                    // Clear measurement-selected from the dequeued object's graph node
                    svgEl.querySelectorAll('.measurement-selected').forEach(el => {
                        el.classList.remove('measurement-selected');
                    });
                }
            }

            this.selectedObjects.push({ ...object, type: type });
            element?.classList.add('measurement-selected');
        }

        // If 2 objects selected, show measurement result
        if (this.selectedObjects.length === 2) {
            this.showMeasurement(this.selectedObjects[0], this.selectedObjects[1]);
        } else {
            if (this.sceneManager) {
                this.sceneManager.measurementManager.clearMeasurement();
            }
        }
    }

    /**
     * Show measurement between two objects
     */
    showMeasurement(obj1, obj2) {
        if (!this.sceneManager) return;

        const getPosition = (obj) => {
            const pos = new THREE.Vector3();

            if (obj.type === 'joint' && obj.threeObject) {
                obj.threeObject.getWorldPosition(pos);
            } else if (obj.type === 'link') {
                if (obj.name === 'ground') {
                    pos.set(0, this.sceneManager.groundPlane?.position.y || 0, 0);
                } else if (obj.threeObject) {
                    obj.threeObject.getWorldPosition(pos);
                }
            }

            return pos;
        };

        const pos1 = getPosition(obj1);
        const pos2 = getPosition(obj2);

        const hasGround = obj1.name === 'ground' || obj2.name === 'ground';

        const delta = {
            x: pos2.x - pos1.x,
            y: pos2.y - pos1.y,
            z: pos2.z - pos1.z
        };
        const totalDistance = pos1.distanceTo(pos2);

        const name1 = obj1.name === 'ground' ? 'Ground' : obj1.name;
        const name2 = obj2.name === 'ground' ? 'Ground' : obj2.name;

        this.sceneManager.measurementManager.showMeasurement(pos1, pos2, delta, totalDistance, name1, name2, hasGround);
    }

    /**
     * Update current measurement
     */
    updateMeasurement() {
        if (this.selectedObjects.length === 2) {
            this.showMeasurement(this.selectedObjects[0], this.selectedObjects[1]);
        }
    }

    /**
     * Clear measurement
     */
    clearMeasurement() {
        this.selectedObjects = [];

        const svgEl = document.getElementById('model-graph-svg');
        if (svgEl) {
            svgEl.querySelectorAll('.measurement-selected').forEach(el => {
                el.classList.remove('measurement-selected');
            });
        }

        if (this.sceneManager) {
            this.sceneManager.measurementManager.clearMeasurement();
        }
    }

    /**
     * Get selected objects
     */
    getSelectedObjects() {
        return this.selectedObjects;
    }
}

