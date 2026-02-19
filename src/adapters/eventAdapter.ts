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
import { Disposable, Event } from '../upstream/events';

/**
 * Adapters to bridge between core abstractions and VS Code APIs
 */

export function vscodeEventToCore<T>(vsCodeEvent: vscodeTypes.Event<T>): Event<T> {
  return (listener, disposables?: Disposable[]) => {
    const disposable = vscodeDisposableToCore(vsCodeEvent(listener));
    if (disposables)
      disposables.push(disposable);
    return disposable;
  };
}

export function coreEventToVSCode<T>(coreEvent: Event<T>): vscodeTypes.Event<T> {
  return listener => {
    return coreDisposableToVSCode(coreEvent(listener));
  };
}

export function coreDisposableToVSCode(coreDisposable: Disposable): vscodeTypes.Disposable {
  return { dispose: () => coreDisposable.dispose() };
}

export function vscodeDisposableToCore(vsCodeDisposable: vscodeTypes.Disposable): Disposable {
  return { dispose: () => vsCodeDisposable.dispose() };
}
