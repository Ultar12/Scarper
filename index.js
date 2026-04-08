const fs = require('fs');
const { execSync } = require('child_process');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { PostgresStore } = require('wwebjs-postgres');
const { Pool } = require('pg');
const path = require('path');
const puppeteer = require('puppeteer'); 
const QRCode = require('qrcode');


const screenshotBuffer = await pages[0].screenshot({ type: 'png' });

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

// --- BROWSER SESSION DATABASE MANAGER ---
pool.query(`CREATE TABLE IF NOT EXISTS browser_sessions (platform VARCHAR(50) PRIMARY KEY, cookies JSONB);`)
    .then(() => pool.query(`ALTER TABLE browser_sessions ADD COLUMN IF NOT EXISTS local_storage JSONB;`))
    .then(() => console.log('[SYSTEM] Browser Session DB Ready.'))
    .catch(console.error);

const saveSessionToDB = async (platform, page) => {
    try {
        const cookies = await page.cookies();
        // Extract all cache/localStorage
        const localStorageData = await page.evaluate(() => Object.assign({}, window.localStorage));
        
        await pool.query(
            `INSERT INTO browser_sessions (platform, cookies, local_storage) VALUES ($1, $2, $3) 
             ON CONFLICT (platform) DO UPDATE SET cookies = EXCLUDED.cookies, local_storage = EXCLUDED.local_storage`,
            [platform, JSON.stringify(cookies), JSON.stringify(localStorageData)]
        );
        console.log(`[SYSTEM] Saved ${platform} cookies and cache to Database.`);
    } catch (err) {
        console.error(`[ERROR] Failed to save session to DB:`, err);
    }
};

const loadSessionFromDB = async (platform, page) => {
    try {
        const res = await pool.query(`SELECT cookies, local_storage FROM browser_sessions WHERE platform = $1`, [platform]);
        if (res.rows.length > 0) {
            const { cookies, local_storage } = res.rows[0];
            
            if (cookies && cookies.length > 0) {
                await page.setCookie(...cookies);
            }
            if (local_storage && Object.keys(local_storage).length > 0) {
                await page.evaluate((ls) => {
                    for (let key in ls) window.localStorage.setItem(key, ls[key]);
                }, local_storage);
            }
            console.log(`[SYSTEM] Loaded ${platform} cookies and cache from Database.`);
            return true;
        }
    } catch (err) {
        console.error(`[ERROR] Failed to load session from DB:`, err);
    }
    return false;
};

// Global variables to track open tabs and handle the 1-hour idle timeout
let activeTaskPages = [];
let taskIdleTimer = null;

  // Variables to track profit
let initialBalanceText = "0";
let initialBalanceNum = 0;


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
let globalTaskBrowser = null;
const userState = {};


// --- AUTOMATIC ONBOARDING SWEEPER (BACKGROUND ENGINE) ---
async function clearOnboardingPopups(page, updateStatus) {
    try {
        if (updateStatus) await updateStatus('[SYSTEM] Waiting for website to spawn tutorial popups...');
        
        // Force the bot to wait up to 10 seconds for the popup to actually appear
        await page.waitForFunction(() => {
            const bodyText = document.body.innerText.toLowerCase();
            return bodyText.includes('1 of 6') || bodyText.includes('next →') || bodyText.includes('done');
        }, { timeout: 10000 });
        
        if (updateStatus) await updateStatus('[SYSTEM] Popups detected! Engaging aggressive background sweeper...');
        let clickCount = 0;
        
        // Loop 20 times to smash through all 6 steps completely
        for (let i = 0; i < 20; i++) {
            const clicked = await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('*'));
                // Reverse read to hit the top overlay layer first
                for (let el of elements.reverse()) { 
                    if (el.offsetParent === null) continue;
                    const txt = (el.innerText || '').trim().toLowerCase();
                    
                    if (txt === 'next' || txt === 'next →' || txt === 'done') {
                        // Ghost-click bypass
                        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                        el.click();
                        if (el.parentElement) {
                            el.parentElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                            el.parentElement.click();
                        }
                        return true;
                    }
                }
                return false;
            });

            if (clicked) {
                clickCount++;
                await new Promise(r => setTimeout(r, 1200)); // Wait 1.2s for next slide to animate in
            } else {
                // If it didn't click anything, verify the popup is actually gone before breaking out early
                const isStillThere = await page.evaluate(() => {
                    const text = document.body.innerText.toLowerCase();
                    return text.includes('next →') || text.includes('1 of 6');
                });
                if (!isStillThere && clickCount > 0) break; 
                await new Promise(r => setTimeout(r, 500)); 
            }
        }
        
        if (updateStatus) await updateStatus(`[SYSTEM] Successfully cleared ${clickCount} popup steps.`);
        return true; // Returns true so your main command knows it needs to save the database
    } catch (e) {
        // A timeout error here is a GOOD thing. It means 10 seconds passed and no popups appeared!
        if (updateStatus) await updateStatus('[SYSTEM] No popups detected. Screen is already clean.');
        return false;
    }
}



// --- 4. TELEGRAM COMMAND LISTENERS ---

// --- INTERACTIVE CONTROL PANEL ---
bot// --- INTERACTIVE CONTROL PANEL (REPLACES BOTTOM KEYBOARD) ---
bot.onText(/\/start/i, (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;
    
    bot.sendMessage(chatId, '*Master Control Panel*\n\nSelect an operation from your menu below:', {
        parse_mode: 'Markdown',
        reply_markup: {
            keyboard: [
                [{ text: 'Withdraw' }, { text: 'Task' }],
                [{ text: 'Balance' }]
            ],
            resize_keyboard: true,
            is_persistent: true
        }
    });
});


// --- HANDLE "WITHDRAW" BUTTON TAP ---
bot.onText(/^(?:\/withdraw|Withdraw)$/i, (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    bot.sendMessage(chatId, 'Select Platform to Withdraw From:', {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'M4U', callback_data: 'cmd_withdraw_m4u' }, { text: 'Wsjob', callback_data: 'cmd_withdraw_wsjob' }],
                [{ text: 'Cancel', callback_data: 'cmd_cancel' }]
            ]
        }
    });
});

