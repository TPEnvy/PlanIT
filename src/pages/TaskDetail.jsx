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
} from "firebase/firestore";
import { firestore } from "../server.js/firebase";
import { useAuth } from "../contexts/AuthContext";
import Navbar from "../components/Navbar";
import { computePriorityScore } from "../utils/Patternengine";
import recomputeAndSavePatternStats from "../utils/pattern";
import PageTransition from "../components/PageTransition";
import {
  createUserNotification,
  showDeviceNotification,
} from "../utils/notifications";

/* ---------- helpers ---------- */
function safeDate(val) {
  if (!val) return null;
  try {
    if (val?.toDate) return val.toDate();
    return new Date(val);
  } catch {
    return null;
  }
}

export default function TaskDetail() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { taskId } = useParams();

  const [task, setTask] = useState(null);
  const [patternStats, setPatternStats] = useState(null);
  const [aggStats, setAggStats] = useState({
    completed: 0,
    missed: 0,
    docCount: 0,
  });

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  /* ---------------- LOAD TASK ---------------- */
  useEffect(() => {
    let mounted = true;

    async function loadTask() {
      if (!user || !taskId) return;

      setLoading(true);

      const ref = doc(firestore, `users/${user.uid}/tasks/${taskId}`);
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        setTask(null);
        setLoading(false);
        return;
      }

      const data = snap.data() || {};

      if (mounted) {
        setTask({
          id: snap.id,
          ...data,
          completedCount: Number(data.completedCount || 0),
          missedCount: Number(data.missedCount || 0),
          totalActualMinutes: Number(data.totalActualMinutes || 0),
          dueDate: safeDate(data.dueDate),
          startAt: safeDate(data.startAt),
          endAt: safeDate(data.endAt),
        });
      }

      setLoading(false);
    }

    loadTask();
    return () => (mounted = false);
  }, [user, taskId]);

  /* ---------------- LOAD PATTERN + AGGREGATION ---------------- */
  useEffect(() => {
    let mounted = true;

    async function loadPattern() {
      if (!user || !task?.normalizedTitle) return;

      const normalized = task.normalizedTitle.trim().toLowerCase();

      // Load pattern doc
      const pref = doc(firestore, `users/${user.uid}/patterns/${normalized}`);
      const psnap = await getDoc(pref);
      if (psnap.exists() && mounted) {
        setPatternStats(psnap.data());
      }

      // Aggregate tasks with same title
      const tasksRef = collection(firestore, `users/${user.uid}/tasks`);
      const q = query(tasksRef, where("normalizedTitle", "==", normalized));
      const snap = await getDocs(q);

      let completed = 0;
      let missed = 0;
      let docCount = 0;

      snap.forEach((d) => {
        const data = d.data();
        docCount++;
        completed += Number(data.completedCount || 0);
        missed += Number(data.missedCount || 0);
      });

      if (mounted) {
        setAggStats({ completed, missed, docCount });
      }
    }

    loadPattern();
    return () => (mounted = false);
  }, [user, task]);

  /* ---------------- PRIORITY ---------------- */
  const priority = useMemo(() => {
    if (!task)
      return { final: 0, W: 0, EDF: 0, adaptiveBoost: 0 };

  return computePriorityScore(task, patternStats);
  }, [task, patternStats]);

  const isFinalized =
    task?.status === "completed" ||
    task?.status === "missed";

  /* ---------------- ACTIONS ---------------- */

  const handleMarkCompleted = async () => {
    if (!user || !task || isFinalized) return;

    setActionLoading(true);

    const ref = doc(firestore, `users/${user.uid}/tasks/${task.id}`);

    try {
      await updateDoc(ref, {
        completedCount: increment(1),
        status: "completed",
        finalized: true,
        completedAt: serverTimestamp(),
      });

      await createUserNotification(user.uid, {
        title: "Task completed",
        body: `${task.title || "Untitled task"} was marked as completed.`,
        taskId: task.id,
        type: "task_completed",
      });
      await showDeviceNotification(
        "Task completed",
        `${task.title || "Untitled task"} was marked as completed.`
      );

      try {
        await recomputeAndSavePatternStats(
          user.uid,
          task.normalizedTitle,
          { propagate: true }
        );
      } catch (mlError) {
        console.warn("ML recompute failed:", mlError);
      }

      navigate("/tasks", { replace: true });

    } catch (err) {
      console.error("Complete error:", err);
    }
  };

  const handleMarkMissed = async () => {
    if (!user || !task || isFinalized) return;

    setActionLoading(true);

    const ref = doc(firestore, `users/${user.uid}/tasks/${task.id}`);

    try {
      await updateDoc(ref, {
        missedCount: increment(1),
        status: "missed",
        finalized: true,
        lastMissedAt: serverTimestamp(),
      });

      await createUserNotification(user.uid, {
        title: "Task missed",
        body: `${task.title || "Untitled task"} was marked as missed.`,
        taskId: task.id,
        type: "task_missed",
      });
      await showDeviceNotification(
        "Task missed",
        `${task.title || "Untitled task"} was marked as missed.`
      );

      try {
        await recomputeAndSavePatternStats(
          user.uid,
          task.normalizedTitle,
          { propagate: true }
        );
      } catch (mlError) {
        console.warn("ML recompute failed:", mlError);
      }

      navigate("/tasks", { replace: true });

    } catch (err) {
      console.error("Missed error:", err);
    }
  };

  const handleDelete = async () => {
    if (!user || !task) return;

    const ok = window.confirm(
      `Delete task "${task.title || "Untitled task"}"?`
    );
    if (!ok) return;

    const ref = doc(firestore, `users/${user.uid}/tasks/${task.id}`);
    await deleteDoc(ref);
    navigate("/tasks");
  };

  /* ---------------- UI ---------------- */

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
    <PageTransition>
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
          ) : !task ? (
            <div className="text-sm text-gray-600">Task not found.</div>
          ) : (
            <>
              <div className="flex justify-between mb-4">
                <h1 className="text-2xl font-bold text-emerald-800">
                  {task.title}
                </h1>
                <div className="text-xs text-gray-500">
                  Priority:
                  <span className="ml-2 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-100 font-semibold">
                    {priority.final}
                  </span>
                </div>
              </div>

              <div className="mb-4 text-xs text-gray-700">
                W: {priority.W.toFixed(3)} | EDF:{" "}
                {priority.EDF.toFixed(5)} | Boost:{" "}
                {priority.adaptiveBoost}
              </div>

              <div className="mb-5 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
                  <p>Completed (same tasks)</p>
                  <p className="text-lg font-semibold text-emerald-800">
                    {aggStats.completed}
                  </p>
                </div>

                <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-3">
                  <p>Missed (same tasks)</p>
                  <p className="text-lg font-semibold text-amber-800">
                    {aggStats.missed}
                  </p>
                </div>
              </div>

              {patternStats && (
                <div className="mb-6 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 text-xs">
                  <p>
                    Completion rate:{" "}
                    <strong>
                      {(patternStats.completion_rate * 100).toFixed(0)}%
                    </strong>
                  </p>
                  <p>
                    Overrun ratio:{" "}
                    <strong>
                      {patternStats.overrun_ratio.toFixed(2)}
                    </strong>
                  </p>
                  <p>
                    ML Risk Score:{" "}
                    <strong>{patternStats.mlRiskScore}</strong>
                  </p>
                </div>
              )}
              <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-gray-700">
                <div className="p-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 ">
                  <p><strong>Urgency:</strong> {task.urgencyLevel || "N/A"}</p>
                  <p><strong>Importance:</strong> {task.importanceLevel || "N/A"}</p>
                  <p><strong>Difficulty:</strong> {task.difficultyLevel || "N/A"}</p>
                  <p><strong>Mode:</strong> {task.mode || "scheduled"}</p>
                </div>

                <div className="p-3 rounded-2xl border border-emerald-100 bg-emerald-50/70">
                  <p><strong>Start:</strong> {task.startAt?.toLocaleString() || "N/A"}</p>
                  <p><strong>End:</strong> {task.endAt?.toLocaleString() || "N/A"}</p>
                  <p><strong>Status:</strong> {task.status}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleMarkCompleted}
                  disabled={actionLoading || isFinalized}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                >
                  Mark Completed
                </button>

                <button
                  onClick={handleMarkMissed}
                  disabled={actionLoading || isFinalized}
                  className="px-4 py-2 rounded-lg bg-amber-500 text-white text-xs font-semibold"
                >
                  Mark Missed
                </button>

                <button
                  onClick={handleDelete}
                  className="px-4 py-2 rounded-lg bg-red-500 text-white text-xs font-semibold"
                >
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
    </PageTransition> 
  );
}
