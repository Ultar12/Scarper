const fs = require('fs');
const { execSync } = require('child_process');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { PostgresStore } = require('wwebjs-postgres');
const { Pool } = require('pg');
const puppeteer = require('puppeteer'); 
const QRCode = require('qrcode');

// --- BULLETPROOF CHROME LOCATOR ---
function getChromePath() {
    const possiblePaths = [
        process.env.GOOGLE_CHROME_BIN,
        process.env.CHROME_BIN,
        process.env.GOOGLE_CHROME_SHIM,
        '/app/.chrome-for-testing/chrome-linux64/chrome', // The exact path from your Heroku build log
        '/usr/bin/google-chrome'
    ];
    
    for (const path of possiblePaths) {
        if (path && fs.existsSync(path)) {
            console.log(`[SYSTEM] Found Chrome at: ${path}`);
            return path;
        }
    }
    
    try {
        const osPath = execSync('which chrome').toString().trim();
        console.log(`[SYSTEM] OS located Chrome at: ${osPath}`);
        return osPath;
    } catch (e) {
        console.log('[ERROR] Could not locate Chrome path automatically.');
        return null;
    }
}

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

// Usage: /screenshot https://google.com
bot.onText(/\/screenshot\s+(.+)/, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    let targetUrl = match[1].trim();
    if (!targetUrl.startsWith('http')) {
        targetUrl = 'https://' + targetUrl; // Auto-fix URLs missing the https prefix
    }

    bot.sendMessage(chatId, `[SYSTEM] Booting camera for: ${targetUrl}`);

    let tempBrowser = null;
    try {
        tempBrowser = await puppeteer.launch({
            headless: true,
            executablePath: getChromePath(),
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });

        const page = await tempBrowser.newPage();
        
        // Set the screen size for a clear desktop screenshot
        await page.setViewport({ width: 1280, height: 800 });
        
        bot.sendMessage(chatId, '[SYSTEM] Rendering webpage...');
        await page.goto(targetUrl, { waitUntil: 'networkidle2' });
        
        // Capture the raw image buffer
        const screenshotBuffer = await page.screenshot({ type: 'png' });
        
        await bot.sendPhoto(chatId, screenshotBuffer, { caption: `[SUCCESS] Captured: ${targetUrl}` });

    } catch (err) {
        bot.sendMessage(chatId, `[ERROR] Screenshot failed: ${err.message}`);
    } finally {
        // ALWAYS destroy the temp browser to prevent Heroku from crashing
        if (tempBrowser) await tempBrowser.close();
    }
});


// Usage: /checknum 2348000000000
bot.onText(/\/checknum\s+(.+)/, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    if (!waClient || !waClient.info) {
        return bot.sendMessage(chatId, '[ERROR] WhatsApp client is not connected. Please /login first.');
    }

    const targetNumber = match[1].replace(/[^0-9]/g, '');

    if (targetNumber.length < 7) {
        return bot.sendMessage(chatId, '[ERROR] Invalid phone number format.');
    }

    bot.sendMessage(chatId, `[SYSTEM] Querying Meta servers for raw data on: +${targetNumber}...`);

    try {
        const result = await waClient.getNumberId(targetNumber);

        if (result) {
            // Convert the raw JSON object into a formatted, readable string
            const rawData = JSON.stringify(result, null, 2);
            
            // Send it back wrapped in a Markdown code block
            bot.sendMessage(chatId, `[SUCCESS] Registered on WhatsApp.\n\nRaw Protocol Data:\n\`\`\`json\n${rawData}\n\`\`\``, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, `[RESULT] The number +${targetNumber} is NOT registered on WhatsApp.\n\nRaw Result: \`null\``, { parse_mode: 'Markdown' });
        }

    } catch (err) {
        bot.sendMessage(chatId, `[ERROR] Failed to query Meta database: ${err.message}`);
    }
});



