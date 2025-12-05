// src/pages/TaskDetail.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  increment,
  collection,
  query,
  where,
  getDocs,
  setDoc,
} from "firebase/firestore";
import { firestore } from "../server.js/firebase";
import { useAuth } from "../contexts/AuthContext";
import Navbar from "../components/Navbar";

// import recompute helper (make sure file exists at src/utils/patterns.js)
import recomputeAndSavePatternStats from "../utils/pattern"

/* ---------- helpers ---------- */
function safeDate(val) {
  if (!val) return null;
  try {
    if (val && typeof val.toDate === "function") return val.toDate();
    return new Date(val);
  } catch {
    return null;
  }
}

/* ---------- priority (W-EDF + ML boost) ---------- */
function computePriorityComponents(task, now) {
  if (!task) {
    return {
      baseWeighted: 0,
      deadlineFactor: 1,
      adaptiveBoost: 0,
      final: 0,
    };
  }

  const urgency = task.urgencyLevel;
  const importance = task.importanceLevel;
  const difficulty = task.difficultyLevel;
  // prefer per-task adaptiveBoost, fall back to task.adaptiveBoost (number) or 0
  const adaptiveBoost =
    typeof task.adaptiveBoost === "number" ? task.adaptiveBoost : 0;

  let urgencyScore = 0.7;
  if (urgency === "urgent") urgencyScore = 1.0;
  else if (urgency === "somewhat_urgent") urgencyScore = 0.8;

  let importanceScore = 0.7;
  if (importance === "important") importanceScore = 1.0;
  else if (importance === "somewhat_important") importanceScore = 0.8;

  let difficultyScore = 1.0;
  if (difficulty === "easy") difficultyScore = 0.9;
  else if (difficulty === "medium") difficultyScore = 1.0;
  else if (difficulty === "hard") difficultyScore = 1.1;

  const due = safeDate(task.dueDate);
  let deadlineFactor = 1.0;
  if (due) {
    const diffMs = due.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    const base = 1 / Math.max(diffHours, 0.5);
    deadlineFactor = 1 + Math.min(base, 3);
  }

  const baseWeighted =
    urgencyScore * 0.4 + importanceScore * 0.4 + difficultyScore * 0.2;

  let final = baseWeighted * deadlineFactor + adaptiveBoost;
  if (final < 0) final = 0;
  if (final > 100) final = 100;

  return {
    baseWeighted,
    deadlineFactor,
    adaptiveBoost,
    final: Number(final.toFixed(2)),
  };
}

