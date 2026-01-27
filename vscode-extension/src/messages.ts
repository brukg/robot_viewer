/**
 * Message types for communication between extension host and webview
 */

// Extension -> Webview messages
export interface LoadFileMessage {
  type: 'loadFile';
  content: string;
  filename: string;
  uri: string;
  fileType: 'urdf' | 'mjcf' | 'usd';
}

export interface MeshDataMessage {
  type: 'meshData';
  requestId: string;
  path: string;
  data: number[] | null;
  error?: string;
}

export interface ResourcePathsMessage {
  type: 'resourcePaths';
  mujocoWasm: string;
  extensionUri: string;
}

export interface ContentChangedMessage {
  type: 'contentChanged';
  content: string;
}

export interface ThemeChangedMessage {
  type: 'themeChanged';
  theme: 'light' | 'dark';
}

export interface SettingsChangedMessage {
  type: 'settingsChanged';
  settings: {
    enableSimulation: boolean;
    autoReload: boolean;
  };
}

export type ToWebviewMessage =
  | LoadFileMessage
  | MeshDataMessage
  | ResourcePathsMessage
  | ContentChangedMessage
  | ThemeChangedMessage
  | SettingsChangedMessage;

// Webview -> Extension messages
export interface ReadyMessage {
  type: 'ready';
}

export interface RequestMeshMessage {
  type: 'requestMesh';
  requestId: string;
  path: string;
  basePath: string;
}

export interface JointChangedMessage {
  type: 'jointChanged';
  jointName: string;
  value: number;
  valueType: 'position' | 'limit_lower' | 'limit_upper' | 'effort' | 'velocity';
}

export interface SaveRequestMessage {
  type: 'save';
}

export interface ErrorMessage {
  type: 'error';
  message: string;
  details?: string;
}

export interface LogMessage {
  type: 'log';
  level: 'info' | 'warn' | 'error';
  message: string;
}

export type ToExtensionMessage =
  | ReadyMessage
  | RequestMeshMessage
  | JointChangedMessage
  | SaveRequestMessage
  | ErrorMessage
  | LogMessage;
