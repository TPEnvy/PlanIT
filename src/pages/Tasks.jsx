// src/pages/Tasks.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import TaskCard from "../components/TaskCard";
import { breakLabel } from "../utils/taskHelpers";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  doc,
  deleteDoc,
  getDocs,
  where,
  updateDoc,
} from "firebase/firestore";
import { firestore } from "../server.js/firebase";
import { useAuth } from "../contexts/AuthContext";
import Navbar from "../components/Navbar";
import PageTransition from "../components/PageTransition";

/* -------------------- helpers -------------------- */

// Convert any Date-like value to a JS Date (safely)
function safeDate(val) {
  if (!val) return null;
  try {
    if (val.toDate && typeof val.toDate === "function") return val.toDate();
    return new Date(val);
  } catch {
    return null;
  }
}

// Produce local YYYY-MM-DD for comparisons (uses local timezone)
function toLocalYMD(date) {
  if (!date) return null;
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// Parse "YYYY-MM-DD" (local) -> Date at local midnight
function parseYMDLocal(str) {
  if (!str) return null;
  const [y, m, d] = str.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// Format Date -> local YYYY-MM-DD (alias of toLocalYMD)
function formatYMDLocal(date) {
  return toLocalYMD(date);
}

// is same day using local ymd comparison
function isSameDayLocal(a, b) {
  if (!a || !b) return false;
  return toLocalYMD(a) === toLocalYMD(b);
}

// start of month (local)
function startOfMonthLocal(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function daysInMonthLocal(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function merge(left, right) {
  const result = [];
  let i = 0;
  let j = 0;

  while (i < left.length && j < right.length) {
    const leftPriority = left[i].priorityScore ?? 0;
    const rightPriority = right[j].priorityScore ?? 0;

    if (leftPriority >= rightPriority) {
      result.push(left[i]);
      i++;
    } else {
      result.push(right[j]);
      j++;
    }
  }

  return [...result, ...left.slice(i), ...right.slice(j)];
}

function mergeSort(tasks) {
  if (tasks.length <= 1) return tasks;

  const mid = Math.floor(tasks.length / 2);
  const left = mergeSort(tasks.slice(0, mid));
  const right = mergeSort(tasks.slice(mid));

  return merge(left, right);
}

// status calculation (completed / missed / pending) — matches TaskDetail logic
  function getStatus(task, now) {
    if (task.status === "completed") return "completed";
    if (task.status === "missed") return "missed";

    if (Number(task.completedCount || 0) > 0) return "completed";
    if (Number(task.missedCount || 0) > 0) return "missed";

    const due = safeDate(task.dueDate);
    if (due) {
      const endOfDue = new Date(due);
      endOfDue.setHours(23, 59, 59, 999);
      if (endOfDue < now) return "missed";
    }

    return "pending";
  }

/* -------------------- component -------------------- */

export default function Tasks() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  // calendar + view mode + status
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonthLocal(new Date()));
  const [selectedDate, setSelectedDate] = useState(null); // Date object (local midnight)
  const [viewMode, setViewMode] = useState("scheduled"); // "scheduled" | "floating"
  const [statusFilter, setStatusFilter] = useState("pending"); // default to pending for nicer UX

  useEffect(() => {
    // Wait until auth finished resolving
    if (authLoading) return;

    // If user signed out: clear state asynchronously to avoid "sync setState in effect" warning
    if (!user) {
      setTimeout(() => {
        setTasks([]);
        setLoading(false);
      }, 0);
      return;
    }

    setLoading(true);
    const tasksRef = collection(firestore, `users/${user.uid}/tasks`);
    const q = query(tasksRef, orderBy("createdAt", "desc"));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((d) => {
          const data = d.data() || {};
          return {
            id: d.id,
            ...data,
            // coerce numeric fields to avoid undefined/null issues in UI
            completedCount: Number(data.completedCount || 0),
            missedCount: Number(data.missedCount || 0),
            totalCompletions: Number(data.totalCompletions || 0),
            totalActualMinutes: Number(data.totalActualMinutes || 0),
            estimatedMinutes:
              typeof data.estimatedMinutes === "number"
                ? data.estimatedMinutes
                : data.estimatedMinutes == null
                ? null
                : Number(data.estimatedMinutes),
            // convert timestamps -> JS Date where possible
            createdAt:
              data.createdAt && typeof data.createdAt.toDate === "function"
                ? data.createdAt.toDate()
                : data.createdAt,
            lastCompletedAt:
              data.lastCompletedAt && typeof data.lastCompletedAt.toDate === "function"
                ? data.lastCompletedAt.toDate()
                : data.lastCompletedAt,
            lastMissedAt:
              data.lastMissedAt && typeof data.lastMissedAt.toDate === "function"
                ? data.lastMissedAt.toDate()
                : data.lastMissedAt,
            dueDate:
              data.dueDate && typeof data.dueDate.toDate === "function"
                ? data.dueDate.toDate()
                : data.dueDate,
            startAt:
              data.startAt && typeof data.startAt.toDate === "function"
                ? data.startAt.toDate()
                : data.startAt,
            endAt:
              data.endAt && typeof data.endAt.toDate === "function"
                ? data.endAt.toDate()
                : data.endAt,
          };
        });

        setTasks(list);
        setLoading(false);
      },
      (err) => {
        console.error("Error loading tasks:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [user, authLoading]);

  const now = useMemo(() => new Date(), []);

  // split tasks into scheduled vs todo using local date logic
  const { scheduledTasks, todoTasks } = useMemo(() => {
    const scheduled = [];
    const todo = [];

    for (const t of tasks) {
      if (safeDate(t.dueDate)) {
        scheduled.push(t);
      } else {
        todo.push(t);
      }
    }

    return { scheduledTasks: scheduled, todoTasks: todo };
  }, [tasks]);

  // calendar dots: mark days covered by scheduled tasks using local date keys
  // IMPORTANT: only mark **active** scheduled tasks (not finalized/completed/missed)
  const tasksByDate = useMemo(() => {
    const map = {};
    scheduledTasks.forEach((task) => {

      if (!task.startDate && !task.dueDate) return;

      const finalized =
        task.finalized === true ||
        task.status === "completed" ||
        task.status === "missed" ||
        (task.completedCount || 0) > 0 ||
        (task.missedCount || 0) > 0;

      if (finalized) return;

      const startStr = task.startDate || null; // assumed YYYY-MM-DD
      const endStr = task.endDate || null;
      const start = parseYMDLocal(startStr);
      const end = parseYMDLocal(endStr);

      if (start && end && end >= start) {
        let cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        while (cur <= end) {
          const key = formatYMDLocal(cur);
          map[key] = (map[key] || 0) + 1;
          cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
        }
      } else {
        // fallback: use dueDate's local day (only if not finalized)
        const due = safeDate(task.dueDate);
        if (!due) return;
        const key = formatYMDLocal(due);
        map[key] = (map[key] || 0) + 1;
      }
    });
    return map;
  }, [scheduledTasks]);

  // base visible before applying status filter
  const baseVisibleTasks = useMemo(() => {
    if (viewMode === "floating") return todoTasks;

    // scheduled
    if (!selectedDate) return scheduledTasks;

    // selectedDate is a Date object in local timezone
    const selectedKey = formatYMDLocal(selectedDate);

    return scheduledTasks.filter((task) => {
      // always show split segments so user can manage them easily
      if (task.isSplitSegment) return true;

      const start = parseYMDLocal(task.startDate || null);
      const end = parseYMDLocal(task.endDate || null);

      if (start && end) {
        // check if selectedDate is in [start, end] using local dates
        const sKey = formatYMDLocal(start);
        const eKey = formatYMDLocal(end);
        return selectedKey >= sKey && selectedKey <= eKey;
      }

      // fallback check: compare dueDate local day
      const due = safeDate(task.dueDate);
      if (due) {
        return formatYMDLocal(due) === selectedKey;
      }

      return false;
    });
  }, [viewMode, selectedDate, scheduledTasks, todoTasks]);

  // Apply status filter (default 'pending' hides completed/missed)
  const visibleTasks = useMemo(() => {

    if (viewMode === "floating") return baseVisibleTasks; // to-do tasks: show all by default

    if (statusFilter === "all") return baseVisibleTasks;
    return baseVisibleTasks.filter((task) => getStatus(task, now) === statusFilter);
  },
   [baseVisibleTasks, statusFilter, viewMode, now]);

  const rankedTasks = useMemo(() => {

    if (viewMode !== "scheduled") return visibleTasks;

    if (visibleTasks.length <= 1) return visibleTasks;

    return mergeSort([...visibleTasks]);

  }, [visibleTasks, viewMode]);

  // navigation helpers
    const handleOpenTask = (task) => {
    if (task.mode === "floating") {
      navigate(`/tasks/${task.id}/todo`);
    } else {
      navigate(`/tasks/${task.id}`);
    }
  };

  const handleEditTask = (id) => navigate(`/tasks/${id}/edit`);
  const handleSplitTask = (id) => navigate(`/tasks/${id}/split`);
  const handleCreateTask = () => {
    if (viewMode === "scheduled" && selectedDate) {
      navigate("/tasks/create", { state: { dueDate: formatYMDLocal(selectedDate) } });
    } else {
      navigate("/tasks/create");
    }
  };

  // delete handler - also cleans up parent if we deleted the last segment
  const handleDeleteTask = async (task) => {
    if (!user) return;
    const ok = window.confirm(`Delete task "${task.title || "Untitled task"}"?`);
    if (!ok) return;

    try {
      const ref = doc(firestore, `users/${user.uid}/tasks/${task.id}`);
      await deleteDoc(ref);

      // if deleting a split segment, check for last segment and clear parent flags
      if (task.isSplitSegment && task.parentTaskId) {
        const tasksRef = collection(firestore, `users/${user.uid}/tasks`);
        const q = query(
          tasksRef,
          where("parentTaskId", "==", task.parentTaskId),
          where("isSplitSegment", "==", true)
        );
        const snap = await getDocs(q);
        if (snap.empty) {
          const parentRef = doc(firestore, `users/${user.uid}/tasks/${task.parentTaskId}`);
          try {
            await updateDoc(parentRef, {
              isSplitParent: false,
              splitSegmentCount: null,
              splitAt: null,
            });
          } catch (err) {
            // parent might have been deleted or updated by another client; ignore but log
            console.warn("Could not update parent split flags:", err);
          }
        }
      }
    } catch (err) {
      console.error("Error deleting task:", err);
      alert("Failed to delete task. Try again.");
    }
  };

  /* -------------------- calendar rendering values -------------------- */
  const monthStart = startOfMonthLocal(currentMonth);
  const firstWeekday = monthStart.getDay();
  const totalDays = daysInMonthLocal(currentMonth);
  const monthLabel = currentMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const daysArray = [];
  for (let i = 0; i < firstWeekday; i++) daysArray.push(null);
  for (let day = 1; day <= totalDays; day++) {
    daysArray.push(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day));
  }
  const today = new Date();

  /* -------------------- rendering -------------------- */
  return (
    <PageTransition>
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-500">
      <Navbar />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-6 pt-4">
        <div className="mb-4">
          <h1 className="text-3xl font-bold text-emerald-800">Tasks</h1>
          <p className="text-sm text-gray-600">
            Scheduled tasks appear on the calendar for every day between their start and end. To-Do tasks are flexible tasks without dates.
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-4 md:gap-6 md:h-[calc(100vh-150px)]">
          {/* LEFT: calendar */} 
          <aside className="md:w-80 bg-white rounded-2xl shadow-lg border border-emerald-100 p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <button
                type="button"
                className="text-xs font-medium text-emerald-700 hover:underline"
                onClick={() => setCurrentMonth((p) => new Date(p.getFullYear(), p.getMonth() - 1, 1))}
              >
                ← Prev
              </button>

              <div className="text-sm font-semibold text-emerald-800">{monthLabel}</div>

              <button
                type="button"
                className="text-xs font-medium text-emerald-700 hover:underline"
                onClick={() => setCurrentMonth((p) => new Date(p.getFullYear(), p.getMonth() + 1, 1))}
              >
                Next →
              </button>
            </div>

            <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-gray-500 mb-1">
              <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
            </div>

            <div className="grid grid-cols-7 gap-1 text-sm mb-3">
              {daysArray.map((date, idx) => {
                if (!date) return <div key={idx} />;
                const isToday = isSameDayLocal(date, today);
                const isSelected = selectedDate && isSameDayLocal(date, selectedDate);
                const key = formatYMDLocal(date);
                const taskCount = tasksByDate[key] || 0;

                let classes = "relative w-9 h-9 flex items-center justify-center rounded-full cursor-pointer text-xs transition-all";
                if (isSelected) classes += " bg-emerald-600 text-white font-semibold shadow";
                else if (isToday) classes += " border border-emerald-400 text-emerald-800 bg-emerald-50";
                else classes += " text-gray-700 hover:bg-emerald-50 hover:text-emerald-800";

                return (
                  <button
                    key={idx}
                    type="button"
                    className={classes}
                    onClick={() => setSelectedDate(new Date(date.getFullYear(), date.getMonth(), date.getDate()))}
                  >
                    {date.getDate()}
                    {taskCount > 0 && <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                  </button>
                );
              })}
            </div>

            <div className="space-y-2 text-xs text-gray-600">
              <div>
                <span className="font-semibold text-emerald-700">Selected date:</span>{" "}
                {viewMode === "scheduled"
                  ? selectedDate ? selectedDate.toLocaleDateString() : "All scheduled tasks"
                  : "Not used in To-Do mode"}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedDate(null)}
                  className="px-3 py-1 rounded-full border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition text-[11px] font-medium"
                >
                  Show all scheduled
                </button>

                <button
                  type="button"
                  onClick={handleCreateTask}
                  className="px-3 py-1 rounded-full bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 transition"
                >
                  Add task{viewMode === "scheduled" && selectedDate ? " for this date" : ""}
                </button>
              </div>

              <div className="flex flex-wrap gap-3 mt-3">
                <div className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-emerald-500" /> <span className="text-[11px]">Active day with tasks</span></div>
                <div className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full border border-emerald-400 bg-emerald-50" /> <span className="text-[11px]">Today</span></div>
              </div>
            </div>

            <div className="mt-4 text-[11px] text-gray-500 border-t border-emerald-50 pt-2">
              Calendar shows a green dot for each day covered by an active scheduled task (completed/missed tasks are excluded).
            </div>
          </aside>

          {/* RIGHT: tasks list */}
          <main className="flex-1 bg-white rounded-2xl shadow-lg border border-emerald-100 flex flex-col overflow-hidden">
            <div className="px-4 sm:px-6 py-3 border-b border-emerald-50 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-col gap-2">
                <div className="inline-flex rounded-full bg-emerald-50 p-1 w-fit">
                  <button
                    type="button"
                    onClick={() => setViewMode("scheduled")}
                    className={
                      "px-3 py-1 text-xs font-semibold rounded-full transition " +
                      (viewMode === "scheduled" ? "bg-emerald-600 text-white shadow" : "text-emerald-700 hover:bg-emerald-100")
                    }
                  >
                    Scheduled (with date & time)
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("floating")}
                    className={
                      "px-3 py-1 text-xs font-semibold rounded-full transition " +
                      (viewMode === "floating" ? "bg-emerald-600 text-white shadow" : "text-emerald-700 hover:bg-emerald-100")
                    }
                  >
                    To-Do Tasks
                  </button>
                </div>
                
                {viewMode === "scheduled" && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-gray-500">Status:</span>
                    {[
                      { key: "pending", label: "Pending" },
                      { key: "all", label: "All" },
                      { key: "completed", label: "Completed" },
                      { key: "missed", label: "Missed" },
                    ].map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => setStatusFilter(s.key)}
                        className={
                          "px-2.5 py-1 rounded-full border text-[11px] transition " +
                          (statusFilter === s.key ? "bg-emerald-600 border-emerald-600 text-white" : "border-emerald-100 text-emerald-700 hover:bg-emerald-50")
                        }
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleCreateTask}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition self-start md:self-auto"
              >
                + New task
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
              {loading ? (
                <div className="text-sm text-gray-600">Loading tasks...</div>
              ) : visibleTasks.length === 0 ? (
                <div className="text-sm text-gray-600 bg-emerald-50/60 rounded-xl border border-dashed border-emerald-200 p-6 text-center">
                  {viewMode === "scheduled" ? (
                    statusFilter !== "all" ? (
                      <>No <strong>{statusFilter}</strong> scheduled tasks found.</>
                    ) : selectedDate ? (
                      <>No scheduled tasks for <span className="font-semibold text-emerald-700">{selectedDate.toLocaleDateString()}</span>.</>
                    ) : (
                      <>No scheduled tasks yet.</>
                    )
                  ) : (
                    <>No to-do tasks yet.</>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {rankedTasks.map((task, index) => {

                  const breakMinutesValue =
                    typeof task.breakMinutes === "number" ? task.breakMinutes : 0;

                  const breakText = breakLabel(breakMinutesValue);

                  return (
                    <div key={task.id} className="flex items-start gap-3">

                      {/* 🔥 NUMBER BADGE */}
                      {viewMode === "scheduled" && (
                        <div
                          className={`w-8 h-8 flex items-center justify-center rounded-full text-xs font-bold text-white shadow
                            ${index === 0 ? "bg-red-500" : "bg-emerald-600"}
                          `}
                        >
                          {index + 1}
                        </div>
                      )}

                      {/* TASK CARD */}
                      <div className="flex-1">
                        <TaskCard
                          task={task}
                          tasks={tasks}
                          viewMode={viewMode}
                          breakText={breakText}
                          handleOpenTask={handleOpenTask}
                          handleEditTask={handleEditTask}
                          handleSplitTask={handleSplitTask}
                          handleDeleteTask={handleDeleteTask}
                        />
                      </div>
                  </div>
                );
                })}
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
    </PageTransition> 
  );
}
