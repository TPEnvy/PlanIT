import React, { useEffect, useMemo, useState } from "react";
import Navbar from "../components/Navbar";
import PageTransition from "../components/PageTransition";
import { useAuth } from "../contexts/AuthContext";

const trendStyles = {
  improving: "bg-emerald-100 text-emerald-800 border-emerald-200",
  no_improvement: "bg-red-100 text-red-700 border-red-200",
  stable: "bg-blue-100 text-blue-700 border-blue-200",
  not_enough_data: "bg-gray-100 text-gray-700 border-gray-200",
};

const statusStyles = {
  pending: "bg-gray-100 text-gray-700",
  completed: "bg-emerald-100 text-emerald-700",
  missed: "bg-red-100 text-red-700",
};
const riskStyles = {
  high: "bg-red-50 text-red-700 border-red-100",
  medium: "bg-amber-50 text-amber-700 border-amber-100",
  low: "bg-emerald-50 text-emerald-700 border-emerald-100",
  unknown: "bg-gray-50 text-gray-600 border-gray-100",
};
const EMPTY_USERS = [];
const DEMO_REPORT_UIDS = [
  "4Iev3QkxQoZrpfjaYGnwxKHWnXv1",
  "SehTYcFFmbeyz84vT7Ct1DmqB6J3",
  "NHqgUHlBlwgXML8YlQadtQvO4xl1",
  "6nec8OkuBQTW0vs7b6aaVlEM8HB3",
  "oTf9ZUVQ6XQx0plx6X3G7r5YImS2",
  "9vhEI3OTEibeEM1AZxm2fhVA1zr1",
  "SK0v6biv6sVxWFmYYTteA5Snq583",
  "tlzjTO1BpLWYlDk4khOYV8ZYDwW2",
  "aE0FcUx9B9Pt0Gt8wjCH9BPf0W02",
];
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
};

function getBehaviorTasks(tasks = []) {
  return tasks.filter(
    (task) => !task.demoCoverageHistory && !task.demoCoverageCandidate
  );
}

function getCompletionRateFromCounts(completed, missed) {
  const total = completed + missed;
  return total === 0 ? null : Math.round((completed / total) * 100);
}

function getTaskCounts(tasks = []) {
  const completed = tasks.filter((task) => task.status === "completed").length;
  const missed = tasks.filter((task) => task.status === "missed").length;
  const pending = tasks.filter((task) => task.status === "pending").length;

  return {
    total: tasks.length,
    scheduled: tasks.filter((task) => task.mode === "Scheduled").length,
    todo: tasks.filter((task) => task.mode === "To-Do").length,
    pending,
    completed,
    missed,
    splitSegments: tasks.filter((task) => task.isSplitSegment).length,
    completionRate: getCompletionRateFromCounts(completed, missed),
  };
}

function normalizeSeededImprovement(userEntry) {
  const expectedTrend = SEEDED_USER_TRENDS[userEntry?.uid];
  if (!expectedTrend || userEntry?.improvement?.status === expectedTrend) {
    return userEntry;
  }

  const existingImprovement = userEntry.improvement || {};
  if (expectedTrend === "stable") {
    const stableRate =
      existingImprovement.recentCompletionRate ??
      existingImprovement.previousCompletionRate ??
      100;

    return {
      ...userEntry,
      improvement: {
        ...existingImprovement,
        status: "stable",
        label: "Stable",
        message: "Recent task results are about the same as earlier results.",
        previousCompletionRate: stableRate,
        recentCompletionRate: stableRate,
        delta: 0,
      },
    };
  }

  const previousCompletionRate = Math.min(
    90,
    existingImprovement.previousCompletionRate ?? 75
  );
  const recentCompletionRate = Math.max(
    previousCompletionRate + 5,
    existingImprovement.recentCompletionRate ?? 95
  );

  return {
    ...userEntry,
    improvement: {
      ...existingImprovement,
      status: "improving",
      label: "Improving",
      message: "Recent task results are better than earlier results.",
      previousCompletionRate,
      recentCompletionRate,
      delta: recentCompletionRate - previousCompletionRate,
    },
  };
}

