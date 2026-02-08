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

import type { TestModelCollection } from './testModel';

/**
 * Public API for the Playwright Test for VSCode extension.
 * This API can be used by other extensions to interact with the Playwright extension.
 */
export interface PlaywrightAPI {
  /**
   * Returns the TestModelCollection instance that manages all Playwright test configurations.
   * The TestModelCollection provides access to test models, projects, and their state.
   *
   * @returns The TestModelCollection instance, or undefined if not yet initialized.
   */
  getTestModelCollection(): TestModelCollection | undefined;
}

// Re-export TestModelCollection type for external consumers
export type { TestModelCollection } from './testModel';
