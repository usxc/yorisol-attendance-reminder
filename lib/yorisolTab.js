import { TARGET_HOST, TARGET_URL } from "../config/config.local.js";
import { ATTENDANCE_STATUSES } from "./constants.js";
import { createTab, getTab, removeTab, updateTab } from "./chromePromise.js";
import { checkAttendanceInPage } from "../content/checkAttendance.js";

export async function openInactiveCheckTab() {
  return createTab({ url: TARGET_URL, active: false });
}

export async function openActiveTargetTab() {
  return createTab({ url: TARGET_URL, active: true });
}

export async function focusTab(tabId) {
  const tab = await getTab(tabId);
  if (tab.windowId !== undefined) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  return updateTab(tabId, { active: true });
}

export async function waitForTabComplete(tabId, timeoutMs = 45000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const tab = await getTab(tabId).catch(() => null);
    if (!tab) {
      throw new Error("確認用タブが閉じられました。");
    }

    if (tab.status === "complete") {
      return tab;
    }

    await sleep(500);
  }

  return getTab(tabId);
}

export function isTabClosedError(error) {
  const message = String(error?.message || error);
  return (
    message.includes("確認用タブが閉じられました") ||
    message.includes("No tab with id") ||
    message.toLowerCase().includes("tab was closed")
  );
}

export function isSubjectPageUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.hostname === TARGET_HOST && url.pathname.toLowerCase().includes("/subjectmng/userview");
  } catch {
    return false;
  }
}

export async function runAttendanceCheckInTab(tabId, target) {
  return runAttendanceScriptInTab(tabId, target);
}

export async function revealAttendanceTargetInTab(tabId, target) {
  return runAttendanceScriptInTab(tabId, target, { revealAttendanceTarget: true });
}

async function runAttendanceScriptInTab(tabId, target, options = {}) {
  const injectionResults = await chrome.scripting.executeScript({
    target: { tabId },
    func: checkAttendanceInPage,
    args: [
      {
        targetCourseName: target.targetCourseName,
        targetDate: target.targetDate,
        targetKoma: target.targetKoma,
        ...options
      }
    ]
  }).catch((error) => {
    if (isTabClosedError(error)) {
      throw new Error("確認用タブが閉じられました。");
    }
    throw error;
  });

  const result = injectionResults?.[0]?.result;
  if (!result || typeof result !== "object") {
    return {
      status: ATTENDANCE_STATUSES.ERROR,
      message: "content script の結果が取得できませんでした。"
    };
  }
  return result;
}

export async function closeTabIfExists(tabId) {
  if (tabId !== null && tabId !== undefined) {
    await removeTab(tabId);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
