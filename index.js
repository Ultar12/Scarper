const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { PostgresStore } = require('wwebjs-postgres');
const { Pool } = require('pg');
const QRCode = require('qrcode');

// --- 1. HEROKU POSTGRESQL SETUP ---
// Heroku requires SSL to be enabled but rejectUnauthorized set to false
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const store = new PostgresStore({ pool: pool });

// --- 2. HEROKU WEB SERVER SETUP ---
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('WhatsApp Bot running with Postgres Auth.'));
app.listen(PORT, () => console.log(`Web server listening on port ${PORT}`));

// --- 3. TELEGRAM BOT SETUP ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '7806461656:AAFJLm-gOKgKrvPY06b0QTE1fKlVR9waOsQ';
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const ADMIN_ID = process.env.ADMIN_ID || 'REPLACE_WITH_YOUR_ID'; 

let waClient = null;
const userState = {};

// --- 4. TELEGRAM COMMAND LISTENERS ---

bot.onText(/\/start/, (msg) => {
    if (msg.chat.id.toString() !== ADMIN_ID) return;
    bot.sendMessage(msg.chat.id, 'Bot Controller Online.\n\nCommands:\n/login - Connect your WhatsApp\n/status - Check connection state');
});

bot.onText(/\/login/, (msg) => {
    if (msg.chat.id.toString() !== ADMIN_ID) return;
    
    bot.sendMessage(msg.chat.id, '[SYSTEM] How do you want to connect your WhatsApp?', {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Scan QR Code', callback_data: 'login_qr' }],
                [{ text: 'Use Phone Number', callback_data: 'login_phone' }]
            ]
        }
    });
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    if (chatId.toString() !== ADMIN_ID) return;

    if (query.data === 'login_qr') {
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, '[SYSTEM] Initializing QR Code generation. Please wait...');
        initializeWhatsApp(chatId, null);
    }

    if (query.data === 'login_phone') {
        bot.answerCallbackQuery(query.id);
        userState[chatId] = 'WAITING_FOR_NUMBER';
        bot.sendMessage(chatId, '[SYSTEM] Reply to this message with your WhatsApp phone number (include country code, e.g., 2348000000000):');
    }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    if (userState[chatId] === 'WAITING_FOR_NUMBER' && !msg.text.startsWith('/')) {
        const phoneNumber = msg.text.replace(/[^0-9]/g, '');
        if (phoneNumber.length < 7) {
            bot.sendMessage(chatId, '[ERROR] Invalid phone number. Try again.');
            return;
        }

        userState[chatId] = null; 
        bot.sendMessage(chatId, `[SYSTEM] Initializing Pairing Code protocol for +${phoneNumber}...`);
        initializeWhatsApp(chatId, phoneNumber);
    }
});

bot.onText(/\/status/, (msg) => {
    if (msg.chat.id.toString() !== ADMIN_ID) return;
    const status = (waClient && waClient.info) ? 'ONLINE' : 'OFFLINE / WAITING FOR LOGIN';
    bot.sendMessage(msg.chat.id, `[SYSTEM] Current Status: ${status}`);
});

// --- 5. WHATSAPP CLIENT INITIALIZATION ---

async function initializeWhatsApp(chatId, targetPhoneNumber) {
    if (waClient) {
        bot.sendMessage(chatId, '[SYSTEM] Wiping old session memory before restarting...');
        await waClient.destroy().catch(() => {});
    }

    let pairingCodeRequested = false;

        waClient = new Client({
        authStrategy: new RemoteAuth({
            clientId: 'ultar_bot_session',
            store: store,
            backupSyncIntervalMs: 300000 
        }),
        puppeteer: {
            headless: true,
            // UPDATE THIS LINE TO CATCH THE NEW BUILDPACK
            executablePath: process.env.CHROME_BIN || process.env.GOOGLE_CHROME_BIN || 'chrome',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        }
    });


    // The 'qr' event fires when the browser has successfully loaded the WhatsApp Web DOM.
    // This is the absolute safest time to inject the Pairing Code request.
    waClient.on('qr', async (qr) => {
        if (targetPhoneNumber) {
            if (!pairingCodeRequested) {
                pairingCodeRequested = true;
                try {
                    const code = await waClient.requestPairingCode(targetPhoneNumber);
                    const formattedCode = code.match(/.{1,4}/g)?.join('-') || code;
                    bot.sendMessage(chatId, `[PAIRING CODE GENERATED]\n\nYour code is: \`${formattedCode}\`\n\nEnter this code in your WhatsApp notification.`, { parse_mode: 'Markdown' });
                } catch (err) {
                    bot.sendMessage(chatId, `[ERROR] Failed to generate pairing code: ${err.message}`);
                }
            }
        } else {
            // Generate QR image for standard scanning
            try {
                const qrBuffer = await QRCode.toBuffer(qr, { type: 'png', width: 400 });
                bot.sendPhoto(chatId, qrBuffer, { caption: '[SYSTEM] Scan this QR code.' });
            } catch (err) {
                bot.sendMessage(chatId, '[ERROR] Failed to render QR code image.');
            }
        }
    });

    waClient.on('ready', () => {
        bot.sendMessage(chatId, '[SUCCESS] WhatsApp Client is fully connected and authenticated.');
    });

    waClient.on('remote_session_saved', () => {
        bot.sendMessage(chatId, '[SYSTEM] Database Sync: Session zip successfully saved to PostgreSQL.');
    });

    waClient.on('disconnected', (reason) => {
        bot.sendMessage(chatId, `[SYSTEM] WhatsApp Client disconnected. Reason: ${reason}`);
    });

    waClient.on('message', async (msg) => {
        if (msg.body === '!ping') {
            await msg.reply('pong');
        }
    });

    try {
        await waClient.initialize();
    } catch (err) {
        bot.sendMessage(chatId, `[CRITICAL ERROR] Failed to boot Puppeteer: ${err.message}`);
    }
}

console.log('System booting. Waiting for Telegram commands...');

