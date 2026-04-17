// src/pages/TodoTaskDetail.jsx
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  increment,
} from "firebase/firestore";
import { firestore } from "../server.js/firebase";
import { useAuth } from "../contexts/AuthContext";
import Navbar from "../components/Navbar";
import {
  createUserNotification,
  showDeviceNotification,
} from "../utils/notifications";
import {
  buildSuggestSplitMessage,
  buildPreventNewTasksMessage,
  normalizePatternTitle,
  recomputeAndSavePatternStats,
  shouldPreventNewTasks,
  shouldSuggestSplit,
} from "../utils/pattern";
import { inferAutoTrackedActualMinutes } from "../utils/taskHelpers";

function safeDate(val) {
  if (!val) return null;
  if (typeof val.toDate === "function") return val.toDate();
  return new Date(val);
}

function formatTrackedMinutes(minutes) {
  if (minutes == null || Number.isNaN(Number(minutes))) return "0 min";

  const numericMinutes = Number(minutes);
  if (numericMinutes <= 0) return "0 min";

  const totalSeconds = Math.round(numericMinutes * 60);
  const wholeMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (wholeMinutes === 0) return `${seconds} sec`;
  if (seconds === 0) return `${wholeMinutes} min`;
  return `${wholeMinutes} min ${seconds} sec`;
}

