import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { admin, getAdminDb } from "../api/_lib/firebaseAdmin.js";
import { buildTaskWindowSummary } from "./_task_window_summary.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(projectRoot, "data"));

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function getUserId(dataset, fallback = "") {
  return (
    dataset.userId ||
    dataset.uid ||
    dataset.tasks?.find((task) => task.userId)?.userId ||
    fallback.replace(/^simulated_april_16_27_/, "").replace(/_app_preview\.json$/, "")
  );
}

async function listPreviewFiles() {
  const entries = await fs.readdir(dataDir);
  return entries
    .filter(
      (entry) =>
        entry.startsWith("simulated_april_16_27_") &&
        entry.endsWith("_app_preview.json")
    )
    .sort();
}

async function main() {
  const db = getAdminDb();
  const previewFiles = await listPreviewFiles();

  if (previewFiles.length === 0) {
    throw new Error("No *_app_preview.json files found in data/.");
  }

  const writes = [];
  for (const fileName of previewFiles) {
    const dataset = await readJson(path.join(dataDir, fileName));
    const tasks = Array.isArray(dataset) ? dataset : dataset.tasks || [];
    const userId = getUserId(dataset, fileName);

    if (!userId || tasks.length === 0) {
      console.warn(`Skipping ${fileName}: missing user id or tasks.`);
      continue;
    }

    writes.push(
      db.doc(`users/${userId}/analytics/task-window-summary`).set(
        {
          ...buildTaskWindowSummary(tasks, userId),
          generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
    );
  }

  await Promise.all(writes);
  console.log(`Wrote ${writes.length} admin analytics summary documents.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
