// src/utils/patterns.js
// Utility to compute & persist aggregated pattern stats (adaptiveBoost) for tasks with same normalizedTitle.
// Safe: includes guards, limited propagation, and catches internal errors.

import {
  collection,
  doc,
  getDocs,
  query,
  where,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { firestore } from "../server.js/firebase";

/**
 * Recompute & save aggregated pattern statistics for tasks sharing the same normalizedTitle.
 *
 * @param {string} userId - Firebase UID
 * @param {string} normalizedTitle - lowercased + trimmed title key
 * @param {Object} [opts]
 * @param {boolean} [opts.propagate=true] - whether to write adaptiveBoost back to matching tasks
 * @param {number} [opts.propagationLimit=200] - maximum number of task docs to update to avoid quotas
 * @returns {Promise<Object|null>} patternData or null on failure
 */
export async function recomputeAndSavePatternStats(
  userId,
  normalizedTitle,
  opts = {}
) {
  if (!userId || !normalizedTitle) {
    console.warn("recomputeAndSavePatternStats: missing userId or normalizedTitle");
    return null;
  }

  const { propagate = true, propagationLimit = 200 } = opts;

  // Hyper-parameters (tweak to change sensitivity)
  const MIN_DOCS_FOR_LEARNING = 5; // docs needed for full confidence
  const SENSITIVITY = 4.0; // completion -> priority scaling
  const OVERRUN_WEIGHT = 1.0; // overrun -> priority scaling
  const MAX_BOOST = 3.0; // clamp absolute adaptiveBoost
  const MIN_MISSES_TO_SUGGEST_SPLIT = 3; // threshold to suggest splitting

  try {
    const tasksRef = collection(firestore, `users/${userId}/tasks`);
    const q = query(tasksRef, where("normalizedTitle", "==", normalizedTitle));
    const snap = await getDocs(q);

    // Aggregate across matching tasks
    let totalCompleted = 0;
    let totalMissed = 0;
    let totalActualMinutes = 0;
    let totalEstimatedMinutes = 0;
    let docCount = 0;
    let foundSplitParent = false;

    for (const d of snap.docs) {
      const data = d.data() || {};
      docCount += 1;
      totalCompleted += Number(data.completedCount || 0);
      totalMissed += Number(data.missedCount || 0);
      totalActualMinutes += Number(data.totalActualMinutes || 0);
      if (typeof data.estimatedMinutes === "number") {
        totalEstimatedMinutes += data.estimatedMinutes;
      }
      if (data.isSplitParent === true) foundSplitParent = true;
    }

    // Derived metrics
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

    // Continuous adaptive boost heuristic
    const rawFromCompletion = (0.5 - completionRate) * SENSITIVITY;
    const rawFromOverrun = (overrunRatio - 1.0) * OVERRUN_WEIGHT;
    let rawBoost = rawFromCompletion + rawFromOverrun;

    // Confidence scaling (smooth ramp-up)
    const confidence = Math.min(1, Math.sqrt(docCount / MIN_DOCS_FOR_LEARNING));

    let adaptiveBoost = rawBoost * confidence;

    // Clamp & round
    if (adaptiveBoost > MAX_BOOST) adaptiveBoost = MAX_BOOST;
    if (adaptiveBoost < -MAX_BOOST) adaptiveBoost = -MAX_BOOST;
    adaptiveBoost = Math.round(adaptiveBoost * 100) / 100; // 2 decimals

    // Suggest / prevent flags
    const suggestSplit = totalMissed >= MIN_MISSES_TO_SUGGEST_SPLIT && docCount >= 2;
    const preventNewTasks =
      suggestSplit && foundSplitParent && totalMissed >= MIN_MISSES_TO_SUGGEST_SPLIT;

    // Compose pattern doc
    const patternRef = doc(firestore, `users/${userId}/patterns/${normalizedTitle}`);
    const patternData = {
      normalizedTitle,
      docCount,
      total_completed: totalCompleted,
      total_missed: totalMissed,
      totalActualMinutes,
      totalEstimatedMinutes,
      completion_rate: completionRate,
      overrun_ratio: overrunRatio,
      adaptiveBoost,
      suggestSplit,
      preventNewTasks,
      explanation: `docCount=${docCount}, completed=${totalCompleted}, missed=${totalMissed}, completion_rate=${Number(
        completionRate.toFixed(3)
      )}`,
      updatedAt: serverTimestamp(),
    };

    // Persist pattern doc: try update then fallback to set
    try {
      await updateDoc(patternRef, patternData);
    } catch (err) {
      // updateDoc fails if doc doesn't exist
      await setDoc(patternRef, patternData);
    }

    // Optional: propagate adaptiveBoost back to tasks (limited)
    if (propagate && docCount > 0 && snap.docs.length > 0) {
      const updates = [];
      let i = 0;
      for (const d of snap.docs) {
        if (i >= propagationLimit) break;
        const taskId = d.id;
        const taskRef = doc(firestore, `users/${userId}/tasks/${taskId}`);
        // update only the adaptiveBoost field
        updates.push(
          updateDoc(taskRef, { adaptiveBoost }).catch((e) => {
            // swallow individual update errors to allow others to proceed
            console.warn(`Failed updating task ${taskId} with adaptiveBoost:`, e);
          })
        );
        i += 1;
      }
      if (updates.length > 0) {
        // wait for completion of all updates but don't throw on partial failures
        await Promise.allSettled(updates);
      }
    }

    return patternData;
  } catch (err) {
    console.error("recomputeAndSavePatternStats error:", err);
    return null;
  }
}

export default recomputeAndSavePatternStats;
