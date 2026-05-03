# Claudegram 🤖

**Claudegram** is a Telegram bot that gives you full [Claude Code](https://claude.ai/code) access from your phone — including your Obsidian vault, file system, and any local codebase.

It bridges your Telegram chat directly to the Claude Code CLI running on your machine, so you get the same powerful AI assistant you know from the terminal — anywhere, anytime.

> Built for personal use. Single-user, your machine, your subscription. No API key needed.

---

## Features

- 💬 **Full Claude Code** — reads/writes files, runs Bash, edits code, manages your Obsidian vault
- ⚡ **Live streaming** — responses appear progressively as Claude thinks, no waiting in the dark
- 🎙️ **Voice messages** — send a voice note, Whisper transcribes it, Claude answers
- 🤖 **Model switching** — swap between Opus / Sonnet / Haiku via `/models` inline keyboard
- 🔒 **Single-user lock** — only your Telegram user ID can interact with the bot
- 💾 **Persistent history** — last 10 exchanges kept across restarts for context

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/help` | List of commands and capabilities |
| `/models` | Switch AI model (Opus / Sonnet / Haiku) |
| `/status` | Show vault path, active model, history stats |
| `/reset` | Clear conversation history |

---

## Requirements

- **Windows / macOS / Linux** with Node.js ≥ 18
- [Claude Code CLI](https://claude.ai/code) installed and authenticated (`npm install -g @anthropic-ai/claude-code`)
- An active **Claude subscription** (Max or Pro) — no API key needed
- A Telegram bot token (free, via [@BotFather](https://t.me/BotFather))
- **Optional (voice messages):** Python 3 + `pip install openai-whisper` + `ffmpeg`

## Setup

### 1. Clone and install

```bash
git clone https://github.com/xast1211/claudegram.git
cd claudegram
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
TELEGRAM_TOKEN=your_bot_token_here      # from @BotFather
TELEGRAM_USER_ID=your_telegram_user_id  # from @userinfobot
VAULT_PATH=C:\Users\you\Documents\Vault # absolute path to your Obsidian vault (or any folder)
```

**Get your Telegram user ID:** Message [@userinfobot](https://t.me/userinfobot) on Telegram.

### 3. Authenticate Claude Code

```bash
claude auth login
```

Make sure Claude Code works interactively first: `claude` in your terminal.

### 4. Run

```bash
npm start
```

Or for development (auto-restart on file changes):

```bash
npm run dev
```

---

## Obsidian Integration (optional)

`VAULT_PATH` can point to **any folder** — it doesn't have to be an Obsidian vault. Claude will have full read/write access to whatever directory you point it at.

If you use Obsidian and want Claude to understand your vault structure, naming conventions, and context, add a `CLAUDE.md` file to your vault root. This is a plain markdown file that tells Claude how your vault is organized, what projects are active, and any rules you want it to follow.

Example `CLAUDE.md` structure:

```markdown
# Vault Context

## About me
...

## Folder structure
- **Projects/**: Active projects
- **Daily Notes/**: Daily logs
...

## Rules
- Use [[wikilinks]] for internal links
- New notes without a clear place go into Inbox/
...
```

Claude Code has native understanding of Markdown, wikilinks, and frontmatter — the `CLAUDE.md` just adds your personal context on top.

---

## Voice Messages (optional)

Install Whisper and ffmpeg:

```bash
pip install openai-whisper
```

**Windows:** Download [ffmpeg](https://github.com/BtbN/FFmpeg-Builds/releases) and place `ffmpeg.exe` in the `bin/` folder.  
**macOS/Linux:** `brew install ffmpeg` or `apt install ffmpeg`

The `base` Whisper model (~150 MB) downloads automatically on first use. Language is set to German by default — change `--language de` in `src/bot.js` if needed.

---

## Autostart (Windows)

Using PM2:

```bash
npm install -g pm2
cd path\to\claudegram
pm2 start src/index.js --name claudegram
pm2 save
pm2-startup install   # sets up Windows Task Scheduler entry
```

---

## How it works

```
You (Telegram) ──► bot.js ──► claude.js ──► claude CLI (--print --dangerously-skip-permissions)
                                                │
                                         cwd = VAULT_PATH
                                         (full file access)
```

- `bot.js` — grammY Telegram bot, handles commands and message routing
- `claude.js` — spawns `claude` CLI, streams stdout back via `onChunk` callback
- `history.js` — persists last 20 messages to `data/history.json`
- `config.js` — persists model selection to `data/config.json`

Responses stream progressively: the bot sends a placeholder message immediately and edits it every 1.5 seconds as Claude outputs text.

---

## Security

- **Single-user only** — `TELEGRAM_USER_ID` is checked on every message. Unauthorized users get a `⛔` reply and nothing else.
- **Your machine, your data** — nothing leaves your system except to Telegram and Anthropic's API.
- **`--dangerously-skip-permissions`** — Claude Code normally asks for permission before touching files. This flag skips those prompts. Only use this bot on a machine you control.

---

## Project structure

```
claudegram/
├── src/
│   ├── index.js      # Entry point
│   ├── bot.js        # Telegram bot logic (grammY)
│   ├── claude.js     # Claude CLI wrapper with streaming
│   ├── history.js    # Conversation persistence
│   └── config.js     # Model selection persistence
├── data/             # Runtime data (gitignored except .gitkeep)
├── bin/              # Place ffmpeg.exe here on Windows (gitignored)
├── .env.example      # Config template
└── package.json
```

---

## License

MIT — built by [Patrick Franke](https://github.com/xast1211)
