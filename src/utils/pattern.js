import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { firestore } from "../server.js/firebase";
import { inferAutoTrackedActualMinutes } from "./taskHelpers";

function resolveMlApiBaseUrl() {
  const configuredUrl = import.meta.env.VITE_ML_API_URL;
  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, "");
  }

  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "http://127.0.0.1:8000";
    }
  }

  return null;
}

const ML_API_BASE_URL = resolveMlApiBaseUrl();
let hasWarnedAboutMissingMlApi = false;

function toTimestampMillis(value) {
  if (!value) return null;
  try {
    if (typeof value.toDate === "function") {
      return value.toDate().getTime();
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  } catch {
    return null;
  }
}

export function normalizePatternTitle(title) {
  return String(title || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function buildHistoricalItem(data) {
  const completedCount = Number(data.completedCount || 0);
  const isCompleted =
    (data.status || "").toLowerCase() === "completed" || completedCount > 0;
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
    status: (data.status || "").toLowerCase(),
  };
}

async function fetchMlPatternPrediction(userId, title, historical) {
  if (!ML_API_BASE_URL) {
    if (!hasWarnedAboutMissingMlApi) {
      console.warn(
        "VITE_ML_API_URL is not configured for this deployment. Falling back to local pattern statistics only."
      );
      hasWarnedAboutMissingMlApi = true;
    }
    return null;
  }

  try {
    const response = await fetch(`${ML_API_BASE_URL}/predict`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId,
        title,
        historical,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.warn(
        `ML API request failed (${response.status}). Falling back to local pattern statistics.`,
        errorText || response.statusText
      );
      return null;
    }

    return response.json();
  } catch (error) {
    console.warn(
      "ML API is unreachable. Falling back to local pattern statistics.",
      error
    );
    return null;
  }
}

export function buildPreventNewTasksMessage(title) {
  const taskLabel = normalizePatternTitle(title) || "this task";
  return (
    `You kept missing "${taskLabel}" after the system recommended splitting it. ` +
    "You cannot add more tasks right now. Split, complete, reset, or delete the blocked task first."
  );
}

export function buildSuggestSplitMessage(title) {
  const taskLabel = normalizePatternTitle(title) || "this task";
  return (
    `The task "${taskLabel}" has been missed at least 3 times across 2 or more records. ` +
    "Splitting it into smaller segments is recommended."
  );
}

export function shouldSuggestSplit(patternStats) {
  if (!patternStats) return false;
  if (patternStats.recoveryUnlocked === true) return false;

  const totalMissed = Number(
    patternStats.historicalTotalMissed ??
      patternStats.total_missed ??
      patternStats.totalMissed ??
      0
  );
  const docCount = Number(
    patternStats.historicalDocCount ?? patternStats.docCount ?? 0
  );

  return patternStats.suggestSplit === true || (totalMissed >= 3 && docCount >= 2);
}

export function shouldPreventNewTasks(patternStats) {
  if (!patternStats) return false;
  if (patternStats.recoveryUnlocked === true) return false;

  const totalMissed = Number(
    patternStats.historicalTotalMissed ??
      patternStats.total_missed ??
      patternStats.totalMissed ??
      0
  );
  const docCount = Number(
    patternStats.historicalDocCount ?? patternStats.docCount ?? 0
  );
  const pendingTaskCount = Number(
    patternStats.pendingTaskCount ?? patternStats.pending_count ?? 0
  );

  return (
    pendingTaskCount > 0 &&
    (patternStats.preventNewTasks === true ||
      (totalMissed >= 4 && docCount >= 2))
  );
}

export async function getPreventNewTasksBlock(userId) {
  if (!userId || !firestore) return null;

  try {
    const patternsRef = collection(firestore, `users/${userId}/patterns`);
    const blockQuery = query(
      patternsRef,
      where("preventNewTasks", "==", true)
    );
    const snap = await getDocs(blockQuery);

    if (snap.empty) return null;

    for (const patternDoc of snap.docs) {
      const storedPattern = patternDoc.data() || {};
      const normalizedTitle =
        storedPattern.normalizedTitle || patternDoc.id || "";
      const refreshedPattern =
        normalizedTitle
          ? await recomputeAndSavePatternStats(userId, normalizedTitle, {
              propagate: false,
            })
          : null;
      const activePattern = refreshedPattern || storedPattern;

      if (shouldPreventNewTasks(activePattern)) {
        return {
          id: patternDoc.id,
          ...storedPattern,
          ...activePattern,
        };
      }
    }

    return null;
  } catch (error) {
    console.error("getPreventNewTasksBlock error:", error);
    return null;
  }
}

export async function recomputeAndSavePatternStats(
  userId,
  title,
  opts = {}
) {
  if (!userId || !title || !firestore) return null;

  const normalizedTitle = normalizePatternTitle(title);
  const { propagate = true, propagationLimit = 200 } = opts;

  const MIN_MISSES_TO_SUGGEST_SPLIT = 3;
  const MIN_MISSES_TO_PREVENT_NEW_TASKS = 4;
  const RECENT_OUTCOME_WINDOW = 4;
  const RECENT_COMPLETION_RATE_TO_UNLOCK = 0.75;

  try {
    const tasksRef = collection(firestore, `users/${userId}/tasks`);
    const patternRef = doc(
      firestore,
      `users/${userId}/patterns/${normalizedTitle}`
    );
    const existingPatternSnap = await getDoc(patternRef);
    const existingPattern = existingPatternSnap.exists()
      ? existingPatternSnap.data() || {}
      : {};

    const tasksQuery = query(
      tasksRef,
      where("normalizedTitle", "==", normalizedTitle)
    );
    const snap = await getDocs(tasksQuery);

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
    const totalCompleted = Number(
      prediction?.total_completed ?? localCompleted
    );
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
      updatedAt: serverTimestamp(),
    };

    await setDoc(patternRef, patternData, { merge: true });

    if (propagate && snap.docs.length > 0) {
      const updates = snap.docs.slice(0, propagationLimit).map((taskSnap) => {
        const taskRef = doc(firestore, `users/${userId}/tasks/${taskSnap.id}`);
        return updateDoc(taskRef, {
          adaptiveBoost,
          mlRiskScore,
          suggestSplit,
          preventNewTasks,
          patternDocCount: historicalDocCount,
          patternHasSplitParent: foundSplitParent,
          patternTotalMissed: historicalTotalMissed,
          pendingTaskCount,
          recoveryUnlocked,
        }).catch((error) => {
          if (error?.code === "not-found") {
            return null;
          }

          console.warn(
            `Failed updating task ${taskSnap.id} with pattern stats:`,
            error
          );
          return null;
        });
      });

      await Promise.allSettled(updates);
    }

    return patternData;
  } catch (error) {
    console.error("recomputeAndSavePatternStats error:", error);
    return null;
  }
}

export default recomputeAndSavePatternStats;
