import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';

/**
 * Local HTTP server for serving the web app with COOP/COEP headers.
 * This enables SharedArrayBuffer support required for OpenUSD WASM.
 */
export class WebAppServer {
  private server: http.Server | null = null;
  private port: number = 0;
  private webappPath: string;

  constructor(webappPath: string) {
    this.webappPath = webappPath;
  }

  /**
   * Start the server on an available port
   */
  async start(): Promise<number> {
    if (this.server) {
      return this.port;
    }

    // Find an available port
    this.port = await this.findAvailablePort(9876);

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (err) => {
        console.error('WebAppServer error:', err);
        reject(err);
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        console.log(`WebAppServer running at http://localhost:${this.port}`);
        resolve(this.port);
      });
    });
  }

  /**
   * Stop the server
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.port = 0;
    }
  }

  /**
   * Get the server URL
   */
  getUrl(): string {
    return `http://localhost:${this.port}`;
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.server !== null;
  }

  /**
   * Find an available port starting from the given port
   */
  private async findAvailablePort(startPort: number): Promise<number> {
    const isPortAvailable = (port: number): Promise<boolean> => {
      return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
          server.close();
          resolve(true);
        });
        server.listen(port, '127.0.0.1');
      });
    };

    let port = startPort;
    while (!(await isPortAvailable(port))) {
      port++;
      if (port > startPort + 100) {
        throw new Error('Could not find an available port');
      }
    }
    return port;
  }

  /**
   * Check if a file path is a USD file
   */
  private isUsdFile(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return lower.endsWith('.usd') || lower.endsWith('.usda') ||
           lower.endsWith('.usdc') || lower.endsWith('.usdz');
  }

  /**
   * Handle HTTP requests
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Set COOP/COEP headers for SharedArrayBuffer support
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    // Parse URL
    const url = new URL(req.url || '/', `http://localhost:${this.port}`);
    let filePath = url.pathname;

    // Handle API endpoint for serving local files
    if (filePath === '/api/file') {
      const localPath = url.searchParams.get('path');
      if (!localPath) {
        res.writeHead(400);
        res.end('Missing path parameter');
        return;
      }
      this.serveLocalFile(localPath, res);
      return;
    }

    // Check if this is a USD file request - serve USD loader instead of index.html
    const fileParam = url.searchParams.get('file');
    if (filePath === '/' && fileParam && this.isUsdFile(fileParam)) {
      const usdLoaderPath = path.join(this.webappPath, 'usd-loader.html');
      this.serveFile(usdLoaderPath, res);
      return;
    }

    // Default to index.html
    if (filePath === '/') {
      filePath = '/index.html';
    }

    // Resolve file path
    const fullPath = path.join(this.webappPath, filePath);

    // Security: prevent directory traversal
    if (!fullPath.startsWith(this.webappPath)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // Check if file exists
    fs.stat(fullPath, (err, stats) => {
      if (err || !stats.isFile()) {
        // Try index.html for SPA routing
        const indexPath = path.join(this.webappPath, 'index.html');
        this.serveFile(indexPath, res);
        return;
      }
      this.serveFile(fullPath, res);
    });
  }

  /**
   * Serve a local file from anywhere on the filesystem (for USD files)
   */
  private serveLocalFile(filePath: string, res: http.ServerResponse): void {
    // Verify file exists
    fs.stat(filePath, (err, stats) => {
      if (err) {
        res.writeHead(404);
        res.end(`File not found: ${filePath}`);
        return;
      }
      if (!stats.isFile()) {
        res.writeHead(400);
        res.end('Path is not a file');
        return;
      }
      this.serveFile(filePath, res);
    });
  }

  /**
   * Serve a file with proper MIME type
   */
  private serveFile(filePath: string, res: http.ServerResponse): void {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.mjs': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.wasm': 'application/wasm',
      '.glb': 'model/gltf-binary',
      '.gltf': 'model/gltf+json',
      '.usd': 'application/octet-stream',
      '.usda': 'text/plain',
      '.usdc': 'application/octet-stream',
      '.usdz': 'application/octet-stream',
      '.hdr': 'application/octet-stream',
      '.exr': 'application/octet-stream',
      '.data': 'application/octet-stream',
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      res.setHeader('Content-Type', contentType);
      res.writeHead(200);
      res.end(data);
    });
  }
}
