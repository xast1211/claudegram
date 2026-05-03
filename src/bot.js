/**
 * bot.js — Telegram bot logic using grammY.
 * Only responds to the configured TELEGRAM_USER_ID.
 * Features: progressive message editing, voice message support via Whisper.
 */

const { Bot, InlineKeyboard } = require('grammy');
const { spawn }               = require('child_process');
const fs                      = require('fs');
const path                    = require('path');
const os                      = require('os');
const { askClaude }           = require('./claude');
const {
  loadHistory,
  saveHistory,
  addToHistory,
  clearHistory,
  historyStats,
} = require('./history');
const { MODELS, loadConfig, saveConfig } = require('./config');

const MAX_MSG_LENGTH   = 4096;
const EDIT_INTERVAL_MS = 1500;   // how often to push live updates
// Whisper CLI — try PATH first, fall back to known install locations
const WHISPER_FALLBACK = [
  path.join(
    process.env.LOCALAPPDATA || '',
    'Packages',
    'PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0',
    'LocalCache', 'local-packages', 'Python313', 'Scripts', 'whisper.exe'
  ),
  'C:\\Python313\\Scripts\\whisper.exe',
  'C:\\Python312\\Scripts\\whisper.exe',
].filter(p => p);
const WHISPER_CMD = 'whisper';

// ffmpeg — bundled binary takes priority over whatever is on PATH
const FFMPEG_BUNDLED = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');

// ── helpers ────────────────────────────────────────────────────────────────

/** Split long text into ≤4096-char chunks at newline boundaries. */
function splitMessage(text) {
  if (text.length <= MAX_MSG_LENGTH) return [text];
  const parts = [];
  let remaining = text.trim();
  while (remaining.length > 0) {
    if (remaining.length <= MAX_MSG_LENGTH) { parts.push(remaining); break; }
    const boundary = remaining.lastIndexOf('\n', MAX_MSG_LENGTH);
    const end = boundary > MAX_MSG_LENGTH * 0.75 ? boundary : MAX_MSG_LENGTH;
    parts.push(remaining.slice(0, end));
    remaining = remaining.slice(end).trim();
  }
  return parts;
}

/** Send message — try Markdown, fall back to plain text. */
async function safeSend(ctx, text) {
  for (const part of splitMessage(text)) {
    try {
      await ctx.reply(part, { parse_mode: 'Markdown' });
    } catch {
      await ctx.reply(part);
    }
  }
}

/** Edit an existing message — try Markdown, fall back to plain text. */
async function safeEdit(bot, chatId, msgId, text) {
  // Trim to limit; append ellipsis if still streaming
  const display = text.length > MAX_MSG_LENGTH
    ? text.slice(0, MAX_MSG_LENGTH - 4) + '\n…'
    : text;
  try {
    await bot.api.editMessageText(chatId, msgId, display, { parse_mode: 'Markdown' });
  } catch {
    try {
      await bot.api.editMessageText(chatId, msgId, display);
    } catch { /* ignore "message not modified" */ }
  }
}

/**
 * Transcribe an OGG/Opus voice file to text using local Whisper.
 * Returns the transcribed string, or throws on error.
 */
