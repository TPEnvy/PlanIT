import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { firestore } from "../server.js/firebase";

function normalizeTitle(title) {
  return String(title || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export async function recomputeAndSavePatternStats(
  userId,
  title,
  opts = {}
) {
  if (!userId || !title) return null;

  const normalizedTitle = normalizeTitle(title);
  const { propagate = true, propagationLimit = 200 } = opts;

  const MIN_DOCS_FOR_LEARNING = 5;
  const SENSITIVITY = 4.0;
  const OVERRUN_WEIGHT = 1.0;
  const MAX_BOOST = 3.0;
  const MIN_MISSES_TO_SUGGEST_SPLIT = 3;

  try {
    const tasksRef = collection(firestore, `users/${userId}/tasks`);
    const tasksQuery = query(
      tasksRef,
      where("normalizedTitle", "==", normalizedTitle)
    );
    const snap = await getDocs(tasksQuery);

    let totalCompleted = 0;
    let totalMissed = 0;
    let totalActualMinutes = 0;
    let totalEstimatedMinutes = 0;
    let docCount = 0;
    let foundSplitParent = false;

    for (const taskSnap of snap.docs) {
      const data = taskSnap.data() || {};
      docCount += 1;
      totalCompleted += Number(data.completedCount || 0);
      totalMissed += Number(data.missedCount || 0);
      totalActualMinutes += Number(data.totalActualMinutes || 0);
      totalEstimatedMinutes += Number(data.estimatedMinutes || 0);
      if (data.isSplitParent === true) {
        foundSplitParent = true;
      }
    }

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

    const rawFromCompletion = (0.5 - completionRate) * SENSITIVITY;
    const rawFromOverrun = (overrunRatio - 1.0) * OVERRUN_WEIGHT;
    const confidence = Math.min(1, Math.sqrt(docCount / MIN_DOCS_FOR_LEARNING));

    let adaptiveBoost = (rawFromCompletion + rawFromOverrun) * confidence;
    adaptiveBoost = Math.max(-MAX_BOOST, Math.min(MAX_BOOST, adaptiveBoost));
    adaptiveBoost = Math.round(adaptiveBoost * 100) / 100;

    const suggestSplit =
      totalMissed >= MIN_MISSES_TO_SUGGEST_SPLIT && docCount >= 2;
    const preventNewTasks = suggestSplit && foundSplitParent;

    const patternRef = doc(
      firestore,
      `users/${userId}/patterns/${normalizedTitle}`
    );
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

    await setDoc(patternRef, patternData, { merge: true });

    if (propagate && snap.docs.length > 0) {
      const updates = snap.docs.slice(0, propagationLimit).map((taskSnap) => {
        const taskRef = doc(firestore, `users/${userId}/tasks/${taskSnap.id}`);
        return updateDoc(taskRef, { adaptiveBoost }).catch((error) => {
          console.warn(
            `Failed updating task ${taskSnap.id} with adaptiveBoost:`,
            error
          );
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
