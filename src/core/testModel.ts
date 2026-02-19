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

import * as reporterTypes from '../upstream/reporter';
import { Event, EventEmitter } from '../upstream/events';
import { DisposableBase } from '../disposableBase';
import { ILogger } from './logging';
import { ConfigListFilesReport, ProjectConfigWithFiles } from '../listTests';
import { TeleSuite } from '../upstream/teleReceiver';
import { MultiMap } from '../multimap';
import path from 'path';

export type TestConfig = {
  workspaceFolder: string;
  configFile: string;
  cli: string;
  version: number;
  testIdAttributeName?: string;
};

export type FileSystemChange = {
  created: Set<string>;
  changed: Set<string>;
  deleted: Set<string>;
};

export type TestProject = {
  model: TestModel;
  name: string;
  suite: reporterTypes.Suite;
  project: reporterTypes.FullProject;
};

export interface IRunHooks {
  onWillRunTests(config: TestConfig, debug: boolean): Promise<{ connectWsEndpoint?: string }>;
  onDidRunTests(): Promise<void>;
}

export interface ISettingsProvider {
  getConfigSettings(config: TestConfig): ConfigSettings | undefined;
  saveConfigSettings(configs: ConfigSettings[]): void;
}

export type ConfigSettings = {
  relativeConfigFile: string;
  projects: ProjectSettings[];
  enabled: boolean;
  selected: boolean;
};

export type ProjectSettings = {
  name: string;
  enabled: boolean;
};

const kIsEnabled = Symbol('isEnabled');

/**
 * Core framework-agnostic test model
 * Represents a Playwright test configuration and its projects
 */
export class TestModel extends DisposableBase {
  readonly config: TestConfig;
  private _projects = new Map<string, TestProject>();
  private _fileToSources: Map<string, string[]> = new Map();
  private _sourceToFile: Map<string, string> = new Map();
  private _errorByFile = new MultiMap<string, reporterTypes.TestError>();
  private _filesWithListedTests = new Set<string>();
  private _filesPendingListTests: {
    files: Set<string>,
    timer: NodeJS.Timeout,
    promise: Promise<void>,
    finishedCallback: () => void
  } | undefined;

  isEnabled = false;
  private _didUpdate = new EventEmitter<void>();
  readonly onUpdated: Event<void> = this._didUpdate.event;
  private _logger: ILogger;

  constructor(config: TestConfig, logger: ILogger) {
    super();
    this.config = config;
    this._logger = logger;
    this._disposables.push(this._didUpdate);
  }

  async _loadModelIfNeeded(configSettings: ConfigSettings | undefined): Promise<void> {
    if (!this.isEnabled)
      return;
    await this._listFiles();
    if (configSettings && configSettings.projects.length) {
      let firstProject = true;
      for (const project of this.projects()) {
        const projectSettings = configSettings.projects.find(p => p.name === project.name);
        if (projectSettings) {
          (project as any)[kIsEnabled] = projectSettings.enabled;
        } else if (firstProject) {
          (project as any)[kIsEnabled] = true;
        }
        firstProject = false;
      }
    } else {
      if (this.projects().length === 0)
        return;

      let foundFirstBrowserProject = false;
      for (const p of this.projects()) {
        if (isBogStandardBrowserProject(p.name)) {
          if (foundFirstBrowserProject) {
            (p as any)[kIsEnabled] = false;
          } else {
            (p as any)[kIsEnabled] = true;
            foundFirstBrowserProject = true;
          }
        } else {
          (p as any)[kIsEnabled] = true;
        }
      }
    }
  }

  dispose(): void {
    this.reset();
    super.dispose();
  }

  reset(): void {
    clearTimeout(this._filesPendingListTests?.timer);
    this._filesPendingListTests?.finishedCallback();
    delete this._filesPendingListTests;
    this._projects.clear();
    this._fileToSources.clear();
    this._sourceToFile.clear();
    this._errorByFile.clear();
  }

  projects(): TestProject[] {
    return [...this._projects.values()];
  }

  errors(): MultiMap<string, reporterTypes.TestError> {
    return this._errorByFile;
  }

  configErrors(): reporterTypes.TestError[] {
    return this._errorByFile.get(this.config.configFile);
  }

  projectMap(): Map<string, TestProject> {
    return this._projects;
  }

  testDirs(): string[] {
    return [...new Set([...this._projects.values()].map(p => p.project.testDir))];
  }