function transcribeWithWhisper(filePath) {
  return new Promise((resolve, reject) => {
    const outDir = path.dirname(filePath);

    // Resolve whisper binary: fallback list → PATH
    let whisperBin = WHISPER_CMD;
    for (const fb of WHISPER_FALLBACK) {
      if (fb && fs.existsSync(fb)) { whisperBin = fb; break; }
    }

    // Build PATH that includes bundled ffmpeg directory
    const extraPaths = [];
    if (fs.existsSync(FFMPEG_BUNDLED)) {
      extraPaths.push(path.dirname(FFMPEG_BUNDLED));
    }
    const childEnv = {
      ...process.env,
      PATH: [...extraPaths, process.env.PATH || ''].join(path.delimiter),
    };

    console.log(`[whisper] bin=${whisperBin}  ffmpeg=${fs.existsSync(FFMPEG_BUNDLED) ? FFMPEG_BUNDLED : 'PATH'}`);

    const child = spawn(whisperBin, [
      filePath,
      '--model',         'base',
      '--language',      'de',
      '--output_format', 'txt',
      '--output_dir',    outDir,
      '--fp16',          'False',
    ], { env: childEnv });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`Whisper exit ${code}:\n${(stderr || stdout).slice(0, 400)}`));
        return;
      }

      // Whisper creates <basename>.txt — try a few naming variations
      const base     = path.basename(filePath, path.extname(filePath));
      const txtPath  = path.join(outDir, base + '.txt');
      const txtPath2 = path.join(outDir, path.basename(filePath) + '.txt'); // some versions keep .ogg

      for (const p of [txtPath, txtPath2]) {
        if (fs.existsSync(p)) {
          const text = fs.readFileSync(p, 'utf8').trim();
          resolve(text || '(keine Sprache erkannt)');
          return;
        }
      }

      // Fallback: scan outDir for any .txt created in the last 30s
      const now = Date.now();
      const recent = fs.readdirSync(outDir)
        .map(f => path.join(outDir, f))
        .filter(f => f.endsWith('.txt') && (now - fs.statSync(f).mtimeMs) < 30000);
      if (recent.length > 0) {
        const text = fs.readFileSync(recent[0], 'utf8').trim();
        resolve(text || '(keine Sprache erkannt)');
        return;
      }

      reject(new Error(
        `Whisper lief durch (exit 0) aber erzeugte keine Textdatei.\n` +
        `Whisper stderr: ${stderr.slice(0, 300)}`
      ));
    });

    child.on('error', err => {
      if (err.code === 'ENOENT') {
        reject(new Error(
          '❌ `whisper` nicht gefunden.\n' +
          'Lösung: pip install openai-whisper  (dann Bot neu starten)'
        ));
      } else {
        reject(err);
      }
    });
  });
}

// ── bot factory ────────────────────────────────────────────────────────────

