import { TARGET_HOST, TARGET_URL } from "../config/config.local.js";
import { ATTENDANCE_STATUSES } from "./constants.js";
import { createTab, getTab, removeTab, updateTab } from "./chromePromise.js";
import { checkAttendanceInPage } from "../content/checkAttendance.js";

export async function openInactiveCheckTab() {
  return createTab({ url: TARGET_URL, active: false });
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

export function isSubjectPageUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.hostname === TARGET_HOST && url.pathname.toLowerCase().includes("/subjectmng/userview");
  } catch {
    return false;
  }
}

export async function runAttendanceCheckInTab(tabId, target) {
  const injectionResults = await chrome.scripting.executeScript({
    target: { tabId },
    func: checkAttendanceInPage,
    args: [
      {
        targetCourseName: target.targetCourseName,
        targetDate: target.targetDate,
        targetKoma: target.targetKoma
      }
    ]
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
