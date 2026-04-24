import React from "react";

function formatScheduleWindow(start, end) {
  if (!start || !end) {
    return "Schedule unavailable";
  }

  const startDate = new Date(start);
  const endDate = new Date(end);
  const sameDay = startDate.toDateString() === endDate.toDateString();

  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  if (sameDay) {
    return `${dateFormatter.format(startDate)}, ${timeFormatter.format(
      startDate
    )} - ${timeFormatter.format(endDate)}`;
  }

  return `${dateFormatter.format(startDate)}, ${timeFormatter.format(
    startDate
  )} to ${dateFormatter.format(endDate)}, ${timeFormatter.format(endDate)}`;
}

function uniqueTasksById(tasks = []) {
  const seen = new Set();

  return tasks.filter((task) => {
    const key = task?.id || `${task?.title || "untitled"}-${task?.startAt || ""}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export default function ScheduleConflictDialog({
  open = false,
  validation = null,
  proposedStart = null,
  proposedEnd = null,
  suggestedWindow = null,
  onClose,
  onProceed,
  onUseSuggestion,
  submitting = false,
}) {
  if (!open) {
    return null;
  }

  const duplicateTasks = uniqueTasksById(validation?.duplicates || []);
  const overlappingTasks = uniqueTasksById(validation?.conflicts || []);
  const hasSuggestedWindow = Boolean(suggestedWindow?.start && suggestedWindow?.end);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-emerald-950/40 p-4">
      <div className="w-full max-w-xl rounded-2xl border border-emerald-100 bg-white shadow-2xl">
        <div className="border-b border-emerald-100 px-6 py-4">
          <h2 className="text-lg font-bold text-emerald-900">
            Schedule conflict detected
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            This task overlaps an existing schedule. You can keep it anyway or
            move it to the next available time.
          </p>
        </div>

        <div className="space-y-4 px-6 py-5 text-sm text-gray-700">
          <div className="rounded-xl bg-amber-50 p-4">
            <p className="font-semibold text-amber-800">Requested time</p>
            <p className="mt-1 text-amber-900">
              {formatScheduleWindow(proposedStart, proposedEnd)}
            </p>
          </div>

          {duplicateTasks.length > 0 && (
            <div className="rounded-xl border border-rose-100 bg-rose-50 p-4">
              <p className="font-semibold text-rose-800">
                Possible duplicate in the same time frame
              </p>
              <p className="mt-1 text-rose-900">
                Matching task title found for:
              </p>
              <ul className="mt-2 space-y-1 text-rose-900">
                {duplicateTasks.slice(0, 4).map((task) => (
                  <li key={task.id || task.title}>
                    {task.title || "Untitled task"}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-rose-700">
                Split-task records are ignored for duplicate checks.
              </p>
            </div>
          )}

          {overlappingTasks.length > 0 && (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
              <p className="font-semibold text-emerald-800">
                Overlapping tasks
              </p>
              <ul className="mt-2 space-y-1 text-emerald-900">
                {overlappingTasks.slice(0, 4).map((task) => (
                  <li key={task.id || task.title}>
                    {task.title || "Untitled task"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-xl bg-slate-50 p-4">
            <p className="font-semibold text-slate-800">
              Recommended available time
            </p>
            <p className="mt-1 text-slate-900">
              {hasSuggestedWindow
                ? formatScheduleWindow(
                    suggestedWindow.start,
                    suggestedWindow.end
                  )
                : "No alternate slot was found in the current search window."}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-emerald-100 px-6 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onProceed}
            disabled={submitting}
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Proceed anyway
          </button>
          <button
            type="button"
            onClick={onUseSuggestion}
            disabled={submitting || !hasSuggestedWindow}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Use recommended time
          </button>
        </div>
      </div>
    </div>
  );
}
