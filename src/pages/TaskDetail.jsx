// src/pages/TaskDetail.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { firestore } from "../server.js/firebase";
import { useAuth } from "../contexts/AuthContext";
import Navbar from "../components/Navbar";
import { computePriorityScore } from "../utils/Patternengine";
import {
  buildPreventNewTasksMessage,
  buildSuggestSplitMessage,
  normalizePatternTitle,
  recomputeAndSavePatternStats,
  shouldPreventNewTasks,
  shouldSuggestSplit,
} from "../utils/pattern";
import PageTransition from "../components/PageTransition";
import {
  createUserNotification,
  showDeviceNotification,
} from "../utils/notifications";
import { inferAutoTrackedActualMinutes } from "../utils/taskHelpers";

function safeDate(value) {
  if (!value) return null;
  try {
    if (typeof value?.toDate === "function") return value.toDate();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function formatDateTime(value) {
  if (!value) return "N/A";
  return value.toLocaleString();
}

function formatDuration(minutes) {
  if (minutes == null || Number.isNaN(Number(minutes))) return "N/A";
  const numericMinutes = Number(minutes);
  if (numericMinutes <= 0) return "0 min";
  if (numericMinutes < 60) {
    const totalSeconds = Math.round(numericMinutes * 60);
    const wholeMinutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (seconds === 0) return `${wholeMinutes} min`;
    if (wholeMinutes === 0) return `${seconds} sec`;
    return `${wholeMinutes} min ${seconds} sec`;
  }
  const hours = numericMinutes / 60;
  if (hours < 24) {
    return `${hours.toFixed(hours % 1 === 0 ? 0 : 1)} h`;
  }
  const days = numericMinutes / 1440;
  return `${days.toFixed(days % 1 === 0 ? 0 : 1)} day(s)`;
}

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return "N/A";
  return `${(Number(value) * 100).toFixed(0)}%`;
}

function LabelValue({ label, value }) {
  return (
    <p>
      <strong>{label}:</strong> {value}
    </p>
  );
}

function describeOverrunRatio(value) {
  if (value == null || Number.isNaN(Number(value))) return "N/A";

  const ratio = Number(value);
  if (ratio === 1) return "On time";
  if (ratio < 1) return "Underrun";
  return "Overrun";
}

function isResolvedTask(task) {
  return (
    task?.status === "completed" ||
    task?.status === "missed" ||
    task?.finalized === true ||
    Number(task?.completedCount || 0) > 0 ||
    Number(task?.missedCount || 0) > 0
  );
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
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadTask() {
      if (!user || !taskId) return;

      setLoading(true);

      const ref = doc(firestore, `users/${user.uid}/tasks/${taskId}`);
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        if (mounted) {
          setTask(null);
          setLoading(false);
        }
        return;
      }

      const data = snap.data() || {};

      if (mounted) {
        setTask({
          id: snap.id,
          ...data,
          completedCount: Number(data.completedCount || 0),
          missedCount: Number(data.missedCount || 0),
          lastActualMinutes:
            data.lastActualMinutes == null
              ? null
              : Number(data.lastActualMinutes),
          totalActualMinutes: Number(data.totalActualMinutes || 0),
          estimatedMinutes:
            data.estimatedMinutes == null ? null : Number(data.estimatedMinutes),
          breakMinutes: data.breakMinutes == null ? null : Number(data.breakMinutes),
          originalEstimatedMinutes:
            data.originalEstimatedMinutes == null
              ? null
              : Number(data.originalEstimatedMinutes),
          dueDate: safeDate(data.dueDate),
          startAt: safeDate(data.startAt),
          endAt: safeDate(data.endAt),
          createdAt: safeDate(data.createdAt),
          updatedAt: safeDate(data.updatedAt),
          completedAt: safeDate(data.completedAt),
          lastCompletedAt: safeDate(data.lastCompletedAt),
          missedAt: safeDate(data.missedAt),
          lastMissedAt: safeDate(data.lastMissedAt),
          splitAt: safeDate(data.splitAt),
        });
      }

      setLoading(false);
    }

    loadTask();
    return () => {
      mounted = false;
    };
  }, [user, taskId]);

  useEffect(() => {
    let mounted = true;

    async function loadPattern() {
      if (!user || !task?.normalizedTitle) return;

      const normalized = task.normalizedTitle.trim().toLowerCase();
      let nextPatternStats = null;

      try {
        nextPatternStats = await recomputeAndSavePatternStats(user.uid, normalized, {
          propagate: true,
        });
      } catch (mlError) {
        console.warn("Pattern refresh from ML API failed:", mlError);
      }

      if (!nextPatternStats) {
        const patternRef = doc(
          firestore,
          `users/${user.uid}/patterns/${normalized}`
        );
        const patternSnap = await getDoc(patternRef);
        nextPatternStats = patternSnap.exists() ? patternSnap.data() : null;
      }

      if (mounted) {
        setPatternStats(nextPatternStats);
      }

      const tasksRef = collection(firestore, `users/${user.uid}/tasks`);
      const sameTitleQuery = query(
        tasksRef,
        where("normalizedTitle", "==", normalized)
      );
      const sameTitleSnap = await getDocs(sameTitleQuery);

      let completed = 0;
      let missed = 0;
      let docCount = 0;

      sameTitleSnap.forEach((taskDoc) => {
        const data = taskDoc.data() || {};
        docCount += 1;
        completed += Number(data.completedCount || 0);
        missed += Number(data.missedCount || 0);
      });

      if (mounted) {
        setAggStats({ completed, missed, docCount });
      }
    }

    loadPattern();
    return () => {
      mounted = false;
    };
  }, [user, task]);

  const priority = useMemo(() => {
    if (!task || isResolvedTask(task)) {
      return null;
    }

    return computePriorityScore(task, patternStats);
  }, [task, patternStats]);

  const isFinalized = isResolvedTask(task);

  const statusStyle =
    task?.status === "completed"
      ? "bg-emerald-100 text-emerald-700"
      : task?.status === "missed"
      ? "bg-red-100 text-red-700"
      : "bg-gray-100 text-gray-700";

  const patternSuggestsSplit =
    shouldSuggestSplit(patternStats) &&
    !task?.isSplitParent &&
    !task?.isSplitSegment;
  const patternBlocksNewTasks = shouldPreventNewTasks(patternStats);
  const createdAt = task?.createdAt || null;
  const updatedAt = task?.updatedAt || null;
  const lastCompletedAt = task?.lastCompletedAt || task?.completedAt || null;
  const lastMissedAt = task?.lastMissedAt || task?.missedAt || null;
  const normalizedTitle =
    task?.normalizedTitle || normalizePatternTitle(task?.title || "task");
  const inferredTaskActualMinutes = inferAutoTrackedActualMinutes(
    task,
    lastCompletedAt
  );
  const taskActualMinutes =
    inferredTaskActualMinutes != null
      ? inferredTaskActualMinutes
      : Number(task?.lastActualMinutes || 0) > 0
      ? Number(task.lastActualMinutes)
      : null;
  const displayedTrackedMinutes =
    inferredTaskActualMinutes != null
      ? inferredTaskActualMinutes
      : Number(task?.totalActualMinutes || 0);
  const displayedLastActualMinutes =
    inferredTaskActualMinutes != null
      ? inferredTaskActualMinutes
      : Number(task?.lastActualMinutes || 0);
  const taskOverrunRatio =
    task?.mode !== "floating" &&
    (task?.status === "completed" || Number(task?.completedCount || 0) > 0) &&
    Number(task?.estimatedMinutes || 0) > 0 &&
    Number(taskActualMinutes || 0) > 0
      ? Number(taskActualMinutes) / Math.max(1, Number(task.estimatedMinutes))
      : null;

  const handleMarkCompleted = async () => {
    if (!user || !task || isFinalized) return;

    setActionError("");
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

      try {
        await recomputeAndSavePatternStats(user.uid, normalizedTitle, {
          propagate: true,
        });
      } catch (mlError) {
        console.warn("ML recompute failed:", mlError);
      }

      navigate("/tasks", { replace: true });
    } catch (err) {
      console.error("Complete error:", err);
      setActionError("Failed to mark this task as completed. Please try again.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleMarkMissed = async () => {
    if (!user || !task || isFinalized) return;

    setActionError("");
    setActionLoading(true);
    const ref = doc(firestore, `users/${user.uid}/tasks/${task.id}`);

    try {
      await updateDoc(ref, {
        missedCount: increment(1),
        lastOutcome: "missed",
        status: "missed",
        finalized: true,
        missedAt: serverTimestamp(),
        lastMissedAt: serverTimestamp(),
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

      let nextPatternData = null;
      try {
        nextPatternData = await recomputeAndSavePatternStats(
          user.uid,
          normalizedTitle,
          { propagate: true }
        );
      } catch (mlError) {
        console.warn("ML recompute failed:", mlError);
      }

      const shouldRecommendSplit =
        shouldSuggestSplit(nextPatternData) &&
        !task.isSplitParent &&
        !task.isSplitSegment;

      if (shouldPreventNewTasks(nextPatternData)) {
        window.alert(
          buildPreventNewTasksMessage(
            nextPatternData.normalizedTitle ||
              task.normalizedTitle ||
              task.title
          )
        );
      } else if (shouldRecommendSplit) {
        window.alert(
          buildSuggestSplitMessage(
            nextPatternData?.normalizedTitle ||
              task.normalizedTitle ||
              task.title
          )
        );
      }

      navigate("/tasks", { replace: true });
    } catch (err) {
      console.error("Missed error:", err);
      setActionError("Failed to mark this task as missed. Please try again.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!user || !task) return;

    const ok = window.confirm(`Delete task "${task.title || "Untitled task"}"?`);
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

        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
          <button
            type="button"
            onClick={() => navigate("/tasks")}
            className="mb-4 inline-flex items-center text-sm text-emerald-700 hover:underline"
          >
            Back to tasks
          </button>

          <div className="bg-white rounded-2xl shadow-xl border border-emerald-100 p-6 sm:p-8">
            {loading ? (
              <div className="text-sm text-gray-600">Loading task...</div>
            ) : !task ? (
              <div className="text-sm text-gray-600">Task not found.</div>
            ) : (
              <>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between mb-6">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <h1 className="text-2xl font-bold text-emerald-800">
                        {task.title || "Untitled task"}
                      </h1>
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-semibold ${statusStyle}`}
                      >
                        {(task.status || "pending").toUpperCase()}
                      </span>
                      {task.isSplitSegment && (
                        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                          Segment {task.segmentIndex || "?"}/{task.segmentCount || "?"}
                        </span>
                      )}
                      {task.isSplitParent && (
                        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                          Split parent
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600">
                      Review the scheduling, focus, split, and learning details for
                      this task.
                    </p>
                  </div>

                  <div className="text-right">
                    {priority ? (
                      <>
                        <p className="text-xs text-gray-500">Priority score</p>
                        <p className="text-2xl font-semibold text-emerald-800">
                          {priority.final}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          W {priority.W.toFixed(3)} | EDF{" "}
                          {priority.EDF.toFixed(5)} | Applied boost{" "}
                          {priority.adaptiveBoost.toFixed(3)}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-gray-500">Priority score</p>
                        <p className="text-lg font-semibold text-gray-500">
                          Not ranked
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          W-EDF is only used for pending tasks.
                        </p>
                      </>
                    )}
                  </div>
                </div>

                {patternBlocksNewTasks && (
                  <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {buildPreventNewTasksMessage(
                      patternStats?.normalizedTitle || task.normalizedTitle || task.title
                    )}
                  </div>
                )}

                {!patternBlocksNewTasks && patternSuggestsSplit && (
                  <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
                    {buildSuggestSplitMessage(
                      patternStats?.normalizedTitle || task.normalizedTitle || task.title
                    )}
                  </div>
                )}

                {patternStats?.recoveryUnlocked === true && (
                  <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                    Recent completion performance is strong enough to lift the
                    focus lock for this task pattern.
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6 text-sm text-gray-700">
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                    <p className="font-semibold text-emerald-800 mb-2">
                      Schedule
                    </p>
                    <div className="space-y-1 text-xs">
                      <LabelValue
                        label="Mode"
                        value={task.mode === "floating" ? "To-Do" : "Scheduled"}
                      />
                      <LabelValue
                        label="Start"
                        value={formatDateTime(task.startAt)}
                      />
                      <LabelValue label="End" value={formatDateTime(task.endAt)} />
                      <LabelValue
                        label="Estimated duration"
                        value={formatDuration(task.estimatedMinutes)}
                      />
                      <LabelValue
                        label="Recommended break"
                        value={formatDuration(task.breakMinutes)}
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                    <p className="font-semibold text-emerald-800 mb-2">
                      Task settings
                    </p>
                    <div className="space-y-1 text-xs">
                      <LabelValue
                        label="Urgency"
                        value={task.urgencyLevel || "N/A"}
                      />
                      <LabelValue
                        label="Importance"
                        value={task.importanceLevel || "N/A"}
                      />
                      <LabelValue
                        label="Difficulty"
                        value={task.difficultyLevel || "N/A"}
                      />
                      <LabelValue
                        label="Normalized title"
                        value={task.normalizedTitle || "N/A"}
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                    <p className="font-semibold text-emerald-800 mb-2">
                      Activity
                    </p>
                    <div className="space-y-1 text-xs">
                      <LabelValue
                        label="Created"
                        value={formatDateTime(createdAt)}
                      />
                      <LabelValue
                        label="Updated"
                        value={formatDateTime(updatedAt)}
                      />
                      <LabelValue
                        label="Completed count"
                        value={task.completedCount}
                      />
                      <LabelValue
                        label="Missed count"
                        value={task.missedCount}
                      />
                      <LabelValue
                        label="Last completed"
                        value={formatDateTime(lastCompletedAt)}
                      />
                      <LabelValue
                        label="Last missed"
                        value={formatDateTime(lastMissedAt)}
                      />
                      <LabelValue
                        label="Last actual minutes"
                        value={formatDuration(displayedLastActualMinutes)}
                      />
                      <LabelValue
                        label="Actual minutes tracked"
                        value={formatDuration(displayedTrackedMinutes)}
                      />
                    </div>
                  </div>
                </div>

                {(task.description ||
                  task.isSplitParent ||
                  task.isSplitSegment ||
                  task.parentTaskId ||
                  task.sourceWasSuggestion) && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 text-sm text-gray-700">
                    {task.description && (
                      <div className="rounded-2xl border border-emerald-100 bg-white p-4">
                        <p className="font-semibold text-emerald-800 mb-2">
                          Notes
                        </p>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">
                          {task.description}
                        </p>
                      </div>
                    )}

                    <div className="rounded-2xl border border-emerald-100 bg-white p-4">
                      <p className="font-semibold text-emerald-800 mb-2">
                        Split details
                      </p>
                      <div className="space-y-1 text-xs">
                        <LabelValue
                          label="Is split parent"
                          value={task.isSplitParent ? "Yes" : "No"}
                        />
                        <LabelValue
                          label="Is split segment"
                          value={task.isSplitSegment ? "Yes" : "No"}
                        />
                        <LabelValue
                          label="Parent task ID"
                          value={task.parentTaskId || "N/A"}
                        />
                        <LabelValue
                          label="Segment"
                          value={
                            task.isSplitSegment
                              ? `${task.segmentIndex || "?"}/${task.segmentCount || "?"}`
                              : "N/A"
                          }
                        />
                        <LabelValue
                          label="Split segment count"
                          value={task.splitSegmentCount ?? "N/A"}
                        />
                        <LabelValue
                          label="Original estimate"
                          value={formatDuration(task.originalEstimatedMinutes)}
                        />
                        <LabelValue
                          label="Split at"
                          value={formatDateTime(task.splitAt)}
                        />
                        <LabelValue
                          label="Created from suggestion"
                          value={task.sourceWasSuggestion ? "Yes" : "No"}
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 text-sm text-gray-700">
                  <div className="rounded-2xl border border-emerald-100 bg-white p-4">
                    <p className="font-semibold text-emerald-800 mb-2">
                      Same-pattern totals
                    </p>
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
                        <p className="text-gray-500">Completed</p>
                        <p className="text-lg font-semibold text-emerald-800">
                          {aggStats.completed}
                        </p>
                      </div>
                      <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
                        <p className="text-gray-500">Missed</p>
                        <p className="text-lg font-semibold text-amber-800">
                          {aggStats.missed}
                        </p>
                      </div>
                      <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
                        <p className="text-gray-500">Docs</p>
                        <p className="text-lg font-semibold text-blue-800">
                          {aggStats.docCount}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-emerald-100 bg-white p-4">
                    <p className="font-semibold text-emerald-800 mb-2">
                      Pattern learning
                    </p>
                    <div className="space-y-1 text-xs">
                      <LabelValue
                        label="Task overrun ratio"
                        value={
                          taskOverrunRatio != null
                            ? `${taskOverrunRatio.toFixed(2)} (${describeOverrunRatio(
                                taskOverrunRatio
                              )})`
                            : "N/A"
                        }
                      />
                      <LabelValue
                        label="Completion rate"
                        value={formatPercent(patternStats?.completion_rate)}
                      />
                      <LabelValue
                        label="Pattern confidence"
                        value={
                          priority
                            ? `${(priority.confidence * 100).toFixed(0)}%`
                            : "N/A"
                        }
                      />
                      <LabelValue
                        label="Raw adaptive boost"
                        value={
                          patternStats?.adaptiveBoost != null
                            ? Number(patternStats.adaptiveBoost).toFixed(2)
                            : "N/A"
                        }
                      />
                      <LabelValue
                        label="Applied boost"
                        value={
                          priority ? priority.adaptiveBoost.toFixed(2) : "N/A"
                        }
                      />
                      <LabelValue
                        label="ML risk score"
                        value={
                          patternStats?.mlRiskScore != null
                            ? Number(patternStats.mlRiskScore).toFixed(2)
                            : "N/A"
                        }
                      />
                      <LabelValue
                        label="Historical missed"
                        value={patternStats?.historicalTotalMissed ?? "N/A"}
                      />
                      <LabelValue
                        label="Pending same-pattern tasks"
                        value={patternStats?.pendingTaskCount ?? "N/A"}
                      />
                      <LabelValue
                        label="Recent completion rate"
                        value={formatPercent(patternStats?.recentCompletionRate)}
                      />
                      <LabelValue
                        label="Recovery unlocked"
                        value={patternStats?.recoveryUnlocked ? "Yes" : "No"}
                      />
                      <LabelValue
                        label="Suggest split"
                        value={patternStats?.suggestSplit ? "Yes" : "No"}
                      />
                      <LabelValue
                        label="Prevent new tasks"
                        value={patternStats?.preventNewTasks ? "Yes" : "No"}
                      />
                    </div>
                  </div>
                </div>

                {!isFinalized && task.mode !== "floating" && (
                  <div className="mb-6 rounded-2xl border border-emerald-100 bg-white p-4 text-sm text-gray-700">
                    <p className="font-semibold text-emerald-800 mb-1">
                      Automatic overrun tracking
                    </p>
                    <p className="text-xs text-gray-600">
                      Actual time is inferred automatically from the scheduled
                      start time up to the moment you mark this task completed.
                      Notifications help prompt that completion or missed update.
                    </p>
                  </div>
                )}

                {actionError && (
                  <p className="mb-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {actionError}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  {!isFinalized && (
                    <button
                      onClick={handleMarkCompleted}
                      disabled={actionLoading}
                      className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                    >
                      Mark Completed
                    </button>
                  )}

                  {!isFinalized && (
                    <button
                      onClick={handleMarkMissed}
                      disabled={actionLoading}
                      className="px-4 py-2 rounded-lg bg-amber-500 text-white text-xs font-semibold"
                    >
                      Mark Missed
                    </button>
                  )}

                  {!isFinalized && (
                    <button
                      onClick={() => navigate(`/tasks/${task.id}/edit`)}
                      className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold"
                    >
                      Edit
                    </button>
                  )}

                  {!isFinalized &&
                    !task.isSplitSegment &&
                    task.estimatedMinutes >= 180 && (
                      <button
                        onClick={() => navigate(`/tasks/${task.id}/split`)}
                        className="px-4 py-2 rounded-lg bg-amber-600 text-white text-xs font-semibold"
                      >
                        Split Task
                      </button>
                    )}

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
