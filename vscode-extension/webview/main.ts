/**
 * VS Code Webview Entry Point
 *
 * Adapts the robot viewer web application for the VS Code webview environment.
 * Uses VSCodeAdapter for file loading and message passing instead of drag-drop.
 */

import * as THREE from 'three';
import * as d3 from 'd3';
import { SceneManager } from '@shared/renderer/SceneManager.js';
import { JointControlsUI } from '@shared/ui/JointControlsUI.js';
import { ModelGraphView } from '@shared/views/ModelGraphView.js';
import { ModelLoaderFactory } from '@shared/loaders/ModelLoaderFactory.js';
import { MujocoSimulationManager } from '@shared/renderer/MujocoSimulationManager.js';
import { i18n } from '@shared/utils/i18n.js';
import { getVSCodeAdapter, type VSCodeAdapterCallbacks } from './VSCodeAdapter';
import type { LoadFileMessage, ContentChangedMessage, SettingsChangedMessage, ThemeChangedMessage } from '../src/messages';

// Make d3 and i18n available globally (required by some components)
(window as any).d3 = d3;
(window as any).i18n = i18n;

interface ViewerState {
  cameraPosition?: { x: number; y: number; z: number };
  cameraTarget?: { x: number; y: number; z: number };
  jointValues?: Record<string, number>;
}

class VSCodeRobotViewer {
  private sceneManager: SceneManager | null = null;
  private jointControlsUI: JointControlsUI | null = null;
  private modelGraphView: ModelGraphView | null = null;
  private mujocoSimulationManager: MujocoSimulationManager | null = null;
  private currentModel: any = null;
  private currentFileType: 'urdf' | 'mjcf' | 'usd' | 'xacro' = 'urdf';
  private adapter = getVSCodeAdapter();
  private settings = {
    enableSimulation: true,
    autoReload: true,
  };
  private isInitialized = false;
  private pendingFile: LoadFileMessage | null = null;

  async init(): Promise<void> {
    try {
      // Initialize i18n
      i18n.init();

      // Create canvas element
      const app = document.getElementById('app');
      if (!app) {
        throw new Error('App container not found');
      }

      // Clear loading state
      const loading = document.getElementById('loading');
      if (loading) {
        loading.style.display = 'none';
      }

      // Create canvas
      const canvas = document.createElement('canvas');
      canvas.id = 'canvas';
      canvas.style.cssText = 'width: 100%; height: 100%; display: block;';
      app.appendChild(canvas);

      // Create UI containers
      this.createUIContainers(app);

      // Initialize scene manager
      this.sceneManager = new SceneManager(canvas);
      (window as any).sceneManager = this.sceneManager;

      // Initialize joint controls
      this.jointControlsUI = new JointControlsUI(this.sceneManager);

      // Set up joint change callback for bi-directional sync
      this.jointControlsUI.onJointValueChanged = (jointName: string, value: number) => {
        this.adapter.notifyJointChanged(jointName, value, 'position');
      };

      // Initialize model graph view
      this.modelGraphView = new ModelGraphView(this.sceneManager);

      // Initialize MuJoCo simulation manager (lazy)
      this.mujocoSimulationManager = new MujocoSimulationManager(this.sceneManager);

      // Setup VS Code adapter callbacks
      this.setupAdapterCallbacks();

      // Setup canvas click handler
      this.setupCanvasClickHandler(canvas);

      // Start render loop
      this.animate();

      this.isInitialized = true;

      // Signal ready to extension
      this.adapter.signalReady();

      // If we received a file before initialization, load it now
      if (this.pendingFile) {
        await this.handleFileLoad(this.pendingFile);
        this.pendingFile = null;
      }

      this.adapter.log('info', 'Robot Viewer initialized successfully');
    } catch (error) {
      this.showError('Initialization failed', error instanceof Error ? error.message : String(error));
      this.adapter.log('error', `Initialization error: ${error}`);
    }
  }

