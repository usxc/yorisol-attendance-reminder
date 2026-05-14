import { CHECK_DELAY_MINUTES } from "../config/config.local.js";
import { ALARM_PREFIX, DAILY_REBUILD_ALARM } from "./constants.js";
import { clearAllAlarms, createAlarm, getAllAlarms } from "./chromePromise.js";
import { addDays, addMinutes, dateTimeFromDateAndTime, formatLocalDate } from "./dateTime.js";
import { buildTargetsForDate } from "./occurrence.js";
import { appendLog, getSettings, getTimetable, setLastScheduleBuiltAt } from "./storage.js";

export function buildAlarmName(dateString, period) {
  return `${ALARM_PREFIX}:${dateString}:${Number(period)}`;
}

export function parseAttendanceAlarmName(name) {
  const parts = String(name).split(":");
  if (parts.length !== 3 || parts[0] !== ALARM_PREFIX) {
    return null;
  }
  return {
    date: parts[1],
    period: Number(parts[2])
  };
}

export async function rebuildAlarms() {
  const [settings, timetable] = await Promise.all([
    getSettings(),
    getTimetable()
  ]);

  await clearAllAlarms();

  const now = new Date();
  const daysAhead = Math.max(2, Number(settings.scheduleDaysAhead || 2));
  let created = 0;

  for (let dayOffset = 0; dayOffset < daysAhead; dayOffset += 1) {
    const dateString = formatLocalDate(addDays(now, dayOffset));
    const targets = buildTargetsForDate(timetable, dateString);

    for (const target of targets) {
      const classStart = dateTimeFromDateAndTime(target.date, target.start);
      const classEnd = dateTimeFromDateAndTime(target.date, target.end);
      const checkAt = addMinutes(classStart, CHECK_DELAY_MINUTES);
      let when = checkAt.getTime();

      if (when <= now.getTime()) {
        const canRunMissedNow =
          settings.includeMissedOngoingClasses && now.getTime() <= classEnd.getTime();
        if (!canRunMissedNow) {
          continue;
        }
        when = Date.now() + 15 * 1000;
      }

      await createAlarm(buildAlarmName(target.date, target.period), { when });
      created += 1;
    }
  }

  await scheduleNextDailyRebuild();
  const builtAt = new Date().toISOString();
  await setLastScheduleBuiltAt(builtAt);
  await appendLog("info", "通知スケジュール再作成", { alarm登録数: created, builtAt });
  return created;
}

export async function clearScheduledAlarms() {
  const alarms = await getAllAlarms();
  await clearAllAlarms();
  await setLastScheduleBuiltAt("");
  await appendLog("info", "通知スケジュール削除", { alarm削除数: alarms.length });
  return alarms.length;
}

export async function scheduleNextDailyRebuild() {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 5, 0, 0);
  await createAlarm(DAILY_REBUILD_ALARM, { when: tomorrow.getTime() });
}

export async function listAttendanceAlarms() {
  const alarms = await getAllAlarms();
  return alarms.filter((alarm) => Boolean(parseAttendanceAlarmName(alarm.name)));
}
