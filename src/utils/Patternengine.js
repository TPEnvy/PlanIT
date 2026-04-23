export function computePriorityScore(task = {}, patternStats = {}) {
  const resolved =
    task?.finalized === true ||
    task?.status === "completed" ||
    task?.status === "missed" ||
    Number(task?.completedCount || 0) > 0 ||
    Number(task?.missedCount || 0) > 0;

  if (resolved) {
    return {
      final: 0,
      W: 0,
      EDF: 0,
      confidence: 0,
      rawAdaptiveBoost: 0,
      adaptiveBoost: 0,
      active: false,
    };
  }

  const now = Date.now();

  let Tr = 999999;

  if (task?.endAt instanceof Date && !isNaN(task.endAt.getTime())) {
    Tr = Math.max(0, (task.endAt.getTime() - now) / 60000);
  }

  const EDF = 1 / (Tr + 1);

  const urgencyMap = {
    urgent: 1.0,
    somewhat_urgent: 0.8,
  };

  const importanceMap = {
    important: 1.0,
    somewhat_important: 0.8,
  };

  const difficultyMap = {
    easy: 0.9,
    medium: 1.0,
    hard: 1.1,
  };

  const U = urgencyMap[task.urgencyLevel] ?? 0;
  const I = importanceMap[task.importanceLevel] ?? 0;
  const D = difficultyMap[task.difficultyLevel] ?? 1.0;

  const W = 0.4 * U + 0.4 * I + 0.2 * D;

  const rawBoost = patternStats?.adaptiveBoost ?? 0;
  const docCount = patternStats?.docCount ?? 0;

  const confidence = Math.min(docCount / 5, 1);
  const effectiveBoost = rawBoost * confidence;

  const P = (W * EDF) + effectiveBoost;

  return {
    final: Number(P.toFixed(4)),
    W,
    EDF,
    confidence,
    rawAdaptiveBoost: rawBoost,
    adaptiveBoost: effectiveBoost,
    active: true,
  };
}
