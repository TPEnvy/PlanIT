import "dotenv/config";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const DEFAULT_USER_ID = "4Iev3QkxQoZrpfjaYGnwxKHWnXv1";
const SOURCE_TAG = "simulated_april_16_27_improvement_case_study_v1";
const TZ_OFFSET = "+08:00";
const FIRESTORE_ID_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const ML_API_BASE_URL = (process.env.ML_API_URL || process.env.VITE_ML_API_URL || "")
  .trim()
  .replace(/\/$/, "");

const BUSINESS_ADMIN_TASK_TEMPLATES = [
  {
    key: "morning-business-class-prep",
    title: "Morning Business Class Preparation",
    startTime: "06:45",
    endTime: "07:15",
    estimatedMinutes: 30,
    breakMinutes: 0,
    urgencyLevel: "somewhat_urgent",
    importanceLevel: "important",
    difficultyLevel: "easy",
  },
  {
    key: "marketing-management-study",
    title: "Marketing Management Study Block",
    startTime: "09:30",
    endTime: "11:00",
    estimatedMinutes: 90,
    breakMinutes: 15,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: "hard",
  },
  {
    key: "accounting-casework",
    title: "Financial Accounting Casework",
    startTime: "13:30",
    endTime: "15:30",
    estimatedMinutes: 120,
    breakMinutes: 20,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: "medium",
  },
  {
    key: "presentation-review",
    title: "Evening Presentation Review",
    startTime: "20:30",
    endTime: "21:00",
    estimatedMinutes: 30,
    breakMinutes: 0,
    urgencyLevel: "somewhat_urgent",
    importanceLevel: "somewhat_important",
    difficultyLevel: "easy",
  },
];

function studentTask(
  key,
  title,
  startTime,
  endTime,
  estimatedMinutes,
  difficultyLevel = "medium",
  urgencyLevel = "somewhat_urgent",
  importanceLevel = "important",
  breakMinutes = 10
) {
  return {
    key,
    title,
    startTime,
    endTime,
    estimatedMinutes,
    breakMinutes,
    urgencyLevel,
    importanceLevel,
    difficultyLevel,
  };
}

function getBusinessAdminPatternTitle(template) {
  const key = String(template.key || "");

  if (key.includes("accounting")) return "Accounting Practice Set";
  if (key.includes("group-feasibility") || key.includes("group-project") || key.includes("group-meeting")) {
    return "Group Feasibility Study Work";
  }
  if (key.includes("business-law") || key.includes("business-ethics")) {
    return "Business Law and Ethics Review";
  }
  if (key.includes("operations") || key.includes("statistics")) {
    return "Quantitative Methods Problem Set";
  }
  if (key.includes("entrepreneurship")) return "Entrepreneurship Pitch Work";
  if (key.includes("marketing") || key.includes("consumer-behavior")) {
    return "Marketing Coursework Set";
  }
  if (key.includes("canvas") || key.includes("weekly-planner") || key.includes("study-space")) {
    return "Coursework Admin Check";
  }

  return template.title;
}

function applyBusinessAdminPatternTitle(template) {
  return {
    ...template,
    title: getBusinessAdminPatternTitle(template),
  };
}

const REMINDER_NOTIFICATION_CONFIGS = [
  {
    type: "5m",
    title: "Starting Soon",
    flagField: "pushSent5m",
    offsetMs: -300000,
    getScheduledAt: (task) => task.startAtIso,
    getBody: (title) => `"${title}" starts in 5 minutes`,
  },
  {
    type: "start",
    title: "Task Started",
    flagField: "pushSentStart",
    offsetMs: 0,
    getScheduledAt: (task) => task.startAtIso,
    getBody: (title) => `"${title}" is starting now`,
  },
  {
    type: "before_end",
    title: "Task ending soon",
    flagField: "pushSentBeforeEnd",
    offsetMs: -300000,
    getScheduledAt: (task) => task.endAtIso,
    getBody: (title) => `"${title}" ends in 5 minutes`,
  },
  {
    type: "end",
    title: "Task Ended",
    flagField: "pushSentEnd",
    offsetMs: 0,
    getScheduledAt: (task) => task.endAtIso,
    getBody: (title) => `"${title}" has ended`,
  },
];

const BUSINESS_ADMIN_DAY_PLANS = [
  {
    date: "2026-04-16",
    note: "A rough start: the Business Administration student handles class prep but misses heavier course requirements.",
    outcomes: {
      "morning-business-class-prep": { status: "completed", actualMinutes: 33 },
      "marketing-management-study": { status: "missed" },
      "accounting-casework": { status: "missed" },
      "presentation-review": { status: "completed", actualMinutes: 36 },
    },
  },
  {
    date: "2026-04-17",
    note: "Still inconsistent, but one demanding business course task gets finished.",
    outcomes: {
      "morning-business-class-prep": { status: "completed", actualMinutes: 31 },
      "marketing-management-study": { status: "missed" },
      "accounting-casework": { status: "completed", actualMinutes: 145 },
      "presentation-review": { status: "missed" },
    },
  },
  {
    date: "2026-04-18",
    note: "The student begins to settle into a more structured business-school routine.",
    outcomes: {
      "morning-business-class-prep": { status: "completed", actualMinutes: 29 },
      "marketing-management-study": { status: "completed", actualMinutes: 108 },
      "accounting-casework": { status: "missed" },
      "presentation-review": { status: "completed", actualMinutes: 33 },
    },
  },
  {
    date: "2026-04-19",
    note: "Productivity improves, though the evening presentation check is still skipped.",
    outcomes: {
      "morning-business-class-prep": { status: "completed", actualMinutes: 27 },
      "marketing-management-study": { status: "completed", actualMinutes: 104 },
      "accounting-casework": { status: "completed", actualMinutes: 132 },
      "presentation-review": { status: "missed" },
    },
  },
  {
    date: "2026-04-20",
    note: "Coursework becomes more manageable and the student overruns less often on business tasks.",
    outcomes: {
      "morning-business-class-prep": { status: "completed", actualMinutes: 28 },
      "marketing-management-study": { status: "completed", actualMinutes: 100 },
      "accounting-casework": { status: "completed", actualMinutes: 128 },
      "presentation-review": { status: "missed" },
    },
  },
  {
    date: "2026-04-21",
    note: "The student sustains daytime study habits and returns to evening presentation review.",
    outcomes: {
      "morning-business-class-prep": { status: "completed", actualMinutes: 27 },
      "marketing-management-study": { status: "completed", actualMinutes: 98 },
      "accounting-casework": { status: "missed" },
      "presentation-review": { status: "completed", actualMinutes: 31 },
    },
  },
  {
    date: "2026-04-22",
    note: "For the first time, every planned Business Administration routine is completed in one day.",
    outcomes: {
      "morning-business-class-prep": { status: "completed", actualMinutes: 28 },
      "marketing-management-study": { status: "completed", actualMinutes: 96 },
      "accounting-casework": { status: "completed", actualMinutes: 126 },
      "presentation-review": { status: "completed", actualMinutes: 30 },
    },
  },
  {
    date: "2026-04-23",
    note: "Task completion remains high and the student follows the business-study schedule more closely.",
    outcomes: {
      "morning-business-class-prep": { status: "completed", actualMinutes: 27 },
      "marketing-management-study": { status: "completed", actualMinutes: 95 },
      "accounting-casework": { status: "completed", actualMinutes: 124 },
      "presentation-review": { status: "completed", actualMinutes: 30 },
    },
  },
  {
    date: "2026-04-24",
    note: "The routine becomes consistent, with most business study blocks finishing nearly on time.",
    outcomes: {
      "morning-business-class-prep": { status: "completed", actualMinutes: 28 },
      "marketing-management-study": { status: "completed", actualMinutes: 92 },
      "accounting-casework": { status: "completed", actualMinutes: 121 },
      "presentation-review": { status: "completed", actualMinutes: 29 },
    },
  },
  {
    date: "2026-04-25",
    note: "The student begins finishing business-school tasks just under the planned estimate.",
    outcomes: {
      "morning-business-class-prep": { status: "completed", actualMinutes: 27 },
      "marketing-management-study": { status: "completed", actualMinutes: 90 },
      "accounting-casework": { status: "completed", actualMinutes: 119 },
      "presentation-review": { status: "completed", actualMinutes: 29 },
    },
  },
  {
    date: "2026-04-26",
    note: "Steady progress continues as the student completes business requirements more efficiently.",
    outcomes: {
      "morning-business-class-prep": { status: "completed", actualMinutes: 26 },
      "marketing-management-study": { status: "completed", actualMinutes: 89 },
      "accounting-casework": { status: "completed", actualMinutes: 118 },
      "presentation-review": { status: "completed", actualMinutes: 28 },
    },
  },
  {
    date: "2026-04-27",
    note: "The final day shows the strongest Business Administration routine and the lowest overrun.",
    outcomes: {
      "morning-business-class-prep": { status: "completed", actualMinutes: 26 },
      "marketing-management-study": { status: "completed", actualMinutes: 87 },
      "accounting-casework": { status: "completed", actualMinutes: 116 },
      "presentation-review": { status: "completed", actualMinutes: 28 },
    },
  },
];

