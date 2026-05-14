import { TARGET_URL } from "./config/config.local.js";
import { ATTENDANCE_STATUSES, DAILY_REBUILD_ALARM } from "./lib/constants.js";
import { clearScheduledAlarms, parseAttendanceAlarmName, rebuildAlarms } from "./lib/scheduler.js";
import { clearTimetable, getNotificationPayload, getSettings, getTimetable, appendLog, removeNotificationPayload, setLastResult } from "./lib/storage.js";
import { getTargetForSlot } from "./lib/occurrence.js";
import { closeTabIfExists, focusTab, isSubjectPageUrl, openInactiveCheckTab, runAttendanceCheckInTab, waitForTabComplete } from "./lib/yorisolTab.js";
import { notifyCheckError, notifyLoginRequired, notifyMultipleButtons, notifyNeedAttend } from "./lib/notifications.js";

chrome.runtime.onInstalled.addListener(() => {
  rebuildAlarms().catch((error) => appendLog("error", "インストール時のスケジュール作成に失敗しました。", { error: String(error?.message || error) }));
});

chrome.runtime.onStartup.addListener(() => {
  rebuildAlarms().catch((error) => appendLog("error", "起動時のスケジュール作成に失敗しました。", { error: String(error?.message || error) }));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DAILY_REBUILD_ALARM) {
    rebuildAlarms().catch((error) => appendLog("error", "日次スケジュール再作成に失敗しました。", { error: String(error?.message || error) }));
    return;
  }

  const parsed = parseAttendanceAlarmName(alarm.name);
  if (!parsed) return;

  runCheckForSlot(parsed.date, parsed.period).catch((error) => {
    appendLog("error", "アラーム発火後の出席確認に失敗しました。", {
      alarmName: alarm.name,
      error: String(error?.message || error)
    });
  });
});

chrome.notifications.onClicked.addListener((notificationId) => {
  handleNotificationClick(notificationId).catch((error) => {
    appendLog("error", "通知クリック処理に失敗しました。", {
      notificationId,
      error: String(error?.message || error)
    });
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "REBUILD_ALARMS":
      return { created: await rebuildAlarms() };
    case "CLEAR_TIMETABLE": {
      await clearTimetable();
      return { clearedAlarms: await clearScheduledAlarms() };
    }
    case "CLEAR_ALARMS":
      return { cleared: await clearScheduledAlarms() };
    case "RUN_CHECK":
      return runCheckForSlot(message.date, message.period, { manual: true });
    case "OPEN_TARGET":
      return chrome.tabs.create({ url: TARGET_URL, active: true });
    default:
      throw new Error(`未対応のメッセージです: ${message?.type}`);
  }
}

async function runCheckForSlot(dateString, period, options = {}) {
  const [settings, timetable] = await Promise.all([
    getSettings(),
    getTimetable()
  ]);

  await appendLog("info", "alarm発火", { date: dateString, period: Number(period), manual: Boolean(options.manual) });

  const target = getTargetForSlot(timetable, dateString, period);
  if (!target) {
    const message = `${dateString} ${period}限は通知対象外、または時間割JSON上で attendance_enabled=false です。`;
    await appendLog("info", message);
    return { status: "skipped", message };
  }

  let tabId = null;
  let keepTabOpen = false;

  try {
    await appendLog("info", "対象授業", {
      date: target.date,
      period: target.period,
      displaySubject: target.displaySubject,
      yorisolSearchSubject: target.yorisolSearchSubject,
      targetKoma: target.targetKoma
    });

    const tab = await openInactiveCheckTab();
    tabId = tab.id;

    const loadedTab = await waitForTabComplete(tabId, 45000);

    if (!isSubjectPageUrl(loadedTab.url || "")) {
      keepTabOpen = true;
      const result = {
        status: ATTENDANCE_STATUSES.LOGIN_REQUIRED,
        message: "ヨリソルにログインしてください"
      };
      await setLastResult(target.slotId, result);
      await notifyLoginRequired(target, tabId);
      await appendLog("warning", "ログイン必要", { target, url: loadedTab.url });
      return result;
    }

    const result = await runAttendanceCheckInTab(tabId, target);
    await setLastResult(target.slotId, result);

    if (result.status === ATTENDANCE_STATUSES.NEED_ATTEND) {
      await notifyNeedAttend(target, result);
      await appendLog("warning", "出席確認結果", { target, result });
    } else if (result.status === ATTENDANCE_STATUSES.MULTIPLE_BUTTONS) {
      await notifyMultipleButtons(target, result);
      await appendLog("warning", "出席確認結果", { target, result });
    } else if (result.status === ATTENDANCE_STATUSES.LOGIN_REQUIRED) {
      keepTabOpen = true;
      await notifyLoginRequired(target, tabId);
      await appendLog("warning", "ログイン必要", { target, result });
    } else if (result.status === ATTENDANCE_STATUSES.ERROR) {
      await appendLog("error", "エラー", { target, result });
      if (options.manual) {
        await notifyCheckError(target, result.message);
      }
    } else {
      await appendLog("info", "出席確認結果", { target, result });
    }

    return result;
  } catch (error) {
    const message = String(error?.message || error);
    await setLastResult(target.slotId, { status: ATTENDANCE_STATUSES.ERROR, message });
    await appendLog("error", "エラー", { target, error: message });
    if (options.manual) {
      await notifyCheckError(target, message);
    }
    return { status: ATTENDANCE_STATUSES.ERROR, message };
  } finally {
    if (tabId && !keepTabOpen && settings.closeCheckTabWhenDone) {
      await closeTabIfExists(tabId);
    }
  }
}

async function handleNotificationClick(notificationId) {
  const payload = await getNotificationPayload(notificationId);
  await chrome.notifications.clear(notificationId);
  await removeNotificationPayload(notificationId);

  if (payload?.tabId) {
    await focusTab(payload.tabId).catch(async () => chrome.tabs.create({ url: TARGET_URL, active: true }));
    return;
  }

  await chrome.tabs.create({ url: TARGET_URL, active: true });
}