  private createUIContainers(app: HTMLElement): void {
    // Create toolbar (top center, glass design)
    const toolbar = document.createElement('div');
    toolbar.id = 'top-control-bar';
    toolbar.innerHTML = `
      <div class="control-bar-section">
        <button class="tool-button active" id="show-visual" title="Show Visual Geometry">
          <span class="tool-button-icon">👁</span>
          <span>Visual</span>
        </button>
        <button class="tool-button" id="show-collision" title="Show Collision Geometry">
          <span class="tool-button-icon">📦</span>
          <span>Collision</span>
        </button>
        <button class="tool-button" id="show-inertia" title="Show Inertia Ellipsoids">
          <span class="tool-button-icon">⚖️</span>
          <span>Inertia</span>
        </button>
        <button class="tool-button" id="show-com" title="Show Center of Mass">
          <span class="tool-button-icon">⊕</span>
          <span>CoM</span>
        </button>
      </div>
      <div class="control-bar-divider"></div>
      <div class="control-bar-section">
        <button class="tool-button" id="show-axes" title="Show Link Axes">
          <span class="tool-button-icon">✚</span>
          <span>Link Axes</span>
        </button>
        <button class="tool-button" id="show-joint-axes" title="Show Joint Axes">
          <span class="tool-button-icon">⟳</span>
          <span>Joint Axes</span>
        </button>
      </div>
      <div class="control-bar-divider"></div>
      <div class="control-bar-section">
        <button class="tool-button active" id="toggle-shadow" title="Toggle Shadows">
          <span class="tool-button-icon">◐</span>
          <span>Shadow</span>
        </button>
        <button class="tool-button active" id="toggle-ground" title="Toggle Ground Plane">
          <span class="tool-button-icon">▭</span>
          <span>Ground</span>
        </button>
      </div>
      <div class="control-bar-divider"></div>
      <div class="control-bar-section">
        <button class="tool-button" id="reset-view" title="Reset Camera View">
          <span class="tool-button-icon">↺</span>
          <span>Reset View</span>
        </button>
        <button class="tool-button" id="reset-joints" title="Reset All Joints">
          <span class="tool-button-icon">⟲</span>
          <span>Reset Joints</span>
        </button>
      </div>
    `;
    app.appendChild(toolbar);

    // Create joint controls panel (floating panel, glass design)
    const jointPanel = document.createElement('div');
    jointPanel.id = 'floating-joints-panel';
    jointPanel.className = 'floating-panel';
    jointPanel.style.cssText = `
      top: 80px;
      right: 20px;
      width: 360px;
      max-height: calc(100vh - 100px);
    `;
    jointPanel.innerHTML = `
      <div class="floating-panel-header">
        <span data-i18n="jointControls">Joint Controls</span>
        <div class="panel-controls">
          <div id="unit-toggle">
            <button class="active" data-unit="rad">rad</button>
            <button data-unit="deg">deg</button>
          </div>
          <button class="panel-btn" id="reset-joints-btn" title="Reset all joints">↺</button>
          <button class="panel-btn" id="joint-ignore-limits" title="Ignore Joint Limits">∞</button>
        </div>
      </div>
      <div id="joint-controls" class="floating-panel-content"></div>
    `;
    app.appendChild(jointPanel);

    // Create model graph panel (floating panel, resizable and detachable)
    const graphPanel = document.createElement('div');
    graphPanel.id = 'floating-model-tree';
    graphPanel.className = 'floating-panel resizable-panel';
    graphPanel.style.cssText = `
      top: 80px;
      left: 20px;
      width: 360px;
      height: 340px;
      min-width: 280px;
      min-height: 150px;
    `;
    graphPanel.innerHTML = `
      <div class="floating-panel-header" id="graph-panel-header">
        <span data-i18n="modelGraph">Model Structure</span>
        <div class="panel-controls">
          <button class="panel-btn" id="graph-fit-btn" title="Fit to view">⊡</button>
          <button class="panel-btn" id="graph-detach-btn" title="Detach panel">⧉</button>
          <button class="panel-btn" id="graph-close-btn" title="Close panel" style="display: none;">×</button>
        </div>
      </div>
      <div class="graph-controls-hint">
        <span><kbd>Click</kbd> Select</span>
        <span><kbd>Ctrl+Click</kbd> Measure</span>
        <span><kbd>Right-click</kbd> Toggle visibility</span>
      </div>
      <div id="model-graph-container" class="floating-panel-content" style="padding: 0;">
        <svg id="model-graph-svg"></svg>
      </div>
      <div class="resize-handle resize-handle-n"></div>
      <div class="resize-handle resize-handle-e"></div>
      <div class="resize-handle resize-handle-s"></div>
      <div class="resize-handle resize-handle-w"></div>
      <div class="resize-handle resize-handle-ne"></div>
      <div class="resize-handle resize-handle-se"></div>
      <div class="resize-handle resize-handle-sw"></div>
      <div class="resize-handle resize-handle-nw"></div>
    `;
    app.appendChild(graphPanel);

    // Initialize panel interactivity
    this.initResizablePanel(graphPanel);
    this.initDraggablePanel(graphPanel, 'graph-panel-header');
    this.initDetachablePanel(graphPanel, 'graph-detach-btn', 'graph-close-btn');

    // Initialize toolbar buttons
    this.initToolbar();

    // Initialize unit toggle buttons
    this.initUnitToggle();

    // Initialize fit to view button
    const fitBtn = document.getElementById('graph-fit-btn');
    if (fitBtn) {
      fitBtn.addEventListener('click', () => {
        if (this.modelGraphView) {
          this.modelGraphView.fitToView(true, 300);
        }
      });
    }
  }

