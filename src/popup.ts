import {
  storageLocalGet,
  storageLocalSet,
  storageOnChangedAddListener,
  tabsQuery
} from "./extension";

type DisabledHosts = Record<string, true>;

const STORAGE_KEY = "disabledHosts";
const COUNT_KEY = "sanitizedCount";
function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  return tabsQuery({ active: true, currentWindow: true }).then((tabs) => tabs[0] || null);
}

async function getDisabledHosts(): Promise<DisabledHosts> {
  const result = await storageLocalGet([STORAGE_KEY]);
  return (result[STORAGE_KEY] as DisabledHosts) || {};
}

async function setHostEnabled(host: string, enabled: boolean): Promise<void> {
  const disabledHosts = await getDisabledHosts();
  if (enabled) {
    delete disabledHosts[host];
  } else {
    disabledHosts[host] = true;
  }
  await storageLocalSet({ [STORAGE_KEY]: disabledHosts });
}

function setStatus(text: string): void {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
}

function setCount(count: number): void {
  const el = document.getElementById("count");
  if (el) el.textContent = `Sanitized ${count} of your files`;
}

async function init(): Promise<void> {
  const hostEl = document.getElementById("host");
  const toggle = document.getElementById("toggle") as HTMLInputElement | null;
  const countEl = document.getElementById("count");
  if (!hostEl || !toggle || !countEl) return;

  const countResult = await storageLocalGet([COUNT_KEY]);
  setCount(Number(countResult[COUNT_KEY] || 0));

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
  init().catch(() => undefined);
});

storageOnChangedAddListener((changes, area) => {
  if (area !== "local") return;
  if (changes[COUNT_KEY]) {
    setCount(Number(changes[COUNT_KEY].newValue || 0));
  }
});
