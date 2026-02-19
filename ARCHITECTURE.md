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

# Playwright Test Server - Architecture Refactoring

## Overview

The source code has been refactored to remove dependencies on VS Code extension development APIs and create a modular, framework-agnostic architecture. This enables the `PlaywrightTestServer` and related components to be used as standalone libraries in any environment.

## Architecture

### Three-Layer Architecture

```
┌──────────────────────────────────────────┐
│   VS Code Extension (extension.ts)       │  - VS Code specific UI logic
│   VS Code Views (settingsView, etc.)     │  - WebViews, Commands, Decorations
└──────────────────────────────────────────┘
              ↑        ↑
              │ uses   │
              ↓        ↓
┌──────────────────────────────────────────┐
│   Adapter Layer (/src/adapters)          │  - VS Code →  Core bridges
│  - VSCodeSettingsProvider                │  - Event adapters
│  - VSCodeFileSystemObserver              │  - Logger adapter
│  - VSCodeTestServerFactory               │  - Cancellation adapter
└──────────────────────────────────────────┘
              ↑        ↑
              │ uses   │
              ↓        ↓
┌──────────────────────────────────────────┐
│   Core Layer (/src/core)                 │  - Framework-agnostic
│  - TestModel                             │  - Uses only core abstractions
│  - TestModelCollection                   │  - PlaywrightTestServer
│  - PlaywrightTestServer                  │  - Pure data & logic
│  - Abstract Interfaces                   │
│    * IEvent / EventEmitter               │
│    * ICancellationToken                  │
│    * IFileSystemObserver                 │
│    * ISettingsProvider                   │
│    * ITestServerFactory                  │
│    * ILogger                             │
└──────────────────────────────────────────┘
              ↑        ↑
              │ uses   │
              ↓        ↓
┌──────────────────────────────────────────┐
│   Upstream Layer                         │  - Playwright protocol
│  - TestServerConnection                  │  - Reporter types
│  - Test communication                    │
└──────────────────────────────────────────┘
```

## Core Modules

### 1. Event System (`/src/core/event.ts`)

**Purpose**: Framework-agnostic event/observer pattern

```typescript
interface IEvent<T> {
  listen(listener: (value: T) => void): () => void;  // Returns unsubscribe fn
  once(listener: (value: T) => void): () => void;
}

interface IEventEmitter<T> extends IEvent<T> {
  fire(value: T): void;
}

class EventEmitter<T> implements IEventEmitter<T> { }
```

**Features**:
- No framework dependency
- Listener management
- One-time subscriptions
- Error handling in listeners

---

### 2. Cancellation Token (`/src/core/cancellation.ts`)

**Purpose**: Framework-agnostic async cancellation

```typescript
interface ICancellationToken {
  isCancellationRequested: boolean;
  onCancellationRequested: IEvent<void>;
}

interface ICancellationTokenSource {
  token: ICancellationToken;
  cancel(): void;
}
```

**Usage**:
```typescript
const source = new CancellationTokenSource();
// Pass source.token to async operations
source.cancel();  // Cancel all operations
```

---

### 3. File System Observer (`/src/core/fileSystem.ts`)

**Purpose**: Framework-agnostic file system watching

```typescript
interface IFileSystemObserver extends IDisposable {
  setPatterns(patterns: Set<string>): void;
  onDidChange: IEvent<FileSystemChange>;
}

type FileSystemChange = {
  created: Set<string>;
  changed: Set<string>;
  deleted: Set<string>;
};
```

**VS Code Implementation**: `VSCodeFileSystemObserver` (`/src/adapters/fileSystemObserver.ts`)

---

### 4. Logging (`/src/core/logging.ts`)

**Purpose**: Framework-agnostic logging interface

```typescript
interface ILogger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}
```

**Implementations**:
- `ConsoleLogger`: Uses console
- `NoOpLogger`: Silent
- `VSCodeLoggerAdapter`: Uses VS Code OutputChannel

---

### 5. Settings & Persistence (`/src/core/settings.ts`)

**Purpose**: Framework-agnostic settings storage

```typescript
interface ISetting<T> extends IDisposable {
  onChange: IEvent<T>;
  get(): T | undefined;
  set(value: T): Promise<void>;
}

interface ISettingsProvider {
  getConfigSettings(config: TestConfig): ConfigSettings | undefined;
  saveConfigSettings(configs: ConfigSettings[]): void;
}
```

**VS Code Implementation**: `VSCodeSettingsProvider` (`/src/adapters/settingsProvider.ts`)

---

### 6. Test Model (`/src/core/testModel.ts`)

**Purpose**: Core test configuration and project management

