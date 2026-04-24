// src/pages/CreateTask.jsx
import React, { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import { firestore } from "../server.js/firebase";
import Navbar from "../components/Navbar";
import ScheduleConflictDialog from "../components/ScheduleConflictDialog";
import { useAuth } from "../contexts/AuthContext";
import {
  buildPreventNewTasksMessage,
  getPreventNewTasksBlock,
  normalizePatternTitle,
  recomputeAndSavePatternStats,
  shouldPreventNewTasks,
} from "../utils/pattern";
import {
  buildLocalDateTime,
  buildScheduleValidationMessage,
  findNextAvailableWindow,
  toLocalDateInput,
  toLocalTimeInput,
  validateScheduledSlot,
} from "../utils/taskHelpers";

export default function CreateTask() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const prefillDue = (location.state && location.state.dueDate) || "";

  const [title, setTitle] = useState("");
  const [mode, setMode] = useState(prefillDue ? "scheduled" : "todo");
  const isScheduled = mode === "scheduled";

  const [startDate, setStartDate] = useState(prefillDue || "");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState(prefillDue || "");
  const [endTime, setEndTime] = useState("");

  const [urgencyLevel, setUrgencyLevel] = useState("urgent");
  const [importanceLevel, setImportanceLevel] = useState("important");
  const [difficultyLevel, setDifficultyLevel] = useState("easy");

  const [estimatedMinutesManual, setEstimatedMinutesManual] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [scheduleConflictDialog, setScheduleConflictDialog] = useState(null);

  const estimatedMinutes = useMemo(() => {
    if (!isScheduled) {
      if (
        estimatedMinutesManual &&
        !Number.isNaN(Number(estimatedMinutesManual))
      ) {
        return Math.max(0, Math.round(Number(estimatedMinutesManual)));
      }
      return null;
    }

    if (!startDate || !startTime || !endDate || !endTime) return null;

    const start = new Date(`${startDate}T${startTime}`);
    const end = new Date(`${endDate}T${endTime}`);

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start
    ) {
      return null;
    }

    return Math.round((end.getTime() - start.getTime()) / 60000);
  }, [isScheduled, startDate, startTime, endDate, endTime, estimatedMinutesManual]);

  const handleSubmit = async (e, submitOptions = {}) => {
    e?.preventDefault?.();
    const { conflictResolution = "default", overrideWindow = null } =
      submitOptions;
    setError("");
    if (conflictResolution === "default") {
      setScheduleConflictDialog(null);
    }

    let scheduledStart = null;
    let scheduledEnd = null;
    let effectiveStartDate = startDate;
    let effectiveStartTime = startTime;
    let effectiveEndDate = endDate;
    let effectiveEndTime = endTime;

    if (!user) {
      setError("You must be signed in to create a task.");
      return;
    }

    if (!title.trim()) {
      setError("Task title is required.");
      return;
    }

    if (isScheduled) {
      if (!effectiveStartDate || !effectiveStartTime || !effectiveEndDate || !effectiveEndTime) {
        setError("Start and end date/time are required for scheduled tasks.");
        return;
      }

      const start = buildLocalDateTime(effectiveStartDate, effectiveStartTime);
      const end = buildLocalDateTime(effectiveEndDate, effectiveEndTime);

      if (!start || !end) {
        setError("Invalid start or end date/time.");
        return;
      }

      if (end <= start) {
        setError("End must be after start.");
        return;
      }

      if (start < new Date()) {
        setError("Start time must be in the future.");
        return;
      }

      scheduledStart = start;
      scheduledEnd = end;
    }

    if (
      isScheduled &&
      conflictResolution === "suggested" &&
      overrideWindow?.start &&
      overrideWindow?.end
    ) {
      scheduledStart = new Date(overrideWindow.start);
      scheduledEnd = new Date(overrideWindow.end);
      effectiveStartDate = toLocalDateInput(scheduledStart);
      effectiveStartTime = toLocalTimeInput(scheduledStart);
      effectiveEndDate = toLocalDateInput(scheduledEnd);
      effectiveEndTime = toLocalTimeInput(scheduledEnd);

      setStartDate(effectiveStartDate);
      setStartTime(effectiveStartTime);
      setEndDate(effectiveEndDate);
      setEndTime(effectiveEndTime);
    }

    setSaving(true);

    try {
      const blockedPattern = await getPreventNewTasksBlock(user.uid);
      if (blockedPattern) {
        const message = buildPreventNewTasksMessage(
          blockedPattern.normalizedTitle || blockedPattern.id
        );
        window.alert(message);
        setError(message);
        setSaving(false);
        return;
      }

      const normalizedTitle = normalizePatternTitle(title);
      const tasksRef = collection(firestore, `users/${user.uid}/tasks`);
      let savedTaskId = null;

      if (isScheduled && scheduledStart && scheduledEnd) {
        const tasksSnapshot = await getDocs(tasksRef);
        const existingTasks = tasksSnapshot.docs.map((taskDoc) => ({
          id: taskDoc.id,
          ...taskDoc.data(),
        }));
        const validation = validateScheduledSlot(
          existingTasks,
          scheduledStart,
          scheduledEnd,
          {
            normalizedTitle,
            candidateIsSplitTask: false,
          }
        );
        const isReviewableConflict =
          validation.reason === "overlap" || validation.reason === "duplicate";

        if (
          !validation.isValid &&
          isReviewableConflict &&
          conflictResolution !== "proceed"
        ) {
          const suggestedWindow = findNextAvailableWindow({
            tasks: existingTasks,
            desiredStart: scheduledStart,
            durationMinutes: Math.max(
              1,
              Math.round(
                (scheduledEnd.getTime() - scheduledStart.getTime()) / 60000
              )
            ),
            normalizedTitle,
            candidateIsSplitTask: false,
          });

          setScheduleConflictDialog({
            validation,
            proposedStart: scheduledStart.toISOString(),
            proposedEnd: scheduledEnd.toISOString(),
            suggestedWindow,
          });
          setSaving(false);
          return;
        }

        if (!validation.isValid) {
          setError(buildScheduleValidationMessage(validation));
          setSaving(false);
          return;
        }

        const newRef = doc(tasksRef);
        const payload = {
          id: newRef.id,
          userId: user.uid,
          title: title.trim(),
          normalizedTitle,
          patternKey: normalizedTitle,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          mode: "scheduled",
          startDate: effectiveStartDate,
          startTime: effectiveStartTime,
          endDate: effectiveEndDate,
          endTime: effectiveEndTime,
          startAt: Timestamp.fromDate(scheduledStart),
          endAt: Timestamp.fromDate(scheduledEnd),
          dueDate: Timestamp.fromDate(scheduledEnd),
          estimatedMinutes: Math.round(
            (scheduledEnd.getTime() - scheduledStart.getTime()) / 60000
          ),
          breakMinutes: null,
          urgencyLevel,
          importanceLevel,
          difficultyLevel,
          completedCount: 0,
          missedCount: 0,
          totalCompletions: 0,
          totalActualMinutes: 0,
          lastCompletedAt: null,
          lastMissedAt: null,
          status: "pending",
          finalized: false,
          isSplitParent: false,
          isSplitSegment: false,
          splitSegmentCount: null,
          parentTaskId: null,
        };

        await setDoc(newRef, payload);
        savedTaskId = newRef.id;
      } else {
        const newRef = doc(tasksRef);
        const payload = {
          id: newRef.id,
          userId: user.uid,
          title: title.trim(),
          normalizedTitle,
          patternKey: normalizedTitle,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          mode: "floating",
          startDate: null,
          startTime: null,
          endDate: null,
          endTime: null,
          startAt: null,
          endAt: null,
          dueDate: null,
          estimatedMinutes: estimatedMinutes != null ? estimatedMinutes : null,
          breakMinutes: null,
          urgencyLevel: null,
          importanceLevel: null,
          difficultyLevel: null,
          completedCount: 0,
          missedCount: 0,
          totalCompletions: 0,
          totalActualMinutes: 0,
          lastCompletedAt: null,
          lastMissedAt: null,
          status: "pending",
          finalized: false,
          isSplitParent: false,
          isSplitSegment: false,
          splitSegmentCount: null,
          parentTaskId: null,
        };

        await setDoc(newRef, payload);
        savedTaskId = newRef.id;
      }
      const patternData = await recomputeAndSavePatternStats(
        user.uid,
        normalizedTitle,
        {
          propagate: true,
        }
      );

      if (shouldPreventNewTasks(patternData)) {
        window.alert(
          buildPreventNewTasksMessage(
            patternData?.normalizedTitle || normalizedTitle
          )
        );
      }

      try {
        const notifRef = doc(
          collection(firestore, `users/${user.uid}/notifications`)
        );
        await setDoc(notifRef, {
          id: notifRef.id,
          title: "New task created",
          body: `"${title.trim()}" was added to your tasks.`,
          type: "task_created",
          taskId: savedTaskId,
          createdAt: serverTimestamp(),
          read: false,
          channel: "all",
        });
      } catch (notifyError) {
        console.warn("Failed to create notification:", notifyError);
      }

      navigate("/tasks");
    } catch (err) {
      console.error("Create task failed:", err);
      setError("Failed to create task. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-500">
      <Navbar />

      <div className="max-w-lg mx-auto px-4 sm:px-6 py-6">
        <h1 className="text-2xl font-bold text-emerald-800 mb-2">
          Create Task
        </h1>
        <p className="text-sm text-gray-600 mb-4">
          Add a new scheduled or flexible task.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-100 text-red-700 text-sm">
            {error}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="space-y-4 bg-white shadow p-6 rounded-xl border border-emerald-100"
        >
          <div>
            <label className="text-sm font-medium text-emerald-700">
              Task Title
            </label>
            <input
              type="text"
              required
              maxLength={100}
              className="w-full p-3 mt-1 rounded-lg border focus:ring-2 focus:ring-emerald-400 outline-none text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Clean the room"
            />
            <p className="text-xs text-gray-400 mt-1">
              Normalized title will be saved for ML grouping (case and extra
              spaces ignored).
            </p>
          </div>

          <div className="inline-flex rounded-full bg-emerald-50 p-1">
            <button
              type="button"
              onClick={() => setMode("scheduled")}
              className={
                "px-3 py-1 text-xs font-semibold rounded-full transition " +
                (isScheduled
                  ? "bg-emerald-600 text-white shadow"
                  : "text-emerald-700 hover:bg-emerald-100")
              }
            >
              Scheduled (with date and time)
            </button>
            <button
              type="button"
              onClick={() => setMode("todo")}
              className={
                "px-3 py-1 text-xs font-semibold rounded-full transition " +
                (!isScheduled
                  ? "bg-emerald-600 text-white shadow"
                  : "text-emerald-700 hover:bg-emerald-100")
              }
            >
              To-Do Task (no date)
            </button>
          </div>

          {isScheduled ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-emerald-700">
                    Start Date
                  </label>
                  <input
                    type="date"
                    className="w-full p-3 mt-1 rounded-lg border"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-emerald-700">
                    End Date
                  </label>
                  <input
                    type="date"
                    className="w-full p-3 mt-1 rounded-lg border"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-emerald-700">
                    Start Time
                  </label>
                  <input
                    type="time"
                    className="w-full p-3 mt-1 rounded-lg border"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-emerald-700">
                    End Time
                  </label>
                  <input
                    type="time"
                    className="w-full p-3 mt-1 rounded-lg border"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-sm font-medium text-emerald-700">
                    Urgency
                  </label>
                  <select
                    className="w-full p-3 mt-1 rounded-lg border bg-white"
                    value={urgencyLevel}
                    onChange={(e) => setUrgencyLevel(e.target.value)}
                  >
                    <option value="urgent">Urgent</option>
                    <option value="somewhat_urgent">Somewhat urgent</option>
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium text-emerald-700">
                    Importance
                  </label>
                  <select
                    className="w-full p-3 mt-1 rounded-lg border bg-white"
                    value={importanceLevel}
                    onChange={(e) => setImportanceLevel(e.target.value)}
                  >
                    <option value="important">Important</option>
                    <option value="somewhat_important">
                      Somewhat important
                    </option>
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium text-emerald-700">
                    Difficulty
                  </label>
                  <select
                    className="w-full p-3 mt-1 rounded-lg border bg-white"
                    value={difficultyLevel}
                    onChange={(e) => setDifficultyLevel(e.target.value)}
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
              </div>

              <div className="text-xs text-gray-600">
                Estimated duration:{" "}
                <span className="font-semibold text-emerald-700">
                  {estimatedMinutes
                    ? estimatedMinutes >= 60
                      ? `${(estimatedMinutes / 60).toFixed(1)} h`
                      : `${estimatedMinutes} min`
                    : "-"}
                </span>
              </div>
            </>
          ) : (
            <div>
              <label className="text-sm font-medium text-emerald-700">
                Estimated minutes (optional)
              </label>
              <input
                type="number"
                min={1}
                className="w-full p-3 mt-1 rounded-lg border"
                value={estimatedMinutesManual}
                onChange={(e) => setEstimatedMinutesManual(e.target.value)}
                placeholder="e.g. 90"
              />
              <p className="text-xs text-gray-400 mt-1">
                Optional estimate for to-do tasks (minutes).
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 mt-4">
            <button
              type="button"
              disabled={saving}
              onClick={() => navigate("/tasks")}
              className="px-4 py-2 rounded-lg border"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white"
            >
              {saving ? "Creating..." : "Create Task"}
            </button>
          </div>
        </form>
      </div>

      <ScheduleConflictDialog
        open={Boolean(scheduleConflictDialog)}
        validation={scheduleConflictDialog?.validation}
        proposedStart={scheduleConflictDialog?.proposedStart}
        proposedEnd={scheduleConflictDialog?.proposedEnd}
        suggestedWindow={scheduleConflictDialog?.suggestedWindow}
        submitting={saving}
        onClose={() => setScheduleConflictDialog(null)}
        onProceed={() => {
          setScheduleConflictDialog(null);
          handleSubmit(null, { conflictResolution: "proceed" });
        }}
        onUseSuggestion={() => {
          const suggestedWindow = scheduleConflictDialog?.suggestedWindow;
          if (!suggestedWindow?.start || !suggestedWindow?.end) {
            return;
          }

          setScheduleConflictDialog(null);
          handleSubmit(null, {
            conflictResolution: "suggested",
            overrideWindow: suggestedWindow,
          });
        }}
      />
    </div>
  );
}