  isProjectEnabled(project: TestProject): boolean {
    if (this._projects.size < 2)
      return true;
    return (project as any)[kIsEnabled] ?? false;
  }

  enabledProjects(): TestProject[] {
    return [...this._projects.values()].filter(p => this.isProjectEnabled(p));
  }

  enabledProjectsFilter(): string[] {
    const allEnabled = !([...this._projects.values()].some(p => !this.isProjectEnabled(p)));
    if (allEnabled)
      return [];
    return this.enabledProjects().map(p => p.name);
  }

  enabledFiles(): Set<string> {
    const result = new Set<string>();
    for (const project of this.enabledProjects()) {
      for (const fileSuite of project.suite.suites)
        result.add(fileSuite.location!.file);
    }
    return result;
  }

  async _listFiles(): Promise<void> {
    this._filesWithListedTests.clear();
    let report: ConfigListFilesReport;
    
    try {
      // This will be overridden in derived classes or adapters
      report = await (this as any)._listFilesFromServer();
    } catch (error: any) {
      const message = error?.message || String(error);
      this._logger.error('Error listing files:', message);
      this._errorByFile.set(this.config.configFile, {
        message,
        location: undefined,
        value: undefined,
      });
      report = { projects: [], error: { message } };
    }

    if (report.error?.location) {
      const errorMessage = report.error.message || report.error.value || 'Unknown error';
      this._errorByFile.set(report.error.location.file, {
        message: errorMessage,
        location: report.error.location,
        value: report.error.value,
      });
    }

    // Resolve files to sources when using source maps.
    for (const project of report.projects) {
      for (const file of project.files) {
        const sources = await (this as any)._resolveSourceMap(file);
        this._fileToSources.set(file, sources);
        for (const source of sources)
          this._sourceToFile.set(source, file);
      }
    }

    const projectsToKeep = new Set<string>();
    for (const projectReport of report.projects) {
      const project = this._projects.get(projectReport.name) || this._createProject(projectReport);
      this._updateProjectFiles(project, projectReport);
      projectsToKeep.add(projectReport.name);
    }

    for (const projectName of this._projects.keys()) {
      if (!projectsToKeep.has(projectName))
        this._projects.delete(projectName);
    }

    this._didUpdate.fire();
  }

  private _createProject(projectReport: ProjectConfigWithFiles): TestProject {
    const projectSuite = new TeleSuite(projectReport.name, 'project');
    projectSuite._project = {
      dependencies: [],
      grep: '.*',
      grepInvert: null,
      metadata: {},
      name: projectReport.name,
      outputDir: '',
      repeatEach: 0,
      retries: 0,
      snapshotDir: '',
      testDir: projectReport.testDir,
      testIgnore: [],
      testMatch: '.*',
      timeout: 0,
      use: projectReport.use,
    };
    const project: TestProject = {
      model: this,
      name: projectReport.name,
      suite: projectSuite,
      project: projectSuite._project,
    };
    (project as any)[kIsEnabled] = false;
    this._projects.set(project.name, project);
    return project;
  }

  private _updateProjectFiles(project: TestProject, projectReport: ProjectConfigWithFiles): void {
    const filesToKeep = new Set<string>();
    const files = projectFiles(project);
    
    for (const file of projectReport.files) {
      let fileSuite = files.get(file);
      if (!fileSuite) {
        fileSuite = new TeleSuite(path.basename(file), 'file');
        fileSuite.location = { file, line: 0, column: 0 };
      }
      filesToKeep.add(file);
      files.set(file, fileSuite);
    }

    for (const file of files.keys()) {
      if (!filesToKeep.has(file))
        files.delete(file);
    }
    project.suite.suites = [...files.values()];
  }

  async handleWorkspaceChange(change: FileSystemChange): Promise<void> {
    const testDirs = [...new Set([...this._projects.values()].map(p => p.project.testDir))];

    const changed = this._mapFilesToSources(testDirs, change.changed);
    const created = this._mapFilesToSources(testDirs, change.created);
    const deleted = this._mapFilesToSources(testDirs, change.deleted);

    if (created.length || deleted.length)
      await this._listFiles();
    if (changed.length) {
      const changedWithListedTests = changed.filter(f => this._filesWithListedTests.has(f));
      for (const c of changedWithListedTests)
        this._filesWithListedTests.delete(c);
      await this.ensureTests(changedWithListedTests);
    }
  }

  testFilesChanged(testFiles: string[]): void {
    // This will be implemented in derived classes
  }