// --- CALLBACK ROUTER (HANDLES SUB-MENU BUTTONS) ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    const data = query.data;
    bot.answerCallbackQuery(query.id).catch(()=>{});

    // This perfectly forces Telegram to execute your text commands invisibly!
    const simulateCommand = (cmdText) => {
        bot.processUpdate({
            update_id: Date.now(),
            message: {
                message_id: Date.now(),
                from: { id: parseInt(chatId) },
                chat: { id: parseInt(chatId), type: 'private' },
                date: Math.floor(Date.now() / 1000),
                text: cmdText
            }
        });
    };

    if (data === 'cmd_withdraw_m4u') {
        bot.deleteMessage(chatId, query.message.message_id).catch(()=>{});
        simulateCommand('/withdraw m4u');
    }
    else if (data === 'cmd_withdraw_wsjob') {
        bot.deleteMessage(chatId, query.message.message_id).catch(()=>{});
        simulateCommand('/withdraw task');
    }
    else if (data === 'cmd_cancel') {
        bot.deleteMessage(chatId, query.message.message_id).catch(()=>{});
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


        
 // Usage: /tt 127
bot.onText(/\/tt\s+(\d+)/, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    const targetSuffix = match[1]; 

    let statusMsg = await bot.sendMessage(chatId, `[ISOLATED SYSTEM] Booting standalone /tt sequence for suffix: ${targetSuffix}...`);
    const msgId = statusMsg.message_id;

    const updateStatus = async (text) => {
        await bot.editMessageText(text, { chat_id: chatId, message_id: msgId }).catch(() => {});
    };

    let ttBrowser = null;
    let pages = []; 

    try {
        // --- 1. LAUNCH ISOLATED BROWSER (100% CLEAN SLATE, NO DB) ---
        await updateStatus('[ISOLATED SYSTEM] Launching completely separate, clean Chrome instance...');
        ttBrowser = await puppeteer.launch({
            headless: true,
            executablePath: getChromePath(),
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });

        // --- 2. INITIALIZE MASTER TAB & FORCE FRESH LOGIN ---
        await updateStatus('[ISOLATED SYSTEM] Opening Master Tab & hitting the login wall...');
        const page1 = await ttBrowser.newPage();
        pages.push(page1);
        await page1.setViewport({ width: 412, height: 915 }); 
        await page1.setUserAgent('Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');

        // Go straight to task page. NO database loaded.
        await page1.goto('https://www.wsjobs-ng.com/task', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 4000)); 

        const requiresLogin = await page1.$('input[type="password"]') !== null;

        if (requiresLogin) {
            await updateStatus('[ISOLATED SYSTEM] Login required. Physically typing hardcoded credentials...');
            const allInputs = await page1.$$('input');
            const visibleInputs = [];
            for (let input of allInputs) {
                const isVisible = await input.evaluate(el => el.offsetParent !== null && window.getComputedStyle(el).display !== 'none');
                if (isVisible) visibleInputs.push(input);
            }

            if (visibleInputs.length >= 2) {
                await visibleInputs[0].evaluate(el => el.value = '');
                await visibleInputs[0].click();
                await visibleInputs[0].type('09163916311', { delay: 50 }); // HARDCODED MAIN
                
                await visibleInputs[1].evaluate(el => el.value = '');
                await visibleInputs[1].click();
                await visibleInputs[1].type('Emmamama', { delay: 50 }); // HARDCODED PASS
                
                await new Promise(r => setTimeout(r, 1000));
                
                await page1.evaluate(() => {
                    const elements = Array.from(document.querySelectorAll('*'));
                    for (let el of elements) {
                        if (el.innerText && el.innerText.trim() === 'Login' && el.offsetParent !== null) {
                            el.click();
                        }
                    }
                });
            }
            
            await page1.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 4000)); 
            
            await page1.goto('https://www.wsjobs-ng.com/task', { waitUntil: 'networkidle2' });
            await new Promise(r => setTimeout(r, 4000));
        }

        // --- 3. SWEEP MASTER TAB USING GLOBAL /POP FUNCTION ---
        await updateStatus('[ISOLATED SYSTEM] Connecting to global popup sweeper...');
        await clearOnboardingPopups(page1, updateStatus);

        // --- 4. TARGET SCANNER WITH HARD-REFRESH RETRY ---
        await updateStatus(`[ISOLATED SYSTEM] Target acquisition phase for: ${targetSuffix}...`);
        
        let targetCount = 0;

        for (let attempt = 1; attempt <= 2; attempt++) {
            await updateStatus(`[ISOLATED SYSTEM] Waiting for tasks to populate (Attempt ${attempt}/2)...`);
            
            for (let i = 0; i < 10; i++) {
                const tasksExist = await page1.evaluate(() => {
                    return Array.from(document.querySelectorAll('*')).some(el => el.innerText && el.innerText.trim() === 'Send' && el.offsetParent !== null);
                });
                if (tasksExist) break;
                await new Promise(r => setTimeout(r, 1000));
            }

            targetCount = await page1.evaluate((suffixStr) => {
                const sendBtns = Array.from(document.querySelectorAll('*')).filter(el => el.innerText && el.innerText.trim() === 'Send' && el.offsetParent !== null);
                let count = 0;
                for (let btn of sendBtns) {
                    let containerText = '';
                    if (btn.parentElement && btn.parentElement.parentElement) {
                        containerText = btn.parentElement.parentElement.innerText || '';
                    }
                    if (containerText.includes(suffixStr)) count++;
                }
                return count > 4 ? 4 : count; 
            }, targetSuffix);

            if (targetCount > 0) {
                break; 
            } else if (attempt === 1) {
                await updateStatus(`[ISOLATED SYSTEM] 0 targets found! Wsjobs is lagging. Hard-refreshing...`);
                await page1.reload({ waitUntil: 'networkidle2' });
                await new Promise(r => setTimeout(r, 5000)); 
                await clearOnboardingPopups(page1, updateStatus); // Call global sweeper again after refresh!
            }
        }

        if (targetCount === 0) {
            throw new Error(`Found 0 numbers ending with ${targetSuffix} on Main Account even after refresh.`);
        }

        await updateStatus(`[ISOLATED SYSTEM] Found ${targetCount} matching numbers. Spawning clones...`);

        // Spawn Clones
        for (let i = 1; i < targetCount; i++) {
            const newPage = await ttBrowser.newPage();
            pages.push(newPage);
            await newPage.setViewport({ width: 412, height: 915 }); 
            await newPage.setUserAgent('Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
        }

        if (pages.length > 1) {
            await Promise.all(pages.slice(1).map(p => p.goto('https://www.wsjobs-ng.com/task', { waitUntil: 'networkidle2' })));
            await new Promise(r => setTimeout(r, 3000));
        }
        
        // Sweep clones silently using the global function (passing null prevents it from spamming Telegram statuses)
        await Promise.all(pages.slice(1).map(p => clearOnboardingPopups(p, null)));

        // --- 5. EXACT /TASK GHOST CLICKS ---
        await updateStatus(`[ISOLATED SYSTEM] Tabs clear. Ghost-clicking "Send"...`);
        
        const clickResults = await Promise.all(pages.map((p, index) => {
            return p.evaluate((suffixStr, tabIndex) => {
                const sendBtns = Array.from(document.querySelectorAll('*')).filter(el => el.innerText && el.innerText.trim() === 'Send' && el.offsetParent !== null);
                let matchCount = 0;
                for (let btn of sendBtns) {
                    let containerText = '';
                    if (btn.parentElement && btn.parentElement.parentElement) {
                        containerText = btn.parentElement.parentElement.innerText || '';
                    }
                    if (containerText.includes(suffixStr)) {
                        if (matchCount === tabIndex) {
                            btn.scrollIntoView({ block: 'center', behavior: 'instant' });
                            const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
                            btn.dispatchEvent(clickEvent); 
                            btn.click(); 
                            if (btn.parentElement) {
                                btn.parentElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                                btn.parentElement.click();
                            }
                            return true;
                        }
                        matchCount++;
                    }
                }
                return false;
            }, targetSuffix, index);
        }));

        await updateStatus(`[ISOLATED SYSTEM] Waiting 3 seconds for popups...`);
        await new Promise(r => setTimeout(r, 3000));

        await updateStatus(`[ISOLATED SYSTEM] Capturing pre-strike screenshots...`);
        for (let idx = 0; idx < pages.length; idx++) {
            if (clickResults[idx]) {
                try {
                    const preSnap = await pages[idx].screenshot({ type: 'png' });
                    await bot.sendPhoto(chatId, preSnap, { caption: `[DIAGNOSTIC] TT Tab ${idx + 1} State right before Confirm.` });
                } catch (e) {}
            }
        }

        await updateStatus(`[ISOLATED SYSTEM] Waiting 10 seconds to synchronize...`);
        await new Promise(r => setTimeout(r, 10000));

        // --- 6. SYNCHRONIZED CONFIRM STRIKE ---
        await updateStatus(`[ISOLATED SYSTEM] Executing synchronized Confirm ghost-clicks...`);
        
        await Promise.all(pages.map(async (p, idx) => {
            if (clickResults[idx]) {
                await p.evaluate(() => {
                    const elements = Array.from(document.querySelectorAll('*'));
                    for (let el of elements) {
                        if (el.innerText && el.innerText.trim() === 'Confirm' && el.offsetParent !== null) {
                            const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
                            el.dispatchEvent(clickEvent);
                            el.click();
                            if (el.parentElement) {
                                el.parentElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                                el.parentElement.click();
                            }
                        }
                    }
                });
            }
        }));

        await updateStatus(`[ISOLATED SYSTEM] Clicks fired! Waiting 15 seconds...`);
        await new Promise(r => setTimeout(r, 15000));

        // --- 7. FETCH BALANCE & FINISH ---
        await updateStatus(`[ISOLATED SYSTEM] Fetching final state...`);
        const screenshotBuffer = await pages[0].screenshot({ type: 'png' });

        let currentBalance = "Unknown";
        try {
            await pages[0].goto('https://www.wsjobs-ng.com/user', { waitUntil: 'networkidle2' });
            await new Promise(r => setTimeout(r, 3000)); 
            currentBalance = await pages[0].evaluate(() => {
                const rawText = document.body.textContent || '';
                const match = rawText.match(/Account\s*Balance[\s:\n]*([\d,]+(?:\.\d+)?)/i);
                if (match) return match[1];
                return 'Unknown';
            });
        } catch (e) {}

        await updateStatus(`[SUCCESS] TT sequence completed! Shutting down isolated browser...`);
        await bot.sendPhoto(chatId, screenshotBuffer, { 
            caption: `[SUCCESS] Snapshot from Isolated Tab after ${targetCount} clicks.\n\n💰 *Current Balance:* \`${currentBalance}\``,
            parse_mode: 'Markdown'
        });

    } catch (err) {
        await updateStatus(`[ERROR] TT Sequence failed: ${err.message}`);
        if (pages.length > 0) {
            try {
                const errBuffer = await pages[0].screenshot({ type: 'png' });
                await bot.sendPhoto(chatId, errBuffer, { caption: '[DIAGNOSTIC] State of TT Master Tab at crash.' });
            } catch (snapErr) {}
        }
    } finally {
        // --- 8. THE KILL SWITCH ---
        if (ttBrowser) {
            await updateStatus(`[ISOLATED SYSTEM] Destroying temporary browser instance...`);
            await ttBrowser.close().catch(() => {});
        }
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

// Usage: /pair m4u
bot.onText(/\/pair\s+m4u/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    // Reset any existing session and start fresh
    m4uSession = { state: 'WAITING_COUNTRY', country: null };
    bot.sendMessage(chatId, '[SYSTEM] M4U Pairing Protocol Initiated.\n\nPlease reply with the Country Code you want to use (e.g., +234 or 234):');
});


// --- TIMESMS.ORG AUTO-DOWNLOADER ---
// Usage: /getfile
bot.onText(/^\/getfile$/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    let statusMsg = await bot.sendMessage(chatId, '[SYSTEM] Booting TimeSMS Scraper Protocol...');
    const updateStatus = async (text) => {
        await bot.editMessageText(text, { chat_id: chatId, message_id: statusMsg.message_id }).catch(() => {});
    };

    let browser = null;
    let page = null;
    
    // Create a unique temporary download directory to intercept the file
    const downloadDir = path.resolve(__dirname, `timesms_dl_${Date.now()}`);
    if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

    try {
        await updateStatus('[SYSTEM] Launching headless browser for TimeSMS...');
        browser = await puppeteer.launch({
            headless: true,
            executablePath: getChromePath(),
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });

        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 }); // Use desktop view for easier table scraping
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Force Chrome to quietly download files to our temporary folder instead of asking
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadDir
        });

        // --- 1. LOGIN & CAPTCHA SOLVER ---
        await updateStatus('[SYSTEM] Navigating to login page...');
        await page.goto('https://timesms.org/login', { waitUntil: 'networkidle2' });

        await updateStatus('[SYSTEM] Extracting and solving math Captcha...');
        
        // Advanced Math Extractor
        const captchaAnswer = await page.evaluate(() => {
            const bodyText = document.body.innerText || '';
            // Looks for "What is 8 + 1 = ?" or similar variations
            const match = bodyText.match(/What is\s*(\d+)\s*([\+\-\*])\s*(\d+)/i);
            
            if (match) {
                const num1 = parseInt(match[1]);
                const op = match[2];
                const num2 = parseInt(match[3]);
                
                if (op === '+') return (num1 + num2).toString();
                if (op === '-') return (num1 - num2).toString();
                if (op === '*') return (num1 * num2).toString();
            }
            return null;
        });

        if (!captchaAnswer) {
            throw new Error("Could not detect or solve the Math Captcha on the login page.");
        }

        await updateStatus(`[SYSTEM] Captcha solved: ${captchaAnswer}. Injecting credentials...`);

        // Safely type credentials and the solved captcha
        const inputs = await page.$$('input');
        
        for (let input of inputs) {
            const type = await page.evaluate(el => el.type, input);
            const placeholder = await page.evaluate(el => (el.placeholder || '').toLowerCase(), input);
            
            if (type === 'text' && placeholder.includes('username')) {
                await input.type('Ultarscny', { delay: 50 });
            } else if (type === 'password' || placeholder.includes('password')) {
                await input.type('Ultarscny', { delay: 50 });
            } else if (placeholder.includes('answer')) {
                await input.type(captchaAnswer, { delay: 50 });
            }
        }

        await new Promise(r => setTimeout(r, 1000));

        // Click Login
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            for (let btn of btns) {
                if ((btn.innerText || '').trim().toLowerCase() === 'login') {
                    btn.click();
                    return;
                }
            }
        });

        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
        
        // Validate login success by checking URL
        if (page.url().includes('login')) {
            throw new Error("Login failed. Check credentials or captcha logic.");
        }

        // --- 2. NAVIGATE TO 'MY NUMBERS' ---
        await updateStatus('[SYSTEM] Login successful! Teleporting to My SMS Numbers...');
        await page.goto('https://timesms.org/client/MySMSNumbers', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 3000));

        // --- 3. FORCE DROPDOWN TO "ALL" ---
        await updateStatus('[SYSTEM] Modifying table parameters to "All"...');
        const changedToAll = await page.evaluate(() => {
            const selects = Array.from(document.querySelectorAll('select'));
            for (let select of selects) {
                // Find the dropdown that controls the records per page
                const options = Array.from(select.options);
                const allOpt = options.find(opt => opt.text.trim().toLowerCase() === 'all');
                
                if (allOpt) {
                    select.value = allOpt.value;
                    // Trigger the event so the website updates the table
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
            }
            return false;
        });

        if (!changedToAll) {
            await updateStatus('[WARNING] Could not find "All" in the dropdown. Proceeding with default view...');
        } else {
            await updateStatus('[SYSTEM] Table updated. Waiting for data to sync...');
            await new Promise(r => setTimeout(r, 5000)); // Wait for the giant list to load
        }

        // --- 4. TRIGGER EXCEL DOWNLOAD ---
        await updateStatus('[SYSTEM] Extracting Excel file from server...');
        
        await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('a, button, span'));
            for (let el of elements) {
                if ((el.innerText || '').trim() === 'Excel') {
                    // Force synthetic click to bypass traps
                    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                    el.click();
                    if (el.parentElement) el.parentElement.click();
                    return;
                }
            }
        });

                // --- 5. INTERCEPT AND SEND THE FILE VIA SECONDARY BOT ---
        await updateStatus('[SYSTEM] Waiting for file to finish downloading...');
        
        let downloadedFilePath = null;
        
        // Poll the directory for up to 30 seconds waiting for the .xlsx file
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 1000));
            
            if (fs.existsSync(downloadDir)) {
                const files = fs.readdirSync(downloadDir);
                // Look for the file, ignoring Chrome's temporary .crdownload files
                const excelFile = files.find(f => f.endsWith('.xlsx') || f.endsWith('.xls') || f.endsWith('.csv'));
                const isDownloading = files.some(f => f.endsWith('.crdownload'));
                
                if (excelFile && !isDownloading) {
                    // Safe file routing using the path module
                    downloadedFilePath = path.join(downloadDir, excelFile);
                    break;
                }
            }
        }

        if (!downloadedFilePath) {
            throw new Error("Download timed out or failed to trigger.");
        }

        await updateStatus('[SUCCESS] File acquired! Handing off to the Message Bot...');
        
        // Initialize the secondary Message Bot (polling: false because it only needs to send)
        const msgBotToken = '8424082135:AAGc73Ztzkb49dZd4hHEx99QFlMMwS5MONw';
        const messageBot = new TelegramBot(msgBotToken, { polling: false });

        // Send the file via the new bot directly to your Admin ID
        await messageBot.sendDocument(ADMIN_ID, downloadedFilePath, {
            caption: '*TimeSMS Report*\n\nHere is your requested Excel file.'
        });

        await updateStatus('[SUCCESS] File successfully delivered via Message Bot!');

        // Delete the status message from the main bot after 3 seconds to keep chat clean
        setTimeout(() => {
            bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        }, 3000);

    } catch (err) {
        await updateStatus(`[ERROR] Sequence failed: ${err.message}`);
        if (page) {
            try {
                const errSnap = await page.screenshot({ type: 'png' });
                await bot.sendPhoto(chatId, errSnap, { caption: '[DIAGNOSTIC] State at crash.' });
            } catch (e) {}
        }
    } finally {
        // --- 6. THE KILL SWITCH & CLEANUP ---
        if (browser) await browser.close().catch(() => {});
        
        // Delete the temporary file and folder so Heroku's storage doesn't get bloated
        try {
            if (downloadDir && fs.existsSync(downloadDir)) {
                fs.rmSync(downloadDir, { recursive: true, force: true });
            }
        } catch (cleanupErr) {
            console.log(`[WARNING] Failed to clean up temp dir: ${cleanupErr}`);
        }
    }
});




