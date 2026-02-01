import * as vscode from 'vscode';

/**
 * Utility class for managing disposable resources.
 * Based on the official VS Code custom editor sample.
 */
export abstract class Disposable {
  private _isDisposed = false;
  protected _disposables: vscode.Disposable[] = [];

  public dispose(): void {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    disposeAll(this._disposables);
  }

  protected _register<T extends vscode.Disposable>(value: T): T {
    if (this._isDisposed) {
      value.dispose();
    } else {
      this._disposables.push(value);
    }
    return value;
  }

  protected get isDisposed(): boolean {
    return this._isDisposed;
  }
}

export function disposeAll(disposables: vscode.Disposable[]): void {
  while (disposables.length) {
    const item = disposables.pop();
    if (item) {
      item.dispose();
    }
  }
}