```typescript
class TestModel extends DisposableBase {
  config: TestConfig;
  projects(): TestProject[];
  enabledProjects(): TestProject[];
  enabledFiles(): Set<string>;
  async _loadModelIfNeeded(configSettings?: ConfigSettings): Promise<void>;
  async handleWorkspaceChange(change: FileSystemChange): Promise<void>;
  narrowDownLocations(locations?: string[], testIds?: string[]): { locations, testIds, isSingleTest };
}

class TestModelCollection extends DisposableBase {
  async createModel(config: TestConfig): Promise<TestModel>;
  setModelEnabled(configFile: string, enabled: boolean): void;
  setProjectEnabled(configFile: string, name: string, enabled: boolean): void;
  models(): TestModel[];
  enabledModels(): TestModel[];
}
```

**Features**:
- No VS Code dependencies
- Manages multiple test configs
- Project enable/disable logic
- File tracking and source maps
- Configuration persistence

---

### 7. Playwright Test Server (`/src/core/playwrightTestServer.ts`)

**Purpose**: Framework-agnostic interface to Playwright test server

```typescript
class PlaywrightTestServer extends DisposableBase {
  async listFiles(): Promise<ConfigListFilesReport>;
  async listTests(locations: string[], reporter, token): Promise<void>;
  async runTests(locations, testIds, options, reporter, token): Promise<void>;
  async runGlobalHooks(type, listener, token): Promise<'passed' | 'failed'>;
  async startDevServer(): Promise<'passed' | 'failed'>;
  async stopDevServer(): Promise<'passed' | 'failed'>;
  async watchFiles(fileNames: string[]): Promise<void>;
  async findRelatedTestFiles(files: string[]): Promise<ConfigFindRelatedTestFilesReport>;
}
```

**Dependencies**:
- Uses `ITestServerFactory` for creating test server connections
- Uses `ICancellationToken` for cancellation
- Uses `ILogger` for logging
- Expects `TestModel` with configuration

---

## Adapter Layer (`/src/adapters`)

Bridges core abstractions with VS Code APIs:

### Event Adapter (`eventAdapter.ts`)
```typescript
vscodeEventToCore<T>(vsCodeEvent): IEvent<T>
coreEventToVSCode<T>(coreEvent): vscode.Event<T>
```

### Cancellation Adapter (`cancellation.ts`)
```typescript
vscodeTokenToCore(token): ICancellationToken
coreCancellationTokenToVSCode(token): vscode.CancellationToken
```

### File System Observer (`fileSystemObserver.ts`)
```typescript
class VSCodeFileSystemObserver implements IFileSystemObserver
```

### Settings Provider (`settingsProvider.ts`)
```typescript
class VSCodeSettingsProvider implements ISettingsProvider
```

### Logger (`logger.ts`)
```typescript
class VSCodeLoggerAdapter implements ILogger
```

### Test Server Factory (`testServerFactory.ts`)
```typescript
class VSCodeTestServerFactory implements ITestServerFactory
```

---

## Usage Examples

### Example 1: Using Core in Non-VS Code Environment

```typescript
import { TestModel, TestModelCollection, EventEmitter, ConsoleLogger } from './core';

// Create settings provider implementation
const settingsProvider = {
  getConfigSettings: (config) => fs.readJsonSync(`config/${config.configFile}`),
  saveConfigSettings: (configs) => fs.writeJsonSync('config.json', configs),
};

// Create collection
const logger = new ConsoleLogger();
const collection = new TestModelCollection(settingsProvider, logger);

// Create test model
const model = await collection.createModel({
  workspaceFolder: '/path/to/project',
  configFile: '/path/to/playwright.config.ts',
  cli: '/path/to/npx',
  version: 1.40,
});

// Listen to updates
model.onUpdated.listen(() => {
  console.log('Model updated!');
  console.log('Projects:', model.projects().map(p => p.name));
});

// Handle file changes
await model.handleWorkspaceChange({
  created: new Set(['/path/to/new.test.ts']),
  changed: new Set(['/path/to/modified.test.ts']),
  deleted: new Set(),
});
```

### Example 2: Using PlaywrightTestServer Directly

```typescript
import { PlaywrightTestServer, CancellationTokenSource } from './core';
import { VSCodeTestServerFactory } from './adapters';

const serverFactory = new VSCodeTestServerFactory(vscode, logger);
const server = new PlaywrightTestServer(model, options, serverFactory);

const cancellation = new CancellationTokenSource();

// List files
const files = await server.listFiles();

// Run tests
await server.runTests(
  locations,
  testIds,
  { workers: 4, trace: 'on' },
  reporter,
  cancellation.token
);

// Cancel if needed
cancellation.cancel();
```