  async ensureTests(inputFiles: string[]): Promise<void> {
    const enabledFiles = this.enabledFiles();
    const filesToListTests = inputFiles.filter(f => enabledFiles.has(f) && !this._filesWithListedTests.has(f));
    if (!filesToListTests.length)
      return this._filesPendingListTests?.promise;

    for (const file of filesToListTests)
      this._filesWithListedTests.add(file);

    if (!this._filesPendingListTests) {
      let finishedCallback!: () => void;
      const promise = new Promise<void>(f => finishedCallback = f);
      const files = new Set<string>();

      const timer = setTimeout(async () => {
        delete this._filesPendingListTests;
        await this._listTests([...files]).catch(e => {
          if (!(e instanceof Error))
            console.log(e);
        });
        finishedCallback();
      }, 100);

      this._filesPendingListTests = {
        files,
        finishedCallback,
        promise,
        timer,
      };
    }

    for (const file of filesToListTests)
      this._filesPendingListTests.files.add(file);

    return this._filesPendingListTests.promise;
  }

  private async _listTests(files: string[]): Promise<void> {
    const errors: reporterTypes.TestError[] = [];
    // This will be overridden in derived classes
    this._updateProjects([], files, errors);
  }

  private _updateProjects(newProjectSuites: reporterTypes.Suite[], requestedFiles: string[], errors: reporterTypes.TestError[]): void {
    for (const requestedFile of requestedFiles)
      this._filesWithListedTests.add(requestedFile);
    for (const error of errors) {
      if (error.location?.file)
        this._errorByFile.set(error.location.file, error);
    }

    for (const [projectName, project] of this._projects) {
      const newSuite = newProjectSuites.find(s => s.title === projectName);
      if (newSuite) {
        project.suite.suites = newSuite.suites;
      }
    }
    this._didUpdate.fire();
  }

  updateFromRunningProjects(projectSuites: reporterTypes.Suite[]): void {
    for (const projectSuite of projectSuites) {
      const project = this._projects.get(projectSuite.title!);
      if (project)
        this._updateFromRunningProject(project, projectSuite);
    }
  }

  private _updateFromRunningProject(project: TestProject, projectSuite: reporterTypes.Suite): void {
    const files = projectFiles(project);
    for (const fileSuite of projectSuite.suites) {
      files.set(fileSuite.location!.file, fileSuite);
    }
    project.suite.suites = [...files.values()];
    this._didUpdate.fire();
  }

  private _mapFilesToSources(testDirs: string[], files: Set<string>): string[] {
    const result = new Set<string>();
    for (const file of files) {
      const isInTestDir = testDirs.some(dir => file.startsWith(dir));
      if (isInTestDir) {
        result.add(file);
      }
      const source = this._sourceToFile.get(file);
      if (source && !result.has(source))
        result.add(source);
    }
    return [...result];
  }

  /*
  narrowDownLocations(request: vscodeTypes.TestRunRequest): { locations: string[] | null, testIds?: string[], isSingleTest: boolean } {
    if (!request.include?.length)
      return { locations: [], isSingleTest: false };

    let hasPathItem = false;
    const locations = new Set<string>();
    const testIds: string[] = [];
    const enabledFiles = [...this.enabledFiles()];
    for (const item of request.include) {
      const treeItem = upstreamTreeItem(item);

      // test case might be imported in the .spec.ts file, so it has a different location.
      // comparisons with enabledFiles need to happen on the .spec.ts file level, so we walk up to it.
      let fileItem = treeItem;
      while (!(fileItem.kind === 'group' && (fileItem.subKind === 'file' || fileItem.subKind === 'folder')) && fileItem.parent)
        fileItem = fileItem.parent;
      const fileItemPath = fileItem.location.file + (fileItem.kind === 'group' && fileItem.subKind === 'folder' ? path.sep : '');
      if (!enabledFiles.some(file => file.startsWith(fileItemPath)))
        continue;

      locations.add(fileItemPath);
      const representsPath = treeItem.kind === 'group' && (treeItem.subKind === 'folder' || treeItem.subKind === 'file');
      if (representsPath)
        hasPathItem = true;
      else
        testIds.push(...collectTestIds(treeItem));
    }*/

  async _resolveSourceMap(file: string): Promise<string[]> {
    // Default implementation - override in adapters if needed
    return [file];
  }
}

