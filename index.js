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

// Usage: /pair m4u
bot.onText(/\/pair\s+m4u/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    // Reset any existing session and start fresh
    m4uSession = { state: 'WAITING_COUNTRY', country: null };
    bot.sendMessage(chatId, '[SYSTEM] M4U Pairing Protocol Initiated.\n\nPlease reply with the Country Code you want to use (e.g., +234 or 234):');
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
            userDataDir: './wsjobs_auth_session', // THE MAGIC: This folder saves your cookies and tokens!
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 412, height: 915 }); 
        await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');

        // --- STEP 1: CHECK SAVED SESSION ---
        await updateStatus('[SYSTEM] Checking for saved session...');
        await page.goto('https://www.wsjobs-ng.com/user', { waitUntil: 'networkidle2' });
        
        // Wait 4 seconds to see if the website redirects us to the login page or lets us stay
        await new Promise(r => setTimeout(r, 4000)); 

        // Check if the password box is on the screen. If it is, our session expired.
        const requiresLogin = await page.$('input[type="password"]') !== null;

        if (requiresLogin) {
            await updateStatus('[SYSTEM] Session expired or not found. Logging in...');
            
            const allInputs = await page.$$('input');
            const visibleInputs = [];

            for (let input of allInputs) {
                const isVisible = await input.evaluate(el => el.offsetParent !== null && window.getComputedStyle(el).display !== 'none');
                if (isVisible) visibleInputs.push(input);
            }

            if (visibleInputs.length >= 2) {
                await visibleInputs[0].click();
                await visibleInputs[0].type('09163916311', { delay: 100 });
                
                await visibleInputs[1].click();
                await visibleInputs[1].type('Emmamama', { delay: 100 });
                
                await new Promise(r => setTimeout(r, 1000));
                await page.keyboard.press('Enter');
                
                try {
                    await page.evaluate(() => {
                        const elements = Array.from(document.querySelectorAll('*'));
                        for (let el of elements) {
                            if (el.innerText && el.innerText.trim() === 'Login') el.click();
                        }
                    });
                } catch(e) {}
            } else {
                throw new Error("Could not find the physical input boxes on the screen.");
            }
            
            await updateStatus('[SYSTEM] Login submitted. Saving new session data...');
            // Wait to be redirected back to the User dashboard
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 4000)); 
            
        } else {
            // If the password box WASN'T there, the saved cookies worked!
            await updateStatus('[SYSTEM] Active saved session loaded! Skipped login step.');
        }

        // 📸 PROOF 1: USER PAGE
        const userSnap = await page.screenshot({ type: 'png' });
        await bot.sendPhoto(chatId, userSnap, { caption: '[TRACE 1] Verified on User Dashboard.' });

        // --- STEP 2: CLICK ACCOUNT WITHDRAWAL ---
        await updateStatus('[SYSTEM] Clicking "Account Withdrawal"...');
        await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('*'));
            for (let el of elements) {
                if (el.innerText && el.innerText.includes('Account Withdrawal')) el.click();
            }
        });
        await new Promise(r => setTimeout(r, 3000)); 

        // --- STEP 3: THE GEOMETRIC SMART CLICKER ---
        await updateStatus(`[SYSTEM] Selecting amount: ${withdrawAmount}...`);
        
        const amountClicked = await page.evaluate((amount) => {
            const allElements = Array.from(document.querySelectorAll('*'));
            let targetNode = null;
            let smallestArea = Infinity;

            for (let el of allElements) {
                const text = (el.innerText || el.textContent || '').trim();
                if (text.includes(amount)) {
                    if (text.includes('Withdrawable') || text.includes('Minimum') || text.includes('Maximum')) continue;
                    
                    const rect = el.getBoundingClientRect();
                    const area = rect.width * rect.height;
                    
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

        await updateStatus(`[SYSTEM] Clicking "Withdrawal Now"...`);
        await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('*'));
            for (let el of elements) {
                if (el.innerText && el.innerText.trim() === 'Withdrawal Now') el.click();
            }
        });
        await new Promise(r => setTimeout(r, 2000));

        // --- STEP 4: CONFIRMATION PAGE ---
        await updateStatus('[SYSTEM] Processing confirmation screen...');
        await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('*'));
            for (let el of elements) {
                if (el.innerText && el.innerText.trim() === 'Withdrawal') el.click();
            }
        });
        await new Promise(r => setTimeout(r, 2000));

        // --- STEP 5: ENTER PIN & FINALIZE ---
        await updateStatus('[SYSTEM] Entering withdrawal password digit-by-digit...');
        const pinInputs = await page.$$('input[type="password"], input[type="number"], input[type="text"]');
        
        const visiblePinInputs = [];
        for (let input of pinInputs) {
            const isVis = await input.evaluate(el => el.offsetParent !== null && window.getComputedStyle(el).display !== 'none');
            if (isVis) visiblePinInputs.push(input);
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

        await updateStatus('[SYSTEM] Clicking final Confirm button...');
        await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('*'));
            for (let el of elements) {
                if (el.innerText && el.innerText.trim() === 'Confirm') el.click();
            }
        });
        
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
    let pages = []; // Keep track of tabs so we can close them later

    try {
        // --- THE ENGINE WARM-UP (KEEPS BROWSER OPEN FOR NEXT TASK) ---
        if (!globalTaskBrowser) {
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

        // --- HELPER: SMART TUTORIAL SWEEPER (FIXED FOR "DONE") ---
        const sweepTutorial = async (targetPage) => {
            for (let i = 0; i < 10; i++) { // Loop enough times to catch all 6 steps
                const clicked = await targetPage.evaluate(() => {
                    const elements = Array.from(document.querySelectorAll('button, span, div, a'));
                    for (let el of elements) {
                        const txt = (el.innerText || '').trim().toLowerCase();
                        
                        // Specifically target the arrow OR the word "done"
                        if ((txt === 'next →' || txt.includes('next →') || txt === 'done') && el.offsetParent !== null) {
                            el.click();
                            return true;
                        }
                    }
                    return false;
                });
                if (!clicked) break; 
                await new Promise(r => setTimeout(r, 1000)); // Give the slide 1 second to transition
            }
        };

        // --- STEP 1: INITIALIZE MASTER TAB ---
        await updateStatus('[SYSTEM] Opening Master Tab...');
        const page1 = await browser.newPage();
        pages.push(page1);
        await page1.setViewport({ width: 412, height: 915 }); 
        await page1.setUserAgent('Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');

        await page1.goto('https://www.wsjobs-ng.com/task', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 3000)); 

        const requiresLogin = await page1.$('input[type="password"]') !== null;

        if (requiresLogin) {
            await updateStatus('[SYSTEM] Session expired. Performing Login...');
            const allInputs = await page1.$$('input');
            const visibleInputs = [];
            for (let input of allInputs) {
                const isVisible = await input.evaluate(el => el.offsetParent !== null && window.getComputedStyle(el).display !== 'none');
                if (isVisible) visibleInputs.push(input);
            }

            if (visibleInputs.length >= 2) {
                await visibleInputs[0].click();
                await visibleInputs[0].type('09163916311', { delay: 100 });
                await visibleInputs[1].click();
                await visibleInputs[1].type('Emmamama', { delay: 100 });
                
                await new Promise(r => setTimeout(r, 1000));
                await page1.keyboard.press('Enter');
            }
            
            await page1.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 3000)); 
            
            await page1.goto('https://www.wsjobs-ng.com/task', { waitUntil: 'networkidle2' });
            await new Promise(r => setTimeout(r, 3000));
        }

        // --- STEP 2: SWEEP MASTER TAB ---
        await updateStatus('[SYSTEM] Clearing tutorials on Master Tab...');
        await sweepTutorial(page1);

        // --- STEP 3: COUNT TARGETS & SPAWN CLONES ---
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
            await new Promise(r => setTimeout(r, 4000)); 
            await Promise.all(pages.slice(1).map(p => sweepTutorial(p)));
        }

        // --- STEP 4: TARGET ACQUISITION ---
        await updateStatus(`[SYSTEM] Clicking "Send" on all tabs...`);
        
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
        
        // Tell all browsers to click at EXACTLY 3.000 seconds from right now.
        const fireTime = Date.now() + 3000;
        
        await Promise.all(pages.map(async (p, idx) => {
            if (clickResults[idx]) {
                await p.evaluate((triggerTime) => {
                    // Calculate how many milliseconds are left until the exact fireTime
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

        // We wait the 3 seconds for the timebomb, plus 4 seconds for the server to process it
        await new Promise(r => setTimeout(r, 7000)); 

        // 📸 PROOF FROM TAB 1
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
        // WE DO NOT CLOSE THE BROWSER! We leave globalTaskBrowser open for the next run.
        // But we DO close the individual tabs so the server doesn't run out of RAM!
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


// --- GLOBAL VARIABLES FOR M4U PAIRING ---
let m4uSession = null;
let m4uBrowser = null;
let m4uPage = null;
let m4uTimer = null;

// The 20-Minute Killswitch
const resetM4uTimer = (chatId) => {
    if (m4uTimer) clearTimeout(m4uTimer);
    m4uTimer = setTimeout(async () => {
        bot.sendMessage(chatId, '[SYSTEM] 20 minutes of inactivity elapsed. Closing M4U pairing session to save RAM.');
        m4uSession = null;
        if (m4uBrowser) {
            await m4uBrowser.close().catch(() => {});
            m4uBrowser = null;
            m4uPage = null;
        }
    }, 20 * 60 * 1000); // 20 minutes
};

// --- THE M4U START COMMAND ---
// Usage: /pair m4u
bot.onText(/\/pair\s+m4u/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    // Reset any existing session and start fresh
    m4uSession = { state: 'WAITING_COUNTRY', country: null };
    bot.sendMessage(chatId, '[SYSTEM] M4U Pairing Protocol Initiated.\n\nPlease reply with the Country Code you want to use (e.g., +234 or 234):');
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
                // THE REUSE LOGIC: Only boot and login if the browser isn't already running
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

                    // Step 1: Login
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

                    // Step 2: Clear Homepage Popup and Click WhatsApp Start
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

                // Step 3: Open the Popup (If not already open)
                await bot.editMessageText(`[SYSTEM] Accessing popup and setting country code to +${rawCountry}...`, { chat_id: chatId, message_id: statusMsg.message_id }).catch(()=>{});
                
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

                // Click the country code selector box
                await m4uPage.evaluate(() => {
                    const inputs = Array.from(document.querySelectorAll('input'));
                    const phoneInput = inputs.find(i => i.placeholder && i.placeholder.toLowerCase().includes('phone number'));
                    if (phoneInput && phoneInput.previousElementSibling) {
                        phoneInput.previousElementSibling.click();
                    }
                });
                await new Promise(r => setTimeout(r, 2000));

                // Input the raw country code into the search box
                await m4uPage.evaluate((country) => {
                    const inputs = Array.from(document.querySelectorAll('input'));
                    const searchInput = inputs.find(i => i.placeholder && i.placeholder.toLowerCase().includes('country'));
                    if (searchInput) {
                        searchInput.value = country;
                        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }, rawCountry);
                await new Promise(r => setTimeout(r, 1500));

                // EXACT MATCH SELECTION
                await m4uPage.evaluate((country) => {
                    const elements = Array.from(document.querySelectorAll('div, span, li'));
                    const targetCode = '+' + country;
                    
                    const row = elements.find(el => {
                        if (!el.innerText || el.childElementCount > 5) return false;
                        const textParts = el.innerText.trim().split(/[\s\n]+/); 
                        const lastPart = textParts[textParts.length - 1]; 
                        return lastPart === targetCode; 
                    });
                    
                    if (row) row.click();
                }, rawCountry);
                await new Promise(r => setTimeout(r, 2000));

                // THE FIX: Click "Add" again to bring the popup back up after it closes!
                await m4uPage.evaluate(() => {
                    Array.from(document.querySelectorAll('*')).forEach(el => {
                        if (el.innerText && el.innerText.trim().toLowerCase() === 'add' && el.offsetParent !== null) el.click();
                    });
                });
                await new Promise(r => setTimeout(r, 2000));

                // Set state to ready
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

        // --- PHASE B: THE CONTINUOUS NUMBER LOOP WITH SMART EXTRACTION ---
        if (m4uSession.state === 'WAITING_NUMBER') {
            const targetNumber = msg.text.trim().replace(/[^0-9]/g, '');
            bot.sendMessage(chatId, `[SYSTEM] Fetching code for ${targetNumber}...`);
            resetM4uTimer(chatId); 

            try {
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

                // --- SMART DETECTION LOOP (WAIT FOR LOADING TO FINISH) ---
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
                    const errSnap = await m4uPage.screenshot({ type: 'png' });
                    await bot.sendPhoto(chatId, errSnap, { caption: `[TIMEOUT] Could not detect code or failure message after 15 seconds. Here is the screen state:` });
                } 
                else if (fetchResult.status === 'error') {
                    bot.sendMessage(chatId, `[ERROR] For number ${targetNumber}:\n${fetchResult.message}`);
                } 
                else if (fetchResult.status === 'success') {
                    bot.sendMessage(chatId, `[SUCCESS] Code obtained for ${targetNumber}!\n\nExtracted Code: \`${fetchResult.code}\`\n\nSend the next number to continue.`, { parse_mode: 'Markdown' });
                }

            } catch (err) {
                bot.sendMessage(chatId, `[ERROR] Sequence crashed: ${err.message}`);
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
