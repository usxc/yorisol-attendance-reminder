import { formatLocalDate } from "./dateTime.js";

export function normalizeSlot(slot) {
  return {
    date: String(slot.date),
    weekday: slot.weekday ? String(slot.weekday) : "",
    period: Number(slot.period),
    start: String(slot.start),
    end: String(slot.end),
    subject: String(slot.subject),
    kind: slot.kind ? String(slot.kind) : "class",
    attendance_enabled: slot.attendance_enabled === true,
    yorisol_subject: slot.yorisol_subject === null || slot.yorisol_subject === undefined
      ? null
      : String(slot.yorisol_subject),
    yorisol_search_subject: slot.yorisol_search_subject === null || slot.yorisol_search_subject === undefined
      ? null
      : String(slot.yorisol_search_subject)
  };
}

export function sortSlots(slots) {
  return [...slots].map(normalizeSlot).sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.period - b.period;
  });
}

export function getSlotsForDate(timetable, dateString = formatLocalDate()) {
  return sortSlots(timetable).filter((slot) => slot.date === dateString);
}

export function getSlotByDateAndPeriod(timetable, dateString, period) {
  return getSlotsForDate(timetable, dateString).find((slot) => slot.period === Number(period)) || null;
}

export function isAttendanceEnabledSlot(slot) {
  return slot?.attendance_enabled === true && Boolean(String(slot.yorisol_search_subject || "").trim());
}

export function getDisplaySubject(slot) {
  return String(slot?.yorisol_subject || slot?.subject || "");
}
