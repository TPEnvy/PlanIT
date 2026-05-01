import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import PageTransition from "../components/PageTransition";
import { useAuth } from "../contexts/AuthContext";

const EMPTY_USERS = [];

const trendStyles = {
  improving: "border-emerald-200 bg-emerald-50 text-emerald-700",
  stable: "border-blue-200 bg-blue-50 text-blue-700",
  no_improvement: "border-red-200 bg-red-50 text-red-700",
  not_enough_data: "border-gray-200 bg-gray-50 text-gray-600",
};

const weekQualityStyles = {
  good_week: "border-emerald-200 bg-emerald-50 text-emerald-700",
  bad_week: "border-red-200 bg-red-50 text-red-700",
  no_data: "border-gray-200 bg-gray-50 text-gray-600",
};

function formatPercent(value) {
  return value == null ? "N/A" : `${value}%`;
}

function formatDelta(value) {
  if (value == null) return "N/A";
  if (value > 0) return `+${value}%`;
  return `${value}%`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function SummaryTile({ label, value, note }) {
  return (
    <div className="min-w-0 rounded-lg border border-emerald-100 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
        {label}
      </div>
      <div className="mt-2 truncate text-2xl font-bold text-gray-900">{value}</div>
      {note && <div className="mt-1 text-xs text-gray-500">{note}</div>}
    </div>
  );
}

function TrendPill({ trend, label }) {
  const classes = trendStyles[trend] || trendStyles.not_enough_data;

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${classes}`}
    >
      {label || "No summary yet"}
    </span>
  );
}

function WeekQualityPill({ quality }) {
  const classes =
    weekQualityStyles[quality?.status] || weekQualityStyles.no_data;

  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-xs font-semibold ${classes}`}
      title={quality?.explanation || ""}
    >
      {quality?.label || "No data"}
    </span>
  );
}

export default function AdminAnalytics() {
  const { user } = useAuth();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAnalytics() {
      if (!user) return;

      setLoading(true);
      setError(null);

      try {
        const idToken = await user.getIdToken();
        const response = await fetch("/api/admin/user-analytics-summary", {
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.message || "Failed to load admin analytics.");
        }

        if (!cancelled) {
          setPayload(data);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || "Failed to load admin analytics.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadAnalytics();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const users = payload?.users || EMPTY_USERS;
  const totals = payload?.totals || {};
  const sortedUsers = useMemo(
    () =>
      [...users].sort((left, right) => {
        if ((right.totals?.total || 0) !== (left.totals?.total || 0)) {
          return (right.totals?.total || 0) - (left.totals?.total || 0);
        }

        return String(left.email || left.uid).localeCompare(
          String(right.email || right.uid)
        );
      }),
    [users]
  );

  return (
    <PageTransition>
      <div className="min-h-screen overflow-x-hidden bg-gradient-to-br from-green-50 to-emerald-500">
        <Navbar />

        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
          <section className="rounded-2xl border border-emerald-100 bg-white/95 p-5 shadow-xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  Admin Analytics
                </p>
                <h1 className="mt-1 text-2xl font-bold text-gray-900">
                  User Completion Window Summary
                </h1>
                <p className="mt-2 max-w-3xl text-sm text-gray-600">
                  This page uses precomputed analytics summaries, so opening it
                  reads one compact document per user instead of reading every
                  task and pattern.
                </p>
              </div>

              <Link
                to="/admin"
                className="inline-flex items-center justify-center rounded-lg border border-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50"
              >
                Full Report
              </Link>
            </div>

            {loading && (
              <div className="mt-6 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                Loading admin analytics...
              </div>
            )}

            {error && (
              <div className="mt-6 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {!loading && !error && (
              <>
                <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <SummaryTile
                    label="Users"
                    value={formatNumber(totals.userCount)}
                    note={`${formatNumber(totals.withSummary)} with summaries`}
                  />
                  <SummaryTile
                    label="Avg Day 1-6"
                    value={formatPercent(totals.averageDay1To6CompletionRate)}
                    note={`${formatNumber(totals.goodDay1To6)} good, ${formatNumber(
                      totals.badDay1To6
                    )} bad`}
                  />
                  <SummaryTile
                    label="Avg Day 7-12"
                    value={formatPercent(totals.averageDay7To12CompletionRate)}
                    note={`${formatNumber(totals.goodDay7To12)} good, ${formatNumber(
                      totals.badDay7To12
                    )} bad`}
                  />
                  <SummaryTile
                    label="Avg Change"
                    value={formatDelta(totals.averageDelta)}
                    note={`${formatNumber(totals.improving)} improving`}
                  />
                  <SummaryTile
                    label="Estimated Reads"
                    value={formatNumber(totals.estimatedFirestoreReads)}
                    note="One summary doc per user"
                  />
                </div>

                <div className="mt-6 overflow-hidden rounded-lg border border-gray-200 bg-white">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        <tr>
                          <th className="px-4 py-3">User</th>
                          <th className="px-4 py-3 text-right">Tasks</th>
                          <th className="px-4 py-3 text-right">Missed</th>
                          <th className="px-4 py-3 text-right">Day 1-6 Avg</th>
                          <th className="px-4 py-3">Day 1-6 Week</th>
                          <th className="px-4 py-3 text-right">Day 7-12 Avg</th>
                          <th className="px-4 py-3">Day 7-12 Week</th>
                          <th className="px-4 py-3 text-right">Change</th>
                          <th className="px-4 py-3">Why</th>
                          <th className="px-4 py-3">Trend</th>
                          <th className="px-4 py-3">Coverage</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {sortedUsers.map((entry) => (
                          <tr key={entry.uid} className="hover:bg-emerald-50/50">
                            <td className="px-4 py-3">
                              <div className="max-w-[260px]">
                                <div className="truncate font-semibold text-gray-900">
                                  {entry.email || entry.displayName || "No email"}
                                </div>
                                <div className="truncate text-xs text-gray-500">
                                  {entry.uid}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-gray-800">
                              {formatNumber(entry.totals?.total)}
                            </td>
                            <td className="px-4 py-3 text-right text-red-600">
                              {formatNumber(entry.totals?.missed)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {formatPercent(entry.day1To6?.completionRate)}
                            </td>
                            <td className="px-4 py-3">
                              <WeekQualityPill quality={entry.day1To6?.quality} />
                            </td>
                            <td className="px-4 py-3 text-right">
                              {formatPercent(entry.day7To12?.completionRate)}
                            </td>
                            <td className="px-4 py-3">
                              <WeekQualityPill quality={entry.day7To12?.quality} />
                            </td>
                            <td className="px-4 py-3 text-right font-semibold">
                              {formatDelta(entry.delta)}
                            </td>
                            <td className="max-w-[260px] px-4 py-3 text-xs leading-5 text-gray-600">
                              {entry.deltaExplanation}
                            </td>
                            <td className="px-4 py-3">
                              <TrendPill
                                trend={entry.trend}
                                label={entry.trendLabel}
                              />
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-600">
                              {entry.startDate && entry.endDate
                                ? `${entry.startDate} to ${entry.endDate}`
                                : "No summary"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {payload?.readStrategy && (
                  <p className="mt-4 text-xs text-gray-500">
                    {payload.readStrategy}
                  </p>
                )}
              </>
            )}
          </section>
        </main>
      </div>
    </PageTransition>
  );
}
