import {
  DEFAULT_SETTINGS,
  MAX_LOG_ENTRIES,
  MAX_NOTIFICATION_PAYLOADS,
  MAX_TIMETABLE_ENTRIES,
  MAX_TIMETABLE_TEXT_LENGTH,
  STORAGE_KEYS
} from "./constants.js";
import { storageGet, storageSet, storageRemove } from "./chromePromise.js";
import { normalizeSlot } from "./timetable.js";

export async function getTimetable() {
  const result = await storageGet(STORAGE_KEYS.TIMETABLE);
  return Array.isArray(result[STORAGE_KEYS.TIMETABLE]) ? result[STORAGE_KEYS.TIMETABLE] : [];
}

export async function saveTimetable(timetable) {
  if (!Array.isArray(timetable)) {
    throw new Error("時間割JSONは配列である必要があります。");
  }
  validateTimetable(timetable);
  const sanitized = timetable.map(normalizeSlot);
  await storageSet({ [STORAGE_KEYS.TIMETABLE]: sanitized });
  await appendLog("info", "時間割JSON保存", { count: sanitized.length });
}

export async function clearTimetable() {
  await storageRemove([
    STORAGE_KEYS.TIMETABLE,
    STORAGE_KEYS.LAST_RESULTS,
    STORAGE_KEYS.LAST_SCHEDULE_BUILT_AT,
    STORAGE_KEYS.NOTIFICATION_PAYLOADS
  ]);
  await appendLog("info", "時間割JSON削除");
}

export async function getSettings() {
  const result = await storageGet(STORAGE_KEYS.SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...(result[STORAGE_KEYS.SETTINGS] || {})
  };
}

export async function saveSettings(settings) {
  await storageSet({
    [STORAGE_KEYS.SETTINGS]: {
      ...DEFAULT_SETTINGS,
      ...settings
    }
  });
}

export async function appendLog(level, message, extra = {}) {
  const result = await storageGet(STORAGE_KEYS.LOGS);
  const logs = Array.isArray(result[STORAGE_KEYS.LOGS]) ? result[STORAGE_KEYS.LOGS] : [];
  logs.unshift({
    at: new Date().toISOString(),
    level,
    message,
    extra
  });
  await storageSet({ [STORAGE_KEYS.LOGS]: logs.slice(0, MAX_LOG_ENTRIES) });
}

export async function getLogs() {
  const result = await storageGet(STORAGE_KEYS.LOGS);
  return Array.isArray(result[STORAGE_KEYS.LOGS]) ? result[STORAGE_KEYS.LOGS] : [];
}

export async function clearLogs() {
  await storageRemove(STORAGE_KEYS.LOGS);
}

export async function setLastResult(slotId, result) {
  const current = await storageGet(STORAGE_KEYS.LAST_RESULTS);
  const lastResults = current[STORAGE_KEYS.LAST_RESULTS] || {};
  lastResults[slotId] = {
    ...result,
    checkedAt: new Date().toISOString()
  };
  await storageSet({ [STORAGE_KEYS.LAST_RESULTS]: lastResults });
}

export async function getLastResults() {
  const result = await storageGet(STORAGE_KEYS.LAST_RESULTS);
  return result[STORAGE_KEYS.LAST_RESULTS] || {};
}

export async function setLastScheduleBuiltAt(value = new Date().toISOString()) {
  await storageSet({ [STORAGE_KEYS.LAST_SCHEDULE_BUILT_AT]: value });
}

export async function getLastScheduleBuiltAt() {
  const result = await storageGet(STORAGE_KEYS.LAST_SCHEDULE_BUILT_AT);
  return result[STORAGE_KEYS.LAST_SCHEDULE_BUILT_AT] || "";
}

export async function saveNotificationPayload(notificationId, payload) {
  const current = await storageGet(STORAGE_KEYS.NOTIFICATION_PAYLOADS);
  const payloads = current[STORAGE_KEYS.NOTIFICATION_PAYLOADS] || {};
  payloads[notificationId] = {
    ...payload,
    createdAt: new Date().toISOString()
  };
  await storageSet({ [STORAGE_KEYS.NOTIFICATION_PAYLOADS]: pruneNotificationPayloads(payloads) });
}

