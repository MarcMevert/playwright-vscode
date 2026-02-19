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
import { ConfigSettings } from '../core/settings';
import { ISettingsProvider, TestConfig } from '../core/testModel';

const workspaceStateKey = 'pw.workspace-settings';

/**
 * VS Code settings provider adapter
 */
export class VSCodeSettingsProvider implements ISettingsProvider {
  private _vscode: vscodeTypes.VSCode;
  private _context: vscodeTypes.ExtensionContext;

  constructor(vscode: vscodeTypes.VSCode, context: vscodeTypes.ExtensionContext) {
    this._vscode = vscode;
    this._context = context;
  }

  getConfigSettings(config: TestConfig): ConfigSettings | undefined {
    const workspaceSettings = this._context.workspaceState.get<any>(workspaceStateKey);
    if (!workspaceSettings?.configs)
      return undefined;

    const relativeConfigFile = path.relative(config.workspaceFolder, config.configFile);
    return workspaceSettings.configs.find((c: ConfigSettings) => c.relativeConfigFile === relativeConfigFile);
  }

  saveConfigSettings(configs: ConfigSettings[]): void {
    void this._context.workspaceState.update(workspaceStateKey, { configs });
  }
}