const REALISTIC_BUSINESS_ADMIN_STUDENT_DAY_PLANS = [
  {
    date: "2026-04-16",
    note: "A rough day balancing accounting practice and a marketing case reading.",
    taskTemplates: [
      studentTask("accounting-problem-set-1", "Financial Accounting Problem Set 1", "08:30", "10:00", 90, "hard", "urgent"),
      studentTask("marketing-case-reading-jollibee", "Marketing Management Case Reading: Jollibee", "10:30", "11:30", 60, "medium"),
      studentTask("business-law-notes-contracts", "Business Law Reading Notes: Contracts", "14:00", "15:00", 60, "medium"),
      studentTask("group-feasibility-outline", "Group Feasibility Study Outline", "19:00", "20:00", 60, "hard", "urgent"),
    ],
    outcomes: {
      "accounting-problem-set-1": { status: "missed" },
      "marketing-case-reading-jollibee": { status: "completed", actualMinutes: 72 },
      "business-law-notes-contracts": { status: "completed", actualMinutes: 68 },
      "group-feasibility-outline": { status: "missed" },
    },
  },
  {
    date: "2026-04-17",
    note: "She catches up on accounting but skips operations quiz prep.",
    taskTemplates: [
      studentTask("accounting-problem-set-1-catchup", "Financial Accounting Problem Set 1 Catch-up", "08:00", "09:30", 90, "hard", "urgent"),
      studentTask("operations-quiz-prep", "Operations Management Quiz Prep", "10:00", "11:00", 60, "medium", "urgent"),
      studentTask("consumer-behavior-notes", "Consumer Behavior Research Notes", "13:30", "14:30", 60, "medium"),
      studentTask("group-feasibility-survey", "Group Feasibility Study Survey Questions", "18:30", "19:30", 60, "hard"),
    ],
    outcomes: {
      "accounting-problem-set-1-catchup": { status: "completed", actualMinutes: 108 },
      "operations-quiz-prep": { status: "missed" },
      "consumer-behavior-notes": { status: "completed", actualMinutes: 65 },
      "group-feasibility-survey": { status: "missed" },
    },
  },
  {
    date: "2026-04-18",
    note: "Study blocks improve, though the group project still runs long.",
    taskTemplates: [
      studentTask("marketing-case-reading-nike", "Marketing Management Case Reading: Nike", "09:00", "10:00", 60, "medium"),
      studentTask("accounting-adjusting-entries", "Accounting Adjusting Entries Practice", "10:30", "12:00", 90, "hard", "urgent"),
      studentTask("business-law-recite-prep", "Business Law Recitation Prep", "14:00", "15:00", 60, "medium", "urgent"),
      studentTask("group-feasibility-market-analysis", "Group Feasibility Study Market Analysis", "19:00", "20:30", 90, "hard"),
    ],
    outcomes: {
      "marketing-case-reading-nike": { status: "completed", actualMinutes: 66 },
      "accounting-adjusting-entries": { status: "completed", actualMinutes: 112 },
      "business-law-recite-prep": { status: "completed", actualMinutes: 63 },
      "group-feasibility-market-analysis": { status: "missed" },
    },
  },
  {
    date: "2026-04-19",
    note: "The student focuses on entrepreneurship and a short marketing presentation task.",
    taskTemplates: [
      studentTask("entrepreneurship-pitch-problem", "Entrepreneurship Pitch: Problem Statement", "08:30", "09:30", 60, "medium"),
      studentTask("marketing-presentation-slides", "Marketing Presentation Slides: Target Market", "10:00", "11:00", 60, "medium", "urgent"),
      studentTask("statistics-demand-forecasting", "Business Statistics Demand Forecasting Exercises", "13:30", "15:00", 90, "hard"),
      studentTask("weekly-reading-summary", "Weekly Business Reading Summary", "18:00", "18:45", 45, "easy"),
    ],
    outcomes: {
      "entrepreneurship-pitch-problem": { status: "completed", actualMinutes: 65 },
      "marketing-presentation-slides": { status: "completed", actualMinutes: 70 },
      "statistics-demand-forecasting": { status: "missed" },
      "weekly-reading-summary": { status: "completed", actualMinutes: 48 },
    },
  },
  {
    date: "2026-04-20",
    note: "Accounting and statistics are still demanding, but she completes most planned work.",
    taskTemplates: [
      studentTask("accounting-trial-balance", "Accounting Trial Balance Practice", "08:00", "09:30", 90, "hard", "urgent"),
      studentTask("operations-process-flow", "Operations Process Flow Diagram", "10:00", "11:00", 60, "medium"),
      studentTask("statistics-demand-forecasting-catchup", "Business Statistics Forecasting Catch-up", "14:00", "15:30", 90, "hard"),
      studentTask("group-feasibility-financials", "Group Feasibility Study Basic Financials", "19:00", "20:00", 60, "hard"),
    ],
    outcomes: {
      "accounting-trial-balance": { status: "completed", actualMinutes: 104 },
      "operations-process-flow": { status: "completed", actualMinutes: 61 },
      "statistics-demand-forecasting-catchup": { status: "completed", actualMinutes: 108 },
      "group-feasibility-financials": { status: "missed" },
    },
  },
  {
    date: "2026-04-21",
    note: "The student begins using smaller blocks and finishes the group project section.",
    taskTemplates: [
      studentTask("marketing-stp-notes", "Marketing STP Notes", "08:30", "09:15", 45, "medium"),
      studentTask("accounting-worksheet-practice", "Accounting Worksheet Practice", "10:00", "11:30", 90, "hard", "urgent"),
      studentTask("group-feasibility-financials-revise", "Group Feasibility Study Financials Revision", "14:00", "15:00", 60, "hard"),
      studentTask("business-law-case-digest", "Business Law Case Digest", "18:30", "19:30", 60, "medium"),
    ],
    outcomes: {
      "marketing-stp-notes": { status: "completed", actualMinutes: 47 },
      "accounting-worksheet-practice": { status: "completed", actualMinutes: 96 },
      "group-feasibility-financials-revise": { status: "completed", actualMinutes: 67 },
      "business-law-case-digest": { status: "completed", actualMinutes: 63 },
    },
  },
  {
    date: "2026-04-22",
    note: "Her study routine stabilizes with a mix of review, writing, and project work.",
    taskTemplates: [
      studentTask("operations-quiz-review", "Operations Management Quiz Review", "08:00", "09:00", 60, "medium", "urgent"),
      studentTask("marketing-reflection-paper", "Marketing Reflection Paper Draft", "10:00", "11:00", 60, "medium"),
      studentTask("accounting-ratio-analysis", "Accounting Ratio Analysis Practice", "13:30", "15:00", 90, "hard"),
      studentTask("entrepreneurship-pitch-deck-edits", "Entrepreneurship Pitch Deck Edits", "19:00", "20:00", 60, "medium"),
    ],
    outcomes: {
      "operations-quiz-review": { status: "completed", actualMinutes: 61 },
      "marketing-reflection-paper": { status: "completed", actualMinutes: 62 },
      "accounting-ratio-analysis": { status: "completed", actualMinutes: 95 },
      "entrepreneurship-pitch-deck-edits": { status: "completed", actualMinutes: 64 },
    },
  },
  {
    date: "2026-04-23",
    note: "She keeps coursework realistic: short reading, accounting, and group meeting prep.",
    taskTemplates: [
      studentTask("consumer-behavior-chapter-4", "Consumer Behavior Chapter 4 Notes", "08:30", "09:30", 60, "medium"),
      studentTask("accounting-review-quiz", "Accounting Quiz Review", "10:00", "11:00", 60, "hard", "urgent"),
      studentTask("group-meeting-agenda", "Group Project Meeting Agenda", "13:00", "13:30", 30, "easy"),
      studentTask("business-ethics-forum-post", "Business Ethics Forum Post", "18:30", "19:15", 45, "medium"),
    ],
    outcomes: {
      "consumer-behavior-chapter-4": { status: "completed", actualMinutes: 58 },
      "accounting-review-quiz": { status: "completed", actualMinutes: 64 },
      "group-meeting-agenda": { status: "completed", actualMinutes: 30 },
      "business-ethics-forum-post": { status: "completed", actualMinutes: 46 },
    },
  },
  {
    date: "2026-04-24",
    note: "Major tasks now finish close to estimate.",
    taskTemplates: [
      studentTask("marketing-competitor-matrix", "Marketing Competitor Matrix", "08:30", "09:30", 60, "medium"),
      studentTask("accounting-final-review", "Financial Accounting Final Review", "10:00", "11:30", 90, "hard", "urgent"),
      studentTask("entrepreneurship-pitch-script", "Entrepreneurship Pitch Script", "14:00", "15:00", 60, "medium"),
      studentTask("weekly-planner-cleanup", "Weekly Coursework Planner Cleanup", "18:00", "18:30", 30, "easy"),
    ],
    outcomes: {
      "marketing-competitor-matrix": { status: "completed", actualMinutes: 58 },
      "accounting-final-review": { status: "completed", actualMinutes: 91 },
      "entrepreneurship-pitch-script": { status: "completed", actualMinutes: 61 },
      "weekly-planner-cleanup": { status: "completed", actualMinutes: 28 },
    },
  },
  {
    date: "2026-04-25",
    note: "The day includes realistic admin tasks for school submissions and a group project check.",
    taskTemplates: [
      studentTask("canvas-submission-check", "Canvas Submission Check", "08:00", "08:30", 30, "easy", "urgent"),
      studentTask("business-law-finals-review", "Business Law Finals Review", "09:30", "10:30", 60, "medium"),
      studentTask("group-feasibility-references", "Group Feasibility Study References", "13:00", "14:00", 60, "medium"),
      studentTask("marketing-presentation-rehearsal", "Marketing Presentation Rehearsal", "19:00", "19:45", 45, "medium"),
    ],
    outcomes: {
      "canvas-submission-check": { status: "completed", actualMinutes: 27 },
      "business-law-finals-review": { status: "completed", actualMinutes: 59 },
      "group-feasibility-references": { status: "completed", actualMinutes: 58 },
      "marketing-presentation-rehearsal": { status: "completed", actualMinutes: 43 },
    },
  },
  {
    date: "2026-04-26",
    note: "Her workload becomes balanced across exams, project work, and presentation prep.",
    taskTemplates: [
      studentTask("operations-formula-sheet", "Operations Formula Sheet", "08:30", "09:15", 45, "medium"),
      studentTask("accounting-mock-exam", "Accounting Mock Exam", "10:00", "11:30", 90, "hard", "urgent"),
      studentTask("entrepreneurship-final-deck", "Entrepreneurship Final Deck Polish", "14:00", "15:00", 60, "medium"),
      studentTask("study-space-reset", "Study Space Reset", "18:00", "18:20", 20, "easy"),
    ],
    outcomes: {
      "operations-formula-sheet": { status: "completed", actualMinutes: 43 },
      "accounting-mock-exam": { status: "completed", actualMinutes: 88 },
      "entrepreneurship-final-deck": { status: "completed", actualMinutes: 57 },
      "study-space-reset": { status: "completed", actualMinutes: 18 },
    },
  },
  {
    date: "2026-04-27",
    note: "The final day has a believable mix of review, final checks, and submission prep.",
    taskTemplates: [
      studentTask("marketing-final-review", "Marketing Final Review", "08:30", "09:30", 60, "medium", "urgent"),
      studentTask("accounting-error-check", "Accounting Error Check", "10:00", "11:00", 60, "hard"),
      studentTask("business-law-flashcards", "Business Law Flashcards", "13:00", "13:45", 45, "medium"),
      studentTask("group-project-final-upload", "Group Project Final Upload", "18:30", "19:00", 30, "easy", "urgent"),
    ],
    outcomes: {
      "marketing-final-review": { status: "completed", actualMinutes: 57 },
      "accounting-error-check": { status: "completed", actualMinutes: 58 },
      "business-law-flashcards": { status: "completed", actualMinutes: 42 },
      "group-project-final-upload": { status: "completed", actualMinutes: 25 },
    },
  },
];

const SUBWAY_TEAM_LEADER_TASK_TEMPLATES = [
  {
    key: "opening-shift-checklist",
    title: "Opening Shift Checklist",
    startTime: "06:00",
    endTime: "06:30",
    estimatedMinutes: 30,
    breakMinutes: 0,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: "easy",
  },
  {
    key: "prepare-veggies",
    title: "Prepare Veggies",
    startTime: "07:00",
    endTime: "08:00",
    estimatedMinutes: 60,
    breakMinutes: 10,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: "medium",
  },
  {
    key: "change-bread-labels",
    title: "Change Bread Labels",
    startTime: "09:15",
    endTime: "09:35",
    estimatedMinutes: 20,
    breakMinutes: 0,
    urgencyLevel: "somewhat_urgent",
    importanceLevel: "important",
    difficultyLevel: "easy",
  },
  {
    key: "prepare-cold-meats-hotwell-meats",
    title: "Prepare Cold Meats/ Hotwell Meats",
    startTime: "10:00",
    endTime: "10:45",
    estimatedMinutes: 45,
    breakMinutes: 10,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: "medium",
  },
  {
    key: "prepare-breading-station",
    title: "Prepare Breading Station",
    startTime: "11:30",
    endTime: "12:15",
    estimatedMinutes: 45,
    breakMinutes: 10,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: "medium",
  },
  {
    key: "change-sanitizer-buckets",
    title: "Change Sanitizer Buckets",
    startTime: "14:30",
    endTime: "14:45",
    estimatedMinutes: 15,
    breakMinutes: 0,
    urgencyLevel: "somewhat_urgent",
    importanceLevel: "somewhat_important",
    difficultyLevel: "easy",
  },
];

const SUBWAY_TEAM_LEADER_DAY_PLANS = [
  {
    date: "2026-04-16",
    note: "The team leader finishes opening duties but struggles to keep up with veggies, labels, and breading during a busy Subway shift.",
    outcomes: {
      "opening-shift-checklist": { status: "completed", actualMinutes: 34 },
      "prepare-veggies": { status: "missed" },
      "change-bread-labels": { status: "missed" },
      "prepare-cold-meats-hotwell-meats": {
        status: "completed",
        actualMinutes: 53,
      },
      "prepare-breading-station": { status: "missed" },
      "change-sanitizer-buckets": { status: "completed", actualMinutes: 18 },
    },
  },
  {
    date: "2026-04-17",
    note: "Veggie prep is completed, but label changes and sanitizer replacement are still delayed before the lunch rush.",
    outcomes: {
      "opening-shift-checklist": { status: "completed", actualMinutes: 32 },
      "prepare-veggies": { status: "completed", actualMinutes: 56 },
      "change-bread-labels": { status: "missed" },
      "prepare-cold-meats-hotwell-meats": { status: "missed" },
      "prepare-breading-station": { status: "completed", actualMinutes: 56 },
      "change-sanitizer-buckets": { status: "missed" },
    },
  },
  {
    date: "2026-04-18",
    note: "The Subway shift becomes more organized, and label changes and meat prep start getting done on time.",
    outcomes: {
      "opening-shift-checklist": { status: "completed", actualMinutes: 30 },
      "prepare-veggies": { status: "completed", actualMinutes: 54 },
      "change-bread-labels": { status: "completed", actualMinutes: 24 },
      "prepare-cold-meats-hotwell-meats": {
        status: "completed",
        actualMinutes: 49,
      },
      "prepare-breading-station": { status: "missed" },
      "change-sanitizer-buckets": { status: "completed", actualMinutes: 17 },
    },
  },
  {
    date: "2026-04-19",
    note: "The team leader handles more of the Subway prep flow, though sanitizer replacement is still occasionally skipped.",
    outcomes: {
      "opening-shift-checklist": { status: "completed", actualMinutes: 29 },
      "prepare-veggies": { status: "completed", actualMinutes: 52 },
      "change-bread-labels": { status: "completed", actualMinutes: 23 },
      "prepare-cold-meats-hotwell-meats": {
        status: "completed",
        actualMinutes: 47,
      },
      "prepare-breading-station": { status: "completed", actualMinutes: 49 },
      "change-sanitizer-buckets": { status: "missed" },
    },
  },
  {
    date: "2026-04-20",
    note: "The shift is steadier, with veggie prep, label work, and breading taking less extra time than before.",
    outcomes: {
      "opening-shift-checklist": { status: "completed", actualMinutes: 28 },
      "prepare-veggies": { status: "completed", actualMinutes: 50 },
      "change-bread-labels": { status: "completed", actualMinutes: 22 },
      "prepare-cold-meats-hotwell-meats": {
        status: "completed",
        actualMinutes: 46,
      },
      "prepare-breading-station": { status: "completed", actualMinutes: 47 },
      "change-sanitizer-buckets": { status: "missed" },
    },
  },
  {
    date: "2026-04-21",
    note: "Subway station control improves and the team leader gets back to changing sanitizer buckets while keeping prep flow moving.",
    outcomes: {
      "opening-shift-checklist": { status: "completed", actualMinutes: 28 },
      "prepare-veggies": { status: "completed", actualMinutes: 49 },
      "change-bread-labels": { status: "completed", actualMinutes: 21 },
      "prepare-cold-meats-hotwell-meats": {
        status: "completed",
        actualMinutes: 45,
      },
      "prepare-breading-station": { status: "missed" },
      "change-sanitizer-buckets": { status: "completed", actualMinutes: 15 },
    },
  },
  {
    date: "2026-04-22",
    note: "For the first time, every planned Subway team-leader task is completed in one shift.",
    outcomes: {
      "opening-shift-checklist": { status: "completed", actualMinutes: 27 },
      "prepare-veggies": { status: "completed", actualMinutes: 47 },
      "change-bread-labels": { status: "completed", actualMinutes: 20 },
      "prepare-cold-meats-hotwell-meats": {
        status: "completed",
        actualMinutes: 44,
      },
      "prepare-breading-station": { status: "completed", actualMinutes: 45 },
      "change-sanitizer-buckets": { status: "completed", actualMinutes: 15 },
    },
  },
  {
    date: "2026-04-23",
    note: "Task completion remains strong as the team leader follows the Subway cleaning and prep routine more closely.",
    outcomes: {
      "opening-shift-checklist": { status: "completed", actualMinutes: 26 },
      "prepare-veggies": { status: "completed", actualMinutes: 46 },
      "change-bread-labels": { status: "completed", actualMinutes: 20 },
      "prepare-cold-meats-hotwell-meats": {
        status: "completed",
        actualMinutes: 43,
      },
      "prepare-breading-station": { status: "completed", actualMinutes: 44 },
      "change-sanitizer-buckets": { status: "completed", actualMinutes: 15 },
    },
  },
  {
    date: "2026-04-24",
    note: "The routine becomes consistent, with veggies, label changes, meats, and breading finishing almost exactly on time.",
    outcomes: {
      "opening-shift-checklist": { status: "completed", actualMinutes: 26 },
      "prepare-veggies": { status: "completed", actualMinutes: 45 },
      "change-bread-labels": { status: "completed", actualMinutes: 19 },
      "prepare-cold-meats-hotwell-meats": {
        status: "completed",
        actualMinutes: 42,
      },
      "prepare-breading-station": { status: "completed", actualMinutes: 43 },
      "change-sanitizer-buckets": { status: "completed", actualMinutes: 14 },
    },
  },
  {
    date: "2026-04-25",
    note: "The team leader starts finishing Subway prep tasks just under the planned estimate.",
    outcomes: {
      "opening-shift-checklist": { status: "completed", actualMinutes: 25 },
      "prepare-veggies": { status: "completed", actualMinutes: 44 },
      "change-bread-labels": { status: "completed", actualMinutes: 19 },
      "prepare-cold-meats-hotwell-meats": {
        status: "completed",
        actualMinutes: 41,
      },
      "prepare-breading-station": { status: "completed", actualMinutes: 42 },
      "change-sanitizer-buckets": { status: "completed", actualMinutes: 14 },
    },
  },
  {
    date: "2026-04-26",
    note: "Steady progress continues as the Subway shift tasks are completed more efficiently across the day.",
    outcomes: {
      "opening-shift-checklist": { status: "completed", actualMinutes: 25 },
      "prepare-veggies": { status: "completed", actualMinutes: 44 },
      "change-bread-labels": { status: "completed", actualMinutes: 18 },
      "prepare-cold-meats-hotwell-meats": {
        status: "completed",
        actualMinutes: 40,
      },
      "prepare-breading-station": { status: "completed", actualMinutes: 41 },
      "change-sanitizer-buckets": { status: "completed", actualMinutes: 14 },
    },
  },
  {
    date: "2026-04-27",
    note: "The final day shows the strongest Subway team-leader routine, with veggies, labels, meats, breading, and sanitizer changes all handled smoothly.",
    outcomes: {
      "opening-shift-checklist": { status: "completed", actualMinutes: 24 },
      "prepare-veggies": { status: "completed", actualMinutes: 43 },
      "change-bread-labels": { status: "completed", actualMinutes: 18 },
      "prepare-cold-meats-hotwell-meats": {
        status: "completed",
        actualMinutes: 39,
      },
      "prepare-breading-station": { status: "completed", actualMinutes: 40 },
      "change-sanitizer-buckets": { status: "completed", actualMinutes: 13 },
    },
  },
];

