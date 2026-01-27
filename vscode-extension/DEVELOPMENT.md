# Development Guide

Instructions for building and developing the Robot Viewer VS Code extension.

## Prerequisites

- Node.js 18+
- pnpm 9+
- VS Code 1.85+

## Setup

```bash
cd vscode-extension
pnpm install
```

## Build

```bash
# Build both extension and webview
pnpm run build

# Build extension host only
pnpm run build:extension

# Build webview only
pnpm run build:webview
```

## Development

```bash
# Watch mode (rebuilds on changes)
pnpm run watch
```

Then press `F5` in VS Code to launch the Extension Development Host.

## Package for Distribution

```bash
pnpm run package
```

This creates `robot-viewer-x.x.x.vsix` which can be installed in VS Code.

## Project Structure

```
vscode-extension/
├── src/                    # Extension host code (TypeScript)
│   ├── extension.ts        # Entry point
│   ├── RobotEditorProvider.ts    # Custom editor
│   ├── RobotPreviewProvider.ts   # Side panel preview
│   ├── MeshResolver.ts     # Mesh file resolution
│   ├── SyncManager.ts      # XML sync logic
│   └── messages.ts         # Message types
├── webview/                # Webview code (TypeScript)
│   ├── index.html          # Webview HTML
│   ├── main.ts             # Webview entry point
│   └── VSCodeAdapter.ts    # VS Code API bridge
├── dist/                   # Build output
├── package.json            # Extension manifest
├── vite.config.extension.ts
└── vite.config.webview.ts
```

## Architecture

The extension has two parts:

1. **Extension Host** - Runs in Node.js, handles file I/O and VS Code APIs
2. **Webview** - Runs in browser context, renders 3D content

They communicate via `postMessage()`.
