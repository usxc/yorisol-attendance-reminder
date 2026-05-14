export const STORAGE_KEYS = {
  TIMETABLE: "timetable",
  LAST_SCHEDULE_BUILT_AT: "lastScheduleBuiltAt",
  LOGS: "logs",
  LAST_RESULTS: "lastResults",
  NOTIFICATION_PAYLOADS: "notificationPayloads",
  SETTINGS: "settings"
};

export const MAX_LOG_ENTRIES = 100;
export const MAX_NOTIFICATION_PAYLOADS = 50;
export const MAX_TIMETABLE_ENTRIES = 2000;
export const MAX_TIMETABLE_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_TIMETABLE_TEXT_LENGTH = 200;

export const DEFAULT_SETTINGS = {
  includeMissedOngoingClasses: true,
  closeCheckTabWhenDone: true,
  keepLoginTabOpen: true,
  scheduleDaysAhead: 2
};

export const ALARM_PREFIX = "attendance";
export const DAILY_REBUILD_ALARM = "attendance:daily-rebuild";

export const ATTENDANCE_STATUSES = {
  ALREADY_ATTENDED: "already_attended",
  NEED_ATTEND: "need_attend",
  NO_BUTTON: "no_button",
  COURSE_NOT_FOUND: "course_not_found",
  NODE_NOT_FOUND: "node_not_found",
  MULTIPLE_BUTTONS: "multiple_buttons",
  LOGIN_REQUIRED: "login_required",
  ERROR: "error"
};

export const NOTIFICATION_IDS = {
  NEED_ATTEND_PREFIX: "need-attend",
  LOGIN_REQUIRED_PREFIX: "login-required",
  MULTIPLE_BUTTONS_PREFIX: "multiple-buttons",
  ERROR_PREFIX: "check-error"
};
