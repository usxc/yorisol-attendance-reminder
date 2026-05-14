import { jsDateForYorisol } from "./dateTime.js";
import { getDisplaySubject, isAttendanceEnabledSlot, sortSlots } from "./timetable.js";

export function buildTargetsForDate(timetable, dateString) {
  const daySlots = sortSlots(timetable).filter((slot) => slot.date === dateString);
  const counts = new Map();
  const targets = [];

  for (const slot of daySlots) {
    if (!isAttendanceEnabledSlot(slot)) {
      continue;
    }

    const searchSubject = String(slot.yorisol_search_subject).trim();
    const key = `${slot.date}|${searchSubject}`;
    const lessonOccurrence = (counts.get(key) || 0) + 1;
    counts.set(key, lessonOccurrence);

    targets.push({
      slotId: buildSlotId(slot.date, slot.period),
      date: slot.date,
      period: slot.period,
      start: slot.start,
      end: slot.end,
      subject: slot.subject,
      displaySubject: getDisplaySubject(slot),
      yorisolSubject: slot.yorisol_subject,
      yorisolSearchSubject: searchSubject,
      targetCourseName: searchSubject,
      targetDate: jsDateForYorisol(slot.date),
      targetKoma: lessonOccurrence,
      attendanceEnabled: true
    });
  }

  return targets;
}

export function getTargetForSlot(timetable, dateString, period) {
  return buildTargetsForDate(timetable, dateString).find(
    (target) => target.period === Number(period)
  ) || null;
}

export function buildSlotId(dateString, period) {
  return `${dateString}-${Number(period)}`;
}
