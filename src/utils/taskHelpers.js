import normalizeTitle from "./normalizeTitle";

export const DAILY_WORKLOAD_LIMIT_MINUTES = 12 * 60;
export const MAX_SIMULTANEOUS_SCHEDULED_TASKS = 1;
export const DEFAULT_SEARCH_STEP_MINUTES = 15;
export const DEFAULT_SEGMENT_SEARCH_DAYS = 14;

export function breakLabel(minutes) {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(hours % 1 === 0 ? 0 : 1)} h`;
  const days = minutes / 1440;
  return `${days.toFixed(days % 1 === 0 ? 0 : 1)} day(s)`;
}

export function safeDate(value) {
  if (!value) return null;

  try {
    if (typeof value?.toDate === "function") {
      return value.toDate();
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

export function inferAutoTrackedActualMinutes(task = {}, resolvedAt = new Date()) {
  if (!task) {
    return null;
  }

  if ((task.mode || "scheduled") === "floating") {
    return null;
  }

  const start =
    safeDate(task.startAt) || buildLocalDateTime(task.startDate, task.startTime);
  const end = safeDate(resolvedAt);

  if (!start || !end || end <= start) {
    return null;
  }

  const minutes = Number(
    (((end.getTime() - start.getTime()) / 1000) / 60).toFixed(4)
  );
  return minutes > 0 ? minutes : null;
}

export function buildLocalDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;

  const date = new Date(`${dateStr}T${timeStr}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toLocalDateInput(value) {
  const date = safeDate(value);
  if (!date) return "";

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

export function toLocalTimeInput(value) {
  const date = safeDate(value);
  if (!date) return "";

  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

export function roundUpToStep(value, stepMinutes = DEFAULT_SEARCH_STEP_MINUTES) {
  const date = safeDate(value);
  if (!date) return null;

  const rounded = new Date(date);
  rounded.setSeconds(0, 0);

  const stepMs = stepMinutes * 60000;
  const roundedMs = Math.ceil(rounded.getTime() / stepMs) * stepMs;
  return new Date(roundedMs);
}

export function resolveTaskWindow(task = {}) {
  const start =
    safeDate(task.startAt) || buildLocalDateTime(task.startDate, task.startTime);
  const end =
    safeDate(task.endAt) || buildLocalDateTime(task.endDate, task.endTime);

  if (!start || !end || end <= start) {
    return { start: null, end: null };
  }

  return { start, end };
}

export function isResolvedTask(task = {}) {
  return (
    task.finalized === true ||
    task.status === "completed" ||
    task.status === "missed" ||
    Number(task.completedCount || 0) > 0 ||
    Number(task.missedCount || 0) > 0
  );
}

export function isPendingScheduledTask(task = {}) {
  const { start, end } = resolveTaskWindow(task);
  return Boolean(start && end) && !isResolvedTask(task) && !task.isSplitParent;
}

export function rangesOverlap(startA, endA, startB, endB) {
  if (!startA || !endA || !startB || !endB) return false;
  return startA < endB && startB < endA;
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function nextLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

function minutesBetween(start, end) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function minutesWithinDay(start, end, dayStart, dayEnd) {
  const boundedStart = start > dayStart ? start : dayStart;
  const boundedEnd = end < dayEnd ? end : dayEnd;

  if (boundedEnd <= boundedStart) {
    return 0;
  }

  return minutesBetween(boundedStart, boundedEnd);
}

export function findScheduleConflicts(
  tasks,
  start,
  end,
  { excludeTaskId = null } = {}
) {
  const candidateStart = safeDate(start);
  const candidateEnd = safeDate(end);

  if (!candidateStart || !candidateEnd || candidateEnd <= candidateStart) {
    return [];
  }

  return tasks.filter((task) => {
    if (!isPendingScheduledTask(task)) return false;
    if (excludeTaskId && task.id === excludeTaskId) return false;

    const { start: taskStart, end: taskEnd } = resolveTaskWindow(task);
    return rangesOverlap(candidateStart, candidateEnd, taskStart, taskEnd);
  });
}

export function findDuplicateScheduledTasks(
  tasks,
  normalizedTitle,
  start,
  end,
  { excludeTaskId = null, candidateIsSplitTask = false } = {}
) {
  const candidateTitle = normalizeTitle(normalizedTitle);

  if (!candidateTitle || candidateIsSplitTask) {
    return [];
  }

  return findScheduleConflicts(tasks, start, end, { excludeTaskId }).filter(
    (task) => {
      if (task?.isSplitParent || task?.isSplitSegment) {
        return false;
      }

      const taskTitle = normalizeTitle(
        task?.normalizedTitle || task?.patternKey || task?.title || ""
      );

      return taskTitle === candidateTitle;
    }
  );
}

export function getScheduledMinutesForDay(
  tasks,
  date,
  { excludeTaskId = null } = {}
) {
  const day = safeDate(date);
  if (!day) return 0;

  const dayStart = startOfLocalDay(day);
  const dayEnd = nextLocalDay(dayStart);

  return tasks.reduce((total, task) => {
    if (!isPendingScheduledTask(task)) return total;
    if (excludeTaskId && task.id === excludeTaskId) return total;

    const { start, end } = resolveTaskWindow(task);
    return total + minutesWithinDay(start, end, dayStart, dayEnd);
  }, 0);
}

export function validateScheduledSlot(
  tasks,
  start,
  end,
  {
    excludeTaskId = null,
    normalizedTitle = "",
    candidateIsSplitTask = false,
    checkDuplicateTitles = true,
    maxConcurrent = MAX_SIMULTANEOUS_SCHEDULED_TASKS,
    dailyLimitMinutes = DAILY_WORKLOAD_LIMIT_MINUTES,
  } = {}
) {
  const candidateStart = safeDate(start);
  const candidateEnd = safeDate(end);

  if (!candidateStart || !candidateEnd || candidateEnd <= candidateStart) {
    return {
      isValid: false,
      conflicts: [],
      duplicates: [],
      overloadedDays: [],
      reason: "invalid_range",
    };
  }

  const conflicts = findScheduleConflicts(tasks, candidateStart, candidateEnd, {
    excludeTaskId,
  });
  const duplicates = checkDuplicateTitles
    ? findDuplicateScheduledTasks(tasks, normalizedTitle, candidateStart, candidateEnd, {
        excludeTaskId,
        candidateIsSplitTask,
      })
    : [];
  const overloadedDays = [];

  let cursor = startOfLocalDay(candidateStart);
  const lastDay = startOfLocalDay(candidateEnd);

  while (cursor <= lastDay) {
    const dayEnd = nextLocalDay(cursor);
    const existingMinutes = getScheduledMinutesForDay(tasks, cursor, {
      excludeTaskId,
    });
    const requestedMinutes = minutesWithinDay(
      candidateStart,
      candidateEnd,
      cursor,
      dayEnd
    );
    const totalMinutes = existingMinutes + requestedMinutes;

    if (requestedMinutes > 0 && totalMinutes > dailyLimitMinutes) {
      overloadedDays.push({
        date: new Date(cursor),
        existingMinutes,
        requestedMinutes,
        totalMinutes,
      });
    }

    cursor = nextLocalDay(cursor);
  }

  const exceedsSlotCapacity = conflicts.length >= maxConcurrent;
  const hasDuplicateOverlap = duplicates.length > 0;
  const isValid =
    !hasDuplicateOverlap && !exceedsSlotCapacity && overloadedDays.length === 0;
  const reason = hasDuplicateOverlap
    ? "duplicate"
    : exceedsSlotCapacity
    ? "overlap"
    : overloadedDays.length > 0
    ? "daily_limit"
    : null;

  return {
    isValid,
    conflicts,
    duplicates,
    overloadedDays,
    reason,
  };
}

export function buildScheduleValidationMessage(validation) {
  if (!validation) {
    return "This schedule is not available.";
  }

  if (validation.reason === "invalid_range") {
    return "The selected schedule is invalid.";
  }

  if (validation.reason === "duplicate" && validation.duplicates.length > 0) {
    const names = validation.duplicates
      .slice(0, 3)
      .map((task) => `"${task.title || "Untitled task"}"`);
    const moreCount = validation.duplicates.length - names.length;
    const moreLabel =
      moreCount > 0 ? ` and ${moreCount} more matching task(s)` : "";

    return `A task with the same title is already scheduled in that time frame: ${names.join(", ")}${moreLabel}. Choose a different time or continue anyway if that overlap is intentional.`;
  }

  if (validation.reason === "overlap" && validation.conflicts.length > 0) {
    const names = validation.conflicts
      .slice(0, 3)
      .map((task) => `"${task.title || "Untitled task"}"`);
    const moreCount = validation.conflicts.length - names.length;
    const moreLabel =
      moreCount > 0 ? ` and ${moreCount} more overlapping task(s)` : "";

    return `This time slot is already occupied by ${names.join(", ")}${moreLabel}. Adjust the schedule before adding another task.`;
  }

  if (validation.reason === "daily_limit" && validation.overloadedDays.length) {
    const firstOverloadedDay = validation.overloadedDays[0];
    const hours = (firstOverloadedDay.totalMinutes / 60).toFixed(1);
    const dateLabel = firstOverloadedDay.date.toLocaleDateString();

    return `The workload for ${dateLabel} would reach ${hours} hours, which exceeds the daily scheduling limit. Move or shorten the task first.`;
  }

  return "This schedule is not available.";
}

function sanitizeSegmentTitle(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toSentenceCase(value) {
  const clean = sanitizeSegmentTitle(value);
  if (!clean) return "";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export function suggestSegmentTitles(title, segmentCount) {
  const cleanTitle = sanitizeSegmentTitle(title);
  if (!cleanTitle) {
    return Array.from({ length: segmentCount }, (_, index) => `Part ${index + 1}`);
  }

  const directParts = cleanTitle
    .split(/\s*(?:,|;|\/| then | and then | & | \+ )\s*/i)
    .map((part) => toSentenceCase(part))
    .filter((part) => part.length >= 3);

  const uniqueParts = [...new Set(directParts)];
  if (uniqueParts.length >= 2) {
    return Array.from({ length: segmentCount }, (_, index) => {
      const part = uniqueParts[index];
      return part || `${cleanTitle} - Part ${index + 1}`;
    });
  }

  const fallbackStagesByCount = {
    2: ["Preparation", "Finalization"],
    3: ["Preparation", "Execution", "Finalization"],
    4: ["Preparation", "Execution", "Review", "Finalization"],
    5: ["Preparation", "Execution", "Checkpoint", "Review", "Finalization"],
  };
  const stages =
    fallbackStagesByCount[segmentCount] ||
    Array.from({ length: segmentCount }, (_, index) => `Part ${index + 1}`);

  return stages.map((stage) =>
    stage.startsWith("Part")
      ? `${cleanTitle} - ${stage}`
      : `${stage}: ${cleanTitle}`
  );
}

export function getPreferredStartMinutes(task = {}) {
  const baseStart = safeDate(task.startAt);
  if (baseStart) {
    return baseStart.getHours() * 60 + baseStart.getMinutes();
  }

  return 8 * 60;
}

function dateWithMinuteOfDay(date, minuteOfDay) {
  const next = new Date(date);
  next.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  return next;
}

export function findNextAvailableWindow({
  tasks,
  desiredStart,
  durationMinutes,
  excludeTaskId = null,
  normalizedTitle = "",
  candidateIsSplitTask = false,
  checkDuplicateTitles = true,
  preferredStartMinutes = 8 * 60,
  stepMinutes = DEFAULT_SEARCH_STEP_MINUTES,
  maxSearchDays = DEFAULT_SEGMENT_SEARCH_DAYS,
  maxConcurrent = MAX_SIMULTANEOUS_SCHEDULED_TASKS,
  dailyLimitMinutes = DAILY_WORKLOAD_LIMIT_MINUTES,
}) {
  const candidateStart = roundUpToStep(desiredStart, stepMinutes);
  if (!candidateStart || !durationMinutes || durationMinutes <= 0) {
    return null;
  }

  let cursor = candidateStart;
  const searchLimit = new Date(candidateStart);
  searchLimit.setDate(searchLimit.getDate() + maxSearchDays);

  while (cursor < searchLimit) {
    const end = new Date(cursor.getTime() + durationMinutes * 60000);
    const validation = validateScheduledSlot(tasks, cursor, end, {
      excludeTaskId,
      normalizedTitle,
      candidateIsSplitTask,
      checkDuplicateTitles,
      maxConcurrent,
      dailyLimitMinutes,
    });

    if (validation.isValid) {
      return { start: cursor, end, validation };
    }

    if (validation.conflicts.length > 0) {
      const latestConflictEnd = validation.conflicts.reduce((latest, task) => {
        const { end: taskEnd } = resolveTaskWindow(task);
        if (!taskEnd) return latest;
        return taskEnd.getTime() > latest ? taskEnd.getTime() : latest;
      }, cursor.getTime());

      cursor = roundUpToStep(new Date(latestConflictEnd), stepMinutes);
      continue;
    }

    const nextDay = nextLocalDay(startOfLocalDay(cursor));
    cursor = roundUpToStep(
      dateWithMinuteOfDay(nextDay, preferredStartMinutes),
      stepMinutes
    );
  }

  return null;
}

export function scheduleSuggestedSegments({
  task,
  segmentTitles,
  segmentMinutes,
  breakMinutes = 0,
  existingTasks = [],
}) {
  const baseStart = safeDate(task?.startAt);
  const preferredStartMinutes = getPreferredStartMinutes(task);

  if (!baseStart || !segmentMinutes || segmentMinutes <= 0) {
    return null;
  }

  const plannedSegments = [];
  let desiredStart = baseStart;

  for (const title of segmentTitles) {
    const availabilityWindow = findNextAvailableWindow({
      tasks: [
        ...existingTasks,
        ...plannedSegments.map((segment, index) => ({
          id: `planned-segment-${index}`,
          startAt: segment.startAt,
          endAt: segment.endAt,
          status: "pending",
        })),
      ],
      desiredStart,
      durationMinutes: segmentMinutes,
      excludeTaskId: task.id,
      preferredStartMinutes,
    });

    if (!availabilityWindow) {
      return null;
    }

    const segmentStart = availabilityWindow.start;
    const segmentEnd = availabilityWindow.end;

    plannedSegments.push({
      title,
      startAt: segmentStart,
      endAt: segmentEnd,
      startDate: toLocalDateInput(segmentStart),
      startTime: toLocalTimeInput(segmentStart),
      endDate: toLocalDateInput(segmentEnd),
      endTime: toLocalTimeInput(segmentEnd),
      dueDate: segmentEnd,
    });

    desiredStart = new Date(segmentEnd.getTime() + breakMinutes * 60000);
  }

  return plannedSegments;
}
