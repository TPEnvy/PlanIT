// src/pages/Dashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useAuth } from "../contexts/AuthContext";
import { firestore } from "../server.js/firebase";
import Navbar from "../components/Navbar";

function safeDate(val) {
  if (!val) return null;
  try {
    if (val.toDate && typeof val.toDate === "function") return val.toDate();
    return new Date(val);
  } catch {
    return null;
  }
}

// Get week key like "YYYY-MM-DD" for Monday of that week
function getWeekKey(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0-6 (Sun-Sat)
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday as first day
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10); // YYYY-MM-DD
}

export default function Dashboard() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    if (!user) return;

    const tasksRef = collection(firestore, `users/${user.uid}/tasks`);
    const q = query(tasksRef, orderBy("createdAt", "asc"));

    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setTasks(list);
    });

    return () => unsub();
  }, [user]);

  const {
    totalTasks,
    completedTasks,
    weeklyData,
    currentWeekCount,
    previousWeekCount,
    weekStatus,
    weekMessage,
  } = useMemo(() => {
    if (!tasks.length) {
      return {
        totalTasks: 0,
        completedTasks: 0,
        weeklyData: [],
        currentWeekCount: 0,
        previousWeekCount: 0,
        weekStatus: "none",
        weekMessage:
          "No tasks yet. Create your first task to start tracking weeks.",
      };
    }

    let total = tasks.length;
    let completed = 0;
    const weeklyMap = {};

    tasks.forEach((task) => {
      const createdAt =
        safeDate(task.createdAt) || safeDate(task.created) || null;
      if (!createdAt) return;

      const weekKey = getWeekKey(createdAt);

      if (!weeklyMap[weekKey]) {
        weeklyMap[weekKey] = {
          weekKey,
          count: 0,
        };
      }
      weeklyMap[weekKey].count += 1;

      if ((task.completedCount || 0) > 0) {
        completed += 1;
      }
    });

    const weeklyArray = Object.values(weeklyMap).sort((a, b) =>
      a.weekKey.localeCompare(b.weekKey)
    );

    const todayKey = getWeekKey(new Date());
    const currentIndex = weeklyArray.findIndex((w) => w.weekKey === todayKey);

    let currentWeekCount = 0;
    let previousWeekCount = 0;
    let weekStatus = "none";
    let weekMessage = "Not enough data to evaluate this week yet.";

    if (currentIndex !== -1) {
      currentWeekCount = weeklyArray[currentIndex].count;

      if (currentIndex > 0) {
        previousWeekCount = weeklyArray[currentIndex - 1].count;

        if (currentWeekCount > previousWeekCount) {
          weekStatus = "good";
          weekMessage = "Good week! You created more tasks than last week.";
        } else if (currentWeekCount < previousWeekCount) {
          weekStatus = "bad";
          weekMessage =
            "This week is lighter than last week. Try adding a bit more focused work.";
        } else {
          weekStatus = "neutral";
          weekMessage = "Same level as last week. Consistent productivity.";
        }
      } else {
        if (currentWeekCount > 0) {
          weekStatus = "good";
          weekMessage =
            "Great start! You're building your first productive week.";
        } else {
          weekStatus = "neutral";
          weekMessage =
            "This is your first week. Start creating tasks to see progress.";
        }
      }
    } else {
      const last = weeklyArray[weeklyArray.length - 1];
      previousWeekCount = last?.count || 0;
      currentWeekCount = 0;

      if (previousWeekCount > 0) {
        weekStatus = "bad";
        weekMessage =
          "No tasks created yet this week. Last week was more productive.";
      } else {
        weekStatus = "neutral";
        weekMessage =
          "No tasks recently. Start adding tasks to track your weeks.";
      }
    }

    return {
      totalTasks: total,
      completedTasks: completed,
      weeklyData: weeklyArray,
      currentWeekCount,
      previousWeekCount,
      weekStatus,
      weekMessage,
    };
  }, [tasks]);

  const completionRate =
    totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);

  const maxWeeklyCount = weeklyData.reduce(
    (max, w) => (w.count > max ? w.count : max),
    0
  );

  let statusBadgeText = "No data yet";
  let statusBadgeClass = "bg-gray-100 text-gray-700";
  if (weekStatus === "good") {
    statusBadgeText = "Good week";
    statusBadgeClass = "bg-emerald-100 text-emerald-800";
  } else if (weekStatus === "bad") {
    statusBadgeText = "Bad week";
    statusBadgeClass = "bg-red-100 text-red-700";
  } else if (weekStatus === "neutral") {
    statusBadgeText = "Neutral week";
    statusBadgeClass = "bg-yellow-100 text-yellow-800";
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-500">
      <Navbar />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <header className="mb-6">
          <h1 className="text-3xl font-bold text-emerald-800">Dashboard</h1>
          <p className="text-sm text-gray-600 mt-1">
            Overview of your tasks and weekly productivity.
          </p>
        </header>

        {/* Summary cards */}
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

        {/* Weekly productivity bar graph + status */}
        <div className="bg-white rounded-xl shadow p-6 border border-emerald-100">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-emerald-800">
                Weekly Productivity
              </h2>
              <span className="text-xs text-gray-500">
                Tasks created per week from when you started.
              </span>
            </div>

            <div className="flex flex-col items-start md:items-end gap-1">
              <span
                className={
                  "inline-flex px-3 py-1 rounded-full text-xs font-semibold " +
                  statusBadgeClass
                }
              >
                {statusBadgeText}
              </span>
              <span className="text-xs text-gray-500">
                This week: <strong>{currentWeekCount}</strong> task
                {currentWeekCount !== 1 ? "s" : ""}{" "}
                {previousWeekCount > 0 && (
                  <>
                    | Last week: <strong>{previousWeekCount}</strong>
                  </>
                )}
              </span>
            </div>
          </div>

          <p className="text-xs text-gray-600 mb-4">{weekMessage}</p>

          {weeklyData.length === 0 ? (
            <div className="text-sm text-gray-500">
              No tasks yet. Start by creating your first task!
            </div>
          ) : (
            <div className="w-full">
              {/* Bar graph container */}
              <div className="relative h-52 sm:h-64 flex items-end gap-2 border-b border-gray-200 pb-6">
                {weeklyData.map((week) => {
                  const ratio =
                    maxWeeklyCount === 0
                      ? 0
                      : week.count / maxWeeklyCount;
                  const heightPercent = Math.max(10, ratio * 100); // keep visible even if low

                  return (
                    <div
                      key={week.weekKey}
                      className="flex-1 flex flex-col items-center justify-end"
                    >
                      <div
                        className="w-6 sm:w-8 rounded-t-lg bg-gradient-to-t from-emerald-500 to-emerald-300 shadow-sm"
                        style={{ height: `${heightPercent}%` }}
                        title={`Week of ${week.weekKey} • ${week.count} task${
                          week.count !== 1 ? "s" : ""
                        }`}
                      />
                    </div>
                  );
                })}
              </div>

              {/* X-axis labels */}
              <div className="flex gap-2 mt-2 text-[10px] text-gray-500 justify-between">
                {weeklyData.map((week) => (
                  <div
                    key={week.weekKey}
                    className="flex-1 text-center truncate"
                  >
                    {week.weekKey.slice(5)} {/* show MM-DD */}
                  </div>
                ))}
              </div>

              {/* Legend */}
              <div className="mt-3 text-[11px] text-gray-500 flex flex-wrap gap-3">
                <div className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded bg-gradient-to-t from-emerald-500 to-emerald-300" />
                  <span>Bar height = tasks created that week</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
