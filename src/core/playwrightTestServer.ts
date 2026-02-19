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
import { ICancellationToken } from './cancellation';
import { Disposable, EventEmitter } from '../upstream/events';
import { DisposableBase } from '../disposableBase';
import { ILogger } from './logging';
import * as reporterTypes from '../upstream/reporter';
import { TeleReporterReceiver, JsonConfig } from '../upstream/teleReceiver';
import { TestServerConnection } from '../upstream/testServerConnection';
import { escapeRegex } from '../utils';
import type { TestModel } from './testModel';
import { TestServerInterface } from '../upstream/testServerInterface';
import { ConfigFindRelatedTestFilesReport, ConfigListFilesReport } from '../listTests';

export type TestConfig = {
  workspaceFolder: string;
  configFile: string;
  cli: string;
  version: number;
  testIdAttributeName?: string;
};

export type PlaywrightTestRunOptions = {
  headed?: boolean;
  workers?: string | number;
  trace?: 'on' | 'off';
  video?: 'on' | 'off';
  reuseContext?: boolean;
  connectWsEndpoint?: string;
  updateSnapshots?: 'all' | 'changed' | 'missing' | 'none' | undefined;
  updateSourceMethod?: 'overwrite' | 'patch' | '3way' | undefined;
};

export interface ITestServerFactory {
  createTestServer(config: TestConfig, env: NodeJS.ProcessEnv): Promise<TestServerConnection | null>;
}

export interface IDebugger {
  startDebug(request: any): Promise<void>;
  stopDebug(): Promise<void>;
}

export interface PlaywrightTestOptions {
  isUnderTest: boolean;
  envProvider: (configFile: string) => NodeJS.ProcessEnv;
  onStdOut?: (output: string) => void;
  testPausedHandler?: (params: { errors: reporterTypes.TestError[] }) => void;
  logger: ILogger;
}

export class PlaywrightTestServer extends DisposableBase {
  private _model: TestModel;
  private _options: PlaywrightTestOptions;
  private _testServerPromise: Promise<TestServerConnectionWrapper> | undefined;
  private _config?: JsonConfig;
  private _globalSetupEnv: { [key: string]: string | undefined } = {};
  private _serverFactory: ITestServerFactory;
  private _onStdOut = new EventEmitter<string>();

  constructor(model: TestModel, options: PlaywrightTestOptions, serverFactory: ITestServerFactory) {
    super();
    this._model = model;
    this._options = options;
    this._serverFactory = serverFactory;
    this._disposables.push(this._onStdOut);
  }

  reset(): void {
    this._disposeTestServer();
  }

  config(): JsonConfig | undefined {
    return this._config;
  }

  async listFiles(): Promise<ConfigListFilesReport> {
    const testServer = await this._testServer();
    if (!testServer.connection) {
      const errors = testServer.errors.length ? '. Test server errors: ' + testServer.errors.join('\n') : '';
      throw new Error('Internal error: unable to connect to the test server.' + errors);
    }

    const result: ConfigListFilesReport = {
      projects: [],
    };

    const { report } = await testServer.connection.listFiles({});
    const teleReceiver = new TeleReporterReceiver({
      onConfigure: (config: JsonConfig) => {
        this._config = config;
      },
      onBegin(rootSuite) {
        for (const projectSuite of rootSuite.suites) {
          const project = projectSuite.project()!;
          const files: string[] = [];
          result.projects.push({
            name: project.name,
            testDir: project.testDir,
            use: project.use || {},
            files,
          });
          for (const fileSuite of projectSuite.suites)
            files.push(fileSuite.location!.file);
        }
      },
      onError(error) {
        result.error = error;
      },
    }, {
      mergeProjects: true,
      mergeTestCases: true,
      resolvePath,
    });
    for (const message of report)
      void teleReceiver.dispatch(message);
    return result;
  }

  async listTests(locations: string[], reporter: reporterTypes.ReporterV2, token: ICancellationToken): Promise<void> {
    const { connection } = await this._testServer();
    if (token?.isCancellationRequested)
      return;
    if (!connection)
      return;
    // Locations are regular expressions.
    locations = locations.map(escapeRegex);
    const { report } = await connection.listTests({ locations });
    const teleReceiver = new TeleReporterReceiver(reporter, {
      mergeProjects: true,
      mergeTestCases: true,
      resolvePath,
    });
    for (const message of report)
      void teleReceiver.dispatch(message);
  }

  private _pipeStdio(testServer: TestServerConnection, reporter: reporterTypes.ReporterV2): Disposable {
    return testServer.onStdio(params => {
      if (params.type === 'stdout') {
        const output = unwrapString(params);
        reporter.onStdOut?.(output);
        this._onStdOut.fire(typeof output === 'string' ? output : output.toString());
      }
      if (params.type === 'stderr')
        reporter.onStdErr?.(unwrapString(params));
    });
  }

  async runGlobalHooks(type: 'setup' | 'teardown', testListener: reporterTypes.ReporterV2, token: ICancellationToken): Promise<'passed' | 'failed' | 'interrupted' | 'timedout'> {
    const { connection } = await this._testServer();
    if (!connection)
      return 'failed';
    return await this._runGlobalHooksInServer(connection, type, testListener, token, true);
  }

