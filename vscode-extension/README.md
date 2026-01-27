# Robot Viewer

3D visualization and manipulation of robot description files directly in VS Code.

![Robot Viewer](https://raw.githubusercontent.com/your-username/robot-viewer/main/docs/screenshot.png)

## Features

- **3D Visualization** - View URDF, MJCF, and USD robot models in an interactive 3D viewer
- **Joint Control** - Manipulate robot joints with sliders or direct interaction
- **Model Graph** - Visual tree representation of the robot structure (resizable & detachable)
- **Live Sync** - Changes in the viewer sync back to the file automatically
- **MuJoCo Simulation** - Run physics simulation for MJCF files
- **Mesh Resolution** - Automatically finds mesh files including ROS `package://` paths

## Supported Formats

| Format | Extensions | Description |
|--------|------------|-------------|
| URDF | `.urdf` | Universal Robot Description Format (ROS) |
| MJCF | `.xml` | MuJoCo XML format |
| USD | `.usd`, `.usda`, `.usdc`, `.usdz` | Universal Scene Description |

## Usage

### Opening Robot Files

- **Click** any `.urdf` file to open it directly in the 3D viewer
- **Right-click** → "Open With..." → "Robot Viewer" for other formats
- **Right-click** → "Open with Robot Viewer" from the explorer context menu

### Switching Between Views

To toggle between 3D view and text editor:
1. **Right-click** the file tab
2. Select **"Reopen Editor With..."**
3. Choose **"Text Editor"** or **"Robot Viewer"**

Or use the command palette (`Ctrl+Shift+P`):
- `Reopen Editor With...`

### Controls

| Action | Control |
|--------|---------|
| Rotate view | Left-click + drag |
| Pan view | Right-click + drag |
| Zoom | Scroll wheel |
| Move joint | Drag joint sliders or click on joints |

### Model Graph Panel

The model graph shows the robot's link/joint hierarchy:
- **Drag header** to move the panel
- **Drag edges/corners** to resize
- **Click ⧉** to detach into a floating window
- **Click ×** to close (when detached)

## Settings

Access via `File` → `Preferences` → `Settings` → search "Robot Viewer"

| Setting | Default | Description |
|---------|---------|-------------|
| `robotViewer.enableSimulation` | `true` | Enable MuJoCo physics for MJCF files |
| `robotViewer.autoReload` | `true` | Auto-reload when file changes externally |
| `robotViewer.meshSearchPaths` | `[]` | Additional paths to search for mesh files |

## Mesh File Resolution

The extension automatically resolves mesh files referenced in your robot descriptions:

1. **Relative paths** - Resolved from the robot file's directory
2. **`package://` paths** - Searches workspace for ROS packages (looks for `package.xml`)
3. **Workspace search** - Falls back to searching the entire workspace

## Requirements

- VS Code 1.85.0 or higher

## Known Limitations

- USD format has limited support compared to URDF/MJCF
- Very large models may take a moment to load
- XACRO files must be pre-processed to URDF

## Feedback & Issues

Report issues or request features on [GitHub](https://github.com/your-username/robot-viewer/issues).

## License

Apache-2.0