// --- WSJOBS SMART WITHDRAWAL ---
// Usage: /withdraw task
bot.onText(/\/withdraw\s+task/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    let statusMsg = await bot.sendMessage(chatId, `[SYSTEM] Booting secure browser for Wsjobs Auto-Withdraw...`);
    const updateStatus = async (text) => {
        await bot.editMessageText(text, { chat_id: chatId, message_id: statusMsg.message_id }).catch(() => {});
    };

    let browser = null;
    let page = null;
    
    try {
        // Use the global browser engine to save RAM, just like /task
        if (typeof globalTaskBrowser === 'undefined' || !globalTaskBrowser) {
            await updateStatus('[SYSTEM] Cold Boot: Launching background Chrome engine...');
            globalTaskBrowser = await puppeteer.launch({
                headless: true,
                executablePath: getChromePath(),
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
            });
        }
        browser = globalTaskBrowser;

        page = await browser.newPage();
        await page.setViewport({ width: 412, height: 915 });
        await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');

        // Step 1: Inject DB Session (Shares exact memory with /task)
        await updateStatus('[SYSTEM] Loading permanent session from Database...');
        await page.goto('https://www.wsjobs-ng.com', { waitUntil: 'networkidle2' }); 
        await loadSessionFromDB('wsjobs_task', page);

        // Step 2: Teleport to User Dashboard
        await updateStatus('[SYSTEM] Checking Wsjobs session...');
        await page.goto('https://www.wsjobs-ng.com/user', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 4000));

        // Safe Login check
        if (await page.$('input[type="password"]')) {
            await updateStatus('[SYSTEM] Session expired. Performing Physical Login...');
            const allInputs = await page.$$('input');
            const vis = [];
            for (let input of allInputs) {
                if (await input.evaluate(el => el.offsetParent !== null)) vis.push(input);
            }
            if (vis.length >= 2) {
                // Safe input clearing that doesn't break modern websites
                await vis[0].click({ clickCount: 3 });
                await page.keyboard.press('Backspace');
                await vis[0].type('09163916311', { delay: 50 });
                
                await vis[1].click({ clickCount: 3 });
                await page.keyboard.press('Backspace');
                await vis[1].type('Emmamama', { delay: 50 });
                
                await new Promise(r => setTimeout(r, 1000));
                
                await page.evaluate(() => {
                    Array.from(document.querySelectorAll('*')).forEach(el => {
                        if (el.innerText && el.innerText.trim() === 'Login' && el.offsetParent !== null) el.click();
                    });
                });
                
                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
                await new Promise(r => setTimeout(r, 4000));
                
                await page.goto('https://www.wsjobs-ng.com/user', { waitUntil: 'networkidle2' });
                await new Promise(r => setTimeout(r, 4000));
                
                // SAVE TO DB: Update the permanent session memory
                await saveSessionToDB('wsjobs_task', page);
            }
        }

        // Step 3: Scan Balance with Bulletproof Regex
        await updateStatus('[SYSTEM] Scanning Account Balance...');
        const balanceData = await page.evaluate(() => {
            const rawText = document.body.textContent || '';
            const match = rawText.match(/Account\s*Balance[\s:\n]*([\d,]+(?:\.\d+)?)/i);
            if (match) return match[1];
            return null;
        });

        if (!balanceData) throw new Error("Could not detect Account Balance on the user page.");

        const rawBalance = parseFloat(balanceData.replace(/,/g, ''));
        if (rawBalance < 12000) {
            await updateStatus(`[FAILED] Balance is ${balanceData}. Minimum requirement is 12000.`);
            await page.close().catch(() => {});
            return;
        }

        // Calculate highest affordable tier
        const tiers = [50000, 26000, 23000, 20000, 18000, 15000, 12000];
        let targetAmount = 12000;
        for (let t of tiers) {
            if (rawBalance >= t) {
                targetAmount = t;
                break;
            }
        }

        await updateStatus(`[SYSTEM] Balance is ${balanceData}. Automatically selecting tier: ${targetAmount}`);

                // Step 4: Teleport to Withdrawal Page
        await updateStatus('[SYSTEM] Jumping to withdrawal page to execute...');
        await page.goto('https://www.wsjobs-ng.com/withdrawal', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 4000));

        // --- NEW: SEND SCREENSHOT IF TIER IS ABOVE 12000 ---
                // If target is 12000, skip clicking since it is selected by default!
        if (targetAmount !== 12000) {
            await updateStatus(`[SYSTEM] Selecting tier: ${targetAmount}...`);
            const clickedTier = await page.evaluate((amt) => {
                const target = amt.toString();
                const elements = Array.from(document.querySelectorAll('*'));
                
                for (let el of elements) {
                    // Grab all text inside the element
                    const rawText = el.innerText || el.textContent || '';
                    // Strip EVERYTHING except numbers. "20000 ✔" becomes "20000"
                    const cleanText = rawText.replace(/[^0-9]/g, '');

                    if (cleanText === target && el.offsetParent !== null) {
                        el.scrollIntoView({ block: 'center' });
                        
                        // Fire synthetic MouseEvents to forcefully bypass Vue/React traps
                        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        el.click();
                        
                        if (el.parentElement) {
                            el.parentElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                            el.parentElement.click();
                        }
                        return true;
                    }
                }
                return false;
            }, targetAmount);

            if (!clickedTier) throw new Error(`Could not locate the physical button for tier: ${targetAmount}`);
            await new Promise(r => setTimeout(r, 1500));
        } else {
            await updateStatus(`[SYSTEM] Target is 12000 (Default). Skipping tier selection...`);
        }


                await updateStatus('[SYSTEM] Clicking "Withdrawal Now"...');
        await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('*'));
            for (let el of elements) {
                const txt = (el.innerText || el.textContent || '').trim();
                if (txt === 'Withdrawal Now' && el.offsetParent !== null) {
                    el.scrollIntoView({ block: 'center' });
                    // Force synthetic mouse click to bypass UI traps
                    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    el.click();
                    if (el.parentElement) el.parentElement.click();
                    return; // Stop searching once we click it
                }
            }
        });
        await new Promise(r => setTimeout(r, 3000));

        await updateStatus('[SYSTEM] Processing confirmation screen...');
        await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('*'));
            for (let el of elements) {
                const txt = (el.innerText || el.textContent || '').trim();
                // Check for either 'Withdrawal' or 'Confirm' on the popup
                if ((txt === 'Withdrawal' || txt === 'Confirm') && el.offsetParent !== null) {
                    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    el.click();
                    if (el.parentElement) el.parentElement.click();
                    return; 
                }
            }
        });
        await new Promise(r => setTimeout(r, 3000));


          await updateStatus('[SYSTEM] Executing 3-Click bypass and Hands-Off typing...');
        const pin = '111111111111'; 
        // --- 1. THE 3-CLICK BYPASS ---
        const initialInputs = await page.$$('input');
        for (let input of initialInputs) {
            const isValid = await input.evaluate(el => el.type !== 'hidden' && (el.offsetParent !== null || window.getComputedStyle(el).opacity === '0'));
            if (isValid) {
                await updateStatus('[SYSTEM] Tapping box 3 times to clear popups and lock cursor...');
                
                // Tap 1: Triggers the popup
                await input.click().catch(() => {});
                await new Promise(r => setTimeout(r, 600)); 
                
                // Tap 2: Closes the popup
                await input.click().catch(() => {});
                await new Promise(r => setTimeout(r, 600)); 
                
                // Tap 3: Officially locks focus & brings up the keyboard
                await input.click().catch(() => {});
                await new Promise(r => setTimeout(r, 1200)); // Wait 1.2s for cursor to fully settle
                break; // Stop after doing this to the first box
            }
        }

                // --- 2. REACT/VUE DIRECT INJECTION ---
        await updateStatus('[SYSTEM] Bypassing Keyboard entirely. Injecting PIN directly into website memory...');
        
        const pinString = '111111'; // <--- IMPORTANT: MAKE SURE THIS IS YOUR ACTUAL Wsjobs PIN!
        
        const injected = await page.evaluate((pin) => {
            // Find all visible input boxes
            const inputs = Array.from(document.querySelectorAll('input'))
                .filter(el => el.offsetParent !== null && window.getComputedStyle(el).display !== 'none');
            
            if (inputs.length === 0) return false;

            // The React/Vue bypass magic: Forces the site to accept the value change
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;

            if (inputs.length >= 6) {
                // If the site uses 6 separate boxes
                for (let i = 0; i < 6; i++) {
                    if (inputs[i]) {
                        nativeInputValueSetter.call(inputs[i], pin[i] || '1');
                        inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
                        inputs[i].dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }
            } else {
                // If the site uses 1 single password box
                nativeInputValueSetter.call(inputs[0], pin);
                inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
                inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
            }
            return true;
        }, pinString);

        if (!injected) {
             await updateStatus('[WARNING] Could not find PIN boxes to inject. Are they hidden?');
        }

        await new Promise(r => setTimeout(r, 1500));


        // --- SCREENSHOT AFTER TYPING THE PIN ---
        const postPinSnap = await page.screenshot({ type: 'png' });
        await bot.sendPhoto(chatId, postPinSnap, { caption: '[DEBUG] State AFTER Hands-Off typing, right before Confirm' });

        // 3. AGGRESSIVE CONFIRM CLICK
        await updateStatus('[SYSTEM] Submitting final confirmation...');
        await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('*'));
            for (let el of elements) {
                const txt = (el.innerText || el.textContent || '').trim();
                if (txt === 'Confirm' && el.offsetParent !== null) {
                    // Force synthetic mouse click to bypass UI traps
                    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    el.click();
                    if (el.parentElement) el.parentElement.click();
                    return; // Stop searching once we click it
                }
            }
        });

                await updateStatus('[SYSTEM] Waiting for server response...');
        await new Promise(r => setTimeout(r, 4000)); // Wait for initial spinner or error modal

        // --- NEW: ERROR DETECTION AND RE-ENTRY LOGIC ---
        const errorModalDetected = await page.evaluate(() => {
            const body = document.body.innerText || '';
            return body.includes('password incorrect') || body.includes('Re-enter');
        });

        if (errorModalDetected) {
            await updateStatus('[SYSTEM] Incorrect PIN modal detected. Clicking Re-enter...');
            
            // 1. Click Re-enter
            await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('*'));
                for (let el of elements) {
                    if ((el.innerText || '').trim() === 'Re-enter' && el.offsetParent !== null) {
                        el.click();
                        return;
                    }
                }
            });
            await new Promise(r => setTimeout(r, 2000)); // Wait for modal to close and boxes to clear

            await updateStatus('[SYSTEM] Re-typing withdrawal PIN...');
            
            // 2. Click the first box again
            const retryInputs = await page.$$('input');
            for (let input of retryInputs) {
                if (await input.evaluate(el => window.getComputedStyle(el).display !== 'none' && el.type !== 'hidden')) {
                    await input.click();
                    await new Promise(r => setTimeout(r, 500));
                    break; 
                }
            }

            // 3. Blind type again
            for (let i = 0; i < pin.length; i++) {
                await page.keyboard.press(pin[i]);
                await new Promise(r => setTimeout(r, 600));
            }
            await new Promise(r => setTimeout(r, 1500));

            // 4. SCREENSHOT BEFORE CONFIRMING A SECOND TIME
            const retryPreSnap = await page.screenshot({ type: 'png' });
            await bot.sendPhoto(chatId, retryPreSnap, { caption: '[DEBUG] State AFTER typing PIN on Re-enter, right before second Confirm' });

            // 5. Click Confirm again
            await updateStatus('[SYSTEM] Submitting second confirmation...');
            await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('*'));
                for (let el of elements) {
                    const txt = (el.innerText || el.textContent || '').trim();
                    if (txt === 'Confirm' && el.offsetParent !== null) {
                        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        el.click();
                        if (el.parentElement) el.parentElement.click();
                        return; 
                    }
                }
            });
            
            await new Promise(r => setTimeout(r, 6000)); // Wait for the final spinner
        } else {
            // Give it 2 more seconds if no error modal popped up, just to be safe
            await new Promise(r => setTimeout(r, 2000)); 
        }

        await updateStatus('[SUCCESS] Auto-withdrawal completed.');
        const screenshotBuffer = await page.screenshot({ type: 'png' });
        await bot.sendPhoto(chatId, screenshotBuffer, { caption: '[SUCCESS] Wsjobs Final State' });

    } catch (err) {
        await updateStatus(`[ERROR] Sequence failed: ${err.message}`);
    } finally {
        if (page) await page.close().catch(() => {});
    }
});

