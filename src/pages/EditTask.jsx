// src/pages/EditTask.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import { firestore, auth } from "../server.js/firebase";
import Navbar from "../components/Navbar";
import PageTransition from "../components/PageTransition";
import ScheduleConflictDialog from "../components/ScheduleConflictDialog";
import {
  buildLocalDateTime,
  toLocalDateInput,
  toLocalTimeInput,
} from "../utils/taskHelpers";
import { saveScheduledTask } from "../utils/scheduledTaskApi";

export default function EditTask() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = auth.currentUser;

  const [loadingTask, setLoadingTask] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [title, setTitle] = useState("");
  const [mode, setMode] = useState("scheduled");
  const isScheduled = mode === "scheduled";

  const [startDate, setStartDate] = useState(""); // "YYYY-MM-DD"
  const [startTime, setStartTime] = useState(""); // "HH:MM"
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");

  const [urgencyLevel, setUrgencyLevel] = useState("urgent");
  const [importanceLevel, setImportanceLevel] = useState("important");
  const [difficultyLevel, setDifficultyLevel] = useState("easy");

  // preserve current status to prevent edits when completed/missed
  const [currentStatus, setCurrentStatus] = useState(null);
  const [originalPatternKey, setOriginalPatternKey] = useState(null);
  const [scheduleConflictDialog, setScheduleConflictDialog] = useState(null);


  const makeDateTime = (dateStr, timeStr) => {
    return buildLocalDateTime(dateStr, timeStr);
  };

  useEffect(() => {
    if (!user || !id) return;

    const load = async () => {
      setLoadingTask(true);
      setError("");

      try {
        const ref = doc(firestore, `users/${user.uid}/tasks/${id}`);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setError("Task not found.");
          setLoadingTask(false);
          return;
        }

        const data = snap.data();

        setTitle(data.title || "");
        setOriginalPatternKey(data.patternKey || data.normalizedTitle);
        const hasDue = !!data.dueDate;
        setMode(hasDue ? "scheduled" : "todo");

        // preserve the original form fields (strings) so UI stays the same
        setStartDate(data.startDate || "");
        setStartTime(data.startTime || "");
        setEndDate(data.endDate || "");
        setEndTime(data.endTime || "");

        setUrgencyLevel(data.urgencyLevel || "urgent");
        setImportanceLevel(data.importanceLevel || "important");
        setDifficultyLevel(data.difficultyLevel || "easy");

        setCurrentStatus(data.status || "pending");
      } catch (err) {
        console.error("Error loading task:", err);
        setError("Failed to load task.");
      } finally {
        setLoadingTask(false);
      }
    };

    load();
  }, [user, id]);

  const estimatedMinutes = useMemo(() => {
    if (!isScheduled) return null;
    const start = makeDateTime(startDate, startTime);
    const end = makeDateTime(endDate, endTime);
    if (!start || !end || end <= start) return null;
    const diffMs = end.getTime() - start.getTime();
    return Math.round(diffMs / 60000);
  }, [isScheduled, startDate, startTime, endDate, endTime]);

  const durationLabel = useMemo(() => {
    if (estimatedMinutes == null) return "";
    const hours = estimatedMinutes / 60;
    return hours >= 1
      ? `${hours.toFixed(hours % 1 === 0 ? 0 : 1)} h`
      : `${estimatedMinutes} min`;
  }, [estimatedMinutes]);
  
  function normalizeTitle(t) {
    return String(t || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  const handleSubmit = async (e, submitOptions = {}) => {
    e?.preventDefault?.();
    const { conflictResolution = "default", overrideWindow = null } =
      submitOptions;
    setError("");
    if (conflictResolution === "default") {
      setScheduleConflictDialog(null);
    }

    if (!user) {
      setError("User not authenticated.");
      return;
    }
    if (!id) {
      setError("Missing task id.");
      return;
    }
    if (!title.trim()) {
      setError("Task title is required.");
      return;
    }

    // Prevent editing completed or missed tasks
    if (currentStatus === "completed" || currentStatus === "missed") {
      setError("Completed or missed tasks cannot be edited.");
      return;
    }

    let nextEstimatedMinutes = null;
    let dueDateValue = null;
    let start = null;
    let end = null;
    let effectiveStartDate = startDate;
    let effectiveStartTime = startTime;
    let effectiveEndDate = endDate;
    let effectiveEndTime = endTime;

    if (isScheduled) {
      if (!effectiveStartDate || !effectiveEndDate) {
        setError("Start date and end date are required for scheduled tasks.");
        return;
      }
      if (!effectiveStartTime || !effectiveEndTime) {
        setError("Start time and end time are required for scheduled tasks.");
        return;
      }

      start = makeDateTime(effectiveStartDate, effectiveStartTime);
      end = makeDateTime(effectiveEndDate, effectiveEndTime);

      if (!start || !end) {
        setError("Invalid date or time.");
        return;
      }

      if (end <= start) {
        setError("End date/time must be after start date/time.");
        return;
      }

      const now = new Date();
      if (start < now) {
        setError("You can't schedule a task in the past. Start time must be later than the current time.");
        return;
      }

      const diffMs = end.getTime() - start.getTime();
      nextEstimatedMinutes = Math.round(diffMs / 60000);
      // dueDateValue will be saved as Firestore Timestamp
      dueDateValue = end;
    }

    if (
      isScheduled &&
      conflictResolution === "suggested" &&
      overrideWindow?.start &&
      overrideWindow?.end
    ) {
      start = new Date(overrideWindow.start);
      end = new Date(overrideWindow.end);
      effectiveStartDate = toLocalDateInput(start);
      effectiveStartTime = toLocalTimeInput(start);
      effectiveEndDate = toLocalDateInput(end);
      effectiveEndTime = toLocalTimeInput(end);
      nextEstimatedMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
      dueDateValue = end;

      setStartDate(effectiveStartDate);
      setStartTime(effectiveStartTime);
      setEndDate(effectiveEndDate);
      setEndTime(effectiveEndTime);
    }

    setSaving(true);

    try {
      if (isScheduled && start && end) {
        const result = await saveScheduledTask({
          user,
          taskId: id,
          title: title.trim(),
          patternKey: originalPatternKey,
          startDate: effectiveStartDate,
          startTime: effectiveStartTime,
          endDate: effectiveEndDate,
          endTime: effectiveEndTime,
          urgencyLevel,
          importanceLevel,
          difficultyLevel,
          conflictResolution,
          overrideWindow,
        });

        if (!result.ok) {
          if (
            result.status === 409 &&
            result.payload?.code === "SCHEDULE_CONFLICT"
          ) {
            setScheduleConflictDialog({
              validation: result.payload.validation,
              proposedStart: result.payload.proposedStart,
              proposedEnd: result.payload.proposedEnd,
              suggestedWindow: result.payload.suggestedWindow,
            });
            setSaving(false);
            return;
          }

          setError(
            result.payload?.message || "Failed to update the scheduled task."
          );
          setSaving(false);
          return;
        }

        import("../utils/pattern").then(({ recomputeAndSavePatternStats }) => {
          if (originalPatternKey) {
            recomputeAndSavePatternStats(user.uid, originalPatternKey, {
              propagate: true,
            });
          }
        });

        try {
          const notifRef = doc(
            collection(firestore, `users/${user.uid}/notifications`)
          );
          await setDoc(notifRef, {
            id: notifRef.id,
            title: "Task updated",
            body: `"${title.trim() || "Untitled task"}" has been updated.`,
            type: "task_updated",
            taskId: id,
            createdAt: serverTimestamp(),
            read: false,
            channel: "all",
          });
        } catch (err) {
          console.error("Failed to create update notification:", err);
        }

        navigate("/tasks");
        return;
      }

      const ref = doc(firestore, `users/${user.uid}/tasks/${id}`);
      const normalizedTaskTitle = normalizeTitle(title);
      const updateData = {
        title: title.trim(),
        normalizedTitle: normalizedTaskTitle,
        patternKey: originalPatternKey,
        updatedAt: serverTimestamp(),
        userId: user.uid,
      };


      if (isScheduled) {
        updateData.startDate = effectiveStartDate;
        updateData.startTime = effectiveStartTime;
        updateData.endDate = effectiveEndDate;
        updateData.endTime = effectiveEndTime;
        updateData.dueDate = dueDateValue ? Timestamp.fromDate(dueDateValue) : null;
        updateData.estimatedMinutes = nextEstimatedMinutes;
        updateData.urgencyLevel = urgencyLevel;
        updateData.importanceLevel = importanceLevel;
        updateData.difficultyLevel = difficultyLevel;
        // explicit DateTime timestamps for scheduling (these are used by functions)
        updateData.startAt = start ? Timestamp.fromDate(start) : null;
        updateData.endAt = end ? Timestamp.fromDate(end) : null;
        // reset notification flags (schedule changed)
        updateData.notifiedLessThanDay = false;
        updateData.notifiedBeforeStart = false;
        updateData.notifiedBeforeEnd = false;
        updateData.notifiedByEmailStart = false;
        updateData.notifiedByEmailEnd = false;
        updateData.pushSent5m = false;
        updateData.pushSentBeforeEnd = false;
        updateData.pushSentStart = false;
        updateData.pushSentEnd = false;
      } else {
        updateData.startDate = null;
        updateData.startTime = null;
        updateData.endDate = null;
        updateData.endTime = null;
        updateData.dueDate = null;
        updateData.estimatedMinutes = null;
        updateData.urgencyLevel = null;
        updateData.importanceLevel = null;
        updateData.difficultyLevel = null;
        updateData.startAt = null;
        updateData.endAt = null;
        updateData.notifiedLessThanDay = false;
        updateData.notifiedBeforeStart = false;
        updateData.notifiedBeforeEnd = false;
        updateData.notifiedByEmailStart = false;
        updateData.notifiedByEmailEnd = false;
        updateData.pushSent5m = false;
        updateData.pushSentBeforeEnd = false;
        updateData.pushSentStart = false;
        updateData.pushSentEnd = false;
      }

      await updateDoc(ref, updateData);
      // Recompute ML pattern after edit
      import("../utils/pattern").then(({ recomputeAndSavePatternStats }) => {
        if (originalPatternKey) {
          recomputeAndSavePatternStats(user.uid, originalPatternKey, { propagate: true });
        }
      });


      // create update notification for UI (best-effort)
      try {
        const notifRef = doc(collection(firestore, `users/${user.uid}/notifications`));
        await setDoc(notifRef, {
          id: notifRef.id,
          title: "Task updated",
          body: `“${updateData.title || "Untitled task"}” has been updated.`,
          type: "task_updated",
          taskId: id,
          createdAt: serverTimestamp(),
          read: false,
          channel: "all",
        });
      } catch (err) {
        console.error("Failed to create update notification:", err);
      }

      navigate("/tasks");
    } catch (err) {
      console.error("Error updating task:", err);
      setError("Failed to update task. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loadingTask) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100">
        <Navbar />
        <div className="max-w-lg mx-auto px-4 sm:px-6 py-6 text-sm text-gray-700">
          Loading task...
        </div>
      </div>
    );
  }

  if (!loadingTask && error && !title) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100">
        <Navbar />
        <div className="max-w-lg mx-auto px-4 sm:px-6 py-6">
          <div className="p-4 bg-red-100 text-red-700 rounded-lg text-sm">
            {error || "Task not found."}
          </div>
          <button type="button" onClick={() => navigate("/tasks")} className="mt-4 px-4 py-2 rounded-lg border">Back to Tasks</button>
        </div>
      </div>
    );
  }

  return (
    <PageTransition>
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-500">
      <Navbar />

      <div className="max-w-lg mx-auto px-4 sm:px-6 py-6">
        <h1 className="text-2xl font-bold text-emerald-800 mb-2">Edit Task</h1>
        <p className="text-sm text-gray-600 mb-4">Update your scheduled task or convert it into a flexible to-do task.</p>

        <div className="inline-flex rounded-full bg-emerald-50 p-1 mb-4">
          <button type="button" onClick={() => setMode("scheduled")} className={"px-3 py-1 text-xs font-semibold rounded-full transition " + (isScheduled ? "bg-emerald-600 text-white shadow" : "text-emerald-700 hover:bg-emerald-100")}>Scheduled (with date & time)</button>
          <button type="button" onClick={() => setMode("todo")} className={"px-3 py-1 text-xs font-semibold rounded-full transition " + (!isScheduled ? "bg-emerald-600 text-white shadow" : "text-emerald-700 hover:bg-emerald-100")}>To-Do Task (no date)</button>
        </div>

        {error && <div className="mb-4 p-3 rounded-lg bg-red-100 text-red-700 text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4 bg-white shadow p-6 rounded-xl border border-emerald-100">
          <div>
            <label className="text-sm font-medium text-emerald-700">Task Title</label>
            <input type="text" required maxLength={100} className="w-full p-3 mt-1 rounded-lg border" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          {isScheduled && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-emerald-700">Start Date</label>
                  <input type="date" className="w-full p-3 mt-1 rounded-lg border focus:ring-2 focus:ring-emerald-400 outline-none text-sm" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium text-emerald-700">End Date</label>
                  <input type="date" className="w-full p-3 mt-1 rounded-lg border focus:ring-2 focus:ring-emerald-400 outline-none text-sm" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-emerald-700">Start Time</label>
                  <input type="time" className="w-full p-3 mt-1 rounded-lg border focus:ring-2 focus:ring-emerald-400 outline-none text-sm" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium text-emerald-700">End Time</label>
                  <input type="time" className="w-full p-3 mt-1 rounded-lg border focus:ring-2 focus:ring-emerald-400 outline-none text-sm" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-sm font-medium text-emerald-700">Urgency</label>
                  <select className="w-full p-3 mt-1 rounded-lg border bg-white focus:ring-2 focus:ring-emerald-400 text-sm outline-none" value={urgencyLevel} onChange={(e) => setUrgencyLevel(e.target.value)}>
                    <option value="urgent">Urgent</option>
                    <option value="somewhat_urgent">Somewhat urgent</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-emerald-700">Importance</label>
                  <select className="w-full p-3 mt-1 rounded-lg border bg-white focus:ring-2 focus:ring-emerald-400 text-sm outline-none" value={importanceLevel} onChange={(e) => setImportanceLevel(e.target.value)}>
                    <option value="important">Important</option>
                    <option value="somewhat_important">Somewhat important</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-emerald-700">Difficulty</label>
                  <select className="w-full p-3 mt-1 rounded-lg border bg-white focus:ring-2 focus:ring-emerald-400 text-sm outline-none" value={difficultyLevel} onChange={(e) => setDifficultyLevel(e.target.value)}>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
              </div>
              {durationLabel && <div className="text-xs text-gray-600">Estimated duration based on start/end: <span className="font-semibold text-emerald-700">{durationLabel}</span></div>}
            </>
          )}

          <div className="flex flex-col sm:flex-row gap-3 sm:justify-end mt-4">
            <button type="button" disabled={saving} onClick={() => navigate("/tasks")} className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 bg-white hover:bg-gray-50 transition">Cancel</button>
            <button
              type="submit"
              disabled={saving || currentStatus === "completed" || currentStatus === "missed"}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Changes"}
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
    </PageTransition>
  );
}
