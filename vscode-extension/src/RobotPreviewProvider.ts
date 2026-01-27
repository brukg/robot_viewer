import * as vscode from 'vscode';
import * as path from 'path';
import { MeshResolver } from './MeshResolver';
import type { ToWebviewMessage, ToExtensionMessage } from './messages';

/**
 * RobotPreviewProvider - Provides a side panel preview of robot files.
 *
 * This shows a preview panel in the explorer sidebar that automatically
 * updates when the active text editor changes to a robot file.
 */
export class RobotPreviewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private context: vscode.ExtensionContext;
  private meshResolver: MeshResolver;
  private currentDocument?: vscode.TextDocument;
  private debounceTimer?: NodeJS.Timeout;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.meshResolver = new MeshResolver();

    // Listen for active editor changes
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && this.isRobotFile(editor.document.uri)) {
        this.updatePreview(editor.document);
      }
    });

    // Listen for document changes
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (
        this.currentDocument &&
        event.document.uri.toString() === this.currentDocument.uri.toString()
      ) {
        this.debouncedUpdate(event.document);
      }
    });
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(this.context.extensionUri, 'resources'),
        ...(vscode.workspace.workspaceFolders?.map((f) => f.uri) || []),
      ],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message: ToExtensionMessage) => {
      await this.handleMessage(message, webviewView.webview);
    });

    // When the view becomes visible, update with current file
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        const editor = vscode.window.activeTextEditor;
        if (editor && this.isRobotFile(editor.document.uri)) {
          this.updatePreview(editor.document);
        }
      }
    });
  }

  /**
   * Show a specific file in the preview
   */
  async showFile(uri: vscode.Uri): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    this.updatePreview(document);
  }

  private async handleMessage(
    message: ToExtensionMessage,
    webview: vscode.Webview
  ): Promise<void> {
    switch (message.type) {
      case 'ready':
        // Send initial content if we have a document
        if (this.currentDocument) {
          await this.sendContent(webview, this.currentDocument);
        }
        break;

      case 'requestMesh':
        await this.handleMeshRequest(message, webview);
        break;

      case 'log':
        const prefix = '[Robot Preview]';
        switch (message.level) {
          case 'info':
            console.log(prefix, message.message);
            break;
          case 'warn':
            console.warn(prefix, message.message);
            break;
          case 'error':
            console.error(prefix, message.message);
            break;
        }
        break;

      case 'error':
        vscode.window.showErrorMessage(`Robot Preview: ${message.message}`);
        break;
    }
  }

  private async handleMeshRequest(
    message: { requestId: string; path: string; basePath: string },
    webview: vscode.Webview
  ): Promise<void> {
    if (!this.currentDocument) {
      const response: ToWebviewMessage = {
        type: 'meshData',
        requestId: message.requestId,
        path: message.path,
        data: null,
        error: 'No document loaded',
      };
      webview.postMessage(response);
      return;
    }

    try {
      const meshData = await this.meshResolver.resolveMesh(
        message.path,
        this.currentDocument.uri,
        vscode.workspace.workspaceFolders
      );

      const response: ToWebviewMessage = {
        type: 'meshData',
        requestId: message.requestId,
        path: message.path,
        data: meshData ? Array.from(meshData) : null,
      };
      webview.postMessage(response);
    } catch (error) {
      const response: ToWebviewMessage = {
        type: 'meshData',
        requestId: message.requestId,
        path: message.path,
        data: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      webview.postMessage(response);
    }
  }

  private async updatePreview(document: vscode.TextDocument): Promise<void> {
    if (!this.view || !this.view.visible) {
      return;
    }

    this.currentDocument = document;
    await this.sendContent(this.view.webview, document);
  }

  private debouncedUpdate(document: vscode.TextDocument): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      const config = vscode.workspace.getConfiguration('robotViewer');
      if (config.get('autoReload', true)) {
        this.sendContentChanged(document);
      }
    }, 300);
  }

  private async sendContent(
    webview: vscode.Webview,
    document: vscode.TextDocument
  ): Promise<void> {
    // Send resource paths
    const resourcePaths: ToWebviewMessage = {
      type: 'resourcePaths',
      mujocoWasm: webview
        .asWebviewUri(
          vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'mujoco')
        )
        .toString(),
      extensionUri: webview.asWebviewUri(this.context.extensionUri).toString(),
    };
    webview.postMessage(resourcePaths);

    // Send settings
    const config = vscode.workspace.getConfiguration('robotViewer');
    const settings: ToWebviewMessage = {
      type: 'settingsChanged',
      settings: {
        enableSimulation: config.get('enableSimulation', true),
        autoReload: config.get('autoReload', true),
      },
    };
    webview.postMessage(settings);

    // Send theme
    const theme: ToWebviewMessage = {
      type: 'themeChanged',
      theme:
        vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light
          ? 'light'
          : 'dark',
    };
    webview.postMessage(theme);

    // Detect file type
    const fileType = this.detectFileType(document.uri);

    // Send file content
    const loadFile: ToWebviewMessage = {
      type: 'loadFile',
      content: document.getText(),
      filename: path.basename(document.uri.fsPath),
      uri: document.uri.toString(),
      fileType,
    };
    webview.postMessage(loadFile);
  }

  private sendContentChanged(document: vscode.TextDocument): void {
    if (!this.view) {
      return;
    }

    const message: ToWebviewMessage = {
      type: 'contentChanged',
      content: document.getText(),
    };
    this.view.webview.postMessage(message);
  }

  private detectFileType(uri: vscode.Uri): 'urdf' | 'mjcf' | 'usd' {
    const ext = path.extname(uri.fsPath).toLowerCase();
    if (ext === '.urdf') return 'urdf';
    if (ext === '.xml') return 'mjcf';
    return 'usd';
  }

  private isRobotFile(uri: vscode.Uri): boolean {
    const ext = path.extname(uri.fsPath).toLowerCase();
    return ['.urdf', '.xml', '.usd', '.usda', '.usdc', '.usdz'].includes(ext);
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        'dist',
        'webview',
        'assets',
        'main.js'
      )
    );

    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        'dist',
        'webview',
        'assets',
        'main.css'
      )
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    script-src 'nonce-${nonce}' ${webview.cspSource};
    style-src ${webview.cspSource} 'unsafe-inline';
    img-src ${webview.cspSource} data: blob:;
    font-src ${webview.cspSource};
    connect-src ${webview.cspSource} blob: data:;
    worker-src ${webview.cspSource} blob:;
  ">
  <link rel="stylesheet" href="${styleUri}">
  <title>Robot Preview</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--vscode-editor-background);
    }
    #app {
      width: 100%;
      height: 100%;
    }
    #loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      color: var(--vscode-editor-foreground);
    }
    .spinner {
      width: 24px;
      height: 24px;
      border: 2px solid var(--vscode-editor-foreground);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 8px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    #empty-state {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div id="app">
    <div id="loading">
      <div class="spinner"></div>
      <p style="font-size: 11px;">Loading preview...</p>
    </div>
    <div id="empty-state" style="display: none;">
      <p>Open a robot file (.urdf, .xml) to see preview</p>
    </div>
  </div>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