/* ---------- component ---------- */
export default function TaskDetail() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { taskId } = useParams();

  const [task, setTask] = useState(null);
  const [patternStats, setPatternStats] = useState(null);

  // aggregated stats across same normalizedTitle
  const [aggStats, setAggStats] = useState({
    completed: null,
    missed: null,
    docCount: null,
  });

  const [loading, setLoading] = useState(true);
  const [patternLoading, setPatternLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");

  // Load task
  useEffect(() => {
    let mounted = true;

    async function loadTask() {
      if (!mounted) return;
      setLoading(true);
      setError("");
      if (!user || !taskId) {
        setLoading(false);
        return;
      }

      try {
        const ref = doc(firestore, `users/${user.uid}/tasks/${taskId}`);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          if (mounted) {
            setTask(null);
            setError("Task not found.");
          }
        } else {
          const data = snap.data() || {};
          const normalized = {
            id: snap.id,
            ...data,
            completedCount: Number(data.completedCount || 0),
            missedCount: Number(data.missedCount || 0),
            totalCompletions: Number(data.totalCompletions || 0),
            totalActualMinutes: Number(data.totalActualMinutes || 0),
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

          if (mounted) setTask(normalized);
        }
      } catch (err) {
        console.error("Error loading task:", err);
        if (mounted) setError("Failed to load task.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadTask();
    return () => {
      mounted = false;
    };
  }, [user, taskId]);

  // Load and initialize pattern + aggregated stats
  useEffect(() => {
    let mounted = true;

    async function ensurePatternAndAgg() {
      if (!user || !task || !task.normalizedTitle) return;

      const normalizedTitle = task.normalizedTitle.toString().trim().toLowerCase();
      setPatternLoading(true);

      try {
        const pref = doc(firestore, `users/${user.uid}/patterns/${normalizedTitle}`);
        const psnap = await getDoc(pref);

        if (psnap.exists()) {
          if (mounted) setPatternStats(psnap.data());
        } else {
          // initialize from this task's stats
          const initial = {
            normalizedTitle,
            docCount: 1,
            total_completed: Number(task.completedCount || 0),
            total_missed: Number(task.missedCount || 0),
            totalActualMinutes: Number(task.totalActualMinutes || 0),
            totalEstimatedMinutes: typeof task.estimatedMinutes === "number" ? task.estimatedMinutes : 0,
            completion_rate:
              (Number(task.completedCount || 0) + Number(task.missedCount || 0)) === 0
                ? 0
                : Number(task.completedCount || 0) / (Number(task.completedCount || 0) + Number(task.missedCount || 0)),
            overrun_ratio:
              typeof task.estimatedMinutes === "number" && task.estimatedMinutes > 0
                ? (Number(task.totalActualMinutes || 0) / Math.max(1, task.estimatedMinutes))
                : 1,
            adaptiveBoost: 0,
            suggestSplit: false,
            preventNewTasks: false,
            updatedAt: serverTimestamp(),
          };

          try {
            await setDoc(pref, initial);
            if (mounted) setPatternStats(initial);
          } catch (err) {
            console.warn("Failed to create initial pattern doc:", err);
            if (mounted) setPatternStats(null);
          }
        }

        // aggregated totals across tasks with the same normalizedTitle
        try {
          const tasksRef = collection(firestore, `users/${user.uid}/tasks`);
          const q = query(tasksRef, where("normalizedTitle", "==", normalizedTitle));
          const snap2 = await getDocs(q);

          let aggCompleted = 0;
          let aggMissed = 0;
          let docCount = 0;

          snap2.forEach((d) => {
            const data = d.data() || {};
            docCount += 1;
            aggCompleted += Number(data.completedCount || 0);
            aggMissed += Number(data.missedCount || 0);
          });

          if (mounted) {
            setAggStats({
              completed: aggCompleted,
              missed: aggMissed,
              docCount,
            });
          }
        } catch (err) {
          console.warn("Failed to compute aggregated stats:", err);
          if (mounted) {
            setAggStats({
              completed: null,
              missed: null,
              docCount: null,
            });
          }
        }
      } catch (err) {
        console.error("Error ensuring pattern doc:", err);
      } finally {
        if (mounted) setPatternLoading(false);
      }
    }

    ensurePatternAndAgg();
    return () => {
      mounted = false;
    };
  }, [user, task]);

  const now = new Date();
  const priority = useMemo(() => computePriorityComponents(task, now), [task, now]);

  const isFinalized = useMemo(() => {
    if (!task) return false;
    return (
      task.finalized === true ||
      task.status === "completed" ||
      task.status === "missed" ||
      (Number(task.completedCount || 0) > 0) ||
      (Number(task.missedCount || 0) > 0)
    );
  }, [task]);

  /* ----------------- actions ----------------- */

  const handleMarkCompleted = async () => {
    setError("");
    if (!user) return setError("You must be signed in.");
    if (!task) return setError("Task not loaded.");

    if (isFinalized) {
      return setError("This task is already finalized (completed or missed).");
    }

    setActionLoading(true);
    try {
      const ref = doc(firestore, `users/${user.uid}/tasks/${task.id}`);

      // compute actual minutes if possible
      let actualMinutes = 0;
      if (task.startAt instanceof Date && !Number.isNaN(task.startAt.getTime())) {
        actualMinutes = Math.max(0, Math.round((Date.now() - task.startAt.getTime()) / 60000));
      } else if (task.startDate && task.startTime) {
        const s = new Date(`${task.startDate}T${task.startTime}`);
        if (!Number.isNaN(s.getTime())) {
          actualMinutes = Math.max(0, Math.round((Date.now() - s.getTime()) / 60000));
        }
      }

      const updates = {
        completedCount: increment(1),
        totalCompletions: increment(1),
        totalActualMinutes: increment(actualMinutes || 0),
        lastCompletedAt: serverTimestamp(),
        completedAt: serverTimestamp(),
        status: "completed",
        finalized: true,
        updatedAt: serverTimestamp(),
      };

      await updateDoc(ref, updates);

      // reload doc and refresh UI
      const freshSnap = await getDoc(ref);
      if (freshSnap.exists()) {
        const data = freshSnap.data() || {};
        setTask({
          id: freshSnap.id,
          ...data,
          completedCount: Number(data.completedCount || 0),
          missedCount: Number(data.missedCount || 0),
          totalCompletions: Number(data.totalCompletions || 0),
          totalActualMinutes: Number(data.totalActualMinutes || 0),
          createdAt:
            data.createdAt && typeof data.createdAt.toDate === "function"
              ? data.createdAt.toDate()
              : data.createdAt,
          lastCompletedAt:
            data.lastCompletedAt && typeof data.lastCompletedAt.toDate === "function"
              ? data.lastCompletedAt.toDate()
              : data.lastCompletedAt,
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
        });
      }

      // update pattern stats (recompute & propagate)
      const normalizedTitle = (task.normalizedTitle || task.title || "task")
        .toString()
        .trim()
        .toLowerCase();

      try {
        await recomputeAndSavePatternStats(user.uid, normalizedTitle, { propagate: true });
      } catch (err) {
        console.warn("Pattern recompute failed (after complete):", err);
      }

      // refresh aggregated stats and pattern doc
      try {
        const tasksRef = collection(firestore, `users/${user.uid}/tasks`);
        const q = query(tasksRef, where("normalizedTitle", "==", normalizedTitle));
        const snap = await getDocs(q);
        let totalCompleted = 0;
        let totalMissed = 0;
        let docCount = 0;
        snap.forEach((d) => {
          const data = d.data() || {};
          docCount += 1;
          totalCompleted += Number(data.completedCount || 0);
          totalMissed += Number(data.missedCount || 0);
        });
        setAggStats({
          completed: totalCompleted,
          missed: totalMissed,
          docCount,
        });

        const pref = doc(firestore, `users/${user.uid}/patterns/${normalizedTitle}`);
        const psnap = await getDoc(pref);
        setPatternStats(psnap.exists() ? psnap.data() : null);
      } catch (err) {
        console.warn("Failed refreshing pattern after complete:", err);
      }
    } catch (err) {
      console.error("Error marking completed:", err);
      setError("Failed to mark task as completed.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleMarkMissed = async () => {
    setError("");
    if (!user) return setError("You must be signed in.");
    if (!task) return setError("Task not loaded.");

    if (isFinalized) {
      return setError("This task is already finalized (completed or missed).");
    }

    setActionLoading(true);
    try {
      const ref = doc(firestore, `users/${user.uid}/tasks/${task.id}`);

      const updates = {
        missedCount: increment(1),
        lastMissedAt: serverTimestamp(),
        missedAt: serverTimestamp(),
        status: "missed",
        finalized: true,
        updatedAt: serverTimestamp(),
      };

      await updateDoc(ref, updates);

      const freshSnap = await getDoc(ref);
      if (freshSnap.exists()) {
        const data = freshSnap.data() || {};
        setTask({
          id: freshSnap.id,
          ...data,
          completedCount: Number(data.completedCount || 0),
          missedCount: Number(data.missedCount || 0),
          totalCompletions: Number(data.totalCompletions || 0),
          totalActualMinutes: Number(data.totalActualMinutes || 0),
          createdAt:
            data.createdAt && typeof data.createdAt.toDate === "function"
              ? data.createdAt.toDate()
              : data.createdAt,
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
        });
      }

      const normalizedTitle = (task.normalizedTitle || task.title || "task")
        .toString()
        .trim()
        .toLowerCase();

      try {
        await recomputeAndSavePatternStats(user.uid, normalizedTitle, { propagate: true });
      } catch (err) {
        console.warn("Pattern recompute failed (after miss):", err);
      }

      // refresh aggregates & pattern doc
      try {
        const tasksRef = collection(firestore, `users/${user.uid}/tasks`);
        const q = query(tasksRef, where("normalizedTitle", "==", normalizedTitle));
        const snap = await getDocs(q);
        let totalCompleted = 0;
        let totalMissed = 0;
        let docCount = 0;
        snap.forEach((d) => {
          const data = d.data() || {};
          docCount += 1;
          totalCompleted += Number(data.completedCount || 0);
          totalMissed += Number(data.missedCount || 0);
        });
        setAggStats({
          completed: totalCompleted,
          missed: totalMissed,
          docCount,
        });

        const pref = doc(firestore, `users/${user.uid}/patterns/${normalizedTitle}`);
        const psnap = await getDoc(pref);
        setPatternStats(psnap.exists() ? psnap.data() : null);
      } catch (err) {
        console.warn("Failed refreshing pattern after miss:", err);
      }
    } catch (err) {
      console.error("Error marking missed:", err);
      setError("Failed to mark task as missed.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!user || !task) return;
    const ok = window.confirm(`Delete task "${task.title || "Untitled task"}"?`);
    if (!ok) return;

    setActionLoading(true);
    setError("");
    try {
      const ref = doc(firestore, `users/${user.uid}/tasks/${task.id}`);
      await deleteDoc(ref);
      navigate("/tasks");
    } catch (err) {
      console.error("Error deleting task:", err);
      setError("Failed to delete task.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleEdit = () => {
    if (!task) return;
    if (isFinalized) {
      setError("Completed or missed tasks cannot be edited.");
      return;
    }
    navigate(`/tasks/${task.id}/edit`);
  };

  /* ----------------- UI ----------------- */

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-100">
        <div className="bg-white rounded-2xl shadow-xl p-6 border border-emerald-100 text-sm text-gray-700">
          You must be logged in to view tasks.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-500">
      <Navbar />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        <button
          type="button"
          onClick={() => navigate("/tasks")}
          className="mb-4 inline-flex items-center text-sm text-emerald-700 hover:underline"
        >
          ← Back to tasks
        </button>

        <div className="bg-white rounded-2xl shadow-xl border border-emerald-100 p-6 sm:p-8">
          {loading ? (
            <div className="text-sm text-gray-600">Loading task...</div>
          ) : error && !task ? (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              {error}
            </div>
          ) : !task ? (
            <div className="text-sm text-gray-600">Task not found.</div>
          ) : (
            <>
              {/* Header + priority */}
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
                <div>
                  <h1 className="text-2xl font-bold text-emerald-800 break-words">
                    {task.title || "Untitled task"}
                  </h1>
                  <p className="text-xs text-gray-500 mt-1">
                    Mode:{" "}
                    <span className="font-medium text-emerald-700">
                      {task.mode === "floating" ? "To-Do task (no dates)" : "Scheduled (with date & time)"}
                    </span>
                  </p>
                </div>

                <div className="flex flex-col items-start sm:items-end gap-2">
                  <div className="text-xs text-gray-500">
                    Priority (W-EDF + ML):
                    <span className="ml-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-100 font-semibold">
                      {priority.final}
                    </span>
                  </div>

                  <div className="text-[11px] text-gray-500 bg-emerald-50/60 border border-emerald-100 rounded-lg px-3 py-2">
                    <div>
                      Base (urgency/importance/difficulty):{" "}
                      <span className="font-semibold">{priority.baseWeighted.toFixed(2)}</span>
                    </div>
                    <div>
                      Deadline factor (EDF):{" "}
                      <span className="font-semibold">× {priority.deadlineFactor.toFixed(2)}</span>
                    </div>
                    <div>
                      ML boost:{" "}
                      <span className={
                        "font-semibold " +
                        (priority.adaptiveBoost > 0 ? "text-emerald-700" : priority.adaptiveBoost < 0 ? "text-amber-700" : "text-gray-700")
                      }>
                        {priority.adaptiveBoost >= 0 ? "+" : ""}
                        {priority.adaptiveBoost.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 text-[11px]">
                    {task.urgencyLevel && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-100">
                        {task.urgencyLevel === "urgent" ? "Urgent" : "Somewhat urgent"}
                      </span>
                    )}
                    {task.importanceLevel && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-100">
                        {task.importanceLevel === "important" ? "Important" : "Somewhat important"}
                      </span>
                    )}
                    {task.difficultyLevel && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-100">
                        {task.difficultyLevel.charAt(0).toUpperCase() + task.difficultyLevel.slice(1)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Error (actions) */}
              {error && task && (
                <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
                  {error}
                </div>
              )}

              {/* Timing / schedule */}
              {task.mode !== "floating" && (
                <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="text-sm text-gray-700">
                    <h3 className="text-xs font-semibold text-emerald-800 mb-1">Start</h3>
                    <p>{task.startDate || "—"} {task.startTime ? `• ${task.startTime}` : ""}</p>
                  </div>
                  <div className="text-sm text-gray-700">
                    <h3 className="text-xs font-semibold text-emerald-800 mb-1">End / Due</h3>
                    <p>{task.endDate || "—"} {task.endTime ? `• ${task.endTime}` : ""}</p>
                    {task.dueDate && (
                      <p className="text-xs text-gray-500 mt-1">
                        Due date: <span className="font-medium">{safeDate(task.dueDate) ? safeDate(task.dueDate).toLocaleDateString() : task.dueDate}</span>
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Stats + ML panel (AGGREGATED primary) */}
              <div className="mb-5 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
                  <p className="text-gray-500">Times completed (all same-name tasks)</p>
                  <p className="text-lg font-semibold text-emerald-800">
                    {aggStats.completed != null ? aggStats.completed : (task.completedCount || 0)}
                  </p>
                </div>

                <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-3">
                  <p className="text-gray-500">Times missed (all same-name tasks)</p>
                  <p className="text-lg font-semibold text-amber-800">
                    {aggStats.missed != null ? aggStats.missed : (task.missedCount || 0)}
                  </p>
                </div>
              </div>

              {/* ML prediction view */}
              <div className="mb-6 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                <h2 className="text-sm font-semibold text-emerald-800 mb-1">Adaptive ML prediction</h2>
                {patternLoading ? (
                  <p className="text-xs text-gray-600">Loading pattern stats...</p>
                ) : !patternStats ? (
                  <p className="text-xs text-gray-600">
                    No ML pattern data yet for <span className="font-semibold">“{task.normalizedTitle || task.title}”</span>.
                    Once you complete or miss this type of task a few times, the model will start adjusting difficulty and urgency for you.
                  </p>
                ) : (
                  <div className="text-xs text-gray-700 space-y-1">
                    <p>Pattern: <span className="font-semibold text-emerald-800">{patternStats.normalizedTitle || task.normalizedTitle}</span></p>
                    <p>Completion rate: <span className="font-semibold">{((patternStats.completion_rate || 0) * 100).toFixed(0)}%</span></p>
                    <p>Overrun ratio (actual / estimated): <span className="font-semibold">{(patternStats.overrun_ratio || 1).toFixed(2)}</span></p>
                    <p>Learned boost to priority: <span className={"font-semibold " + (patternStats.adaptiveBoost > 0 ? "text-emerald-700" : patternStats.adaptiveBoost < 0 ? "text-amber-700" : "text-gray-700")}>{patternStats.adaptiveBoost >= 0 ? "+" : ""}{(patternStats.adaptiveBoost || 0).toFixed(2)}</span></p>

                    {patternStats.suggestSplit && (
                      <p className="text-xs text-amber-800 mt-1">
                        Suggestion: Many tasks of this type are missed — consider splitting this kind of task into smaller segments.
                      </p>
                    )}

                    {patternStats.preventNewTasks && (
                      <p className="text-xs text-red-700 mt-1">
                        Warning: Multiple misses persist even after splitting. The system will prevent creating more tasks of this title until you adjust the workflow.
                      </p>
                    )}

                    <p className="text-[11px] text-gray-500 mt-1">
                      Interpretation: if you consistently <span className="font-medium">finish early</span>, the model decreases difficulty/urgency (negative boost). If you often <span className="font-medium">miss</span> or <span className="font-medium">overrun</span>, it increases them (positive boost).
                    </p>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2 mt-2">
                <button
                  type="button"
                  onClick={handleMarkCompleted}
                  disabled={actionLoading || isFinalized}
                  className={
                    "px-4 py-2 rounded-lg text-xs font-semibold transition " +
                    (isFinalized ? "bg-gray-200 text-gray-600 cursor-not-allowed" : "bg-emerald-600 text-white hover:bg-emerald-700")
                  }
                >
                  {isFinalized && (task.completedCount || 0) > 0 ? "Already completed" : actionLoading ? "Working..." : "Mark as Completed"}
                </button>

                <button
                  type="button"
                  onClick={handleMarkMissed}
                  disabled={actionLoading || isFinalized}
                  className={
                    "px-4 py-2 rounded-lg text-xs font-semibold transition " +
                    (isFinalized ? "bg-gray-200 text-gray-600 cursor-not-allowed" : "bg-amber-500 text-white hover:bg-amber-600")
                  }
                >
                  {isFinalized && (task.missedCount || 0) > 0 ? "Already missed" : actionLoading ? "Working..." : "Mark as Missed"}
                </button>

                {!isFinalized && (
                  <button
                    type="button"
                    onClick={handleEdit}
                    className="px-4 py-2 rounded-lg border border-emerald-300 text-emerald-700 text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 transition"
                  >
                    Edit task
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={actionLoading}
                  className="px-4 py-2 rounded-lg border border-red-300 text-red-700 text-xs font-semibold bg-red-50 hover:bg-red-100 transition disabled:opacity-60"
                >
                  Delete task
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