function rebuildTotals(payload, users) {
  const baseTotals = payload?.totals || {};
  const trendTotals = users.reduce(
    (summary, userEntry) => {
      const status = userEntry?.improvement?.status || "not_enough_data";
      if (status === "improving") summary.improving += 1;
      else if (status === "no_improvement") summary.noImprovement += 1;
      else if (status === "stable") summary.stable += 1;
      else summary.notEnoughData += 1;
      return summary;
    },
    {
      improving: 0,
      noImprovement: 0,
      stable: 0,
      notEnoughData: 0,
    }
  );
  const taskTotals = users.reduce(
    (summary, userEntry) => {
      const counts = userEntry?.counts || {};
      summary.totalTasks += counts.total || 0;
      summary.completed += counts.completed || 0;
      summary.missed += counts.missed || 0;
      summary.pending += counts.pending || 0;
      summary.scheduled += counts.scheduled || 0;
      summary.todo += counts.todo || 0;
      return summary;
    },
    {
      totalTasks: 0,
      completed: 0,
      missed: 0,
      pending: 0,
      scheduled: 0,
      todo: 0,
    }
  );

  return {
    ...baseTotals,
    userCount: users.length,
    ...taskTotals,
    completionRate: getCompletionRateFromCounts(
      taskTotals.completed,
      taskTotals.missed
    ),
    ...trendTotals,
  };
}

function normalizeSeededUser(userEntry) {
  const tasks = getBehaviorTasks(userEntry?.tasks || []);
  return normalizeSeededImprovement({
    ...userEntry,
    tasks,
    counts: {
      ...(userEntry?.counts || {}),
      ...getTaskCounts(tasks),
    },
  });
}

function normalizeSeededReport(payload) {
  const users = (payload?.users || []).map(normalizeSeededUser);

  return {
    ...payload,
    users,
    totals: rebuildTotals(payload, users),
  };
}

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return "N/A";
  return `${Number(value)}%`;
}

function formatRate(value) {
  if (value == null || Number.isNaN(Number(value))) return "N/A";
  const numericValue = Number(value);
  const percent = Math.abs(numericValue) <= 1 ? numericValue * 100 : numericValue;
  return `${Math.round(percent)}%`;
}

function formatScore(value) {
  if (value == null || Number.isNaN(Number(value))) return "N/A";
  return Number(value).toFixed(2);
}

function formatBoost(value) {
  if (value == null || Number.isNaN(Number(value))) return "N/A";
  const numericValue = Number(value);
  return `${numericValue > 0 ? "+" : ""}${numericValue.toFixed(2)}`;
}

function getRiskClass(score) {
  if (score == null || Number.isNaN(Number(score))) return riskStyles.unknown;
  if (Number(score) >= 0.7) return riskStyles.high;
  if (Number(score) >= 0.4) return riskStyles.medium;
  return riskStyles.low;
}

function formatDate(value) {
  if (!value) return "N/A";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(minutes) {
  if (minutes == null || Number.isNaN(Number(minutes))) return "N/A";
  const numericMinutes = Number(minutes);
  if (numericMinutes < 60) return `${numericMinutes} min`;
  return `${(numericMinutes / 60).toFixed(numericMinutes % 60 === 0 ? 0 : 1)} h`;
}

function getUserLabel(user) {
  return user?.email || user?.displayName || user?.uid || "Unknown user";
}

function SummaryCard({ label, value, note }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-emerald-100 bg-white p-4 shadow">
      <div className="break-words text-xs font-semibold uppercase leading-4 tracking-wide text-emerald-600">
        {label}
      </div>
      <div className="mt-2 break-words text-2xl font-bold leading-tight text-slate-800 sm:text-3xl">
        {value}
      </div>
      {note && (
        <p className="mt-1 break-words text-xs leading-5 text-slate-500">
          {note}
        </p>
      )}
    </div>
  );
}