// Usage: /withdraw 20000
bot.onText(/\/withdraw\s+(\d+)/, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    const withdrawAmount = match[1];

    let statusMsg = await bot.sendMessage(chatId, `[SYSTEM] Booting secure browser to withdraw ${withdrawAmount}...`);
    const msgId = statusMsg.message_id;

    const updateStatus = async (text) => {
        await bot.editMessageText(text, { chat_id: chatId, message_id: msgId }).catch(() => {});
    };

    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: true,
            executablePath: getChromePath(),
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 412, height: 915 }); 
        await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');

        // --- STEP 1: LOGIN ---
        await updateStatus('[SYSTEM] Loading login page...');
        await page.goto('https://www.wsjobs-ng.com/login', { waitUntil: 'networkidle2' });

        const inputs = await page.$$('input');
        if (inputs.length >= 2) {
            await inputs[0].type('09163916311', { delay: 50 });
            await inputs[1].type('Emmamama', { delay: 50 });
        }
        
        // Using the new Locator API from your documentation!
        await page.locator('::-p-text(Login)').click();
        
        await updateStatus('[SYSTEM] Login submitted. Securing authentication token...');
        await new Promise(r => setTimeout(r, 4000)); 

        // 📸 REQUESTED SCREENSHOT: HOME PAGE
        const homeSnap = await page.screenshot({ type: 'png' });
        await bot.sendPhoto(chatId, homeSnap, { caption: '[TRACE 1] Logged in successfully. (Home Page)' });

        // --- STEP 2: THE SHORTCUT (TELEPORT TO USER) ---
        await updateStatus('[SYSTEM] Bypassing popups: Teleporting directly to User Dashboard...');
        await page.goto('https://www.wsjobs-ng.com/user', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 3000)); // Let the User page load

        // 📸 REQUESTED SCREENSHOT: USER PAGE
        const userSnap = await page.screenshot({ type: 'png' });
        await bot.sendPhoto(chatId, userSnap, { caption: '[TRACE 2] Teleported successfully. (User Page)' });

        // Using the Locator API
        await updateStatus('[SYSTEM] Clicking "Account Withdrawal"...');
        await page.locator('::-p-text(Account Withdrawal)').click();
        await new Promise(r => setTimeout(r, 3000)); // Wait for Withdrawal Page to load

        // --- STEP 3: THE GEOMETRIC SMART CLICKER ---
        await updateStatus(`[SYSTEM] Selecting amount: ${withdrawAmount}...`);
        
        // While Locators are amazing, we keep the Geometric Snipe specifically for the amount box
        // to guarantee it ignores the "Minimum withdrawal amount..." instruction text at the bottom.
        const amountClicked = await page.evaluate((amount) => {
            const allElements = Array.from(document.querySelectorAll('*'));
            let targetNode = null;
            let smallestArea = Infinity;

            for (let el of allElements) {
                const text = (el.innerText || el.textContent || '').trim();
                if (text.includes(amount)) {
                    if (text.includes('Withdrawable') || text.includes('Minimum') || text.includes('Maximum')) {
                        continue;
                    }
                    
                    const rect = el.getBoundingClientRect();
                    const area = rect.width * rect.height;
                    
                    // el.offsetParent !== null ensures we only click a visible button
                    if (area > 0 && area < smallestArea && el.offsetParent !== null) {
                        smallestArea = area;
                        targetNode = el;
                    }
                }
            }

            if (targetNode) {
                targetNode.scrollIntoView({ block: 'center' });
                targetNode.click();
                return true;
            }
            return false;
        }, withdrawAmount);

        if (!amountClicked) throw new Error(`Could not locate the physical button for: ${withdrawAmount}`);
        await new Promise(r => setTimeout(r, 1500));

        // Using the Locator API
        await updateStatus(`[SYSTEM] Clicking "Withdrawal Now"...`);
        await page.locator('::-p-text(Withdrawal Now)').click();
        await new Promise(r => setTimeout(r, 2000));

        // --- STEP 4: CONFIRMATION PAGE ---
        await updateStatus('[SYSTEM] Processing confirmation screen...');
        await page.locator('::-p-text(Withdrawal)').click();
        await new Promise(r => setTimeout(r, 2000));

        // --- STEP 5: ENTER PIN & FINALIZE ---
        await updateStatus('[SYSTEM] Entering withdrawal password (111111)...');
        const pinInputs = await page.$$('input[type="password"], input[type="number"], input[type="text"]');
        if (pinInputs.length > 0) {
            await pinInputs[0].click();
            await page.keyboard.type('111111', { delay: 100 });
        } else {
            await page.keyboard.type('111111', { delay: 100 });
        }
        await new Promise(r => setTimeout(r, 1500));

        // Using the Locator API
        await updateStatus('[SYSTEM] Clicking final Confirm button...');
        await page.locator('::-p-text(Confirm)').click();
        
        await updateStatus('[SYSTEM] Final confirmation submitted. Waiting for server response...');
        await new Promise(r => setTimeout(r, 5000)); 

        await updateStatus(`[SUCCESS] Withdrawal of ${withdrawAmount} sequence completed.`);
        
        // 📸 FINAL SCREENSHOT
        const screenshotBuffer = await page.screenshot({ type: 'png' });
        await bot.sendPhoto(chatId, screenshotBuffer, { caption: `[SUCCESS] Transaction Final State` });

    } catch (err) {
        await updateStatus(`[ERROR] Sequence failed: ${err.message}`);
        if (browser) {
            try {
                // Hard pause to give the browser time to render whatever error crashed it before snapping the pic
                await new Promise(r => setTimeout(r, 2000));
                const pages = await browser.pages();
                if (pages.length > 0) {
                    const errBuffer = await pages[0].screenshot({ type: 'png' });
                    await bot.sendPhoto(chatId, errBuffer, { caption: '[DIAGNOSTIC] The screen at the exact moment of failure.' });
                }
            } catch (snapErr) {}
        }
    } finally {
        if (browser) {
            await browser.close();
        }
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

    let clientConfig = {
        authStrategy: new RemoteAuth({
            clientId: 'ultar_bot_session',
            store: store,
            backupSyncIntervalMs: 300000 
        }),
        puppeteer: {
            headless: true,
            executablePath: getChromePath(),
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
    };

    if (targetPhoneNumber) {
        clientConfig.pairWithPhoneNumber = { phoneNumber: targetPhoneNumber };
    }

    waClient = new Client(clientConfig);

    // THE LATCH: Prevents the bot from spamming you with duplicate codes
    let codeSent = false; 

    waClient.on('code', (code) => {
        if (codeSent) return; // If the latch is locked, ignore the duplicate request
        codeSent = true;      // Lock the latch immediately after receiving the first code
        
        const formattedCode = code.match(/.{1,4}/g)?.join('-') || code;
        bot.sendMessage(chatId, `[PAIRING CODE GENERATED]\n\nYour code is: \`${formattedCode}\`\n\nEnter this code in your WhatsApp notification.`, { parse_mode: 'Markdown' });
    });

    waClient.on('qr', async (qr) => {
        if (!targetPhoneNumber) {
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