const ASSISTANT_ADMIN_MARKETING_TASK_TEMPLATES = [
  {
    key: "marketing-content-calendar",
    title: "Update Marketing Content Calendar",
    startTime: "08:30",
    endTime: "09:00",
    estimatedMinutes: 30,
    breakMinutes: 0,
    urgencyLevel: "somewhat_urgent",
    importanceLevel: "important",
    difficultyLevel: "easy",
  },
  {
    key: "client-follow-up-emails",
    title: "Client Follow-up Emails",
    startTime: "09:30",
    endTime: "10:15",
    estimatedMinutes: 45,
    breakMinutes: 5,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: "medium",
  },
  {
    key: "campaign-performance-report",
    title: "Campaign Performance Report",
    startTime: "13:00",
    endTime: "14:30",
    estimatedMinutes: 90,
    breakMinutes: 10,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: "hard",
  },
  {
    key: "coordinate-marketing-collaterals",
    title: "Coordinate Marketing Collaterals",
    startTime: "15:30",
    endTime: "16:15",
    estimatedMinutes: 45,
    breakMinutes: 5,
    urgencyLevel: "somewhat_urgent",
    importanceLevel: "important",
    difficultyLevel: "medium",
  },
  {
    key: "meeting-minutes-and-admin-log",
    title: "Meeting Minutes and Admin Log",
    startTime: "17:00",
    endTime: "17:30",
    estimatedMinutes: 30,
    breakMinutes: 0,
    urgencyLevel: "somewhat_urgent",
    importanceLevel: "somewhat_important",
    difficultyLevel: "easy",
  },
];

const ASSISTANT_ADMIN_MARKETING_DAY_PLANS = [
  {
    date: "2026-04-16",
    note: "The assistant admin starts with a busy marketing support day and misses heavier reporting work.",
    outcomes: {
      "marketing-content-calendar": { status: "completed", actualMinutes: 34 },
      "client-follow-up-emails": { status: "missed" },
      "campaign-performance-report": { status: "missed" },
      "coordinate-marketing-collaterals": { status: "completed", actualMinutes: 54 },
      "meeting-minutes-and-admin-log": { status: "completed", actualMinutes: 36 },
    },
  },
  {
    date: "2026-04-17",
    note: "Email follow-ups recover, but the campaign report and collateral coordination are still inconsistent.",
    outcomes: {
      "marketing-content-calendar": { status: "completed", actualMinutes: 32 },
      "client-follow-up-emails": { status: "completed", actualMinutes: 51 },
      "campaign-performance-report": { status: "missed" },
      "coordinate-marketing-collaterals": { status: "missed" },
      "meeting-minutes-and-admin-log": { status: "completed", actualMinutes: 35 },
    },
  },
  {
    date: "2026-04-18",
    note: "The marketing admin routine improves, though the report still takes extra time.",
    outcomes: {
      "marketing-content-calendar": { status: "completed", actualMinutes: 31 },
      "client-follow-up-emails": { status: "completed", actualMinutes: 49 },
      "campaign-performance-report": { status: "completed", actualMinutes: 112 },
      "coordinate-marketing-collaterals": { status: "missed" },
      "meeting-minutes-and-admin-log": { status: "completed", actualMinutes: 33 },
    },
  },
  {
    date: "2026-04-19",
    note: "The assistant admin gets the campaign report done but skips the end-of-day admin log.",
    outcomes: {
      "marketing-content-calendar": { status: "completed", actualMinutes: 30 },
      "client-follow-up-emails": { status: "completed", actualMinutes: 47 },
      "campaign-performance-report": { status: "completed", actualMinutes: 106 },
      "coordinate-marketing-collaterals": { status: "completed", actualMinutes: 51 },
      "meeting-minutes-and-admin-log": { status: "missed" },
    },
  },
  {
    date: "2026-04-20",
    note: "Marketing follow-ups and calendar work become steadier while reporting still runs long.",
    outcomes: {
      "marketing-content-calendar": { status: "completed", actualMinutes: 29 },
      "client-follow-up-emails": { status: "completed", actualMinutes: 46 },
      "campaign-performance-report": { status: "completed", actualMinutes: 101 },
      "coordinate-marketing-collaterals": { status: "completed", actualMinutes: 49 },
      "meeting-minutes-and-admin-log": { status: "missed" },
    },
  },
  {
    date: "2026-04-21",
    note: "A stable marketing support rhythm forms, with only the campaign report slightly overrunning.",
    outcomes: {
      "marketing-content-calendar": { status: "completed", actualMinutes: 28 },
      "client-follow-up-emails": { status: "completed", actualMinutes: 45 },
      "campaign-performance-report": { status: "completed", actualMinutes: 97 },
      "coordinate-marketing-collaterals": { status: "completed", actualMinutes: 47 },
      "meeting-minutes-and-admin-log": { status: "completed", actualMinutes: 31 },
    },
  },
  {
    date: "2026-04-22",
    note: "The assistant admin completes every marketing admin task for the first time.",
    outcomes: {
      "marketing-content-calendar": { status: "completed", actualMinutes: 28 },
      "client-follow-up-emails": { status: "completed", actualMinutes: 44 },
      "campaign-performance-report": { status: "completed", actualMinutes: 94 },
      "coordinate-marketing-collaterals": { status: "completed", actualMinutes: 46 },
      "meeting-minutes-and-admin-log": { status: "completed", actualMinutes: 30 },
    },
  },
  {
    date: "2026-04-23",
    note: "Campaign tracking and client follow-ups stay consistent with fewer delays.",
    outcomes: {
      "marketing-content-calendar": { status: "completed", actualMinutes: 27 },
      "client-follow-up-emails": { status: "completed", actualMinutes: 43 },
      "campaign-performance-report": { status: "completed", actualMinutes: 92 },
      "coordinate-marketing-collaterals": { status: "completed", actualMinutes: 45 },
      "meeting-minutes-and-admin-log": { status: "completed", actualMinutes: 30 },
    },
  },
  {
    date: "2026-04-24",
    note: "The marketing support workflow becomes predictable and the report nearly fits the planned block.",
    outcomes: {
      "marketing-content-calendar": { status: "completed", actualMinutes: 27 },
      "client-follow-up-emails": { status: "completed", actualMinutes: 42 },
      "campaign-performance-report": { status: "completed", actualMinutes: 90 },
      "coordinate-marketing-collaterals": { status: "completed", actualMinutes: 44 },
      "meeting-minutes-and-admin-log": { status: "completed", actualMinutes: 29 },
    },
  },
  {
    date: "2026-04-25",
    note: "The assistant admin now finishes most marketing admin duties within or just under estimate.",
    outcomes: {
      "marketing-content-calendar": { status: "completed", actualMinutes: 26 },
      "client-follow-up-emails": { status: "completed", actualMinutes: 41 },
      "campaign-performance-report": { status: "completed", actualMinutes: 88 },
      "coordinate-marketing-collaterals": { status: "completed", actualMinutes: 43 },
      "meeting-minutes-and-admin-log": { status: "completed", actualMinutes: 29 },
    },
  },
  {
    date: "2026-04-26",
    note: "Marketing admin work remains consistent and the daily handoff is clean.",
    outcomes: {
      "marketing-content-calendar": { status: "completed", actualMinutes: 26 },
      "client-follow-up-emails": { status: "completed", actualMinutes: 40 },
      "campaign-performance-report": { status: "completed", actualMinutes: 87 },
      "coordinate-marketing-collaterals": { status: "completed", actualMinutes: 42 },
      "meeting-minutes-and-admin-log": { status: "completed", actualMinutes: 28 },
    },
  },
  {
    date: "2026-04-27",
    note: "The final simulated day shows a strong assistant-admin marketing routine with low overrun.",
    outcomes: {
      "marketing-content-calendar": { status: "completed", actualMinutes: 25 },
      "client-follow-up-emails": { status: "completed", actualMinutes: 39 },
      "campaign-performance-report": { status: "completed", actualMinutes: 85 },
      "coordinate-marketing-collaterals": { status: "completed", actualMinutes: 41 },
      "meeting-minutes-and-admin-log": { status: "completed", actualMinutes: 28 },
    },
  },
];

const PRE_ELEMENTARY_TUTOR_TASK_TEMPLATES = [
  {
    key: "prepare-phonics-materials",
    title: "Prepare Phonics Materials",
    startTime: "07:30",
    endTime: "08:00",
    estimatedMinutes: 30,
    breakMinutes: 0,
    urgencyLevel: "somewhat_urgent",
    importanceLevel: "important",
    difficultyLevel: "easy",
  },
  {
    key: "guided-reading-session",
    title: "Guided Reading Session",
    startTime: "09:00",
    endTime: "10:00",
    estimatedMinutes: 60,
    breakMinutes: 10,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: "medium",
  },
  {
    key: "early-numeracy-activities",
    title: "Early Numeracy Activities",
    startTime: "10:30",
    endTime: "11:15",
    estimatedMinutes: 45,
    breakMinutes: 10,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: "medium",
  },
  {
    key: "parent-progress-notes",
    title: "Parent Progress Notes",
    startTime: "13:30",
    endTime: "14:15",
    estimatedMinutes: 45,
    breakMinutes: 5,
    urgencyLevel: "somewhat_urgent",
    importanceLevel: "important",
    difficultyLevel: "hard",
  },
  {
    key: "sanitize-learning-materials",
    title: "Sanitize Learning Materials",
    startTime: "15:30",
    endTime: "15:50",
    estimatedMinutes: 20,
    breakMinutes: 0,
    urgencyLevel: "somewhat_urgent",
    importanceLevel: "somewhat_important",
    difficultyLevel: "easy",
  },
];

