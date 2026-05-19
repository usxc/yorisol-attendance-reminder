import { CHECK_DELAY_MINUTES } from "../config/config.local.js";
import { getLastResults, getLastScheduleBuiltAt, getTimetable } from "../lib/storage.js";
import { addMinutes, dateTimeFromDateAndTime, formatLocalDate, toDisplayDate } from "../lib/dateTime.js";
import { getDisplaySubject, getSlotsForDate, isAttendanceEnabledSlot } from "../lib/timetable.js";
import { buildSlotId, buildTargetsForDate } from "../lib/occurrence.js";
import { listAttendanceAlarms } from "../lib/scheduler.js";

const todayEl = document.getElementById("today");
const slotsEl = document.getElementById("slots");
const nextCheckEl = document.getElementById("nextCheck");
const statusEl = document.getElementById("status");
const openOptionsButton = document.getElementById("openOptionsButton");
const rebuildButton = document.getElementById("rebuildButton");

openOptionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
rebuildButton.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "REBUILD_ALARMS" });
  statusEl.textContent = response.ok
    ? `再スケジュールしました: ${response.result.created}件`
    : `失敗: ${response.error}`;
});

async function render() {
  const dateString = formatLocalDate();
  todayEl.textContent = toDisplayDate(dateString);

  const [timetable, lastResults, alarms, lastScheduleBuiltAt] = await Promise.all([
    getTimetable(),
    getLastResults(),
    listAttendanceAlarms(),
    getLastScheduleBuiltAt()
  ]);

  const slots = getSlotsForDate(timetable, dateString);
  const targets = buildTargetsForDate(timetable, dateString);
  const targetBySlotId = new Map(targets.map((target) => [target.slotId, target]));
  renderNextCheck(alarms, lastScheduleBuiltAt);

  if (slots.length === 0) {
    slotsEl.replaceChildren(element("p", { className: "muted" }, "今日の時間割がありません。設定画面でJSONを読み込んでください。"));
    return;
  }

  slotsEl.replaceChildren();
  for (const slot of slots) {
    const slotId = buildSlotId(slot.date, slot.period);
    const target = targetBySlotId.get(slotId);
    const checkAt = addMinutes(dateTimeFromDateAndTime(slot.date, slot.start), CHECK_DELAY_MINUTES);
    const last = lastResults[slotId];
    const enabled = isAttendanceEnabledSlot(slot);

    const article = document.createElement("article");
    article.className = "slot";
    article.append(
      element("h2", {}, [
        element("span", { className: "period" }, `${slot.period}限`),
        element("span", { className: "subject" }, getDisplaySubject(slot))
      ]),
      element("div", { className: "meta-grid" }, [
        element("span", { className: "meta-label" }, "授業時間"),
        element("span", { className: "meta-value time-range" }, [
          element("span", {}, slot.start),
          element("span", { className: "time-separator" }, "-"),
          element("span", {}, slot.end)
        ]),
        element("span", { className: "meta-label" }, "確認予定"),
        element("span", { className: "meta-value" }, formatTime(checkAt))
      ]),
      element("div", { className: "slot-status" }, [
        element("span", { className: `badge ${enabled ? "on" : "off"}` }, enabled ? "確認対象" : "対象外"),
        element("span", { className: `badge result ${resultBadgeClass(last)}`.trim() }, formatLastResult(last))
      ]),
      element("div", { className: "slot-actions" }, [
        buildRunButton(slot, Boolean(target))
      ])
    );
    slotsEl.appendChild(article);
  }

  slotsEl.querySelectorAll("button[data-date]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "確認中...";
      statusEl.textContent = "確認中...";
      const response = await chrome.runtime.sendMessage({
        type: "RUN_CHECK",
        date: button.dataset.date,
        period: Number(button.dataset.period)
      });
      statusEl.textContent = response.ok
        ? `確認結果: ${statusLabel(response.result.status)}`
        : `失敗: ${response.error}`;
      await render();
    });
  });
}

function renderNextCheck(alarms, lastScheduleBuiltAt) {
  const now = Date.now();
  const next = [...alarms]
    .filter((alarm) => Number(alarm.scheduledTime) >= now)
    .sort((a, b) => a.scheduledTime - b.scheduledTime)[0];

  if (!next) {
    nextCheckEl.textContent = lastScheduleBuiltAt
      ? `次回確認予定: なし / 最終再作成 ${formatDateTime(new Date(lastScheduleBuiltAt))}`
      : "次回確認予定: なし";
    return;
  }

  nextCheckEl.textContent = `次回確認予定: ${formatDateTime(new Date(next.scheduledTime))}`;
}

function formatTime(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatDateTime(date) {
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${formatTime(date)}`;
}

function formatLastResult(last) {
  if (!last) {
    return "未確認";
  }

  const checkedAt = formatCheckedAt(last.checkedAt);
  return checkedAt
    ? `${statusLabel(last.status)} ${checkedAt}`
    : statusLabel(last.status);
}

function resultBadgeClass(last) {
  const classes = {
    already_attended: "already-attended",
    need_attend: "need-attend"
  };
  return classes[last?.status] || "";
}

function formatCheckedAt(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const today = formatLocalDate();
  const checkedDate = formatLocalDate(date);
  const time = `${formatTime(date)}:${String(date.getSeconds()).padStart(2, "0")}`;

  return checkedDate === today
    ? time
    : `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${time}`;
}

function statusLabel(status) {
  const labels = {
    already_attended: "出席済み",
    need_attend: "未出席",
    no_button: "ボタンなし",
    course_not_found: "授業なし",
    node_not_found: "日付なし",
    multiple_buttons: "要確認",
    login_required: "ログイン必要",
    error: "エラー",
    skipped: "対象外"
  };
  return labels[status] || status || "不明";
}

function buildRunButton(slot, enabled) {
  const button = element("button", {}, "今すぐ確認");
  button.dataset.date = slot.date;
  button.dataset.period = String(slot.period);
  button.disabled = !enabled;
  return button;
}

function element(tagName, props = {}, children = []) {
  const el = document.createElement(tagName);
  for (const [key, value] of Object.entries(props)) {
    el[key] = value;
  }

  const childValues = Array.isArray(children) ? children : [children];
  for (const child of childValues) {
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

await render();
