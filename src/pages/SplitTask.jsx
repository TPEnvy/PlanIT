// src/pages/SplitTask.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { firestore } from "../server.js/firebase";
import { useAuth } from "../contexts/AuthContext";
import Navbar from "../components/Navbar";

export default function SplitTask() {
  const { id } = useParams(); // /tasks/:id/split
  const navigate = useNavigate();
  const { user } = useAuth();

  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [segmentTitles, setSegmentTitles] = useState([]);

  // Load original task
  useEffect(() => {
    if (!user || !id) {
      setLoading(false);
      return;
    }

    const fetchTask = async () => {
      try {
        const ref = doc(firestore, `users/${user.uid}/tasks/${id}`);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          setError("Task not found.");
          setTask(null);
        } else {
          const data = snap.data();
          setTask({ id: snap.id, ...data });
        }
      } catch (err) {
        console.error("Error loading task:", err);
        setError("Failed to load task.");
      } finally {
        setLoading(false);
      }
    };

    fetchTask();
  }, [user, id]);

  // 🔢 total estimated minutes of the original task
  const totalMinutes = useMemo(() => {
    if (!task || typeof task.estimatedMinutes !== "number") return null;
    return task.estimatedMinutes;
  }, [task]);

  // 🔢 Automatic segment count (hour-based: ~1h per segment, clamp 2–8)
  const autoSegmentCount = useMemo(() => {
    if (!totalMinutes || totalMinutes <= 0) return 2;

    // only tasks >= 3h are intended to be split
    if (totalMinutes < 180) return 2;

    let base = Math.round(totalMinutes / 60); // 180 → 3, 240 → 4, etc.
    if (base < 2) base = 2;
    if (base > 8) base = 8;
    return base;
  }, [totalMinutes]);

  // 🔢 per-segment minutes
  const perSegmentMinutes = useMemo(() => {
    if (!totalMinutes || !autoSegmentCount) return null;
    return Math.round(totalMinutes / autoSegmentCount);
  }, [totalMinutes, autoSegmentCount]);

  // 🧠 Adaptive Work–Break Ratio (AWBR) for one segment (in minutes)
  function computeBreakMinutesForSegment(segmentMinutes) {
    if (!segmentMinutes || segmentMinutes <= 0) return 0;

    // Case 1: short segments (≤ 8 hours) → Pomodoro-like 20%
    if (segmentMinutes <= 480) {
      let breakMins = Math.round(segmentMinutes * 0.2); // 20%
      if (breakMins < 5) breakMins = 5;
      if (breakMins > 30) breakMins = 30;
      return breakMins;
    }

    // Case 2: medium segments (8h – 7 days) → 10% of time, 1–4 hours
    if (segmentMinutes <= 10080) {
      const rawMinutes = segmentMinutes * 0.1; // 10%
      let breakHours = Math.round(rawMinutes / 60);
      if (breakHours < 1) breakHours = 1;
      if (breakHours > 4) breakHours = 4;
      return breakHours * 60;
    }

    // Case 3: very long (≥ 1 week) → 1–3 days off
    const days = segmentMinutes / 1440;
    let breakDays = Math.round(days / 7); // 1 day per 7 working days
    if (breakDays < 1) breakDays = 1;
    if (breakDays > 3) breakDays = 3;
    return breakDays * 1440;
  }

  // Initialize / update segment titles when task or segment count changes
  useEffect(() => {
    if (!task || !autoSegmentCount) return;

    setSegmentTitles((prev) => {
      const arr = [];
      for (let i = 0; i < autoSegmentCount; i++) {
        const existing = prev[i];
        if (existing && existing.trim()) {
          arr.push(existing);
        } else {
          arr.push(
            `${task.title || "Task"} (Part ${i + 1}/${autoSegmentCount})`
          );
        }
      }
      return arr;
    });
  }, [task, autoSegmentCount]);

  const handleSegmentTitleChange = (index, value) => {
    setSegmentTitles((prev) => {
      const copy = [...prev];
      copy[index] = value;
      return copy;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!user) {
      setError("User not authenticated.");
      return;
    }
    if (!task) {
      setError("Task not loaded.");
      return;
    }

    if (!totalMinutes || totalMinutes < 180) {
      setError(
        "This task is estimated under 3 hours. The split feature is designed for tasks ≥ 180 minutes."
      );
      return;
    }

    if (!autoSegmentCount || autoSegmentCount < 2) {
      setError("Automatic segment count is invalid.");
      return;
    }

    setSaving(true);

    try {
      const tasksRef = collection(firestore, `users/${user.uid}/tasks`);

      // compute break recommendation for each segment
      const breakMinutes = computeBreakMinutesForSegment(
        perSegmentMinutes || 0
      );

      // Create each segment
      for (let i = 0; i < autoSegmentCount; i++) {
        const segRef = doc(tasksRef);
        const segTitle =
          segmentTitles[i] && segmentTitles[i].trim()
            ? segmentTitles[i].trim()
            : `${task.title || "Task"} (Part ${i + 1}/${autoSegmentCount})`;

        const normalizedTitle =
          (task.normalizedTitle || task.title || "task")
            .toString()
            .trim()
            .toLowerCase();

        const segmentData = {
          id: segRef.id,
          userId: user.uid,
          title: segTitle,
          normalizedTitle,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),

          // base ML fields
          completedCount: 0,
          missedCount: 0,
          lastOutcome: null,
          lastCompletedAt: null,
          lastActualMinutes: null,
          totalCompletions: 0,
          totalActualMinutes: 0,

          // treat segments as flexible to-do steps
          mode: "floating",
          startDate: null,
          startTime: null,
          endDate: null,
          endTime: null,
          dueDate: task.dueDate || null,

          // per-segment estimate + break for research
          estimatedMinutes: perSegmentMinutes || null,
          breakMinutes: breakMinutes || 0,

          urgencyLevel: null,
          importanceLevel: null,
          difficultyLevel: task.difficultyLevel || null,
          startAt: null,
          endAt: null,

          // split metadata
          isSplitSegment: true,
          parentTaskId: task.id,
          segmentIndex: i + 1,
          segmentCount: autoSegmentCount,
          sourceWasSuggestion: true,
        };

        await setDoc(segRef, segmentData);
      }

      // Mark parent as split
      const parentRef = doc(
        firestore,
        `users/${user.uid}/tasks/${task.id}`
      );

      await updateDoc(parentRef, {
        isSplitParent: true,
        splitSegmentCount: autoSegmentCount,
        originalEstimatedMinutes:
          typeof task.estimatedMinutes === "number"
            ? task.estimatedMinutes
            : null,
        splitAt: serverTimestamp(),
      });

      navigate("/tasks");
    } catch (err) {
      console.error("Error splitting task:", err);
      setError("Failed to split task. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (task) navigate(`/tasks/${task.id}`);
    else navigate("/tasks");
  };

  // helper for UI display of break
  function breakLabel(minutes) {
    if (!minutes || minutes <= 0) return "No break";
    if (minutes < 60) return `${minutes} min`;
    const hours = minutes / 60;
    if (hours < 24) return `${hours.toFixed(hours % 1 === 0 ? 0 : 1)} h`;
    const days = minutes / 1440;
    return `${days.toFixed(days % 1 === 0 ? 0 : 1)} day(s)`;
  }

  const recommendedBreakMinutes = useMemo(
    () =>
      perSegmentMinutes
        ? computeBreakMinutesForSegment(perSegmentMinutes)
        : 0,
    [perSegmentMinutes]
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100">
      <Navbar />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <button
          type="button"
          onClick={handleCancel}
          className="mb-4 inline-flex items-center text-sm text-emerald-700 hover:underline"
        >
          ← Back
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
              <h1 className="text-2xl font-bold text-emerald-800 mb-1">
                Split long task
              </h1>
              <p className="text-sm text-gray-600 mb-4">
                This tool automatically breaks a long task into smaller,
                trackable segments and recommends a break duration for each
                segment using an Adaptive Work–Break Ratio model.
              </p>

              {/* Original task summary */}
              <div className="mb-4 rounded-xl border border-emerald-100 bg-emerald-50/70 p-4 text-sm">
                <p className="font-semibold text-emerald-800">
                  {task.title || "Untitled task"}
                </p>
                {task.startDate && (
                  <p className="text-gray-700 mt-1">
                    <span className="font-medium">Schedule:</span>{" "}
                    {task.startDate} {task.startTime} → {task.endDate}{" "}
                    {task.endTime}
                  </p>
                )}
                {typeof task.estimatedMinutes === "number" && (
                  <p className="text-gray-700 mt-1">
                    <span className="font-medium">Estimated duration:</span>{" "}
                    {task.estimatedMinutes >= 60
                      ? `${(task.estimatedMinutes / 60).toFixed(1)} h`
                      : `${task.estimatedMinutes} min`}
                  </p>
                )}

                {totalMinutes && autoSegmentCount >= 2 && (
                  <div className="mt-3 text-xs text-gray-700 bg-white/70 rounded-lg p-3 border border-emerald-100">
                    <p className="font-semibold text-emerald-800 mb-1">
                      Automatic split & break formula
                    </p>
                    <p>
                      Segments:
                      <br />
                      <span className="font-mono">
                        segments = clamp(round(totalMinutes / 60), 2, 8)
                      </span>
                      <br />
                      → totalMinutes = {totalMinutes} → segments ={" "}
                      {autoSegmentCount}
                    </p>
                    <p className="mt-1">
                      Per segment duration:
                      <br />
                      <span className="font-mono">
                        minutesPerSegment = totalMinutes / segments
                      </span>
                      <br />
                      → {totalMinutes} / {autoSegmentCount} ≈{" "}
                      {perSegmentMinutes} min
                    </p>
                    <p className="mt-1">
                      Break (AWBR model) per segment:
                      <br />
                      <span className="font-mono">
                        breakMinutes = f(minutesPerSegment)
                      </span>
                      <br />
                      → recommended break ≈{" "}
                      <span className="font-semibold text-emerald-800">
                        {breakLabel(recommendedBreakMinutes)}
                      </span>
                    </p>
                  </div>
                )}
              </div>

              {error && (
                <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Segment summary */}
                <div>
                  <p className="text-sm font-medium text-emerald-700">
                    Automatic segments
                  </p>
                  {(!totalMinutes || totalMinutes < 180) && (
                    <p className="text-xs text-red-600 mt-1">
                      This task is estimated under 3 hours. The split feature is
                      designed for tasks with estimated duration ≥ 180 minutes.
                    </p>
                  )}
                  {totalMinutes && totalMinutes >= 180 && (
                    <p className="text-xs text-gray-700 mt-1">
                      This task will be split into{" "}
                      <span className="font-semibold text-emerald-800">
                        {autoSegmentCount} segments
                      </span>
                      , each representing about{" "}
                      <span className="font-semibold text-emerald-800">
                        {perSegmentMinutes} minutes
                      </span>{" "}
                      of work with a recommended break of{" "}
                      <span className="font-semibold text-emerald-800">
                        {breakLabel(recommendedBreakMinutes)}
                      </span>{" "}
                      between segments.
                    </p>
                  )}
                </div>

                {/* Segment titles (editable but prefilled) */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-emerald-800">
                    Segment titles
                  </p>
                  {segmentTitles.map((title, idx) => (
                    <div key={idx}>
                      <label className="text-xs text-gray-600 mb-1 block">
                        Segment {idx + 1}
                      </label>
                      <input
                        type="text"
                        value={title}
                        onChange={(e) =>
                          handleSegmentTitleChange(idx, e.target.value)
                        }
                        className="w-full p-2.5 rounded-lg border border-emerald-100 focus:ring-2 focus:ring-emerald-400 outline-none text-sm"
                      />
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div className="flex flex-col sm:flex-row gap-3 sm:justify-end pt-3">
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={saving}
                    className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 bg-white hover:bg-gray-50 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition disabled:opacity-60"
                  >
                    {saving ? "Splitting..." : "Split Task"}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
