import React from "react";
import { shouldSuggestSplit } from "../utils/pattern";

function safeDate(val) {
  if (!val) return null;
  try {
    if (val.toDate && typeof val.toDate === "function") return val.toDate();
    return new Date(val);
  } catch {
    return null;
  }
}

function formatYMDLocal(date) {
  if (!date) return null;
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
}

function breakLabel(minutes) {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(hours % 1 === 0 ? 0 : 1)} h`;
  const days = minutes / 1440;
  return `${days.toFixed(days % 1 === 0 ? 0 : 1)} day(s)`;
}

function sameMoment(left, right) {
  const leftDate = safeDate(left);
  const rightDate = safeDate(right);

  if (!leftDate || !rightDate) return false;
  return leftDate.getTime() === rightDate.getTime();
}

function TaskCard({
  task,
  tasks,
  patternStats,
  viewMode,
  handleOpenTask,
  handleEditTask,
  handleSplitTask,
  handleDeleteTask,
}) {
  const due = safeDate(task.dueDate);
  const dueText =
    viewMode === "scheduled"
      ? due
        ? formatYMDLocal(due)
        : "No due date"
      : "To-Do Task";

  const estimatedMinutes =
    typeof task.estimatedMinutes === "number" ? task.estimatedMinutes : null;

  const isSplitSegment = !!task.isSplitSegment;
  const isSplitParent = !!task.isSplitParent;

  const hasSegments = tasks.some(
    (t) => t.parentTaskId === task.id && t.isSplitSegment === true
  );

  const canSplitFromDuration = estimatedMinutes !== null && estimatedMinutes >= 180;
  const backendSuggestSplit =
    shouldSuggestSplit(patternStats) ||
    shouldSuggestSplit({
      suggestSplit: task.suggestSplit,
      docCount: task.patternDocCount,
      total_missed: task.patternTotalMissed,
    });
  const showSplitRecommendation =
    backendSuggestSplit &&
    !isSplitSegment &&
    !(isSplitParent && hasSegments);

  const canSplit = !isSplitSegment && (canSplitFromDuration || backendSuggestSplit);

  const startDate = task.startDate || null;
  const startTime = task.startTime || null;
  const endDate = task.endDate || null;
  const endTime = task.endTime || null;
  const shouldShowDueDate = !sameMoment(task.dueDate, task.endAt);

  let durationLabel = "";
  if (estimatedMinutes !== null) {
    const hours = estimatedMinutes / 60;
    durationLabel =
      hours >= 1
        ? `${hours.toFixed(hours % 1 === 0 ? 0 : 1)} h`
        : `${estimatedMinutes} min`;
  }

  const urgency = task.urgencyLevel;
  const importance = task.importanceLevel;
  const difficulty = task.difficultyLevel;

  const segmentIndex = task.segmentIndex;
  const segmentCount = task.segmentCount;
  const splitSegmentCount = task.splitSegmentCount;

  const breakMinutesValue =
    typeof task.breakMinutes === "number" ? task.breakMinutes : 0;
  const breakText = breakLabel(breakMinutesValue);

  const priorityScore =
    typeof task.priorityScore === "number" ? task.priorityScore : null;

  const finalized =
    task.finalized === true ||
    task.status === "completed" ||
    task.status === "missed" ||
    (task.completedCount || 0) > 0 ||
    (task.missedCount || 0) > 0;

  return (
    <div className="w-full bg-white rounded-2xl shadow-sm p-4 border border-emerald-50 hover:border-emerald-200 hover:shadow-md transition flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <button
        type="button"
        onClick={() => handleOpenTask(task)}
        className="text-left flex-1"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-900">
            {task.title || "Untitled task"}
          </span>

          {viewMode === "floating" && !due && (
            <span className="px-2 py-0.5 text-[10px] rounded-full bg-gray-100 text-gray-700">
              To-Do task
            </span>
          )}

          {isSplitSegment && (
            <span className="px-2 py-0.5 text-[10px] rounded-full bg-amber-50 text-amber-800 border border-amber-200">
              Segment {segmentIndex}/{segmentCount}
            </span>
          )}

          {isSplitParent && hasSegments && (
            <span className="px-2 py-0.5 text-[10px] rounded-full bg-blue-50 text-blue-800 border border-blue-200">
              Split parent
              {splitSegmentCount ? ` (${splitSegmentCount} segments)` : ""}
            </span>
          )}
        </div>

        <div className="mt-1 text-xs text-gray-500 flex flex-col gap-1">
          {viewMode === "scheduled" && (
            <>
              <div className="flex flex-wrap gap-2">
                <span>
                  Start:
                  <span className="font-medium text-gray-700">
                    {" "}
                    {startDate} {startTime}
                  </span>
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                <span>
                  End:
                  <span className="font-medium text-gray-700">
                    {" "}
                    {endDate} {endTime}
                  </span>
                </span>

                {shouldShowDueDate && (
                  <span>
                    Due:
                    <span className="font-medium text-gray-700">
                      {" "}
                      {dueText}
                    </span>
                  </span>
                )}
              </div>

              {durationLabel && (
                <div>
                  Duration:
                  <span className="font-medium text-gray-700">
                    {" "}
                    {durationLabel}
                  </span>
                </div>
              )}

              {!finalized && priorityScore !== null && priorityScore >= 0 && (
                <div>
                  Priority score:
                  <span className="font-semibold text-emerald-700">
                    {" "}
                    {priorityScore.toFixed(2)}
                  </span>
                </div>
              )}

              {breakText && (
                <div>
                  Recommended break:
                  <span className="font-medium text-gray-700">
                    {" "}
                    {breakText}
                  </span>
                </div>
              )}

              <div className="flex flex-wrap gap-2 mt-1">
                {urgency && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-[10px] text-emerald-800 border border-emerald-100">
                    {urgency === "urgent" ? "Urgent" : "Somewhat urgent"}
                  </span>
                )}

                {importance && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-[10px] text-emerald-800 border border-emerald-100">
                    {importance === "important"
                      ? "Important"
                      : "Somewhat important"}
                  </span>
                )}

                {difficulty && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-[10px] text-emerald-800 border border-emerald-100">
                    {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
                  </span>
                )}
              </div>
            </>
          )}

          {showSplitRecommendation && (
            <div className="mt-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 w-fit">
              This task has been missed at least 3 times across 2 or more
              records. Splitting it into smaller segments is recommended.
            </div>
          )}

          {viewMode === "floating" && (
            <div className="text-xs text-gray-500 mt-1">
              Flexible to-do task (no dates).
              {breakText && (
                <>
                  {" "}
                  Recommended break:
                  <span className="font-medium text-gray-700">
                    {" "}
                    {breakText}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </button>

      <div className="flex flex-wrap items-center gap-2 justify-start sm:justify-end">
        {canSplit && !finalized && (
          <button
            onClick={() => handleSplitTask(task.id)}
            className="px-3 py-1 text-xs rounded-full border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 transition"
          >
            Split
          </button>
        )}

        {!finalized && (
          <button
            onClick={() => handleEditTask(task.id)}
            className="px-3 py-1 text-xs rounded-full border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition"
          >
            Edit
          </button>
        )}

        <button
          onClick={() => handleDeleteTask(task)}
          className="px-3 py-1 text-xs rounded-full border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 transition"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export default React.memo(TaskCard);
