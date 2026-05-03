/**
 * history.js — Persistent conversation history.
 * Stored as JSON so it survives bot restarts.
 * Keeps the last MAX_MESSAGES entries (each message = 1 entry).
 */

const fs   = require('fs');
const path = require('path');

const HISTORY_FILE  = path.join(__dirname, '..', 'data', 'history.json');
const MAX_MESSAGES  = 20; // = 10 exchanges (user + assistant each)

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[history] Load error:', e.message);
  }
  return [];
}

function saveHistory(history) {
  try {
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  } catch (e) {
    console.error('[history] Save error:', e.message);
  }
}

function addToHistory(history, role, content) {
  const updated = [
    ...history,
    { role, content, ts: new Date().toISOString() },
  ];
  // Trim to MAX_MESSAGES, always keep pairs (drop oldest pair first)
  return updated.slice(-MAX_MESSAGES);
}

function clearHistory() {
  saveHistory([]);
  return [];
}

function historyStats(history) {
  const userMsgs      = history.filter(h => h.role === 'user').length;
  const assistantMsgs = history.filter(h => h.role === 'assistant').length;
  return { total: history.length, userMsgs, assistantMsgs };
}

module.exports = { loadHistory, saveHistory, addToHistory, clearHistory, historyStats };
