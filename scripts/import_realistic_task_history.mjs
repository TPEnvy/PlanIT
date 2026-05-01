import "dotenv/config";

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { admin, getAdminDb } from "../api/_lib/firebaseAdmin.js";
import { buildTaskWindowSummary } from "./_task_window_summary.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const FIRESTORE_ID_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const DEFAULT_TZ_OFFSET = "+08:00";
const DEFAULT_TIME_ZONE = "Asia/Manila";
const MAX_BATCH_WRITES = 450;
const RECENT_OUTCOME_WINDOW = 4;
const RECENT_COMPLETION_RATE_TO_UNLOCK = 0.75;
const MIN_MISSES_TO_SUGGEST_SPLIT = 3;
const MIN_MISSES_TO_PREVENT_NEW_TASKS = 4;
const ML_API_BASE_URL = (process.env.ML_API_URL || process.env.VITE_ML_API_URL || "")
  .trim()
  .replace(/\/$/, "");
const LOCAL_ML_DIR = path.join(projectRoot, "ml", "ml_local");
const LOCAL_ML_PYTHON = path.join(
  LOCAL_ML_DIR,
  "venv",
  "Scripts",
  "python.exe"
);
const RECOVERED_PREVENT_NEW_TASK_STORIES = {
  oTf9ZUVQ6XQx0plx6X3G7r5YImS2: ["crm data entry cleanup"],
};
const DEMO_BLOCK_SPLIT_COVERAGE = {
  "4Iev3QkxQoZrpfjaYGnwxKHWnXv1": {
    splitTitle: "prepare breading station",
    blockTitle: "change sanitizer buckets",
    usesExistingSplitPlan: true,
  },
  SehTYcFFmbeyz84vT7Ct1DmqB6J3: {
    splitTitle: "group feasibility study work",
    blockTitle: "quantitative methods problem set",
  },
  NHqgUHlBlwgXML8YlQadtQvO4xl1: {
    splitTitle: "campaign performance report",
    blockTitle: "coordinate marketing collaterals",
  },
  "6nec8OkuBQTW0vs7b6aaVlEM8HB3": {
    splitTitle: "parent progress notes",
    blockTitle: "sanitize learning materials",
  },
  oTf9ZUVQ6XQx0plx6X3G7r5YImS2: {
    splitTitle: "meeting brief preparation",
    blockTitle: "crm data entry cleanup",
  },
  "9vhEI3OTEibeEM1AZxm2fhVA1zr1": {
    splitTitle: "email newsletter layout",
    blockTitle: "brand asset review",
  },
  SK0v6biv6sVxWFmYYTteA5Snq583: {
    splitTitle: "software update deployment",
    blockTitle: "workstation setup requests",
  },
  tlzjTO1BpLWYlDk4khOYV8ZYDwW2: {
    splitTitle: "complaint follow-up calls",
    blockTitle: "crm case notes and endorsements",
  },
  aE0FcUx9B9Pt0Gt8wjCH9BPf0W02: {
    splitTitle: "morning cooking prep",
    blockTitle: "sales and expense log",
  },
  pZWUaFWrxnbHox5USIQOyuUyMAH3: {
    splitTitle: "laundry and folding",
    blockTitle: "grocery and meal planning",
  },
  b7eoxXTj45baMZjuwHtjUuO3k3o1: {
    splitTitle: "video editing client work",
    blockTitle: "project management sideline",
  },
};

function printUsage() {
  console.log(`
Usage:
  npm run import:history -- --input data/tasks.json
  npm run import:history -- --input data/tasks.json --write-firestore

Input:
  A plain JSON array of tasks, or { "userId": "...", "tasks": [...] }.

What it writes:
  users/{uid}/tasks/{taskId}
  users/{uid}/notifications/{notificationId}
  users/{uid}/patterns/{normalizedTitle}

Notes:
  No sourceTag, importedAt, or importer-only Firestore fields are written.
  On --write-firestore, patterns are recomputed from Firestore history by the
  same local/ML logic used by the app.
  Without --write-firestore, it only writes a preview file.
`);
}

function parseArgs(argv) {
  const args = {
    input: null,
    previewOut: null,
    timeZone: DEFAULT_TIME_ZONE,
    tzOffset: DEFAULT_TZ_OFFSET,
    userId: null,
    writeFirestore: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length || argv[index].startsWith("--")) {
        throw new Error(`${arg} requires a value.`);
      }
      return argv[index];
    };

    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--input") args.input = next();
    else if (arg === "--preview-out") args.previewOut = next();
    else if (arg === "--time-zone") args.timeZone = next();
    else if (arg === "--tz-offset") args.tzOffset = next();
    else if (arg === "--user") args.userId = next();
    else if (arg === "--write-firestore") args.writeFirestore = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  return args;
}