  private async _runGlobalHooksInServer(testServer: TestServerConnection, type: 'setup' | 'teardown', testListener: reporterTypes.ReporterV2, token: ICancellationToken, saveEnv: boolean): Promise<'passed' | 'failed' | 'interrupted' | 'timedout'> {
    const teleReceiver = new TeleReporterReceiver(testListener, {
      mergeProjects: true,
      mergeTestCases: true,
      resolvePath,
    });
    const piped = this._pipeStdio(testServer, testListener);

    try {
      if (type === 'setup' && (!this._config || this._config.globalSetup))
        testListener.onStdOut?.('\x1b[2mRunning global setup if any\u2026\x1b[0m\n');
      
      const result = await Promise.race([
        type === 'setup' ? testServer.runGlobalSetup({}) : testServer.runGlobalTeardown({}).then(result => ({ ...result, env: [] })),
        new Promise<{ status: 'interrupted', report: [] }>(f => token.onCancellationRequested(() => f({ status: 'interrupted', report: [] }))),
      ]);
      
      for (const message of result.report)
        void teleReceiver.dispatch(message);
      if (type === 'setup' && saveEnv && 'env' in result)
        this._globalSetupEnv = Object.fromEntries(result.env.map(([key, value]) => [key, value ?? undefined]));
      if (type === 'teardown' && saveEnv)
        this._globalSetupEnv = {};
      return result.status;
    } finally {
      piped.dispose();
    }
  }

  async startDevServer(): Promise<reporterTypes.FullResult['status']> {
    const { connection } = await this._testServer();
    if (!connection)
      return 'failed';
    const result = await connection.startDevServer({});
    return result.status;
  }

  async stopDevServer(): Promise<reporterTypes.FullResult['status']> {
    const { connection } = await this._testServer();
    if (!connection)
      return 'failed';
    const result = await connection.stopDevServer({});
    return result.status;
  }

  async clearCache(): Promise<void> {
    const { connection } = await this._testServer();
    await connection?.clearCache({});
  }

  async runTests(locations: string[] | null, testIds: string[] | undefined, runOptions: PlaywrightTestRunOptions, reporter: reporterTypes.ReporterV2, token: ICancellationToken): Promise<void> {
    const { connection } = await this._testServer();
    if (token?.isCancellationRequested)
      return;
    if (!connection)
      return;

    if (!locations && !testIds)
      return;

    // Locations are regular expressions.
    const locationPatterns = locations ? locations.map(escapeRegex) : undefined;
    const options: Parameters<TestServerInterface['runTests']>['0'] = {
      projects: this._model.enabledProjectsFilter(),
      locations: locationPatterns,
      testIds,
      ...runOptions,
    };

    const disposables: Disposable[] = [];
    const cancellationListener = token.onCancellationRequested(() => {
      connection.stopTestsNoReply({});
    });
    disposables.push(cancellationListener);

    this._wireTestServer(connection, reporter, token, disposables);

    try {
      await connection.runTests(options);
    } finally {
      for (const disposable of disposables)
        disposable.dispose();
    }
  }

  async watchFiles(fileNames: string[]): Promise<void> {
    const { connection } = await this._testServer();
    await connection?.watch({ fileNames });
  }

  async findRelatedTestFiles(files: string[]): Promise<ConfigFindRelatedTestFilesReport> {
    const testServer = await this._testServer();
    if (!testServer.connection)
      return { testFiles: files, errors: [{ message: 'Internal error: unable to connect to the test server' }] };
    return await testServer.connection.findRelatedTestFiles({ files });
  }

  private _testServer(): Promise<TestServerConnectionWrapper> {
    if (this._testServerPromise)
      return this._testServerPromise;
    this._testServerPromise = this._createTestServer();
    return this._testServerPromise;
  }

  private async _createTestServer(): Promise<TestServerConnectionWrapper> {
    const config = this._model.config;
    const errors: string[] = [];
    
    try {
      const connection = await this._serverFactory.createTestServer(config, {
        ...this._options.envProvider(config.configFile),
        FORCE_COLOR: '1',
        ELECTRON_RUN_AS_NODE: undefined,
      });

      if (!connection)
        return { connection: null, errors };

      connection.onTestFilesChanged(params => this._testFilesChanged(params.testFiles));
      await connection.initialize({
        serializer: require.resolve('../oopReporter'),
        interceptStdio: true,
        closeOnDisconnect: true,
      });
      return { connection, errors };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      this._testServerPromise = undefined;
      return { connection: null, errors };
    }
  }

  private _wireTestServer(testServer: TestServerConnection, reporter: reporterTypes.ReporterV2, token: ICancellationToken, disposables: Disposable[]): void {
    const teleReceiver = new TeleReporterReceiver(reporter, {
      mergeProjects: true,
      mergeTestCases: true,
      resolvePath,
    });
    
    const reportListener = testServer.onReport(message => {
      if (token.isCancellationRequested && message.method !== 'onEnd')
        return;
      void teleReceiver.dispatch(message);
    });
    disposables.push(reportListener);
    
    const stdioPiped = this._pipeStdio(testServer, reporter);
    disposables.push(stdioPiped);
  }

  private _testFilesChanged(testFiles: string[]): void {
    this._model.testFilesChanged(testFiles);
  }

  private _disposeTestServer(): void {
    const testServer = this._testServerPromise;
    this._testServerPromise = undefined;
    if (testServer)
      void testServer.then(server => server.connection?.close());
  }
}

function unwrapString(params: { text?: string, buffer?: string }): string | Buffer {
  return params.buffer ? Buffer.from(params.buffer, 'base64') : params.text || '';
}

function resolvePath(rootDir: string, relativePath: string) {
  return path.join(rootDir, relativePath);
}

type TestServerConnectionWrapper = {
  connection: TestServerConnection | null;
  errors: string[];
};
