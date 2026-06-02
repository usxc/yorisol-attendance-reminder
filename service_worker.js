import { TARGET_URL } from "./config/config.local.js";
import { ATTENDANCE_STATUSES, DAILY_REBUILD_ALARM, MAX_AUTO_RETRY_ATTEMPTS, RETRY_DELAY_MINUTES } from "./lib/constants.js";
import { clearScheduledAlarms, parseAttendanceAlarmName, rebuildAlarms, scheduleRetryAlarm } from "./lib/scheduler.js";
import { clearTimetable, getNotificationPayload, getSettings, getTimetable, appendLog, removeNotificationPayload, setLastResult } from "./lib/storage.js";
import { getTargetForSlot } from "./lib/occurrence.js";
import { dateTimeFromDateAndTime } from "./lib/dateTime.js";
import { closeTabIfExists, focusTab, isSubjectPageUrl, isTabClosedError, openActiveTargetTab, openInactiveCheckTab, revealAttendanceTargetInTab, runAttendanceCheckInTab, waitForTabComplete } from "./lib/yorisolTab.js";
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

  runCheckForSlot(parsed.date, parsed.period, { retryAttempt: parsed.retryAttempt }).catch((error) => {
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

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  handleNotificationButtonClick(notificationId, buttonIndex).catch((error) => {
    appendLog("error", "通知ボタンクリック処理に失敗しました。", {
      notificationId,
      buttonIndex,
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

  const retryAttempt = Number(options.retryAttempt || 0);

  await appendLog("info", "alarm発火", {
    date: dateString,
    period: Number(period),
    manual: Boolean(options.manual),
    retryAttempt
  });

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

    await scheduleRetryIfNeeded(target, result, { ...options, retryAttempt });
    return result;
  } catch (error) {
    const message = String(error?.message || error);
    const result = {
      status: isTabClosedError(error) ? ATTENDANCE_STATUSES.TAB_CLOSED : ATTENDANCE_STATUSES.ERROR,
      message
    };
    await setLastResult(target.slotId, result);
    await appendLog("error", "エラー", { target, result });
    if (options.manual) {
      await notifyCheckError(target, message);
    }
    await scheduleRetryIfNeeded(target, result, { ...options, retryAttempt });
    return result;
  } finally {
    if (tabId && !keepTabOpen && settings.closeCheckTabWhenDone) {
      await closeTabIfExists(tabId);
    }
  }
}

async function scheduleRetryIfNeeded(target, result, options = {}) {
  if (options.manual || !shouldRetryResult(result)) {
    return;
  }

  const nextRetryAttempt = Number(options.retryAttempt || 0) + 1;
  if (nextRetryAttempt > MAX_AUTO_RETRY_ATTEMPTS) {
    await appendLog("info", "自動再確認は上限に達したため予約しません。", {
      target,
      result,
      retryAttempt: options.retryAttempt || 0
    });
    return;
  }

  const when = Date.now() + RETRY_DELAY_MINUTES * 60 * 1000;
  const classEnd = dateTimeFromDateAndTime(target.date, target.end);
  if (Number.isFinite(classEnd.getTime()) && when > classEnd.getTime()) {
    await appendLog("info", "授業終了時刻を過ぎるため自動再確認は予約しません。", {
      target,
      result,
      retryAt: new Date(when).toISOString()
    });
    return;
  }

  await scheduleRetryAlarm(target.date, target.period, nextRetryAttempt, when);
  await appendLog("info", "5分後の自動再確認を予約しました。", {
    target,
    result,
    retryAttempt: nextRetryAttempt,
    retryAt: new Date(when).toISOString()
  });
}

function shouldRetryResult(result) {
  return [
    ATTENDANCE_STATUSES.NO_BUTTON,
    ATTENDANCE_STATUSES.NODE_NOT_FOUND,
    ATTENDANCE_STATUSES.TAB_CLOSED
  ].includes(result?.status);
}

async function handleNotificationClick(notificationId) {
  const payload = await getNotificationPayload(notificationId);
  await chrome.notifications.clear(notificationId);
  await removeNotificationPayload(notificationId);

  if (payload?.tabId) {
    await focusTab(payload.tabId).catch(async () => chrome.tabs.create({ url: TARGET_URL, active: true }));
    return;
  }

  if (shouldRevealAttendanceTarget(payload)) {
    await openAttendanceTargetFromNotification(payload);
    return;
  }

  await chrome.tabs.create({ url: TARGET_URL, active: true });
}

async function handleNotificationButtonClick(notificationId, buttonIndex) {
  if (buttonIndex !== 0) {
    await appendLog("info", "未対応の通知ボタンがクリックされました。", {
      notificationId,
      buttonIndex
    });
    return;
  }

  await handleNotificationClick(notificationId);
}

function shouldRevealAttendanceTarget(payload) {
  return (
    payload?.target &&
    ["need_attend", "multiple_buttons"].includes(payload.kind)
  );
}

async function openAttendanceTargetFromNotification(payload) {
  try {
    const tab = await openActiveTargetTab();
    await runUntilTabClosed(tab.id, async () => {
      const loadedTab = await waitForTabComplete(tab.id, 45000);

      if (!isSubjectPageUrl(loadedTab.url || "")) {
        await appendLog("warning", "通知クリック後、対象ページを開けませんでした。", {
          target: payload.target,
          url: loadedTab.url || ""
        });
        return;
      }

      const result = await revealAttendanceTargetInTab(tab.id, payload.target);
      await appendLog("info", "通知クリックで出席ボタン位置へ移動しました。", {
        target: payload.target,
        result
      });
    });
  } catch (error) {
    if (!isTabClosedError(error)) {
      throw error;
    }

    const message = "確認用タブが閉じられました。";
    await appendLog("error", "通知クリック後の確認用タブが閉じられました。", {
      target: payload.target,
      error: String(error?.message || error)
    });
    await notifyCheckError(payload.target, message);
  }
}

async function runUntilTabClosed(tabId, task) {
  let removeListener = null;
  const tabClosed = new Promise((_, reject) => {
    const listener = (closedTabId) => {
      if (closedTabId === tabId) {
        reject(new Error("確認用タブが閉じられました。"));
      }
    };
    removeListener = () => chrome.tabs.onRemoved.removeListener(listener);
    chrome.tabs.onRemoved.addListener(listener);
  });

  try {
    return await Promise.race([task(), tabClosed]);
  } finally {
    removeListener?.();
  }
}