const PRE_ELEMENTARY_TUTOR_DAY_PLANS = [
  {
    date: "2026-04-16",
    note: "The tutor starts with a full pre-elementary schedule and misses documentation after a busy reading block.",
    outcomes: {
      "prepare-phonics-materials": { status: "completed", actualMinutes: 34 },
      "guided-reading-session": { status: "completed", actualMinutes: 72 },
      "early-numeracy-activities": { status: "missed" },
      "parent-progress-notes": { status: "missed" },
      "sanitize-learning-materials": { status: "completed", actualMinutes: 24 },
    },
  },
  {
    date: "2026-04-17",
    note: "Reading and numeracy improve, but progress notes still fall behind.",
    outcomes: {
      "prepare-phonics-materials": { status: "completed", actualMinutes: 32 },
      "guided-reading-session": { status: "completed", actualMinutes: 69 },
      "early-numeracy-activities": { status: "completed", actualMinutes: 54 },
      "parent-progress-notes": { status: "missed" },
      "sanitize-learning-materials": { status: "missed" },
    },
  },
  {
    date: "2026-04-18",
    note: "The tutor catches up on parent notes but still overruns child-focused learning blocks.",
    outcomes: {
      "prepare-phonics-materials": { status: "completed", actualMinutes: 31 },
      "guided-reading-session": { status: "completed", actualMinutes: 66 },
      "early-numeracy-activities": { status: "completed", actualMinutes: 52 },
      "parent-progress-notes": { status: "completed", actualMinutes: 56 },
      "sanitize-learning-materials": { status: "missed" },
    },
  },
  {
    date: "2026-04-19",
    note: "Pre-elementary routines become steadier, though parent documentation is still occasionally skipped.",
    outcomes: {
      "prepare-phonics-materials": { status: "completed", actualMinutes: 30 },
      "guided-reading-session": { status: "completed", actualMinutes: 64 },
      "early-numeracy-activities": { status: "completed", actualMinutes: 50 },
      "parent-progress-notes": { status: "missed" },
      "sanitize-learning-materials": { status: "completed", actualMinutes: 21 },
    },
  },
  {
    date: "2026-04-20",
    note: "The tutor completes learning blocks more smoothly and starts protecting note-taking time.",
    outcomes: {
      "prepare-phonics-materials": { status: "completed", actualMinutes: 29 },
      "guided-reading-session": { status: "completed", actualMinutes: 62 },
      "early-numeracy-activities": { status: "completed", actualMinutes: 48 },
      "parent-progress-notes": { status: "completed", actualMinutes: 51 },
      "sanitize-learning-materials": { status: "completed", actualMinutes: 20 },
    },
  },
  {
    date: "2026-04-21",
    note: "The routine stabilizes with all tutoring and cleanup tasks completed.",
    outcomes: {
      "prepare-phonics-materials": { status: "completed", actualMinutes: 29 },
      "guided-reading-session": { status: "completed", actualMinutes: 61 },
      "early-numeracy-activities": { status: "completed", actualMinutes: 47 },
      "parent-progress-notes": { status: "completed", actualMinutes: 49 },
      "sanitize-learning-materials": { status: "completed", actualMinutes: 20 },
    },
  },
  {
    date: "2026-04-22",
    note: "The tutor keeps sessions child-centered while finishing parent notes closer to schedule.",
    outcomes: {
      "prepare-phonics-materials": { status: "completed", actualMinutes: 28 },
      "guided-reading-session": { status: "completed", actualMinutes: 60 },
      "early-numeracy-activities": { status: "completed", actualMinutes: 46 },
      "parent-progress-notes": { status: "completed", actualMinutes: 47 },
      "sanitize-learning-materials": { status: "completed", actualMinutes: 19 },
    },
  },
  {
    date: "2026-04-23",
    note: "Phonics prep and numeracy activities now fit the planned routine.",
    outcomes: {
      "prepare-phonics-materials": { status: "completed", actualMinutes: 27 },
      "guided-reading-session": { status: "completed", actualMinutes: 59 },
      "early-numeracy-activities": { status: "completed", actualMinutes: 45 },
      "parent-progress-notes": { status: "completed", actualMinutes: 46 },
      "sanitize-learning-materials": { status: "completed", actualMinutes: 19 },
    },
  },
  {
    date: "2026-04-24",
    note: "The tutor finishes the day with complete records and clean materials.",
    outcomes: {
      "prepare-phonics-materials": { status: "completed", actualMinutes: 27 },
      "guided-reading-session": { status: "completed", actualMinutes: 58 },
      "early-numeracy-activities": { status: "completed", actualMinutes: 44 },
      "parent-progress-notes": { status: "completed", actualMinutes: 45 },
      "sanitize-learning-materials": { status: "completed", actualMinutes: 18 },
    },
  },
  {
    date: "2026-04-25",
    note: "Pre-elementary tutoring tasks are completed efficiently with less overrun.",
    outcomes: {
      "prepare-phonics-materials": { status: "completed", actualMinutes: 26 },
      "guided-reading-session": { status: "completed", actualMinutes: 58 },
      "early-numeracy-activities": { status: "completed", actualMinutes: 43 },
      "parent-progress-notes": { status: "completed", actualMinutes: 44 },
      "sanitize-learning-materials": { status: "completed", actualMinutes: 18 },
    },
  },
  {
    date: "2026-04-26",
    note: "The tutor maintains a strong classroom-prep and parent-feedback rhythm.",
    outcomes: {
      "prepare-phonics-materials": { status: "completed", actualMinutes: 26 },
      "guided-reading-session": { status: "completed", actualMinutes: 57 },
      "early-numeracy-activities": { status: "completed", actualMinutes: 43 },
      "parent-progress-notes": { status: "completed", actualMinutes: 43 },
      "sanitize-learning-materials": { status: "completed", actualMinutes: 18 },
    },
  },
  {
    date: "2026-04-27",
    note: "The final simulated day shows the tutor completing sessions, notes, and cleanup smoothly.",
    outcomes: {
      "prepare-phonics-materials": { status: "completed", actualMinutes: 25 },
      "guided-reading-session": { status: "completed", actualMinutes: 56 },
      "early-numeracy-activities": { status: "completed", actualMinutes: 42 },
      "parent-progress-notes": { status: "completed", actualMinutes: 42 },
      "sanitize-learning-materials": { status: "completed", actualMinutes: 17 },
    },
  },
];

const VIRTUAL_ASSISTANT_TASK_TEMPLATES = [
  {
    key: "morning-inbox-triage",
    title: "Morning Inbox Triage",
    startTime: "08:00",
    endTime: "08:45",
    estimatedMinutes: 45,
    breakMinutes: 5,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: "medium",
  },
  {
    key: "calendar-scheduling-follow-ups",
    title: "Calendar Scheduling Follow-ups",
    startTime: "09:30",
    endTime: "10:15",
    estimatedMinutes: 45,
    breakMinutes: 5,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: "medium",
  },
  {
    key: "crm-data-entry-cleanup",
    title: "CRM Data Entry Cleanup",
    startTime: "11:00",
    endTime: "12:00",
    estimatedMinutes: 60,
    breakMinutes: 10,
    urgencyLevel: "somewhat_urgent",
    importanceLevel: "important",
    difficultyLevel: "hard",
  },
  {
    key: "meeting-brief-preparation",
    title: "Meeting Brief Preparation",
    startTime: "14:00",
    endTime: "15:00",
    estimatedMinutes: 60,
    breakMinutes: 10,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: "hard",
  },
  {
    key: "end-of-day-client-update",
    title: "End-of-day Client Update",
    startTime: "17:00",
    endTime: "17:30",
    estimatedMinutes: 30,
    breakMinutes: 0,
    urgencyLevel: "somewhat_urgent",
    importanceLevel: "important",
    difficultyLevel: "easy",
  },
];

const VIRTUAL_ASSISTANT_DAY_PLANS = [
  {
    date: "2026-04-16",
    note: "The virtual assistant starts with a heavy support queue and misses deeper CRM cleanup and meeting prep.",
    outcomes: {
      "morning-inbox-triage": { status: "completed", actualMinutes: 56 },
      "calendar-scheduling-follow-ups": { status: "missed" },
      "crm-data-entry-cleanup": { status: "missed" },
      "meeting-brief-preparation": { status: "missed" },
      "end-of-day-client-update": { status: "completed", actualMinutes: 38 },
    },
  },
  {
    date: "2026-04-17",
    note: "Calendar follow-ups recover, but CRM cleanup and meeting briefs still slip.",
    outcomes: {
      "morning-inbox-triage": { status: "completed", actualMinutes: 53 },
      "calendar-scheduling-follow-ups": { status: "completed", actualMinutes: 52 },
      "crm-data-entry-cleanup": { status: "missed" },
      "meeting-brief-preparation": { status: "missed" },
      "end-of-day-client-update": { status: "completed", actualMinutes: 36 },
    },
  },
  {
    date: "2026-04-18",
    note: "The assistant completes a first meeting brief, though CRM cleanup remains behind.",
    outcomes: {
      "morning-inbox-triage": { status: "completed", actualMinutes: 51 },
      "calendar-scheduling-follow-ups": { status: "completed", actualMinutes: 50 },
      "crm-data-entry-cleanup": { status: "missed" },
      "meeting-brief-preparation": { status: "completed", actualMinutes: 74 },
      "end-of-day-client-update": { status: "completed", actualMinutes: 35 },
    },
  },
  {
    date: "2026-04-19",
    note: "Client communication stays steady while CRM cleanup finally gets attention.",
    outcomes: {
      "morning-inbox-triage": { status: "completed", actualMinutes: 49 },
      "calendar-scheduling-follow-ups": { status: "completed", actualMinutes: 48 },
      "crm-data-entry-cleanup": { status: "completed", actualMinutes: 78 },
      "meeting-brief-preparation": { status: "missed" },
      "end-of-day-client-update": { status: "completed", actualMinutes: 34 },
    },
  },
  {
    date: "2026-04-20",
    note: "The VA routine improves with all communication tasks completed and less inbox overrun.",
    outcomes: {
      "morning-inbox-triage": { status: "completed", actualMinutes: 48 },
      "calendar-scheduling-follow-ups": { status: "completed", actualMinutes: 47 },
      "crm-data-entry-cleanup": { status: "completed", actualMinutes: 72 },
      "meeting-brief-preparation": { status: "completed", actualMinutes: 68 },
      "end-of-day-client-update": { status: "completed", actualMinutes: 33 },
    },
  },
  {
    date: "2026-04-21",
    note: "The assistant protects time for CRM cleanup and meeting prep.",
    outcomes: {
      "morning-inbox-triage": { status: "completed", actualMinutes: 47 },
      "calendar-scheduling-follow-ups": { status: "completed", actualMinutes: 46 },
      "crm-data-entry-cleanup": { status: "completed", actualMinutes: 68 },
      "meeting-brief-preparation": { status: "completed", actualMinutes: 65 },
      "end-of-day-client-update": { status: "completed", actualMinutes: 32 },
    },
  },
  {
    date: "2026-04-22",
    note: "The virtual assistant completes every support workflow for a second straight day.",
    outcomes: {
      "morning-inbox-triage": { status: "completed", actualMinutes: 46 },
      "calendar-scheduling-follow-ups": { status: "completed", actualMinutes: 45 },
      "crm-data-entry-cleanup": { status: "completed", actualMinutes: 65 },
      "meeting-brief-preparation": { status: "completed", actualMinutes: 63 },
      "end-of-day-client-update": { status: "completed", actualMinutes: 31 },
    },
  },
  {
    date: "2026-04-23",
    note: "Inbox triage and calendar coordination start fitting neatly inside planned blocks.",
    outcomes: {
      "morning-inbox-triage": { status: "completed", actualMinutes: 45 },
      "calendar-scheduling-follow-ups": { status: "completed", actualMinutes: 44 },
      "crm-data-entry-cleanup": { status: "completed", actualMinutes: 63 },
      "meeting-brief-preparation": { status: "completed", actualMinutes: 61 },
      "end-of-day-client-update": { status: "completed", actualMinutes: 30 },
    },
  },
  {
    date: "2026-04-24",
    note: "The VA keeps client-facing updates consistent and reduces CRM cleanup backlog.",
    outcomes: {
      "morning-inbox-triage": { status: "completed", actualMinutes: 44 },
      "calendar-scheduling-follow-ups": { status: "completed", actualMinutes: 43 },
      "crm-data-entry-cleanup": { status: "completed", actualMinutes: 61 },
      "meeting-brief-preparation": { status: "completed", actualMinutes: 60 },
      "end-of-day-client-update": { status: "completed", actualMinutes: 30 },
    },
  },
  {
    date: "2026-04-25",
    note: "Administrative support tasks are now completed close to estimate.",
    outcomes: {
      "morning-inbox-triage": { status: "completed", actualMinutes: 43 },
      "calendar-scheduling-follow-ups": { status: "completed", actualMinutes: 42 },
      "crm-data-entry-cleanup": { status: "completed", actualMinutes: 59 },
      "meeting-brief-preparation": { status: "completed", actualMinutes: 58 },
      "end-of-day-client-update": { status: "completed", actualMinutes: 29 },
    },
  },
  {
    date: "2026-04-26",
    note: "The virtual assistant maintains a reliable daily remote-support rhythm.",
    outcomes: {
      "morning-inbox-triage": { status: "completed", actualMinutes: 42 },
      "calendar-scheduling-follow-ups": { status: "completed", actualMinutes: 42 },
      "crm-data-entry-cleanup": { status: "completed", actualMinutes: 58 },
      "meeting-brief-preparation": { status: "completed", actualMinutes: 57 },
      "end-of-day-client-update": { status: "completed", actualMinutes: 29 },
    },
  },
  {
    date: "2026-04-27",
    note: "The final simulated day shows a smooth virtual assistant workflow with clean handoff notes.",
    outcomes: {
      "morning-inbox-triage": { status: "completed", actualMinutes: 41 },
      "calendar-scheduling-follow-ups": { status: "completed", actualMinutes: 41 },
      "crm-data-entry-cleanup": { status: "completed", actualMinutes: 56 },
      "meeting-brief-preparation": { status: "completed", actualMinutes: 56 },
      "end-of-day-client-update": { status: "completed", actualMinutes: 28 },
    },
  },
];

