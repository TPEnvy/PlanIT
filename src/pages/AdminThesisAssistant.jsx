import React, { useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import PageTransition from "../components/PageTransition";
import { useAuth } from "../contexts/AuthContext";

const DEFAULT_THESIS_CONTEXT =
  "Objective: To evaluate the performance of an adaptive task management platform in improving task completion, workload regulation, and priority accuracy based on user behavioral data.\n\nStudy setup: The system was evaluated using task history across Day 1-6 and Day 7-12. Day 1-6 represents early-use baseline behavior, while Day 7-12 represents later adaptive-use behavior after the system learned from completion, missed-task patterns, adaptive boost, ML risk, split-task signals, and recovery behavior.";

export default function AdminThesisAssistant() {
  const { user } = useAuth();
  const [thesisContext, setThesisContext] = useState(DEFAULT_THESIS_CONTEXT);
  const [question, setQuestion] = useState(
    "Write the Results and Discussion section for the adaptive task management platform based on the admin analytics."
  );
  const [result, setResult] = useState("");
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const generateDiscussion = async () => {
    if (!user || loading) return;

    setLoading(true);
    setError("");
    setResult("");
    setModel("");

    try {
      const idToken = await user.getIdToken();
      const response = await fetch("/api/admin/thesis-assistant", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          thesisContext,
          question,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || "Failed to generate thesis discussion.");
      }

      setResult(data.text || "");
      setModel(data.model || "");
    } catch (requestError) {
      setError(requestError.message || "Failed to generate thesis discussion.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageTransition>
      <div className="min-h-screen overflow-x-hidden bg-gradient-to-br from-green-50 to-emerald-500">
        <Navbar />

        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
          <section className="rounded-2xl border border-emerald-100 bg-white/95 p-5 shadow-xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  Admin Thesis Assistant
                </p>
                <h1 className="mt-1 text-2xl font-bold text-gray-900">
                  Generate Results and Discussion
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
                  This connects your app to ChatGPT through a server-side OpenAI
                  API call. It uses the low-read admin analytics summaries, so
                  your OpenAI key is not exposed in the browser.
                </p>
              </div>

              <Link
                to="/admin/analytics"
                className="inline-flex items-center justify-center rounded-lg border border-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50"
              >
                View Analytics
              </Link>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="space-y-4">
                <label className="block">
                  <span className="text-sm font-semibold text-gray-800">
                    Thesis paper context
                  </span>
                  <textarea
                    value={thesisContext}
                    onChange={(event) => setThesisContext(event.target.value)}
                    className="mt-2 min-h-[260px] w-full rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm leading-6 text-gray-800 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    placeholder="Paste your thesis objective, methodology, or related context here."
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-semibold text-gray-800">
                    What should ChatGPT write?
                  </span>
                  <textarea
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    className="mt-2 min-h-[120px] w-full rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm leading-6 text-gray-800 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                </label>

                <button
                  type="button"
                  onClick={generateDiscussion}
                  disabled={loading}
                  className="inline-flex w-full items-center justify-center rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {loading ? "Generating..." : "Generate Thesis Discussion"}
                </button>

                {error && (
                  <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-gray-900">
                    ChatGPT Output
                  </h2>
                  {model && (
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs text-gray-500">
                      {model}
                    </span>
                  )}
                </div>

                {result ? (
                  <div className="mt-4 whitespace-pre-wrap rounded-lg bg-white p-4 text-sm leading-7 text-gray-800">
                    {result}
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg border border-dashed border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">
                    Generated thesis text will appear here.
                  </div>
                )}
              </div>
            </div>
          </section>
        </main>
      </div>
    </PageTransition>
  );
}
