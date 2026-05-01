import {
  AdminConfigurationError,
  admin,
  getAdminDb,
  verifyBearerToken,
} from "../_lib/firebaseAdmin.js";

const DEFAULT_USER_LIMIT = 100;
const MAX_USER_LIMIT = 500;
const SUMMARY_DOC_ID = "task-window-summary";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

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

function toNumber(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getCompletionRate(window = {}) {
  return toNumber(window.completionRate);
}

function extractResponseText(payload = {}) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const parts = [];
  for (const output of payload.output || []) {
    for (const content of output.content || []) {
      if (typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }

  return parts.join("\n").trim();
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

function getTrendTotals(rows) {
  return rows.reduce(
    (summary, row) => {
      summary.improving += row.trend === "improving" ? 1 : 0;
      summary.stable += row.trend === "stable" ? 1 : 0;
      summary.noImprovement += row.trend === "no_improvement" ? 1 : 0;
      summary.notEnoughData += row.trend === "not_enough_data" ? 1 : 0;
      return summary;
    },
    {
      improving: 0,
      stable: 0,
      noImprovement: 0,
      notEnoughData: 0,
    }
  );
}

function average(values) {
  const numericValues = values.filter((value) => value != null);
  if (numericValues.length === 0) return null;

  return Number(
    (
      numericValues.reduce((total, value) => total + value, 0) /
      numericValues.length
    ).toFixed(1)
  );
}

async function readAnalyticsRows(limit) {
  const db = getAdminDb();
  const userList = await admin.auth().listUsers(limit);
  const summarySnaps = await Promise.all(
    userList.users.map((userRecord) =>
      db.doc(`users/${userRecord.uid}/analytics/${SUMMARY_DOC_ID}`).get()
    )
  );

  return userList.users
    .map((userRecord, index) => {
      const summary = summarySnaps[index].exists
        ? summarySnaps[index].data() || {}
        : null;

      if (!summary) {
        return null;
      }

      const day1To6 = getCompletionRate(summary.day1To6);
      const day7To12 = getCompletionRate(summary.day7To12);

      return {
        uid: userRecord.uid,
        email: userRecord.email || "",
        day1To6,
        day7To12,
        delta: toNumber(summary.delta),
        trend: summary.trend || "not_enough_data",
        totalTasks: toNumber(summary.totals?.total, 0),
        completed: toNumber(summary.totals?.completed, 0),
        missed: toNumber(summary.totals?.missed, 0),
        day7Missed: toNumber(summary.day7To12?.missed, 0),
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.totalTasks - left.totalTasks);
}

function buildThesisPayload(rows) {
  const trendTotals = getTrendTotals(rows);
  const overall = {
    userCount: rows.length,
    averageDay1To6: average(rows.map((row) => row.day1To6)),
    averageDay7To12: average(rows.map((row) => row.day7To12)),
    averageChange: average(rows.map((row) => row.delta)),
    ...trendTotals,
  };

  return {
    objective:
      "To evaluate the performance of an adaptive task management platform in improving task completion, workload regulation, and priority accuracy based on user behavioral data.",
    overall,
    users: rows.map((row) => ({
      email: row.email,
      uid: row.uid,
      day1To6CompletionRate: row.day1To6,
      day7To12CompletionRate: row.day7To12,
      change: row.delta,
      trend: row.trend,
      totalTasks: row.totalTasks,
      completed: row.completed,
      missed: row.missed,
      day7Missed: row.day7Missed,
    })),
  };
}

async function callOpenAI({ thesisContext, question, analytics }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new HttpError(
      500,
      "OPENAI_NOT_CONFIGURED",
      "Set OPENAI_API_KEY in Railway variables before using the thesis assistant."
    );
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.2";
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions:
        "You are helping write a thesis Results and Discussion section. Use only the supplied analytics data. Do not invent participants, percentages, methods, or findings. Write in formal academic style, concise and clear.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(
                {
                  thesisContext,
                  request: question,
                  analytics,
                  requiredOutput:
                    "Provide a thesis-ready Results subsection, Discussion subsection, and a short note explaining how the evidence supports task completion, workload regulation, and priority accuracy.",
                },
                null,
                2
              ),
            },
          ],
        },
      ],
      max_output_tokens: 1800,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(
      response.status,
      "OPENAI_REQUEST_FAILED",
      payload.error?.message || "OpenAI request failed."
    );
  }

  return {
    model,
    text: extractResponseText(payload),
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
    await assertAdmin(decodedToken);

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
    const rows = await readAnalyticsRows(limit);
    const analytics = buildThesisPayload(rows);
    const thesisContext = String(req.body?.thesisContext || "").slice(0, 6000);
    const question = String(
      req.body?.question ||
        "Write the Results and Discussion for the adaptive task management platform."
    ).slice(0, 1500);
    const generated = await callOpenAI({ thesisContext, question, analytics });

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      analytics,
      model: generated.model,
      text: generated.text,
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
        message: "Log in with an admin account before using the thesis assistant.",
      });
    }

    console.error("admin thesis-assistant error:", error);
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Failed to generate thesis discussion.",
    });
  }
}
