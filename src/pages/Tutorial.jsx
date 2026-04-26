import React from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import PageTransition from "../components/PageTransition";
import { useAuth } from "../contexts/AuthContext";

const tutorialSections = [
  {
    label: "Dashboard",
    title: "Check your progress first",
    image: "/tutorial/dashboard.svg",
    imageAlt:
      "PlanIT dashboard showing total tasks, completed tasks, completion rate, weekly chart, and weekly comparison.",
    description:
      "Use the dashboard to understand how your week is going before you add or adjust tasks.",
    steps: [
      "Open Dashboard from the top navigation.",
      "Review Total Tasks, Completed Tasks, and Completion Rate.",
      "Use Previous week, Current week, and Next week to compare completed and missed tasks.",
      "Check the weekly comparison chart to see whether the week is improving or needs attention.",
    ],
    tip: "Green activity means completed work. Red activity means missed work that may need rescheduling or splitting.",
  },
  {
    label: "Tasks",
    title: "Manage scheduled and flexible work",
    image: "/tutorial/tasks.svg",
    imageAlt:
      "PlanIT tasks page showing a calendar, scheduled and to-do tabs, status filters, and ranked task cards.",
    description:
      "The Tasks page is the main workspace for viewing, filtering, opening, editing, splitting, and deleting tasks.",
    steps: [
      "Select a date on the calendar to focus on scheduled work for that day.",
      "Choose Scheduled for dated tasks or To-Do Tasks for flexible tasks without a date.",
      "Use Pending, All, Completed, and Missed to change which scheduled tasks are visible.",
      "Open a task card to review details, mark it completed, mark it missed, edit it, split it, or delete it.",
    ],
    tip: "A numbered badge appears beside pending scheduled tasks so the highest priority item is easy to spot.",
  },
  {
    label: "Create Task",
    title: "Add a task with the right schedule type",
    image: "/tutorial/create-task.svg",
    imageAlt:
      "PlanIT create task form showing title, scheduled mode, date and time fields, task settings, and create button.",
    description:
      "Create Task lets you choose between fixed scheduled work and flexible to-do work.",
    steps: [
      "Click New task or Add task from the Tasks page.",
      "Enter a clear title so PlanIT can group repeated task patterns more accurately.",
      "Choose Scheduled if the task has a start and end date and time.",
      "Choose To-Do Task if the task does not need a calendar slot.",
      "For scheduled tasks, set urgency, importance, and difficulty before creating the task.",
    ],
    tip: "When you pick a date from the calendar first, the create form can start with that date already selected.",
  },
  {
    label: "Task Detail",
    title: "Finish, miss, edit, or split a task",
    image: "/tutorial/task-detail.svg",
    imageAlt:
      "PlanIT task detail page showing priority score, schedule details, pattern learning, and action buttons.",
    description:
      "Task Detail is where you review the task, track its result, and use learning signals from similar tasks.",
    steps: [
      "Use Mark Completed when the task is done.",
      "Use Mark Missed when the scheduled work was not finished.",
      "Use Edit to adjust the task while it is still pending.",
      "Use Split Task for longer work that should be broken into smaller scheduled segments.",
      "Review Pattern learning to see how repeated task behavior affects recommendations.",
    ],
    tip: "Completing or missing a task updates the dashboard, same-pattern totals, notifications, and future priority behavior.",
  },
];

const quickLinks = [
  {
    title: "Plan your week",
    text: "Start on the dashboard, then move into tasks when you need to act.",
  },
  {
    title: "Create with intent",
    text: "Use scheduled tasks for fixed time blocks and to-do tasks for flexible work.",
  },
  {
    title: "Review outcomes",
    text: "Mark tasks completed or missed so PlanIT can learn from the pattern.",
  },
];

export default function Tutorial() {
  const { user } = useAuth();
  const primaryPath = user ? "/tasks" : "/signup";
  const primaryLabel = user ? "Open Tasks" : "Create Account";

  return (
    <PageTransition>
      <div className="min-h-screen overflow-x-hidden bg-gradient-to-br from-green-50 to-emerald-500">
        <Navbar />

        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <header className="mb-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  Tutorial and documentation
                </p>
                <h1 className="mt-2 text-3xl font-bold text-emerald-900 sm:text-4xl">
                  How to use PlanIT
                </h1>
                <p className="mt-2 max-w-2xl break-words text-sm leading-6 text-slate-700">
                  Follow this guide to move from dashboard review to task
                  creation, daily task management, completion tracking, and
                  long-task splitting.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  to={primaryPath}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-emerald-700"
                >
                  {primaryLabel}
                </Link>
                <Link
                  to={user ? "/dashboard" : "/login"}
                  className="rounded-lg border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-50"
                >
                  {user ? "Open Dashboard" : "Log In"}
                </Link>
              </div>
            </div>
          </header>

          <section className="mb-6 grid gap-3 md:grid-cols-3">
            {quickLinks.map((item) => (
              <div
                key={item.title}
                className="rounded-xl border border-emerald-100 bg-white p-4 shadow"
              >
                <h2 className="text-sm font-semibold text-emerald-800">
                  {item.title}
                </h2>
                <p className="mt-2 break-words text-xs leading-5 text-slate-600">
                  {item.text}
                </p>
              </div>
            ))}
          </section>

          <div className="space-y-6">
            {tutorialSections.map((section, index) => (
              <section
                key={section.title}
                className="min-w-0 overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-xl"
              >
                <div className="grid min-w-0 gap-0 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
                  <figure className="min-w-0 border-b border-emerald-100 bg-emerald-50/70 p-3 lg:border-b-0 lg:border-r">
                    <img
                      src={section.image}
                      alt={section.imageAlt}
                      className="h-auto w-full max-w-full rounded-xl border border-emerald-100 bg-white shadow-sm"
                      loading={index === 0 ? "eager" : "lazy"}
                    />
                  </figure>

                  <div className="min-w-0 p-5 sm:p-6">
                    <div className="mb-4 inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                      Step {index + 1}: {section.label}
                    </div>
                    <h2 className="text-2xl font-bold text-emerald-900">
                      {section.title}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {section.description}
                    </p>

                    <ol className="mt-5 space-y-3">
                      {section.steps.map((step, stepIndex) => (
                        <li key={step} className="flex gap-3 text-sm text-slate-700">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
                            {stepIndex + 1}
                          </span>
                          <span className="leading-6">{step}</span>
                        </li>
                      ))}
                    </ol>

                    <div className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-800">
                      <span className="font-semibold">Tip:</span> {section.tip}
                    </div>
                  </div>
                </div>
              </section>
            ))}
          </div>
        </main>
      </div>
    </PageTransition>
  );
}