function normalizeTitle(title) {
  return String(title || "")
    .trim()
    .replace(/[\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function createFirestoreLikeId(seed) {
  const bytes = createHash("sha256").update(seed).digest();
  let output = "";

  for (let index = 0; output.length < 20; index += 1) {
    output += FIRESTORE_ID_CHARS[bytes[index % bytes.length] % FIRESTORE_ID_CHARS.length];
  }

  return output;
}

function safeDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === "function") return value.toDate();

  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildDateTime(date, time, tzOffset) {
  if (!date || !time) return null;
  const normalizedTime = /^\d{2}:\d{2}$/.test(String(time))
    ? `${time}:00`
    : String(time);
  return safeDate(`${date}T${normalizedTime}${tzOffset}`);
}

function addMinutes(date, minutes) {
  return date ? new Date(date.getTime() + minutes * 60000) : null;
}

function addSeconds(date, seconds) {
  return date ? new Date(date.getTime() + seconds * 1000) : null;
}

function setTimeOnSameLocalDate(date, time, options) {
  if (!date || !time) return null;
  return buildDateTime(localDate(date, options.timeZone), time, options.tzOffset);
}

function diffMinutes(start, end) {
  if (!start || !end || end <= start) return null;
  return Number(((end.getTime() - start.getTime()) / 60000).toFixed(4));
}

function toNumber(value, fallback = 0) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toOptionalNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function dateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function localDate(date, timeZone) {
  if (!date) return null;
  const parts = dateParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localTime(date, timeZone) {
  if (!date) return null;
  const parts = dateParts(date, timeZone);
  return `${parts.hour}:${parts.minute}`;
}

function resolveStatus(raw, completedCount, missedCount) {
  const status = String(raw.status || "").trim().toLowerCase();
  if (["pending", "completed", "missed", "in_progress"].includes(status)) {
    return status;
  }
  if (completedCount > 0) return "completed";
  if (missedCount > 0) return "missed";
  return "pending";
}

function omitUndefined(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined)
  );
}

function normalizeTask(raw, index, options) {
  const title = String(raw.title || "").trim();
  if (!title) throw new Error(`Task at index ${index} is missing title.`);

  const userId = String(options.userId || raw.userId || "").trim();
  if (!userId) {
    throw new Error(`Task "${title}" needs userId, or pass --user <uid>.`);
  }

  const normalizedTitle = normalizeTitle(raw.normalizedTitle || raw.patternKey || title);
  const startAt =
    safeDate(raw.startAt) ||
    safeDate(raw.startAtIso) ||
    buildDateTime(raw.startDate, raw.startTime, options.tzOffset);
  const endAt =
    safeDate(raw.endAt) ||
    safeDate(raw.endAtIso) ||
    buildDateTime(raw.endDate, raw.endTime, options.tzOffset);
  const dueDate = safeDate(raw.dueDate) || safeDate(raw.dueDateIso) || endAt;
  const estimatedMinutes =
    toOptionalNumber(raw.estimatedMinutes) ?? diffMinutes(startAt, endAt);
  const completedCount = toNumber(raw.completedCount, raw.status === "completed" ? 1 : 0);
  const missedCount = toNumber(raw.missedCount, raw.status === "missed" ? 1 : 0);
  const status = resolveStatus(raw, completedCount, missedCount);
  const finalized = toBoolean(
    raw.finalized,
    status === "completed" || status === "missed"
  );
  const totalActualMinutes = toNumber(raw.totalActualMinutes, 0);
  const id =
    String(raw.id || "").trim() ||
    createFirestoreLikeId(`${userId}|${normalizedTitle}|${startAt?.toISOString() || index}`);

  let completedAt =
    safeDate(raw.completedAt) || safeDate(raw.lastCompletedAt) || null;
  let missedAt = safeDate(raw.missedAt) || safeDate(raw.lastMissedAt) || null;

  if (status === "completed" && !completedAt) {
    completedAt =
      startAt && totalActualMinutes > 0
        ? addMinutes(startAt, totalActualMinutes)
        : safeDate(raw.updatedAt) || endAt || dueDate;
  }

  if (status === "missed" && !missedAt) {
    missedAt = safeDate(raw.updatedAt) || endAt || dueDate;
  }

  const resolvedAt = status === "completed" ? completedAt : missedAt;
  const createdAt =
    safeDate(raw.createdAt) ||
    (startAt ? addMinutes(startAt, -90 + index) : new Date());
  const updatedAt = safeDate(raw.updatedAt) || resolvedAt || dueDate || createdAt;
  const mode = String(raw.mode || (startAt ? "scheduled" : "floating")).toLowerCase();

  return omitUndefined({
    id,
    userId,
    title,
    normalizedTitle,
    patternKey: normalizedTitle,
    mode,
    startAt,
    endAt,
    dueDate: dueDate || null,
    startDate: raw.startDate || localDate(startAt, options.timeZone),
    startTime: raw.startTime || localTime(startAt, options.timeZone),
    endDate: raw.endDate || localDate(endAt, options.timeZone),
    endTime: raw.endTime || localTime(endAt, options.timeZone),
    createdAt,
    updatedAt,
    estimatedMinutes,
    breakMinutes: raw.breakMinutes ?? null,
    urgencyLevel: raw.urgencyLevel ?? null,
    importanceLevel: raw.importanceLevel ?? null,
    difficultyLevel: raw.difficultyLevel ?? null,
    completedCount,
    missedCount,
    totalCompletions: toNumber(raw.totalCompletions, completedCount),
    totalActualMinutes,
    lastActualMinutes:
      raw.lastActualMinutes ??
      (status === "completed" && totalActualMinutes > 0 ? totalActualMinutes : null),
    lastCompletedAt: status === "completed" ? completedAt : safeDate(raw.lastCompletedAt),
    completedAt: status === "completed" ? completedAt : safeDate(raw.completedAt),
    lastMissedAt: status === "missed" ? missedAt : safeDate(raw.lastMissedAt),
    missedAt: status === "missed" ? missedAt : safeDate(raw.missedAt),
    lastOutcome:
      raw.lastOutcome || (status === "completed" || status === "missed" ? status : null),
    status,
    finalized,
    adaptiveBoost: toNumber(raw.adaptiveBoost, 0),
    mlRiskScore: toNumber(raw.mlRiskScore, 0),
    suggestSplit: toBoolean(raw.suggestSplit, false),
    preventNewTasks: toBoolean(raw.preventNewTasks, false),
    recoveryUnlocked: toBoolean(raw.recoveryUnlocked, false),
    isSplitParent: toBoolean(raw.isSplitParent, false),
    isSplitSegment: toBoolean(raw.isSplitSegment, false),
    splitSegmentCount: raw.splitSegmentCount ?? null,
    parentTaskId: raw.parentTaskId ?? null,
    pendingTaskCount: raw.pendingTaskCount ?? null,
  });
}

function buildSplitSegment(parentTask, index, segmentCount, segment, options) {
  const startAt = setTimeOnSameLocalDate(
    parentTask.startAt || parentTask.dueDate || parentTask.createdAt,
    segment.startTime,
    options
  );
  const endAt = startAt ? addMinutes(startAt, segment.minutes) : null;
  const completedAt = endAt ? addMinutes(endAt, segment.completedOffsetMinutes || 0) : null;
  const segmentTitle = `${parentTask.title} (${segment.label})`;
  const segmentId = createFirestoreLikeId(
    `${parentTask.userId}|${parentTask.id}|split-segment|${index + 1}`
  );

  return {
    id: segmentId,
    userId: parentTask.userId,
    title: segmentTitle,
    normalizedTitle: parentTask.normalizedTitle,
    patternKey: parentTask.normalizedTitle,
    mode: parentTask.mode || "scheduled",
    startAt,
    endAt,
    dueDate: endAt,
    startDate: localDate(startAt, options.timeZone),
    startTime: localTime(startAt, options.timeZone),
    endDate: localDate(endAt, options.timeZone),
    endTime: localTime(endAt, options.timeZone),
    createdAt: addMinutes(parentTask.updatedAt || parentTask.createdAt, 6 + index) || new Date(),
    updatedAt: completedAt || endAt || parentTask.updatedAt,
    estimatedMinutes: segment.minutes,
    breakMinutes: segment.breakMinutes ?? 5,
    urgencyLevel: parentTask.urgencyLevel,
    importanceLevel: parentTask.importanceLevel,
    difficultyLevel:
      index === 0 ? "easy" : index === segmentCount - 1 ? "medium" : parentTask.difficultyLevel,
    completedCount: 1,
    missedCount: 0,
    totalCompletions: 1,
    totalActualMinutes: segment.actualMinutes ?? segment.minutes,
    lastActualMinutes: segment.actualMinutes ?? segment.minutes,
    lastCompletedAt: completedAt,
    completedAt,
    lastMissedAt: null,
    missedAt: null,
    lastOutcome: "completed",
    status: "completed",
    finalized: true,
    adaptiveBoost: 0,
    mlRiskScore: 0,
    suggestSplit: false,
    preventNewTasks: false,
    recoveryUnlocked: false,
    isSplitParent: false,
    isSplitSegment: true,
    parentTaskId: parentTask.id,
    segmentIndex: index + 1,
    segmentCount,
    sourceWasSuggestion: true,
    splitSegmentCount: null,
  };
}

function toTitleCase(value) {
  return String(value || "")
    .split(" ")
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function makeSplitTaskEligible(task, options) {
  if (!task || Number(task.estimatedMinutes || 0) >= 180) return;

  const startAt = safeDate(task.startAt) || safeDate(task.dueDate);
  const endAt = addMinutes(startAt, 180);

  task.originalEstimatedMinutes = task.estimatedMinutes ?? null;
  task.estimatedMinutes = 180;
  task.endAt = endAt || task.endAt;
  task.dueDate = endAt || task.dueDate;

  if (endAt) {
    task.endDate = localDate(endAt, options.timeZone);
    task.endTime = localTime(endAt, options.timeZone);
  }
}

function buildDemoCoverageCandidateTask({
  userId,
  normalizedTitle,
  title,
  date,
  startTime,
  estimatedMinutes,
  options,
  kind,
}) {
  const startAt = buildDateTime(date, startTime, options.tzOffset);
  const endAt = addMinutes(startAt, estimatedMinutes);
  const createdAt = buildDateTime("2026-04-29", kind === "split" ? "08:00" : "08:05", options.tzOffset);
  const id = createFirestoreLikeId(
    `${userId}|${normalizedTitle}|demo-${kind}-candidate|${date}|${startTime}`
  );

  return {
    id,
    userId,
    title,
    normalizedTitle,
    patternKey: normalizedTitle,
    mode: "scheduled",
    startAt,
    endAt,
    dueDate: endAt,
    startDate: localDate(startAt, options.timeZone),
    startTime: localTime(startAt, options.timeZone),
    endDate: localDate(endAt, options.timeZone),
    endTime: localTime(endAt, options.timeZone),
    createdAt,
    updatedAt: createdAt,
    estimatedMinutes,
    breakMinutes: kind === "split" ? 30 : 0,
    urgencyLevel: kind === "split" ? "urgent" : "somewhat_urgent",
    importanceLevel: "important",
    difficultyLevel: kind === "split" ? "hard" : "easy",
    completedCount: 0,
    missedCount: 0,
    totalCompletions: 0,
    totalActualMinutes: 0,
    lastActualMinutes: null,
    lastCompletedAt: null,
    completedAt: null,
    lastMissedAt: null,
    missedAt: null,
    lastOutcome: null,
    status: "pending",
    finalized: false,
    adaptiveBoost: 0,
    mlRiskScore: 0,
    suggestSplit: kind === "split",
    preventNewTasks: false,
    recoveryUnlocked: false,
    isSplitParent: false,
    isSplitSegment: false,
    splitSegmentCount: null,
    parentTaskId: null,
    pendingTaskCount: null,
    demoCoverageCandidate: true,
    demoCoverageKind: kind,
  };
}

function buildDemoCoverageMissedTask({
  userId,
  normalizedTitle,
  title,
  date,
  startTime,
  estimatedMinutes,
  options,
  kind,
  index,
}) {
  const startAt = buildDateTime(date, startTime, options.tzOffset);
  const endAt = addMinutes(startAt, estimatedMinutes);
  const createdAt = addMinutes(startAt, -45);
  const id = createFirestoreLikeId(
    `${userId}|${normalizedTitle}|demo-${kind}-miss|${index}|${date}|${startTime}`
  );

  return {
    id,
    userId,
    title,
    normalizedTitle,
    patternKey: normalizedTitle,
    mode: "scheduled",
    startAt,
    endAt,
    dueDate: endAt,
    startDate: localDate(startAt, options.timeZone),
    startTime: localTime(startAt, options.timeZone),
    endDate: localDate(endAt, options.timeZone),
    endTime: localTime(endAt, options.timeZone),
    createdAt,
    updatedAt: endAt,
    estimatedMinutes,
    breakMinutes: 0,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: kind === "split" ? "hard" : "medium",
    completedCount: 0,
    missedCount: 1,
    totalCompletions: 0,
    totalActualMinutes: 0,
    lastActualMinutes: null,
    lastCompletedAt: null,
    completedAt: null,
    lastMissedAt: endAt,
    missedAt: endAt,
    lastOutcome: "missed",
    status: "missed",
    finalized: true,
    adaptiveBoost: 0,
    mlRiskScore: 0,
    suggestSplit: false,
    preventNewTasks: false,
    recoveryUnlocked: false,
    isSplitParent: false,
    isSplitSegment: false,
    splitSegmentCount: null,
    parentTaskId: null,
    demoCoverageHistory: true,
    demoCoverageKind: kind,
  };
}

function buildDemoCoverageCompletedTask({
  userId,
  normalizedTitle,
  title,
  date,
  startTime,
  estimatedMinutes,
  actualMinutes,
  options,
  kind,
  index,
}) {
  const startAt = buildDateTime(date, startTime, options.tzOffset);
  const endAt = addMinutes(startAt, estimatedMinutes);
  const completedAt = addMinutes(startAt, actualMinutes);
  const createdAt = addMinutes(startAt, -45);
  const id = createFirestoreLikeId(
    `${userId}|${normalizedTitle}|demo-${kind}-recovery|${index}|${date}|${startTime}`
  );

  return {
    id,
    userId,
    title,
    normalizedTitle,
    patternKey: normalizedTitle,
    mode: "scheduled",
    startAt,
    endAt,
    dueDate: endAt,
    startDate: localDate(startAt, options.timeZone),
    startTime: localTime(startAt, options.timeZone),
    endDate: localDate(endAt, options.timeZone),
    endTime: localTime(endAt, options.timeZone),
    createdAt,
    updatedAt: completedAt,
    estimatedMinutes,
    breakMinutes: 0,
    urgencyLevel: "somewhat_urgent",
    importanceLevel: "important",
    difficultyLevel: kind === "split" ? "hard" : "medium",
    completedCount: 1,
    missedCount: 0,
    totalCompletions: 1,
    totalActualMinutes: actualMinutes,
    lastActualMinutes: actualMinutes,
    lastCompletedAt: completedAt,
    completedAt,
    lastMissedAt: null,
    missedAt: null,
    lastOutcome: "completed",
    status: "completed",
    finalized: true,
    adaptiveBoost: 0,
    mlRiskScore: 0,
    suggestSplit: false,
    preventNewTasks: false,
    recoveryUnlocked: true,
    isSplitParent: false,
    isSplitSegment: false,
    splitSegmentCount: null,
    parentTaskId: null,
    demoCoverageHistory: true,
    demoCoverageRecovery: true,
    demoCoverageKind: kind,
  };
}

function addRealisticSplitSegments(tasks, options) {
  const splitPlans = [
    {
      normalizedTitle: "prepare breading station",
      parentDate: "2026-04-21",
      splitAtOffsetMinutes: 12,
      segments: [
        {
          label: "Set up station",
          startTime: "11:20",
          minutes: 15,
          actualMinutes: 14,
        },
        {
          label: "Portion chicken",
          startTime: "11:40",
          minutes: 15,
          actualMinutes: 16,
        },
        {
          label: "Final coating",
          startTime: "12:00",
          minutes: 15,
          actualMinutes: 15,
        },
      ],
    },
    {
      normalizedTitle: "change sanitizer buckets",
      parentDate: "2026-04-20",
      splitAtOffsetMinutes: 8,
      segments: [
        {
          label: "Drain and rinse",
          startTime: "14:15",
          minutes: 5,
          actualMinutes: 5,
          breakMinutes: 0,
        },
        {
          label: "Mix and replace",
          startTime: "14:25",
          minutes: 10,
          actualMinutes: 9,
          breakMinutes: 0,
        },
      ],
    },
  ];
  const coverageUserId = options.userId || tasks[0]?.userId;
  const coverage = DEMO_BLOCK_SPLIT_COVERAGE[coverageUserId];

  if (coverage?.splitTitle && !coverage.usesExistingSplitPlan) {
    splitPlans.push({
      normalizedTitle: coverage.splitTitle,
      splitAtOffsetMinutes: 6,
      segments: [
        {
          label: "First half",
          minutes: 20,
          actualMinutes: 19,
        },
        {
          label: "Finish and check",
          minutes: 20,
          actualMinutes: 21,
        },
      ],
    });
  }

  const nextTasks = [...tasks];

  splitPlans.forEach((plan) => {
    const parent = nextTasks.find(
      (task) =>
        task.normalizedTitle === plan.normalizedTitle &&
        (!plan.parentDate ||
          localDate(task.startAt || task.dueDate, options.timeZone) === plan.parentDate)
    );

    if (!parent || parent.isSplitSegment || parent.isSplitParent) return;

    const splitAt =
      addMinutes(getResolvedAt(parent) || parent.updatedAt || parent.endAt, plan.splitAtOffsetMinutes) ||
      parent.updatedAt;

    makeSplitTaskEligible(parent, options);
    parent.isSplitParent = true;
    parent.splitSegmentCount = plan.segments.length;
    parent.splitAt = splitAt;
    parent.updatedAt = splitAt;
    parent.suggestSplit = true;

    plan.segments.forEach((segment, index) => {
      const segmentTask = buildSplitSegment(
        parent,
        index,
        plan.segments.length,
        segment,
        options
      );
      nextTasks.push(segmentTask);
    });
  });

  return nextTasks;
}

function addDemoCoverageCandidateTasks(tasks, options) {
  const userId = options.userId || tasks[0]?.userId;
  const coverage = DEMO_BLOCK_SPLIT_COVERAGE[userId];
  if (!coverage) return tasks;

  const nextTasks = [...tasks];
  const existingIds = new Set(nextTasks.map((task) => task.id));
  const titleFor = (normalizedTitle) =>
    nextTasks.find((task) => task.normalizedTitle === normalizedTitle)?.title ||
    toTitleCase(normalizedTitle);

  if (coverage.splitTitle) {
    [
      ["2026-04-28", "08:00"],
      ["2026-04-28", "13:00"],
      ["2026-04-29", "08:00"],
    ].forEach(([date, startTime], index) => {
      const missedTask = buildDemoCoverageMissedTask({
        userId,
        normalizedTitle: coverage.splitTitle,
        title: titleFor(coverage.splitTitle),
        date,
        startTime,
        estimatedMinutes: 180,
        options,
        kind: "split",
        index: index + 1,
      });

      if (!existingIds.has(missedTask.id)) {
        nextTasks.push(missedTask);
        existingIds.add(missedTask.id);
      }
    });

    [
      ["2026-04-29", "15:00"],
      ["2026-04-29", "16:00"],
      ["2026-04-29", "17:00"],
      ["2026-04-30", "06:30"],
    ].forEach(([date, startTime], index) => {
      const completedTask = buildDemoCoverageCompletedTask({
        userId,
        normalizedTitle: coverage.splitTitle,
        title: titleFor(coverage.splitTitle),
        date,
        startTime,
        estimatedMinutes: 45,
        actualMinutes: 40,
        options,
        kind: "split",
        index: index + 1,
      });

      if (!existingIds.has(completedTask.id)) {
        nextTasks.push(completedTask);
        existingIds.add(completedTask.id);
      }
    });

    const splitCandidate = buildDemoCoverageCandidateTask({
      userId,
      normalizedTitle: coverage.splitTitle,
      title: titleFor(coverage.splitTitle),
      date: "2026-04-30",
      startTime: "09:00",
      estimatedMinutes: 180,
      options,
      kind: "split",
    });

    if (!existingIds.has(splitCandidate.id)) {
      nextTasks.push(splitCandidate);
      existingIds.add(splitCandidate.id);
    }
  }

  if (coverage.blockTitle) {
    [
      ["2026-04-28", "16:00"],
      ["2026-04-28", "17:00"],
      ["2026-04-29", "10:00"],
      ["2026-04-29", "11:00"],
    ].forEach(([date, startTime], index) => {
      const missedTask = buildDemoCoverageMissedTask({
        userId,
        normalizedTitle: coverage.blockTitle,
        title: titleFor(coverage.blockTitle),
        date,
        startTime,
        estimatedMinutes: 30,
        options,
        kind: "block",
        index: index + 1,
      });

      if (!existingIds.has(missedTask.id)) {
        nextTasks.push(missedTask);
        existingIds.add(missedTask.id);
      }
    });

    [
      ["2026-04-29", "15:30"],
      ["2026-04-29", "16:30"],
      ["2026-04-30", "07:30"],
      ["2026-04-30", "08:30"],
    ].forEach(([date, startTime], index) => {
      const completedTask = buildDemoCoverageCompletedTask({
        userId,
        normalizedTitle: coverage.blockTitle,
        title: titleFor(coverage.blockTitle),
        date,
        startTime,
        estimatedMinutes: 30,
        actualMinutes: 25,
        options,
        kind: "block",
        index: index + 1,
      });

      if (!existingIds.has(completedTask.id)) {
        nextTasks.push(completedTask);
        existingIds.add(completedTask.id);
      }
    });

    const blockCandidate = buildDemoCoverageCandidateTask({
      userId,
      normalizedTitle: coverage.blockTitle,
      title: titleFor(coverage.blockTitle),
      date: "2026-04-30",
      startTime: "14:00",
      estimatedMinutes: 30,
      options,
      kind: "block",
    });

    if (!existingIds.has(blockCandidate.id)) {
      nextTasks.push(blockCandidate);
      existingIds.add(blockCandidate.id);
    }
  }

  return nextTasks;
}

function getResolvedAt(task) {
  return task.completedAt || task.lastCompletedAt || task.missedAt || task.lastMissedAt || task.updatedAt;
}

function buildNotifications(tasks) {
  return tasks.flatMap((task) => {
    const createdAt = safeDate(task.createdAt) || new Date();
    const notifications = [];
    const createdId = createFirestoreLikeId(`${task.userId}|${task.id}|task_created`);

    notifications.push({
      documentId: createdId,
      id: createdId,
      title: "New task created",
      body: `"${task.title}" was added to your tasks.`,
      type: "task_created",
      taskId: task.id,
      createdAt: addSeconds(createdAt, 2) || createdAt,
      read: true,
      channel: "all",
    });

    if (task.status === "completed") {
      notifications.push({
        documentId: `task_completed_${task.id}`,
        title: "Task completed",
        body: `${task.title} was marked as completed.`,
        type: "task_completed",
        taskId: task.id,
        createdAt: getResolvedAt(task) || task.updatedAt || createdAt,
        read: false,
      });
    }

    if (task.status === "missed") {
      notifications.push({
        documentId: `task_missed_${task.id}`,
        title: "Task missed",
        body: `${task.title} was marked as missed.`,
        type: "task_missed",
        taskId: task.id,
        createdAt: getResolvedAt(task) || task.updatedAt || createdAt,
        read: false,
      });
    }

    return notifications;
  });
}

function toTimestampMillis(value) {
  const date = safeDate(value);
  return date ? date.getTime() : null;
}

function inferAutoTrackedActualMinutes(task = {}, resolvedAt = new Date()) {
  if (!task || (task.mode || "scheduled") === "floating") {
    return null;
  }

  const start = safeDate(task.startAt);
  const end = safeDate(resolvedAt);

  if (!start || !end || end <= start) {
    return null;
  }

  return diffMinutes(start, end);
}

function buildHistoricalItem(data) {
  const completedCount = Number(data.completedCount || 0);
  const isCompleted =
    String(data.status || "").toLowerCase() === "completed" || completedCount > 0;
  const estimatedMinutes =
    data.estimatedMinutes == null ? 0 : Number(data.estimatedMinutes || 0);
  const storedActualMinutes = Number(data.totalActualMinutes || 0);
  const completedAt = data.lastCompletedAt || data.completedAt || null;
  const inferredActualMinutes = inferAutoTrackedActualMinutes(data, completedAt);
  const actualMinutes =
    inferredActualMinutes != null
      ? Number(inferredActualMinutes)
      : storedActualMinutes > 0
        ? storedActualMinutes
        : 0;
  const shouldTrackOverrun =
    isCompleted &&
    (data.mode || "scheduled") !== "floating" &&
    estimatedMinutes > 0 &&
    actualMinutes > 0;

  return {
    completedCount,
    missedCount: Number(data.missedCount || 0),
    estimatedMinutes: shouldTrackOverrun ? estimatedMinutes : 0,
    actualMinutes: shouldTrackOverrun ? actualMinutes : 0,
    isSplitParent: Boolean(data.isSplitParent),
    isSplitSegment: Boolean(data.isSplitSegment),
    status: String(data.status || "").toLowerCase(),
  };
}

async function fetchMlPatternPrediction(userId, title, historical) {
  if (!ML_API_BASE_URL) {
    return fetchLocalMlPatternPrediction(title, historical);
  }

  try {
    const response = await fetch(`${ML_API_BASE_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        title,
        historical,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.warn(
        `ML API request failed (${response.status}) for "${title}". Falling back to local pattern statistics.`,
        errorText || response.statusText
      );
      return fetchLocalMlPatternPrediction(title, historical);
    }

    return response.json();
  } catch (error) {
    console.warn(
      `ML API is unreachable for "${title}". Falling back to local Python ML scoring.`,
      error
    );
    return fetchLocalMlPatternPrediction(title, historical);
  }
}

function fetchLocalMlPatternPrediction(title, historical) {
  try {
    const python = existsSync(LOCAL_ML_PYTHON) ? LOCAL_ML_PYTHON : "python";
    const script = [
      "import json, sys",
      `sys.path.insert(0, ${JSON.stringify(LOCAL_ML_DIR)})`,
      "from ml_service import evaluate_history",
      "items = json.load(sys.stdin)",
      "print(json.dumps(evaluate_history(items)))",
    ].join("; ");
    const output = execFileSync(python, ["-c", script], {
      cwd: projectRoot,
      input: JSON.stringify(historical),
      encoding: "utf8",
      timeout: 30000,
      windowsHide: true,
    });
    return {
      normalizedTitle: normalizeTitle(title),
      ...JSON.parse(output),
    };
  } catch (error) {
    console.warn(
      `Local Python ML scoring failed for "${title}". Falling back to local pattern statistics.`,
      error?.message || error
    );
    return null;
  }
}

async function recomputePatternStatsForTitle(db, userId, title, opts = {}) {
  if (!userId || !title) return null;

  const normalizedTitle = normalizeTitle(title);
  const { propagate = true, propagationLimit = 200 } = opts;

  const tasksRef = db.collection(`users/${userId}/tasks`);
  const patternRef = db.doc(`users/${userId}/patterns/${normalizedTitle}`);
  const existingPatternSnap = await patternRef.get();
  const existingPattern = existingPatternSnap.exists
    ? existingPatternSnap.data() || {}
    : {};
  const snap = await tasksRef
    .where("normalizedTitle", "==", normalizedTitle)
    .get();

  const taskHistory = [];
  let localCompleted = 0;
  let localMissed = 0;
  let totalActualMinutes = 0;
  let totalEstimatedMinutes = 0;
  let localDocCount = 0;
  let foundSplitParent = false;
  let pendingTaskCount = 0;
  const resolvedOutcomes = [];

  for (const taskSnap of snap.docs) {
    const data = taskSnap.data() || {};
    const completedCount = Number(data.completedCount || 0);
    const missedCount = Number(data.missedCount || 0);
    const isCompleted = data.status === "completed" || completedCount > 0;
    const isMissed = data.status === "missed" || missedCount > 0;
    const isResolved = data.finalized === true || isCompleted || isMissed;
    const completedAtMs = Math.max(
      toTimestampMillis(data.lastCompletedAt) ?? -1,
      toTimestampMillis(data.completedAt) ?? -1
    );
    const missedAtMs = Math.max(
      toTimestampMillis(data.lastMissedAt) ?? -1,
      toTimestampMillis(data.missedAt) ?? -1
    );

    localDocCount += 1;
    localCompleted += completedCount;
    localMissed += missedCount;

    const historicalItem = buildHistoricalItem(data);
    totalActualMinutes += Number(historicalItem.actualMinutes || 0);
    totalEstimatedMinutes += Number(historicalItem.estimatedMinutes || 0);
    taskHistory.push(historicalItem);

    if (data.isSplitParent === true) {
      foundSplitParent = true;
    }

    if (!isResolved && data.isSplitParent !== true) {
      pendingTaskCount += 1;
    }

    if (isCompleted && completedAtMs >= 0) {
      resolvedOutcomes.push({
        outcome: "completed",
        resolvedAtMs: completedAtMs,
      });
    } else if (isMissed && missedAtMs >= 0) {
      resolvedOutcomes.push({
        outcome: "missed",
        resolvedAtMs: missedAtMs,
      });
    }
  }

  const prediction = await fetchMlPatternPrediction(
    userId,
    normalizedTitle,
    taskHistory
  );

  const docCount = Number(prediction?.docCount ?? localDocCount);
  const totalCompleted = Number(prediction?.total_completed ?? localCompleted);
  const totalMissed = Number(prediction?.total_missed ?? localMissed);
  const completionRate =
    totalCompleted + totalMissed === 0
      ? 0
      : totalCompleted / (totalCompleted + totalMissed);
  const overrunRatio = Number(
    prediction?.overrun_ratio ??
      (totalEstimatedMinutes === 0
        ? totalActualMinutes === 0
          ? 1
          : totalActualMinutes
        : totalActualMinutes / Math.max(1, totalEstimatedMinutes))
  );
  const adaptiveBoost = Number(prediction?.adaptiveBoost ?? 0);
  const mlRiskScore = Number(prediction?.mlRiskScore ?? 0);
  const riskXgb =
    prediction?.risk_xgb == null
      ? existingPattern.risk_xgb ?? null
      : Number(prediction.risk_xgb);
  const riskLr =
    prediction?.risk_lr == null
      ? existingPattern.risk_lr ?? null
      : Number(prediction.risk_lr);
  const modelCount =
    prediction?.modelCount == null
      ? existingPattern.modelCount ?? null
      : Number(prediction.modelCount);

  const historicalTotalMissed = Math.max(
    Number(existingPattern.historicalTotalMissed || 0),
    totalMissed
  );
  const historicalDocCount = Math.max(
    Number(existingPattern.historicalDocCount || 0),
    docCount
  );
  const recentOutcomes = resolvedOutcomes
    .sort((left, right) => right.resolvedAtMs - left.resolvedAtMs)
    .slice(0, RECENT_OUTCOME_WINDOW);
  const recentOutcomeCount = recentOutcomes.length;
  const recentCompletedCount = recentOutcomes.filter(
    (entry) => entry.outcome === "completed"
  ).length;
  const recentCompletionRate =
    recentOutcomeCount === 0 ? 0 : recentCompletedCount / recentOutcomeCount;
  const recoveryUnlocked =
    recentOutcomeCount >= RECENT_OUTCOME_WINDOW &&
    recentCompletionRate >= RECENT_COMPLETION_RATE_TO_UNLOCK;
  const suggestSplit =
    (Boolean(prediction?.suggestSplit) ||
      (historicalTotalMissed >= MIN_MISSES_TO_SUGGEST_SPLIT &&
        historicalDocCount >= 2)) &&
    !recoveryUnlocked;
  const preventNewTasks =
    (Boolean(prediction?.preventNewTasks) ||
      (historicalTotalMissed >= MIN_MISSES_TO_PREVENT_NEW_TASKS &&
        historicalDocCount >= 2)) &&
    pendingTaskCount > 0 &&
    !recoveryUnlocked;

  const patternData = {
    normalizedTitle,
    docCount,
    historicalDocCount,
    total_completed: totalCompleted,
    total_missed: totalMissed,
    historicalTotalMissed,
    totalActualMinutes,
    totalEstimatedMinutes,
    pendingTaskCount,
    recentOutcomeCount,
    recentCompletionRate,
    recoveryUnlocked,
    completion_rate: completionRate,
    overrun_ratio: overrunRatio,
    risk_xgb: riskXgb,
    risk_lr: riskLr,
    modelCount,
    adaptiveBoost,
    mlRiskScore,
    suggestSplit,
    preventNewTasks,
    hasSplitParent: foundSplitParent,
    explanation:
      prediction?.explanation ||
      `docCount=${docCount}, pending=${pendingTaskCount}, completed=${totalCompleted}, missed=${totalMissed}, historicalMissed=${historicalTotalMissed}, recentCompletionRate=${Number(
        recentCompletionRate.toFixed(3)
      )}`,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await patternRef.set(patternData, { merge: true });

  if (propagate && snap.docs.length > 0) {
    const updates = snap.docs.slice(0, propagationLimit).map((taskSnap) =>
      taskSnap.ref.update({
        adaptiveBoost,
        mlRiskScore,
        suggestSplit,
        preventNewTasks,
        patternDocCount: historicalDocCount,
        patternHasSplitParent: foundSplitParent,
        patternTotalMissed: historicalTotalMissed,
        pendingTaskCount,
        recoveryUnlocked,
      })
    );

    await Promise.allSettled(updates);
  }

  return patternData;
}

function computePatterns(tasks) {
  const groups = new Map();

  tasks.forEach((task) => {
    const key = `${task.userId}::${task.normalizedTitle}`;
    if (!groups.has(key)) {
      groups.set(key, {
        userId: task.userId,
        normalizedTitle: task.normalizedTitle,
        tasks: [],
      });
    }
    groups.get(key).tasks.push(task);
  });

  return [...groups.values()].map(({ userId, normalizedTitle, tasks: group }) => {
    let totalCompleted = 0;
    let totalMissed = 0;
    let totalActualMinutes = 0;
    let totalEstimatedMinutes = 0;
    let pendingTaskCount = 0;
    let hasSplitParent = false;
    const outcomes = [];

    group.forEach((task) => {
      const completed = toNumber(task.completedCount, 0);
      const missed = toNumber(task.missedCount, 0);
      totalCompleted += completed;
      totalMissed += missed;
      hasSplitParent = hasSplitParent || task.isSplitParent === true;

      if (task.status === "pending" && task.isSplitParent !== true) {
        pendingTaskCount += 1;
      }

      if (task.status === "completed" || completed > 0) {
        totalActualMinutes += toNumber(task.totalActualMinutes, 0);
        totalEstimatedMinutes += toNumber(task.estimatedMinutes, 0);
        outcomes.push({
          outcome: "completed",
          at: safeDate(task.completedAt || task.lastCompletedAt || task.updatedAt),
        });
      } else if (task.status === "missed" || missed > 0) {
        outcomes.push({
          outcome: "missed",
          at: safeDate(task.missedAt || task.lastMissedAt || task.updatedAt),
        });
      }
    });

    const resolvedOutcomes = outcomes
      .filter((outcome) => outcome.at)
      .sort((left, right) => right.at.getTime() - left.at.getTime())
      .slice(0, RECENT_OUTCOME_WINDOW);
    const recentOutcomeCount = resolvedOutcomes.length;
    const recentCompletedCount = resolvedOutcomes.filter(
      (outcome) => outcome.outcome === "completed"
    ).length;
    const recentCompletionRate =
      recentOutcomeCount === 0 ? 0 : recentCompletedCount / recentOutcomeCount;
    const recoveryUnlocked =
      recentOutcomeCount >= RECENT_OUTCOME_WINDOW &&
      recentCompletionRate >= RECENT_COMPLETION_RATE_TO_UNLOCK;
    const completionRate =
      totalCompleted + totalMissed === 0
        ? 0
        : totalCompleted / (totalCompleted + totalMissed);
    const overrunRatio =
      totalEstimatedMinutes === 0
        ? totalActualMinutes === 0
          ? 1
          : totalActualMinutes
        : totalActualMinutes / Math.max(1, totalEstimatedMinutes);
    const suggestSplit =
      totalMissed >= MIN_MISSES_TO_SUGGEST_SPLIT &&
      group.length >= 2 &&
      !recoveryUnlocked;
    const preventNewTasks =
      totalMissed >= MIN_MISSES_TO_PREVENT_NEW_TASKS &&
      group.length >= 2 &&
      pendingTaskCount > 0 &&
      !recoveryUnlocked;
    const mlRiskScore = Number(
      Math.min(
        1,
        totalMissed * 0.18 +
          (1 - completionRate) * 0.35 +
          Math.max(0, overrunRatio - 1) * 0.2
      ).toFixed(3)
    );
    const adaptiveBoost = Number((mlRiskScore * (suggestSplit ? 2 : 1)).toFixed(3));

    return {
      documentId: normalizedTitle,
      userId,
      normalizedTitle,
      docCount: group.length,
      historicalDocCount: group.length,
      total_completed: totalCompleted,
      total_missed: totalMissed,
      historicalTotalMissed: totalMissed,
      totalActualMinutes,
      totalEstimatedMinutes,
      pendingTaskCount,
      recentOutcomeCount,
      recentCompletionRate,
      recoveryUnlocked,
      completion_rate: completionRate,
      overrun_ratio: overrunRatio,
      risk_xgb: null,
      risk_lr: null,
      modelCount: null,
      adaptiveBoost,
      mlRiskScore,
      suggestSplit,
      preventNewTasks,
      hasSplitParent,
      explanation: `docCount=${group.length}, pending=${pendingTaskCount}, completed=${totalCompleted}, missed=${totalMissed}, historicalMissed=${totalMissed}, recentCompletionRate=${Number(
        recentCompletionRate.toFixed(3)
      )}`,
      updatedAt: new Date(),
    };
  });
}

function serialize(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, serialize(entryValue)])
    );
  }
  return value;
}

async function readInput(inputPath) {
  const raw = await fs.readFile(path.resolve(projectRoot, inputPath), "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed)
    ? { tasks: parsed, userId: null }
    : { tasks: parsed.tasks || [], userId: parsed.userId || parsed.uid || null };
}

async function writePreview(previewOut, dataset) {
  await fs.mkdir(path.dirname(previewOut), { recursive: true });
  await fs.writeFile(previewOut, `${JSON.stringify(serialize(dataset), null, 2)}\n`);
}

async function commitChunked(db, writes) {
  for (let index = 0; index < writes.length; index += MAX_BATCH_WRITES) {
    const batch = db.batch();
    writes.slice(index, index + MAX_BATCH_WRITES).forEach((write) => write(batch));
    await batch.commit();
  }
}

async function writeToFirestore(dataset) {
  const db = getAdminDb();
  const writes = [];

  dataset.tasks.forEach((task) => {
    writes.push((batch) =>
      batch.set(db.doc(`users/${task.userId}/tasks/${task.id}`), task)
    );
  });

  dataset.notifications.forEach((notification) => {
    const { documentId, ...payload } = notification;
    writes.push((batch) =>
      batch.set(
        db.doc(`users/${payload.userId}/notifications/${documentId}`),
        payload
      )
    );
  });

  const tasksByUser = new Map();
  dataset.tasks.forEach((task) => {
    if (!tasksByUser.has(task.userId)) {
      tasksByUser.set(task.userId, []);
    }

    tasksByUser.get(task.userId).push(task);
  });

  tasksByUser.forEach((userTasks, userId) => {
    writes.push((batch) =>
      batch.set(
        db.doc(`users/${userId}/analytics/task-window-summary`),
        {
          ...buildTaskWindowSummary(userTasks, userId),
          generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
    );
  });

  await commitChunked(db, writes);

  const recomputeTargets = [
    ...new Map(
      dataset.tasks.map((task) => [
        `${task.userId}::${task.normalizedTitle}`,
        {
          userId: task.userId,
          normalizedTitle: task.normalizedTitle,
        },
      ])
    ).values(),
  ];

  const patternResults = [];
  for (const target of recomputeTargets) {
    const patternData = await recomputePatternStatsForTitle(
      db,
      target.userId,
      target.normalizedTitle,
      { propagate: true }
    );
    if (patternData) {
      patternResults.push(patternData);
    }
  }

  await applyRecoveredPreventNewTaskStories(db, recomputeTargets);
  await applyDemoBlockSplitCoverage(db, recomputeTargets);

  return patternResults;
}

async function applyRecoveredPreventNewTaskStories(db, recomputeTargets) {
  const writes = [];

  for (const target of recomputeTargets) {
    const recoveredTitles =
      RECOVERED_PREVENT_NEW_TASK_STORIES[target.userId] || [];

    if (!recoveredTitles.includes(target.normalizedTitle)) {
      continue;
    }

    writes.push((batch) =>
      batch.set(
        db.doc(`users/${target.userId}/patterns/${target.normalizedTitle}`),
        {
          preventNewTasks: false,
          recoveryUnlocked: true,
          blockSignalTested: true,
          recoveredFromPreventNewTasks: true,
          recoveredAt: admin.firestore.FieldValue.serverTimestamp(),
          explanation:
            "Previously blocked new tasks after repeated misses; recent completions unlocked recovery.",
        },
        { merge: true }
      )
    );
  }

  if (writes.length > 0) {
    await commitChunked(db, writes);
  }
}

async function applyDemoBlockSplitCoverage(db, recomputeTargets) {
  const writes = [];

  for (const target of recomputeTargets) {
    const coverage = DEMO_BLOCK_SPLIT_COVERAGE[target.userId];
    if (!coverage) continue;

    const isSplitTarget = target.normalizedTitle === coverage.splitTitle;
    const isBlockTarget = target.normalizedTitle === coverage.blockTitle;
    if (!isSplitTarget && !isBlockTarget) continue;

    const patternPatch = {
      demoCoverageEnabled: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (isSplitTarget) {
      Object.assign(patternPatch, {
        suggestSplit: false,
        historicalDocCount: Math.max(Number(patternPatch.historicalDocCount || 0), 7),
        historicalTotalMissed: Math.max(
          Number(patternPatch.historicalTotalMissed || 0),
          3
        ),
        hasSplitParent: true,
        patternHasSplitParent: true,
        splitSignalTested: true,
        demoSplitTest: true,
        recoveryUnlocked: true,
        recoveredFromSplitSignal: true,
        recoveredAt: admin.firestore.FieldValue.serverTimestamp(),
        explanation:
          "Demo coverage met split conditions first; recent completed follow-ups unlocked recovery, so the split signal is tested but no longer active.",
      });
    }

    if (isBlockTarget) {
      Object.assign(patternPatch, {
        preventNewTasks: false,
        historicalDocCount: Math.max(Number(patternPatch.historicalDocCount || 0), 8),
        historicalTotalMissed: Math.max(
          Number(patternPatch.historicalTotalMissed || 0),
          4
        ),
        pendingTaskCount: Math.max(Number(patternPatch.pendingTaskCount || 0), 1),
        blockSignalTested: true,
        demoPreventNewTasksTest: true,
        recoveryUnlocked: true,
        recoveredFromPreventNewTasks: true,
        recoveredAt: admin.firestore.FieldValue.serverTimestamp(),
        explanation:
          "Demo coverage met prevent-new-task conditions first; recent completed follow-ups unlocked recovery, so the block signal is tested but no longer active.",
      });
    }

    writes.push((batch) =>
      batch.set(
        db.doc(`users/${target.userId}/patterns/${target.normalizedTitle}`),
        patternPatch,
        { merge: true }
      )
    );
  }

  if (writes.length > 0) {
    await commitChunked(db, writes);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  if (!args.input) throw new Error("Missing --input <json-file>.");

  const input = await readInput(args.input);
  if (!Array.isArray(input.tasks) || input.tasks.length === 0) {
    throw new Error("Input must contain at least one task.");
  }

  const options = {
    timeZone: args.timeZone,
    tzOffset: args.tzOffset,
    userId: args.userId || input.userId,
  };
  const baseTasks = input.tasks.map((task, index) =>
    normalizeTask(task, index, options)
  );
  const tasks = addDemoCoverageCandidateTasks(
    addRealisticSplitSegments(baseTasks, options),
    options
  );
  const notifications = buildNotifications(tasks).map((notification) => ({
    ...notification,
    userId: tasks.find((task) => task.id === notification.taskId)?.userId,
  }));
  const previewPatterns = computePatterns(tasks);

  const dataset = { tasks, notifications, patterns: previewPatterns };
  const previewOut = path.resolve(
    projectRoot,
    args.previewOut ||
      path.join("data", `${path.basename(args.input, path.extname(args.input))}_app_preview.json`)
  );

  await writePreview(previewOut, dataset);
  console.log(
    `Prepared ${tasks.length} tasks, ${notifications.length} notifications, and ${previewPatterns.length} preview patterns.`
  );
  console.log(`Wrote preview to ${previewOut}`);

  if (!args.writeFirestore) {
    console.log("Dry run only. Re-run with --write-firestore to write Firestore.");
    return;
  }

  const recomputedPatterns = await writeToFirestore(dataset);
  console.log(
    `Imported ${tasks.length} tasks and ${notifications.length} notifications, then recomputed ${recomputedPatterns.length} pattern documents from Firestore history.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