const MARKETING_ASSOCIATE_TASK_TEMPLATES = [
  {
    key: "social-media-content-draft",
    title: "Social Media Content Draft",
    startTime: "08:30",
    endTime: "09:30",
    estimatedMinutes: 60,
    breakMinutes: 10,
    urgencyLevel: "somewhat_urgent",
    importanceLevel: "important",
    difficultyLevel: "medium",
  },
  {
    key: "campaign-metrics-check",
    title: "Campaign Metrics Check",
    startTime: "10:00",
    endTime: "10:45",
    estimatedMinutes: 45,
    breakMinutes: 5,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: "medium",
  },
  {
    key: "email-newsletter-layout",
    title: "Email Newsletter Layout",
    startTime: "11:30",
    endTime: "12:30",
    estimatedMinutes: 60,
    breakMinutes: 10,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: "hard",
  },
  {
    key: "brand-asset-review",
    title: "Brand Asset Review",
    startTime: "14:00",
    endTime: "14:45",
    estimatedMinutes: 45,
    breakMinutes: 5,
    urgencyLevel: "somewhat_urgent",
    importanceLevel: "important",
    difficultyLevel: "medium",
  },
  {
    key: "community-engagement-replies",
    title: "Community Engagement Replies",
    startTime: "16:30",
    endTime: "17:00",
    estimatedMinutes: 30,
    breakMinutes: 0,
    urgencyLevel: "somewhat_urgent",
    importanceLevel: "somewhat_important",
    difficultyLevel: "easy",
  },
];

const MARKETING_ASSOCIATE_DAY_PLANS = [
  {
    date: "2026-04-16",
    note: "The marketing associate starts with a full content workload and misses newsletter layout.",
    outcomes: {
      "social-media-content-draft": { status: "completed", actualMinutes: 72 },
      "campaign-metrics-check": { status: "missed" },
      "email-newsletter-layout": { status: "missed" },
      "brand-asset-review": { status: "completed", actualMinutes: 54 },
      "community-engagement-replies": { status: "completed", actualMinutes: 36 },
    },
  },
  {
    date: "2026-04-17",
    note: "Metrics checks improve, but newsletter and brand review still compete for afternoon focus.",
    outcomes: {
      "social-media-content-draft": { status: "completed", actualMinutes: 69 },
      "campaign-metrics-check": { status: "completed", actualMinutes: 52 },
      "email-newsletter-layout": { status: "missed" },
      "brand-asset-review": { status: "missed" },
      "community-engagement-replies": { status: "completed", actualMinutes: 35 },
    },
  },
  {
    date: "2026-04-18",
    note: "The associate finishes the newsletter layout for the first time, though it overruns.",
    outcomes: {
      "social-media-content-draft": { status: "completed", actualMinutes: 66 },
      "campaign-metrics-check": { status: "completed", actualMinutes: 50 },
      "email-newsletter-layout": { status: "completed", actualMinutes: 78 },
      "brand-asset-review": { status: "missed" },
      "community-engagement-replies": { status: "completed", actualMinutes: 34 },
    },
  },
  {
    date: "2026-04-19",
    note: "Content drafting and metrics stabilize, but community replies are skipped after a long campaign block.",
    outcomes: {
      "social-media-content-draft": { status: "completed", actualMinutes: 64 },
      "campaign-metrics-check": { status: "completed", actualMinutes: 48 },
      "email-newsletter-layout": { status: "completed", actualMinutes: 73 },
      "brand-asset-review": { status: "completed", actualMinutes: 52 },
      "community-engagement-replies": { status: "missed" },
    },
  },
  {
    date: "2026-04-20",
    note: "The marketing associate finishes all major campaign support work but still runs slightly long.",
    outcomes: {
      "social-media-content-draft": { status: "completed", actualMinutes: 62 },
      "campaign-metrics-check": { status: "completed", actualMinutes: 47 },
      "email-newsletter-layout": { status: "completed", actualMinutes: 69 },
      "brand-asset-review": { status: "completed", actualMinutes: 49 },
      "community-engagement-replies": { status: "completed", actualMinutes: 32 },
    },
  },
  {
    date: "2026-04-21",
    note: "The content workflow becomes steadier and community replies return to schedule.",
    outcomes: {
      "social-media-content-draft": { status: "completed", actualMinutes: 60 },
      "campaign-metrics-check": { status: "completed", actualMinutes: 46 },
      "email-newsletter-layout": { status: "completed", actualMinutes: 66 },
      "brand-asset-review": { status: "completed", actualMinutes: 47 },
      "community-engagement-replies": { status: "completed", actualMinutes: 31 },
    },
  },
  {
    date: "2026-04-22",
    note: "For the first time, every marketing associate task fits close to its planned window.",
    outcomes: {
      "social-media-content-draft": { status: "completed", actualMinutes: 59 },
      "campaign-metrics-check": { status: "completed", actualMinutes: 45 },
      "email-newsletter-layout": { status: "completed", actualMinutes: 64 },
      "brand-asset-review": { status: "completed", actualMinutes: 46 },
      "community-engagement-replies": { status: "completed", actualMinutes: 30 },
    },
  },
  {
    date: "2026-04-23",
    note: "Campaign checks and asset review stay consistent with fewer delays.",
    outcomes: {
      "social-media-content-draft": { status: "completed", actualMinutes: 58 },
      "campaign-metrics-check": { status: "completed", actualMinutes: 44 },
      "email-newsletter-layout": { status: "completed", actualMinutes: 62 },
      "brand-asset-review": { status: "completed", actualMinutes: 45 },
      "community-engagement-replies": { status: "completed", actualMinutes: 30 },
    },
  },
  {
    date: "2026-04-24",
    note: "The associate keeps the marketing calendar moving and reduces newsletter overrun.",
    outcomes: {
      "social-media-content-draft": { status: "completed", actualMinutes: 57 },
      "campaign-metrics-check": { status: "completed", actualMinutes: 43 },
      "email-newsletter-layout": { status: "completed", actualMinutes: 60 },
      "brand-asset-review": { status: "completed", actualMinutes: 44 },
      "community-engagement-replies": { status: "completed", actualMinutes: 29 },
    },
  },
  {
    date: "2026-04-25",
    note: "Campaign support tasks are now completed within or slightly under estimate.",
    outcomes: {
      "social-media-content-draft": { status: "completed", actualMinutes: 56 },
      "campaign-metrics-check": { status: "completed", actualMinutes: 42 },
      "email-newsletter-layout": { status: "completed", actualMinutes: 59 },
      "brand-asset-review": { status: "completed", actualMinutes: 43 },
      "community-engagement-replies": { status: "completed", actualMinutes: 29 },
    },
  },
  {
    date: "2026-04-26",
    note: "The marketing associate sustains a clean content and reporting rhythm.",
    outcomes: {
      "social-media-content-draft": { status: "completed", actualMinutes: 55 },
      "campaign-metrics-check": { status: "completed", actualMinutes: 42 },
      "email-newsletter-layout": { status: "completed", actualMinutes: 58 },
      "brand-asset-review": { status: "completed", actualMinutes: 42 },
      "community-engagement-replies": { status: "completed", actualMinutes: 28 },
    },
  },
  {
    date: "2026-04-27",
    note: "The final simulated day shows a strong marketing associate routine with low overrun.",
    outcomes: {
      "social-media-content-draft": { status: "completed", actualMinutes: 54 },
      "campaign-metrics-check": { status: "completed", actualMinutes: 41 },
      "email-newsletter-layout": { status: "completed", actualMinutes: 57 },
      "brand-asset-review": { status: "completed", actualMinutes: 41 },
      "community-engagement-replies": { status: "completed", actualMinutes: 28 },
    },
  },
];

const IT_ASSOCIATE_TASK_TEMPLATES = [
  {
    key: "service-desk-ticket-triage",
    title: "Service Desk Ticket Triage",
    startTime: "08:30",
    endTime: "09:15",
    estimatedMinutes: 45,
    breakMinutes: 5,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: "medium",
  },
  {
    key: "workstation-setup-requests",
    title: "Workstation Setup Requests",
    startTime: "10:00",
    endTime: "11:00",
    estimatedMinutes: 60,
    breakMinutes: 10,
    urgencyLevel: "somewhat_urgent",
    importanceLevel: "important",
    difficultyLevel: "medium",
  },
  {
    key: "network-connectivity-checks",
    title: "Network Connectivity Checks",
    startTime: "13:00",
    endTime: "13:45",
    estimatedMinutes: 45,
    breakMinutes: 5,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: "medium",
  },
  {
    key: "software-update-deployment",
    title: "Software Update Deployment",
    startTime: "14:30",
    endTime: "15:30",
    estimatedMinutes: 60,
    breakMinutes: 10,
    urgencyLevel: "somewhat_urgent",
    importanceLevel: "important",
    difficultyLevel: "hard",
  },
  {
    key: "it-asset-inventory-update",
    title: "IT Asset Inventory Update",
    startTime: "16:30",
    endTime: "17:00",
    estimatedMinutes: 30,
    breakMinutes: 0,
    urgencyLevel: "somewhat_urgent",
    importanceLevel: "somewhat_important",
    difficultyLevel: "easy",
  },
];

const IT_ASSOCIATE_DAY_PLANS = [
  {
    date: "2026-04-16",
    note: "A normal IT support day with ticket triage, setup work, network checks, patching, and asset updates all completed.",
    outcomes: {
      "service-desk-ticket-triage": { status: "completed", actualMinutes: 46 },
      "workstation-setup-requests": { status: "completed", actualMinutes: 61 },
      "network-connectivity-checks": { status: "completed", actualMinutes: 45 },
      "software-update-deployment": { status: "completed", actualMinutes: 62 },
      "it-asset-inventory-update": { status: "completed", actualMinutes: 30 },
    },
  },
  {
    date: "2026-04-17",
    note: "The associate handles routine support requests with only small timing variance.",
    outcomes: {
      "service-desk-ticket-triage": { status: "completed", actualMinutes: 44 },
      "workstation-setup-requests": { status: "completed", actualMinutes: 59 },
      "network-connectivity-checks": { status: "completed", actualMinutes: 46 },
      "software-update-deployment": { status: "completed", actualMinutes: 60 },
      "it-asset-inventory-update": { status: "completed", actualMinutes: 31 },
    },
  },
  {
    date: "2026-04-18",
    note: "Helpdesk and maintenance work stay predictable across the shift.",
    outcomes: {
      "service-desk-ticket-triage": { status: "completed", actualMinutes: 45 },
      "workstation-setup-requests": { status: "completed", actualMinutes: 60 },
      "network-connectivity-checks": { status: "completed", actualMinutes: 44 },
      "software-update-deployment": { status: "completed", actualMinutes: 61 },
      "it-asset-inventory-update": { status: "completed", actualMinutes: 29 },
    },
  },
  {
    date: "2026-04-19",
    note: "The day has a standard support queue and scheduled maintenance tasks completed on time.",
    outcomes: {
      "service-desk-ticket-triage": { status: "completed", actualMinutes: 47 },
      "workstation-setup-requests": { status: "completed", actualMinutes: 62 },
      "network-connectivity-checks": { status: "completed", actualMinutes: 43 },
      "software-update-deployment": { status: "completed", actualMinutes: 59 },
      "it-asset-inventory-update": { status: "completed", actualMinutes: 30 },
    },
  },
  {
    date: "2026-04-20",
    note: "The associate maintains a steady IT operations cadence.",
    outcomes: {
      "service-desk-ticket-triage": { status: "completed", actualMinutes: 44 },
      "workstation-setup-requests": { status: "completed", actualMinutes: 60 },
      "network-connectivity-checks": { status: "completed", actualMinutes: 45 },
      "software-update-deployment": { status: "completed", actualMinutes: 63 },
      "it-asset-inventory-update": { status: "completed", actualMinutes: 28 },
    },
  },
  {
    date: "2026-04-21",
    note: "Routine endpoint setup and ticket triage remain consistent.",
    outcomes: {
      "service-desk-ticket-triage": { status: "completed", actualMinutes: 46 },
      "workstation-setup-requests": { status: "completed", actualMinutes: 58 },
      "network-connectivity-checks": { status: "completed", actualMinutes: 44 },
      "software-update-deployment": { status: "completed", actualMinutes: 60 },
      "it-asset-inventory-update": { status: "completed", actualMinutes: 31 },
    },
  },
  {
    date: "2026-04-22",
    note: "The support workload stays balanced with completed checks and updates.",
    outcomes: {
      "service-desk-ticket-triage": { status: "completed", actualMinutes: 45 },
      "workstation-setup-requests": { status: "completed", actualMinutes: 61 },
      "network-connectivity-checks": { status: "completed", actualMinutes: 45 },
      "software-update-deployment": { status: "completed", actualMinutes: 61 },
      "it-asset-inventory-update": { status: "completed", actualMinutes: 29 },
    },
  },
  {
    date: "2026-04-23",
    note: "A typical IT associate shift with no backlog or missed maintenance.",
    outcomes: {
      "service-desk-ticket-triage": { status: "completed", actualMinutes: 45 },
      "workstation-setup-requests": { status: "completed", actualMinutes: 60 },
      "network-connectivity-checks": { status: "completed", actualMinutes: 44 },
      "software-update-deployment": { status: "completed", actualMinutes: 62 },
      "it-asset-inventory-update": { status: "completed", actualMinutes: 30 },
    },
  },
  {
    date: "2026-04-24",
    note: "Support and endpoint maintenance continue at a stable pace.",
    outcomes: {
      "service-desk-ticket-triage": { status: "completed", actualMinutes: 46 },
      "workstation-setup-requests": { status: "completed", actualMinutes: 59 },
      "network-connectivity-checks": { status: "completed", actualMinutes: 46 },
      "software-update-deployment": { status: "completed", actualMinutes: 60 },
      "it-asset-inventory-update": { status: "completed", actualMinutes: 30 },
    },
  },
  {
    date: "2026-04-25",
    note: "The associate finishes the standard ticket, workstation, network, deployment, and inventory blocks.",
    outcomes: {
      "service-desk-ticket-triage": { status: "completed", actualMinutes: 44 },
      "workstation-setup-requests": { status: "completed", actualMinutes: 62 },
      "network-connectivity-checks": { status: "completed", actualMinutes: 45 },
      "software-update-deployment": { status: "completed", actualMinutes: 61 },
      "it-asset-inventory-update": { status: "completed", actualMinutes: 31 },
    },
  },
  {
    date: "2026-04-26",
    note: "The workload remains steady, with routine support work completed without escalation.",
    outcomes: {
      "service-desk-ticket-triage": { status: "completed", actualMinutes: 45 },
      "workstation-setup-requests": { status: "completed", actualMinutes: 59 },
      "network-connectivity-checks": { status: "completed", actualMinutes: 44 },
      "software-update-deployment": { status: "completed", actualMinutes: 60 },
      "it-asset-inventory-update": { status: "completed", actualMinutes: 29 },
    },
  },
  {
    date: "2026-04-27",
    note: "Another normal IT support day with stable completion across all planned work.",
    outcomes: {
      "service-desk-ticket-triage": { status: "completed", actualMinutes: 46 },
      "workstation-setup-requests": { status: "completed", actualMinutes: 60 },
      "network-connectivity-checks": { status: "completed", actualMinutes: 45 },
      "software-update-deployment": { status: "completed", actualMinutes: 62 },
      "it-asset-inventory-update": { status: "completed", actualMinutes: 30 },
    },
  },
];

