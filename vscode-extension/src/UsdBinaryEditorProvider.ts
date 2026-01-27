import * as vscode from 'vscode';
import * as path from 'path';
import { MeshResolver } from './MeshResolver';
import type { ToWebviewMessage, ToExtensionMessage } from './messages';

/**
 * Custom editor provider for binary USD files (.usd, .usdc, .usdz)
 * These files cannot be edited as text, so we use CustomReadonlyEditorProvider
 */
export class UsdBinaryEditorProvider implements vscode.CustomReadonlyEditorProvider<vscode.CustomDocument> {
  private readonly context: vscode.ExtensionContext;
  private readonly meshResolver: MeshResolver;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.meshResolver = new MeshResolver();
  }

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<vscode.CustomDocument> {
    // Return a simple document object
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    // Setup webview options
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(this.context.extensionUri, 'resources'),
        // Allow access to workspace folders for mesh files
        ...(vscode.workspace.workspaceFolders?.map((f) => f.uri) || []),
      ],
    };

    // Set webview HTML content
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    // Handle messages from webview
    webviewPanel.webview.onDidReceiveMessage(async (message: ToExtensionMessage) => {
      await this.handleMessage(message, document, webviewPanel.webview);
    });
  }

  private async handleMessage(
    message: ToExtensionMessage,
    document: vscode.CustomDocument,
    webview: vscode.Webview
  ): Promise<void> {
    switch (message.type) {
      case 'ready':
        // Send initial content
        await this.sendInitialContent(webview, document);
        break;

      case 'requestMesh':
        await this.handleMeshRequest(message, document, webview);
        break;

      case 'log':
        const logPrefix = '[Robot Viewer Webview]';
        switch (message.level) {
          case 'info':
            console.log(logPrefix, message.message);
            break;
          case 'warn':
            console.warn(logPrefix, message.message);
            break;
          case 'error':
            console.error(logPrefix, message.message);
            break;
        }
        break;

      case 'error':
        vscode.window.showErrorMessage(`Robot Viewer: ${message.message}`);
        break;
    }
  }

  private async sendInitialContent(
    webview: vscode.Webview,
    document: vscode.CustomDocument
  ): Promise<void> {
    // Send resource paths first
    const resourcePaths: ToWebviewMessage = {
      type: 'resourcePaths',
      mujocoWasm: webview
        .asWebviewUri(
          vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'mujoco')
        )
        .toString(),
      extensionUri: webview
        .asWebviewUri(this.context.extensionUri)
        .toString(),
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
      theme: vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light
        ? 'light'
        : 'dark',
    };
    webview.postMessage(theme);

    // Read file content
    const fileData = await vscode.workspace.fs.readFile(document.uri);
    const filename = path.basename(document.uri.fsPath);
    const ext = path.extname(filename).toLowerCase();

    // Check if it's a text-based USD file (.usda)
    const isTextBased = ext === '.usda';

    let content: string;
    let isBinary: boolean;

    if (isTextBased) {
      // .usda files are text-based, send as string
      content = Buffer.from(fileData).toString('utf-8');
      isBinary = false;
    } else {
      // Binary USD files (.usd, .usdc, .usdz) - send as base64
      content = Buffer.from(fileData).toString('base64');
      isBinary = true;
    }

    // Send file content
    const loadFile: ToWebviewMessage = {
      type: 'loadFile',
      content,
      filename,
      uri: document.uri.toString(),
      fileType: 'usd',
      isBinary,
    };
    webview.postMessage(loadFile);
  }

  private async handleMeshRequest(
    message: { requestId: string; path: string; basePath: string },
    document: vscode.CustomDocument,
    webview: vscode.Webview
  ): Promise<void> {
    try {
      const meshData = await this.meshResolver.resolveMesh(
        message.path,
        document.uri,
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

  private getHtmlForWebview(webview: vscode.Webview): string {
    const webviewUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')
    );

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'assets', 'main.js')
    );

    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'assets', 'main.css')
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
  <title>Robot Viewer</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    #app {
      width: 100%;
      height: 100%;
    }
  </style>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">
    window.vscodeWebviewUri = "${webviewUri}";
  </script>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