export default function TodoTaskDetail() {
  const { user } = useAuth();
  const { taskId } = useParams();
  const navigate = useNavigate();

  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (!user) return;

    const loadTask = async () => {
      try {
        const ref = doc(firestore, `users/${user.uid}/tasks/${taskId}`);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setError("Task not found.");
          return;
        }

        const data = snap.data() || {};
        setTask({
          id: snap.id,
          ...data,
          estimatedMinutes:
            data.estimatedMinutes == null ? null : Number(data.estimatedMinutes),
          lastActualMinutes:
            data.lastActualMinutes == null
              ? null
              : Number(data.lastActualMinutes),
          totalActualMinutes: Number(data.totalActualMinutes || 0),
        });
      } catch (err) {
        console.error(err);
        setError("Failed to load task.");
      } finally {
        setLoading(false);
      }
    };

    loadTask();
  }, [user, taskId]);

  const handleComplete = async () => {
    setError("");
    setActionLoading(true);
    const ref = doc(firestore, `users/${user.uid}/tasks/${task.id}`);
    const resolvedAt = new Date();
    const actualMinutes = inferAutoTrackedActualMinutes(task, resolvedAt);
    try {
      const updatePayload = {
        completedCount: increment(1),
        totalCompletions: increment(1),
        lastOutcome: "completed",
        status: "completed",
        finalized: true,
        lastCompletedAt: serverTimestamp(),
        completedAt: serverTimestamp(),
      };

      if (actualMinutes != null) {
        updatePayload.totalActualMinutes = increment(actualMinutes);
        updatePayload.lastActualMinutes = actualMinutes;
      }

      await updateDoc(ref, updatePayload);
      await createUserNotification(user.uid, {
        title: "Task completed",
        body: `${task.title || "Untitled task"} was marked as completed.`,
        taskId: task.id,
        type: "task_completed",
        notificationId: `task_completed_${task.id}`,
      });
      await showDeviceNotification(
        "Task completed",
        `${task.title || "Untitled task"} was marked as completed.`,
        {
          data: { taskId: task.id, type: "task_completed" },
          tag: `task_completed:${task.id}`,
        }
      );
      await recomputeAndSavePatternStats(
        user.uid,
        task.normalizedTitle || normalizePatternTitle(task.title),
        { propagate: true }
      );
      navigate("/tasks");
    } catch (err) {
      console.error(err);
      setError("Failed to mark task as completed.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleMissed = async () => {
    setError("");
    setActionLoading(true);
    const ref = doc(firestore, `users/${user.uid}/tasks/${task.id}`);
    try {
      await updateDoc(ref, {
        missedCount: increment(1),
        lastOutcome: "missed",
        status: "missed",
        finalized: true,
        lastMissedAt: serverTimestamp(),
        missedAt: serverTimestamp(),
      });
      await createUserNotification(user.uid, {
        title: "Task missed",
        body: `${task.title || "Untitled task"} was marked as missed.`,
        taskId: task.id,
        type: "task_missed",
        notificationId: `task_missed_${task.id}`,
      });
      await showDeviceNotification(
        "Task missed",
        `${task.title || "Untitled task"} was marked as missed.`,
        {
          data: { taskId: task.id, type: "task_missed" },
          tag: `task_missed:${task.id}`,
        }
      );
      const patternData = await recomputeAndSavePatternStats(
        user.uid,
        task.normalizedTitle || normalizePatternTitle(task.title),
        { propagate: true }
      );
      const shouldRecommendSplit =
        shouldSuggestSplit(patternData) &&
        !task.isSplitParent &&
        !task.isSplitSegment;

      if (shouldPreventNewTasks(patternData)) {
        window.alert(
          buildPreventNewTasksMessage(
            patternData.normalizedTitle || task.normalizedTitle || task.title
          )
        );
      } else if (shouldRecommendSplit) {
        window.alert(
          buildSuggestSplitMessage(
            patternData?.normalizedTitle || task.normalizedTitle || task.title
          )
        );
      }
      navigate("/tasks");
    } catch (err) {
      console.error(err);
      setError("Failed to mark task as missed.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    const ok = window.confirm("Delete this task?");
    if (!ok) return;

    const ref = doc(firestore, `users/${user.uid}/tasks/${task.id}`);
    await deleteDoc(ref);
    await recomputeAndSavePatternStats(
      user.uid,
      task.normalizedTitle || normalizePatternTitle(task.title),
      { propagate: true }
    );
    navigate("/tasks");
  };

  if (loading) return <div className="p-6">Loading...</div>;
  if (!task) return <div className="p-6">{error}</div>;

  const createdAt = safeDate(task.createdAt);
  const estimatedMinutes = task.estimatedMinutes || null;

  const status = task.status || "pending";

  const statusStyle =
    status === "completed"
      ? "bg-emerald-100 text-emerald-700"
      : status === "missed"
      ? "bg-red-100 text-red-700"
      : "bg-gray-100 text-gray-700";

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-500">
      <Navbar />

      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-emerald-100">
          
          {/* Title + Status */}
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <h1 className="text-3xl font-bold text-emerald-800">
              {task.title || "Untitled Task"}
            </h1>

            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold ${statusStyle}`}
            >
              {status.toUpperCase()}
            </span>
          </div>

          {/* Info block */}
          <div className="grid sm:grid-cols-2 gap-4 text-sm text-gray-600 mb-6">
            {createdAt && (
              <div>
                <span className="font-semibold text-gray-700">Created:</span>{" "}
                {createdAt.toLocaleString()}
              </div>
            )}

            {estimatedMinutes && (
              <div>
                <span className="font-semibold text-gray-700">
                  Estimated time:
                </span>{" "}
                {estimatedMinutes >= 60
                  ? `${(estimatedMinutes / 60).toFixed(1)} hours`
                  : `${estimatedMinutes} minutes`}
              </div>
            )}

            <div>
              <span className="font-semibold text-gray-700">Completed:</span>{" "}
              {task.completedCount || 0}
            </div>

            <div>
              <span className="font-semibold text-gray-700">Missed:</span>{" "}
              {task.missedCount || 0}
            </div>

            <div>
              <span className="font-semibold text-gray-700">
                Actual tracked:
              </span>{" "}
              {formatTrackedMinutes(task.totalActualMinutes)}
            </div>

            <div>
              <span className="font-semibold text-gray-700">
                Last actual:
              </span>{" "}
              {formatTrackedMinutes(task.lastActualMinutes)}
            </div>
          </div>

          {/* Description / Notes */}
          {task.description && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-1">
                Notes / Description
              </h2>
              <div className="p-3 bg-emerald-50 rounded-lg text-sm text-gray-700 border border-emerald-100">
                {task.description}
              </div>
            </div>
          )}

          {/* Info banner */}
          <div className="mb-8 p-3 bg-gray-50 border border-dashed border-gray-200 rounded-lg text-xs text-gray-500">
            This is a flexible <strong>To-Do task</strong>. It is not part of the adaptive
            scheduling system and has no deadlines or priority computation.
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          {/* Actions */}
          {status === "pending" && (
            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleComplete}
                disabled={actionLoading}
                className="px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition disabled:opacity-60"
              >
                Mark as Completed
              </button>

              <button
                onClick={handleMissed}
                disabled={actionLoading}
                className="px-5 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 transition disabled:opacity-60"
              >
                Mark as Missed
              </button>
            </div>
          )}

          <div className="mt-6">
            <button
              onClick={handleDelete}
              className="text-sm text-red-600 hover:underline"
            >
              Delete this task
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