const CUSTOMER_SERVICE_REP_TASK_TEMPLATES = [
  {
    key: "home-morning-reset",
    title: "Home Morning Reset",
    startTime: "06:30",
    endTime: "07:00",
    estimatedMinutes: 30,
    breakMinutes: 0,
    urgencyLevel: "somewhat_urgent",
    importanceLevel: "somewhat_important",
    difficultyLevel: "easy",
  },
  {
    key: "customer-ticket-queue-triage",
    title: "Customer Ticket Queue Triage",
    startTime: "08:30",
    endTime: "09:15",
    estimatedMinutes: 45,
    breakMinutes: 5,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: "medium",
  },
  {
    key: "live-chat-support-block",
    title: "Live Chat Support",
    startTime: "10:00",
    endTime: "11:30",
    estimatedMinutes: 90,
    breakMinutes: 10,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: "medium",
  },
  {
    key: "complaint-follow-up-calls",
    title: "Complaint Follow-up Calls",
    startTime: "13:00",
    endTime: "14:00",
    estimatedMinutes: 60,
    breakMinutes: 10,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: "hard",
  },
  {
    key: "crm-case-notes-endorsements",
    title: "CRM Case Notes and Endorsements",
    startTime: "15:00",
    endTime: "15:45",
    estimatedMinutes: 45,
    breakMinutes: 5,
    urgencyLevel: "somewhat_urgent",
    importanceLevel: "important",
    difficultyLevel: "medium",
  },
  {
    key: "dinner-prep-kitchen-cleanup",
    title: "Dinner Prep and Kitchen Cleanup",
    startTime: "18:30",
    endTime: "19:15",
    estimatedMinutes: 45,
    breakMinutes: 0,
    urgencyLevel: "somewhat_urgent",
    importanceLevel: "somewhat_important",
    difficultyLevel: "easy",
  },
];

const CUSTOMER_SERVICE_REP_DAY_PLANS = [
  {
    date: "2026-04-16",
    note: "A busy customer service day with one complaint follow-up deferred and dinner prep skipped after shift.",
    outcomes: {
      "home-morning-reset": { status: "completed", actualMinutes: 34 },
      "customer-ticket-queue-triage": { status: "completed", actualMinutes: 52 },
      "live-chat-support-block": { status: "completed", actualMinutes: 102 },
      "complaint-follow-up-calls": { status: "missed" },
      "crm-case-notes-endorsements": { status: "completed", actualMinutes: 51 },
      "dinner-prep-kitchen-cleanup": { status: "missed" },
    },
  },
  {
    date: "2026-04-17",
    note: "The queue is handled, but CRM notes are left for the next shift handoff.",
    outcomes: {
      "home-morning-reset": { status: "completed", actualMinutes: 32 },
      "customer-ticket-queue-triage": { status: "completed", actualMinutes: 49 },
      "live-chat-support-block": { status: "completed", actualMinutes: 98 },
      "complaint-follow-up-calls": { status: "completed", actualMinutes: 70 },
      "crm-case-notes-endorsements": { status: "missed" },
      "dinner-prep-kitchen-cleanup": { status: "completed", actualMinutes: 53 },
    },
  },
  {
    date: "2026-04-18",
    note: "A balanced service day with home chores and support blocks completed.",
    outcomes: {
      "home-morning-reset": { status: "completed", actualMinutes: 31 },
      "customer-ticket-queue-triage": { status: "completed", actualMinutes: 47 },
      "live-chat-support-block": { status: "completed", actualMinutes: 95 },
      "complaint-follow-up-calls": { status: "completed", actualMinutes: 66 },
      "crm-case-notes-endorsements": { status: "completed", actualMinutes: 48 },
      "dinner-prep-kitchen-cleanup": { status: "completed", actualMinutes: 50 },
    },
  },
  {
    date: "2026-04-19",
    note: "Work tasks stay on track, while the morning home reset is skipped.",
    outcomes: {
      "home-morning-reset": { status: "missed" },
      "customer-ticket-queue-triage": { status: "completed", actualMinutes: 46 },
      "live-chat-support-block": { status: "completed", actualMinutes: 94 },
      "complaint-follow-up-calls": { status: "completed", actualMinutes: 64 },
      "crm-case-notes-endorsements": { status: "completed", actualMinutes: 47 },
      "dinner-prep-kitchen-cleanup": { status: "completed", actualMinutes: 49 },
    },
  },
  {
    date: "2026-04-20",
    note: "The representative completes the service queue, live chat, case notes, and household routines.",
    outcomes: {
      "home-morning-reset": { status: "completed", actualMinutes: 30 },
      "customer-ticket-queue-triage": { status: "completed", actualMinutes: 45 },
      "live-chat-support-block": { status: "completed", actualMinutes: 92 },
      "complaint-follow-up-calls": { status: "completed", actualMinutes: 63 },
      "crm-case-notes-endorsements": { status: "completed", actualMinutes: 46 },
      "dinner-prep-kitchen-cleanup": { status: "completed", actualMinutes: 48 },
    },
  },
  {
    date: "2026-04-21",
    note: "A difficult customer escalation pushes one follow-up block out of schedule.",
    outcomes: {
      "home-morning-reset": { status: "completed", actualMinutes: 29 },
      "customer-ticket-queue-triage": { status: "completed", actualMinutes: 46 },
      "live-chat-support-block": { status: "completed", actualMinutes: 93 },
      "complaint-follow-up-calls": { status: "missed" },
      "crm-case-notes-endorsements": { status: "completed", actualMinutes: 47 },
      "dinner-prep-kitchen-cleanup": { status: "completed", actualMinutes: 47 },
    },
  },
  {
    date: "2026-04-22",
    note: "The day runs normally across customer support and home routines.",
    outcomes: {
      "home-morning-reset": { status: "completed", actualMinutes: 30 },
      "customer-ticket-queue-triage": { status: "completed", actualMinutes: 44 },
      "live-chat-support-block": { status: "completed", actualMinutes: 91 },
      "complaint-follow-up-calls": { status: "completed", actualMinutes: 61 },
      "crm-case-notes-endorsements": { status: "completed", actualMinutes: 45 },
      "dinner-prep-kitchen-cleanup": { status: "completed", actualMinutes: 46 },
    },
  },
  {
    date: "2026-04-23",
    note: "Support tasks are completed close to estimate, while dinner cleanup is left for the next morning.",
    outcomes: {
      "home-morning-reset": { status: "completed", actualMinutes: 28 },
      "customer-ticket-queue-triage": { status: "completed", actualMinutes: 43 },
      "live-chat-support-block": { status: "completed", actualMinutes: 90 },
      "complaint-follow-up-calls": { status: "completed", actualMinutes: 60 },
      "crm-case-notes-endorsements": { status: "completed", actualMinutes: 44 },
      "dinner-prep-kitchen-cleanup": { status: "missed" },
    },
  },
  {
    date: "2026-04-24",
    note: "A steady service shift, though the morning home reset is skipped before logging in.",
    outcomes: {
      "home-morning-reset": { status: "missed" },
      "customer-ticket-queue-triage": { status: "completed", actualMinutes: 44 },
      "live-chat-support-block": { status: "completed", actualMinutes: 89 },
      "complaint-follow-up-calls": { status: "completed", actualMinutes: 60 },
      "crm-case-notes-endorsements": { status: "completed", actualMinutes: 44 },
      "dinner-prep-kitchen-cleanup": { status: "completed", actualMinutes: 46 },
    },
  },
  {
    date: "2026-04-25",
    note: "The customer queue stays manageable, but CRM endorsements are delayed after shift.",
    outcomes: {
      "home-morning-reset": { status: "completed", actualMinutes: 28 },
      "customer-ticket-queue-triage": { status: "completed", actualMinutes: 42 },
      "live-chat-support-block": { status: "completed", actualMinutes: 88 },
      "complaint-follow-up-calls": { status: "completed", actualMinutes: 59 },
      "crm-case-notes-endorsements": { status: "missed" },
      "dinner-prep-kitchen-cleanup": { status: "completed", actualMinutes: 44 },
    },
  },
  {
    date: "2026-04-26",
    note: "Live chat and follow-ups stay consistent, while the evening kitchen reset is skipped.",
    outcomes: {
      "home-morning-reset": { status: "completed", actualMinutes: 27 },
      "customer-ticket-queue-triage": { status: "completed", actualMinutes: 43 },
      "live-chat-support-block": { status: "completed", actualMinutes: 87 },
      "complaint-follow-up-calls": { status: "completed", actualMinutes: 58 },
      "crm-case-notes-endorsements": { status: "completed", actualMinutes: 43 },
      "dinner-prep-kitchen-cleanup": { status: "missed" },
    },
  },
  {
    date: "2026-04-27",
    note: "The final simulated day is normal but not perfect, with the morning reset skipped.",
    outcomes: {
      "home-morning-reset": { status: "missed" },
      "customer-ticket-queue-triage": { status: "completed", actualMinutes: 42 },
      "live-chat-support-block": { status: "completed", actualMinutes: 86 },
      "complaint-follow-up-calls": { status: "completed", actualMinutes: 58 },
      "crm-case-notes-endorsements": { status: "completed", actualMinutes: 42 },
      "dinner-prep-kitchen-cleanup": { status: "completed", actualMinutes: 42 },
    },
  },
];

const SMALL_FOOD_BUSINESS_TASK_TEMPLATES = [
  {
    key: "market-ingredient-run",
    title: "Market Ingredient Run",
    startTime: "05:30",
    endTime: "06:30",
    estimatedMinutes: 60,
    breakMinutes: 5,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: "medium",
  },
  {
    key: "morning-cooking-prep",
    title: "Morning Cooking Prep",
    startTime: "07:00",
    endTime: "08:30",
    estimatedMinutes: 90,
    breakMinutes: 10,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: "hard",
  },
  {
    key: "packed-lunch-orders",
    title: "Packed Lunch Orders",
    startTime: "10:30",
    endTime: "12:00",
    estimatedMinutes: 90,
    breakMinutes: 10,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: "medium",
  },
  {
    key: "delivery-handoff",
    title: "Delivery Handoff",
    startTime: "12:15",
    endTime: "12:45",
    estimatedMinutes: 30,
    breakMinutes: 0,
    urgencyLevel: "urgent",
    importanceLevel: "important",
    difficultyLevel: "easy",
  },
  {
    key: "sales-and-expense-log",
    title: "Sales and Expense Log",
    startTime: "15:00",
    endTime: "15:30",
    estimatedMinutes: 30,
    breakMinutes: 0,
    urgencyLevel: "somewhat_urgent",
    importanceLevel: "important",
    difficultyLevel: "easy",
  },
  {
    key: "dishwashing-stall-cleanup",
    title: "Dishwashing and Stall Cleanup",
    startTime: "17:00",
    endTime: "17:45",
    estimatedMinutes: 45,
    breakMinutes: 0,
    urgencyLevel: "somewhat_urgent",
    importanceLevel: "somewhat_important",
    difficultyLevel: "medium",
  },
];

