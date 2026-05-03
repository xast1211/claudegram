/**
 * claude.js — Wrapper around the Claude Code CLI.
 * Streams stdout so the caller can update the Telegram message progressively.
 */

const { spawn } = require('child_process');

const TIMEOUT_MS = 180_000;

// Injected into every request so Claude knows the Telegram bot context
const BOT_CONTEXT = `
Du läufst als Claudian innerhalb des Telegram-Bots "Claudegram" (@claud_gram_bot).
Verfügbare Bot-Befehle (NUR diese existieren — nenne niemals andere):
  /start   — Begrüßung
  /help    — Hilfe
  /reset   — Gesprächsverlauf löschen
  /status  — Vault-Pfad, aktives Modell, Verlauf-Info
  /models  — Modell wechseln (Opus / Sonnet / Haiku)
Es gibt KEIN /config, KEIN /settings und keine anderen Befehle.
Wenn du auf Bot-Funktionen hinweist, verwende ausschließlich die obigen Befehle.
`.trim();

function buildPrompt(userMessage, history) {
  if (history.length === 0) return userMessage;
  const historyText = history
    .map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`)
    .join('\n\n');
  return `Previous conversation (for context):\n${historyText}\n\n---\nCurrent message: ${userMessage}`;
}

/**
 * Streams Claude's response.
 * @param {string}   userMessage
 * @param {Array}    history
 * @param {string}   vaultPath
 * @param {Function} onChunk     — called with each stdout chunk (for live updates)
 * @param {string}   model       — optional model ID (e.g. 'claude-opus-4-5')
 * @returns {Promise<string>}    — full response when done
 */
function askClaude(userMessage, history, vaultPath, onChunk = null, model = null) {
  return new Promise((resolve, reject) => {
    const prompt = buildPrompt(userMessage, history);

    const args = ['--print', '--dangerously-skip-permissions'];
    if (model) args.push('--model', model);
    args.push('--append-system-prompt', BOT_CONTEXT);

    const child = spawn('claude', args, {
      cwd: vaultPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_CODE_DISABLE_TELEMETRY: '1' },
    });

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', chunk => {
      const text = chunk.toString();
      output += text;
      if (onChunk) onChunk(output); // pass accumulated text so far
    });

    child.stderr.on('data', d => { errorOutput += d.toString(); });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('⏱ Timeout nach 3 Minuten'));
    }, TIMEOUT_MS);

    child.on('close', code => {
      clearTimeout(timer);
      const result = output.trim();
      if (result) resolve(result);
      else reject(new Error(errorOutput.trim() || `Exit code ${code}`));
    });

    child.on('error', err => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new Error(
          '❌ `claude` nicht gefunden.\n' +
          'npm install -g @anthropic-ai/claude-code'
        ));
      } else {
        reject(err);
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

module.exports = { askClaude };
