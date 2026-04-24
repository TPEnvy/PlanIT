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

  let payload;

  try {
    payload = await response.json();
  } catch {
    const text = await response.text().catch(() => "");
    const looksLikeHtml =
      text.includes("<!doctype html") ||
      text.includes("<html") ||
      text.includes("</html>");

    payload = {
      message: looksLikeHtml
        ? "The app received HTML instead of the scheduling API response. On Railway, make sure the web service is serving /api/tasks/scheduled-write."
        : "Failed to parse server response.",
      rawResponsePreview: text.slice(0, 200),
    };
  }

  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}