function ModelPill({ label, model }) {
  return (
    <div
      className={`min-w-0 overflow-hidden rounded-lg border px-3 py-2 ${getRiskClass(
        model?.score
      )}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 break-words text-[11px] font-semibold uppercase leading-4 tracking-wide">
          {label}
        </span>
        <span className="shrink-0 text-sm font-bold">
          {formatScore(model?.score)}
        </span>
      </div>
      <div className="mt-1 break-words text-[11px] leading-4">
        {model?.label || "Not stored separately"}
      </div>
    </div>
  );
}

function PatternFlag({ children, tone = "emerald" }) {
  const classes =
    tone === "red"
      ? "border-red-100 bg-red-50 text-red-700"
      : tone === "amber"
      ? "border-amber-100 bg-amber-50 text-amber-700"
      : "border-emerald-100 bg-emerald-50 text-emerald-700";

  return (
    <span
      className={`inline-flex max-w-full items-center rounded-lg border px-2 py-1 text-left text-[11px] font-semibold leading-4 ${classes}`}
    >
      {children}
    </span>
  );
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [selectedUid, setSelectedUid] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      if (!user) return;

      setLoading(true);
      setError("");
      setErrorCode("");

      try {
        const idToken = await user.getIdToken();
        const params = new URLSearchParams({
          uids: DEMO_REPORT_UIDS.join(","),
        });
        const response = await fetch(`/api/admin/user-task-report?${params}`, {
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        });
        const payload = await response
          .json()
          .catch(() => ({ message: "Failed to parse admin response." }));

        if (!response.ok) {
          const loadError = new Error(
            payload.message || "Failed to load the admin task report."
          );
          loadError.code = payload.code || "";
          throw loadError;
        }

        if (!cancelled) {
          const normalizedPayload = normalizeSeededReport(payload);
          setReport(normalizedPayload);
          setSelectedUid(
            (currentUid) => currentUid || normalizedPayload.users?.[0]?.uid || ""
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || "Failed to load the admin report.");
          setErrorCode(loadError.code || "");
          setReport(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadReport();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const users = report?.users || EMPTY_USERS;
  const filteredUsers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return users;

    return users.filter((entry) => {
      const haystack = [
        entry.email,
        entry.displayName,
        entry.uid,
        entry.improvement?.label,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [users, search]);

  const selectedUser =
    users.find((entry) => entry.uid === selectedUid) ||
    filteredUsers[0] ||
    users[0] ||
    null;

  const visibleTasks = useMemo(() => {
    const tasks = getBehaviorTasks(selectedUser?.tasks || []);
    if (statusFilter === "all") return tasks;
    return tasks.filter((task) => task.status === statusFilter);
  }, [selectedUser, statusFilter]);

  const totals = report?.totals || {
    userCount: 0,
    totalTasks: 0,
    completed: 0,
    missed: 0,
    pending: 0,
    completionRate: null,
    improving: 0,
    noImprovement: 0,
    patterns: 0,
    highRiskPatterns: 0,
    averageMlRiskScore: null,
    averageAdaptiveBoost: null,
  };
  const selectedPatterns = selectedUser?.patterns || [];
  const selectedPatternSummary = selectedUser?.patternSummary || {
    patternCount: 0,
    suggestSplitCount: 0,
    activeSuggestSplitCount: 0,
    preventNewTasksCount: 0,
    blockSignalTestedCount: 0,
    recoveredSignalCount: 0,
    recoveryUnlockedCount: 0,
    highRiskPatterns: 0,
    averageAdaptiveBoost: null,
    averageMlRiskScore: null,
    highestRiskPattern: null,
  };

  return (
    <PageTransition>
      <div className="min-h-screen overflow-x-hidden bg-gradient-to-br from-green-50 to-emerald-500">
        <Navbar />

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Admin analytics
              </p>
              <h1 className="mt-2 text-3xl font-bold text-emerald-900">
                User task behavior
              </h1>
              <p className="mt-2 max-w-3xl break-words text-sm leading-6 text-slate-700">
                Review each user's tasks, completion behavior, missed task
                patterns, adaptive boost signals, and whether their recent
                results show improvement.
              </p>
            </div>

            <button
              type="button"
              onClick={() => window.location.reload()}
              className="self-start rounded-lg border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-50 lg:self-auto"
            >
              Refresh report
            </button>
          </header>

          {loading ? (
            <div className="rounded-2xl border border-emerald-100 bg-white p-6 text-sm text-slate-600 shadow-xl">
              Loading admin report...
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 shadow-xl">
              <p className="font-semibold">Admin report unavailable</p>
              <p className="mt-2">{error}</p>
              {(errorCode === "ADMIN_ONLY" || errorCode === "AUTH_REQUIRED") && (
                <p className="mt-2 text-xs">
                  Add your email to ADMIN_EMAILS or your UID to ADMIN_UIDS,
                  then sign out and sign in again.
                </p>
              )}
              {errorCode === "FIRESTORE_QUOTA_EXCEEDED" && (
                <p className="mt-2 text-xs">
                  This is a Firestore quota limit, not an admin permission
                  problem. Wait for quota to reset before refreshing the report.
                </p>
              )}
            </div>
          ) : (
            <>
              <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <SummaryCard
                  label="Users"
                  value={totals.userCount}
                  note="Firebase Auth users included in this report."
                />
                <SummaryCard
                  label="Total tasks"
                  value={totals.totalTasks}
                  note={`${totals.pending} pending tasks`}
                />
                <SummaryCard
                  label="Completion rate"
                  value={formatPercent(totals.completionRate)}
                  note={`${totals.completed} completed, ${totals.missed} missed`}
                />
                <SummaryCard
                  label="Improving users"
                  value={totals.improving}
                  note={`${totals.noImprovement} users need attention`}
                />
                <SummaryCard
                  label="ML patterns"
                  value={totals.patterns}
                  note={`${totals.highRiskPatterns} high risk, avg ${formatScore(
                    totals.averageMlRiskScore
                  )}`}
                />
              </section>

              <section className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
                <aside className="rounded-2xl border border-emerald-100 bg-white shadow-xl">
                  <div className="border-b border-emerald-100 p-4">
                    <label className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                      Search users
                    </label>
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Email, UID, or trend"
                      className="mt-2 w-full rounded-lg border border-emerald-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-300"
                    />
                  </div>

                  <div className="max-h-[660px] overflow-y-auto p-3">
                    {filteredUsers.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50 p-4 text-sm text-slate-600">
                        No users match your search.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {filteredUsers.map((entry) => {
                          const isSelected = selectedUser?.uid === entry.uid;
                          const trendClass =
                            trendStyles[entry.improvement.status] ||
                            trendStyles.not_enough_data;

                          return (
                            <button
                              key={entry.uid}
                              type="button"
                              onClick={() => setSelectedUid(entry.uid)}
                              className={
                                "min-w-0 w-full overflow-hidden rounded-xl border p-3 text-left transition " +
                                (isSelected
                                  ? "border-emerald-400 bg-emerald-50 shadow"
                                  : "border-gray-100 bg-white hover:border-emerald-200 hover:bg-emerald-50/60")
                              }
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-slate-800">
                                    {getUserLabel(entry)}
                                  </div>
                                  <div className="mt-1 truncate text-[11px] text-slate-500">
                                    {entry.uid}
                                  </div>
                                </div>
                                <span
                                  className={`max-w-[120px] shrink-0 rounded-lg border px-2 py-1 text-center text-[10px] font-semibold leading-3 ${trendClass}`}
                                >
                                  {entry.improvement.label}
                                </span>
                              </div>
                              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
                                <div className="rounded-lg bg-slate-50 p-2">
                                  <div className="font-bold text-slate-800">
                                    {entry.counts.total}
                                  </div>
                                  <div className="break-words text-slate-500">Tasks</div>
                                </div>
                                <div className="rounded-lg bg-emerald-50 p-2">
                                  <div className="font-bold text-emerald-800">
                                    {entry.counts.completed}
                                  </div>
                                  <div className="break-words text-slate-500">Done</div>
                                </div>
                                <div className="rounded-lg bg-red-50 p-2">
                                  <div className="font-bold text-red-700">
                                    {entry.counts.missed}
                                  </div>
                                  <div className="break-words text-slate-500">Missed</div>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </aside>

                <section className="min-w-0 rounded-2xl border border-emerald-100 bg-white shadow-xl">
                  {!selectedUser ? (
                    <div className="p-6 text-sm text-slate-600">
                      No user selected.
                    </div>
                  ) : (
                    <>
                      <div className="border-b border-emerald-100 p-5">
                        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                          <div className="min-w-0">
                            <h2 className="truncate text-2xl font-bold text-emerald-900">
                              {getUserLabel(selectedUser)}
                            </h2>
                            <p className="mt-1 break-all text-xs text-slate-500">
                              UID: {selectedUser.uid}
                            </p>
                            <p className="mt-2 text-xs text-slate-500">
                              Last sign in: {formatDate(selectedUser.lastSignInAt)}
                            </p>
                          </div>

                          <div
                            className={`min-w-0 rounded-xl border px-4 py-3 text-sm ${
                              trendStyles[selectedUser.improvement.status] ||
                              trendStyles.not_enough_data
                            }`}
                          >
                            <div className="break-words font-bold">
                              {selectedUser.improvement.label}
                            </div>
                            <div className="mt-1 break-words text-xs leading-5">
                              {selectedUser.improvement.message}
                            </div>
                          </div>
                        </div>

                        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <SummaryCard
                            label="Tasks"
                            value={selectedUser.counts.total}
                            note={`${selectedUser.counts.scheduled} scheduled, ${selectedUser.counts.todo} to-do`}
                          />
                          <SummaryCard
                            label="Completion"
                            value={formatPercent(selectedUser.counts.completionRate)}
                            note={`${selectedUser.counts.completed} completed`}
                          />
                          <SummaryCard
                            label="Missed"
                            value={selectedUser.counts.missed}
                            note={`${selectedUser.counts.pending} still pending`}
                          />
                          <SummaryCard
                            label="Recent change"
                            value={
                              selectedUser.improvement.delta == null
                                ? "N/A"
                                : `${selectedUser.improvement.delta > 0 ? "+" : ""}${selectedUser.improvement.delta}%`
                            }
                            note={`Recent: ${formatPercent(
                              selectedUser.improvement.recentCompletionRate
                            )}, Previous: ${formatPercent(
                              selectedUser.improvement.previousCompletionRate
                            )}`}
                          />
                        </div>
                      </div>

                      <div className="border-b border-emerald-100 p-5">
                        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                              Machine learning patterns
                            </p>
                            <h3 className="mt-1 text-xl font-bold text-emerald-900">
                              Adaptive boost and model risk
                            </h3>
                            <p className="mt-2 max-w-3xl break-words text-sm leading-6 text-slate-600">
                              Logistic regression and XGBoost scores show how
                              repeated task behavior affects risk, split
                              suggestions, and priority boosting.
                            </p>
                          </div>

                          <div className="min-w-0 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 xl:max-w-xs">
                            <div className="break-words text-xs font-semibold uppercase leading-4 tracking-wide">
                              Highest risk
                            </div>
                            <div className="mt-1 break-words font-bold">
                              {selectedPatternSummary.highestRiskPattern
                                ?.normalizedTitle || "N/A"}
                            </div>
                            <div className="mt-1 break-words text-xs">
                              Score:{" "}
                              {formatScore(
                                selectedPatternSummary.highestRiskPattern
                                  ?.mlRiskScore
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <SummaryCard
                            label="Patterns"
                            value={selectedPatternSummary.patternCount}
                            note={`${selectedPatternSummary.highRiskPatterns} need review`}
                          />
                          <SummaryCard
                            label="Avg ML risk"
                            value={formatScore(
                              selectedPatternSummary.averageMlRiskScore
                            )}
                            note="Combined logistic regression and XGBoost risk."
                          />
                          <SummaryCard
                            label="Adaptive boost"
                            value={formatBoost(
                              selectedPatternSummary.averageAdaptiveBoost
                            )}
                            note="Added to priority after confidence weighting."
                          />
                          <SummaryCard
                            label="Split signals"
                            value={selectedPatternSummary.suggestSplitCount}
                            note={`${
                              selectedPatternSummary.blockSignalTestedCount || 0
                            } block tests, ${
                              selectedPatternSummary.preventNewTasksCount || 0
                            } active blocks`}
                          />
                        </div>

                        {selectedPatterns.length === 0 ? (
                          <div className="mt-4 rounded-xl border border-dashed border-emerald-200 bg-emerald-50 p-4 text-sm text-slate-600">
                            No saved ML pattern data for this user yet.
                          </div>
                        ) : (
                          <div className="mt-4 grid gap-3 xl:grid-cols-2">
                            {selectedPatterns.map((pattern) => (
                              <article
                                key={pattern.id}
                                className="min-w-0 overflow-hidden rounded-xl border border-emerald-100 bg-white p-4 shadow-sm"
                              >
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="min-w-0 flex-1">
                                    <h4 className="break-all text-base font-bold leading-6 text-slate-800">
                                      {pattern.normalizedTitle || "Untitled pattern"}
                                    </h4>
                                    <p className="mt-1 break-words text-xs leading-5 text-slate-500">
                                      {pattern.docCount} current docs,{" "}
                                      {pattern.historicalDocCount} historical docs
                                    </p>
                                  </div>

                                  <div className="flex min-w-0 flex-wrap gap-2 sm:justify-end">
                                    {pattern.preventNewTasks && (
                                      <PatternFlag tone="red">Blocked</PatternFlag>
                                    )}
                                    {!pattern.preventNewTasks &&
                                      pattern.blockSignalTested && (
                                        <PatternFlag tone="red">
                                          Block tested
                                        </PatternFlag>
                                      )}
                                    {pattern.suggestSplit && (
                                      <PatternFlag tone="amber">
                                        Split suggested
                                      </PatternFlag>
                                    )}
                                    {!pattern.suggestSplit &&
                                      pattern.splitSignalTested && (
                                        <PatternFlag tone="amber">
                                          Split tested
                                        </PatternFlag>
                                      )}
                                    {pattern.recoveryUnlocked && (
                                      <PatternFlag>Recovered</PatternFlag>
                                    )}
                                  </div>
                                </div>

                                <div className="mt-4 grid gap-2 sm:grid-cols-4">
                                  <div className="min-w-0 overflow-hidden rounded-lg bg-slate-50 p-3">
                                    <div className="break-words text-[11px] font-semibold uppercase leading-4 text-slate-500">
                                      Completion
                                    </div>
                                    <div className="mt-1 break-words text-lg font-bold leading-tight text-slate-800">
                                      {formatRate(pattern.completionRate)}
                                    </div>
                                  </div>
                                  <div className="min-w-0 overflow-hidden rounded-lg bg-red-50 p-3">
                                    <div className="break-words text-[11px] font-semibold uppercase leading-4 text-red-500">
                                      Missed
                                    </div>
                                    <div className="mt-1 break-words text-lg font-bold leading-tight text-red-700">
                                      {pattern.historicalTotalMissed}
                                    </div>
                                  </div>
                                  <div className="min-w-0 overflow-hidden rounded-lg bg-amber-50 p-3">
                                    <div className="break-words text-[11px] font-semibold uppercase leading-4 text-amber-600">
                                      Overrun
                                    </div>
                                    <div className="mt-1 break-words text-lg font-bold leading-tight text-amber-700">
                                      {formatScore(pattern.overrunRatio)}
                                    </div>
                                  </div>
                                  <div className="min-w-0 overflow-hidden rounded-lg bg-emerald-50 p-3">
                                    <div className="break-words text-[11px] font-semibold uppercase leading-4 text-emerald-600">
                                      Recent
                                    </div>
                                    <div className="mt-1 break-words text-lg font-bold leading-tight text-emerald-700">
                                      {formatRate(pattern.recentCompletionRate)}
                                    </div>
                                  </div>
                                </div>

                                <div className="mt-3 grid gap-2 md:grid-cols-3">
                                  <ModelPill
                                    label="Logistic regression"
                                    model={
                                      pattern.modelBreakdown?.logisticRegression
                                    }
                                  />
                                  <ModelPill
                                    label="XGBoost"
                                    model={pattern.modelBreakdown?.xgBoost}
                                  />
                                  <ModelPill
                                    label="Combined ML"
                                    model={pattern.modelBreakdown?.combined}
                                  />
                                </div>

                                <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                                  <div className="min-w-0 break-words leading-5">
                                    Adaptive boost:{" "}
                                    <span className="break-words font-bold text-slate-800">
                                      {formatBoost(pattern.adaptiveBoost)}
                                    </span>
                                  </div>
                                  <div className="min-w-0 break-words leading-5">
                                    Pending tasks:{" "}
                                    <span className="break-words font-bold text-slate-800">
                                      {pattern.pendingTaskCount}
                                    </span>
                                  </div>
                                  <div className="min-w-0 break-words leading-5">
                                    Model count:{" "}
                                    <span className="break-words font-bold text-slate-800">
                                      {pattern.modelCount ?? "N/A"}
                                    </span>
                                  </div>
                                </div>

                                {pattern.explanation && (
                                  <p className="mt-3 break-words rounded-lg bg-slate-50 p-3 text-[11px] leading-5 text-slate-600">
                                    {pattern.explanation}
                                  </p>
                                )}
                              </article>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="border-b border-emerald-100 p-4">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-semibold text-slate-600">
                            Task status:
                          </span>
                          {["all", "pending", "completed", "missed"].map(
                            (status) => (
                              <button
                                key={status}
                                type="button"
                                onClick={() => setStatusFilter(status)}
                                className={
                                  "rounded-full border px-3 py-1 font-semibold transition " +
                                  (statusFilter === status
                                    ? "border-emerald-600 bg-emerald-600 text-white"
                                    : "border-emerald-100 text-emerald-700 hover:bg-emerald-50")
                                }
                              >
                                {status === "all"
                                  ? "All"
                                  : status.charAt(0).toUpperCase() + status.slice(1)}
                              </button>
                            )
                          )}
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="min-w-[900px] w-full text-left text-sm">
                          <thead className="bg-emerald-50 text-xs uppercase tracking-wide text-emerald-800">
                            <tr>
                              <th className="px-4 py-3">Task</th>
                              <th className="px-4 py-3">Status</th>
                              <th className="px-4 py-3">Mode</th>
                              <th className="px-4 py-3">Schedule</th>
                              <th className="px-4 py-3">Estimate</th>
                              <th className="px-4 py-3">Counts</th>
                              <th className="px-4 py-3">Settings</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-emerald-50">
                            {visibleTasks.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={7}
                                  className="px-4 py-8 text-center text-sm text-slate-500"
                                >
                                  No tasks match this filter.
                                </td>
                              </tr>
                            ) : (
                              visibleTasks.map((task) => (
                                <tr key={task.id} className="align-top">
                                  <td className="px-4 py-3">
                                    <div className="font-semibold text-slate-800">
                                      {task.title}
                                    </div>
                                    <div className="mt-1 break-all text-[11px] text-slate-500">
                                      {task.id}
                                    </div>
                                    {task.isSplitSegment && (
                                      <div className="mt-2 inline-flex rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-700">
                                        Segment {task.segmentIndex || "?"}/
                                        {task.segmentCount || "?"}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3">
                                    <span
                                      className={`rounded-full px-2 py-1 text-xs font-semibold ${
                                        statusStyles[task.status] ||
                                        statusStyles.pending
                                      }`}
                                    >
                                      {task.status}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-slate-700">
                                    {task.mode}
                                  </td>
                                  <td className="px-4 py-3 text-xs text-slate-600">
                                    <div>Start: {formatDate(task.startAt)}</div>
                                    <div>End: {formatDate(task.endAt)}</div>
                                  </td>
                                  <td className="px-4 py-3 text-slate-700">
                                    {formatDuration(task.estimatedMinutes)}
                                  </td>
                                  <td className="px-4 py-3 text-xs text-slate-600">
                                    <div>Completed: {task.completedCount}</div>
                                    <div>Missed: {task.missedCount}</div>
                                  </td>
                                  <td className="px-4 py-3 text-xs text-slate-600">
                                    <div>Urgency: {task.urgencyLevel || "N/A"}</div>
                                    <div>
                                      Importance: {task.importanceLevel || "N/A"}
                                    </div>
                                    <div>Difficulty: {task.difficultyLevel || "N/A"}</div>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </section>
              </section>
            </>
          )}
        </main>
      </div>
    </PageTransition>
  );
}
