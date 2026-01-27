import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Resolves mesh file paths for URDF/MJCF files.
 * Supports:
 * - Relative paths from document location
 * - package:// protocol (ROS packages)
 * - Workspace-wide search
 */
export class MeshResolver {
  private cache: Map<string, Uint8Array> = new Map();
  private packageCache: Map<string, vscode.Uri> = new Map();

  async resolveMesh(
    meshPath: string,
    documentUri: vscode.Uri,
    workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined
  ): Promise<Uint8Array | null> {
    // Check cache first
    const cacheKey = `${documentUri.toString()}:${meshPath}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    let resolvedUri: vscode.Uri | null = null;

    // Strategy 1: Handle package:// protocol
    if (meshPath.startsWith('package://')) {
      resolvedUri = await this.resolvePackagePath(meshPath, workspaceFolders);
    }
    // Strategy 2: Handle file:// protocol
    else if (meshPath.startsWith('file://')) {
      resolvedUri = vscode.Uri.parse(meshPath);
    }
    // Strategy 3: Absolute path
    else if (path.isAbsolute(meshPath)) {
      resolvedUri = vscode.Uri.file(meshPath);
    }
    // Strategy 4: Relative path from document
    else {
      resolvedUri = await this.resolveRelativePath(meshPath, documentUri);
    }

    // Strategy 5: Workspace-wide search as fallback
    if (!resolvedUri) {
      resolvedUri = await this.searchWorkspace(meshPath, workspaceFolders);
    }

    if (!resolvedUri) {
      console.warn(`Could not resolve mesh path: ${meshPath}`);
      return null;
    }

    try {
      const data = await vscode.workspace.fs.readFile(resolvedUri);
      this.cache.set(cacheKey, data);
      return data;
    } catch (error) {
      console.error(`Error reading mesh file ${resolvedUri.fsPath}:`, error);
      return null;
    }
  }

  private async resolvePackagePath(
    packageUrl: string,
    workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined
  ): Promise<vscode.Uri | null> {
    // Parse: package://package_name/path/to/mesh.stl
    const match = packageUrl.match(/^package:\/\/([^/]+)\/(.+)$/);
    if (!match) {
      return null;
    }

    const [, packageName, relativePath] = match;

    // Check package cache
    if (this.packageCache.has(packageName)) {
      const packageUri = this.packageCache.get(packageName)!;
      const meshUri = vscode.Uri.joinPath(packageUri, relativePath);
      try {
        await vscode.workspace.fs.stat(meshUri);
        return meshUri;
      } catch {
        // File doesn't exist, continue searching
      }
    }

    if (!workspaceFolders) {
      return null;
    }

    // Strategy 1: Look for ROS package (package.xml)
    const packageXmlFiles = await vscode.workspace.findFiles(
      '**/package.xml',
      '**/node_modules/**'
    );

    for (const packageXml of packageXmlFiles) {
      try {
        const content = await vscode.workspace.fs.readFile(packageXml);
        const xmlContent = new TextDecoder().decode(content);

        // Simple check for package name in package.xml
        if (xmlContent.includes(`<name>${packageName}</name>`)) {
          const packageDir = vscode.Uri.joinPath(packageXml, '..');
          this.packageCache.set(packageName, packageDir);

          const meshUri = vscode.Uri.joinPath(packageDir, relativePath);
          try {
            await vscode.workspace.fs.stat(meshUri);
            return meshUri;
          } catch {
            // Mesh not found in this package, continue
          }
        }
      } catch {
        // Error reading package.xml, continue
      }
    }

    // Strategy 2: Folder name matching
    for (const folder of workspaceFolders) {
      // Try direct folder name match
      const directMatch = vscode.Uri.joinPath(folder.uri, packageName, relativePath);
      try {
        await vscode.workspace.fs.stat(directMatch);
        this.packageCache.set(packageName, vscode.Uri.joinPath(folder.uri, packageName));
        return directMatch;
      } catch {
        // Not found, continue
      }

      // Try searching for package folder anywhere in workspace
      const packageFolders = await vscode.workspace.findFiles(
        `**/${packageName}/${relativePath}`,
        '**/node_modules/**',
        1
      );

      if (packageFolders.length > 0) {
        return packageFolders[0];
      }
    }

    return null;
  }

  private async resolveRelativePath(
    meshPath: string,
    documentUri: vscode.Uri
  ): Promise<vscode.Uri | null> {
    // Normalize path (remove ./ prefix, handle ../)
    const normalizedPath = meshPath.replace(/^\.\//, '');
    const documentDir = vscode.Uri.joinPath(documentUri, '..');
    const meshUri = vscode.Uri.joinPath(documentDir, normalizedPath);

    try {
      await vscode.workspace.fs.stat(meshUri);
      return meshUri;
    } catch {
      return null;
    }
  }

  private async searchWorkspace(
    meshPath: string,
    workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined
  ): Promise<vscode.Uri | null> {
    if (!workspaceFolders) {
      return null;
    }

    // Extract just the filename for searching
    const filename = path.basename(meshPath);

    // Try to find by exact path suffix
    const pathSuffix = meshPath.replace(/^\.\//, '').replace(/\\/g, '/');
    const exactMatches = await vscode.workspace.findFiles(
      `**/${pathSuffix}`,
      '**/node_modules/**',
      1
    );

    if (exactMatches.length > 0) {
      return exactMatches[0];
    }

    // Try to find by filename only
    const filenameMatches = await vscode.workspace.findFiles(
      `**/${filename}`,
      '**/node_modules/**',
      5
    );

    if (filenameMatches.length === 1) {
      return filenameMatches[0];
    }

    // If multiple matches, try to find the best one based on path similarity
    if (filenameMatches.length > 1) {
      const meshPathParts = meshPath.split(/[/\\]/).filter(Boolean);
      let bestMatch: vscode.Uri | null = null;
      let bestScore = 0;

      for (const match of filenameMatches) {
        const matchParts = match.path.split('/').filter(Boolean);
        let score = 0;

        // Count matching path segments from the end
        for (let i = 1; i <= Math.min(meshPathParts.length, matchParts.length); i++) {
          if (
            meshPathParts[meshPathParts.length - i]?.toLowerCase() ===
            matchParts[matchParts.length - i]?.toLowerCase()
          ) {
            score++;
          } else {
            break;
          }
        }

        if (score > bestScore) {
          bestScore = score;
          bestMatch = match;
        }
      }

      if (bestMatch) {
        return bestMatch;
      }

      // Return first match as fallback
      return filenameMatches[0];
    }

    return null;
  }

  clearCache(): void {
    this.cache.clear();
    this.packageCache.clear();
  }
}