// --- CONTINUOUS TASK MODE ---
let taskModeActive = false;
let taskModeTimer = null;

// Command to START Task Mode
bot.onText(/^(?:Task|task)$/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;
    
    taskModeActive = true;
    
    // Set the 30-minute idle timebomb
    if (taskModeTimer) clearTimeout(taskModeTimer);
    taskModeTimer = setTimeout(() => {
        taskModeActive = false;
        // Bring the keyboard back when it times out!
        bot.sendMessage(chatId, '[SYSTEM] Task Mode automatically ended after 30 minutes of inactivity.', {
            reply_markup: {
                keyboard: [
                    [{ text: 'Pair M4U' }, { text: 'Withdraw' }],
                    [{ text: 'Balance' }]
                ],
                resize_keyboard: true,
                is_persistent: true
            }
        });
    }, 30 * 60 * 1000);
    
    // Remove the keyboard when activating
    await bot.sendMessage(chatId, '[ACTIVE] Continuous Task Mode Activated!\n\nJust send me the raw target numbers (e.g., 657). I will automatically close old tabs, open fresh ones, and execute the strike.\n\nType Stop to end this mode.', { 
        parse_mode: 'Markdown',
        reply_markup: { remove_keyboard: true } // THIS HIDES THE KEYBOARD
    });
});


// Universal STOP Command (Kills Task Mode, WA Login, and M4U Pairing)
bot.onText(/^(?:Stop|stop|\/stop)$/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;
    
    let stoppedSomething = false;

    // 1. Stop Task Mode
    if (taskModeActive) {
        taskModeActive = false;
        if (taskModeTimer) clearTimeout(taskModeTimer);
        // Bring the keyboard back!
        bot.sendMessage(chatId, '[INACTIVE] Task Mode Deactivated. Main menu restored.', {
            reply_markup: {
                keyboard: [
                    [{ text: 'Pair M4U' }, { text: 'Withdraw' }],
                    [{ text: 'Balance' }]
                ],
                resize_keyboard: true,
                is_persistent: true
            }
        });
        stoppedSomething = true;
    }

    // 2. Stop WhatsApp Login
    if (userState[chatId]) {
        userState[chatId] = null;
        bot.sendMessage(chatId, '[SYSTEM] WhatsApp login sequence aborted.');
        stoppedSomething = true;
    }

    // 3. Stop M4U Pairing & Free RAM
    if (m4uSession) {
        m4uSession = null;
        if (m4uTimer) clearTimeout(m4uTimer);
        bot.sendMessage(chatId, '[SYSTEM] M4U Pairing aborted. Closing background browser...');
        if (m4uBrowser) {
            await m4uBrowser.close().catch(() => {});
            m4uBrowser = null;
            m4uPage = null;
        }
        stoppedSomething = true;
    }

    if (!stoppedSomething) {
        bot.sendMessage(chatId, '[SYSTEM] No active processes to stop.');
    }
});



// The smart listener that catches your numbers
bot.on('message', (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID || !taskModeActive) return;
    if (!msg.text) return;
    
    // Check if the message is JUST a number
    if (/^\d+$/.test(msg.text.trim())) {
        
        // Reset the 30-minute timebomb since you just sent a number
        if (taskModeTimer) clearTimeout(taskModeTimer);
        taskModeTimer = setTimeout(() => {
            taskModeActive = false;
            bot.sendMessage(chatId, '[SYSTEM] Task Mode automatically ended after 30 minutes of inactivity.');
        }, 30 * 60 * 1000);

        // Secretly convert "657" into "/task 657" and push it directly into the bot's processor
        const fakeMessage = { ...msg };
        fakeMessage.text = `/task ${msg.text.trim()}`;
        
        // Feed it back to the bot to execute your original /task command
        bot.processUpdate({
            update_id: Math.floor(Math.random() * 1000000),
            message: fakeMessage
        });
    }
});


// --- CROSS-PLATFORM BALANCE CHECKER ---
bot.onText(/^(?:\/balance|Balance)$/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    let statusMsg = await bot.sendMessage(chatId, '[SYSTEM] Fetching balances...');

    let wsjobsBal = '0.00';
    let m4uBal = '0.00';

    // --- 1. Wsjobs Balance Fetch ---
    try {
        let wBrowser = globalTaskBrowser;
        let shouldCloseW = false;

        if (!wBrowser) {
            wBrowser = await puppeteer.launch({
                headless: true,
                executablePath: getChromePath(),
                userDataDir: './wsjobs_auth_session',
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
            });
            shouldCloseW = true;
        }

        const wPage = await wBrowser.newPage();
        await wPage.setViewport({ width: 412, height: 915 });

        await wPage.goto('https://www.wsjobs-ng.com/user', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 4000));

        if (await wPage.$('input[type="password"]')) {
            const allInputs = await wPage.$$('input');
            const vis = [];
            for (let i of allInputs) {
                if (await i.evaluate(e => e.offsetParent !== null)) vis.push(i);
            }
            if (vis.length >= 2) {
                await vis[0].evaluate(el => el.value = '');
                await vis[0].type('09163916311', { delay: 50 });
                await vis[1].evaluate(el => el.value = '');
                await vis[1].type('Emmamama', { delay: 50 });
                await new Promise(r => setTimeout(r, 1000));

                await wPage.evaluate(() => {
                    Array.from(document.querySelectorAll('*')).forEach(el => {
                        if (el.innerText && el.innerText.trim() === 'Login' && el.offsetParent !== null) el.click();
                    });
                });

                await wPage.waitForNavigation({waitUntil:'networkidle2', timeout: 15000}).catch(()=>{});
                await wPage.goto('https://www.wsjobs-ng.com/user', { waitUntil: 'networkidle2' });
                await new Promise(r => setTimeout(r, 4000));
            }
        }

        wsjobsBal = await wPage.evaluate(() => {
            const rawText = document.body.textContent || '';
            const match = rawText.match(/Account\s*Balance[\s:\n]*([\d,]+(?:\.\d+)?)/i);
            if (match) return match[1];
            return '0.00';
        });

        await wPage.close().catch(() => {});
        if (shouldCloseW) await wBrowser.close();
    } catch(e) {
        wsjobsBal = 'Error';
    }

        // --- 2. M4U Balance Fetch ---
    try {
        let mBrowser = m4uBrowser;
        let shouldCloseM = false;

        if (!mBrowser) {
            mBrowser = await puppeteer.launch({
                headless: true,
                executablePath: getChromePath(),
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox', 
                    '--disable-dev-shm-usage', 
                    '--disable-gpu',
                    '--disable-blink-features=AutomationControlled' // THE CLOUDFLARE BYPASS
                ],
                ignoreDefaultArgs: ['--enable-automation'] // Hides the "Chrome is being controlled" flag
            });
            shouldCloseM = true;
        }

        const mPage = await mBrowser.newPage();
        await mPage.setViewport({ width: 412, height: 915 });
        
        // SPOOF A REAL MOBILE DEVICE TO BYPASS CLOUDFLARE
        await mPage.setUserAgent('Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');

        await mPage.goto('https://taskm4u.com/#/mine', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 4000));

        if (mPage.url().includes('login')) {
            const inputs = await mPage.$$('input');
            if (inputs.length >= 2) {
                await inputs[0].type('Staring', { delay: 50 });
                await inputs[1].type('Emmama', { delay: 50 });
                await new Promise(r => setTimeout(r, 1000));

                await mPage.evaluate(() => {
                    Array.from(document.querySelectorAll('*')).forEach(el => {
                        if (el.innerText && el.innerText.trim() === 'Login') el.click();
                    });
                });

                await mPage.waitForNavigation({waitUntil:'networkidle2', timeout:15000}).catch(()=>{});
                await mPage.goto('https://taskm4u.com/#/mine', { waitUntil: 'networkidle2' });
                await new Promise(r => setTimeout(r, 4000));
            }
        }

        

        // Exact scraper logic from the withdraw command
        m4uBal = await mPage.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('*'));
            for (let i = 0; i < elements.length; i++) {
                const text = (elements[i].innerText || '').trim();
                if (text === 'Account Balance') {
                    const containerText = elements[i].parentElement.innerText || '';
                    const match = containerText.match(/[\d,]+\.\d{2}/);
                    if (match) return match[0];
                }
            }
            return '0.00';
        });

        await mPage.close().catch(() => {});
        if (shouldCloseM) await mBrowser.close();
    } catch(e) {
        m4uBal = 'Error';
    }

    // --- 3. FINAL CLEAN OUTPUT ---
    bot.deleteMessage(chatId, statusMsg.message_id).catch(()=>{});
    bot.sendMessage(chatId, `Wsjobs: ${wsjobsBal}\nM4U: ${m4uBal}`);
});


