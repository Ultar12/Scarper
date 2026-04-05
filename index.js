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

// Usage: /withdraw 12000
bot.onText(/\/withdraw\s+(\d+)/, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    const withdrawAmount = match[1];
    bot.sendMessage(chatId, `[SYSTEM] Booting secure browser to withdraw ${withdrawAmount}...`);

    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: true,
            executablePath: getChromePath(),
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 412, height: 915 }); // Mobile viewport
        await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');

        // --- STEP 1: LOGIN ---
        bot.sendMessage(chatId, '[SYSTEM] Loading login page...');
        await page.goto('https://www.wsjobs-ng.com/login', { waitUntil: 'networkidle2' });

        // Find the input boxes (assuming they are the first two inputs on the page)
        const inputs = await page.$$('input');
        if (inputs.length >= 2) {
            await inputs[0].type('09163916311', { delay: 50 });
            await inputs[1].type('Emmamama', { delay: 50 });
        } else {
            throw new Error("Could not find the login input boxes.");
        }

        // Click the Login button
        const [loginBtn] = await page.$x("//*[contains(text(), 'Login')]");
        if (loginBtn) await loginBtn.click();
        
        // Wait for the home page to load
        await page.waitForNavigation({ waitUntil: 'networkidle2' });
        bot.sendMessage(chatId, '[SYSTEM] Login successful. Navigating to Account...');

        // --- STEP 2: NAVIGATE TO ACCOUNT ---
        // Click the "Account" tab at the bottom
        const [accountTab] = await page.$x("//*[contains(text(), 'Account')]");
        if (accountTab) await accountTab.click();
        await new Promise(r => setTimeout(r, 2000)); // Wait for tab switch

        // Click "Account Withdrawal"
        const [withdrawalLink] = await page.$x("//*[contains(text(), 'Account Withdrawal')]");
        if (withdrawalLink) await withdrawalLink.click();
        await new Promise(r => setTimeout(r, 3000)); // Wait for page load

        // --- STEP 3: SELECT AMOUNT & WITHDRAW ---
        bot.sendMessage(chatId, `[SYSTEM] Selecting amount: ${withdrawAmount}...`);
        
        // Click the specific amount box
        const [amountBox] = await page.$x(`//*[text()='${withdrawAmount}']`);
        if (amountBox) {
            await amountBox.click();
        } else {
            throw new Error(`Could not find a button for the amount: ${withdrawAmount}`);
        }
        await new Promise(r => setTimeout(r, 1000));

        // Click "Withdrawal Now"
        const [withdrawNowBtn] = await page.$x("//*[contains(text(), 'Withdrawal Now')]");
        if (withdrawNowBtn) await withdrawNowBtn.click();
        await new Promise(r => setTimeout(r, 2000));

        // --- STEP 4: CONFIRMATION PAGE ---
        bot.sendMessage(chatId, '[SYSTEM] Processing confirmation screen...');
        // We use exact match here so it doesn't accidentally click "Withdrawal Now" again
        const [confirmWithdrawalBtn] = await page.$x("//*[text()='Withdrawal']");
        if (confirmWithdrawalBtn) await confirmWithdrawalBtn.click();
        await new Promise(r => setTimeout(r, 2000));

        // --- STEP 5: ENTER PIN & FINALIZE ---
        bot.sendMessage(chatId, '[SYSTEM] Entering withdrawal password...');
        
        // Find the password inputs (the 6 boxes) and type the PIN
        // We focus the first box and simulate keyboard typing, which usually auto-fills the rest
        const pinInputs = await page.$$('input[type="password"], input[type="number"], input[type="text"]');
        if (pinInputs.length > 0) {
            await pinInputs[0].click();
            await page.keyboard.type('111111', { delay: 100 });
        } else {
            // Fallback: If inputs are hidden, just type on the active document
            await page.keyboard.type('111111', { delay: 100 });
        }
        await new Promise(r => setTimeout(r, 1000));

        // Click the final Confirm button
        const [finalConfirmBtn] = await page.$x("//*[text()='Confirm']");
        if (finalConfirmBtn) await finalConfirmBtn.click();
        
        bot.sendMessage(chatId, '[SYSTEM] Final confirmation submitted. Waiting for server response...');
        await new Promise(r => setTimeout(r, 5000)); // Wait for success message/redirect

        // Take a screenshot of the final success page
        const screenshotBuffer = await page.screenshot({ type: 'png' });
        await bot.sendPhoto(chatId, screenshotBuffer, { caption: `[SUCCESS] Withdrawal sequence completed.` });

    } catch (err) {
        // If anything fails, take a picture of the error so you can see what went wrong
        bot.sendMessage(chatId, `[ERROR] Sequence failed: ${err.message}\nTaking diagnostic screenshot...`);
        if (browser) {
            try {
                const pages = await browser.pages();
                if (pages.length > 0) {
                    const errBuffer = await pages[0].screenshot({ type: 'png' });
                    await bot.sendPhoto(chatId, errBuffer, { caption: '[DIAGNOSTIC] This is what the bot was looking at when it crashed.' });
                }
            } catch (snapErr) {
                console.log('Could not take diagnostic screenshot.');
            }
        }
    } finally {
        // --- STEP 6: RESOURCE MANAGEMENT ---
        // This absolutely guarantees the browser is destroyed and RAM is freed, even if it crashed.
        if (browser) {
            await browser.close();
            console.log('[SYSTEM] Withdrawal sequence ended. Browser destroyed, RAM freed.');
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