  /**
   * Initialize resizable panel functionality
   */
  private initResizablePanel(panel: HTMLElement): void {
    const handles = panel.querySelectorAll('.resize-handle');
    let isResizing = false;
    let currentHandle: HTMLElement | null = null;
    let startX = 0;
    let startY = 0;
    let startWidth = 0;
    let startHeight = 0;
    let startLeft = 0;
    let startTop = 0;

    const onMouseDown = (e: MouseEvent) => {
      isResizing = true;
      currentHandle = e.target as HTMLElement;
      startX = e.clientX;
      startY = e.clientY;
      startWidth = panel.offsetWidth;
      startHeight = panel.offsetHeight;
      startLeft = panel.offsetLeft;
      startTop = panel.offsetTop;
      e.preventDefault();
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing || !currentHandle) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const minWidth = parseInt(panel.style.minWidth) || 150;
      const minHeight = parseInt(panel.style.minHeight) || 100;
      const classList = currentHandle.classList;

      if (classList.contains('resize-handle-e') || classList.contains('resize-handle-ne') || classList.contains('resize-handle-se')) {
        panel.style.width = Math.max(minWidth, startWidth + dx) + 'px';
      }
      if (classList.contains('resize-handle-w') || classList.contains('resize-handle-nw') || classList.contains('resize-handle-sw')) {
        const newWidth = Math.max(minWidth, startWidth - dx);
        panel.style.width = newWidth + 'px';
        panel.style.left = (startLeft + startWidth - newWidth) + 'px';
      }
      if (classList.contains('resize-handle-s') || classList.contains('resize-handle-se') || classList.contains('resize-handle-sw')) {
        panel.style.height = Math.max(minHeight, startHeight + dy) + 'px';
      }
      if (classList.contains('resize-handle-n') || classList.contains('resize-handle-ne') || classList.contains('resize-handle-nw')) {
        const newHeight = Math.max(minHeight, startHeight - dy);
        panel.style.height = newHeight + 'px';
        panel.style.top = (startTop + startHeight - newHeight) + 'px';
        panel.style.bottom = 'auto';
      }

      // Trigger resize event for SVG redraw
      window.dispatchEvent(new Event('resize'));
    };

    const onMouseUp = () => {
      isResizing = false;
      currentHandle = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      // Redraw model graph if it exists
      if (this.currentModel && this.modelGraphView) {
        this.modelGraphView.drawModelGraph(this.currentModel);
      }
    };