const SMALL_FOOD_BUSINESS_DAY_PLANS = [
  {
    date: "2026-04-16",
    note: "A busy start for a small packed-meal business, with cooking completed but sales logging skipped.",
    outcomes: {
      "market-ingredient-run": { status: "completed", actualMinutes: 66 },
      "morning-cooking-prep": { status: "completed", actualMinutes: 105 },
      "packed-lunch-orders": { status: "completed", actualMinutes: 101 },
      "delivery-handoff": { status: "completed", actualMinutes: 34 },
      "sales-and-expense-log": { status: "missed" },
      "dishwashing-stall-cleanup": { status: "completed", actualMinutes: 52 },
    },
  },
  {
    date: "2026-04-17",
    note: "Lunch orders move well, but cleanup runs late after extra walk-in buyers.",
    outcomes: {
      "market-ingredient-run": { status: "completed", actualMinutes: 63 },
      "morning-cooking-prep": { status: "completed", actualMinutes: 99 },
      "packed-lunch-orders": { status: "completed", actualMinutes: 98 },
      "delivery-handoff": { status: "completed", actualMinutes: 32 },
      "sales-and-expense-log": { status: "completed", actualMinutes: 36 },
      "dishwashing-stall-cleanup": { status: "missed" },
    },
  },
  {
    date: "2026-04-18",
    note: "The business day is steady, though ingredient buying takes longer than planned.",
    outcomes: {
      "market-ingredient-run": { status: "completed", actualMinutes: 72 },
      "morning-cooking-prep": { status: "completed", actualMinutes: 96 },
      "packed-lunch-orders": { status: "completed", actualMinutes: 94 },
      "delivery-handoff": { status: "completed", actualMinutes: 31 },
      "sales-and-expense-log": { status: "completed", actualMinutes: 34 },
      "dishwashing-stall-cleanup": { status: "completed", actualMinutes: 48 },
    },
  },
  {
    date: "2026-04-19",
    note: "Prep and packing are completed, while the expense log is skipped after a family errand.",
    outcomes: {
      "market-ingredient-run": { status: "completed", actualMinutes: 61 },
      "morning-cooking-prep": { status: "completed", actualMinutes: 95 },
      "packed-lunch-orders": { status: "completed", actualMinutes: 92 },
      "delivery-handoff": { status: "completed", actualMinutes: 30 },
      "sales-and-expense-log": { status: "missed" },
      "dishwashing-stall-cleanup": { status: "completed", actualMinutes: 47 },
    },
  },
  {
    date: "2026-04-20",
    note: "A normal selling day with all food business tasks completed close to estimate.",
    outcomes: {
      "market-ingredient-run": { status: "completed", actualMinutes: 60 },
      "morning-cooking-prep": { status: "completed", actualMinutes: 93 },
      "packed-lunch-orders": { status: "completed", actualMinutes: 91 },
      "delivery-handoff": { status: "completed", actualMinutes: 30 },
      "sales-and-expense-log": { status: "completed", actualMinutes: 32 },
      "dishwashing-stall-cleanup": { status: "completed", actualMinutes: 46 },
    },
  },
  {
    date: "2026-04-21",
    note: "More orders come in before noon, making packing run slightly long.",
    outcomes: {
      "market-ingredient-run": { status: "completed", actualMinutes: 59 },
      "morning-cooking-prep": { status: "completed", actualMinutes: 94 },
      "packed-lunch-orders": { status: "completed", actualMinutes: 97 },
      "delivery-handoff": { status: "completed", actualMinutes: 31 },
      "sales-and-expense-log": { status: "completed", actualMinutes: 31 },
      "dishwashing-stall-cleanup": { status: "completed", actualMinutes: 46 },
    },
  },
  {
    date: "2026-04-22",
    note: "Cooking, order packing, delivery handoff, and cleanup fit the usual routine.",
    outcomes: {
      "market-ingredient-run": { status: "completed", actualMinutes: 58 },
      "morning-cooking-prep": { status: "completed", actualMinutes: 91 },
      "packed-lunch-orders": { status: "completed", actualMinutes: 89 },
      "delivery-handoff": { status: "completed", actualMinutes: 29 },
      "sales-and-expense-log": { status: "completed", actualMinutes: 30 },
      "dishwashing-stall-cleanup": { status: "completed", actualMinutes: 45 },
    },
  },
  {
    date: "2026-04-23",
    note: "The small food business runs smoothly with a short afternoon bookkeeping check.",
    outcomes: {
      "market-ingredient-run": { status: "completed", actualMinutes: 59 },
      "morning-cooking-prep": { status: "completed", actualMinutes: 90 },
      "packed-lunch-orders": { status: "completed", actualMinutes: 88 },
      "delivery-handoff": { status: "completed", actualMinutes: 29 },
      "sales-and-expense-log": { status: "completed", actualMinutes: 29 },
      "dishwashing-stall-cleanup": { status: "completed", actualMinutes: 44 },
    },
  },
  {
    date: "2026-04-24",
    note: "A predictable production day with slightly faster prep and cleanup.",
    outcomes: {
      "market-ingredient-run": { status: "completed", actualMinutes: 58 },
      "morning-cooking-prep": { status: "completed", actualMinutes: 89 },
      "packed-lunch-orders": { status: "completed", actualMinutes: 88 },
      "delivery-handoff": { status: "completed", actualMinutes: 28 },
      "sales-and-expense-log": { status: "completed", actualMinutes: 29 },
      "dishwashing-stall-cleanup": { status: "completed", actualMinutes: 43 },
    },
  },
  {
    date: "2026-04-25",
    note: "Weekend demand is manageable and all orders are packed before pickup.",
    outcomes: {
      "market-ingredient-run": { status: "completed", actualMinutes: 61 },
      "morning-cooking-prep": { status: "completed", actualMinutes: 92 },
      "packed-lunch-orders": { status: "completed", actualMinutes: 90 },
      "delivery-handoff": { status: "completed", actualMinutes: 30 },
      "sales-and-expense-log": { status: "completed", actualMinutes: 30 },
      "dishwashing-stall-cleanup": { status: "completed", actualMinutes: 45 },
    },
  },
  {
    date: "2026-04-26",
    note: "The owner keeps a steady prep, sales, bookkeeping, and cleanup rhythm.",
    outcomes: {
      "market-ingredient-run": { status: "completed", actualMinutes: 57 },
      "morning-cooking-prep": { status: "completed", actualMinutes: 88 },
      "packed-lunch-orders": { status: "completed", actualMinutes: 87 },
      "delivery-handoff": { status: "completed", actualMinutes: 28 },
      "sales-and-expense-log": { status: "completed", actualMinutes: 28 },
      "dishwashing-stall-cleanup": { status: "completed", actualMinutes: 43 },
    },
  },
  {
    date: "2026-04-27",
    note: "The final simulated day shows a normal small food business routine from market to cleanup.",
    outcomes: {
      "market-ingredient-run": { status: "completed", actualMinutes: 58 },
      "morning-cooking-prep": { status: "completed", actualMinutes: 89 },
      "packed-lunch-orders": { status: "completed", actualMinutes: 86 },
      "delivery-handoff": { status: "completed", actualMinutes: 28 },
      "sales-and-expense-log": { status: "completed", actualMinutes: 28 },
      "dishwashing-stall-cleanup": { status: "completed", actualMinutes: 42 },
    },
  },
];

