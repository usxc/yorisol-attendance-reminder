import { TARGET_URL } from "../config/config.local.js";
import { MAX_TIMETABLE_FILE_BYTES } from "../lib/constants.js";
import { saveTimetable, getTimetable, getLogs, clearLogs, clearTimetable } from "../lib/storage.js";
import { clearScheduledAlarms } from "../lib/scheduler.js";

const targetUrl = document.getElementById("targetUrl");
const openTargetButton = document.getElementById("openTargetButton");
const timetableFile = document.getElementById("timetableFile");
const saveTimetableButton = document.getElementById("saveTimetableButton");
const clearTimetableButton = document.getElementById("clearTimetableButton");
const timetableStatus = document.getElementById("timetableStatus");
const rebuildButton = document.getElementById("rebuildButton");
const clearAlarmsButton = document.getElementById("clearAlarmsButton");
const rebuildStatus = document.getElementById("rebuildStatus");
const reloadLogsButton = document.getElementById("reloadLogsButton");
const clearLogsButton = document.getElementById("clearLogsButton");
const logs = document.getElementById("logs");

targetUrl.textContent = TARGET_URL;

openTargetButton.addEventListener("click", async () => {
  await sendMessage({ type: "OPEN_TARGET" });
});

saveTimetableButton.addEventListener("click", async () => {
  try {
    const json = await readSelectedJson(timetableFile);
    await saveTimetable(json);
    timetableStatus.textContent = `保存しました: ${json.length}件`;
    await rebuildAlarms();
  } catch (error) {
    timetableStatus.textContent = `保存失敗: ${String(error?.message || error)}`;
  }
});

rebuildButton.addEventListener("click", rebuildAlarms);
clearTimetableButton.addEventListener("click", clearTimetableData);
clearAlarmsButton.addEventListener("click", clearAlarms);
reloadLogsButton.addEventListener("click", renderLogs);
clearLogsButton.addEventListener("click", async () => {
  await clearLogs();
  await renderLogs();
});

async function clearTimetableData() {
  if (!confirm("保存済みの時間割JSONを削除します。登録済みの通知スケジュールも削除されます。")) {
    return;
  }

  const clearedAlarms = await clearScheduledAlarms();
  await clearTimetable();

  timetableFile.value = "";
  timetableStatus.textContent = "保存済み: 0件";
  rebuildStatus.textContent = `通知スケジュールも削除しました: ${clearedAlarms}件`;
  await renderLogs();
}

async function clearAlarms() {
  if (!confirm("登録済みの通知スケジュールを削除します。時間割JSONは残ります。再作成ボタン、時間割JSON保存、Chrome起動でまた作成されます。")) {
    return;
  }

  const cleared = await clearScheduledAlarms();

  rebuildStatus.textContent = `削除しました: ${cleared}件`;
  await renderLogs();
}

async function rebuildAlarms() {
  rebuildStatus.textContent = "再作成中...";
  const response = await sendMessage({ type: "REBUILD_ALARMS" });
  if (!response.ok) {
    rebuildStatus.textContent = `失敗: ${response.error}`;
    return;
  }
  rebuildStatus.textContent = `再作成しました: ${response.result.created}件`;
  await renderLogs();
}

async function readSelectedJson(input) {
  const file = input.files?.[0];
  if (!file) throw new Error("JSONファイルを選択してください。");
  if (file.size > MAX_TIMETABLE_FILE_BYTES) {
    throw new Error(`JSONファイルは ${Math.floor(MAX_TIMETABLE_FILE_BYTES / 1024 / 1024)}MB 以下にしてください。`);
  }
  const text = await file.text();
  return JSON.parse(text);
}

async function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

async function refreshCounts() {
  const timetable = await getTimetable();
  timetableStatus.textContent = `保存済み: ${timetable.length}件`;
}

async function renderLogs() {
  const values = await getLogs();
  logs.textContent = values
    .map((entry) => `${entry.at} [${entry.level}] ${entry.message}\n${entry.extra ? JSON.stringify(entry.extra) : ""}`)
    .join("\n\n");
}

await refreshCounts();
await renderLogs();
