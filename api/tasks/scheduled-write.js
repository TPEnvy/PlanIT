import { admin, getAdminDb, verifyBearerToken } from "../_lib/firebaseAdmin.js";
import normalizeTitle from "../../src/utils/normalizeTitle.js";
import {
  buildLocalDateTime,
  buildScheduleValidationMessage,
  findNextAvailableWindow,
  toLocalDateInput,
  toLocalTimeInput,
  validateScheduledSlot,
} from "../../src/utils/taskHelpers.js";

const db = getAdminDb();

class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function parseBody(req) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }

  return req.body;
}

function serializeTaskSummary(task = {}) {
  return {
    id: task.id || null,
    title: task.title || "Untitled task",
    normalizedTitle:
      task.normalizedTitle || task.patternKey || normalizeTitle(task.title || ""),
    isSplitParent: Boolean(task.isSplitParent),
    isSplitSegment: Boolean(task.isSplitSegment),
  };
}

function serializeValidation(validation) {
  if (!validation) {
    return null;
  }

  return {
    reason: validation.reason || null,
    conflicts: (validation.conflicts || []).map(serializeTaskSummary),
    duplicates: (validation.duplicates || []).map(serializeTaskSummary),
    overloadedDays: (validation.overloadedDays || []).map((day) => ({
      date:
        day?.date instanceof Date ? day.date.toISOString() : String(day?.date || ""),
      existingMinutes: Number(day?.existingMinutes || 0),
      requestedMinutes: Number(day?.requestedMinutes || 0),
      totalMinutes: Number(day?.totalMinutes || 0),
    })),
  };
}

function serializeSuggestedWindow(window) {
  if (!window?.start || !window?.end) {
    return null;
  }

  return {
    start: window.start.toISOString(),
    end: window.end.toISOString(),
    startDate: toLocalDateInput(window.start),
    startTime: toLocalTimeInput(window.start),
    endDate: toLocalDateInput(window.end),
    endTime: toLocalTimeInput(window.end),
  };
}

function buildConflictPayload({
  tasks,
  candidateStart,
  candidateEnd,
  excludeTaskId = null,
  normalizedTaskTitle = "",
  candidateIsSplitTask = false,
}) {
  const validation = validateScheduledSlot(tasks, candidateStart, candidateEnd, {
    excludeTaskId,
    normalizedTitle: normalizedTaskTitle,
    candidateIsSplitTask,
  });

  const suggestedWindow = findNextAvailableWindow({
    tasks,
    desiredStart: candidateStart,
    durationMinutes: Math.max(
      1,
      Math.round((candidateEnd.getTime() - candidateStart.getTime()) / 60000)
    ),
    excludeTaskId,
    normalizedTitle: normalizedTaskTitle,
    candidateIsSplitTask,
  });

  return {
    code: "SCHEDULE_CONFLICT",
    message: buildScheduleValidationMessage(validation),
    validation: serializeValidation(validation),
    suggestedWindow: serializeSuggestedWindow(suggestedWindow),
    proposedStart: candidateStart.toISOString(),
    proposedEnd: candidateEnd.toISOString(),
  };
}

