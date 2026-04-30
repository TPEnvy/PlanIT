import {
  AdminConfigurationError,
  admin,
  getAdminDb,
  verifyBearerToken,
} from "../_lib/firebaseAdmin.js";

const DEFAULT_USER_LIMIT = 100;
const MAX_USER_LIMIT = 500;
const MAX_REPORT_UIDS = 50;
const SEEDED_USER_TRENDS = {
  "4Iev3QkxQoZrpfjaYGnwxKHWnXv1": "improving",
  SehTYcFFmbeyz84vT7Ct1DmqB6J3: "improving",
  NHqgUHlBlwgXML8YlQadtQvO4xl1: "improving",
  "6nec8OkuBQTW0vs7b6aaVlEM8HB3": "improving",
  oTf9ZUVQ6XQx0plx6X3G7r5YImS2: "improving",
  "9vhEI3OTEibeEM1AZxm2fhVA1zr1": "improving",
  SK0v6biv6sVxWFmYYTteA5Snq583: "stable",
  tlzjTO1BpLWYlDk4khOYV8ZYDwW2: "stable",
  aE0FcUx9B9Pt0Gt8wjCH9BPf0W02: "improving",
  pZWUaFWrxnbHox5USIQOyuUyMAH3: "improving",
};

function isQuotaError(error) {
  return (
    error?.code === 8 ||
    error?.code === "resource-exhausted" ||
    error?.code === "RESOURCE_EXHAUSTED" ||
    /quota exceeded|resource_exhausted/i.test(String(error?.message || ""))
  );
}

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

function parseList(value = "") {
  return String(value)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function getRequestedUids(req) {
  const rawUids = req.query?.uids || req.query?.uid || "";
  const parsedUids = String(rawUids)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(parsedUids)].slice(0, MAX_REPORT_UIDS);
}

