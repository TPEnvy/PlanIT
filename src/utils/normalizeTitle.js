// src/utils/normalizeTitle.js
export default function normalizeTitle(title = "") {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}
