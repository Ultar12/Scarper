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
let globalTaskBrowser = null;
const userState = {};

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
                [{ text: 'Pair M4U' }, { text: 'Withdraw' }],
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
    try {
        browser = await puppeteer.launch({
            headless: true,
            executablePath: getChromePath(),
            userDataDir: './wsjobs_auth_session',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 412, height: 915 });
        await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');

        // Step 1: Check Session on User Dashboard
        await updateStatus('[SYSTEM] Checking Wsjobs session...');
        await page.goto('https://www.wsjobs-ng.com/user', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 4000));

        if (await page.$('input[type="password"]')) {
            await updateStatus('[SYSTEM] Session expired. Logging in...');
            const allInputs = await page.$$('input');
            const vis = [];
            for (let input of allInputs) {
                if (await input.evaluate(el => el.offsetParent !== null)) vis.push(input);
            }
            if (vis.length >= 2) {
                await vis[0].type('09163916311', { delay: 100 });
                await vis[1].type('Emmamama', { delay: 100 });
                await page.keyboard.press('Enter');
                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
                await new Promise(r => setTimeout(r, 4000));
            }
        }

        // Step 2: Scan Balance directly from User Page
        await updateStatus('[SYSTEM] Scanning Account Balance...');
        const balanceData = await page.evaluate(() => {
            const text = document.body.innerText || '';
            // Ultra-resilient scanner: Handles hidden line breaks, spaces, and colons perfectly
            const match = text.match(/Account\s*Balance[\s:\n]*([\d,]+(?:\.\d+)?)/i);
            if (match) return match[1];
            return null;
        });

        if (!balanceData) throw new Error("Could not detect Account Balance on the user page.");

        const rawBalance = parseFloat(balanceData.replace(/,/g, ''));
        if (rawBalance < 12000) {
            await updateStatus(`[FAILED] Balance is ${balanceData}. Minimum requirement is 12000.`);
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

        // Step 3: Teleport to Withdrawal Page
        await updateStatus('[SYSTEM] Jumping to withdrawal page to execute...');
        await page.goto('https://www.wsjobs-ng.com/withdrawal', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 4000));

        // Click the target tier block
        const clickedTier = await page.evaluate((amt) => {
            const elements = Array.from(document.querySelectorAll('div, span, button'));
            for (let el of elements) {
                if ((el.innerText || '').trim() === amt.toString() && el.offsetParent !== null) {
                    el.click();
                    return true;
                }
            }
            return false;
        }, targetAmount);

        if (!clickedTier) throw new Error(`Could not locate the physical button for tier: ${targetAmount}`);
        await new Promise(r => setTimeout(r, 1500));

        // Click Withdrawal Now
        await updateStatus(`[SYSTEM] Clicking "Withdrawal Now"...`);
        await page.evaluate(() => {
            Array.from(document.querySelectorAll('*')).forEach(el => {
                if (el.innerText && el.innerText.trim() === 'Withdrawal Now') el.click();
            });
        });
        await new Promise(r => setTimeout(r, 3000));

        // Confirmation Page
        await updateStatus('[SYSTEM] Processing confirmation screen...');
        await page.evaluate(() => {
            Array.from(document.querySelectorAll('*')).forEach(el => {
                if (el.innerText && el.innerText.trim() === 'Withdrawal' && el.offsetParent !== null) el.click();
            });
        });
        await new Promise(r => setTimeout(r, 3000));

        // PIN Code
        await updateStatus('[SYSTEM] Entering withdrawal PIN...');
        const pinInputs = await page.$$('input[type="password"], input[type="number"], input[type="text"]');
        const visiblePinInputs = [];
        for (let input of pinInputs) {
            if (await input.evaluate(el => el.offsetParent !== null)) visiblePinInputs.push(input);
        }

        const pin = '111111';
        if (visiblePinInputs.length === 6 || visiblePinInputs.length > 1) {
            for (let i = 0; i < pin.length && i < visiblePinInputs.length; i++) {
                await visiblePinInputs[i].click();
                await visiblePinInputs[i].type(pin[i], { delay: 50 });
            }
        } else if (visiblePinInputs.length > 0) {
            await visiblePinInputs[0].click();
            await page.keyboard.type(pin, { delay: 100 });
        }
        await new Promise(r => setTimeout(r, 1500));

        // Final Confirm
        await updateStatus('[SYSTEM] Submitting final confirmation...');
        await page.evaluate(() => {
            Array.from(document.querySelectorAll('*')).forEach(el => {
                if (el.innerText && el.innerText.trim() === 'Confirm' && el.offsetParent !== null) el.click();
            });
        });

        await updateStatus('[SYSTEM] Waiting for server response...');
        await new Promise(r => setTimeout(r, 5000));

        await updateStatus(`[SUCCESS] Auto-withdrawal of ${targetAmount} completed.`);
        const screenshotBuffer = await page.screenshot({ type: 'png' });
        await bot.sendPhoto(chatId, screenshotBuffer, { caption: `[SUCCESS] Wsjobs Final State` });

    } catch (err) {
        await updateStatus(`[ERROR] Sequence failed: ${err.message}`);
    } finally {
        if (browser) await browser.close();
    }
});