// Usage: /task 127
bot.onText(/\/task\s+(\d+)/, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    const targetSuffix = match[1]; 

    let statusMsg = await bot.sendMessage(chatId, `[SYSTEM] Booting Multi-Thread Protocol for suffix: ${targetSuffix}...`);
    const msgId = statusMsg.message_id;

    const updateStatus = async (text) => {
        await bot.editMessageText(text, { chat_id: chatId, message_id: msgId }).catch(() => {});
    };

    let browser = null;
    let pages = []; 

    try {
        // --- 1-HOUR IDLE TIMER CLEANUP ---
        if (taskIdleTimer) clearTimeout(taskIdleTimer);
        if (activeTaskPages.length > 0) {
            await updateStatus('[SYSTEM] Closing previous task tabs to free memory...');
            for (let p of activeTaskPages) await p.close().catch(()=>{});
            activeTaskPages = [];
        }

        // --- THE ENGINE WARM-UP ---
        if (typeof globalTaskBrowser === 'undefined' || !globalTaskBrowser) {
            await updateStatus('[SYSTEM] Cold Boot: Launching background Chrome engine...');
            globalTaskBrowser = await puppeteer.launch({
                headless: true,
                executablePath: getChromePath(),
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
            });
        } else {
            await updateStatus('[SYSTEM] Warm Boot: Engine already running.');
        }
        browser = globalTaskBrowser;

        // --- DYNAMIC TUTORIAL TRACKER ---
        const sweepTutorial = async (targetPage) => {
            await new Promise(r => setTimeout(r, 2500)); 
            let maxAttempts = 20; 
            let emptyChecks = 0;
            let didSweep = false;
            
            while (maxAttempts > 0 && emptyChecks < 3) {
                maxAttempts--;
                const clicked = await targetPage.evaluate(() => {
                    const elements = Array.from(document.querySelectorAll('button, div, span, a'));
                    for (let el of elements) {
                        if (el.offsetParent === null) continue; 
                        const txt = (el.innerText || '').trim().toLowerCase();
                        
                        if (txt === 'next' || txt === 'next →' || txt === 'next ->' || txt.includes('next →') || txt === 'done') {
                            el.scrollIntoView({ block: 'center' });
                            el.click();
                            return true;
                        }
                    }
                    return false;
                });

                if (clicked) {
                    emptyChecks = 0; 
                    didSweep = true;
                    await new Promise(r => setTimeout(r, 1000)); 
                } else {
                    emptyChecks++; 
                    await new Promise(r => setTimeout(r, 1000)); 
                }
            }
            return didSweep;
        };

        // --- STEP 1: INITIALIZE MASTER TAB & INJECT DB DATA ---
        await updateStatus('[SYSTEM] Opening Master Tab & loading DB credentials...');
        const page1 = await browser.newPage();
        pages.push(page1);
        await page1.setViewport({ width: 412, height: 915 }); 
        await page1.setUserAgent('Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');

        // Go to base URL first so localStorage injects safely without cross-domain errors
        await page1.goto('https://www.wsjobs-ng.com', { waitUntil: 'networkidle2' });
        await loadSessionFromDB('wsjobs_task', page1);

        await page1.goto('https://www.wsjobs-ng.com/task', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 4000)); 

        const requiresLogin = await page1.$('input[type="password"]') !== null;

        if (requiresLogin) {
            await updateStatus('[SYSTEM] DB Session missing/expired. Performing Physical Login...');
            const allInputs = await page1.$$('input');
            const visibleInputs = [];
            for (let input of allInputs) {
                const isVisible = await input.evaluate(el => el.offsetParent !== null && window.getComputedStyle(el).display !== 'none');
                if (isVisible) visibleInputs.push(input);
            }

            if (visibleInputs.length >= 2) {
                await visibleInputs[0].evaluate(el => el.value = '');
                await visibleInputs[0].click();
                await visibleInputs[0].type('09163916500', { delay: 50 });
                
                await visibleInputs[1].evaluate(el => el.value = '');
                await visibleInputs[1].click();
                await visibleInputs[1].type('Emmamama', { delay: 50 });
                
                await new Promise(r => setTimeout(r, 1000));
                
                await page1.evaluate(() => {
                    const elements = Array.from(document.querySelectorAll('*'));
                    for (let el of elements) {
                        if (el.innerText && el.innerText.trim() === 'Login' && el.offsetParent !== null) {
                            el.click();
                        }
                    }
                });
            }
            
            await page1.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 4000)); 
            
            await page1.goto('https://www.wsjobs-ng.com/task', { waitUntil: 'networkidle2' });
            await new Promise(r => setTimeout(r, 4000));
        }


                // --- STEP 1.5: FETCH INITIAL BALANCE ---
        await updateStatus('[SYSTEM] Fetching initial balance before strike...');
        await page1.goto('https://www.wsjobs-ng.com/user', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 3000));

        initialBalanceText = await page1.evaluate(() => {
            const rawText = document.body.textContent || '';
            const match = rawText.match(/Account\s*Balance[\s:\n]*([\d,]+(?:\.\d+)?)/i);
            if (match) return match[1];
            return '0';
        });
        initialBalanceNum = parseFloat(initialBalanceText.replace(/,/g, '')) || 0;

        await updateStatus('[SYSTEM] Teleporting to Task page...');
        await page1.goto('https://www.wsjobs-ng.com/task', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 4000));


        // --- STEP 2: SWEEP MASTER TAB & SAVE PERMANENT CACHE ---
        await updateStatus('[SYSTEM] Checking tutorials on Master Tab...');
        await sweepTutorial(page1);

        // ALWAYS save the cookies + cache after sweeping to lock the "tutorial finished" memory
        await updateStatus('[SYSTEM] Locking updated cookies/cache into Database...');
        await saveSessionToDB('wsjobs_task', page1);

        // --- STEP 3: COUNT TARGETS & SPAWN CLONES ---
        await updateStatus(`[SYSTEM] Target acquisition phase for: ${targetSuffix}...`);
        const targetCount = await page1.evaluate((suffixStr) => {
            const sendBtns = Array.from(document.querySelectorAll('*')).filter(el => el.innerText && el.innerText.trim() === 'Send' && el.offsetParent !== null);
            let count = 0;
            for (let btn of sendBtns) {
                let containerText = '';
                if (btn.parentElement && btn.parentElement.parentElement) {
                    containerText = btn.parentElement.parentElement.innerText || '';
                }
                if (containerText.includes(suffixStr)) count++;
            }
            return count > 4 ? 4 : count; 
        }, targetSuffix);

        if (targetCount === 0) throw new Error(`Found 0 numbers ending with ${targetSuffix}.`);

        await updateStatus(`[SYSTEM] Found ${targetCount} matching numbers. Spawning ${targetCount - 1} clone tabs...`);

        // Spawn Clones (Because they open in the same browser context, they instantly inherit the saved cache!)
        for (let i = 1; i < targetCount; i++) {
            const newPage = await browser.newPage();
            pages.push(newPage);
            await newPage.setViewport({ width: 412, height: 915 }); 
            await newPage.setUserAgent('Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
        }

        if (pages.length > 1) {
            await Promise.all(pages.slice(1).map(p => p.goto('https://www.wsjobs-ng.com/task', { waitUntil: 'networkidle2' })));
            await new Promise(r => setTimeout(r, 3000));
        }

        // Just a final safety check on clones (should instantly pass because of inherited cache)
        // Sweep clones silently using the global function (passing null prevents it from spamming Telegram statuses)
    await Promise.all(pages.slice(1).map(p => clearOnboardingPopups(p, null)));

                        // --- STEP 4: TARGET ACQUISITION (GHOST CLICKS) ---
        await updateStatus(`[SYSTEM] Tabs are clear. Ghost-clicking "Send" on all targets...`);
        
        const clickResults = await Promise.all(pages.map((p, index) => {
            return p.evaluate((suffixStr, tabIndex) => {
                const sendBtns = Array.from(document.querySelectorAll('*')).filter(el => el.innerText && el.innerText.trim() === 'Send' && el.offsetParent !== null);
                let matchCount = 0;
                for (let btn of sendBtns) {
                    let containerText = '';
                    if (btn.parentElement && btn.parentElement.parentElement) {
                        containerText = btn.parentElement.parentElement.innerText || '';
                    }
                    if (containerText.includes(suffixStr)) {
                        if (matchCount === tabIndex) {
                            btn.scrollIntoView({ block: 'center', behavior: 'instant' });
                            
                            // Synthetic Overlay-Penetrating Click
                            const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
                            btn.dispatchEvent(clickEvent); 
                            btn.click(); 
                            
                            if (btn.parentElement) {
                                btn.parentElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                                btn.parentElement.click();
                            }
                            return true;
                        }
                        matchCount++;
                    }
                }
                return false;
            }, targetSuffix, index);
        }));

        // --- NEW: 3 SECOND WAIT ---
        await updateStatus(`[SYSTEM] Waiting 3 seconds for popups to initialize...`);
        await new Promise(r => setTimeout(r, 3000));

        // --- STEP 5: PRE-STRIKE SCREENSHOTS ---
        await updateStatus(`[SYSTEM] Capturing pre-strike screenshots...`);
        for (let idx = 0; idx < pages.length; idx++) {
            if (clickResults[idx]) {
                try {
                    const preSnap = await pages[idx].screenshot({ type: 'png' });
                    await bot.sendPhoto(chatId, preSnap, { caption: `[DIAGNOSTIC] Tab ${idx + 1} State right before Confirm.` });
                } catch (e) {}
            }
        }

        // --- NEW: 10 SECOND WAIT ---
        await updateStatus(`[SYSTEM] Screenshots complete. Waiting 10 seconds for all tabs to fully synchronize...`);
        await new Promise(r => setTimeout(r, 10000));

               // --- STEP 6: SYNCHRONIZED CONFIRM STRIKE ---
        await updateStatus(`[SYSTEM] Executing INSTANT synchronized Confirm ghost-clicks...`);
        
        await Promise.all(pages.map(async (p, idx) => {
            if (clickResults[idx]) {
                await p.evaluate(() => {
                    const elements = Array.from(document.querySelectorAll('*'));
                    for (let el of elements) {
                        if (el.innerText && el.innerText.trim() === 'Confirm' && el.offsetParent !== null) {
                            const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
                            el.dispatchEvent(clickEvent);
                            el.click();
                            if (el.parentElement) {
                                el.parentElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                                el.parentElement.click();
                            }
                        }
                    }
                });
            }
        }));

        // --- NEW: 15 SECOND WAIT ---
        await updateStatus(`[SYSTEM] Clicks fired! Waiting 15 seconds for the server to process all tabs...`);
        await new Promise(r => setTimeout(r, 15000));

                // --- STEP 7: FETCH FINAL BALANCE & CALCULATE PROFIT ---
        await updateStatus(`[SYSTEM] Fetching final state and calculating profit...`);
        
        
        
        try {
            await pages[0].goto('https://www.wsjobs-ng.com/user', { waitUntil: 'networkidle2' });
            await new Promise(r => setTimeout(r, 3000)); 
            currentBalanceText = await pages[0].evaluate(() => {
                const rawText = document.body.textContent || '';
                const match = rawText.match(/Account\s*Balance[\s:\n]*([\d,]+(?:\.\d+)?)/i);
                if (match) return match[1];
                return 'Unknown';
            });
            
            // Calculate the math!
            let finalBalanceNum = parseFloat(currentBalanceText.replace(/,/g, ''));
            if (!isNaN(initialBalanceNum) && !isNaN(finalBalanceNum)) {
                earnedDisplay = `+${(finalBalanceNum - initialBalanceNum).toFixed(2)}`;
            }
        } catch (e) {}

        await updateStatus(`[SUCCESS] Strike sequence fully completed!`);
        await bot.sendPhoto(chatId, screenshotBuffer, { 
            caption: `[SUCCESS] Snapshot from Master Tab after executing ${targetCount} synchronized clicks.\n\n<b>Profit:</b> <code>${earnedDisplay}</code>`,
            parse_mode: 'HTML'
        });


        // --- STEP 8: KEEP TABS OPEN & ARM IDLE TIMER ---
        activeTaskPages = pages; 
        taskIdleTimer = setTimeout(async () => {
            bot.sendMessage(chatId, '[SYSTEM] 1 hour idle timeout reached. Closing inactive task tabs to save RAM.').catch(()=>{});
            for (let p of activeTaskPages) await p.close().catch(()=>{});
            activeTaskPages = [];
        }, 60 * 60 * 1000); // 1 hour in milliseconds

    } catch (err) {
        await updateStatus(`[ERROR] Sequence failed: ${err.message}`);
        if (pages.length > 0) {
            try {
                const errBuffer = await pages[0].screenshot({ type: 'png' });
                await bot.sendPhoto(chatId, errBuffer, { caption: '[DIAGNOSTIC] State of Master Tab at crash.' });
            } catch (snapErr) {}
        }
        for (let p of pages) await p.close().catch(()=>{});
    }
 

});