export async function getNotificationPayload(notificationId) {
  const current = await storageGet(STORAGE_KEYS.NOTIFICATION_PAYLOADS);
  return current[STORAGE_KEYS.NOTIFICATION_PAYLOADS]?.[notificationId] || null;
}

export async function removeNotificationPayload(notificationId) {
  const current = await storageGet(STORAGE_KEYS.NOTIFICATION_PAYLOADS);
  const payloads = current[STORAGE_KEYS.NOTIFICATION_PAYLOADS] || {};
  if (!Object.prototype.hasOwnProperty.call(payloads, notificationId)) {
    return;
  }

  delete payloads[notificationId];
  await storageSet({ [STORAGE_KEYS.NOTIFICATION_PAYLOADS]: payloads });
}

function validateTimetable(timetable) {
  if (timetable.length > MAX_TIMETABLE_ENTRIES) {
    throw new Error(`時間割JSONは最大 ${MAX_TIMETABLE_ENTRIES} 件までです。`);
  }

  const required = [
    "date",
    "weekday",
    "period",
    "start",
    "end",
    "subject",
    "kind",
    "attendance_enabled",
    "yorisol_subject",
    "yorisol_search_subject"
  ];

  for (const [index, slot] of timetable.entries()) {
    if (!slot || typeof slot !== "object" || Array.isArray(slot)) {
      throw new Error(`時間割JSON ${index + 1}件目は object である必要があります。`);
    }

    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(slot, key)) {
        throw new Error(`時間割JSON ${index + 1}件目に ${key} がありません。`);
      }
    }
    if (!isValidLocalDate(slot.date)) {
      throw new Error(`時間割JSON ${index + 1}件目の date が YYYY-MM-DD ではありません。`);
    }
    const period = Number(slot.period);
    if (!Number.isInteger(period) || period < 1 || period > 4) {
      throw new Error(`時間割JSON ${index + 1}件目の period が1〜4ではありません。`);
    }
    if (!/^\d{2}:\d{2}$/.test(String(slot.start)) || !/^\d{2}:\d{2}$/.test(String(slot.end))) {
      throw new Error(`時間割JSON ${index + 1}件目の start/end は HH:mm 形式にしてください。`);
    }
    if (!isValidTime(slot.start) || !isValidTime(slot.end)) {
      throw new Error(`時間割JSON ${index + 1}件目の start/end が実在する時刻ではありません。`);
    }
    if (timeToMinutes(slot.start) >= timeToMinutes(slot.end)) {
      throw new Error(`時間割JSON ${index + 1}件目の start は end より前にしてください。`);
    }
    if (typeof slot.attendance_enabled !== "boolean") {
      throw new Error(`時間割JSON ${index + 1}件目の attendance_enabled は boolean にしてください。`);
    }
    for (const key of ["weekday", "subject", "kind", "yorisol_subject", "yorisol_search_subject"]) {
      if (!isValidTextField(slot[key])) {
        throw new Error(`時間割JSON ${index + 1}件目の ${key} が長すぎます。`);
      }
    }
    if (slot.attendance_enabled && !String(slot.yorisol_search_subject || "").trim()) {
      throw new Error(`時間割JSON ${index + 1}件目は attendance_enabled=true ですが yorisol_search_subject が空です。`);
    }
  }
}

function pruneNotificationPayloads(payloads) {
  return Object.fromEntries(
    Object.entries(payloads)
      .sort(([, a], [, b]) => String(b?.createdAt || "").localeCompare(String(a?.createdAt || "")))
      .slice(0, MAX_NOTIFICATION_PAYLOADS)
  );
}

function isValidLocalDate(value) {
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }

  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function isValidTime(value) {
  const text = String(value);
  if (!/^\d{2}:\d{2}$/.test(text)) {
    return false;
  }

  const [hour, minute] = text.split(":").map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function timeToMinutes(value) {
  const [hour, minute] = String(value).split(":").map(Number);
  return hour * 60 + minute;
}

function isValidTextField(value) {
  if (value === null || value === undefined) {
    return true;
  }
  return String(value).length <= MAX_TIMETABLE_TEXT_LENGTH;
}
