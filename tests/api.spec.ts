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

import { expect, test } from './utils';

test('should expose PlaywrightAPI through activate', async ({ activate }) => {
  const { vscode } = await activate({
    'playwright.config.js': `module.exports = { testDir: 'tests' }`,
    'tests/test.spec.ts': `
      import { test } from '@playwright/test';
      test('one', async () => {});
    `,
  });

  // The activate function should return an API object
  const api = vscode.extensionExports;
  expect(api).toBeDefined();
  expect(api.getTestModelCollection).toBeDefined();
  expect(typeof api.getTestModelCollection).toBe('function');
});

test('should return TestModelCollection from API', async ({ activate }) => {
  const { vscode } = await activate({
    'playwright.config.js': `module.exports = { testDir: 'tests' }`,
    'tests/test.spec.ts': `
      import { test } from '@playwright/test';
      test('one', async () => {});
    `,
  });

  const api = vscode.extensionExports;
  const testModelCollection = api.getTestModelCollection();

  expect(testModelCollection).toBeDefined();
  expect(testModelCollection.models).toBeDefined();
  expect(testModelCollection.enabledModels).toBeDefined();
  expect(testModelCollection.selectedModel).toBeDefined();
  expect(testModelCollection.onUpdated).toBeDefined();
});

test('API should provide access to test models', async ({ activate }) => {
  const { vscode } = await activate({
    'playwright.config.js': `module.exports = { testDir: 'tests' }`,
    'tests/test.spec.ts': `
      import { test } from '@playwright/test';
      test('one', async () => {});
    `,
  });

  const api = vscode.extensionExports;
  const testModelCollection = api.getTestModelCollection();

  const models = testModelCollection.models();
  expect(models).toBeDefined();
  expect(Array.isArray(models)).toBe(true);
  expect(models.length).toBeGreaterThan(0);
});

test('API should provide access to enabled models', async ({ activate }) => {
  const { vscode } = await activate({
    'playwright.config.js': `module.exports = { testDir: 'tests' }`,
    'tests/test.spec.ts': `
      import { test } from '@playwright/test';
      test('one', async () => {});
    `,
  });

  const api = vscode.extensionExports;
  const testModelCollection = api.getTestModelCollection();

  const enabledModels = testModelCollection.enabledModels();
  expect(enabledModels).toBeDefined();
  expect(Array.isArray(enabledModels)).toBe(true);
});

test('API should provide access to selected model', async ({ activate }) => {
  const { vscode } = await activate({
    'playwright.config.js': `module.exports = { testDir: 'tests' }`,
    'tests/test.spec.ts': `
      import { test } from '@playwright/test';
      test('one', async () => {});
    `,
  });

  const api = vscode.extensionExports;
  const testModelCollection = api.getTestModelCollection();

  const selectedModel = testModelCollection.selectedModel();
  expect(selectedModel).toBeDefined();
  expect(selectedModel?.config).toBeDefined();
});

test('API should allow listening to updates', async ({ activate }) => {
  const { vscode } = await activate({
    'playwright.config.js': `module.exports = { testDir: 'tests' }`,
    'tests/test.spec.ts': `
      import { test } from '@playwright/test';
      test('one', async () => {});
    `,
  });

  const api = vscode.extensionExports;
  const testModelCollection = api.getTestModelCollection();

  let updateCount = 0;
  const disposable = testModelCollection.onUpdated(() => {
    updateCount++;
  });

  // Trigger an update by selecting a model
  const models = testModelCollection.models();
  if (models.length > 0) {
    testModelCollection.selectModel(models[0].config.configFile);

    // Wait a bit for the event to fire
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(updateCount).toBeGreaterThan(0);
  }

  disposable.dispose();
});

test('API should expose testDirs method', async ({ activate }) => {
  const { vscode } = await activate({
    'playwright.config.js': `module.exports = { testDir: 'tests' }`,
    'tests/test.spec.ts': `
      import { test } from '@playwright/test';
      test('one', async () => {});
    `,
  });

  const api = vscode.extensionExports;
  const testModelCollection = api.getTestModelCollection();

  const testDirs = testModelCollection.testDirs();
  expect(testDirs).toBeDefined();
  expect(testDirs instanceof Set).toBe(true);
});

test('API should expose versions method', async ({ activate }) => {
  const { vscode } = await activate({
    'playwright.config.js': `module.exports = { testDir: 'tests' }`,
    'tests/test.spec.ts': `
      import { test } from '@playwright/test';
      test('one', async () => {});
    `,
  });

  const api = vscode.extensionExports;
  const testModelCollection = api.getTestModelCollection();

  const versions = testModelCollection.versions();
  expect(versions).toBeDefined();
  expect(versions instanceof Map).toBe(true);
});