bot.onText(/\/status/, (msg) => {
    if (msg.chat.id.toString() !== ADMIN_ID) return;
    const status = (waClient && waClient.info) ? 'ONLINE' : 'OFFLINE / WAITING FOR LOGIN';
    bot.sendMessage(msg.chat.id, `[SYSTEM] Current Status: ${status}`);
});



// --- DEDICATED POPUP SWEEPER COMMAND ---
// Usage: /pop
bot.onText(/^\/pop$/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    let statusMsg = await bot.sendMessage(chatId, '[SYSTEM] Booting dedicated popup sweeper...');
    const updateStatus = async (text) => {
        await bot.editMessageText(text, { chat_id: chatId, message_id: statusMsg.message_id }).catch(() => {});
    };

    let browser = null;
    let page = null;

    try {
                // 1. Warm up the engine (WITH AUTO-RECOVERY)
        // Check if browser doesn't exist OR if Heroku killed the connection
        if (typeof globalTaskBrowser === 'undefined' || !globalTaskBrowser || !globalTaskBrowser.isConnected()) {
            await updateStatus('[SYSTEM] Launching fresh Chrome engine (Crash Recovery)...');
            
            // Clean up any zombie processes just in case
            if (typeof globalTaskBrowser !== 'undefined' && globalTaskBrowser) {
                try { await globalTaskBrowser.close(); } catch (e) {}
            }

            globalTaskBrowser = await puppeteer.launch({
                headless: true,
                executablePath: getChromePath(),
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox', 
                    '--disable-dev-shm-usage', 
                    '--disable-gpu',
                    '--js-flags="--max-old-space-size=250"' // Forces Chrome to use less Heroku RAM
                ]
            });
        }
        browser = globalTaskBrowser;
        page = await browser.newPage();
        await page.setViewport({ width: 412, height: 915 });
        await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');

        // 2. Load session and navigate to Task Page
        await updateStatus('[SYSTEM] Loading database memory and teleporting to Task Page...');
        await page.goto('https://www.wsjobs-ng.com', { waitUntil: 'networkidle2' });
        await loadSessionFromDB('wsjobs_task', page);

        await page.goto('https://www.wsjobs-ng.com/task', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 4000));

        // 3. Failsafe Login check
        const requiresLogin = await page.$('input[type="password"]') !== null;
        if (requiresLogin) {
            await updateStatus('[SYSTEM] Session expired. Executing emergency login...');
            const allInputs = await page.$$('input');
            const visibleInputs = [];
            for (let input of allInputs) {
                if (await input.evaluate(el => el.offsetParent !== null && window.getComputedStyle(el).display !== 'none')) {
                    visibleInputs.push(input);
                }
            }

            if (visibleInputs.length >= 2) {
                await visibleInputs[0].evaluate(el => el.value = '');
                await visibleInputs[0].type('09163916311', { delay: 50 });
                await visibleInputs[1].evaluate(el => el.value = '');
                await visibleInputs[1].type('Emmamama', { delay: 50 });
                await new Promise(r => setTimeout(r, 1000));
                
                await page.evaluate(() => {
                    const elements = Array.from(document.querySelectorAll('*'));
                    for (let el of elements) {
                        if (el.innerText && el.innerText.trim() === 'Login' && el.offsetParent !== null) el.click();
                    }
                });
            }
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
            await page.goto('https://www.wsjobs-ng.com/task', { waitUntil: 'networkidle2' });
            await new Promise(r => setTimeout(r, 4000));
        }

        // 4. WAIT FOR POPUPS TO ACTUALLY LOAD
        await updateStatus('[SYSTEM] Waiting for website to spawn tutorial popups...');
        await page.waitForFunction(() => {
            const bodyText = document.body.innerText.toLowerCase();
            return bodyText.includes('1 of 6') || bodyText.includes('next →') || bodyText.includes('done');
        }, { timeout: 10000 }).catch(() => {});

        // 5. THE AGGRESSIVE 6-STEP SWEEPER
        await updateStatus('[SYSTEM] Engaging aggressive tutorial sweeper...');
        let clickCount = 0;
        
        for (let i = 0; i < 20; i++) {
            const clicked = await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('*'));
                for (let el of elements.reverse()) { 
                    if (el.offsetParent === null) continue;
                    
                    const txt = (el.innerText || '').trim().toLowerCase();
                    if (txt === 'next' || txt === 'next →' || txt === 'done') {
                        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                        el.click();
                        if (el.parentElement) {
                            el.parentElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                            el.parentElement.click();
                        }
                        return true;
                    }
                }
                return false;
            });

            if (clicked) {
                clickCount++;
                await new Promise(r => setTimeout(r, 1200)); 
            } else {
                await new Promise(r => setTimeout(r, 500)); 
            }
        }

        // 6. SAVE TO DATABASE AND STOP (NO SEND BUTTONS CLICKED!)
        if (clickCount > 0) {
            await updateStatus(`[SYSTEM] Cleared ${clickCount} popups. Saving clean memory to Database...`);
            await saveSessionToDB('wsjobs_task', page);
        } else {
            await updateStatus(`[SYSTEM] No tutorial popups found. The screen was already clean.`);
        }

        await new Promise(r => setTimeout(r, 2000));
        const snap = await page.screenshot({ type: 'png' });
        await bot.sendPhoto(chatId, snap, { caption: `[SUCCESS] /pop setup complete! Screen is clean and saved to Database.` });

    } catch (err) {
        await updateStatus(`[ERROR] Sweeper failed: ${err.message}`);
    } finally {
        // ALWAYS safely close the tab so it doesn't drain your Heroku memory
        if (page) await page.close().catch(() => {});
    }
});



