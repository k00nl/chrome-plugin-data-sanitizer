type StorageChanges = Record<string, chrome.storage.StorageChange>;

const ext =
  (globalThis as unknown as { browser?: any; chrome?: any }).browser ||
  (globalThis as unknown as { chrome?: any }).chrome;
const useBrowser =
  typeof (globalThis as unknown as { browser?: any }).browser !== "undefined";

// Na een extensie-update of -herlaad draait een oud content-script door in de
// pagina met een ongeldige context. Elke chrome.* call gooit dan
// "Extension context invalidated". Hiermee checken we dat vooraf.
export function isExtensionContextValid(): boolean {
  try {
    return !!ext?.runtime?.id;
  } catch {
    return false;
  }
}

export function storageLocalGet(keys: string[]): Promise<Record<string, unknown>> {
  if (!isExtensionContextValid() || !ext?.storage?.local?.get) {
    return Promise.resolve({});
  }
  try {
    if (useBrowser) {
      return (ext.storage.local.get(keys) as Promise<Record<string, unknown>>).catch(
        () => ({})
      );
    }
    return new Promise((resolve) => {
      ext.storage.local.get(keys, (result: Record<string, unknown>) => {
        void ext.runtime?.lastError;
        resolve(result || {});
      });
    });
  } catch {
    return Promise.resolve({});
  }
}

export function storageLocalSet(items: Record<string, unknown>): Promise<void> {
  if (!isExtensionContextValid() || !ext?.storage?.local?.set) {
    return Promise.resolve();
  }
  try {
    if (useBrowser) {
      return (ext.storage.local.set(items) as Promise<void>).catch(() => undefined);
    }
    return new Promise((resolve) => {
      ext.storage.local.set(items, () => {
        void ext.runtime?.lastError;
        resolve();
      });
    });
  } catch {
    return Promise.resolve();
  }
}

export function tabsQuery(query: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
  if (!isExtensionContextValid() || !ext?.tabs?.query) return Promise.resolve([]);
  try {
    if (useBrowser) {
      return (ext.tabs.query(query) as Promise<chrome.tabs.Tab[]>).catch(() => []);
    }
    return new Promise((resolve) => {
      ext.tabs.query(query, (tabs: chrome.tabs.Tab[]) => {
        void ext.runtime?.lastError;
        resolve(tabs || []);
      });
    });
  } catch {
    return Promise.resolve([]);
  }
}

export function tabsSendMessage(tabId: number, message: unknown): Promise<void> {
  if (!isExtensionContextValid() || !ext?.tabs?.sendMessage) return Promise.resolve();
  try {
    if (useBrowser) {
      return Promise.resolve(ext.tabs.sendMessage(tabId, message)).then(
        () => undefined,
        () => undefined
      );
    }
    return new Promise((resolve) => {
      ext.tabs.sendMessage(tabId, message, () => {
        // lastError is verwacht als er geen content-script luistert (chrome://).
        void ext.runtime?.lastError;
        resolve();
      });
    });
  } catch {
    return Promise.resolve();
  }
}

export function runtimeOnMessageAddListener(
  listener: (message: any) => void
): void {
  if (!isExtensionContextValid() || !ext?.runtime?.onMessage?.addListener) return;
  try {
    ext.runtime.onMessage.addListener((message: unknown) => {
      listener(message);
      return undefined;
    });
  } catch {
    // niets te doen
  }
}

export function storageOnChangedAddListener(
  listener: (changes: StorageChanges, areaName: string) => void
): void {
  if (!isExtensionContextValid() || !ext?.storage?.onChanged?.addListener) return;
  try {
    ext.storage.onChanged.addListener(listener);
  } catch {
    // niets te doen
  }
}

export function runtimeGetURL(path: string): string {
  try {
    if (ext?.runtime?.getURL) return ext.runtime.getURL(path) as string;
  } catch {
    // val terug op het pad
  }
  return path;
}
