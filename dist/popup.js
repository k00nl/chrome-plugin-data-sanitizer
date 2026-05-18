"use strict";
(() => {
  // src/extension.ts
  var ext = globalThis.browser || globalThis.chrome;
  var useBrowser = typeof globalThis.browser !== "undefined";
  function isExtensionContextValid() {
    try {
      return !!ext?.runtime?.id;
    } catch {
      return false;
    }
  }
  function storageLocalGet(keys) {
    if (!isExtensionContextValid() || !ext?.storage?.local?.get) {
      return Promise.resolve({});
    }
    try {
      if (useBrowser) {
        return ext.storage.local.get(keys).catch(
          () => ({})
        );
      }
      return new Promise((resolve) => {
        ext.storage.local.get(keys, (result) => {
          void ext.runtime?.lastError;
          resolve(result || {});
        });
      });
    } catch {
      return Promise.resolve({});
    }
  }
  function storageLocalSet(items) {
    if (!isExtensionContextValid() || !ext?.storage?.local?.set) {
      return Promise.resolve();
    }
    try {
      if (useBrowser) {
        return ext.storage.local.set(items).catch(() => void 0);
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
  function tabsQuery(query) {
    if (!isExtensionContextValid() || !ext?.tabs?.query) return Promise.resolve([]);
    try {
      if (useBrowser) {
        return ext.tabs.query(query).catch(() => []);
      }
      return new Promise((resolve) => {
        ext.tabs.query(query, (tabs) => {
          void ext.runtime?.lastError;
          resolve(tabs || []);
        });
      });
    } catch {
      return Promise.resolve([]);
    }
  }
  function tabsSendMessage(tabId, message) {
    if (!isExtensionContextValid() || !ext?.tabs?.sendMessage) return Promise.resolve();
    try {
      if (useBrowser) {
        return Promise.resolve(ext.tabs.sendMessage(tabId, message)).then(
          () => void 0,
          () => void 0
        );
      }
      return new Promise((resolve) => {
        ext.tabs.sendMessage(tabId, message, () => {
          void ext.runtime?.lastError;
          resolve();
        });
      });
    } catch {
      return Promise.resolve();
    }
  }
  function storageOnChangedAddListener(listener) {
    if (!isExtensionContextValid() || !ext?.storage?.onChanged?.addListener) return;
    try {
      ext.storage.onChanged.addListener(listener);
    } catch {
    }
  }

  // src/popup.ts
  var STORAGE_KEY = "disabledHosts";
  var COUNT_KEY = "sanitizedCount";
  function getActiveTab() {
    return tabsQuery({ active: true, currentWindow: true }).then((tabs) => tabs[0] || null);
  }
  async function getDisabledHosts() {
    const result = await storageLocalGet([STORAGE_KEY]);
    return result[STORAGE_KEY] || {};
  }
  async function setHostEnabled(host, enabled) {
    const disabledHosts = await getDisabledHosts();
    if (enabled) {
      delete disabledHosts[host];
    } else {
      disabledHosts[host] = true;
    }
    await storageLocalSet({ [STORAGE_KEY]: disabledHosts });
  }
  function setStatus(text) {
    const el = document.getElementById("status");
    if (el) el.textContent = text;
  }
  function setCount(count) {
    const el = document.getElementById("count");
    if (el) el.textContent = String(count);
  }
  async function init() {
    const hostEl = document.getElementById("host");
    const toggle = document.getElementById("toggle");
    const countEl = document.getElementById("count");
    if (!hostEl || !toggle || !countEl) return;
    const countResult = await storageLocalGet([COUNT_KEY]);
    setCount(Number(countResult[COUNT_KEY] || 0));
    const tab = await getActiveTab();
    const tabId = tab?.id;
    const url = tab?.url ? new URL(tab.url) : null;
    if (!url || !url.hostname) {
      hostEl.textContent = "Unavailable";
      toggle.disabled = true;
      setStatus("This page does not allow extensions.");
      return;
    }
    const host = url.hostname;
    hostEl.textContent = host;
    const disabledHosts = await getDisabledHosts();
    const enabled = !disabledHosts[host];
    toggle.checked = enabled;
    toggle.addEventListener("change", async () => {
      await setHostEnabled(host, toggle.checked);
      if (typeof tabId === "number") {
        await tabsSendMessage(tabId, {
          type: "k00:setEnabled",
          host,
          enabled: toggle.checked
        });
      }
      setStatus(toggle.checked ? "Sanitizing enabled." : "Sanitizing disabled.");
    });
  }
  document.addEventListener("DOMContentLoaded", () => {
    init().catch(() => void 0);
  });
  storageOnChangedAddListener((changes, area) => {
    if (area !== "local") return;
    if (changes[COUNT_KEY]) {
      setCount(Number(changes[COUNT_KEY].newValue || 0));
    }
  });
})();