// --- THE M4U WITHDRAW COMMAND ---
// Usage: /withdraw m4u
bot.onText(/\/withdraw\s+m4u/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    let statusMsg = await bot.sendMessage(chatId, `[SYSTEM] Initiating M4U Auto-Withdrawal Protocol...`);

    const updateStatus = async (text) => {
        await bot.editMessageText(text, { chat_id: chatId, message_id: statusMsg.message_id }).catch(() => {});
    };

    try {
        // --- 1. ENGINE WARM-UP & AUTHENTICATION ---
        if (!m4uBrowser || !m4uPage) {
            await updateStatus('[SYSTEM] Cold Boot: Launching background Chrome engine...');
            m4uBrowser = await puppeteer.launch({
                headless: true,
                executablePath: getChromePath(),
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
            });
            
            const context = m4uBrowser.defaultBrowserContext();
            await context.overridePermissions('https://taskm4u.com', ['clipboard-read', 'clipboard-write']);

            m4uPage = await m4uBrowser.newPage();
            await m4uPage.setViewport({ width: 412, height: 915 }); 
            await m4uPage.setUserAgent('Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');

            // Login
            await updateStatus('[SYSTEM] Logging into TaskM4U...');
            await m4uPage.goto('https://taskm4u.com/#/login', { waitUntil: 'networkidle2' });
            
            const inputs = await m4uPage.$$('input');
            if (inputs.length >= 2) {
                await inputs[0].type('Staring', { delay: 50 });
                await inputs[1].type('Emmama', { delay: 50 });
                await new Promise(r => setTimeout(r, 1000));
                await m4uPage.evaluate(() => {
                    Array.from(document.querySelectorAll('*')).forEach(el => {
                        if (el.innerText && el.innerText.trim() === 'Login') el.click();
                    });
                });
            }
            await m4uPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 3000));
            
            // Clear popups
            await m4uPage.evaluate(() => {
                Array.from(document.querySelectorAll('*')).forEach(el => {
                    if (el.innerText && el.innerText.trim() === 'Close' && el.offsetParent !== null) el.click();
                });
            });
            await new Promise(r => setTimeout(r, 1500));
        }

        // --- 2. TELEPORT TO MINE & SCAN BALANCE ---
        await updateStatus('[SYSTEM] Teleporting to User Profile to scan balance...');
        await m4uPage.goto('https://taskm4u.com/#/mine', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 3000));

        const balanceData = await m4uPage.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('*'));
            for (let i = 0; i < elements.length; i++) {
                const text = (elements[i].innerText || '').trim();
                // Find the label, the balance is usually the next major element
                if (text === 'Account Balance') {
                    // Look around for the big number (e.g., 6,057.50)
                    const containerText = elements[i].parentElement.innerText || '';
                    const match = containerText.match(/[\d,]+\.\d{2}/); 
                    if (match) return match[0];
                }
            }
            return null;
        });

        if (!balanceData) {
            throw new Error("Could not detect Account Balance on the page.");
        }

        // Convert formatted string "6,057.50" to clean float 6057.50
        const rawBalance = parseFloat(balanceData.replace(/,/g, ''));
        
        if (rawBalance < 6000) {
            await updateStatus(`[FAILED] Current balance is ${balanceData}. You need at least 6000 to withdraw.`);
            return; // Abort safely
        }

        await updateStatus(`[SYSTEM] Balance verified: ${balanceData}. Proceeding to withdraw all...`);

        // --- 3. EXECUTE WITHDRAWAL ---
        await m4uPage.goto('https://taskm4u.com/#/withdraw', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 3000));

        // Enter Amount
        await updateStatus(`[SYSTEM] Entering amount...`);
        const allInputs = await m4uPage.$$('input');
        for (let input of allInputs) {
            const ph = await m4uPage.evaluate(el => el.placeholder || '', input);
            if (ph.toLowerCase().includes('amount')) {
                await input.click();
                // Type the exact clean number without commas
                await input.type(rawBalance.toString(), { delay: 100 });
                break;
            }
        }
        await new Promise(r => setTimeout(r, 1500));

        // Click Withdraw Now
        await updateStatus(`[SYSTEM] Clicking "Withdraw Now"...`);
        await m4uPage.evaluate(() => {
            Array.from(document.querySelectorAll('*')).forEach(el => {
                if (el.innerText && el.innerText.trim() === 'Withdraw Now' && el.offsetParent !== null) el.click();
            });
        });
        await new Promise(r => setTimeout(r, 3000));

                // --- 4. SMART MULTI-STEP WIZARD SWEEPER ---
        await updateStatus(`[SYSTEM] Navigating M4U multi-step withdrawal wizard...`);
        
        // Loop 4 times to blast through Step 1, Step 2, Step 3, and any final "Kind Reminder" popups
        for (let step = 0; step < 4; step++) {
            await m4uPage.evaluate(() => {
                const confirmBtns = Array.from(document.querySelectorAll('*')).filter(el => {
                    const txt = (el.innerText || el.textContent || '').trim();
                    // Catch both 'Confirm' and 'Withdraw' buttons as we move through the wizard steps
                    return (txt === 'Confirm' || txt === 'Withdraw') && el.offsetParent !== null;
                });
                
                if (confirmBtns.length > 0) {
                    // Always grab the last one to bypass overlapping background layers
                    const targetBtn = confirmBtns[confirmBtns.length - 1];
                    targetBtn.scrollIntoView({ block: 'center' });
                    
                    // Aggressive synthetic click to guarantee the website registers it
                    targetBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    targetBtn.click();
                    if (targetBtn.parentElement) targetBtn.parentElement.click();
                }
            });
            // Wait 3 seconds for the next step of the wizard to load before looping again
            await new Promise(r => setTimeout(r, 3000)); 
        }


        // --- 5. SNAPSHOT & FINISH ---
        await updateStatus(`[SUCCESS] Full withdrawal of ${balanceData} executed successfully!`);
        const snap = await m4uPage.screenshot({ type: 'png' });
        await bot.sendPhoto(chatId, snap, { caption: `[SUCCESS] Withdrawal Final State` });

    } catch (err) {
        await updateStatus(`[ERROR] Withdrawal failed: ${err.message}`);
        if (m4uPage) {
            try {
                const errSnap = await m4uPage.screenshot({ type: 'png' });
                await bot.sendPhoto(chatId, errSnap, { caption: '[DIAGNOSTIC] Screen state at failure.' });
            } catch (e) {}
        }
    }
});




// --- GLOBAL VARIABLES FOR M4U PAIRING ---
let m4uSession = null;
let m4uBrowser = null;
let m4uPage = null;
let m4uTimer = null;

// The 30-Minute Killswitch
const resetM4uTimer = (chatId) => {
    if (m4uTimer) clearTimeout(m4uTimer);
    m4uTimer = setTimeout(async () => {
        bot.sendMessage(chatId, '[SYSTEM] 30 minutes of inactivity elapsed. Closing M4U pairing session to save RAM.');
        m4uSession = null;
        if (m4uBrowser) {
            await m4uBrowser.close().catch(() => {});
            m4uBrowser = null;
            m4uPage = null;
        }
    }, 30 * 60 * 1000); // 30 minutes
};

// --- THE M4U START COMMAND ---
// Usage: /pair m4u
bot.onText(/^(?:\/pair\s+m4u|Pair M4U)$/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    // Reset any existing session and start fresh (Added linkedCount counter!)
    m4uSession = { state: 'WAITING_COUNTRY', country: null, linkedCount: 0 };
    bot.sendMessage(chatId, '[SYSTEM] M4U Pairing Protocol Initiated.\n\nPlease reply with the Country Code you want to use (e.g., +234 or 234):\n\n(Idle timeout set to 30 minutes)');
});