export class TestModelCollection extends DisposableBase {
  private _models: TestModel[] = [];
  private _selectedConfigFile: string | undefined;
  private _didUpdate = new EventEmitter<void>();
  readonly onUpdated: Event<void> = this._didUpdate.event;
  private _settingsProvider: ISettingsProvider;
  private _logger: ILogger;

  constructor(settingsProvider: ISettingsProvider, logger: ILogger) {
    super();
    this._settingsProvider = settingsProvider;
    this._logger = logger;
    this._disposables.push(this._didUpdate);
  }

  setModelEnabled(configFile: string, enabled: boolean): void {
    const model = this._models.find(m => m.config.configFile === configFile);
    if (!model || model.isEnabled === enabled)
      return;
    
    model.isEnabled = enabled;
    this._saveSettings();
    model.reset();
    const configSettings = this._settingsProvider.getConfigSettings(model.config);
    void model._loadModelIfNeeded(configSettings).then(() => this._didUpdate.fire());
  }

  setProjectEnabled(configFile: string, name: string, enabled: boolean): void {
    const model = this._models.find(m => m.config.configFile === configFile);
    if (!model)
      return;
    const project = model.projectMap().get(name);
    if (!project)
      return;
    if ((project as any)[kIsEnabled] === enabled)
      return;
    (project as any)[kIsEnabled] = enabled;
    this._saveSettings();
    this._didUpdate.fire();
  }

  setAllProjectsEnabled(configFile: string, enabled: boolean): void {
    const model = this._models.find(m => m.config.configFile === configFile);
    if (!model)
      return;
    const projectsToUpdate = model.projects().filter(p => (p as any)[kIsEnabled] !== enabled);
    if (projectsToUpdate.length === 0)
      return;
    for (const project of projectsToUpdate)
      (project as any)[kIsEnabled] = enabled;
    this._saveSettings();
    this._didUpdate.fire();
  }

  testDirs(): Set<string> {
    const result = new Set<string>();
    for (const model of this._models) {
      for (const dir of model.testDirs())
        result.add(dir);
    }
    return result;
  }

  async createModel(config: TestConfig): Promise<TestModel> {
    const model = new TestModel(config, this._logger);
    this._models.push(model);
    const configSettings = this._settingsProvider.getConfigSettings(config);
    model.isEnabled = configSettings?.enabled || (this._models.length === 1 && !configSettings);
    await model._loadModelIfNeeded(configSettings);
    this._didUpdate.fire();
    return model;
  }

  _modelUpdated(): void {
    this._didUpdate.fire();
  }

  hasEnabledModels(): boolean {
    return this._models.some(m => m.isEnabled);
  }

  clear(): void {
    for (const model of this._models)
      model.dispose();
    this._models = [];
  }

  dispose(): void {
    this.clear();
    super.dispose();
  }

  enabledModels(): TestModel[] {
    return this._models.filter(m => m.isEnabled);
  }

  models(): TestModel[] {
    return this._models;
  }

  selectedModel(): TestModel | undefined {
    const enabledModels = this.enabledModels();
    if (!enabledModels.length) {
      this._selectedConfigFile = undefined;
      return undefined;
    }

    const model = enabledModels.find(m => m.config.configFile === this._selectedConfigFile);
    if (model)
      return model;
    this._selectedConfigFile = enabledModels[0].config.configFile;
    return enabledModels[0];
  }

  selectModel(configFile: string): void {
    this._selectedConfigFile = configFile;
    this._saveSettings();
    this._didUpdate.fire();
  }

  private _saveSettings(): void {
    const configs: ConfigSettings[] = [];
    for (const model of this._models) {
      configs.push({
        relativeConfigFile: path.relative(model.config.workspaceFolder, model.config.configFile),
        selected: model.config.configFile === this._selectedConfigFile,
        enabled: model.isEnabled,
        projects: model.projects().map(p => ({ name: p.name, enabled: (p as any)[kIsEnabled] ?? false })),
      });
    }
    this._settingsProvider.saveConfigSettings(configs);
  }
}

function projectFiles(project: TestProject): Map<string, reporterTypes.Suite> {
  const files = new Map<string, reporterTypes.Suite>();
  for (const fileSuite of project.suite.suites)
    files.set(fileSuite.location!.file, fileSuite);
  return files;
}

function isBogStandardBrowserProject(name: string): boolean {
  name = name.toLowerCase();
  return ['chromium', 'firefox', 'webkit', 'google chrome', 'chrome', 'microsoft edge', 'edge'].some(prefix => name.startsWith(prefix));
}