function createBot(token, allowedUserId, vaultPath) {
  const bot = new Bot(token);
  let history = loadHistory();
  let config  = loadConfig();

  const isAllowed = ctx => String(ctx.from?.id) === String(allowedUserId);

  const guard = (handler) => async (ctx) => {
    if (!isAllowed(ctx)) { await ctx.reply('⛔ Nicht autorisiert.'); return; }
    await handler(ctx);
  };

  console.log('✅ Claudegram gestartet');
  console.log(`👤 Erlaubt: User ID ${allowedUserId}`);
  console.log(`📁 Vault:   ${vaultPath}`);
  console.log('──────────────────────────────');

  // ── /start ─────────────────────────────────────────────────────────────────
  bot.command('start', guard(async ctx => {
    await ctx.reply(
      '👋 *Claudegram* ist bereit\\!\n\n' +
      '🤖 Ich bin Claudian — dein Obsidian\\-Assistent\\.\n' +
      '📁 Vault\\-Zugriff aktiv\n\n' +
      '*Befehle:*\n' +
      '`/reset` — Gesprächsverlauf löschen\n' +
      '`/status` — Systeminfo\n' +
      '`/help` — Hilfe\n\n' +
      'Einfach schreiben oder Sprachnachricht senden\\!',
      { parse_mode: 'MarkdownV2' }
    );
  }));

  // ── /help ──────────────────────────────────────────────────────────────────
  bot.command('help', guard(async ctx => {
    await ctx.reply(
      '*Claudegram — Hilfe*\n\n' +
      '`/reset` — Gesprächsverlauf löschen\n' +
      '`/status` — Vault-Pfad & Verlauf-Info\n\n' +
      '*Was ich kann:*\n' +
      '• Notizen lesen und schreiben\n' +
      '• Vault durchsuchen\n' +
      '• Code ausführen (Bash)\n' +
      '• Projekte & Daily Notes verwalten\n' +
      '• Sprachnachrichten transkribieren (Whisper)\n' +
      '• Die letzten 10 Nachrichten als Kontext\n\n' +
      '_Antworten werden live aktualisiert während Claudian denkt._',
      { parse_mode: 'Markdown' }
    );
  }));

  // ── /reset ─────────────────────────────────────────────────────────────────
  bot.command('reset', guard(async ctx => {
    history = clearHistory();
    await ctx.reply('🗑 Verlauf gelöscht. Frischer Start!');
  }));

  // ── /status ────────────────────────────────────────────────────────────────
  bot.command('status', guard(async ctx => {
    const { total, userMsgs } = historyStats(history);
    const cur = MODELS.find(m => m.id === config.model) || { emoji: '🤖', label: config.model };
    await ctx.reply(
      `📊 *Status*\n\n` +
      `📁 Vault: \`${vaultPath}\`\n` +
      `${cur.emoji} Modell: \`${config.model}\`\n` +
      `💬 Verlauf: ${total} Einträge (${userMsgs} Fragen)\n` +
      `🕒 ${new Date().toLocaleString('de-DE')}`,
      { parse_mode: 'Markdown' }
    );
  }));

  // ── /models ────────────────────────────────────────────────────────────────
  /** Build the inline keyboard for model selection */
  function buildModelKeyboard() {
    const kb = new InlineKeyboard();
    MODELS.forEach(m => {
      const active = m.id === config.model;
      kb.text(
        `${active ? '✅ ' : ''}${m.emoji} ${m.label}${active ? ' (aktiv)' : ''}`,
        `model:${m.id}`
      ).row();
    });
    return kb;
  }

  bot.command('models', guard(async ctx => {
    const cur = MODELS.find(m => m.id === config.model) || MODELS[1];
    await ctx.reply(
      `🤖 *Modell wählen*\n\n` +
      `Aktuell: ${cur.emoji} *${cur.label}* \`(${cur.id})\`\n\n` +
      MODELS.map(m => `${m.emoji} *${m.label}* — ${m.desc}`).join('\n'),
      { parse_mode: 'Markdown', reply_markup: buildModelKeyboard() }
    );
  }));

  // Callback: model:<id>
  bot.callbackQuery(/^model:(.+)$/, async ctx => {
    if (String(ctx.from?.id) !== String(allowedUserId)) {
      await ctx.answerCallbackQuery('⛔ Nicht autorisiert.');
      return;
    }
    const modelId = ctx.match[1];
    const model   = MODELS.find(m => m.id === modelId);
    if (!model) {
      await ctx.answerCallbackQuery('❌ Unbekanntes Modell.');
      return;
    }
    config.model = modelId;
    saveConfig(config);

    // Update the message inline keyboard to reflect new selection
    await ctx.editMessageText(
      `🤖 *Modell wählen*\n\n` +
      `Aktuell: ${model.emoji} *${model.label}* \`(${model.id})\`\n\n` +
      MODELS.map(m => `${m.emoji} *${m.label}* — ${m.desc}`).join('\n'),
      { parse_mode: 'Markdown', reply_markup: buildModelKeyboard() }
    );
    await ctx.answerCallbackQuery(`${model.emoji} ${model.label} aktiviert!`);
    console.log(`[model] switched to ${modelId}`);
  });

  // ── core ask handler ───────────────────────────────────────────────────────
  /**
   * Sends "⏳" placeholder, streams Claude's response as live edits,
   * then sends overflow parts if the final answer exceeds 4096 chars.
   */
  async function handleQuery(ctx, userText) {
    // Send placeholder immediately so user sees activity
    const placeholder = await ctx.reply('⏳ _Denke nach…_', { parse_mode: 'Markdown' });
    const chatId = placeholder.chat.id;
    const msgId  = placeholder.message_id;

    // Typing indicator refresh
    const typingInterval = setInterval(
      () => ctx.replyWithChatAction('typing').catch(() => {}),
      4000
    );

    // Periodic edit interval — fires every EDIT_INTERVAL_MS with latest chunk
    let lastEditedText = '';
    const editInterval = setInterval(async () => {
      if (lastEditedText && lastEditedText !== '⏳ _Denke nach…_') {
        await safeEdit(bot, chatId, msgId, lastEditedText);
      }
    }, EDIT_INTERVAL_MS);

    try {
      console.log(`→ [${new Date().toLocaleTimeString()}] "${userText.slice(0, 60)}"`);

      const response = await askClaude(userText, history, vaultPath, (accumulated) => {
        lastEditedText = accumulated; // store latest; interval will push it
      }, config.model);

      console.log(`← ${response.length} Zeichen`);

      history = addToHistory(history, 'user', userText);
      history = addToHistory(history, 'assistant', response);
      saveHistory(history);

      clearInterval(editInterval);
      clearInterval(typingInterval);

      const parts = splitMessage(response);

      // Replace placeholder with first part
      await safeEdit(bot, chatId, msgId, parts[0]);

      // Send any overflow parts as new messages
      for (let i = 1; i < parts.length; i++) {
        await safeSend(ctx, parts[i]);
      }

    } catch (err) {
      clearInterval(editInterval);
      clearInterval(typingInterval);
      console.error('[Fehler]', err.message);
      try {
        await bot.api.editMessageText(chatId, msgId, `⚠️ Fehler: ${err.message}`);
      } catch {
        await ctx.reply(`⚠️ Fehler: ${err.message}`);
      }
    }
  }

  // ── Textnachrichten ────────────────────────────────────────────────────────
  bot.on('message:text', guard(async ctx => {
    const text = ctx.message.text.trim();
    if (!text) return;
    await handleQuery(ctx, text);
  }));

  // ── Sprachnachrichten ──────────────────────────────────────────────────────
  bot.on('message:voice', guard(async ctx => {
    const statusMsg = await ctx.reply('🎙 _Transkribiere Sprachnachricht…_', { parse_mode: 'Markdown' });
    const chatId    = statusMsg.chat.id;
    const msgId     = statusMsg.message_id;

    let tmpOgg = null;
    try {
      // Download voice file from Telegram
      const fileId   = ctx.message.voice.file_id;
      const fileInfo = await bot.api.getFile(fileId);
      const fileUrl  = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;

      tmpOgg = path.join(os.tmpdir(), `voice_${Date.now()}.ogg`);

      // Fetch OGG to temp file
      await downloadFile(fileUrl, tmpOgg);

      await bot.api.editMessageText(chatId, msgId, '🎙 _Sprachnachricht erkannt — Claudian antwortet…_', { parse_mode: 'Markdown' });

      // Transcribe
      const transcribed = await transcribeWithWhisper(tmpOgg);
      console.log(`🎙 Transkription: "${transcribed.slice(0, 80)}"`);

      if (!transcribed) {
        await bot.api.editMessageText(chatId, msgId, '⚠️ Konnte Sprachnachricht nicht transkribieren.');
        return;
      }

      // Show what was understood
      await bot.api.editMessageText(chatId, msgId,
        `🎙 _"${transcribed}"_\n\n⏳ _Denke nach…_`,
        { parse_mode: 'Markdown' }
      );

      // Forward to Claude (reuse handleQuery but we already have status msg)
      // We'll call askClaude directly here so we can update the same message
      const typingInterval = setInterval(
        () => ctx.replyWithChatAction('typing').catch(() => {}),
        4000
      );
      let lastEditedText = '';
      const editInterval = setInterval(async () => {
        if (lastEditedText) {
          const preview = lastEditedText.length > 3800
            ? lastEditedText.slice(0, 3800) + '\n…'
            : lastEditedText;
          try {
            await bot.api.editMessageText(chatId, msgId,
              `🎙 _"${transcribed.slice(0, 60)}${transcribed.length > 60 ? '…' : ''}"_\n\n${preview}`,
              { parse_mode: 'Markdown' }
            );
          } catch { /* ignore not modified */ }
        }
      }, EDIT_INTERVAL_MS);

      const response = await askClaude(transcribed, history, vaultPath, (acc) => {
        lastEditedText = acc;
      }, config.model);

      clearInterval(editInterval);
      clearInterval(typingInterval);

      history = addToHistory(history, 'user', `[Sprachnachricht] ${transcribed}`);
      history = addToHistory(history, 'assistant', response);
      saveHistory(history);

      const parts = splitMessage(response);
      const header = `🎙 _"${transcribed.slice(0, 60)}${transcribed.length > 60 ? '…' : ''}"_\n\n`;

      // First part replaces the status message
      try {
        await bot.api.editMessageText(chatId, msgId, header + parts[0], { parse_mode: 'Markdown' });
      } catch {
        await bot.api.editMessageText(chatId, msgId, header + parts[0]);
      }

      // Overflow
      for (let i = 1; i < parts.length; i++) {
        await safeSend(ctx, parts[i]);
      }

    } catch (err) {
      console.error('[Voice Fehler]', err.message);
      try {
        await bot.api.editMessageText(chatId, msgId, `⚠️ ${err.message}`);
      } catch {
        await ctx.reply(`⚠️ ${err.message}`);
      }
    } finally {
      // Clean up temp files
      if (tmpOgg) {
        try { fs.unlinkSync(tmpOgg); } catch {}
        const txtPath = tmpOgg.replace(/\.ogg$/, '.txt');
        try { fs.unlinkSync(txtPath); } catch {}
      }
    }
  }));

  return bot;
}

/** Download a URL to a local file path using Node's https module. */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const https   = require('https');
    const http    = require('http');
    const client  = url.startsWith('https') ? https : http;
    const file    = fs.createWriteStream(dest);
    client.get(url, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`Download fehlgeschlagen: HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

module.exports = { createBot };