// --- CROSS-PLATFORM BALANCE CHECKER ---
bot.onText(/^(?:\/balance|Balance)$/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    let statusMsg = await bot.sendMessage(chatId, `⏳ Fetching balances...`);

    let wsjobsBal = '0.00';
    let m4uBal = '0.00';

    // --- 1. Wsjobs Balance Fetch ---
    let wBrowser = null;
    try {
        wBrowser = await puppeteer.launch({
            headless: true,
            executablePath: getChromePath(),
            userDataDir: './wsjobs_auth_session',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        const wPage = await wBrowser.newPage();
        await wPage.setViewport({ width: 412, height: 915 });
        
        await wPage.goto('https://www.wsjobs-ng.com/user', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 4000));

        if (await wPage.$('input[type="password"]')) {
            const allInputs = await wPage.$$('input');
            const vis = [];
            for(let i of allInputs) if(await i.evaluate(e=>e.offsetParent!==null)) vis.push(i);
            if(vis.length>=2) {
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
    } catch(e) {
        wsjobsBal = 'Error';
    } finally {
        if(wBrowser) await wBrowser.close();
    }

    // --- 2. M4U Balance Fetch ---
    try {
        let mBrowser = m4uBrowser;
        let shouldClose = false;
        if (!mBrowser) {
            mBrowser = await puppeteer.launch({
                headless: true,
                executablePath: getChromePath(),
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
            });
            shouldClose = true;
        }
        const mPage = await mBrowser.newPage();
        await mPage.setViewport({ width: 412, height: 915 });
        
        await mPage.goto('https://taskm4u.com/#/mine', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 4000));

        if (mPage.url().includes('login')) {
            const inputs = await mPage.$$('input');
            if (inputs.length >= 2) {
                await inputs[0].evaluate(el => el.value = '');
                await inputs[0].type('Staring', { delay: 50 });
                await inputs[1].evaluate(el => el.value = '');
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

        // EXACT LOGIC FROM YOUR WITHDRAWAL COMMAND
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

        await mPage.close();
        if (shouldClose) await mBrowser.close();
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
        // --- THE ENGINE WARM-UP ---
        if (typeof globalTaskBrowser === 'undefined' || !globalTaskBrowser) {
            await updateStatus('[SYSTEM] Cold Boot: Launching background Chrome engine...');
            globalTaskBrowser = await puppeteer.launch({
                headless: true,
                executablePath: getChromePath(),
                userDataDir: './wsjobs_auth_session', 
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
            });
        } else {
            await updateStatus('[SYSTEM] Warm Boot: Engine already running. Lightning fast start!');
        }
        browser = globalTaskBrowser;

        // --- THE GOLDEN FIX: DYNAMIC TUTORIAL TRACKER ---
        const sweepTutorial = async (targetPage) => {
            // Wait 2.5 seconds first to let the website drop the initial popup
            await new Promise(r => setTimeout(r, 2500)); 
            
            let maxAttempts = 20; 
            let emptyChecks = 0;
            
            while (maxAttempts > 0 && emptyChecks < 3) {
                maxAttempts--;
                const clicked = await targetPage.evaluate(() => {
                    // Grab all clickable elements on the screen
                    const elements = Array.from(document.querySelectorAll('button, div, span, a'));
                    for (let el of elements) {
                        if (el.offsetParent === null) continue; // Skip hidden elements
                        const txt = (el.innerText || '').trim().toLowerCase();
                        
                        // Dynamically hunt for the specific text
                        if (txt === 'next' || txt === 'next →' || txt === 'next ->' || txt.includes('next →') || txt === 'done') {
                            // Center the new button location on the screen and click
                            el.scrollIntoView({ block: 'center' });
                            el.click();
                            return true;
                        }
                    }
                    return false;
                });

                if (clicked) {
                    emptyChecks = 0; 
                    // Crucial: Wait 1 full second for the box to finish moving to its new position!
                    await new Promise(r => setTimeout(r, 1000)); 
                } else {
                    emptyChecks++; 
                    await new Promise(r => setTimeout(r, 1000)); 
                }
            }
        };

        // --- STEP 1: INITIALIZE MASTER TAB ---
        await updateStatus('[SYSTEM] Opening Master Tab...');
        const page1 = await browser.newPage();
        pages.push(page1);
        await page1.setViewport({ width: 412, height: 915 }); 
        await page1.setUserAgent('Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');

        await page1.goto('https://www.wsjobs-ng.com/task', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 4000)); 

        const requiresLogin = await page1.$('input[type="password"]') !== null;

        if (requiresLogin) {
            await updateStatus('[SYSTEM] Session expired. Performing Physical Login...');
            const allInputs = await page1.$$('input');
            const visibleInputs = [];
            for (let input of allInputs) {
                const isVisible = await input.evaluate(el => el.offsetParent !== null && window.getComputedStyle(el).display !== 'none');
                if (isVisible) visibleInputs.push(input);
            }

            if (visibleInputs.length >= 2) {
                await visibleInputs[0].evaluate(el => el.value = '');
                await visibleInputs[0].click();
                await visibleInputs[0].type('09163916311', { delay: 50 });
                
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

        // --- STEP 2: SWEEP MASTER TAB ---
        await updateStatus('[SYSTEM] Scanning for tutorials on Master Tab...');
        await sweepTutorial(page1);

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

        for (let i = 1; i < targetCount; i++) {
            const newPage = await browser.newPage();
            pages.push(newPage);
            await newPage.setViewport({ width: 412, height: 915 }); 
            await newPage.setUserAgent('Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
        }

        if (pages.length > 1) {
            await Promise.all(pages.slice(1).map(p => p.goto('https://www.wsjobs-ng.com/task', { waitUntil: 'networkidle2' })));
        }

        // --- STEP 3.5: FINAL SWEEP ON ALL TABS ---
        await updateStatus(`[SYSTEM] Performing Aggressive Pre-Strike Sweep on all tabs...`);
        await Promise.all(pages.map(p => sweepTutorial(p)));

        // --- STEP 4: TARGET ACQUISITION ---
        await updateStatus(`[SYSTEM] Tabs are 100% clear. Clicking "Send" on all targets...`);
        
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
                            btn.scrollIntoView({ block: 'center' });
                            btn.click();
                            return true;
                        }
                        matchCount++;
                    }
                }
                return false;
            }, targetSuffix, index);
        }));

        await new Promise(r => setTimeout(r, 2000));

        // --- STEP 5: THE SYNCHRONIZED TIMEBOMB (3 SECONDS) ---
        await updateStatus(`[SYSTEM] Waiting for popups to render...`);
        
        await Promise.all(pages.map(async (p, idx) => {
            if (clickResults[idx]) {
                await p.waitForFunction(() => {
                    return Array.from(document.querySelectorAll('*')).some(el => el.innerText && el.innerText.trim() === 'Confirm' && el.offsetParent !== null);
                }, { timeout: 5000 }).catch(() => null);
            }
        }));

        await updateStatus(`[SYSTEM] TIMEBOMB SET: Synchronizing Confirm clicks for exactly 3 SECONDS from now...`);
        
        const fireTime = Date.now() + 3000;
        
        await Promise.all(pages.map(async (p, idx) => {
            if (clickResults[idx]) {
                await p.evaluate((triggerTime) => {
                    const delay = Math.max(0, triggerTime - Date.now());
                    
                    setTimeout(() => {
                        const elements = Array.from(document.querySelectorAll('*'));
                        for (let el of elements) {
                            if (el.innerText && el.innerText.trim() === 'Confirm' && el.offsetParent !== null) {
                                el.click();
                            }
                        }
                    }, delay);
                }, fireTime);
            }
        }));

        await new Promise(r => setTimeout(r, 7000)); 

        await updateStatus(`[SUCCESS] Strike executed simultaneously!`);
        const screenshotBuffer = await pages[0].screenshot({ type: 'png' });
        await bot.sendPhoto(chatId, screenshotBuffer, { caption: `[SUCCESS] Snapshot from Master Tab after executing ${targetCount} synchronized clicks.` });

    } catch (err) {
        await updateStatus(`[ERROR] Sequence failed: ${err.message}`);
        if (pages.length > 0) {
            try {
                const errBuffer = await pages[0].screenshot({ type: 'png' });
                await bot.sendPhoto(chatId, errBuffer, { caption: '[DIAGNOSTIC] State of Master Tab at crash.' });
            } catch (snapErr) {}
        }
    } finally {
        for (let p of pages) {
            await p.close().catch(() => {});
        }
    }
});



