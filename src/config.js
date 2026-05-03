/**
 * config.js — Persistent bot settings (model selection, etc.)
 *
 * Model aliases ('sonnet', 'opus', 'haiku') always resolve to the latest
 * version — no need to hardcode version numbers that go stale.
 * Specific full names (e.g. 'claude-sonnet-4-6') also work if needed.
 */

const fs   = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'config.json');

const MODELS = [
  {
    id:    'opus',
    label: 'Opus (latest)',
    emoji: '🏆',
    desc:  'Stärkstes Modell — komplex, langsamer',
  },
  {
    id:    'sonnet',
    label: 'Sonnet (latest)',
    emoji: '⚡',
    desc:  'Balanced — Standard',
  },
  {
    id:    'haiku',
    label: 'Haiku (latest)',
    emoji: '🚀',
    desc:  'Schnellstes Modell — kurze Aufgaben',
  },
];

const DEFAULT_MODEL = 'sonnet';

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return { model: DEFAULT_MODEL, ...saved };
    }
  } catch (e) {
    console.error('[config] Load error:', e.message);
  }
  return { model: DEFAULT_MODEL };
}

function saveConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) {
    console.error('[config] Save error:', e.message);
  }
}

module.exports = { MODELS, DEFAULT_MODEL, loadConfig, saveConfig };