### Example 3: Integration with VS Code

```typescript
import { VSCodeSettingsProvider, VSCodeFileSystemObserver, VSCodeTestServerFactory, VSCodeLoggerAdapter } from './adapters';
import { TestModel, TestModelCollection } from './core';

// Create VS Code adapters
const settingsProvider = new VSCodeSettingsProvider(vscode, extensionContext);
const fsObserver = new VSCodeFileSystemObserver(vscode, handleChange, isUnderTest);
const serverFactory = new VSCodeTestServerFactory(vscode, logger);
const loggerAdapter = new VSCodeLoggerAdapter(outputChannel);

// Use core with VS Code
const collection = new TestModelCollection(settingsProvider, loggerAdapter);
const model = await collection.createModel(config);

// Connect file system observer
fsObserver.setPatterns(new Set(['**/*.test.ts']));
fsObserver.onDidChange.listen(change => {
  model.handleWorkspaceChange(change);
});
```

---

## Migration Guide

### For VS Code Extension

The existing VS Code extension code should:

1. **Replace direct imports** from `./testModel` with adapters:
   ```typescript
   // Old
   import { TestModel } from './testModel';
   
   // New - via adapter
   import { TestModel } from './core';
   import { VSCodeSettingsProvider } from './adapters';
   ```

2. **Create adapters during initialization**:
   ```typescript
   const settingsProvider = new VSCodeSettingsProvider(vscode, context);
   const fsObserver = new VSCodeFileSystemObserver(vscode, handleChange, isUnderTest);
   const collection = new TestModelCollection(settingsProvider, logger);
   ```

3. **Use token adapters for cancellation**:
   ```typescript
   // Old - direct token
   await server.runTests(request, options, reporter, token);
   
   // New - adapted token
   const coreToken = vscodeTokenToCore(token);
   await server.runTests(locations, testIds, options, reporter, coreToken);
   ```

---

## Benefits of This Architecture

1. **Modularity**: Core modules can be used independently
2. **Testability**: Core logic can be tested without VS Code
3. **Reusability**: Other IDEs (VS, WebStorm, Emacs, etc.) can use same core
4. **Maintainability**: Clear separation of concerns
5. **Framework-agnostic**: No lock-in to VS Code APIs
6. **Type Safety**: Full TypeScript support
7. **Event System**: Consistent, predictable async patterns

---

## Directory Structure

```
src/
├── core/                          # Framework-agnostic core
│   ├── index.ts                   # Main exports
│   ├── event.ts                   # Event system
│   ├── cancellation.ts            # Cancellation tokens
│   ├── fileSystem.ts              # File system abstraction
│   ├── logging.ts                 # Logger interface
│   ├── settings.ts                # Settings abstraction
│   ├── testModel.ts               # Test model & collection
│   └── playwrightTestServer.ts    # Test server (no VS Code deps)
│
├── adapters/                      # VS Code adapter implementations
│   ├── index.ts                   # Main exports
│   ├── eventAdapter.ts            # Event↔IEvent bridge
│   ├── cancellation.ts            # Token→IToken bridge
│   ├── fileSystemObserver.ts      # VS Code file watcher
│   ├── logger.ts                  # VS Code logger wrapper
│   ├── settingsProvider.ts        # VS Code settings storage
│   └── testServerFactory.ts       # VS Code test server factory
│
├── extension.ts                   # VS Code extension entry
├── testTree.ts                    # VS Code test tree (exists as-is)
├── settingsView.ts                # VS Code settings UI
├── locatorsView.ts                # VS Code locators UI
├── workspaceObserver.ts           # Legacy (use VSCodeFileSystemObserver)
│
└── upstream/                      # Playwright protocol (unchanged)
    ├── reporter.d.ts
    ├── teleReceiver.ts
    ├── testServerConnection.ts
    └── ...
```

---

## Testing

Core modules can be tested without VS Code:

```typescript
// test/core/testModel.spec.ts
import { TestModel, ConsoleLogger } from '../../src/core';

const logger = new ConsoleLogger();
const model = new TestModel(config, logger);

// Test without any VS Code dependencies
expect(model.projects()).toHaveLength(1);
```

---

## Future Work

1. Create CLI tool using core library
2. Create language server using core library
3. Publish core as separate npm package
4. Create integrations for other IDEs
5. Add plugin system for test reporters

---

## Conclusion

The refactored architecture provides a clean separation between the test framework-agnostic core logic and VS Code-specific UI integration. This makes the Playwright test server usable in any Node.js environment while maintaining full VS Code extension functionality.
