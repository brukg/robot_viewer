import * as vscode from 'vscode';
import * as path from 'path';
import { Disposable } from './dispose';
import { WebAppServer } from './WebAppServer';

/**
 * Custom document class for USD files.
 */
class UsdDocument extends Disposable implements vscode.CustomDocument {
  static async create(
    uri: vscode.Uri,
    backupId: string | undefined
  ): Promise<UsdDocument> {
    const dataFile = typeof backupId === 'string' ? vscode.Uri.parse(backupId) : uri;
    const fileData = await vscode.workspace.fs.readFile(dataFile);
    return new UsdDocument(uri, fileData);
  }

  private readonly _uri: vscode.Uri;
  private _documentData: Uint8Array;

  private constructor(uri: vscode.Uri, initialContent: Uint8Array) {
    super();
    this._uri = uri;
    this._documentData = initialContent;
  }

  public get uri(): vscode.Uri {
    return this._uri;
  }

  public get documentData(): Uint8Array {
    return this._documentData;
  }
}

/**
 * Custom editor provider for USD files (.usd, .usda, .usdc, .usdz)
 * Opens USD files in a browser using a local server with COOP/COEP headers.
 */
export class UsdBinaryEditorProvider implements vscode.CustomEditorProvider<UsdDocument> {
  private static readonly viewType = 'robotViewer.usdEditor';
  private readonly context: vscode.ExtensionContext;
  private readonly webAppServer: WebAppServer;

  constructor(context: vscode.ExtensionContext, webAppServer: WebAppServer) {
    this.context = context;
    this.webAppServer = webAppServer;
  }

  async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<UsdDocument> {
    const document = await UsdDocument.create(uri, openContext.backupId);

    // Prompt to open in browser
    const filename = path.basename(uri.fsPath);
    const choice = await vscode.window.showInformationMessage(
      `Open "${filename}" in the USD viewer?`,
      'Open in Browser',
      'Open as Text'
    );

    if (choice === 'Open in Browser') {
      await this.openInBrowser(uri.fsPath);
    } else if (choice === 'Open as Text') {
      vscode.commands.executeCommand('vscode.openWith', uri, 'default');
    }

    return document;
  }

  /**
   * Open the USD file in a browser with the local server
   */
  private async openInBrowser(filePath: string): Promise<void> {
    try {
      // Start server if not running
      if (!this.webAppServer.isRunning()) {
        vscode.window.showInformationMessage('Starting USD viewer server...');
        await this.webAppServer.start();
      }

      // Open browser with file path
      const encodedPath = encodeURIComponent(filePath);
      const url = `${this.webAppServer.getUrl()}?file=${encodedPath}`;
      vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to start USD viewer: ${error}`);
    }
  }

  async resolveCustomEditor(
    document: UsdDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const filename = path.basename(document.uri.fsPath);
    const filePath = document.uri.fsPath;

    webviewPanel.webview.options = { enableScripts: true };
    webviewPanel.webview.html = this.getHtmlContent(filename);

    // Handle messages from webview
    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'openWebApp') {
        await this.openInBrowser(filePath);
      }
    });
  }

  private getHtmlContent(filename: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>USD Viewer</title>
  <style>
    body {
      margin: 0;
      padding: 40px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-foreground, #cccccc);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      box-sizing: border-box;
      text-align: center;
    }
    h2 { margin-bottom: 16px; }
    p { margin: 8px 0; max-width: 500px; line-height: 1.5; }
    .filename {
      font-family: monospace;
      background: var(--vscode-textBlockQuote-background, #2d2d2d);
      padding: 4px 8px;
      border-radius: 4px;
    }
    button {
      margin-top: 20px;
      padding: 10px 24px;
      font-size: 14px;
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }
  </style>
</head>
<body>
  <h2>USD File</h2>
  <p class="filename">${filename}</p>
  <p>Click below to open the 3D viewer in your browser.</p>
  <button onclick="openWebApp()">Open USD Viewer</button>
  <script>
    const vscode = acquireVsCodeApi();
    function openWebApp() {
      vscode.postMessage({ type: 'openWebApp' });
    }
  </script>
</body>
</html>`;
  }

  private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
    vscode.CustomDocumentEditEvent<UsdDocument>
  >();
  public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

  public saveCustomDocument(): Thenable<void> { return Promise.resolve(); }
  public saveCustomDocumentAs(): Thenable<void> { return Promise.resolve(); }
  public revertCustomDocument(): Thenable<void> { return Promise.resolve(); }
  public backupCustomDocument(document: UsdDocument, context: vscode.CustomDocumentBackupContext): Thenable<vscode.CustomDocumentBackup> {
    return this.backup(document, context.destination);
  }

  private async backup(document: UsdDocument, destination: vscode.Uri): Promise<vscode.CustomDocumentBackup> {
    await vscode.workspace.fs.writeFile(destination, document.documentData);
    return {
      id: destination.toString(),
      delete: async () => {
        try { await vscode.workspace.fs.delete(destination); } catch { }
      },
    };
  }
}
