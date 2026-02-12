"use strict";
(() => {
  // src/popup.ts
  var STORAGE_KEY = "disabledHosts";
  var COUNT_KEY = "sanitizedCount";
  function getActiveTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs[0] || null);
      });
    });
  }
  async function getDisabledHosts() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        resolve(result[STORAGE_KEY] || {});
      });
    });
  }
  async function setHostEnabled(host, enabled) {
    const disabledHosts = await getDisabledHosts();
    if (enabled) {
      delete disabledHosts[host];
    } else {
      disabledHosts[host] = true;
    }
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: disabledHosts }, () => resolve());
    });
  }
  function setStatus(text) {
    const el = document.getElementById("status");
    if (el) el.textContent = text;
  }
  function setCount(count) {
    const el = document.getElementById("count");
    if (el) el.textContent = `Sanitized ${count} of your files`;
  }
  async function init() {
    const hostEl = document.getElementById("host");
    const toggle = document.getElementById("toggle");
    const countEl = document.getElementById("count");
    if (!hostEl || !toggle || !countEl) return;
    chrome.storage.local.get([COUNT_KEY], (result) => {
      setCount(Number(result[COUNT_KEY] || 0));
    });
    const tab = await getActiveTab();
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
      setStatus(toggle.checked ? "Sanitizing enabled." : "Sanitizing disabled.");
    });
  }
  document.addEventListener("DOMContentLoaded", () => {
    init().catch(() => void 0);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[COUNT_KEY]) {
      setCount(Number(changes[COUNT_KEY].newValue || 0));
    }
  });
})();
