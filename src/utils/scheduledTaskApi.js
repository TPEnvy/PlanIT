export async function saveScheduledTask({
  user,
  taskId = null,
  title,
  patternKey = null,
  startDate,
  startTime,
  endDate,
  endTime,
  urgencyLevel = null,
  importanceLevel = null,
  difficultyLevel = null,
  conflictResolution = "default",
  overrideWindow = null,
}) {
  if (!user) {
    throw new Error("You must be signed in to save a scheduled task.");
  }

  const idToken = await user.getIdToken();

  const response = await fetch("/api/tasks/scheduled-write", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      taskId,
      title,
      patternKey,
      startDate,
      startTime,
      endDate,
      endTime,
      urgencyLevel,
      importanceLevel,
      difficultyLevel,
      conflictResolution,
      overrideWindow,
    }),
  });

  const payload = await response
    .json()
    .catch(() => ({ message: "Failed to parse server response." }));

  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}
