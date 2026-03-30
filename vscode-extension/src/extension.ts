import * as vscode from 'vscode';
import * as path from 'path';
import { RobotEditorProvider } from './RobotEditorProvider';
import { RobotPreviewProvider } from './RobotPreviewProvider';
import { UsdBinaryEditorProvider } from './UsdBinaryEditorProvider';
import { WebAppServer } from './WebAppServer';

let previewProvider: RobotPreviewProvider | undefined;
let webAppServer: WebAppServer | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log('Robot Viewer extension is now active');

  // Initialize web app server for USD support
  const webappPath = path.join(context.extensionPath, 'resources', 'webapp');
  webAppServer = new WebAppServer(webappPath);

  // Register custom editor providers
  const urdfEditorProvider = new RobotEditorProvider(context, 'urdf');
  const mjcfEditorProvider = new RobotEditorProvider(context, 'mjcf');
  const xacroEditorProvider = new RobotEditorProvider(context, 'xacro');
  const usdEditorProvider = new UsdBinaryEditorProvider(context, webAppServer);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'robotViewer.urdfEditor',
      urdfEditorProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      }
    )
  );

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'robotViewer.mjcfEditor',
      mjcfEditorProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      }
    )
  );

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'robotViewer.xacroEditor',
      xacroEditorProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      }
    )
  );

  // Register USD editor for all USD formats (uses binary-safe provider)
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'robotViewer.usdEditor',
      usdEditorProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: true,
      }
    )
  );

  // Register preview panel provider
  previewProvider = new RobotPreviewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'robotViewer.preview',
      previewProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }
    )
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('robotViewer.openPreview', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && isRobotFile(editor.document.uri)) {
        previewProvider?.showFile(editor.document.uri);
      } else {
        vscode.window.showInformationMessage('No robot file is currently open');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('robotViewer.openToSide', async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && isRobotFile(editor.document.uri)) {
        await vscode.commands.executeCommand(
          'vscode.openWith',
          editor.document.uri,
          getEditorTypeForUri(editor.document.uri),
          vscode.ViewColumn.Beside
        );
      } else {
        vscode.window.showInformationMessage('No robot file is currently open');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('robotViewer.openWithViewer', async (uri: vscode.Uri) => {
      if (uri && isRobotFile(uri)) {
        await vscode.commands.executeCommand(
          'vscode.openWith',
          uri,
          getEditorTypeForUri(uri)
        );
      }
    })
  );

  // Set context for menu visibility
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      const isRobot = editor ? isRobotFile(editor.document.uri) : false;
      vscode.commands.executeCommand('setContext', 'robotViewer.isRobotFile', isRobot);
    })
  );

  // Set initial context
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    vscode.commands.executeCommand(
      'setContext',
      'robotViewer.isRobotFile',
      isRobotFile(activeEditor.document.uri)
    );
  }
}

export function deactivate() {
  console.log('Robot Viewer extension is now deactivated');
  // Stop the web app server
  if (webAppServer) {
    webAppServer.stop();
    webAppServer = undefined;
  }
}

function isRobotFile(uri: vscode.Uri): boolean {
  const path = uri.fsPath.toLowerCase();
  return (
    path.endsWith('.urdf') ||
    path.endsWith('.xacro') ||
    path.endsWith('.xml') ||
    path.endsWith('.usd') ||
    path.endsWith('.usda') ||
    path.endsWith('.usdc') ||
    path.endsWith('.usdz')
  );
}

function getEditorTypeForUri(uri: vscode.Uri): string {
  const path = uri.fsPath.toLowerCase();
  if (path.endsWith('.urdf')) {
    return 'robotViewer.urdfEditor';
  } else if (path.endsWith('.xacro')) {
    return 'robotViewer.xacroEditor';
  } else if (path.endsWith('.xml')) {
    return 'robotViewer.mjcfEditor';
  } else if (
    path.endsWith('.usd') ||
    path.endsWith('.usda') ||
    path.endsWith('.usdc') ||
    path.endsWith('.usdz')
  ) {
    return 'robotViewer.usdEditor';
  }
  return 'robotViewer.urdfEditor';
}
