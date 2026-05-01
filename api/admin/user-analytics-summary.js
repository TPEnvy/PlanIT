import {
  AdminConfigurationError,
  admin,
  getAdminDb,
  verifyBearerToken,
} from "../_lib/firebaseAdmin.js";

const DEFAULT_USER_LIMIT = 100;
const MAX_USER_LIMIT = 500;
const MAX_REPORT_UIDS = 100;
const SUMMARY_DOC_ID = "task-window-summary";

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

function isQuotaError(error) {
  return (
    error?.code === 8 ||
    error?.code === "resource-exhausted" ||
    error?.code === "RESOURCE_EXHAUSTED" ||
    /quota exceeded|resource_exhausted/i.test(String(error?.message || ""))
  );
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

function toNumber(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function average(values) {
  const numericValues = values
    .map((value) => toNumber(value))
    .filter((value) => value != null);

  if (numericValues.length === 0) return null;

  return Number(
    (
      numericValues.reduce((total, value) => total + value, 0) /
      numericValues.length
    ).toFixed(1)
  );
}

function getWeekQuality(completionRate) {
  const rate = toNumber(completionRate);
  if (rate == null) {
    return {
      status: "no_data",
      label: "No data",
      explanation: "No completed or missed tasks were available for this window.",
    };
  }

  if (rate >= 85) {
    return {
      status: "good_week",
      label: "Good week",
      explanation: `Completion rate is ${rate}%, which meets the good-week mark of 85% or higher.`,
    };
  }

  return {
    status: "bad_week",
    label: "Bad week",
    explanation: `Completion rate is ${rate}%, which is below the good-week mark of 85%.`,
  };
}

function getDeltaExplanation(delta, day1To6, day7To12, trend) {
  if (delta == null) {
    return "Not enough decided tasks to compare Day 1-6 with Day 7-12.";
  }

  const absoluteDelta = Math.abs(delta);
  const stableNote =
    trend === "stable" ? " The system still marks this as stable because it is within 4 percentage points." : "";

  if (delta > 0) {
    return `Day 7-12 is ${absoluteDelta} percentage point${absoluteDelta === 1 ? "" : "s"} higher than Day 1-6 (${day7To12.completionRate}% vs ${day1To6.completionRate}%).${stableNote}`;
  }

  if (delta < 0) {
    return `Day 7-12 is ${absoluteDelta} percentage point${absoluteDelta === 1 ? "" : "s"} lower than Day 1-6 (${day7To12.completionRate}% vs ${day1To6.completionRate}%).${stableNote}`;
  }

  return `Day 7-12 is the same as Day 1-6 (${day7To12.completionRate}% vs ${day1To6.completionRate}%).${stableNote}`;
}

function serializeWindow(window = {}) {
  const completionRate = toNumber(window.completionRate);

  return {
    label: window.label || "",
    dates: Array.isArray(window.dates) ? window.dates : [],
    total: toNumber(window.total, 0),
    completed: toNumber(window.completed, 0),
    missed: toNumber(window.missed, 0),
    pending: toNumber(window.pending, 0),
    decided: toNumber(window.decided, 0),
    completionRate,
    averageActualMinutes: toNumber(window.averageActualMinutes),
    averageEstimatedMinutes: toNumber(window.averageEstimatedMinutes),
    quality: getWeekQuality(completionRate),
  };
}

function serializeWeeklyProgress(weeks = []) {
  if (!Array.isArray(weeks)) return [];

  return weeks.map((week) => ({
    weekKey: week.weekKey || week.startDate || "",
    label: week.label || "",
    startDate: week.startDate || null,
    endDate: week.endDate || null,
    days: Array.isArray(week.days)
      ? week.days.map((day) => ({
          label: day.label || "",
          key: day.key || "",
          completed: toNumber(day.completed, 0),
          missed: toNumber(day.missed, 0),
        }))
      : [],
    completedTotal: toNumber(week.completedTotal, 0),
    missedTotal: toNumber(week.missedTotal, 0),
    totalActivity: toNumber(week.totalActivity, 0),
    completionRate: toNumber(week.completionRate),
    status: week.status || "none",
    statusLabel: week.statusLabel || "No data yet",
    message:
      week.message || "No completed or missed tasks recorded for this week yet.",
  }));
}

function serializeSummary(userRecord, summarySnap) {
  const summary = summarySnap.exists ? summarySnap.data() || {} : null;
  const day1To6 = serializeWindow(summary?.day1To6);
  const day7To12 = serializeWindow(summary?.day7To12);
  const totals = serializeWindow(summary?.totals);
  const delta = toNumber(summary?.delta);
  const trend = summary?.trend || "not_enough_data";

  return {
    uid: userRecord.uid,
    email: userRecord.email || "",
    displayName: userRecord.displayName || "",
    hasSummary: Boolean(summary),
    summaryVersion: toNumber(summary?.summaryVersion, 0),
    source: summary?.source || "",
    generatedAt: toIso(summary?.generatedAt),
    startDate: summary?.startDate || null,
    endDate: summary?.endDate || null,
    observedDayCount: toNumber(summary?.observedDayCount, 0),
    day1To6,
    day7To12,
    weeklyProgress: serializeWeeklyProgress(summary?.weeklyProgress),
    totals,
    delta,
    trend,
    trendLabel: summary?.trendLabel || "No summary yet",
    deltaExplanation: getDeltaExplanation(delta, day1To6, day7To12, trend),
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

async function listUserRecords(limit) {
  const userList = await admin.auth().listUsers(limit);
  return userList.users;
}

async function getUserRecordsByUid(uids) {
  const users = [];

  for (const uid of uids) {
    try {
      users.push(await admin.auth().getUser(uid));
    } catch (error) {
      if (error?.code === "auth/user-not-found") continue;
      throw error;
    }
  }

  return users;
}

async function readUserSummaries(userRecords) {
  const db = getAdminDb();
  const summarySnaps = await Promise.all(
    userRecords.map((userRecord) =>
      db.doc(`users/${userRecord.uid}/analytics/${SUMMARY_DOC_ID}`).get()
    )
  );

  return userRecords
    .map((userRecord, index) => serializeSummary(userRecord, summarySnaps[index]))
    .sort((left, right) => {
      if (right.totals.total !== left.totals.total) {
        return right.totals.total - left.totals.total;
      }

      return String(left.email || left.uid).localeCompare(
        String(right.email || right.uid)
      );
    });
}

function buildTotals(users) {
  const summaryUsers = users.filter((user) => user.hasSummary);
  const totals = users.reduce(
    (summary, user) => {
      summary.totalTasks += user.totals.total;
      summary.completed += user.totals.completed;
      summary.missed += user.totals.missed;
      summary.pending += user.totals.pending;
      summary.improving += user.trend === "improving" ? 1 : 0;
      summary.noImprovement += user.trend === "no_improvement" ? 1 : 0;
      summary.stable += user.trend === "stable" ? 1 : 0;
      summary.notEnoughData += user.trend === "not_enough_data" ? 1 : 0;
      summary.goodDay1To6 +=
        user.day1To6.quality.status === "good_week" ? 1 : 0;
      summary.badDay1To6 += user.day1To6.quality.status === "bad_week" ? 1 : 0;
      summary.goodDay7To12 +=
        user.day7To12.quality.status === "good_week" ? 1 : 0;
      summary.badDay7To12 +=
        user.day7To12.quality.status === "bad_week" ? 1 : 0;
      return summary;
    },
    {
      userCount: users.length,
      withSummary: summaryUsers.length,
      missingSummary: users.length - summaryUsers.length,
      totalTasks: 0,
      completed: 0,
      missed: 0,
      pending: 0,
      improving: 0,
      noImprovement: 0,
      stable: 0,
      notEnoughData: 0,
      goodDay1To6: 0,
      badDay1To6: 0,
      goodDay7To12: 0,
      badDay7To12: 0,
    }
  );

  totals.averageDay1To6CompletionRate = average(
    summaryUsers.map((user) => user.day1To6.completionRate)
  );
  totals.averageDay7To12CompletionRate = average(
    summaryUsers.map((user) => user.day7To12.completionRate)
  );
  totals.averageDelta = average(summaryUsers.map((user) => user.delta));
  totals.estimatedFirestoreReads = users.length;

  return totals;
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
    const userRecords =
      requestedUids.length > 0
        ? await getUserRecordsByUid(requestedUids)
        : await listUserRecords(limit);
    const users = await readUserSummaries(userRecords);

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      summaryDocument: `users/{uid}/analytics/${SUMMARY_DOC_ID}`,
      readStrategy:
        "Reads one precomputed analytics document per user; it does not scan task or pattern collections.",
      totals: buildTotals(users),
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
      error?.code === "auth/id-token-expired" ||
      error?.code === "auth/argument-error" ||
      String(error?.code || "").startsWith("auth/") ||
      /missing bearer token/i.test(String(error?.message || ""))
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
          "Firestore quota was exceeded while loading analytics summaries. Wait for quota to reset, then try again.",
      });
    }

    console.error("admin user-analytics-summary error:", error);
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Failed to load the admin analytics summary.",
    });
  }
}