const USER_SCENARIOS = {
  default: {
    label: "Illustrative Business Administration student improvement dataset",
    description:
      "Simulated April 16 to April 27 Business Administration student routine showing gradual improvement while using PlanIT. This is synthetic data for demo/thesis illustration, not a real-user log.",
    taskTemplates: BUSINESS_ADMIN_TASK_TEMPLATES,
    dayPlans: BUSINESS_ADMIN_DAY_PLANS,
  },
  SehTYcFFmbeyz84vT7Ct1DmqB6J3: {
    label: "Realistic Business Administration student coursework dataset",
    description:
      "Simulated April 16 to April 27 Business Administration student history with varied accounting, marketing, operations, business law, entrepreneurship, and group-project tasks instead of a repeated daily routine.",
    taskTemplates: BUSINESS_ADMIN_TASK_TEMPLATES,
    dayPlans: REALISTIC_BUSINESS_ADMIN_STUDENT_DAY_PLANS,
    useBusinessAdminPatternTitles: true,
  },
  "4Iev3QkxQoZrpfjaYGnwxKHWnXv1": {
    label: "Illustrative Subway team leader improvement dataset",
    description:
      "Simulated April 16 to April 27 Subway team leader routine showing gradual improvement while using PlanIT. This is synthetic data for demo/thesis illustration, not a real-user log.",
    taskTemplates: SUBWAY_TEAM_LEADER_TASK_TEMPLATES,
    dayPlans: SUBWAY_TEAM_LEADER_DAY_PLANS,
  },
  NHqgUHlBlwgXML8YlQadtQvO4xl1: {
    label: "Illustrative assistant admin marketing improvement dataset",
    description:
      "Simulated April 16 to April 27 assistant admin marketing routine showing gradual improvement across client follow-ups, campaign reporting, content calendar work, and admin logs.",
    taskTemplates: ASSISTANT_ADMIN_MARKETING_TASK_TEMPLATES,
    dayPlans: ASSISTANT_ADMIN_MARKETING_DAY_PLANS,
  },
  "6nec8OkuBQTW0vs7b6aaVlEM8HB3": {
    label: "Illustrative pre-elementary tutor improvement dataset",
    description:
      "Simulated April 16 to April 27 pre-elementary tutor routine showing gradual improvement across phonics prep, guided reading, early numeracy, parent notes, and learning-material cleanup.",
    taskTemplates: PRE_ELEMENTARY_TUTOR_TASK_TEMPLATES,
    dayPlans: PRE_ELEMENTARY_TUTOR_DAY_PLANS,
  },
  oTf9ZUVQ6XQx0plx6X3G7r5YImS2: {
    label: "Illustrative virtual assistant improvement dataset",
    description:
      "Simulated April 16 to April 27 virtual assistant routine showing gradual improvement across inbox triage, calendar coordination, CRM cleanup, meeting briefs, and client updates.",
    taskTemplates: VIRTUAL_ASSISTANT_TASK_TEMPLATES,
    dayPlans: VIRTUAL_ASSISTANT_DAY_PLANS,
  },
  "9vhEI3OTEibeEM1AZxm2fhVA1zr1": {
    label: "Illustrative marketing associate improvement dataset",
    description:
      "Simulated April 16 to April 27 marketing associate routine showing gradual improvement across content drafting, campaign metrics, newsletter layout, brand asset review, and community replies.",
    taskTemplates: MARKETING_ASSOCIATE_TASK_TEMPLATES,
    dayPlans: MARKETING_ASSOCIATE_DAY_PLANS,
  },
  SK0v6biv6sVxWFmYYTteA5Snq583: {
    label: "Stable IT associate routine dataset",
    description:
      "Simulated April 16 to April 27 IT associate routine showing stable service desk ticket triage, workstation setup, network checks, software updates, and asset inventory work.",
    taskTemplates: IT_ASSOCIATE_TASK_TEMPLATES,
    dayPlans: IT_ASSOCIATE_DAY_PLANS,
  },
  tlzjTO1BpLWYlDk4khOYV8ZYDwW2: {
    label: "Customer service representative mixed work and home dataset",
    description:
      "Simulated April 16 to April 27 customer service representative routine with ticket triage, live chat, complaint follow-ups, CRM case notes, and realistic household tasks.",
    taskTemplates: CUSTOMER_SERVICE_REP_TASK_TEMPLATES,
    dayPlans: CUSTOMER_SERVICE_REP_DAY_PLANS,
  },
  aE0FcUx9B9Pt0Gt8wjCH9BPf0W02: {
    label: "Small food business owner dataset",
    description:
      "Simulated April 16 to April 27 small food business routine with market buying, cooking prep, packed lunch orders, delivery handoff, sales logging, and cleanup.",
    taskTemplates: SMALL_FOOD_BUSINESS_TASK_TEMPLATES,
    dayPlans: SMALL_FOOD_BUSINESS_DAY_PLANS,
  },
};

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
    const byte = bytes[index % bytes.length];
    output += FIRESTORE_ID_CHARS[byte % FIRESTORE_ID_CHARS.length];
  }
  return output;
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function asDate(date, time) {
  return new Date(`${date}T${time}:00${TZ_OFFSET}`);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

function safeDate(value) {
  if (!value) return null;

  try {
    if (typeof value?.toDate === "function") {
      return value.toDate();
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
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

  const minutes = Number(
    (((end.getTime() - start.getTime()) / 1000) / 60).toFixed(4)
  );
  return minutes > 0 ? minutes : null;
}

function getResolvedAtIso(task) {
  return (
    task.lastCompletedAtIso ||
    task.completedAtIso ||
    task.lastMissedAtIso ||
    task.missedAtIso ||
    task.updatedAtIso
  );
}

function buildReminderFlagState({ createdAt, startAt, endAt, resolvedAt }) {
  const taskWindow = {
    startAtIso: startAt.toISOString(),
    endAtIso: endAt.toISOString(),
  };
  const flags = {};

  REMINDER_NOTIFICATION_CONFIGS.forEach((config) => {
    const anchorIso = config.getScheduledAt(taskWindow);
    const anchorDate = safeDate(anchorIso);
    if (!anchorDate) return;

    const scheduledAt = anchorDate.getTime() + config.offsetMs;
    if (
      createdAt.getTime() <= scheduledAt &&
      resolvedAt.getTime() > scheduledAt
    ) {
      flags[config.flagField] = true;
    }
  });

  return flags;
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
    return null;
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
      return null;
    }

    return response.json();
  } catch (error) {
    console.warn(
      `ML API is unreachable for "${title}". Falling back to local pattern statistics.`,
      error
    );
    return null;
  }
}

async function recomputePatternStatsForTitle(
  admin,
  db,
  userId,
  title,
  opts = {}
) {
  if (!userId || !title) return null;

  const normalizedTitle = normalizeTitle(title);
  const { propagate = true, propagationLimit = 200 } = opts;

  const MIN_MISSES_TO_SUGGEST_SPLIT = 3;
  const MIN_MISSES_TO_PREVENT_NEW_TASKS = 4;
  const RECENT_OUTCOME_WINDOW = 4;
  const RECENT_COMPLETION_RATE_TO_UNLOCK = 0.75;

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

async function recomputeAllPatternsForUser(admin, db, userId) {
  const tasksSnap = await db.collection(`users/${userId}/tasks`).get();
  const normalizedTitles = [
    ...new Set(
      tasksSnap.docs
        .map((docSnap) => {
          const data = docSnap.data() || {};
          return normalizeTitle(data.normalizedTitle || data.title || "");
        })
        .filter(Boolean)
    ),
  ];

  const results = [];
  for (const normalizedTitle of normalizedTitles) {
    const patternData = await recomputePatternStatsForTitle(
      admin,
      db,
      userId,
      normalizedTitle,
      { propagate: true }
    );
    if (patternData) {
      results.push(patternData);
    }
  }

  return results;
}

function buildTask(userId, dayPlan, template, sequence) {
  const outcome = dayPlan.outcomes[template.key];
  const startAt = asDate(dayPlan.date, template.startTime);
  const endAt = asDate(dayPlan.date, template.endTime);
  const createdAt = addMinutes(startAt, -90 + sequence * 3);
  const resolvedAt =
    outcome.status === "completed"
      ? addMinutes(startAt, outcome.actualMinutes)
      : addMinutes(endAt, 10 + sequence);
  const normalizedTitle = normalizeTitle(template.title);
  const taskId = createFirestoreLikeId(
    `${SOURCE_TAG}|${userId}|task|${dayPlan.date}|${template.key}`
  );
  const reminderFlags = buildReminderFlagState({
    createdAt,
    startAt,
    endAt,
    resolvedAt,
  });
  const baseTask = {
    id: taskId,
    userId,
    title: template.title,
    normalizedTitle,
    patternKey: normalizedTitle,
    createdAtIso: createdAt.toISOString(),
    updatedAtIso: createdAt.toISOString(),
    mode: "scheduled",
    startDate: dayPlan.date,
    startTime: template.startTime,
    endDate: dayPlan.date,
    endTime: template.endTime,
    startAtIso: startAt.toISOString(),
    endAtIso: endAt.toISOString(),
    dueDateIso: endAt.toISOString(),
    estimatedMinutes: template.estimatedMinutes,
    breakMinutes: template.breakMinutes,
    urgencyLevel: template.urgencyLevel,
    importanceLevel: template.importanceLevel,
    difficultyLevel: template.difficultyLevel,
    completedCount: 0,
    missedCount: 0,
    totalCompletions: 0,
    totalActualMinutes: 0,
    lastCompletedAtIso: null,
    lastMissedAtIso: null,
    status: "pending",
    finalized: false,
    isSplitParent: false,
    isSplitSegment: false,
    splitSegmentCount: null,
    parentTaskId: null,
    ...reminderFlags,
    sourceTag: SOURCE_TAG,
  };

  if (outcome.status === "completed") {
    return {
      ...baseTask,
      completedCount: 1,
      totalCompletions: 1,
      totalActualMinutes: outcome.actualMinutes,
      lastActualMinutes: outcome.actualMinutes,
      lastCompletedAtIso: resolvedAt.toISOString(),
      completedAtIso: resolvedAt.toISOString(),
      lastOutcome: "completed",
      status: "completed",
      finalized: true,
    };
  }

  return {
    ...baseTask,
    missedCount: 1,
    lastMissedAtIso: resolvedAt.toISOString(),
    missedAtIso: resolvedAt.toISOString(),
    lastOutcome: "missed",
    status: "missed",
    finalized: true,
  };
}

function summarizeDay(dayPlan, tasks) {
  const completedTasks = tasks.filter((task) => task.status === "completed");
  const completedCount = completedTasks.length;
  const missedCount = tasks.length - completedCount;
  const estimatedTrackedMinutes = completedTasks.reduce(
    (total, task) => total + Number(task.estimatedMinutes || 0),
    0
  );
  const actualTrackedMinutes = completedTasks.reduce(
    (total, task) => total + Number(task.totalActualMinutes || 0),
    0
  );
  const completionRate = tasks.length === 0 ? 0 : completedCount / tasks.length;
  const overrunRatio =
    estimatedTrackedMinutes > 0
      ? Number((actualTrackedMinutes / estimatedTrackedMinutes).toFixed(3))
      : null;

  return {
    date: dayPlan.date,
    note: dayPlan.note,
    completedCount,
    missedCount,
    completionRate: Number(completionRate.toFixed(3)),
    trackedEstimatedMinutes: estimatedTrackedMinutes,
    trackedActualMinutes: actualTrackedMinutes,
    overrunRatio,
  };
}

function buildNotifications(tasks) {
  const notifications = [];

  tasks.forEach((task) => {
    const createdAt = safeDate(task.createdAtIso);
    const resolvedAt = safeDate(getResolvedAtIso(task));
    if (!createdAt || !resolvedAt) {
      return;
    }

    const createdNotificationId = createFirestoreLikeId(
      `${SOURCE_TAG}|${task.userId}|notification|${task.id}|task_created`
    );

    notifications.push({
      documentId: createdNotificationId,
      id: createdNotificationId,
      taskId: task.id,
      title: "New task created",
      body: `"${task.title}" was added to your tasks.`,
      type: "task_created",
      channel: "all",
      createdAtIso: addSeconds(createdAt, 2).toISOString(),
      sourceTag: SOURCE_TAG,
    });

    REMINDER_NOTIFICATION_CONFIGS.forEach((config) => {
      if (!task[config.flagField]) {
        return;
      }

      const anchorDate = safeDate(config.getScheduledAt(task));
      if (!anchorDate) {
        return;
      }

      const reminderDate = new Date(anchorDate.getTime() + config.offsetMs);
      notifications.push({
        documentId: `reminder_${task.id}_${config.type}`,
        taskId: task.id,
        title: config.title,
        body: config.getBody(task.title),
        type: config.type,
        createdAtIso: reminderDate.toISOString(),
        sourceTag: SOURCE_TAG,
      });
    });

    if (task.status === "completed") {
      notifications.push({
        documentId: `task_completed_${task.id}`,
        taskId: task.id,
        title: "Task completed",
        body: `${task.title} was marked as completed.`,
        type: "task_completed",
        createdAtIso: resolvedAt.toISOString(),
        sourceTag: SOURCE_TAG,
      });
      return;
    }

    notifications.push({
      documentId: `task_missed_${task.id}`,
      taskId: task.id,
      title: "Task missed",
      body: `${task.title} was marked as missed.`,
      type: "task_missed",
      createdAtIso: resolvedAt.toISOString(),
      sourceTag: SOURCE_TAG,
    });
  });

  const sortedNotifications = notifications.sort((left, right) => {
    const leftTime = new Date(left.createdAtIso).getTime() || 0;
    const rightTime = new Date(right.createdAtIso).getTime() || 0;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return String(left.documentId || "").localeCompare(
      String(right.documentId || "")
    );
  });

  return sortedNotifications.map((notification, index) => ({
    ...notification,
    read: index < Math.max(0, sortedNotifications.length - 10),
  }));
}

function getScenario(userId) {
  return USER_SCENARIOS[userId] || USER_SCENARIOS.default;
}

function buildDataset(userId) {
  const scenario = getScenario(userId);
  const tasks = [];
  const dailySummary = [];

  scenario.dayPlans.forEach((dayPlan, dayIndex) => {
    const rawTaskTemplates = dayPlan.taskTemplates || scenario.taskTemplates;
    const taskTemplates = scenario.useBusinessAdminPatternTitles
      ? rawTaskTemplates.map(applyBusinessAdminPatternTitle)
      : rawTaskTemplates;
    const dayTasks = taskTemplates.map((template, templateIndex) =>
      buildTask(userId, dayPlan, template, dayIndex * 10 + templateIndex)
    );
    tasks.push(...dayTasks);
    dailySummary.push(summarizeDay(dayPlan, dayTasks));
  });

  const notifications = buildNotifications(tasks);

  return {
    meta: {
      simulated: true,
      label: scenario.label,
      description: scenario.description,
      userId,
      sourceTag: SOURCE_TAG,
      timezone: "Asia/Manila",
      generatedAtIso: new Date().toISOString(),
      dayCount: scenario.dayPlans.length,
      taskCount: tasks.length,
      notificationCount: notifications.length,
    },
    dailySummary,
    tasks,
    notifications,
  };
}

async function writeJsonDataset(dataset, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
}

function buildFirestorePreview(dataset) {
  const tasks = dataset.tasks.map((task) => {
    const {
      createdAtIso,
      updatedAtIso,
      startAtIso,
      endAtIso,
      dueDateIso,
      lastCompletedAtIso,
      completedAtIso,
      lastMissedAtIso,
      missedAtIso,
      ...rest
    } = task;

    const previewTask = {
      ...rest,
      createdAt: createdAtIso,
      updatedAt: updatedAtIso,
      startAt: startAtIso,
      endAt: endAtIso,
      dueDate: dueDateIso,
      lastCompletedAt: lastCompletedAtIso,
      lastMissedAt: lastMissedAtIso,
    };

    if ("completedAtIso" in task) {
      previewTask.completedAt = completedAtIso;
    }

    if ("missedAtIso" in task) {
      previewTask.missedAt = missedAtIso;
    }

    return previewTask;
  });

  const notifications = (dataset.notifications || []).map((notification) => {
    const { documentId, createdAtIso, ...rest } = notification;
    return {
      ...rest,
      createdAt: createdAtIso,
    };
  });

  return {
    meta: {
      ...dataset.meta,
      previewType: "firestore-field-shape",
      note:
        "This preview mirrors the task and notification field names used by the app after import. Timestamp values are represented as ISO strings here, but the importer writes them to Firestore as timestamp/date fields.",
    },
    tasks,
    notifications,
  };
}

async function writeToFirestore(dataset) {
  const [{ default: admin }] = await Promise.all([import("firebase-admin")]);

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!serviceAccountJson && !serviceAccountPath) {
    throw new Error(
      "Set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS before using --write-firestore."
    );
  }

  if (!admin.apps.length) {
    const credential = serviceAccountJson
      ? admin.credential.cert(JSON.parse(serviceAccountJson))
      : admin.credential.cert(
          JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"))
        );
    admin.initializeApp({ credential });
  }

  const db = admin.firestore();
  const tasksRef = db.collection(`users/${dataset.meta.userId}/tasks`);
  const notificationsRef = db.collection(
    `users/${dataset.meta.userId}/notifications`
  );
  const existingSnap = await tasksRef
    .where("sourceTag", "==", dataset.meta.sourceTag)
    .get();
  const existingNotificationsSnap = await notificationsRef
    .where("sourceTag", "==", dataset.meta.sourceTag)
    .get();

  if (!existingSnap.empty) {
    const batch = db.batch();
    existingSnap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
  }

  if (!existingNotificationsSnap.empty) {
    const batch = db.batch();
    existingNotificationsSnap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
  }

  for (const task of dataset.tasks) {
    const taskRef = tasksRef.doc(task.id);
    const {
      createdAtIso,
      updatedAtIso,
      startAtIso,
      endAtIso,
      dueDateIso,
      lastCompletedAtIso,
      completedAtIso,
      lastMissedAtIso,
      missedAtIso,
      ...rest
    } = task;
    const payload = {
      ...rest,
      createdAt: new Date(createdAtIso),
      updatedAt: new Date(updatedAtIso),
      startAt: new Date(startAtIso),
      endAt: new Date(endAtIso),
      dueDate: new Date(dueDateIso),
      lastCompletedAt: lastCompletedAtIso
        ? new Date(lastCompletedAtIso)
        : null,
      lastMissedAt: lastMissedAtIso ? new Date(lastMissedAtIso) : null,
    };

    if ("completedAtIso" in task) {
      payload.completedAt = completedAtIso ? new Date(completedAtIso) : null;
    }

    if ("missedAtIso" in task) {
      payload.missedAt = missedAtIso ? new Date(missedAtIso) : null;
    }

    await taskRef.set(payload);
  }

  for (const notification of dataset.notifications || []) {
    const notificationRef = notificationsRef.doc(notification.documentId);
    const { documentId, createdAtIso, ...rest } = notification;
    await notificationRef.set({
      ...rest,
      createdAt: new Date(createdAtIso),
    });
  }

  const patternResults = await recomputeAllPatternsForUser(
    admin,
    db,
    dataset.meta.userId
  );

  console.log(
    `Imported ${dataset.tasks.length} simulated tasks, ${dataset.notifications?.length || 0} simulated notifications, and recomputed ${patternResults.length} pattern documents for user ${dataset.meta.userId}.`
  );
}

async function main() {
  const userId = process.argv.includes("--user")
    ? process.argv[process.argv.indexOf("--user") + 1]
    : DEFAULT_USER_ID;
  const shouldWriteFirestore = process.argv.includes("--write-firestore");
  const dataset = buildDataset(userId);
  const outputPath = path.join(
    projectRoot,
    "data",
    `simulated_april_16_27_${userId}.json`
  );
  const previewOutputPath = path.join(
    projectRoot,
    "data",
    `simulated_april_16_27_${userId}_firestore_preview.json`
  );

  await writeJsonDataset(dataset, outputPath);
  await writeJsonDataset(buildFirestorePreview(dataset), previewOutputPath);
  console.log(`Wrote simulated dataset to ${outputPath}`);
  console.log(`Wrote Firestore preview dataset to ${previewOutputPath}`);

  if (shouldWriteFirestore) {
    await writeToFirestore(dataset);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
