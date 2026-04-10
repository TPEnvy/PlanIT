// src/pages/CreateTask.jsx
import React, { useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  collection,
  doc,
  setDoc,
  serverTimestamp,
  Timestamp,
  getDoc,
} from "firebase/firestore";
import { firestore } from "../server.js/firebase";
import Navbar from "../components/Navbar";
import { useAuth } from "../contexts/AuthContext";

export default function CreateTask() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // If the calendar passed a date via state, prefill due/start/end
  const prefillDue = (location.state && location.state.dueDate) || "";

  const [title, setTitle] = useState("");
  const [mode, setMode] = useState(prefillDue ? "scheduled" : "todo"); // scheduled | todo
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

  // compute estimatedMinutes if scheduled and start/end set
  const estimatedMinutes = useMemo(() => {
    if (!isScheduled) {
      if (estimatedMinutesManual && !Number.isNaN(Number(estimatedMinutesManual))) {
        return Math.max(0, Math.round(Number(estimatedMinutesManual)));
      }
      return null;
    }
    if (!startDate || !startTime || !endDate || !endTime) return null;
    const s = new Date(`${startDate}T${startTime}`);
    const e = new Date(`${endDate}T${endTime}`);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) return null;
    return Math.round((e.getTime() - s.getTime()) / 60000);
  }, [isScheduled, startDate, startTime, endDate, endTime, estimatedMinutesManual]);

  // helper to normalize titles (collapse spaces, lowercase)
  function normalizeTitle(t) {
    return String(t || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!user) {
      setError("You must be signed in to create a task.");
      return;
    }

    if (!title.trim()) {
      setError("Task title is required.");
      return;
    }

    if (isScheduled) {
      if (!startDate || !startTime || !endDate || !endTime) {
        setError("Start and end date/time are required for scheduled tasks.");
        return;
      }
      const s = new Date(`${startDate}T${startTime}`);
      const e = new Date(`${endDate}T${endTime}`);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
        setError("Invalid start or end date/time.");
        return;
      }
      if (e <= s) {
        setError("End must be after start.");
        return;
      }
      // disallow scheduling in the past
      const now = new Date();
      if (s < now) {
        setError("Start time must be in the future.");
        return;
      }
    }

    setSaving(true);

    try {
      const normalizedTitle = normalizeTitle(title);
      // Check patterns doc to see if creation is prevented
      try {
        const patternRef = doc(firestore, `users/${user.uid}/patterns/${normalizedTitle}`);
        const psnap = await getDoc(patternRef);
        if (psnap.exists()) {
          const pdata = psnap.data() || {};
          if (pdata.preventNewTasks) {
            setError(
              "Cannot create this task type automatically — the system detected repeated misses for this task name. Consider renaming or splitting existing tasks."
            );
            setSaving(false);
            return;
          }
        }
      } catch (err) {
        // if pattern read fails, continue — it's non-fatal
        console.warn("Could not read pattern doc before create:", err);
      }

      const tasksRef = collection(firestore, `users/${user.uid}/tasks`);
      const newRef = doc(tasksRef); // auto id

      const startAt = isScheduled && startDate && startTime ? Timestamp.fromDate(new Date(`${startDate}T${startTime}`)) : null;
      const endAt = isScheduled && endDate && endTime ? Timestamp.fromDate(new Date(`${endDate}T${endTime}`)) : null;
      const dueDateVal = isScheduled && endDate ? Timestamp.fromDate(new Date(endDate)) : null;

      const estMinutes = estimatedMinutes != null ? estimatedMinutes : null;

      const nowTs = serverTimestamp();

      const payload = {
        id: newRef.id,
        userId: user.uid,
        title: title.trim(),
        normalizedTitle: normalizedTitle,
        createdAt: nowTs,
        updatedAt: nowTs,
        // mode + scheduling
        mode: isScheduled ? "scheduled" : "floating",
        startDate: isScheduled ? startDate : null,
        startTime: isScheduled ? startTime : null,
        endDate: isScheduled ? endDate : null,
        endTime: isScheduled ? endTime : null,
        startAt: startAt,
        endAt: endAt,
        dueDate: dueDateVal,

        // estimates + meta
        estimatedMinutes: estMinutes,
        breakMinutes: null,
        urgencyLevel: isScheduled ? urgencyLevel : null,
        importanceLevel: isScheduled ? importanceLevel : null,
        difficultyLevel: isScheduled ? difficultyLevel : null,

        // ML / tracking fields
        completedCount: 0,
        missedCount: 0,
        totalCompletions: 0,
        totalActualMinutes: 0,
        lastCompletedAt: null,
        lastMissedAt: null,
        status: "pending",
        finalized: false,

        // split metadata (defaults)
        isSplitParent: false,
        isSplitSegment: false,
        splitSegmentCount: null,
        parentTaskId: null,
      };

      await setDoc(newRef, payload);

      // create a UI notification for the user (best-effort)
      try {
        const notifRef = doc(collection(firestore, `users/${user.uid}/notifications`));
        await setDoc(notifRef, {
          id: notifRef.id,
          title: "New task created",
          body: `“${payload.title}” was added to your tasks.`,
          type: "task_created",
          taskId: newRef.id,
          createdAt: serverTimestamp(),
          read: false,
          channel: "all",
        });
      } catch (err) {
        console.warn("Failed to create notification:", err);
      }

      // navigate to tasks list
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
        <h1 className="text-2xl font-bold text-emerald-800 mb-2">Create Task</h1>
        <p className="text-sm text-gray-600 mb-4">Add a new scheduled or flexible task.</p>

        {error && <div className="mb-4 p-3 rounded-lg bg-red-100 text-red-700 text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4 bg-white shadow p-6 rounded-xl border border-emerald-100">
          <div>
            <label className="text-sm font-medium text-emerald-700">Task Title</label>
            <input
              type="text"
              required
              maxLength={100}
              className="w-full p-3 mt-1 rounded-lg border focus:ring-2 focus:ring-emerald-400 outline-none text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Clean the room"
            />
            <p className="text-xs text-gray-400 mt-1">Normalized title will be saved for ML grouping (case & extra spaces ignored).</p>
          </div>

          <div className="inline-flex rounded-full bg-emerald-50 p-1">
            <button
              type="button"
              onClick={() => setMode("scheduled")}
              className={
                "px-3 py-1 text-xs font-semibold rounded-full transition " +
                (isScheduled ? "bg-emerald-600 text-white shadow" : "text-emerald-700 hover:bg-emerald-100")
              }
            >
              Scheduled (with date & time)
            </button>
            <button
              type="button"
              onClick={() => setMode("todo")}
              className={
                "px-3 py-1 text-xs font-semibold rounded-full transition " +
                (!isScheduled ? "bg-emerald-600 text-white shadow" : "text-emerald-700 hover:bg-emerald-100")
              }
            >
              To-Do Task (no date)
            </button>
          </div>

          {isScheduled ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-emerald-700">Start Date</label>
                  <input type="date" className="w-full p-3 mt-1 rounded-lg border" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium text-emerald-700">End Date</label>
                  <input type="date" className="w-full p-3 mt-1 rounded-lg border" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-emerald-700">Start Time</label>
                  <input type="time" className="w-full p-3 mt-1 rounded-lg border" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium text-emerald-700">End Time</label>
                  <input type="time" className="w-full p-3 mt-1 rounded-lg border" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-sm font-medium text-emerald-700">Urgency</label>
                  <select className="w-full p-3 mt-1 rounded-lg border bg-white" value={urgencyLevel} onChange={(e) => setUrgencyLevel(e.target.value)}>
                    <option value="urgent">Urgent</option>
                    <option value="somewhat_urgent">Somewhat urgent</option>
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium text-emerald-700">Importance</label>
                  <select className="w-full p-3 mt-1 rounded-lg border bg-white" value={importanceLevel} onChange={(e) => setImportanceLevel(e.target.value)}>
                    <option value="important">Important</option>
                    <option value="somewhat_important">Somewhat important</option>
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium text-emerald-700">Difficulty</label>
                  <select className="w-full p-3 mt-1 rounded-lg border bg-white" value={difficultyLevel} onChange={(e) => setDifficultyLevel(e.target.value)}>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
              </div>

              <div className="text-xs text-gray-600">
                Estimated duration:{" "}
                <span className="font-semibold text-emerald-700">
                  {estimatedMinutes ? (estimatedMinutes >= 60 ? `${(estimatedMinutes / 60).toFixed(1)} h` : `${estimatedMinutes} min`) : "—"}
                </span>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-sm font-medium text-emerald-700">Estimated minutes (optional)</label>
                <input
                  type="number"
                  min={1}
                  className="w-full p-3 mt-1 rounded-lg border"
                  value={estimatedMinutesManual}
                  onChange={(e) => setEstimatedMinutesManual(e.target.value)}
                  placeholder="e.g. 90"
                />
                <p className="text-xs text-gray-400 mt-1">Optional estimate for to-do tasks (minutes).</p>
              </div>
            </>
          )}

          <div className="flex justify-end gap-3 mt-4">
            <button type="button" disabled={saving} onClick={() => navigate("/tasks")} className="px-4 py-2 rounded-lg border">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-emerald-600 text-white">
              {saving ? "Creating..." : "Create Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
