/**
 * index.js — Einstiegspunkt Claudegram.
 */

require('dotenv').config();
const { createBot } = require('./bot');

const TOKEN        = process.env.TELEGRAM_TOKEN;
const ALLOWED_USER = process.env.TELEGRAM_USER_ID;
const VAULT_PATH   = process.env.VAULT_PATH || 'C:\\ai\\xast';

if (!TOKEN)        { console.error('❌ TELEGRAM_TOKEN fehlt in .env');    process.exit(1); }
if (!ALLOWED_USER) { console.error('❌ TELEGRAM_USER_ID fehlt in .env'); process.exit(1); }

const bot = createBot(TOKEN, ALLOWED_USER, VAULT_PATH);

// Graceful shutdown
const shutdown = () => { bot.stop(); console.log('\n👋 Bot gestoppt.'); process.exit(0); };
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

bot.start();
