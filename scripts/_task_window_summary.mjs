const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function safeDate(value) {
  if (!value) return null;

  try {
    if (typeof value.toDate === "function") {
      return value.toDate();
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function dateFromKey(dateKey) {
  if (!dateKey) return null;

  const [year, month, day] = String(dateKey)
    .split("-")
    .map((part) => Number(part));

  if (!year || !month || !day) return null;

  return new Date(year, month - 1, day);
}

function toLocalDayKey(date) {
  if (!date) return null;

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfWeekLocal(date) {
  const base = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayOffset = (base.getDay() + 6) % 7;
  base.setDate(base.getDate() - dayOffset);
  base.setHours(0, 0, 0, 0);
  return base;
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function getWeekdayIndexMondayFirst(date) {
  return (date.getDay() + 6) % 7;
}

function formatWeekRange(start, end) {
  const sameMonth = start.getMonth() === end.getMonth();
  const sameYear = start.getFullYear() === end.getFullYear();
  const startLabel = start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
  const endLabel = end.toLocaleDateString("en-US", {
    month: sameMonth ? undefined : "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });

  return `${startLabel} - ${endLabel}`;
}

function getDateKey(task = {}) {
  if (task.startDate) return String(task.startDate).slice(0, 10);
  if (task.endDate) return String(task.endDate).slice(0, 10);

  const date =
    safeDate(task.startAt) ||
    safeDate(task.endAt) ||
    safeDate(task.dueDate) ||
    safeDate(task.completedAt) ||
    safeDate(task.missedAt) ||
    safeDate(task.updatedAt) ||
    safeDate(task.createdAt);

  return date ? date.toISOString().slice(0, 10) : null;
}

function getCompletedEventDate(task = {}) {
  return (
    safeDate(task.completedAt) ||
    safeDate(task.lastCompletedAt) ||
    safeDate(task.updatedAt) ||
    safeDate(task.endAt) ||
    safeDate(task.dueDate) ||
    dateFromKey(task.dateKey)
  );
}

function getMissedEventDate(task = {}) {
  return (
    safeDate(task.missedAt) ||
    safeDate(task.lastMissedAt) ||
    safeDate(task.updatedAt) ||
    safeDate(task.endAt) ||
    safeDate(task.dueDate) ||
    dateFromKey(task.dateKey)
  );
}

function getStatus(task = {}) {
  if (task.status === "completed") return "completed";
  if (task.status === "missed") return "missed";
  if (Number(task.completedCount || 0) > 0) return "completed";
  if (Number(task.missedCount || 0) > 0) return "missed";
  return "pending";
}

function isBehaviorTask(task = {}) {
  return task.coverageHistory !== true && task.coverageCandidate !== true;
}

function roundRate(completed, missed) {
  const denominator = completed + missed;
  return denominator === 0 ? null : Math.round((completed / denominator) * 100);
}

function average(values) {
  const numericValues = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (numericValues.length === 0) return null;

  return Number(
    (
      numericValues.reduce((total, value) => total + value, 0) /
      numericValues.length
    ).toFixed(1)
  );
}

function summarizeWindow(tasks, dates, label) {
  const dateSet = new Set(dates);
  const windowTasks = tasks.filter((task) => dateSet.has(task.dateKey));
  const completed = windowTasks.filter((task) => task.status === "completed").length;
  const missed = windowTasks.filter((task) => task.status === "missed").length;
  const pending = windowTasks.filter((task) => task.status === "pending").length;
  const decided = completed + missed;

  return {
    label,
    dates,
    total: windowTasks.length,
    completed,
    missed,
    pending,
    decided,
    completionRate: roundRate(completed, missed),
    averageActualMinutes: average(
      windowTasks.map((task) => task.totalActualMinutes ?? task.actualMinutes)
    ),
    averageEstimatedMinutes: average(
      windowTasks.map((task) => task.estimatedMinutes)
    ),
  };
}

function createWeekEntry(weekStart) {
  const start = startOfWeekLocal(weekStart);
  const weekKey = toLocalDayKey(start);
  const days = WEEKDAY_LABELS.map((label, index) => {
    const date = addDays(start, index);

    return {
      label,
      key: toLocalDayKey(date),
      completed: 0,
      missed: 0,
    };
  });

  return {
    weekKey,
    label: formatWeekRange(start, addDays(start, 6)),
    startDate: toLocalDayKey(start),
    endDate: toLocalDayKey(addDays(start, 6)),
    days,
    completedTotal: 0,
    missedTotal: 0,
    totalActivity: 0,
    completionRate: null,
    status: "none",
    statusLabel: "No data yet",
    message: "No completed or missed tasks recorded for this week yet.",
  };
}

function describeWeeklyProgress(week) {
  if (week.completedTotal > week.missedTotal) {
    return {
      status: "good",
      statusLabel: "Good week",
      message: `Strong week with ${week.completedTotal} completed task${
        week.completedTotal !== 1 ? "s" : ""
      } and ${week.missedTotal} missed task${week.missedTotal !== 1 ? "s" : ""}.`,
    };
  }

  if (week.missedTotal > week.completedTotal) {
    return {
      status: "bad",
      statusLabel: "Needs attention",
      message: `This week needs attention with ${week.missedTotal} missed task${
        week.missedTotal !== 1 ? "s" : ""
      } and ${week.completedTotal} completed task${
        week.completedTotal !== 1 ? "s" : ""
      }.`,
    };
  }

  if (week.totalActivity > 0) {
    return {
      status: "neutral",
      statusLabel: "Balanced week",
      message: `Balanced week with ${week.completedTotal} completed and ${week.missedTotal} missed task${
        week.totalActivity !== 1 ? "s" : ""
      }.`,
    };
  }

  return {
    status: "none",
    statusLabel: "No data yet",
    message: "No completed or missed tasks recorded for this week yet.",
  };
}

function buildWeeklyProgress(tasks) {
  const weekMap = new Map();

  const ensureWeek = (date) => {
    const weekStart = startOfWeekLocal(date);
    const weekKey = toLocalDayKey(weekStart);

    if (!weekMap.has(weekKey)) {
      weekMap.set(weekKey, createWeekEntry(weekStart));
    }

    return weekMap.get(weekKey);
  };

  tasks.forEach((task) => {
    if (task.status === "completed") {
      const completedAt = getCompletedEventDate(task);
      if (completedAt) {
        const week = ensureWeek(completedAt);
        const day = week.days[getWeekdayIndexMondayFirst(completedAt)];
        day.completed += 1;
        week.completedTotal += 1;
      }
    }

    if (task.status === "missed") {
      const missedAt = getMissedEventDate(task);
      if (missedAt) {
        const week = ensureWeek(missedAt);
        const day = week.days[getWeekdayIndexMondayFirst(missedAt)];
        day.missed += 1;
        week.missedTotal += 1;
      }
    }
  });

  return [...weekMap.values()]
    .sort((left, right) => left.startDate.localeCompare(right.startDate))
    .map((week) => {
      const totalActivity = week.completedTotal + week.missedTotal;
      const description = describeWeeklyProgress({ ...week, totalActivity });

      return {
        ...week,
        totalActivity,
        completionRate: roundRate(week.completedTotal, week.missedTotal),
        ...description,
      };
    });
}

function getTrend(day1To6, day7To12) {
  if (
    day1To6.completionRate == null ||
    day7To12.completionRate == null ||
    day1To6.decided === 0 ||
    day7To12.decided === 0
  ) {
    return {
      delta: null,
      trend: "not_enough_data",
      trendLabel: "Not enough data",
    };
  }

  const delta = day7To12.completionRate - day1To6.completionRate;
  if (delta >= 5) {
    return { delta, trend: "improving", trendLabel: "Improving" };
  }

  if (delta <= -5) {
    return { delta, trend: "no_improvement", trendLabel: "No improvement" };
  }

  return { delta, trend: "stable", trendLabel: "Stable" };
}

export function buildTaskWindowSummary(tasks = [], uid = null) {
  const behaviorTasks = tasks
    .filter(isBehaviorTask)
    .map((task) => ({
      ...task,
      dateKey: getDateKey(task),
      status: getStatus(task),
    }))
    .filter((task) => task.dateKey)
    .sort((left, right) => {
      if (left.dateKey !== right.dateKey) {
        return left.dateKey.localeCompare(right.dateKey);
      }

      return String(left.startTime || left.startAt || left.id).localeCompare(
        String(right.startTime || right.startAt || right.id)
      );
    });

  const dates = [...new Set(behaviorTasks.map((task) => task.dateKey))].sort();
  const day1To6 = summarizeWindow(behaviorTasks, dates.slice(0, 6), "Days 1-6");
  const day7To12 = summarizeWindow(behaviorTasks, dates.slice(6, 12), "Days 7-12");
  const totals = summarizeWindow(behaviorTasks, dates, "All days");
  const weeklyProgress = buildWeeklyProgress(behaviorTasks);
  const trend = getTrend(day1To6, day7To12);

  return {
    uid,
    source: "task_history_import",
    summaryVersion: 1,
    generatedAt: new Date(),
    startDate: dates[0] || null,
    endDate: dates[dates.length - 1] || null,
    observedDayCount: dates.length,
    day1To6,
    day7To12,
    weeklyProgress,
    totals,
    ...trend,
  };
}
