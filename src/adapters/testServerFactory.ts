/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import path from 'path';
import * as vscodeTypes from '../vscodeTypes';
import { ITestServerFactory, TestConfig } from '../core/playwrightTestServer';
import { startBackend } from '../backend';
import { TestServerConnection, TestServerTransport } from '../upstream/testServerConnection';
import { WebSocketTestServerTransport } from '../upstream/testServerConnection';
import { ILogger } from '../core/logging';

/**
 * VS Code test server factory implementation
 */
export class VSCodeTestServerFactory implements ITestServerFactory {
  private _vscode: vscodeTypes.VSCode;
  private _logger: ILogger;

  constructor(vscode: vscodeTypes.VSCode, logger: ILogger) {
    this._vscode = vscode;
    this._logger = logger;
  }

  async createTestServer(config: TestConfig, env: NodeJS.ProcessEnv): Promise<TestServerConnection | null> {
    const errors: string[] = [];
    const paths = this._normalizePaths(config);
    const wsEndpoint = await startBackend(this._vscode, {
      args: [
        paths.cli,
        'test-server',
        '-c', paths.config,
      ],
      cwd: paths.cwd,
      envProvider: () => env,
      dumpIO: false,
      errors,
      logger: { debug: (msg: string) => this._logger.debug(msg), info: (msg: string) => this._logger.info(msg), error: (msg: string) => this._logger.error(msg), warn: (msg: string) => this._logger.warn(msg) } as any,
      onClose: () => {},
      onError: (error: Error) => {
        this._logger.error('Test server error:', error);
      },
    });

    if (!wsEndpoint)
      return null;

    const connection = new TestServerConnection(new TestServerTransportDebugger(new WebSocketTestServerTransport(wsEndpoint), this._logger));
    return connection;
  }

  private _normalizePaths(config: TestConfig) {
    let cwd = config.workspaceFolder;
    if (process.platform === 'win32') {
      cwd = cwd[0].toUpperCase() + cwd.substring(1);
    }
    return {
      cwd,
      cli: path.relative(cwd, config.cli),
      config: path.relative(cwd, config.configFile),
    };
  }
}

class TestServerTransportDebugger implements TestServerTransport {
  constructor(private _inner: TestServerTransport, private _logger: ILogger) {}

  send(message: string): void {
    this._logger.debug('-->', message);
    this._inner.send(message);
  }

  onmessage(callback: (message: string) => void): void {
    this._inner.onmessage((message: string) => {
      this._logger.debug('<--', message);
      callback(message);
    });
  }

  onerror(listener: () => void): void {
    this._inner.onerror(() => {
      this._logger.debug('<-- transport error');
      listener();
    });
  }

  onclose(listener: () => void): void {
    this._inner.onclose(() => {
      this._logger.debug('<-- transport close');
      listener();
    });
  }

  onopen(listener: () => void): void {
    this._inner.onopen(() => {
      this._logger.debug('<-- transport open');
      listener();
    });
  }

  close(): void {
    this._logger.debug('<-- transport close');
    this._inner.close();
  }
}
