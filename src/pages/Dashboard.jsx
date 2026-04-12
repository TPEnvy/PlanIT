import React, { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useAuth } from "../contexts/AuthContext";
import { firestore } from "../server.js/firebase";
import Navbar from "../components/Navbar";
import PageTransition from "../components/PageTransition";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function safeDate(val) {
  if (!val) return null;
  try {
    if (val.toDate && typeof val.toDate === "function") return val.toDate();
    const date = new Date(val);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
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

function resolveCompletedEventDate(task) {
  return (
    safeDate(task.completedAt) ||
    safeDate(task.lastCompletedAt) ||
    ((task.status === "completed" || Number(task.completedCount || 0) > 0) &&
      (safeDate(task.updatedAt) ||
        safeDate(task.endAt) ||
        safeDate(task.dueDate) ||
        safeDate(task.createdAt))) ||
    null
  );
}

function resolveMissedEventDate(task) {
  return (
    safeDate(task.missedAt) ||
    safeDate(task.lastMissedAt) ||
    ((task.status === "missed" || Number(task.missedCount || 0) > 0) &&
      (safeDate(task.updatedAt) ||
        safeDate(task.endAt) ||
        safeDate(task.dueDate) ||
        safeDate(task.createdAt))) ||
    null
  );
}

function createWeekEntry(weekStart, todayKey) {
  const start = startOfWeekLocal(weekStart);
  const weekKey = toLocalDayKey(start);
  const days = WEEKDAY_LABELS.map((label, index) => {
    const date = addDays(start, index);
    const key = toLocalDayKey(date);

    return {
      label,
      key,
      date,
      completed: 0,
      missed: 0,
      isToday: key === todayKey,
    };
  });

  return {
    weekKey,
    start,
    end: addDays(start, 6),
    days,
    completedTotal: 0,
    missedTotal: 0,
    totalActivity: 0,
    status: "none",
    message: "No completed or missed tasks recorded for this week yet.",
  };
}

function formatWeekRange(start, end) {
  const sameMonth = start.getMonth() === end.getMonth();
  const sameYear = start.getFullYear() === end.getFullYear();

  const startLabel = start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
  const endLabel = end.toLocaleDateString(undefined, {
    month: sameMonth ? undefined : "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });

  return `${startLabel} - ${endLabel}`;
}

function describeWeek(week) {
  if (week.completedTotal > week.missedTotal) {
    return {
      status: "good",
      message: `Strong week with ${week.completedTotal} completed task${
        week.completedTotal !== 1 ? "s" : ""
      } and ${week.missedTotal} missed task${
        week.missedTotal !== 1 ? "s" : ""
      }.`,
    };
  }

  if (week.missedTotal > week.completedTotal) {
    return {
      status: "bad",
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
      message: `Balanced week with ${week.completedTotal} completed and ${week.missedTotal} missed task${
        week.totalActivity !== 1 ? "s" : ""
      }.`,
    };
  }

  return {
    status: "none",
    message: "No completed or missed tasks recorded for this week yet.",
  };
}

function getStatusBadge(status) {
  if (status === "good") {
    return {
      text: "Good week",
      className: "bg-emerald-100 text-emerald-800",
    };
  }

  if (status === "bad") {
    return {
      text: "Needs attention",
      className: "bg-red-100 text-red-700",
    };
  }

  if (status === "neutral") {
    return {
      text: "Balanced week",
      className: "bg-yellow-100 text-yellow-800",
    };
  }

  return {
    text: "No data yet",
    className: "bg-gray-100 text-gray-700",
  };
}

export default function Dashboard() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [selectedWeekKey, setSelectedWeekKey] = useState("");

  useEffect(() => {
    if (!user) return;

    const tasksRef = collection(firestore, `users/${user.uid}/tasks`);
    const tasksQuery = query(tasksRef, orderBy("createdAt", "asc"));

    const unsub = onSnapshot(tasksQuery, (snapshot) => {
      const list = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
      setTasks(list);
    });

    return () => unsub();
  }, [user]);

  const {
    totalTasks,
    completedTasks,
    weeks,
    currentWeekKey,
    defaultWeekKey,
  } = useMemo(() => {
    const today = new Date();
    const todayKey = toLocalDayKey(today);
    const currentWeekStart = startOfWeekLocal(today);
    const currentWeekKeyLocal = toLocalDayKey(currentWeekStart);
    const weekMap = new Map();

    const ensureWeekEntry = (date) => {
      const weekStart = startOfWeekLocal(date);
      const weekKey = toLocalDayKey(weekStart);

      if (!weekMap.has(weekKey)) {
        weekMap.set(weekKey, createWeekEntry(weekStart, todayKey));
      }

      return weekMap.get(weekKey);
    };

    ensureWeekEntry(currentWeekStart);

    let completed = 0;

    tasks.forEach((task) => {
      if ((task.completedCount || 0) > 0 || task.status === "completed") {
        completed += 1;
      }

      const completedAt = resolveCompletedEventDate(task);
      const missedAt = resolveMissedEventDate(task);

      if (completedAt) {
        const week = ensureWeekEntry(completedAt);
        const dayIndex = getWeekdayIndexMondayFirst(completedAt);
        week.days[dayIndex].completed += 1;
        week.completedTotal += 1;
      }

      if (missedAt) {
        const week = ensureWeekEntry(missedAt);
        const dayIndex = getWeekdayIndexMondayFirst(missedAt);
        week.days[dayIndex].missed += 1;
        week.missedTotal += 1;
      }
    });

    const orderedWeeks = Array.from(weekMap.values())
      .map((week) => {
        const totalActivity = week.completedTotal + week.missedTotal;
        const { status, message } = describeWeek({
          ...week,
          totalActivity,
        });

        return {
          ...week,
          totalActivity,
          status,
          message,
          label: formatWeekRange(week.start, week.end),
        };
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    const currentWeek = orderedWeeks.find(
      (week) => week.weekKey === currentWeekKeyLocal
    );
    const latestActiveWeek =
      [...orderedWeeks].reverse().find((week) => week.totalActivity > 0) ||
      currentWeek ||
      orderedWeeks[orderedWeeks.length - 1];

    return {
      totalTasks: tasks.length,
      completedTasks: completed,
      weeks: orderedWeeks,
      currentWeekKey: currentWeekKeyLocal,
      defaultWeekKey:
        currentWeek && currentWeek.totalActivity > 0
          ? currentWeek.weekKey
          : latestActiveWeek?.weekKey || currentWeekKeyLocal,
    };
  }, [tasks]);

  useEffect(() => {
    if (!weeks.length) {
      setSelectedWeekKey("");
      return;
    }

    if (!selectedWeekKey || !weeks.some((week) => week.weekKey === selectedWeekKey)) {
      setSelectedWeekKey(defaultWeekKey);
    }
  }, [weeks, selectedWeekKey, defaultWeekKey]);

  const selectedWeek =
    weeks.find((week) => week.weekKey === selectedWeekKey) ||
    weeks.find((week) => week.weekKey === defaultWeekKey) ||
    weeks[weeks.length - 1] ||
    createWeekEntry(new Date(), toLocalDayKey(new Date()));

  const selectedWeekIndex = weeks.findIndex(
    (week) => week.weekKey === selectedWeek.weekKey
  );
  const previousWeek =
    selectedWeekIndex > 0 ? weeks[selectedWeekIndex - 1] : null;
  const nextWeek =
    selectedWeekIndex >= 0 && selectedWeekIndex < weeks.length - 1
      ? weeks[selectedWeekIndex + 1]
      : null;

  const completionRate =
    totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);

  const maxDailyCount = selectedWeek.days.reduce((max, day) => {
    const dayPeak = Math.max(day.completed, day.missed);
    return dayPeak > max ? dayPeak : max;
  }, 0);
  const chartMax = maxDailyCount || 1;

  const pieTotal = selectedWeek.completedTotal + selectedWeek.missedTotal;
  const completedAngle =
    pieTotal === 0 ? 0 : (selectedWeek.completedTotal / pieTotal) * 360;
  const pieStyle =
    pieTotal === 0
      ? {
          background:
            "conic-gradient(#e5e7eb 0deg 360deg)",
        }
      : {
          background: `conic-gradient(#10b981 0deg ${completedAngle}deg, #f87171 ${completedAngle}deg 360deg)`,
        };

  const statusBadge = getStatusBadge(selectedWeek.status);
  const weekHistory = [...weeks].reverse();

  return (
    <PageTransition>
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-500">
        <Navbar />

        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          <header className="mb-6">
            <h1 className="text-3xl font-bold text-emerald-800">Dashboard</h1>
            <p className="text-sm text-gray-600 mt-1">
              Overview of your tasks, weekly results, and performance trends.
            </p>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="bg-white rounded-xl shadow p-4 border border-emerald-100">
              <div className="text-xs font-medium text-emerald-600 uppercase">
                Total Tasks
              </div>
              <div className="text-3xl font-bold text-gray-800 mt-1">
                {totalTasks}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                All tasks you have created.
              </p>
            </div>

            <div className="bg-white rounded-xl shadow p-4 border border-emerald-100">
              <div className="text-xs font-medium text-emerald-600 uppercase">
                Completed Tasks
              </div>
              <div className="text-3xl font-bold text-gray-800 mt-1">
                {completedTasks}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Tasks marked as completed at least once.
              </p>
            </div>

            <div className="bg-white rounded-xl shadow p-4 border border-emerald-100">
              <div className="text-xs font-medium text-emerald-600 uppercase">
                Completion Rate
              </div>
              <div className="text-3xl font-bold text-gray-800 mt-1">
                {completionRate}%
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Completed vs total tasks.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-6 border border-emerald-100">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6">
              <div>
                <h2 className="text-lg font-semibold text-emerald-800">
                  Weekly Productivity
                </h2>
                <span className="text-xs text-gray-500">
                  Monday to Sunday daily completed and missed task activity.
                </span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <button
                  type="button"
                  onClick={() => previousWeek && setSelectedWeekKey(previousWeek.weekKey)}
                  disabled={!previousWeek}
                  className="px-3 py-1.5 rounded-lg border border-emerald-200 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous week
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedWeekKey(currentWeekKey)}
                  className="px-3 py-1.5 rounded-lg border border-emerald-200 text-xs font-medium text-emerald-700 bg-white hover:bg-emerald-50"
                >
                  Current week
                </button>
                <button
                  type="button"
                  onClick={() => nextWeek && setSelectedWeekKey(nextWeek.weekKey)}
                  disabled={!nextWeek}
                  className="px-3 py-1.5 rounded-lg border border-emerald-200 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next week
                </button>
              </div>
            </div>

            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
              <div>
                <div className="text-sm font-semibold text-gray-800">
                  Selected week: {selectedWeek.label}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {selectedWeek.weekKey === currentWeekKey
                    ? "This is the current week."
                    : "Viewing a previous week from your history."}
                </div>
              </div>

              <span
                className={
                  "inline-flex px-3 py-1 rounded-full text-xs font-semibold " +
                  statusBadge.className
                }
              >
                {statusBadge.text}
              </span>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <div className="xl:col-span-2">
                <div className="flex flex-wrap gap-3 text-xs mb-4">
                  <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-emerald-800">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    Completed: <strong>{selectedWeek.completedTotal}</strong>
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-red-700">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-400" />
                    Missed: <strong>{selectedWeek.missedTotal}</strong>
                  </span>
                </div>

                <p className="text-xs text-gray-600 mb-4">
                  {selectedWeek.message}
                </p>

                <div className="w-full">
                  <div className="relative h-64 sm:h-72 flex items-end gap-2 sm:gap-3 border-b border-gray-200 pb-6">
                    {selectedWeek.days.map((day) => {
                      const completedHeight =
                        day.completed === 0
                          ? "12%"
                          : `${Math.max(18, (day.completed / chartMax) * 100)}%`;
                      const missedHeight =
                        day.missed === 0
                          ? "12%"
                          : `${Math.max(18, (day.missed / chartMax) * 100)}%`;

                      return (
                        <div
                          key={day.key}
                          className="flex-1 h-full flex flex-col items-center justify-end gap-2"
                        >
                          <div className="text-[10px] text-gray-400 h-4">
                            {day.completed + day.missed > 0
                              ? `${day.completed + day.missed}`
                              : ""}
                          </div>
                          <div className="w-full min-h-[180px] flex-1 self-stretch flex items-end justify-center gap-1 sm:gap-1.5">
                            <div
                              className={
                                "w-4 sm:w-5 min-h-[12px] rounded-t-lg shadow-sm transition-all " +
                                (day.completed > 0
                                  ? "bg-gradient-to-t from-emerald-600 to-emerald-300"
                                  : "bg-emerald-100")
                              }
                              style={{ height: completedHeight }}
                              title={`${day.date.toLocaleDateString(undefined, {
                                weekday: "long",
                                month: "short",
                                day: "numeric",
                              })}: ${day.completed} completed task${
                                day.completed !== 1 ? "s" : ""
                              }`}
                            />
                            <div
                              className={
                                "w-4 sm:w-5 min-h-[12px] rounded-t-lg shadow-sm transition-all " +
                                (day.missed > 0
                                  ? "bg-gradient-to-t from-red-500 to-red-300"
                                  : "bg-red-100")
                              }
                              style={{ height: missedHeight }}
                              title={`${day.date.toLocaleDateString(undefined, {
                                weekday: "long",
                                month: "short",
                                day: "numeric",
                              })}: ${day.missed} missed task${
                                day.missed !== 1 ? "s" : ""
                              }`}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex gap-2 mt-2 text-[11px] text-gray-500 justify-between">
                    {selectedWeek.days.map((day) => (
                      <div key={day.key} className="flex-1 text-center">
                        <div
                          className={
                            "font-semibold " +
                            (day.isToday && selectedWeek.weekKey === currentWeekKey
                              ? "text-emerald-700"
                              : "text-gray-600")
                          }
                        >
                          {day.label}
                        </div>
                        <div>{day.date.getDate()}</div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-600">
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-block h-3 w-3 rounded-sm bg-gradient-to-t from-emerald-600 to-emerald-300" />
                      Completed
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-block h-3 w-3 rounded-sm bg-gradient-to-t from-red-500 to-red-300" />
                      Missed
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-5">
                <h3 className="text-sm font-semibold text-emerald-800 mb-4">
                  Weekly Comparison
                </h3>

                <div className="flex items-center justify-center mb-5">
                  <div
                    className="relative h-44 w-44 rounded-full shadow-inner"
                    style={pieStyle}
                    title={`${selectedWeek.completedTotal} completed, ${selectedWeek.missedTotal} missed`}
                  >
                    <div className="absolute inset-7 rounded-full bg-white flex flex-col items-center justify-center text-center shadow-sm">
                      <span className="text-[11px] uppercase tracking-wide text-gray-500">
                        Total
                      </span>
                      <span className="text-2xl font-bold text-gray-800">
                        {pieTotal}
                      </span>
                      <span className="text-[11px] text-gray-500">
                        task results
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-emerald-100">
                    <span className="inline-flex items-center gap-2 text-gray-700">
                      <span className="inline-block h-3 w-3 rounded-full bg-emerald-500" />
                      Completed
                    </span>
                    <span className="font-semibold text-emerald-800">
                      {selectedWeek.completedTotal}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 border border-red-100">
                    <span className="inline-flex items-center gap-2 text-gray-700">
                      <span className="inline-block h-3 w-3 rounded-full bg-red-400" />
                      Missed
                    </span>
                    <span className="font-semibold text-red-700">
                      {selectedWeek.missedTotal}
                    </span>
                  </div>
                </div>

                {previousWeek && (
                  <div className="mt-5 rounded-xl bg-white border border-gray-100 p-3 text-xs text-gray-600">
                    <div className="font-semibold text-gray-700 mb-1">
                      Previous week comparison
                    </div>
                    <div>{previousWeek.label}</div>
                    <div className="mt-2">
                      Completed: <strong>{previousWeek.completedTotal}</strong>
                    </div>
                    <div>
                      Missed: <strong>{previousWeek.missedTotal}</strong>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6">
              <div className="text-xs font-semibold text-gray-600 mb-3">
                Week history
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {weekHistory.map((week) => {
                  const weekBadge = getStatusBadge(week.status);
                  const isSelected = week.weekKey === selectedWeek.weekKey;

                  return (
                    <button
                      key={week.weekKey}
                      type="button"
                      onClick={() => setSelectedWeekKey(week.weekKey)}
                      className={
                        "min-w-[180px] rounded-2xl border p-3 text-left transition " +
                        (isSelected
                          ? "border-emerald-400 bg-emerald-50 shadow"
                          : "border-gray-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/40")
                      }
                    >
                      <div className="text-sm font-semibold text-gray-800">
                        {week.label}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="text-emerald-700">
                          Completed: <strong>{week.completedTotal}</strong>
                        </span>
                        <span className="text-red-600">
                          Missed: <strong>{week.missedTotal}</strong>
                        </span>
                      </div>
                      <div className="mt-2">
                        <span
                          className={
                            "inline-flex px-2 py-1 rounded-full text-[10px] font-semibold " +
                            weekBadge.className
                          }
                        >
                          {weekBadge.text}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