function buildCreatePayload({
  taskRef,
  uid,
  title,
  normalizedTaskTitle,
  effectiveStartDate,
  effectiveStartTime,
  effectiveEndDate,
  effectiveEndTime,
  candidateStart,
  candidateEnd,
  urgencyLevel,
  importanceLevel,
  difficultyLevel,
  estimatedMinutes,
}) {
  return {
    id: taskRef.id,
    userId: uid,
    title,
    normalizedTitle: normalizedTaskTitle,
    patternKey: normalizedTaskTitle,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    mode: "scheduled",
    startDate: effectiveStartDate,
    startTime: effectiveStartTime,
    endDate: effectiveEndDate,
    endTime: effectiveEndTime,
    startAt: admin.firestore.Timestamp.fromDate(candidateStart),
    endAt: admin.firestore.Timestamp.fromDate(candidateEnd),
    dueDate: admin.firestore.Timestamp.fromDate(candidateEnd),
    estimatedMinutes,
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
}

function buildUpdatePayload({
  uid,
  title,
  normalizedTaskTitle,
  patternKey,
  effectiveStartDate,
  effectiveStartTime,
  effectiveEndDate,
  effectiveEndTime,
  candidateStart,
  candidateEnd,
  urgencyLevel,
  importanceLevel,
  difficultyLevel,
  estimatedMinutes,
}) {
  return {
    title,
    normalizedTitle: normalizedTaskTitle,
    patternKey,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    userId: uid,
    mode: "scheduled",
    startDate: effectiveStartDate,
    startTime: effectiveStartTime,
    endDate: effectiveEndDate,
    endTime: effectiveEndTime,
    dueDate: admin.firestore.Timestamp.fromDate(candidateEnd),
    estimatedMinutes,
    urgencyLevel,
    importanceLevel,
    difficultyLevel,
    startAt: admin.firestore.Timestamp.fromDate(candidateStart),
    endAt: admin.firestore.Timestamp.fromDate(candidateEnd),
    notifiedLessThanDay: false,
    notifiedBeforeStart: false,
    notifiedBeforeEnd: false,
    notifiedByEmailStart: false,
    notifiedByEmailEnd: false,
    pushSent5m: false,
    pushSentBeforeEnd: false,
    pushSentStart: false,
    pushSentEnd: false,
  };
}

function validateRequestedSchedule({
  title,
  startDate,
  startTime,
  endDate,
  endTime,
  overrideWindow = null,
}) {
  const trimmedTitle = String(title || "").trim();
  if (!trimmedTitle) {
    throw new HttpError(400, "INVALID_INPUT", "Task title is required.");
  }

  let candidateStart = buildLocalDateTime(startDate, startTime);
  let candidateEnd = buildLocalDateTime(endDate, endTime);

  if (overrideWindow?.start && overrideWindow?.end) {
    candidateStart = new Date(overrideWindow.start);
    candidateEnd = new Date(overrideWindow.end);
  }

  if (!candidateStart || !candidateEnd) {
    throw new HttpError(
      400,
      "INVALID_INPUT",
      "Start and end date/time are required for scheduled tasks."
    );
  }

  if (
    Number.isNaN(candidateStart.getTime()) ||
    Number.isNaN(candidateEnd.getTime())
  ) {
    throw new HttpError(400, "INVALID_INPUT", "Invalid start or end date/time.");
  }

  if (candidateEnd <= candidateStart) {
    throw new HttpError(400, "INVALID_INPUT", "End must be after start.");
  }

  if (candidateStart < new Date()) {
    throw new HttpError(
      400,
      "INVALID_INPUT",
      "Start time must be in the future."
    );
  }

  return {
    title: trimmedTitle,
    candidateStart,
    candidateEnd,
    effectiveStartDate: toLocalDateInput(candidateStart),
    effectiveStartTime: toLocalTimeInput(candidateStart),
    effectiveEndDate: toLocalDateInput(candidateEnd),
    effectiveEndTime: toLocalTimeInput(candidateEnd),
    estimatedMinutes: Math.round(
      (candidateEnd.getTime() - candidateStart.getTime()) / 60000
    ),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res
      .status(405)
      .json({ code: "METHOD_NOT_ALLOWED", message: "Use POST instead." });
  }

  try {
    const decodedToken = await verifyBearerToken(req);
    const body = parseBody(req);
    const {
      taskId = null,
      title,
      patternKey = null,
      startDate,
      startTime,
      endDate,
      endTime,
      urgencyLevel = "urgent",
      importanceLevel = "important",
      difficultyLevel = "easy",
      conflictResolution = "default",
      overrideWindow = null,
    } = body;

    if (!["default", "proceed", "suggested"].includes(conflictResolution)) {
      throw new HttpError(
        400,
        "INVALID_INPUT",
        "Unsupported conflict resolution option."
      );
    }

    const schedule = validateRequestedSchedule({
      title,
      startDate,
      startTime,
      endDate,
      endTime,
      overrideWindow: conflictResolution === "suggested" ? overrideWindow : null,
    });

    const tasksRef = db.collection(`users/${decodedToken.uid}/tasks`);
    const targetRef = taskId ? tasksRef.doc(taskId) : tasksRef.doc();

    const result = await db.runTransaction(async (transaction) => {
      const tasksSnap = await transaction.get(tasksRef);
      const existingTasks = tasksSnap.docs.map((taskDoc) => ({
        id: taskDoc.id,
        ...taskDoc.data(),
      }));

      const existingTask = taskId
        ? existingTasks.find((task) => task.id === taskId) || null
        : null;

      if (taskId && !existingTask) {
        throw new HttpError(404, "NOT_FOUND", "Task not found.");
      }

      if (
        existingTask &&
        (existingTask.status === "completed" || existingTask.status === "missed")
      ) {
        throw new HttpError(
          400,
          "TASK_LOCKED",
          "Completed or missed tasks cannot be edited."
        );
      }

      const normalizedTaskTitle = normalizeTitle(schedule.title);
      const candidateIsSplitTask = Boolean(existingTask?.isSplitSegment);
      const validation = validateScheduledSlot(
        existingTasks,
        schedule.candidateStart,
        schedule.candidateEnd,
        {
          excludeTaskId: taskId,
          normalizedTitle: normalizedTaskTitle,
          candidateIsSplitTask,
        }
      );

      const isReviewableConflict =
        validation.reason === "overlap" || validation.reason === "duplicate";

      if (!validation.isValid && isReviewableConflict && conflictResolution !== "proceed") {
        throw new HttpError(
          409,
          "SCHEDULE_CONFLICT",
          buildScheduleValidationMessage(validation),
          buildConflictPayload({
            tasks: existingTasks,
            candidateStart: schedule.candidateStart,
            candidateEnd: schedule.candidateEnd,
            excludeTaskId: taskId,
            normalizedTaskTitle,
            candidateIsSplitTask,
          })
        );
      }

      if (!validation.isValid && !isReviewableConflict) {
        throw new HttpError(
          400,
          "INVALID_SCHEDULE",
          buildScheduleValidationMessage(validation),
          {
            validation: serializeValidation(validation),
          }
        );
      }

      if (existingTask) {
        transaction.update(
          targetRef,
          buildUpdatePayload({
            uid: decodedToken.uid,
            title: schedule.title,
            normalizedTaskTitle,
            patternKey:
              patternKey || existingTask.patternKey || normalizedTaskTitle,
            effectiveStartDate: schedule.effectiveStartDate,
            effectiveStartTime: schedule.effectiveStartTime,
            effectiveEndDate: schedule.effectiveEndDate,
            effectiveEndTime: schedule.effectiveEndTime,
            candidateStart: schedule.candidateStart,
            candidateEnd: schedule.candidateEnd,
            urgencyLevel,
            importanceLevel,
            difficultyLevel,
            estimatedMinutes: schedule.estimatedMinutes,
          })
        );
      } else {
        transaction.set(
          targetRef,
          buildCreatePayload({
            taskRef: targetRef,
            uid: decodedToken.uid,
            title: schedule.title,
            normalizedTaskTitle,
            effectiveStartDate: schedule.effectiveStartDate,
            effectiveStartTime: schedule.effectiveStartTime,
            effectiveEndDate: schedule.effectiveEndDate,
            effectiveEndTime: schedule.effectiveEndTime,
            candidateStart: schedule.candidateStart,
            candidateEnd: schedule.candidateEnd,
            urgencyLevel,
            importanceLevel,
            difficultyLevel,
            estimatedMinutes: schedule.estimatedMinutes,
          })
        );
      }

      return {
        taskId: targetRef.id,
        title: schedule.title,
        normalizedTitle: normalizedTaskTitle,
        startDate: schedule.effectiveStartDate,
        startTime: schedule.effectiveStartTime,
        endDate: schedule.effectiveEndDate,
        endTime: schedule.effectiveEndTime,
        startAt: schedule.candidateStart.toISOString(),
        endAt: schedule.candidateEnd.toISOString(),
        conflictResolution,
      };
    });

    return res.status(200).json({
      code: taskId ? "TASK_UPDATED" : "TASK_CREATED",
      message: taskId ? "Task updated." : "Task created.",
      task: result,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return res.status(error.status).json({
        code: error.code,
        message: error.message,
        ...error.extra,
      });
    }

    console.error("scheduled-write error:", error);
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Failed to save the scheduled task.",
    });
  }
}
