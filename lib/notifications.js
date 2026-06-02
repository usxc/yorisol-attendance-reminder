import { NOTIFICATION_IDS } from "./constants.js";
import { saveNotificationPayload } from "./storage.js";

export async function notifyNeedAttend(target, result) {
  const notificationId = `${NOTIFICATION_IDS.NEED_ATTEND_PREFIX}:${target.slotId}:${Date.now()}`;

  await saveNotificationPayload(notificationId, {
    kind: "need_attend",
    target,
    result
  });

  await chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title: "出席確認",
    message: `${target.period}限 ${target.displaySubject} は未出席です。`,
    buttons: [
      { title: "ここをクリックして出席ボタンへ" }
    ],
    priority: 2
  });

  return notificationId;
}

export async function notifyLoginRequired(target, tabId = null) {
  const notificationId = `${NOTIFICATION_IDS.LOGIN_REQUIRED_PREFIX}:${target?.slotId || "unknown"}:${Date.now()}`;

  await saveNotificationPayload(notificationId, {
    kind: "login_required",
    target,
    tabId
  });

  await chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title: "ヨリソルにログインしてください",
    message: "通知をクリックすると確認用タブを前面に出します。",
    priority: 2
  });

  return notificationId;
}

export async function notifyMultipleButtons(target, result) {
  const notificationId = `${NOTIFICATION_IDS.MULTIPLE_BUTTONS_PREFIX}:${target.slotId}:${Date.now()}`;

  await saveNotificationPayload(notificationId, {
    kind: "multiple_buttons",
    target,
    result
  });

  await chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title: "出席確認に注意が必要です",
    message: `${target.period}限 ${target.displaySubject} で出席ボタンが複数見つかりました。手動で確認してください。`,
    priority: 1
  });

  return notificationId;
}

export async function notifyCheckError(target, message) {
  const notificationId = `${NOTIFICATION_IDS.ERROR_PREFIX}:${target?.slotId || "unknown"}:${Date.now()}`;

  await saveNotificationPayload(notificationId, {
    kind: "error",
    target,
    message
  });

  await chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title: "出席確認に失敗しました",
    message: message || "詳細は拡張機能のログを確認してください。",
    priority: 2
  });

  return notificationId;
}
