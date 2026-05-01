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

function getStatus(task = {}) {
  if (task.status === "completed") return "completed";
  if (task.status === "missed") return "missed";
  if (Number(task.completedCount || 0) > 0) return "completed";
  if (Number(task.missedCount || 0) > 0) return "missed";
  return "pending";
}

function isBehaviorTask(task = {}) {
  return task.demoCoverageHistory !== true && task.demoCoverageCandidate !== true;
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
    totals,
    ...trend,
  };
}