    handles.forEach(handle => {
      handle.addEventListener('mousedown', onMouseDown as EventListener);
    });
  }

  /**
   * Initialize draggable panel functionality
   */
  private initDraggablePanel(panel: HTMLElement, headerIdOrClass: string): void {
    const header = panel.querySelector(`#${headerIdOrClass}, .${headerIdOrClass}`) as HTMLElement;
    if (!header) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    header.addEventListener('mousedown', (e: MouseEvent) => {
      // Ignore if clicking on buttons
      if ((e.target as HTMLElement).closest('.panel-btn')) return;

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = panel.offsetLeft;
      startTop = panel.offsetTop;

      // Clear bottom positioning when dragging
      panel.style.bottom = 'auto';
      panel.style.top = startTop + 'px';

      e.preventDefault();
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      const newLeft = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, startLeft + dx));
      const newTop = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, startTop + dy));

      panel.style.left = newLeft + 'px';
      panel.style.top = newTop + 'px';
    };

    const onMouseUp = () => {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }

  /**
   * Initialize detachable panel functionality
   */
  private initDetachablePanel(panel: HTMLElement, detachBtnId: string, closeBtnId: string): void {
    const detachBtn = panel.querySelector(`#${detachBtnId}`) as HTMLElement;
    const closeBtn = panel.querySelector(`#${closeBtnId}`) as HTMLElement;

    if (!detachBtn) return;

    let isDetached = false;
    let originalStyles: {
      left: string;
      top: string;
      bottom: string;
      width: string;
      height: string;
    } | null = null;

    detachBtn.addEventListener('click', () => {
      if (!isDetached) {
        // Detach - save original position and make floating
        originalStyles = {
          left: panel.style.left,
          top: panel.style.top,
          bottom: panel.style.bottom,
          width: panel.style.width,
          height: panel.style.height,
        };

        // Center the panel and make it larger
        const newWidth = Math.min(500, window.innerWidth - 40);
        const newHeight = Math.min(400, window.innerHeight - 40);
        panel.style.width = newWidth + 'px';
        panel.style.height = newHeight + 'px';
        panel.style.left = ((window.innerWidth - newWidth) / 2) + 'px';
        panel.style.top = ((window.innerHeight - newHeight) / 2) + 'px';
        panel.style.bottom = 'auto';

        panel.classList.add('panel-detached');
        isDetached = true;

        // Show close button, update detach button icon to "dock"
        if (closeBtn) closeBtn.style.display = 'flex';
        detachBtn.textContent = '⊟';
        detachBtn.title = 'Dock panel';

        // Redraw model graph
        if (this.currentModel && this.modelGraphView) {
          setTimeout(() => this.modelGraphView?.drawModelGraph(this.currentModel), 50);
        }
      } else {
        // Re-dock - restore original position
        if (originalStyles) {
          panel.style.left = originalStyles.left;
          panel.style.top = originalStyles.top;
          panel.style.bottom = originalStyles.bottom;
          panel.style.width = originalStyles.width;
          panel.style.height = originalStyles.height;
        }

        panel.classList.remove('panel-detached');
        isDetached = false;

        // Hide close button, restore detach icon
        if (closeBtn) closeBtn.style.display = 'none';
        detachBtn.textContent = '⧉';
        detachBtn.title = 'Detach panel';

        // Redraw model graph
        if (this.currentModel && this.modelGraphView) {
          setTimeout(() => this.modelGraphView?.drawModelGraph(this.currentModel), 50);
        }
      }
    });

    // Close button hides the panel
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        panel.style.display = 'none';
      });
    }
  }

  /**
   * Initialize toolbar button handlers
   */
  private initToolbar(): void {
    // Toggle button helper
    const toggleBtn = (btn: HTMLElement | null, callback?: (active: boolean) => void) => {
      if (!btn) return;
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        const isActive = btn.classList.contains('active');
        callback?.(isActive);
      });
    };

    // Display toggles
    toggleBtn(document.getElementById('show-visual'), (active) => {
      if (this.sceneManager?.visualizationManager) {
        this.sceneManager.visualizationManager.toggleVisual(active, this.currentModel);
        this.sceneManager.redraw();
      }
    });

    toggleBtn(document.getElementById('show-collision'), (active) => {
      if (this.sceneManager?.visualizationManager) {
        this.sceneManager.visualizationManager.toggleCollision(active);
        this.sceneManager.redraw();
      }
    });

    toggleBtn(document.getElementById('show-inertia'), (active) => {
      if (this.sceneManager?.inertialVisualization) {
        this.sceneManager.inertialVisualization.toggleInertia(active, this.currentModel);
        this.sceneManager.redraw();
      }
    });

    toggleBtn(document.getElementById('show-com'), (active) => {
      if (this.sceneManager?.inertialVisualization) {
        this.sceneManager.inertialVisualization.toggleCenterOfMass(active, this.currentModel);
        this.sceneManager.redraw();
      }
    });

    // Axes toggles
    toggleBtn(document.getElementById('show-axes'), (active) => {
      if (this.sceneManager?.axesManager) {
        if (active) {
          this.sceneManager.axesManager.showAllAxes();
        } else {
          this.sceneManager.axesManager.hideAllAxes();
        }
        this.sceneManager.redraw();
      }
    });

    toggleBtn(document.getElementById('show-joint-axes'), (active) => {
      if (this.sceneManager?.jointAxesManager) {
        if (active) {
          this.sceneManager.jointAxesManager.showAllAxes();
        } else {
          this.sceneManager.jointAxesManager.hideAllAxes();
        }
        this.sceneManager.redraw();
      }
    });

    // Scene toggles
    toggleBtn(document.getElementById('toggle-shadow'), (active) => {
      if (this.sceneManager) {
        this.sceneManager.setShadowEnabled(active);
        this.sceneManager.redraw();
      }
    });

    toggleBtn(document.getElementById('toggle-ground'), (active) => {
      if (this.sceneManager) {
        this.sceneManager.setGroundVisible(active);
        this.sceneManager.redraw();
      }
    });

    // Reset buttons
    const resetViewBtn = document.getElementById('reset-view');
    if (resetViewBtn) {
      resetViewBtn.addEventListener('click', () => {
        if (this.sceneManager) {
          this.sceneManager.resetCamera();
          this.sceneManager.redraw();
        }
      });
    }

    const resetJointsBtn = document.getElementById('reset-joints');
    if (resetJointsBtn) {
      resetJointsBtn.addEventListener('click', () => {
        if (this.currentModel && this.jointControlsUI) {
          this.jointControlsUI.resetAllJoints(this.currentModel);
        }
      });
    }

    // Ignore limits toggle in joint panel
    const ignoreLimitsBtn = document.getElementById('joint-ignore-limits');
    if (ignoreLimitsBtn) {
      ignoreLimitsBtn.addEventListener('click', () => {
        ignoreLimitsBtn.classList.toggle('active');
        const ignore = ignoreLimitsBtn.classList.contains('active');
        if (this.sceneManager) {
          this.sceneManager.setIgnoreLimits(ignore);
        }
        if (this.jointControlsUI && this.currentModel) {
          this.jointControlsUI.updateAllSliderLimits(this.currentModel, ignore);
        }
      });
    }

    // Reset joints button in joint panel header
    const resetJointsPanelBtn = document.getElementById('reset-joints-btn');
    if (resetJointsPanelBtn) {
      resetJointsPanelBtn.addEventListener('click', () => {
        if (this.currentModel && this.jointControlsUI) {
          this.jointControlsUI.resetAllJoints(this.currentModel);
        }
      });
    }
  }

  /**
   * Initialize unit toggle buttons (rad/deg)
   */
  private initUnitToggle(): void {
    const unitToggle = document.getElementById('unit-toggle');
    if (!unitToggle) return;

    const buttons = unitToggle.querySelectorAll('button');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        // Remove active from all
        buttons.forEach(b => b.classList.remove('active'));
        // Add active to clicked
        btn.classList.add('active');
        // Update joint controls
        const unit = btn.getAttribute('data-unit') || 'rad';
        if (this.jointControlsUI) {
          this.jointControlsUI.setAngleUnit(unit);
        }
      });
    });
  }

  private setupAdapterCallbacks(): void {
    const callbacks: VSCodeAdapterCallbacks = {
      onFileLoad: (message) => {
        if (this.isInitialized) {
          this.handleFileLoad(message);
        } else {
          this.pendingFile = message;
        }
      },
      onContentChanged: (message) => {
        if (this.settings.autoReload) {
          this.handleContentChanged(message);
        }
      },
      onSettingsChanged: (message) => {
        this.handleSettingsChanged(message);
      },
      onThemeChanged: (message) => {
        this.handleThemeChanged(message);
      },
    };

    this.adapter.setCallbacks(callbacks);
  }

  private async handleFileLoad(message: LoadFileMessage): Promise<void> {
    try {
      this.hideError();
      this.currentFileType = message.fileType;

      // Create a file map for mesh loading
      const fileMap = new Map<string, File | Blob>();

      // Handle binary USD files (content is base64 encoded)
      let content = message.content;
      let file: File | Blob;

      if (message.isBinary) {
        // Decode base64 to binary
        const binaryString = atob(content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        file = new Blob([bytes], { type: 'application/octet-stream' });
        // For binary files, content stays as base64 for loadModel to handle
      } else {
        // Create a File object from the text content
        file = new File([content], message.filename, { type: 'text/xml' });
      }
      fileMap.set(message.filename, file);

      // Pre-fetch all mesh files referenced in the robot file (only for text-based files)
      if (!message.isBinary) {
        await this.prefetchMeshFiles(content, message.fileType, fileMap);
      }

      // Load the model
      const model = await this.loadModel(
        content,
        message.filename,
        message.fileType,
        fileMap,
        message.isBinary
      );

      if (model) {
        // Clear previous model
        if (this.currentModel) {
          this.sceneManager?.removeModel(this.currentModel);
        }

        this.currentModel = model;

        // Add to scene
        this.sceneManager?.addModel(model);

        // Setup joint controls
        if (this.jointControlsUI) {
          this.jointControlsUI.setupJointControls(model);
        }

        // Draw model graph
        if (this.modelGraphView) {
          this.modelGraphView.drawModelGraph(model);
        }

        // Restore state if available
        const state = this.adapter.getState<ViewerState>();
        if (state) {
          this.restoreState(state);
        }

        this.adapter.log('info', `Loaded model: ${message.filename}`);
      }
    } catch (error) {
      this.showError('Failed to load model', error instanceof Error ? error.message : String(error));
      this.adapter.reportError('Failed to load model', String(error));
    }
  }

  private async loadModel(
    content: string,
    filename: string,
    fileType: 'urdf' | 'mjcf' | 'usd' | 'xacro',
    fileMap: Map<string, File | Blob>,
    isBinary?: boolean
  ): Promise<any> {
    // Use ModelLoaderFactory static methods
    if (fileType === 'urdf') {
      return await ModelLoaderFactory.loadURDF(content, filename, fileMap, null);
    } else if (fileType === 'xacro') {
      return await ModelLoaderFactory.loadXacro(content, filename, fileMap, null);
    } else if (fileType === 'mjcf') {
      return await ModelLoaderFactory.loadMJCF(content, fileMap);
    } else if (fileType === 'usd') {
      throw new Error('USD files should be opened with the USD viewer, not this webview');
    }

    throw new Error(`Unknown file type: ${fileType}`);
  }

  /**
   * Pre-fetch all mesh files referenced in the robot description
   */
  private async prefetchMeshFiles(
    content: string,
    fileType: 'urdf' | 'mjcf' | 'usd' | 'xacro',
    fileMap: Map<string, File | Blob>
  ): Promise<void> {
    const meshPaths = this.extractMeshPaths(content, fileType);

    this.adapter.log('info', `Found ${meshPaths.length} mesh references to fetch`);

    // Fetch all mesh files in parallel
    const fetchPromises = meshPaths.map(async (meshPath) => {
      try {
        const data = await this.adapter.requestMeshFile(meshPath);
        if (data) {
          const filename = meshPath.split('/').pop() || meshPath;
          const file = new File([data], filename);

          // Add to fileMap with multiple path variations for matching
          fileMap.set(meshPath, file);
          fileMap.set(filename, file);

          // Also add without package:// prefix
          if (meshPath.startsWith('package://')) {
            const withoutPackage = meshPath.replace(/^package:\/\/[^/]+\//, '');
            fileMap.set(withoutPackage, file);
          }

          this.adapter.log('info', `Loaded mesh: ${filename}`);
        } else {
          this.adapter.log('warn', `Mesh not found: ${meshPath}`);
        }
      } catch (error) {
        this.adapter.log('warn', `Failed to fetch mesh ${meshPath}: ${error}`);
      }
    });

    await Promise.all(fetchPromises);
  }

  /**
   * Extract mesh file paths from robot description content
   */
  private extractMeshPaths(content: string, fileType: 'urdf' | 'mjcf' | 'usd' | 'xacro'): string[] {
    const meshPaths: string[] = [];
    const meshExtensions = /\.(stl|dae|obj|gltf|glb|STL|DAE|OBJ|GLTF|GLB)$/i;

    if (fileType === 'urdf' || fileType === 'xacro') {
      // Extract from URDF: <mesh filename="..."/>
      const meshRegex = /<mesh\s+filename\s*=\s*["']([^"']+)["']/gi;
      let match;
      while ((match = meshRegex.exec(content)) !== null) {
        meshPaths.push(match[1]);
      }
    } else if (fileType === 'mjcf') {
      // Extract from MJCF: <mesh file="..." /> or <mesh name="..." file="..."/>
      const meshRegex = /<mesh[^>]+file\s*=\s*["']([^"']+)["']/gi;
      let match;
      while ((match = meshRegex.exec(content)) !== null) {
        meshPaths.push(match[1]);
      }

      // Also check for texture files
      const textureRegex = /<texture[^>]+file\s*=\s*["']([^"']+)["']/gi;
      while ((match = textureRegex.exec(content)) !== null) {
        meshPaths.push(match[1]);
      }
    }

    // Remove duplicates
    return [...new Set(meshPaths)];
  }

  private handleContentChanged(message: ContentChangedMessage): void {
    // Debounce reloads
    if ((this as any)._reloadTimeout) {
      clearTimeout((this as any)._reloadTimeout);
    }

    (this as any)._reloadTimeout = setTimeout(async () => {
      try {
        // Save current state
        this.saveState();

        // Reload with new content
        const currentFile = this.pendingFile || {
          type: 'loadFile' as const,
          content: message.content,
          filename: 'model.' + this.currentFileType,
          uri: '',
          fileType: this.currentFileType,
        };

        await this.handleFileLoad({
          ...currentFile,
          content: message.content,
        });
      } catch (error) {
        this.adapter.log('error', `Error reloading content: ${error}`);
      }
    }, 300);
  }

  private handleSettingsChanged(message: SettingsChangedMessage): void {
    this.settings = message.settings;
  }

  private handleThemeChanged(message: ThemeChangedMessage): void {
    // Update scene background based on theme
    if (this.sceneManager) {
      const isDark = message.theme === 'dark';
      const bgColor = isDark ? 0x1e1e1e : 0xf5f5f5;
      this.sceneManager.scene.background = new THREE.Color(bgColor);
    }

    // Redraw model graph with new theme
    if (this.currentModel && this.modelGraphView) {
      this.modelGraphView.drawModelGraph(this.currentModel);
    }
  }

  private setupCanvasClickHandler(canvas: HTMLCanvasElement): void {
    let mouseDownPos: { x: number; y: number } | null = null;
    let mouseDownTime = 0;

    canvas.addEventListener('mousedown', (event) => {
      if (event.button === 0) {
        mouseDownPos = { x: event.clientX, y: event.clientY };
        mouseDownTime = Date.now();
      }
    });

    canvas.addEventListener('mouseup', (event) => {
      if (event.button !== 0 || !this.sceneManager || !mouseDownPos) return;

      const dx = event.clientX - mouseDownPos.x;
      const dy = event.clientY - mouseDownPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const duration = Date.now() - mouseDownTime;

      // Click detection (small movement, short duration)
      if (distance < 5 && duration < 300) {
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        const rect = canvas.getBoundingClientRect();

        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, this.sceneManager.camera);
        const intersects = raycaster.intersectObjects(
          this.sceneManager.scene.children,
          true
        );

        // Filter out helpers and ground
        const modelIntersects = intersects.filter((intersect) => {
          let current: THREE.Object3D | null = intersect.object;
          while (current) {
            const name = current.name || '';
            if (
              name.includes('jointAxis') ||
              name.includes('helper') ||
              name.includes('grid') ||
              name.includes('Ground') ||
              name === 'groundPlane'
            ) {
              return false;
            }
            current = current.parent;
          }
          return (intersect.object as THREE.Mesh).isMesh && intersect.object.visible;
        });

        if (modelIntersects.length === 0) {
          // Clicked on empty space - clear selection
          this.sceneManager.highlightManager?.clearHighlight();
          if (this.modelGraphView) {
            const svg = d3.select('#model-graph-svg');
            this.modelGraphView.clearAllSelections(svg);
          }
        }
      }

      mouseDownPos = null;
    });
  }

  private saveState(): void {
    if (!this.sceneManager) return;

    const state: ViewerState = {
      cameraPosition: {
        x: this.sceneManager.camera.position.x,
        y: this.sceneManager.camera.position.y,
        z: this.sceneManager.camera.position.z,
      },
    };

    // Save joint values if model exists
    if (this.currentModel?.joints) {
      state.jointValues = {};
      for (const [name, joint] of this.currentModel.joints) {
        if (joint.currentValue !== undefined) {
          state.jointValues[name] = joint.currentValue;
        }
      }
    }

    this.adapter.setState(state);
  }

  private restoreState(state: ViewerState): void {
    if (!this.sceneManager) return;

    // Restore camera position
    if (state.cameraPosition) {
      this.sceneManager.camera.position.set(
        state.cameraPosition.x,
        state.cameraPosition.y,
        state.cameraPosition.z
      );
    }

    // Restore joint values
    if (state.jointValues && this.currentModel?.joints) {
      for (const [name, value] of Object.entries(state.jointValues)) {
        const joint = this.currentModel.joints.get(name);
        if (joint) {
          this.sceneManager.setJointValue(name, value);
        }
      }
      // Update UI
      this.jointControlsUI?.setupJointControls(this.currentModel);
    }
  }

  private showError(title: string, message: string): void {
    const loading = document.getElementById('loading');
    const errorDiv = document.getElementById('error');
    const errorMessage = document.getElementById('error-message');

    if (loading) loading.style.display = 'none';
    if (errorDiv) errorDiv.style.display = 'block';
    if (errorMessage) errorMessage.textContent = message;
  }

  private hideError(): void {
    const errorDiv = document.getElementById('error');
    if (errorDiv) errorDiv.style.display = 'none';
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());

    if (this.sceneManager) {
      this.sceneManager.update();

      // Update MuJoCo simulation — always needs a render when active
      if (this.mujocoSimulationManager?.hasScene()) {
        this.mujocoSimulationManager.update(performance.now());
        this.sceneManager.redraw();
      }

      this.sceneManager.render();
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const viewer = new VSCodeRobotViewer();
    viewer.init();
  });
} else {
  const viewer = new VSCodeRobotViewer();
  viewer.init();
}
