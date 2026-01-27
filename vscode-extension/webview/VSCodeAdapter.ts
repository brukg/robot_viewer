/**
 * VSCodeAdapter - Bridge between the robot viewer and VS Code webview APIs.
 *
 * Handles:
 * - Message passing to/from extension host
 * - File loading via extension instead of drag-drop
 * - Mesh file requests
 * - State persistence
 */

import type {
  ToWebviewMessage,
  ToExtensionMessage,
  LoadFileMessage,
  MeshDataMessage,
  ResourcePathsMessage,
  ContentChangedMessage,
  SettingsChangedMessage,
  ThemeChangedMessage,
} from '../src/messages';

// VS Code API type
interface VSCodeApi {
  postMessage(message: ToExtensionMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeApi;

export interface VSCodeAdapterCallbacks {
  onFileLoad?: (message: LoadFileMessage) => void;
  onMeshData?: (message: MeshDataMessage) => void;
  onContentChanged?: (message: ContentChangedMessage) => void;
  onSettingsChanged?: (message: SettingsChangedMessage) => void;
  onThemeChanged?: (message: ThemeChangedMessage) => void;
  onResourcePaths?: (message: ResourcePathsMessage) => void;
}

export class VSCodeAdapter {
  private vscodeApi: VSCodeApi;
  private pendingMeshRequests: Map<
    string,
    {
      resolve: (data: Uint8Array | null) => void;
      reject: (error: Error) => void;
    }
  > = new Map();
  private requestIdCounter = 0;
  private callbacks: VSCodeAdapterCallbacks = {};
  private resourcePaths: ResourcePathsMessage | null = null;
  private currentDocumentUri: string = '';

  constructor() {
    this.vscodeApi = acquireVsCodeApi();
    this.setupMessageListener();
  }

  private setupMessageListener(): void {
    window.addEventListener('message', (event) => {
      const message = event.data as ToWebviewMessage;
      this.handleMessage(message);
    });
  }

  private handleMessage(message: ToWebviewMessage): void {
    switch (message.type) {
      case 'loadFile':
        this.currentDocumentUri = message.uri;
        this.callbacks.onFileLoad?.(message);
        break;

      case 'meshData':
        this.handleMeshDataResponse(message);
        break;

      case 'resourcePaths':
        this.resourcePaths = message;
        this.callbacks.onResourcePaths?.(message);
        break;

      case 'contentChanged':
        this.callbacks.onContentChanged?.(message);
        break;

      case 'settingsChanged':
        this.callbacks.onSettingsChanged?.(message);
        break;

      case 'themeChanged':
        this.callbacks.onThemeChanged?.(message);
        break;
    }
  }

  private handleMeshDataResponse(message: MeshDataMessage): void {
    const pending = this.pendingMeshRequests.get(message.requestId);
    if (pending) {
      this.pendingMeshRequests.delete(message.requestId);

      if (message.data) {
        pending.resolve(new Uint8Array(message.data));
      } else if (message.error) {
        pending.reject(new Error(message.error));
      } else {
        pending.resolve(null);
      }
    }
  }

  /**
   * Set callbacks for handling messages from extension
   */
  setCallbacks(callbacks: VSCodeAdapterCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Signal to extension that webview is ready
   */
  signalReady(): void {
    this.postMessage({ type: 'ready' });
  }

  /**
   * Request a mesh file from the extension
   */
  async requestMeshFile(meshPath: string): Promise<Uint8Array | null> {
    const requestId = `mesh_${this.requestIdCounter++}`;

    return new Promise((resolve, reject) => {
      // Set timeout for mesh request
      const timeout = setTimeout(() => {
        this.pendingMeshRequests.delete(requestId);
        reject(new Error(`Mesh request timeout: ${meshPath}`));
      }, 30000);

      this.pendingMeshRequests.set(requestId, {
        resolve: (data) => {
          clearTimeout(timeout);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      this.postMessage({
        type: 'requestMesh',
        requestId,
        path: meshPath,
        basePath: this.currentDocumentUri,
      });
    });
  }

  /**
   * Notify extension of joint value change
   */
  notifyJointChanged(
    jointName: string,
    value: number,
    valueType: 'position' | 'limit_lower' | 'limit_upper' | 'effort' | 'velocity' = 'position'
  ): void {
    this.postMessage({
      type: 'jointChanged',
      jointName,
      value,
      valueType,
    });
  }

  /**
   * Request file save
   */
  requestSave(): void {
    this.postMessage({ type: 'save' });
  }

  /**
   * Log message to extension console
   */
  log(level: 'info' | 'warn' | 'error', message: string): void {
    this.postMessage({
      type: 'log',
      level,
      message,
    });
  }

  /**
   * Report error to extension
   */
  reportError(message: string, details?: string): void {
    this.postMessage({
      type: 'error',
      message,
      details,
    });
  }

  /**
   * Get MuJoCo WASM path
   */
  getMujocoWasmPath(): string | null {
    return this.resourcePaths?.mujocoWasm || null;
  }

  /**
   * Get state from VS Code
   */
  getState<T>(): T | undefined {
    return this.vscodeApi.getState() as T | undefined;
  }

  /**
   * Save state to VS Code
   */
  setState<T>(state: T): void {
    this.vscodeApi.setState(state);
  }

  private postMessage(message: ToExtensionMessage): void {
    this.vscodeApi.postMessage(message);
  }

  /**
   * Create a mesh loader callback compatible with urdf-loader
   * This intercepts mesh load requests and routes them through VS Code
   */
  createMeshLoaderCallback(): (
    path: string,
    manager: unknown,
    done: (result: unknown, error?: Error) => void
  ) => void {
    return async (path, _manager, done) => {
      try {
        const data = await this.requestMeshFile(path);
        if (data) {
          // Create a blob URL for the mesh data
          const blob = new Blob([data]);
          const url = URL.createObjectURL(blob);
          done(url);
        } else {
          done(null, new Error(`Mesh not found: ${path}`));
        }
      } catch (error) {
        done(null, error instanceof Error ? error : new Error(String(error)));
      }
    };
  }
}

// Singleton instance
let instance: VSCodeAdapter | null = null;

export function getVSCodeAdapter(): VSCodeAdapter {
  if (!instance) {
    instance = new VSCodeAdapter();
  }
  return instance;
}
