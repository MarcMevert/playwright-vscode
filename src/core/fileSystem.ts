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

import { Event, Disposable } from '../upstream/events';

/**
 * Framework-agnostic file system abstraction
 */

export interface IFileSystemWatcher extends Disposable {
  readonly onDidCreate: Event<string>;
  readonly onDidChange: Event<string>;
  readonly onDidDelete: Event<string>;
}

export interface IFileSystemWatcherFactory {
  createFileSystemWatcher(pattern: string): IFileSystemWatcher;
}

export type FileSystemChange = {
  created: Set<string>;
  changed: Set<string>;
  deleted: Set<string>;
};

export interface IFileSystemObserver extends Disposable {
  setPatterns(patterns: Set<string>): void;
  onDidChange: Event<FileSystemChange>;
}