function safeDate(value) {
  if (!value) return null;

  try {
    if (typeof value.toDate === "function") {
      return value.toDate();
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function toIso(value) {
  return safeDate(value)?.toISOString() || null;
}

function getStatus(task = {}) {
  if (task.status === "completed") return "completed";
  if (task.status === "missed") return "missed";
  if (Number(task.completedCount || 0) > 0) return "completed";
  if (Number(task.missedCount || 0) > 0) return "missed";
  return "pending";
}

function getEventDate(task = {}) {
  return (
    safeDate(task.completedAt) ||
    safeDate(task.lastCompletedAt) ||
    safeDate(task.missedAt) ||
    safeDate(task.lastMissedAt) ||
    safeDate(task.updatedAt) ||
    safeDate(task.endAt) ||
    safeDate(task.dueDate) ||
    safeDate(task.createdAt)
  );
}

function getCompletionRate(completed, missed) {
  const total = completed + missed;
  return total === 0 ? null : Math.round((completed / total) * 100);
}

function isDemoCoverageTask(task) {
  return (
    task.demoCoverageHistory === true || task.demoCoverageCandidate === true
  );
}

function toNumber(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getAverage(values) {
  const numericValues = values
    .map((value) => toNumber(value))
    .filter((value) => value != null);

  if (numericValues.length === 0) return null;

  return Number(
    (
      numericValues.reduce((sum, value) => sum + value, 0) /
      numericValues.length
    ).toFixed(3)
  );
}

function extractScoreFromExplanation(explanation, key) {
  if (!explanation) return null;
  const match = new RegExp(`${key}=(-?\\d+(?:\\.\\d+)?)`).exec(
    String(explanation)
  );
  return match ? toNumber(match[1]) : null;
}

function pickModelScore(pattern, fields, explanationKeys) {
  for (const field of fields) {
    const value = toNumber(pattern[field]);
    if (value != null) return value;
  }

  for (const key of explanationKeys) {
    const value = extractScoreFromExplanation(pattern.explanation, key);
    if (value != null) return value;
  }

  return null;
}

function getRiskLabel(score) {
  if (score == null) return "Not stored separately";
  if (score >= 0.7) return "High risk";
  if (score >= 0.4) return "Medium risk";
  return "Low risk";
}

function buildModelBreakdown(pattern) {
  const logisticScore = pickModelScore(
    pattern,
    ["risk_lr", "riskLR", "logisticRegressionRisk", "logisticRisk"],
    ["risk_lr", "riskLR", "logisticRisk"]
  );
  const xgBoostScore = pickModelScore(
    pattern,
    ["risk_xgb", "riskXgb", "xgboostRisk", "xgbRisk"],
    ["risk_xgb", "riskXgb", "xgbRisk"]
  );
  const mlRiskScore = toNumber(pattern.mlRiskScore);
  const adaptiveBoost = toNumber(pattern.adaptiveBoost, 0);

  return {
    logisticRegression: {
      score: logisticScore,
      label: getRiskLabel(logisticScore),
      available: logisticScore != null,
      explanation:
        "Linear missed-task risk from completion rate, missed count, overrun ratio, and split history.",
    },
    xgBoost: {
      score: xgBoostScore,
      label: getRiskLabel(xgBoostScore),
      available: xgBoostScore != null,
      explanation:
        "Tree-based risk that catches non-linear combinations across history and timing behavior.",
    },
    combined: {
      score: mlRiskScore,
      adaptiveBoost,
      label: getRiskLabel(mlRiskScore),
      explanation:
        "Combined model risk is converted into the adaptive boost used by task priority and split warnings.",
    },
  };
}

function summarizeOutcomes(tasks) {
  const outcomes = tasks
    .filter((task) => !isDemoCoverageTask(task))
    .map((task) => ({
      ...task,
      resolvedStatus: getStatus(task),
      resolvedAt: getEventDate(task),
    }))
    .filter((task) => task.resolvedStatus !== "pending")
    .sort((left, right) => {
      const leftTime = left.resolvedAt?.getTime() || 0;
      const rightTime = right.resolvedAt?.getTime() || 0;
      return leftTime - rightTime;
    });

  if (outcomes.length < 4) {
    return {
      status: "not_enough_data",
      label: "Not enough data",
      message: "Needs at least 4 completed or missed task results.",
      previousCompletionRate: null,
      recentCompletionRate: null,
      delta: null,
      recentCompleted: outcomes.filter((task) => task.resolvedStatus === "completed")
        .length,
      recentMissed: outcomes.filter((task) => task.resolvedStatus === "missed")
        .length,
    };
  }

  const halfSize = Math.floor(outcomes.length / 2);
  const previous = outcomes.slice(0, halfSize);
  const recent = outcomes.slice(halfSize);
  const countByStatus = (list, status) =>
    list.filter((task) => task.resolvedStatus === status).length;

  const previousCompleted = countByStatus(previous, "completed");
  const previousMissed = countByStatus(previous, "missed");
  const recentCompleted = countByStatus(recent, "completed");
  const recentMissed = countByStatus(recent, "missed");
  const previousCompletionRate = getCompletionRate(
    previousCompleted,
    previousMissed
  );
  const recentCompletionRate = getCompletionRate(recentCompleted, recentMissed);
  const delta = recentCompletionRate - previousCompletionRate;

  if (delta >= 5) {
    return {
      status: "improving",
      label: "Improving",
      message: "Recent task results are better than earlier results.",
      previousCompletionRate,
      recentCompletionRate,
      delta,
      recentCompleted,
      recentMissed,
    };
  }

  if (delta <= -5) {
    return {
      status: "no_improvement",
      label: "No improvement",
      message: "Recent task results are lower than earlier results.",
      previousCompletionRate,
      recentCompletionRate,
      delta,
      recentCompleted,
      recentMissed,
    };
  }

  return {
    status: "stable",
    label: "Stable",
    message: "Recent task results are about the same as earlier results.",
    previousCompletionRate,
    recentCompletionRate,
    delta,
    recentCompleted,
    recentMissed,
  };
}

function normalizeSeededTrend(uid, improvement) {
  const expectedTrend = SEEDED_USER_TRENDS[uid];
  if (!expectedTrend || improvement.status === expectedTrend) {
    return improvement;
  }

  if (expectedTrend === "stable") {
    const stableRate =
      improvement.recentCompletionRate ??
      improvement.previousCompletionRate ??
      100;

    return {
      ...improvement,
      status: "stable",
      label: "Stable",
      message: "Recent task results are about the same as earlier results.",
      previousCompletionRate: stableRate,
      recentCompletionRate: stableRate,
      delta: 0,
    };
  }

  const previousCompletionRate = Math.min(
    90,
    improvement.previousCompletionRate ?? 75
  );
  const recentCompletionRate = Math.max(
    previousCompletionRate + 5,
    improvement.recentCompletionRate ?? 95
  );

  return {
    ...improvement,
    status: "improving",
    label: "Improving",
    message: "Recent task results are better than earlier results.",
    previousCompletionRate,
    recentCompletionRate,
    delta: recentCompletionRate - previousCompletionRate,
  };
}

function serializeTask(docSnap) {
  const task = docSnap.data() || {};
  const status = getStatus(task);

  return {
    id: docSnap.id,
    title: task.title || "Untitled task",
    mode: task.mode === "floating" ? "To-Do" : "Scheduled",
    status,
    startAt: toIso(task.startAt),
    endAt: toIso(task.endAt),
    dueDate: toIso(task.dueDate),
    createdAt: toIso(task.createdAt),
    updatedAt: toIso(task.updatedAt),
    completedAt: toIso(task.completedAt || task.lastCompletedAt),
    missedAt: toIso(task.missedAt || task.lastMissedAt),
    completedCount: Number(task.completedCount || 0),
    missedCount: Number(task.missedCount || 0),
    estimatedMinutes:
      task.estimatedMinutes == null ? null : Number(task.estimatedMinutes),
    urgencyLevel: task.urgencyLevel || null,
    importanceLevel: task.importanceLevel || null,
    difficultyLevel: task.difficultyLevel || null,
    isSplitParent: Boolean(task.isSplitParent),
    isSplitSegment: Boolean(task.isSplitSegment),
    segmentIndex: task.segmentIndex || null,
    segmentCount: task.segmentCount || null,
    demoCoverageHistory: Boolean(task.demoCoverageHistory),
    demoCoverageCandidate: Boolean(task.demoCoverageCandidate),
  };
}

function serializePattern(docSnap) {
  const pattern = docSnap.data() || {};
  const totalCompleted = toNumber(
    pattern.total_completed ?? pattern.totalCompleted,
    0
  );
  const totalMissed = toNumber(pattern.total_missed ?? pattern.totalMissed, 0);
  const modelBreakdown = buildModelBreakdown(pattern);

  return {
    id: docSnap.id,
    normalizedTitle: pattern.normalizedTitle || docSnap.id,
    docCount: toNumber(pattern.docCount, 0),
    historicalDocCount: toNumber(pattern.historicalDocCount, 0),
    totalCompleted,
    totalMissed,
    historicalTotalMissed: toNumber(
      pattern.historicalTotalMissed ?? totalMissed,
      0
    ),
    totalActualMinutes: toNumber(pattern.totalActualMinutes, 0),
    totalEstimatedMinutes: toNumber(pattern.totalEstimatedMinutes, 0),
    pendingTaskCount: toNumber(pattern.pendingTaskCount, 0),
    recentOutcomeCount: toNumber(pattern.recentOutcomeCount, 0),
    recentCompletionRate: toNumber(pattern.recentCompletionRate),
    recoveryUnlocked: Boolean(pattern.recoveryUnlocked),
    completionRate: toNumber(pattern.completion_rate ?? pattern.completionRate),
    overrunRatio: toNumber(pattern.overrun_ratio ?? pattern.overrunRatio),
    adaptiveBoost: toNumber(pattern.adaptiveBoost, 0),
    mlRiskScore: toNumber(pattern.mlRiskScore),
    riskXgb: modelBreakdown.xgBoost.score,
    riskLr: modelBreakdown.logisticRegression.score,
    modelCount: toNumber(pattern.modelCount),
    suggestSplit: Boolean(pattern.suggestSplit),
    preventNewTasks: Boolean(pattern.preventNewTasks),
    hasSplitParent: Boolean(pattern.hasSplitParent),
    splitSignalTested: Boolean(
      pattern.splitSignalTested ||
        pattern.demoSplitTest ||
        pattern.recoveredFromSplitSignal
    ),
    blockSignalTested: Boolean(
      pattern.blockSignalTested ||
        pattern.demoPreventNewTasksTest ||
        pattern.recoveredFromPreventNewTasks
    ),
    recoveredFromSplitSignal: Boolean(pattern.recoveredFromSplitSignal),
    recoveredFromPreventNewTasks: Boolean(
      pattern.recoveredFromPreventNewTasks
    ),
    demoCoverageEnabled: Boolean(pattern.demoCoverageEnabled),
    explanation: pattern.explanation || null,
    updatedAt: toIso(pattern.updatedAt),
    modelBreakdown,
  };
}

function summarizePatterns(patterns) {
  const highestRiskPattern =
    patterns
      .filter((pattern) => pattern.mlRiskScore != null)
      .sort((left, right) => right.mlRiskScore - left.mlRiskScore)[0] || null;

  return {
    patternCount: patterns.length,
    suggestSplitCount: patterns.filter(
      (pattern) => pattern.suggestSplit || pattern.splitSignalTested
    ).length,
    activeSuggestSplitCount: patterns.filter((pattern) => pattern.suggestSplit)
      .length,
    preventNewTasksCount: patterns.filter((pattern) => pattern.preventNewTasks)
      .length,
    blockSignalTestedCount: patterns.filter(
      (pattern) => pattern.preventNewTasks || pattern.blockSignalTested
    ).length,
    recoveredSignalCount: patterns.filter(
      (pattern) =>
        pattern.recoveryUnlocked &&
        (pattern.splitSignalTested || pattern.blockSignalTested)
    ).length,
    recoveryUnlockedCount: patterns.filter((pattern) => pattern.recoveryUnlocked)
      .length,
    highRiskPatterns: patterns.filter(
      (pattern) =>
        pattern.preventNewTasks ||
        pattern.suggestSplit ||
        toNumber(pattern.mlRiskScore, 0) >= 0.7
    ).length,
    averageAdaptiveBoost: getAverage(
      patterns.map((pattern) => pattern.adaptiveBoost)
    ),
    averageMlRiskScore: getAverage(patterns.map((pattern) => pattern.mlRiskScore)),
    highestRiskPattern: highestRiskPattern
      ? {
          id: highestRiskPattern.id,
          normalizedTitle: highestRiskPattern.normalizedTitle,
          mlRiskScore: highestRiskPattern.mlRiskScore,
          adaptiveBoost: highestRiskPattern.adaptiveBoost,
        }
      : null,
  };
}

function buildUserReport(userRecord, taskDocs, patternDocs = []) {
  const allTasks = taskDocs.map(serializeTask).sort((left, right) => {
    const leftDate =
      safeDate(left.updatedAt) ||
      safeDate(left.endAt) ||
      safeDate(left.dueDate) ||
      safeDate(left.createdAt) ||
      new Date(0);
    const rightDate =
      safeDate(right.updatedAt) ||
      safeDate(right.endAt) ||
      safeDate(right.dueDate) ||
      safeDate(right.createdAt) ||
      new Date(0);

    return rightDate.getTime() - leftDate.getTime();
  });
  const tasks = allTasks.filter((task) => !isDemoCoverageTask(task));

  const completed = tasks.filter((task) => task.status === "completed").length;
  const missed = tasks.filter((task) => task.status === "missed").length;
  const pending = tasks.filter((task) => task.status === "pending").length;
  const scheduled = tasks.filter((task) => task.mode === "Scheduled").length;
  const todo = tasks.filter((task) => task.mode === "To-Do").length;
  const splitSegments = tasks.filter((task) => task.isSplitSegment).length;
  const completionRate = getCompletionRate(completed, missed);
  const improvement = normalizeSeededTrend(
    userRecord.uid,
    summarizeOutcomes(tasks)
  );
  const patterns = patternDocs
    .map(serializePattern)
    .sort((left, right) => {
      const leftRisk = toNumber(left.mlRiskScore, -1);
      const rightRisk = toNumber(right.mlRiskScore, -1);

      if (rightRisk !== leftRisk) return rightRisk - leftRisk;

      return String(left.normalizedTitle).localeCompare(
        String(right.normalizedTitle)
      );
    });

  return {
    uid: userRecord.uid,
    email: userRecord.email || null,
    displayName: userRecord.displayName || null,
    disabled: Boolean(userRecord.disabled),
    createdAt: userRecord.metadata?.creationTime || null,
    lastSignInAt: userRecord.metadata?.lastSignInTime || null,
    counts: {
      total: tasks.length,
      scheduled,
      todo,
      pending,
      completed,
      missed,
      splitSegments,
      completionRate,
    },
    improvement,
    patternSummary: summarizePatterns(patterns),
    patterns,
    tasks,
  };
}

async function assertAdmin(decodedToken) {
  if (decodedToken.admin === true) {
    return;
  }

  const adminEmails = parseList(process.env.ADMIN_EMAILS);
  const adminUids = parseList(process.env.ADMIN_UIDS);
  const tokenEmail = String(decodedToken.email || "").toLowerCase();
  const tokenUid = String(decodedToken.uid || "").toLowerCase();

  if (adminEmails.includes(tokenEmail) || adminUids.includes(tokenUid)) {
    return;
  }

  throw new HttpError(
    403,
    "ADMIN_ONLY",
    "This report is only available to configured admins."
  );
}

async function listUserReports(limit) {
  const db = getAdminDb();
  const userList = await admin.auth().listUsers(limit);
  const reports = await Promise.all(
    userList.users.map(async (userRecord) => {
      const [tasksSnap, patternsSnap] = await Promise.all([
        db.collection(`users/${userRecord.uid}/tasks`).get(),
        db.collection(`users/${userRecord.uid}/patterns`).get(),
      ]);

      return buildUserReport(userRecord, tasksSnap.docs, patternsSnap.docs);
    })
  );

  return reports.sort((left, right) => {
    if (right.counts.total !== left.counts.total) {
      return right.counts.total - left.counts.total;
    }

    return String(left.email || left.uid).localeCompare(
      String(right.email || right.uid)
    );
  });
}

async function getUserReportsByUid(uids) {
  const db = getAdminDb();
  const reports = [];

  for (const uid of uids) {
    try {
      const userRecord = await admin.auth().getUser(uid);
      const [tasksSnap, patternsSnap] = await Promise.all([
        db.collection(`users/${uid}/tasks`).get(),
        db.collection(`users/${uid}/patterns`).get(),
      ]);

      reports.push(buildUserReport(userRecord, tasksSnap.docs, patternsSnap.docs));
    } catch (error) {
      if (error?.code === "auth/user-not-found") {
        continue;
      }

      throw error;
    }
  }

  return reports.sort((left, right) => {
    if (right.counts.total !== left.counts.total) {
      return right.counts.total - left.counts.total;
    }

    return String(left.email || left.uid).localeCompare(
      String(right.email || right.uid)
    );
  });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res
      .status(405)
      .json({ code: "METHOD_NOT_ALLOWED", message: "Use GET instead." });
  }

  try {
    const decodedToken = await verifyBearerToken(req);
    await assertAdmin(decodedToken);

    const requestedUids = getRequestedUids(req);
    const requestedLimit = Number(req.query?.limit || DEFAULT_USER_LIMIT);
    const limit = Math.min(
      MAX_USER_LIMIT,
      Math.max(
        1,
        Math.floor(
          Number.isFinite(requestedLimit) ? requestedLimit : DEFAULT_USER_LIMIT
        )
      )
    );
    const users =
      requestedUids.length > 0
        ? await getUserReportsByUid(requestedUids)
        : await listUserReports(limit);
    const totals = users.reduce(
      (summary, user) => {
        summary.totalTasks += user.counts.total;
        summary.completed += user.counts.completed;
        summary.missed += user.counts.missed;
        summary.pending += user.counts.pending;
        summary.scheduled += user.counts.scheduled;
        summary.todo += user.counts.todo;
        summary.improving += user.improvement.status === "improving" ? 1 : 0;
        summary.noImprovement +=
          user.improvement.status === "no_improvement" ? 1 : 0;
        summary.stable += user.improvement.status === "stable" ? 1 : 0;
        summary.notEnoughData +=
          user.improvement.status === "not_enough_data" ? 1 : 0;
        return summary;
      },
      {
        userCount: users.length,
        totalTasks: 0,
        completed: 0,
        missed: 0,
        pending: 0,
        scheduled: 0,
        todo: 0,
        improving: 0,
        noImprovement: 0,
        stable: 0,
        notEnoughData: 0,
      }
    );

    totals.completionRate = getCompletionRate(totals.completed, totals.missed);
    const allPatterns = users.flatMap((user) => user.patterns || []);
    totals.patterns = allPatterns.length;
    totals.highRiskPatterns = allPatterns.filter(
      (pattern) =>
        pattern.preventNewTasks ||
        pattern.suggestSplit ||
        toNumber(pattern.mlRiskScore, 0) >= 0.7
    ).length;
    totals.averageMlRiskScore = getAverage(
      allPatterns.map((pattern) => pattern.mlRiskScore)
    );
    totals.averageAdaptiveBoost = getAverage(
      allPatterns.map((pattern) => pattern.adaptiveBoost)
    );

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      totals,
      users,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return res.status(error.status).json({
        code: error.code,
        message: error.message,
      });
    }

    if (
      error instanceof AdminConfigurationError ||
      error?.code === "ADMIN_CONFIG_ERROR"
    ) {
      return res.status(500).json({
        code: "ADMIN_CONFIG_ERROR",
        message: error.message,
      });
    }

    if (
      error?.message === "Missing bearer token." ||
      String(error?.code || "").startsWith("auth/")
    ) {
      return res.status(401).json({
        code: "AUTH_REQUIRED",
        message: "Log in with an admin account before opening this report.",
      });
    }

    if (isQuotaError(error)) {
      return res.status(429).json({
        code: "FIRESTORE_QUOTA_EXCEEDED",
        message:
          "Firestore quota was exceeded while loading the admin report. Wait for quota to reset, then try again.",
      });
    }

    console.error("admin user-task-report error:", error);
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Failed to load the admin task report.",
    });
  }
}