bot.onText(/\/status/, (msg) => {
    if (msg.chat.id.toString() !== ADMIN_ID) return;
    const status = (waClient && waClient.info) ? 'ONLINE' : 'OFFLINE / WAITING FOR LOGIN';
    bot.sendMessage(msg.chat.id, `[SYSTEM] Current Status: ${status}`);
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

        // --- 4. CONFIRMATION PAGE & POPUP ---
        await updateStatus(`[SYSTEM] Submitting primary confirmation...`);
        await m4uPage.evaluate(() => {
            Array.from(document.querySelectorAll('*')).forEach(el => {
                // Ensure it's the Confirm button and it's visible
                if (el.innerText && el.innerText.trim() === 'Confirm' && el.offsetParent !== null) {
                    el.click();
                }
            });
        });
        await new Promise(r => setTimeout(r, 2000));

        await updateStatus(`[SYSTEM] Bypassing "Kind Reminder" modal...`);
        // The modal appears over the screen. We grab the LAST 'Confirm' button in the DOM (which is usually the modal popup)
        await m4uPage.evaluate(() => {
            const confirmBtns = Array.from(document.querySelectorAll('*')).filter(el => 
                el.innerText && el.innerText.trim() === 'Confirm' && el.offsetParent !== null
            );
            if (confirmBtns.length > 0) {
                // Click the highest z-index / most recent one in the DOM
                confirmBtns[confirmBtns.length - 1].click();
            }
        });
        await new Promise(r => setTimeout(r, 4000));

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
                                { text: `📋 Tap to Copy: ${fetchResult.code}`, copy_text: { text: fetchResult.code } }
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
                            bot.sendMessage(chatId, `🎉 [VERIFIED] Number successfully linked!\n\n🏆 Total numbers processed: ${m4uSession.linkedCount}\n\nRe-opening popup for the next number...`);
                            
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
