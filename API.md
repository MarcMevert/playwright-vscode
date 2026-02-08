# Playwright VSCode Extension API

The Playwright Test for VSCode extension exposes a public API that allows other extensions to interact with it programmatically.

## Installation

To use the API in your extension, first get a reference to the Playwright extension:

```typescript
import * as vscode from 'vscode';

// Get the Playwright extension
const playwrightExtension = vscode.extensions.getExtension('ms-playwright.playwright');

if (!playwrightExtension) {
  console.error('Playwright extension is not installed');
  return;
}

// Activate the extension if not already active
const api = await playwrightExtension.activate();
```

## API Reference

### `PlaywrightAPI`

The main API object returned by the extension's `activate()` function.

#### Methods

##### `getTestModelCollection(): TestModelCollection | undefined`

Returns the `TestModelCollection` instance that manages all Playwright test configurations.

**Returns:** The `TestModelCollection` instance, or `undefined` if not yet initialized.

**Example:**

```typescript
const api = await playwrightExtension.activate();
const testModelCollection = api.getTestModelCollection();

if (testModelCollection) {
  // Get all test models
  const models = testModelCollection.models();
  console.log(`Found ${models.length} Playwright configurations`);

  // Get only enabled models
  const enabledModels = testModelCollection.enabledModels();
  console.log(`${enabledModels.length} configurations are enabled`);

  // Get the currently selected model
  const selectedModel = testModelCollection.selectedModel();
  if (selectedModel) {
    console.log(`Selected config: ${selectedModel.config.configFile}`);
  }

  // Listen for updates
  testModelCollection.onUpdated(() => {
    console.log('Test model collection was updated');
  });
}
```

### `TestModelCollection`

Manages all Playwright test models (configurations) in the workspace.

#### Properties

- `vscode: VSCode` - Reference to the VSCode API
- `embedder: TestModelEmbedder` - Extension context and configuration
- `onUpdated: Event<void>` - Event fired when the collection state changes

#### Methods

##### `models(): TestModel[]`

Returns all test models in the collection.

##### `enabledModels(): TestModel[]`

Returns only the enabled test models.

##### `selectedModel(): TestModel | undefined`

Returns the currently selected test model.

##### `selectModel(configFile: string): void`

Changes the currently selected model.

**Parameters:**
- `configFile` - Path to the configuration file of the model to select

##### `setModelEnabled(configFile: string, enabled: boolean, userGesture?: boolean): void`

Enables or disables a test model.

**Parameters:**
- `configFile` - Path to the configuration file
- `enabled` - Whether to enable or disable the model
- `userGesture` - Optional. If true, saves the setting persistently

##### `setProjectEnabled(configFile: string, name: string, enabled: boolean): void`

Enables or disables a specific project within a test model.

**Parameters:**
- `configFile` - Path to the configuration file
- `name` - Name of the project
- `enabled` - Whether to enable or disable the project

##### `testDirs(): Set<string>`

Returns all test directories from all models.

##### `versions(): Map<number, TestModel>`

Returns a map of Playwright versions to their test models.

## Complete Example

```typescript
import * as vscode from 'vscode';

async function usePlaywrightAPI() {
  // Get and activate the Playwright extension
  const playwrightExtension = vscode.extensions.getExtension('ms-playwright.playwright');
  
  if (!playwrightExtension) {
    vscode.window.showErrorMessage('Playwright extension is not installed');
    return;
  }

  const api = await playwrightExtension.activate();
  const testModelCollection = api.getTestModelCollection();

  if (!testModelCollection) {
    vscode.window.showWarningMessage('Playwright test models not yet initialized');
    return;
  }

  // List all configurations
  const models = testModelCollection.models();
  console.log(`Found ${models.length} Playwright configurations:`);
  
  for (const model of models) {
    console.log(`  - ${model.config.configFile} (enabled: ${model.isEnabled})`);
    const projects = model.projects();
    console.log(`    Projects: ${projects.length}`);
  }

  // Watch for changes
  const disposable = testModelCollection.onUpdated(() => {
    console.log('Test collection updated!');
    const selectedModel = testModelCollection.selectedModel();
    if (selectedModel) {
      console.log(`Current selection: ${selectedModel.config.configFile}`);
    }
  });

  // Don't forget to dispose when done
  // disposable.dispose();
}
```

## Type Definitions

For TypeScript users, you can import the API types:

```typescript
import type { PlaywrightAPI, TestModelCollection } from 'playwright-vscode/out/api';
```

Note: Make sure to add the Playwright extension as a dependency in your `package.json`:

```json
{
  "extensionDependencies": [
    "ms-playwright.playwright"
  ]
}
```

## Version Compatibility

This API is available from version 1.1.17 and onwards of the Playwright Test for VSCode extension.