// --- UNIFIED MESSAGE LISTENER ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;
    if (!msg.text || msg.text.startsWith('/')) return;

    // 1. WhatsApp Connection Flow
    if (userState[chatId] === 'WAITING_FOR_NUMBER') {
        const phoneNumber = msg.text.replace(/[^0-9]/g, '');
        if (phoneNumber.length < 7) {
            bot.sendMessage(chatId, '[ERROR] Invalid phone number. Try again.');
            return;
        }
        userState[chatId] = null; 
        bot.sendMessage(chatId, `[SYSTEM] Initializing Pairing Code protocol for +${phoneNumber}...`);
        initializeWhatsApp(chatId, phoneNumber);
        return;
    }

    // 2. M4U Pairing Continuous Loop
    if (m4uSession) {
        
        // --- PHASE A: SETTING THE COUNTRY CODE ---
        if (m4uSession.state === 'WAITING_COUNTRY') {
            const rawCountry = msg.text.trim().replace('+', ''); 
            m4uSession.country = rawCountry;
            m4uSession.state = 'BOOTING_BROWSER';
            
            let statusMsg = await bot.sendMessage(chatId, `[SYSTEM] Country code +${rawCountry} locked in. Preparing M4U browser...`);
            
            try {
                if (!m4uBrowser || !m4uPage) {
                    m4uBrowser = await puppeteer.launch({
                        headless: true,
                        executablePath: getChromePath(),
                        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
                    });
                    
                    const context = m4uBrowser.defaultBrowserContext();
                    await context.overridePermissions('https://taskm4u.com', ['clipboard-read', 'clipboard-write']);

                    m4uPage = await m4uBrowser.newPage();
                    await m4uPage.setViewport({ width: 412, height: 915 }); 
                    await m4uPage.setUserAgent('Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');

                    // Login
                    await bot.editMessageText('[SYSTEM] Cold Boot: Logging into TaskM4U...', { chat_id: chatId, message_id: statusMsg.message_id }).catch(()=>{});
                    await m4uPage.goto('https://taskm4u.com/#/login', { waitUntil: 'networkidle2' });
                    
                    const inputs = await m4uPage.$$('input');
                    if (inputs.length >= 2) {
                        await inputs[0].type('Staring', { delay: 50 });
                        await inputs[1].type('Emmama', { delay: 50 });
                        await new Promise(r => setTimeout(r, 1000));
                        await m4uPage.evaluate(() => {
                            Array.from(document.querySelectorAll('*')).forEach(el => {
                                if (el.innerText && el.innerText.trim() === 'Login') el.click();
                            });
                        });
                    }
                    
                    await m4uPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
                    await new Promise(r => setTimeout(r, 3000));

                    // Clear Homepage Popup and Click WhatsApp Start
                    await bot.editMessageText('[SYSTEM] Clearing popups and locking onto WhatsApp Message Task...', { chat_id: chatId, message_id: statusMsg.message_id }).catch(()=>{});
                    
                    await m4uPage.evaluate(() => {
                        Array.from(document.querySelectorAll('*')).forEach(el => {
                            if (el.innerText && el.innerText.trim() === 'Close' && el.offsetParent !== null) el.click();
                        });
                    });
                    await new Promise(r => setTimeout(r, 1500));
                    
                    await m4uPage.evaluate(() => {
                        const startButtons = Array.from(document.querySelectorAll('div, button, span, a')).filter(el => el.innerText && el.innerText.trim() === 'Start');
                        for (let btn of startButtons) {
                            let containerText = '';
                            if (btn.parentElement && btn.parentElement.parentElement) {
                                containerText = btn.parentElement.parentElement.innerText.toLowerCase();
                            }
                            if (containerText.includes('whatsapp') && btn.offsetParent !== null) {
                                btn.click();
                                return true;
                            }
                        }
                    });
                    await new Promise(r => setTimeout(r, 4000));

                } else {
                    await bot.editMessageText('[SYSTEM] Warm Boot: Browser already active. Reusing existing session...', { chat_id: chatId, message_id: statusMsg.message_id }).catch(()=>{});
                    if (!m4uPage.url().includes('HangTask')) {
                        await m4uPage.goto('https://taskm4u.com/#/HangTask', { waitUntil: 'networkidle2' });
                        await new Promise(r => setTimeout(r, 3000));
                    }
                }

                // Step 3: Open the Popup
                await bot.editMessageText(`[SYSTEM] Accessing country selector...`, { chat_id: chatId, message_id: statusMsg.message_id }).catch(()=>{});
                
                const isPopupOpen = await m4uPage.evaluate(() => {
                    const phoneInput = Array.from(document.querySelectorAll('input')).find(i => i.placeholder && i.placeholder.toLowerCase().includes('phone number'));
                    return phoneInput && phoneInput.offsetParent !== null;
                });

                if (!isPopupOpen) {
                    await m4uPage.evaluate(() => {
                        Array.from(document.querySelectorAll('*')).forEach(el => {
                            if (el.innerText && el.innerText.trim().toLowerCase() === 'add' && el.offsetParent !== null) el.click();
                        });
                    });
                    await new Promise(r => setTimeout(r, 2000));
                }

                // Directly click the current country code button to open the list
                await m4uPage.evaluate(() => {
                    const elements = Array.from(document.querySelectorAll('*'));
                    for (let el of elements) {
                        const txt = (el.innerText || '').trim();
                        if (txt.match(/^\+\d{1,4}$/) && el.offsetParent !== null && el.children.length === 0) {
                            el.click();
                            return true;
                        }
                    }
                });
                await new Promise(r => setTimeout(r, 2000));

                // Type in the search box
                const allInputs = await m4uPage.$$('input');
                for (let input of allInputs) {
                    const ph = await m4uPage.evaluate(el => el.placeholder || '', input);
                    if (ph.toLowerCase().includes('country')) {
                        await input.click();
                        await input.type(rawCountry, { delay: 100 });
                        break;
                    }
                }
                await new Promise(r => setTimeout(r, 2000));

                // EXACT MATCH AGGRESSIVE CLICKER
                await m4uPage.evaluate((country) => {
                    const targetCode = '+' + country;
                    const allElements = Array.from(document.querySelectorAll('*'));
                    
                    for (let el of allElements) {
                        if (el.children.length === 0 && (el.innerText || '').trim() === targetCode && el.offsetParent !== null) {
                            el.click(); 
                            if (el.parentElement) el.parentElement.click(); 
                            return;
                        }
                    }

                    for (let el of allElements) {
                        const txt = (el.innerText || '').trim();
                        if (txt && txt.length < 50 && el.offsetParent !== null) {
                            const parts = txt.split(/[\s\n]+/);
                            if (parts[parts.length - 1] === targetCode) {
                                el.click();
                                return;
                            }
                        }
                    }
                }, rawCountry);
                await new Promise(r => setTimeout(r, 3000));

                // Re-open the popup by clicking Add again
                await m4uPage.evaluate(() => {
                    Array.from(document.querySelectorAll('*')).forEach(el => {
                        if (el.innerText && el.innerText.trim().toLowerCase() === 'add' && el.offsetParent !== null) el.click();
                    });
                });
                await new Promise(r => setTimeout(r, 2000));

                m4uSession.state = 'WAITING_NUMBER';
                resetM4uTimer(chatId); 
                
                const snap = await m4uPage.screenshot({ type: 'png' });
                await bot.sendPhoto(chatId, snap, { caption: `[SUCCESS] Browser is ready and exact country code (+${rawCountry}) is set!\n\nJust reply with the phone number to get the code.` });

            } catch (err) {
                bot.sendMessage(chatId, `[ERROR] Failed to set up M4U target: ${err.message}`);
                m4uSession = null;
            }
            return;
        }

        // --- PHASE B: NUMBER PROCESSING AND MONITORING ---
        if (m4uSession.state === 'WAITING_NUMBER' || m4uSession.state === 'WAITING_FOR_LINK') {
            const targetNumber = msg.text.trim().replace(/[^0-9]/g, '');
            let statusMsg = await bot.sendMessage(chatId, `[SYSTEM] Processing number ${targetNumber}...`);
            resetM4uTimer(chatId); 

            // If we were waiting for a previous link, it means you want to skip/abort it.
            const wasWaitingForLink = (m4uSession.state === 'WAITING_FOR_LINK');
            m4uSession.state = 'FETCHING_CODE'; // Changing state kills the background monitoring loop safely

            try {
                // If you are overriding a pending link, close the old popup to wipe the slate clean
                if (wasWaitingForLink) {
                    await bot.editMessageText(`[SYSTEM] Aborting previous number. Resetting popup for ${targetNumber}...`, { chat_id: chatId, message_id: statusMsg.message_id }).catch(()=>{});
                    await m4uPage.evaluate(() => {
                        Array.from(document.querySelectorAll('*')).forEach(el => {
                            if (el.innerText && el.innerText.trim() === 'Close' && el.offsetParent !== null) el.click();
                        });
                    });
                    await new Promise(r => setTimeout(r, 1500));
                }

                // Check if popup is open. If not, click "Add" to get a fresh empty box
                const isPopupOpenNow = await m4uPage.evaluate(() => {
                    const phoneInput = Array.from(document.querySelectorAll('input')).find(i => i.placeholder && i.placeholder.toLowerCase().includes('phone number'));
                    return phoneInput && phoneInput.offsetParent !== null;
                });

                if (!isPopupOpenNow) {
                    await m4uPage.evaluate(() => {
                        Array.from(document.querySelectorAll('*')).forEach(el => {
                            if (el.innerText && el.innerText.trim().toLowerCase() === 'add' && el.offsetParent !== null) el.click();
                        });
                    });
                    await new Promise(r => setTimeout(r, 2000));
                }

                await bot.editMessageText(`[SYSTEM] Requesting code for ${targetNumber}...`, { chat_id: chatId, message_id: statusMsg.message_id }).catch(()=>{});

                // Clear the input perfectly
                await m4uPage.evaluate(() => {
                    const inputs = Array.from(document.querySelectorAll('input'));
                    const phoneInput = inputs.find(i => i.placeholder && i.placeholder.toLowerCase().includes('phone number'));
                    if (phoneInput) phoneInput.value = '';
                });
                
                const inputHandles = await m4uPage.$$('input');
                for (let handle of inputHandles) {
                    const isPhone = await m4uPage.evaluate(el => el.placeholder && el.placeholder.toLowerCase().includes('phone number'), handle);
                    if (isPhone) {
                        await handle.type(targetNumber, { delay: 50 });
                    }
                }
                
                // Click 'get code'
                await m4uPage.evaluate(() => {
                    Array.from(document.querySelectorAll('*')).forEach(el => {
                        if (el.innerText && el.innerText.trim().toLowerCase() === 'get code' && el.offsetParent !== null) el.click();
                    });
                });

                // --- SMART DETECTION LOOP ---
                let fetchResult = null;
                
                for (let i = 0; i < 15; i++) {
                    await new Promise(r => setTimeout(r, 1000));

                    fetchResult = await m4uPage.evaluate(() => {
                        const bodyText = document.body.innerText.toLowerCase();
                        
                        if (bodyText.includes('failed to obtain') || bodyText.includes('network error') || bodyText.includes('frequently')) {
                            return { status: 'error', message: 'Failed to obtain code from the server.' };
                        }

                        const possibleContainers = Array.from(document.querySelectorAll('div, section'));
                        for (let c of possibleContainers) {
                            if (c.children.length >= 8 && c.children.length <= 15) {
                                const chars = Array.from(c.children)
                                    .map(child => (child.innerText || '').trim())
                                    .filter(txt => txt.length === 1 && /[A-Z0-9]/i.test(txt));

                                if (chars.length === 8) {
                                    const codeString = chars.join('');
                                    const copyBtn = c.children[c.children.length - 1];
                                    if (copyBtn) copyBtn.click();

                                    return { status: 'success', code: codeString };
                                }
                            }
                        }
                        return { status: 'pending' };
                    });

                    if (fetchResult && fetchResult.status !== 'pending') break;
                }

                // --- PROCESS THE RESULT ---
                if (!fetchResult || fetchResult.status === 'pending') {
                    m4uSession.state = 'WAITING_NUMBER';
                    const errSnap = await m4uPage.screenshot({ type: 'png' });
                    await bot.sendPhoto(chatId, errSnap, { caption: `[TIMEOUT] Could not detect code or failure message after 15 seconds. Here is the screen state:` });
                } 
                else if (fetchResult.status === 'error') {
                    m4uSession.state = 'WAITING_NUMBER';
                    bot.sendMessage(chatId, `[ERROR] For number ${targetNumber}:\n${fetchResult.message}`);
                } 
                else if (fetchResult.status === 'success') {
                    
                    // SEND THE INLINE COPY BUTTON
                    const successMsg = `[SUCCESS] Code obtained for ${targetNumber}!\n\nWaiting for you to enter it in WhatsApp... (Monitoring popup)`;
                    
                    bot.sendMessage(chatId, successMsg, { 
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: `Copy: ${fetchResult.code}`, copy_text: { text: fetchResult.code } }
                            ]]
                        }
                    });

                    // --- ENTER BACKGROUND MONITORING MODE ---
                    m4uSession.state = 'WAITING_FOR_LINK';

                    // Fire-and-forget background loop (Waits up to 30 mins for the popup to close automatically)
                    (async () => {
                        let popupClosed = false;
                        
                        for(let i = 0; i < 900; i++) { // 900 loops * 2 seconds = 30 minutes
                            // If you send a new number, the state changes and this loop safely kills itself!
                            if (!m4uSession || m4uSession.state !== 'WAITING_FOR_LINK') return; 

                            const isClosed = await m4uPage.evaluate(() => {
                                const phoneInput = Array.from(document.querySelectorAll('input')).find(i => i.placeholder && i.placeholder.toLowerCase().includes('phone number'));
                                return !phoneInput || phoneInput.offsetParent === null;
                            });

                            if(isClosed) {
                                popupClosed = true;
                                break;
                            }
                            await new Promise(r => setTimeout(r, 2000));
                        }

                        // Verify state didn't change while we were sleeping
                        if (!m4uSession || m4uSession.state !== 'WAITING_FOR_LINK') return;

                        if (popupClosed) {
                            m4uSession.linkedCount++; // Increment the counter!
                            bot.sendMessage(chatId, `[VERIFIED] Number successfully linked!\n\nTotal numbers processed: ${m4uSession.linkedCount}\n\nRe-opening popup for the next number...`);
                            
                            // Re-open popup for the next one
                            await m4uPage.evaluate(() => {
                                Array.from(document.querySelectorAll('*')).forEach(el => {
                                    if (el.innerText && el.innerText.trim().toLowerCase() === 'add' && el.offsetParent !== null) el.click();
                                });
                            });
                            await new Promise(r => setTimeout(r, 2000));
                            
                            m4uSession.state = 'WAITING_NUMBER';
                            bot.sendMessage(chatId, `[SYSTEM] Ready! Send the next number.`);
                        } else {
                            // 30 mins timeout reached without linking
                            bot.sendMessage(chatId, `[TIMEOUT] The popup didn't close within 30 minutes. Resetting the popup for a new number...`);
                            
                            await m4uPage.evaluate(() => {
                                Array.from(document.querySelectorAll('*')).forEach(el => {
                                    if (el.innerText && el.innerText.trim() === 'Close' && el.offsetParent !== null) el.click();
                                });
                            });
                            await new Promise(r => setTimeout(r, 1500));
                            
                            await m4uPage.evaluate(() => {
                                Array.from(document.querySelectorAll('*')).forEach(el => {
                                    if (el.innerText && el.innerText.trim().toLowerCase() === 'add' && el.offsetParent !== null) el.click();
                                });
                            });
                            await new Promise(r => setTimeout(r, 2000));
                            
                            m4uSession.state = 'WAITING_NUMBER';
                        }
                    })(); // Executes asynchronously
                }

            } catch (err) {
                bot.sendMessage(chatId, `[ERROR] Sequence crashed: ${err.message}`);
                m4uSession.state = 'WAITING_NUMBER';
            }
            return;
        }
    }
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
