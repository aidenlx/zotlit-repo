export interface OpenDocuments {
  paths(): ReadonlySet<string>;
  subscribe(changed: () => void): Disposable;
}
