type StorageChanges = Record<string, chrome.storage.StorageChange>;

const ext =
  (globalThis as unknown as { browser?: any; chrome?: any }).browser ||
  (globalThis as unknown as { chrome?: any }).chrome;
const useBrowser =
  typeof (globalThis as unknown as { browser?: any }).browser !== "undefined";

export function storageLocalGet(keys: string[]): Promise<Record<string, unknown>> {
  if (!ext?.storage?.local?.get) return Promise.resolve({});
  if (useBrowser) return ext.storage.local.get(keys) as Promise<Record<string, unknown>>;
  return new Promise((resolve) => {
    ext.storage.local.get(keys, (result: Record<string, unknown>) => resolve(result));
  });
}

export function storageLocalSet(items: Record<string, unknown>): Promise<void> {
  if (!ext?.storage?.local?.set) return Promise.resolve();
  if (useBrowser) return ext.storage.local.set(items) as Promise<void>;
  return new Promise((resolve) => {
    ext.storage.local.set(items, () => resolve());
  });
}

export function tabsQuery(query: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
  if (!ext?.tabs?.query) return Promise.resolve([]);
  if (useBrowser) return ext.tabs.query(query) as Promise<chrome.tabs.Tab[]>;
  return new Promise((resolve) => {
    ext.tabs.query(query, (tabs: chrome.tabs.Tab[]) => resolve(tabs));
  });
}

export function storageOnChangedAddListener(
  listener: (changes: StorageChanges, areaName: string) => void
): void {
  if (!ext?.storage?.onChanged?.addListener) return;
  ext.storage.onChanged.addListener(listener);
}

