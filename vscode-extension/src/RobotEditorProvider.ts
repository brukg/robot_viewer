import * as vscode from 'vscode';
import * as path from 'path';
import { MeshResolver } from './MeshResolver';
import { SyncManager } from './SyncManager';
import type { ToWebviewMessage, ToExtensionMessage } from './messages';

type FileType = 'urdf' | 'mjcf' | 'usd' | 'xacro';

export class RobotEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly context: vscode.ExtensionContext;
  private readonly fileType: FileType;
  private readonly meshResolver: MeshResolver;
  private readonly syncManager: SyncManager;

  constructor(context: vscode.ExtensionContext, fileType: FileType) {
    this.context = context;
    this.fileType = fileType;
    this.meshResolver = new MeshResolver();
    this.syncManager = new SyncManager();
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
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

    // Track document changes
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (e.document.uri.toString() === document.uri.toString()) {
          this.updateWebview(webviewPanel.webview, document);
        }
      }
    );

    // Handle messages from webview
    webviewPanel.webview.onDidReceiveMessage(async (message: ToExtensionMessage) => {
      await this.handleMessage(message, document, webviewPanel.webview);
    });

    // Clean up when panel is closed
    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
    });

    // Initial content load when webview is ready
    // Content is sent after webview posts 'ready' message
  }

  private async handleMessage(
    message: ToExtensionMessage,
    document: vscode.TextDocument,
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

      case 'jointChanged':
        await this.handleJointChanged(message, document);
        break;

      case 'save':
        await document.save();
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
    document: vscode.TextDocument
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

    // Detect actual file type for MJCF
    let actualFileType = this.fileType;
    if (this.fileType === 'mjcf') {
      const content = document.getText();
      if (!this.isMjcfContent(content)) {
        // Not actually MJCF, might be generic XML
        vscode.window.showWarningMessage(
          'This XML file does not appear to be a valid MJCF robot file.'
        );
      }
    }

    // Send file content
    const loadFile: ToWebviewMessage = {
      type: 'loadFile',
      content: document.getText(),
      filename: path.basename(document.uri.fsPath),
      uri: document.uri.toString(),
      fileType: actualFileType,
    };
    webview.postMessage(loadFile);
  }

  private isMjcfContent(content: string): boolean {
    // Check if XML content is MJCF (has <mujoco> root and robot-related elements)
    return (
      content.includes('<mujoco') &&
      (content.includes('<joint') ||
        content.includes('<actuator') ||
        content.includes('<body'))
    );
  }

  private async handleMeshRequest(
    message: { requestId: string; path: string; basePath: string },
    document: vscode.TextDocument,
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

  private async handleJointChanged(
    message: { jointName: string; value: number; valueType: string },
    document: vscode.TextDocument
  ): Promise<void> {
    const currentContent = document.getText();
    const fileType = this.detectFileType(document.uri);

    let updatedContent: string | null = null;

    if (fileType === 'urdf') {
      if (message.valueType === 'position') {
        // For position changes, we don't update the URDF file
        // (positions are runtime state, not part of the model definition)
        return;
      } else {
        // For limit changes, update the XML
        updatedContent = this.syncManager.updateURDFJointLimits(
          currentContent,
          message.jointName,
          { [message.valueType.replace('limit_', '')]: message.value }
        );
      }
    } else if (fileType === 'mjcf') {
      updatedContent = this.syncManager.updateMJCFJoint(
        currentContent,
        message.jointName,
        message.valueType,
        message.value
      );
    }

    if (updatedContent && updatedContent !== currentContent) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        document.uri,
        new vscode.Range(0, 0, document.lineCount, 0),
        updatedContent
      );
      await vscode.workspace.applyEdit(edit);
    }
  }

  private updateWebview(webview: vscode.Webview, document: vscode.TextDocument): void {
    const config = vscode.workspace.getConfiguration('robotViewer');
    if (!config.get('autoReload', true)) {
      return;
    }

    const message: ToWebviewMessage = {
      type: 'contentChanged',
      content: document.getText(),
    };
    webview.postMessage(message);
  }

  private detectFileType(uri: vscode.Uri): FileType {
    const ext = path.extname(uri.fsPath).toLowerCase();
    if (ext === '.urdf') return 'urdf';
    if (ext === '.xacro') return 'xacro';
    if (ext === '.xml') return 'mjcf';
    return 'usd';
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
