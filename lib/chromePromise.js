export function runtimeLastErrorMessage() {
  return chrome.runtime.lastError?.message || "";
}

export function ensureNoRuntimeError() {
  const message = runtimeLastErrorMessage();
  if (message) {
    throw new Error(message);
  }
}

export async function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

export async function storageSet(value) {
  await chrome.storage.local.set(value);
}

export async function storageRemove(keys) {
  await chrome.storage.local.remove(keys);
}

export async function createTab(createProperties) {
  return chrome.tabs.create(createProperties);
}

export async function updateTab(tabId, updateProperties) {
  return chrome.tabs.update(tabId, updateProperties);
}

export async function removeTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
  } catch (error) {
    // タブが既に閉じられている場合は無視する。
  }
}

export async function getTab(tabId) {
  return chrome.tabs.get(tabId);
}

export async function createAlarm(name, alarmInfo) {
  await chrome.alarms.create(name, alarmInfo);
}

export async function clearAllAlarms() {
  await chrome.alarms.clearAll();
}

export async function getAllAlarms() {
  return chrome.alarms.getAll();
}
