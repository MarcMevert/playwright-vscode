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

import { Event, EventEmitter } from '../upstream/events';

/**
 * Framework-agnostic cancellation token abstraction
 */

export interface ICancellationToken {
  readonly isCancellationRequested: boolean;
  onCancellationRequested: Event<void>;
}

export interface ICancellationTokenSource {
  readonly token: ICancellationToken;
  cancel(): void;
  dispose(): void;
}

export class CancellationTokenSource implements ICancellationTokenSource {
  private _isCancelled = false;
  private _emitter = new EventEmitter<void>();
  
  readonly token: ICancellationToken = {
    isCancellationRequested: this._isCancelled,
    onCancellationRequested: this._emitter.event,
  };

  cancel(): void {
    if (this._isCancelled) return;
    
    this._isCancelled = true;
    (this.token as any).isCancellationRequested = true;
    this._emitter.fire();
  }

  dispose(): void {
    this._emitter.dispose();
  }
}

export const CancellationToken = {
  None: {
    isCancellationRequested: false,
    onCancellationRequested: new EventEmitter<void>().event,
  } as ICancellationToken,
};
