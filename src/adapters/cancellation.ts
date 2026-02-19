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

import * as vscodeTypes from '../vscodeTypes';
import { ICancellationToken } from '../core/cancellation';
import { vscodeEventToCore } from './eventAdapter';

/**
 * VS Code cancellation token adapter
 */
export function vscodeTokenToCore(token: vscodeTypes.CancellationToken): ICancellationToken {
  return {
    isCancellationRequested: token.isCancellationRequested,
    onCancellationRequested: vscodeEventToCore(token.onCancellationRequested),
  };
}

export function coreCancellationTokenToVSCode(token: ICancellationToken): vscodeTypes.CancellationToken {
  return {
    isCancellationRequested: token.isCancellationRequested,
    onCancellationRequested: (listener) => {
      const disposable = token.onCancellationRequested(listener);
      return { dispose: () => disposable.dispose() } as vscodeTypes.Disposable;
    },
  };
}
