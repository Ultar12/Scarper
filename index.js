process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

const fs = require('fs');
const { execSync } = require('child_process');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { PostgresStore } = require('wwebjs-postgres');
const { Pool } = require('pg');
const path = require('path');
const { firefox } = require('playwright');
const sharp = require('sharp');
const puppeteer = require('puppeteer-core');
const QRCode = require('qrcode');
const { remote } = require('webdriverio');
const axios = require('axios');


const { PuppeteerScreenRecorder } = require('puppeteer-screen-recorder');




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

const capabilities = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'appium:deviceName': 'Android Emulator',
  'appium:app': 'https://path-to-your-whatsapp.apk', // Link to the APK file
  'appium:noReset': true,
  'appium:newCommandTimeout': 3600
};

const options = {
  path: '/wd/hub',
  port: 4723,
  capabilities
};



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

// --- WT BURNER SESSION TRACKER ---
const wtSessions = {}; 


const appiumSessions = {};

// --- AUTHORIZATION CONFIG ---
const ADMIN_ID = process.env.ADMIN_ID || '7710721646'; 

// Split the SUBADMIN_ID string by commas into a real array
const SUBADMIN_IDS = (process.env.SUBADMIN_ID || '').split(',').map(id => id.trim());

// Create a final list of all authorized users
const AUTHORIZED = [ADMIN_ID, ...SUBADMIN_IDS].filter(id => id !== '');

console.log(`[SYSTEM] Authorized Admins: ${AUTHORIZED.join(', ')}`);


// --- 2. HEROKU WEB SERVER SETUP ---
const app = express(); // 1. Create the app first!
const PORT = process.env.PORT || 3000;

// 2. NOW you can use app.use
app.use('/public', express.static(path.join(__dirname, 'public')));

// Ensure the directory exists so it doesn't crash later
if (!fs.existsSync('./public')) {
    fs.mkdirSync('./public');
}

app.get('/', (req, res) => res.send('WhatsApp Bot running with Postgres Auth.'));
app.listen(PORT, () => console.log(`Web server listening on port ${PORT}`));

// --- 3. TELEGRAM BOT SETUP ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '7806461656:AAFJLm-gOKgKrvPY06b0QTE1fKlVR9waOsQ';
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

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



// --- GLOBAL VARIABLES FOR TIMESMS SPY MODE ---
const seenTimesmsNumbers = new Set();
let spyIntervalTimer = null;
let isSpying = false;



// --- THE AUTO-SCRAPER FUNCTION (API WEBHOOK MODE) ---
async function scrapeRecentOTPNumbers() {
    let browser = null;
    let page = null;

    try {
        console.log('[SYSTEM] Executing TimeSMS Spy Sweep (Silent API Mode)...');

        browser = await puppeteer.launch({
            headless: true,
            executablePath: getChromePath(),
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });

        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // --- 1. LOGIN LOGIC ---
        await page.goto('https://timesms.org/login', { waitUntil: 'networkidle2' });

        const captchaAnswer = await page.evaluate(() => {
            const bodyText = document.body.innerText || '';
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

        if (!captchaAnswer) throw new Error("Captcha failed or could not be found.");

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

        // --- 2. TELEPORT TO SMS REPORTS ---
        await page.goto('https://timesms.org/client/SMSCDRStats', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 4000));

        // --- 3. SELECT 100 RECORDS ---
        await page.evaluate(() => {
            const selects = Array.from(document.querySelectorAll('select'));
            for (let select of selects) {
                const options = Array.from(select.options);
                const targetOpt = options.find(opt => opt.text.trim() === '100');
                if (targetOpt) {
                    select.value = targetOpt.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
            }
            return false;
        });

        await new Promise(r => setTimeout(r, 5000));

        // --- 4. EXTRACT TABLE DATA ---
        const scrapedNumbers = await page.evaluate(() => {
            const numbers = [];
            const rows = document.querySelectorAll('table tbody tr');
            for (let row of rows) {
                const cells = row.querySelectorAll('td');
                if (cells && cells.length >= 4) {
                    const numText = cells[2].innerText.trim();
                    const cleanNum = numText.replace(/\D/g, '');
                    if (cleanNum.length >= 8) {
                        numbers.push(cleanNum);
                    }
                }
            }
            return numbers;
        });

        // --- 5. FILTER DUPLICATES & SEND TO WEBHOOK API ---
        const newNumbers = [];
        for (let num of scrapedNumbers) {
            if (!seenTimesmsNumbers.has(num)) {
                newNumbers.push(num);
                seenTimesmsNumbers.add(num); 
            }
        }

        if (newNumbers.length > 0) {
            console.log(`[SYSTEM] Preparing payload of ${newNumbers.length} new numbers...`);
            
            // Format exact payload specification (newline separated string)
            const payload = {
                text: newNumbers.join('\n')
            };

            // Safely construct the webhook URL from your ENV
            const baseUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, '') : `https://${process.env.HEROKU_APP_NAME}.herokuapp.com`;
            const webhookUrl = `${baseUrl}/api/sync-numbers`;

            try {
                const response = await axios.post(webhookUrl, payload, {
                    headers: { 'Content-Type': 'application/json' }
                });
                
                console.log(`[API SUCCESS] Sent numbers to Webhook. Response:`, response.data);
            } catch (apiErr) {
                console.error(`[API ERROR] Webhook delivery failed: ${apiErr.message}`);
                // Optional: Alert Admin on API failure
                bot.sendMessage(ADMIN_ID, `[API ERROR] Failed to send numbers to Webhook: ${apiErr.message}`).catch(() => {});
            }

        } else {
            console.log('[SYSTEM] Scrape complete. Zero new numbers found.');
        }

    } catch (err) {
        console.error(`[ERROR] TimeSMS Scraper crashed: ${err.message}`);
        bot.sendMessage(ADMIN_ID, `[ERROR] Spy Sweep Crashed: ${err.message}`).catch(() => {});
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}



async function performM4USignIn(chatId) {
    let browser = null;
    let context = null;
    let page = null;
    const videoDir = path.join(__dirname, 'videos');
    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir);

    // --- ANTI-SPAM: Send one anchor message ---
    let statusMsg = await bot.sendMessage(chatId, '⚙️ [SYSTEM] Booting M4U Check-in Sequence...');
    const msgId = statusMsg.message_id;

    // --- ANTI-SPAM: Helper now EDITS the existing message ---
    const updateStatus = async (text) => {
        console.log(text);
        await bot.editMessageText(text, { chat_id: chatId, message_id: msgId }).catch(() => {});
    };

    try {
        process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
        
        browser = await firefox.launch({ 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        
        context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Android 13; Mobile; rv:110.0) Gecko/110.0 Firefox/110.0',
            viewport: { width: 412, height: 915 },
            recordVideo: { dir: videoDir, size: { width: 412, height: 915 } }
        });
        
        page = await context.newPage();

        // --- PHASE 1: LOGIN (THE VIDEO-PROVEN METHOD) ---
        await updateStatus('[SYSTEM] Navigating to M4U Login...');
        await page.goto('https://taskm4u.com/#/login', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000);

        const needsLogin = await page.evaluate(() => !!document.querySelector('input[placeholder*="phone number"]'));

        if (needsLogin) {
            await updateStatus('[SYSTEM] Injecting credentials...');
            
            const phoneInput = page.locator('input[placeholder*="phone number"]').first();
            await phoneInput.click();
            await phoneInput.type('Staring', { delay: 100 });

            const passInput = page.locator('input[placeholder*="password"]').first();
            await passInput.click();
            await passInput.type('Emmama', { delay: 100 });

            await page.waitForTimeout(1000);

            await page.evaluate(() => {
                Array.from(document.querySelectorAll('*')).forEach(el => {
                    if (el.innerText && el.innerText.trim() === 'Login' && el.offsetHeight > 0) {
                        el.click();
                        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                    }
                });
            });

            await updateStatus('[SYSTEM] Login clicked. Waiting for server to authenticate...');
            
            try {
                await page.waitForFunction(() => {
                    return !document.querySelector('input[placeholder*="phone number"]');
                }, { timeout: 15000 });
            } catch (e) {
                throw new Error("Site rejected the credentials or the server is unresponsive.");
            }

            await page.waitForTimeout(3000); 
        }

        // --- PHASE 2: TELEPORT TO SIGN-IN ---
        await updateStatus('[SYSTEM] Authentication confirmed. Teleporting to Check-in page...');
        await page.goto('https://taskm4u.com/#/signIn', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(4000);

        // --- 2.5: POPUP SWEEPER ---
        await updateStatus('[SYSTEM] Sweeping welcome ads and overlays...');
        await page.evaluate(() => {
            Array.from(document.querySelectorAll('button, div, span, a')).forEach(el => {
                if (el.innerText && el.innerText.trim() === 'Close' && el.offsetHeight > 0) {
                    el.click();
                    el.dispatchEvent(new MouseEvent('click', { bubbles: true, view: window }));
                }
            });

            const blockers = document.querySelectorAll('.van-overlay, .van-mask, [class*="mask"], [class*="overlay"]');
            blockers.forEach(o => o.remove());
        });
        
        await page.waitForTimeout(2000);

        // --- PHASE 3: THE CHECK-IN STRIKE (MOBILE UPGRADED) ---
        await updateStatus('[SYSTEM] Attempting "Check in Now!" strike...');
        
        let checkInResult = "ATTEMPTING";
        
        try {
            const checkInBtn = page.locator('text=/Check in Now!/i').last();
            await checkInBtn.tap({ force: true, timeout: 3000 }); 
            checkInResult = "NATIVE_TAP_EXECUTED";
        } catch (e) {
            checkInResult = await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('div, button, span'));
                const btn = elements.reverse().find(el => 
                    (el.innerText?.trim() === 'Check in Now!' || el.innerText?.trim() === 'Check-in') && el.offsetHeight > 0
                );

                if (btn) {
                    const rect = btn.getBoundingClientRect();
                    const x = rect.left + rect.width / 2;
                    const y = rect.top + rect.height / 2;

                    const ev = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
                    ['mousedown', 'mouseup', 'click'].forEach(t => btn.dispatchEvent(new MouseEvent(t, ev)));

                    try {
                        const touchObj = new Touch({ identifier: Date.now(), target: btn, clientX: x, clientY: y, radiusX: 2.5, radiusY: 2.5, rotationAngle: 10, force: 0.5 });
                        btn.dispatchEvent(new TouchEvent('touchstart', { cancelable: true, bubbles: true, touches: [touchObj], targetTouches: [touchObj], changedTouches: [touchObj] }));
                        btn.dispatchEvent(new TouchEvent('touchend', { cancelable: true, bubbles: true, touches: [], targetTouches: [], changedTouches: [touchObj] }));
                    } catch(err) {}

                    return "JS_STRIKE_EXECUTED";
                }
                return "BUTTON_NOT_FOUND";
            });
        }

        await page.mouse.click(206, 750).catch(() => {});
        await page.mouse.click(206, 700).catch(() => {});

        await page.waitForTimeout(5000);

        // --- PHASE 4: VERIFICATION ---
        const finalStatus = await page.evaluate(() => {
            const txt = document.body.innerText.toLowerCase();
            if (txt.includes('checked in') || txt.includes('success') || txt.includes('already') || txt.includes('completed')) {
                return "SUCCESS";
            }
            const btnStillThere = Array.from(document.querySelectorAll('*')).some(el => 
                el.innerText?.trim() === 'Check in Now!' && el.offsetHeight > 0
            );
            if (!btnStillThere) return "SUCCESS";
            return "FAILED";
        });

        const finalSnap = await page.screenshot({ type: 'png' });
        
        let vPath = null;
        if (page && page.video()) {
            vPath = await page.video().path().catch(() => null);
        }

        // Clean up the status text message so only the photo remains
        await bot.deleteMessage(chatId, msgId).catch(() => {});

        if (finalStatus === "SUCCESS") {
            await bot.sendPhoto(chatId, finalSnap, { caption: "✅ M4U Check-in Success." });
            await context.close();
            if (vPath && fs.existsSync(vPath)) fs.unlinkSync(vPath);
        } else {
            throw new Error(`Check-in failed. Button state: ${checkInResult}`);
        }

    } catch (err) {
        // --- BULLETPROOF CRASH HANDLER ---
        await updateStatus(`M4U Crash: ${err.message}`); // Leaves the error text on screen
        
        let vPath = null;
        let crashSnap = null;

        if (page) {
            try { crashSnap = await page.screenshot({ type: 'png' }); } catch(e) {}
            try { if (page.video()) vPath = await page.video().path().catch(() => null); } catch(e) {}
        }

        if (context) await context.close().catch(() => {});
        await new Promise(r => setTimeout(r, 2000));

        if (crashSnap) {
            await bot.sendPhoto(chatId, crashSnap, { caption: `[DIAGNOSTIC] Screen at moment of failure.` }).catch(() => {});
        }

        if (vPath && fs.existsSync(vPath)) {
            await bot.sendVideo(chatId, vPath, { caption: `[DIAGNOSTIC VIDEO] Session Recording` }).catch(() => {});
            setTimeout(() => { if (fs.existsSync(vPath)) fs.unlinkSync(vPath); }, 5000);
        }

    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}

// --- 4. TELEGRAM COMMAND LISTENERS ---

// --- INTERACTIVE CONTROL PANEL ---

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


bot.onText(/\/m4usign/i, (msg) => {
    if (msg.chat.id.toString() !== ADMIN_ID) return;
    bot.sendMessage(ADMIN_ID, "[SYSTEM] Manually triggering M4U Sign-in sequence...");
    performM4USignIn(ADMIN_ID);
});



bot.onText(/^\/testlogin$/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    let statusMsg = await bot.sendMessage(chatId, '[SYSTEM] Starting Firefox recording...');
    const videoDir = path.join(__dirname, 'videos');
    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir);

    let browser = null;
    let context = null;

    try {
        process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

        browser = await firefox.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Android 13; Mobile; rv:110.0) Gecko/110.0 Firefox/110.0',
            viewport: { width: 412, height: 915 },
            recordVideo: {
                dir: videoDir,
                size: { width: 412, height: 915 }
            }
        });

        const page = await context.newPage();

        // THE GLOBAL SNIPER: Targets the "OK" button on ANY page (Login or Homepage)
                // THE HUMAN MOUSE SNIPER
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            
            setInterval(() => {
                // 1. Find the OK button
                const okBtn = Array.from(document.querySelectorAll('*'))
                    .find(el => el.innerText?.trim() === 'OK' && el.offsetHeight > 0);
                
                if (okBtn) {
                    // 2. HUMAN-STYLE CLICK: Trigger a sequence of real pointer events
                    const rect = okBtn.getBoundingClientRect();
                    const x = rect.left + rect.width / 2;
                    const y = rect.top + rect.height / 2;

                    // Simulate a physical touch/mouse sequence
                    const events = ['mousedown', 'mouseup', 'click'];
                    events.forEach(type => {
                        okBtn.dispatchEvent(new MouseEvent(type, {
                            view: window,
                            bubbles: true,
                            cancelable: true,
                            clientX: x,
                            clientY: y
                        }));
                    });

                    // 3. NUCLEAR OPTION: If the button is still there after 1 second, 
                    // just delete the entire ad from the website's memory.
                    setTimeout(() => {
                        const modal = okBtn.closest('div[class*="modal"], div[class*="mask"], div[class*="popup"]');
                        if (modal) modal.remove();
                        
                        // Clean up the blurred background
                        document.body.style.setProperty('filter', 'none', 'important');
                        document.body.style.setProperty('overflow', 'auto', 'important');
                        document.body.style.setProperty('pointer-events', 'auto', 'important');
                        
                        // Remove any dark overlays
                        const overlays = document.querySelectorAll('[class*="mask"], [class*="overlay"]');
                        overlays.forEach(o => o.remove());
                    }, 1000);
                }
            }, 500); // Check every half-second
        });


        await page.goto('https://www.wsjobs-ng.com/account', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(4000); 

        // LOGIN PROCESS
        const loginInput = await page.$('input[type="text"], input[type="tel"]');
        if (loginInput) {
            await page.fill('input[type="text"], input[type="tel"]', '09163916500');
            await page.fill('input[type="password"]', 'Emmamama');
            
            const loginBtn = page.locator('text=/LOGIN|SIGN IN|SHIGA|ENTRAR/i').last();
            await loginBtn.dispatchEvent('click');
            
            // Wait for navigation to complete
            await page.waitForURL('**/user', { timeout: 15000 }).catch(() => {});
        }

        // HOMEPAGE CHECK
        // The sniper will work here automatically as the "Notice" appears
        await page.waitForTimeout(6000); 

        // Finalize Video
        const video = page.video();
        await context.close(); 
        
        if (video) {
            const videoPath = await video.path();
            await bot.sendVideo(chatId, videoPath, { 
                caption: 'Session Video: Login + Homepage Sniper Check' 
            });
            setTimeout(() => { if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath); }, 5000);
        }

        await bot.deleteMessage(chat_id, statusMsg.message_id).catch(() => {});

    } catch (err) {
        await bot.sendMessage(chatId, `[ERROR]: ${err.message}`);
    } finally {
        if (browser) await browser.close();
    }
});





// Listener for the actual file
bot.on('document', async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID || userState[chatId] !== 'WAITING_FOR_APK') return;

    if (!msg.document.file_name.endsWith('.apk')) {
        return bot.sendMessage(chatId, '[ERROR] That is not an APK file. Please send the correct file.');
    }

    let statusMsg = await bot.sendMessage(chatId, '[SYSTEM] APK detected. Converting to public URL...');

    try {
        const fileId = msg.document.file_id;
        const fileStream = bot.getFileStream(fileId);
        const fileName = 'whatsapp.apk'; 
        const savePath = path.join(__dirname, 'public', fileName);

        const writeStream = fs.createWriteStream(savePath);
        fileStream.pipe(writeStream);

        writeStream.on('finish', async () => {
            const baseUrl = process.env.APP_URL || `https://${process.env.HEROKU_APP_NAME}.herokuapp.com`;
            const downloadUrl = `${baseUrl}/public/${fileName}`;

            userState[chatId] = null; // Clear state
            await bot.editMessageText(`[SUCCESS] APK Hosted Successfully!\n\nURL:\n\`${downloadUrl}\``, {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown'
            });
        });

    } catch (err) {
        bot.sendMessage(chatId, `[ERROR] Conversion failed: ${err.message}`);
    }
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



bot.onText(/\/screenshot\s+(.+)/, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    let targetUrl = match[1].trim();
    if (!targetUrl.startsWith('http')) {
        targetUrl = 'https://' + targetUrl;
    }

    const statusMsg = await bot.sendMessage(chatId, '[SYSTEM] Initializing Firefox Snapshot...');

    let browser = null;
    try {
        process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

        browser = await firefox.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const context = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0'
        });

        const page = await context.newPage();

        // --- INTEGRATED SNIPER (Clears popups before screenshot) ---
        await page.addInitScript(() => {
            setInterval(() => {
                const okBtn = Array.from(document.querySelectorAll('*'))
                    .find(el => el.innerText?.trim() === 'OK' && el.offsetHeight > 0);
                if (okBtn) {
                    okBtn.click();
                    document.body.style.setProperty('filter', 'none', 'important');
                    document.body.style.setProperty('overflow', 'auto', 'important');
                }
            }, 300);
        });

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Give time for popups to trigger and sniper to kill them
        await page.waitForTimeout(4000);

        // Get total height
        const fullHeight = await page.evaluate(() => document.body.scrollHeight);

        if (fullHeight < 2000) {
            const buffer = await page.screenshot({ fullPage: true });
            await bot.sendPhoto(chatId, buffer, { caption: `[SUCCESS] Captured: ${targetUrl}` });
        } else {
            await bot.editMessageText('[SYSTEM] Page is long. Slicing into readable chunks...', {
                chat_id: chatId,
                message_id: statusMsg.message_id
            });

            const sliceHeight = 1000;
            const mediaGroup = [];
            
            for (let y = 0; y < fullHeight; y += sliceHeight) {
                const currentHeight = Math.min(sliceHeight, fullHeight - y);
                
                const partBuffer = await page.screenshot({
                    clip: { x: 0, y: y, width: 1280, height: currentHeight }
                });

                mediaGroup.push({
                    type: 'photo',
                    media: partBuffer,
                    caption: y === 0 ? `[SUCCESS] Full page slices for: ${targetUrl}` : ''
                });

                if (mediaGroup.length === 10) break; 
            }

            await bot.sendMediaGroup(chatId, mediaGroup);
        }

        await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});

    } catch (err) {
        await bot.editMessageText(`[ERROR] Screenshot failed: ${err.message}`, {
            chat_id: chatId,
            message_id: statusMsg.message_id
        });
    } finally {
        if (browser) await browser.close();
    }
});


// --- TOGGLE COMMAND: /spy on | /spy off ---
bot.onText(/^\/spy\s+(on|off)$/i, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    const command = match[1].toLowerCase();

    if (command === 'on') {
        if (isSpying) {
            return bot.sendMessage(chatId, '[SYSTEM] Spy Mode is already running in the background.');
        }

        isSpying = true;
        bot.sendMessage(chatId, '[ACTIVE] Spy Mode Initiated. Scraping TimeSMS every 30 minutes.');

        // Trigger the first sweep immediately
        scrapeRecentOTPNumbers();

        // Lock in the 30-minute repeating cycle
        spyIntervalTimer = setInterval(() => {
            scrapeRecentOTPNumbers();
        }, 30 * 60 * 1000); 

    } else if (command === 'off') {
        if (!isSpying) {
            return bot.sendMessage(chatId, '[SYSTEM] Spy Mode is already inactive.');
        }

        isSpying = false;
        if (spyIntervalTimer) clearInterval(spyIntervalTimer);
        spyIntervalTimer = null;
        
        bot.sendMessage(chatId, '[INACTIVE] Spy Mode Deactivated. Background engine stopped.');
    }
});


// Usage: /record
bot.onText(/\/record/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    let statusMsg = await bot.sendMessage(chatId, '[SYSTEM] Booting video recorder...');
    let browser = null;

    try {
        browser = await puppeteer.launch({
            headless: true,
            executablePath: getChromePath(),
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 412, height: 915 });

        // 1. INITIALIZE THE RECORDER
        const recorder = new PuppeteerScreenRecorder(page, {
            fps: 30,
            videoFrame: { width: 412, height: 915 },
            aspectRatio: '9:16' // Mobile format
        });

        // 2. START RECORDING
        const videoPath = path.join(__dirname, `bot_recording_${Date.now()}.mp4`);
        await recorder.start(videoPath);
        await bot.editMessageText('[SYSTEM] 🔴 Recording started...', { chat_id: chatId, message_id: statusMsg.message_id });

        // --- DO YOUR PUPPETEER STUFF HERE ---
        await page.goto('https://www.wsjobs-ng.com/', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 3000));
        
        // Let's pretend we click a button or type something so the video captures movement
        await page.evaluate(() => window.scrollBy(0, 500)); 
        await new Promise(r => setTimeout(r, 2000));
        await page.evaluate(() => window.scrollBy(0, -500));
        await new Promise(r => setTimeout(r, 2000));
        // ------------------------------------

        // 3. STOP RECORDING
        await recorder.stop();
        await bot.editMessageText('[SYSTEM] Recording saved! Uploading to Telegram...', { chat_id: chatId, message_id: statusMsg.message_id });

        // 4. SEND THE VIDEO TO TELEGRAM
        await bot.sendVideo(chatId, videoPath, { caption: '[DIAGNOSTIC] Session Video' });

        // 5. CLEAN UP HEROKU STORAGE
        fs.unlinkSync(videoPath);

    } catch (err) {
        bot.sendMessage(chatId, `[ERROR] Video capture failed: ${err.message}`);
    } finally {
        if (browser) await browser.close().catch(()=>{});
    }
});



// --- UPGRADED ISOLATED TT COMMAND ---
// Usage: /tt 127
bot.onText(/\/tt\s+(\d+)/, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    const targetSuffix = match[1]; 
    let statusMsg = await bot.sendMessage(chatId, `[ISOLATED SYSTEM] Booting sequence for suffix: ${targetSuffix}...`);
    const msgId = statusMsg.message_id;

    const updateStatus = async (text) => {
        await bot.editMessageText(text, { chat_id: chatId, message_id: msgId }).catch(() => {});
    };

    let ttBrowser = null;
    let pages = []; 
    let initialBalanceNum = 0;

    try {
        // --- 1. LAUNCH ISOLATED ENGINE ---
        await updateStatus('[ISOLATED SYSTEM] Launching clean Chrome instance...');
        ttBrowser = await puppeteer.launch({
            headless: true,
            executablePath: getChromePath(),
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });

        const page1 = await ttBrowser.newPage();
        pages.push(page1);
        await page1.setViewport({ width: 412, height: 915 }); 
        await page1.setUserAgent('Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');

        // --- 2. LOGIN & INITIAL STATE ---
        await updateStatus('[ISOLATED SYSTEM] Performing physical login...');
        await page1.goto('https://www.wsjobs-ng.com/user', { waitUntil: 'networkidle2' });
        
        const allInputs = await page1.$$('input');
        const visibleInputs = [];
        for (let input of allInputs) {
            if (await input.evaluate(el => el.offsetParent !== null)) visibleInputs.push(input);
        }

        if (visibleInputs.length >= 2) {
            await visibleInputs[0].type('09163916311', { delay: 50 }); // Main account
            await visibleInputs[1].type('Emmamama', { delay: 50 });
            await page1.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('*'));
                for (let b of btns) if (b.innerText?.trim() === 'Login') b.click();
            });
            await page1.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
        }

        // Get Initial Balance for Math
        const initialText = await page1.evaluate(() => {
            const match = document.body.innerText.match(/Account\s*Balance[\s:\n]*([\d,]+(?:\.\d+)?)/i);
            return match ? match[1] : '0';
        });
        initialBalanceNum = parseFloat(initialText.replace(/,/g, '')) || 0;

                // --- 3. TARGET ACQUISITION & CLONE SPAWNING ---
        await page1.goto('https://www.wsjobs-ng.com/task', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 4000));
        await clearOnboardingPopups(page1, null); // Global sweeper

        let targetCount = 0;

        // The Safety Net: Loop twice in case the site lags
        for (let attempt = 1; attempt <= 2; attempt++) {
            await updateStatus(`[ISOLATED SYSTEM] Scanning for ${targetSuffix} (Attempt ${attempt}/2)...`);
            
            // Wait up to 10 seconds for the 'Send' buttons to actually spawn on the page
            for (let i = 0; i < 10; i++) {
                const tasksExist = await page1.evaluate(() => {
                    return Array.from(document.querySelectorAll('*')).some(el => el.innerText && el.innerText.trim() === 'Send' && el.offsetParent !== null);
                });
                if (tasksExist) break;
                await new Promise(r => setTimeout(r, 1000));
            }

            targetCount = await page1.evaluate((suffixStr) => {
                const btns = Array.from(document.querySelectorAll('*')).filter(el => el.innerText?.trim() === 'Send' && el.offsetParent !== null);
                let count = 0;
                for (let b of btns) {
                    let txt = b.parentElement?.parentElement?.innerText || '';
                    if (txt.includes(suffixStr)) count++;
                }
                return count > 4 ? 4 : count;
            }, targetSuffix);

            if (targetCount > 0) {
                break; // Found them, break out of the retry loop!
            } else if (attempt === 1) {
                await updateStatus(`[ISOLATED SYSTEM] 0 targets found! Wsjobs is lagging. Hard-refreshing...`);
                await page1.reload({ waitUntil: 'networkidle2' });
                await new Promise(r => setTimeout(r, 5000)); 
                await clearOnboardingPopups(page1, null); 
            }
        }

        if (targetCount === 0) throw new Error(`0 targets found for ${targetSuffix}. Either the site is dead slow, or the numbers aren't there!`);

        await updateStatus(`[ISOLATED SYSTEM] Found ${targetCount} targets. Spawning ${targetCount - 1} synchronized tabs...`);
        
        for (let i = 1; i < targetCount; i++) {
            const p = await ttBrowser.newPage();
            pages.push(p);
            await p.setViewport({ width: 412, height: 915 });
            await p.goto('https://www.wsjobs-ng.com/task', { waitUntil: 'networkidle2' });
        }
        
        if (pages.length > 1) {
            await new Promise(r => setTimeout(r, 3000));
            await Promise.all(pages.slice(1).map(p => clearOnboardingPopups(p, null)));
        }


        // --- 4. THE STRIKE (GHOST CLICKS) ---
        await updateStatus(`[ISOLATED SYSTEM] Executing synchronized strikes...`);
        const clickResults = await Promise.all(pages.map((p, idx) => {
            return p.evaluate((suffixStr, tabIndex) => {
                const btns = Array.from(document.querySelectorAll('*')).filter(el => el.innerText?.trim() === 'Send' && el.offsetParent !== null);
                let matchCount = 0;
                for (let b of btns) {
                    let txt = b.parentElement?.parentElement?.innerText || '';
                    if (txt.includes(suffixStr)) {
                        if (matchCount === tabIndex) {
                            b.click();
                            return true;
                        }
                        matchCount++;
                    }
                }
                return false;
            }, targetSuffix, idx);
        }));

        await new Promise(r => setTimeout(r, 10000)); // Sync wait

        // Synchronized Confirm
        await Promise.all(pages.map(p => p.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('*'));
            for (let el of elements) {
                if (el.innerText?.trim() === 'Confirm' && el.offsetParent !== null) el.click();
            }
        })));

        await updateStatus(`[ISOLATED SYSTEM] Clicks fired. Cooling down...`);
        await new Promise(r => setTimeout(r, 15000));

        // --- 5. FINAL RESULTS & CLEANUP ---
        const finalTaskSnap = await pages[0].screenshot({ type: 'png' });
        let currentBalanceText = "Unknown";
        let earnedDisplay = "Unknown";

        try {
            await pages[0].goto('https://www.wsjobs-ng.com/user', { waitUntil: 'networkidle2' });
            currentBalanceText = await pages[0].evaluate(() => {
                const match = document.body.innerText.match(/Account\s*Balance[\s:\n]*([\d,]+(?:\.\d+)?)/i);
                return match ? match[1] : 'Unknown';
            });
            let finalNum = parseFloat(currentBalanceText.replace(/,/g, ''));
            earnedDisplay = `+${(finalNum - initialBalanceNum).toFixed(2)}`;
        } catch (e) {}

        await bot.deleteMessage(chatId, msgId).catch(() => {});
        await bot.sendPhoto(chatId, finalTaskSnap, { 
            caption: `Profit: <code>${earnedDisplay}</code>\nBalance: <code>${currentBalanceText}</code>`,
            parse_mode: 'HTML'
        });

    } catch (err) {
        await updateStatus(`[ERROR] TT Sequence failed: ${err.message}`);
    } finally {
        if (ttBrowser) await ttBrowser.close().catch(() => {});
    }
});


// Usage: /dl https://www.tiktok.com/@user/video/123456789
bot.onText(/\/dl\s+(.+)/, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    const url = match[1].trim();
    let statusMsg = await bot.sendMessage(chatId, '[SYSTEM] Analyzing link and bypassing security...');

    try {
        // --- TIKTOK SPECIFIC LOGIC (VIDEOS & IMAGES) ---
        if (url.includes('tiktok.com')) {
            await bot.editMessageText('[SYSTEM] TikTok link detected. Fetching unwatermarked HD source...', { chat_id: chatId, message_id: statusMsg.message_id });
            
            // Hit the TikWM API (Gets raw unwatermarked HD files directly from TikTok servers)
            const response = await axios.get(`https://www.tikwm.com/api/?url=${url}&hd=1`);
            const data = response.data.data;

            if (!data) throw new Error("Could not extract TikTok data. Link might be private or invalid.");

            // 1. IS IT AN IMAGE SLIDESHOW?
            if (data.images && data.images.length > 0) {
                await bot.editMessageText(`[SYSTEM] TikTok Image Carousel detected (${data.images.length} images). Sending raw HD photos...`, { chat_id: chatId, message_id: statusMsg.message_id });
                
                // Telegram requires media groups for multiple images
                let mediaGroup = [];
                for (let i = 0; i < data.images.length; i++) {
                    mediaGroup.push({
                        type: 'photo',
                        media: data.images[i], // We can pass the raw URL directly to Telegram!
                        caption: i === 0 ? `[SUCCESS] HD TikTok Images Extracted` : '' 
                    });
                    
                    // Telegram allows max 10 media items per group. Send in chunks if necessary.
                    if (mediaGroup.length === 10 || i === data.images.length - 1) {
                        await bot.sendMediaGroup(chatId, mediaGroup);
                        mediaGroup = []; // Reset for next batch
                    }
                }
                
                await bot.deleteMessage(chatId, statusMsg.message_id).catch(()=>{});
                return; // Stop execution here for images
            }

            // 2. IT IS A VIDEO
            const videoUrl = data.hdplay || data.play; // Try HD first, fallback to standard if HD isn't available
            
            await bot.editMessageText('[SYSTEM] Found raw TikTok video file. Streaming to Telegram...', { chat_id: chatId, message_id: statusMsg.message_id });
            
            await bot.sendVideo(chatId, videoUrl, {
                caption: `[SUCCESS] Max Native Quality (No Watermark)`
            });
            
            await bot.deleteMessage(chatId, statusMsg.message_id).catch(()=>{});
            return;
        }

        // --- FALLBACK FOR IG / YOUTUBE / TWITTER (yt-dlp) ---
        await bot.editMessageText('[SYSTEM] Standard link detected. Engaging yt-dlp to find maximum native quality...', { chat_id: chatId, message_id: statusMsg.message_id });
        
        const videoPath = path.join(__dirname, `dl_${Date.now()}.mp4`);

        // Grab the absolute best video and audio track the server actually holds
        await youtubedl(url, {
            output: videoPath,
            format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            mergeOutputFormat: 'mp4',
            noWarnings: true
        });

        // Safety check for Telegram's hard limit
        const stats = fs.statSync(videoPath);
        const fileSizeMB = stats.size / (1024 * 1024);

        if (fileSizeMB > 49.5) {
            await bot.editMessageText(`[ERROR] File is too large (${fileSizeMB.toFixed(1)}MB). Telegram bots can only send up to 50MB.`, { chat_id: chatId, message_id: statusMsg.message_id });
        } else {
            await bot.editMessageText('[SYSTEM] Extraction complete. Uploading...', { chat_id: chatId, message_id: statusMsg.message_id });
            await bot.sendVideo(chatId, videoPath, { 
                caption: `[SUCCESS] Max Native Quality Downloaded\nSize: ${fileSizeMB.toFixed(2)}MB` 
            });
            await bot.deleteMessage(chatId, statusMsg.message_id).catch(()=>{});
        }

        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);

    } catch (err) {
        bot.editMessageText(`[ERROR] Download failed: ${err.message}`, { chat_id: chatId, message_id: statusMsg.message_id });
    }
});



// Initiation Command
bot.onText(/^\/wt$/i, async (msg) => {
    const chatId = msg.chat.id.toString(); // Ensure this is a string
    
    // Check if the string exists in the AUTHORIZED array
    if (!AUTHORIZED.includes(chatId)) {
        console.log(`[AUTH] Unauthorized access attempt by ID: ${chatId}`);
        return;
    }

    // Initialize the burner state
    wtSessions[chatId] = { step: 'USERNAME', browser: null, timer: null, username: '', password: '', target: '' };
    bot.sendMessage(chatId, '[WT BURNER] Sequence Initiated.\n\nPlease send the **Username (Phone Number)** for the account:', { parse_mode: 'Markdown' });
});



// Manual Kill Command
bot.onText(/^(?:\/wtclose|close)$/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (!AUTHORIZED.includes(chatId)) return;

    if (wtSessions[chatId] && wtSessions[chatId].browser) {
        bot.sendMessage(chatId, '[WT BURNER] Manually terminating burner browser...');
        await wtSessions[chatId].browser.close().catch(() => {});
        clearTimeout(wtSessions[chatId].timer);
        wtSessions[chatId] = null;
        bot.sendMessage(chatId, '[SUCCESS] Burner session destroyed and RAM freed.');
    } else {
        bot.sendMessage(chatId, '[SYSTEM] No active WT burner session to close.');
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

    // --- 1. Wsjobs Balance Fetch (Firefox Engine - UPDATED) ---
    let wBrowser = null;
    let wContext = null;
    let wPage = null; // Defined outside for safety

    try {
        if (globalTaskBrowser && globalTaskBrowser.isConnected()) {
            wBrowser = globalTaskBrowser;
        } else {
            process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
            wBrowser = await firefox.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            globalTaskBrowser = wBrowser;
        }

        wContext = await wBrowser.newContext({
            userAgent: 'Mozilla/5.0 (Android 13; Mobile; rv:110.0) Gecko/110.0 Firefox/110.0',
            viewport: { width: 412, height: 915 }
        });

        wPage = await wContext.newPage();

        // THE HUMAN SNIPER (Same as the working withdraw version)
        await wPage.addInitScript(() => {
            setInterval(() => {
                const okBtn = Array.from(document.querySelectorAll('*'))
                    .find(el => el.innerText?.trim() === 'OK' && el.offsetHeight > 0);
                if (okBtn) {
                    const rect = okBtn.getBoundingClientRect();
                    ['mousedown', 'mouseup', 'click'].forEach(type => {
                        okBtn.dispatchEvent(new MouseEvent(type, {
                            view: window, bubbles: true, cancelable: true, 
                            clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
                        }));
                    });
                    setTimeout(() => {
                        const modal = okBtn.closest('div[class*="modal"], div[class*="mask"]');
                        if (modal) modal.remove();
                        document.body.style.filter = 'none';
                        document.body.style.overflow = 'auto';
                    }, 800);
                }
            }, 300);
        });

        await wPage.goto('https://www.wsjobs-ng.com/account', { waitUntil: 'domcontentloaded' });
        await wPage.waitForTimeout(4000);

        // LOGIN LOGIC
        const loginInput = await wPage.$('input[type="text"], input[type="tel"]');
        if (loginInput) {
            await wPage.fill('input[type="text"], input[type="tel"]', '09163916500');
            await wPage.fill('input[type="password"]', 'Emmamama');
            const loginBtn = wPage.locator('text=/LOGIN|SIGN IN|SHIGA|ENTRAR/i').last();
            await loginBtn.dispatchEvent('click');
            
            await wPage.waitForURL('**/account', { timeout: 10000 }).catch(() => {});
        }

        // TELEPORT (This fixed your withdraw, so it stays here too)
        await wPage.goto('https://www.wsjobs-ng.com/account', { waitUntil: 'domcontentloaded' });
        await wPage.waitForTimeout(5000);

        // --- PRECISION BALANCE SCRAPER (The fix for "639" issues) ---
        wsjobsBal = await wPage.evaluate(() => {
            const allText = document.body.innerText;
            
            // Priority 1: Hunt for decimals (Money)
            const decimalMatches = allText.match(/\d+\.\d{2}/g);
            if (decimalMatches) {
                const nums = decimalMatches.map(n => parseFloat(n));
                const max = Math.max(...nums);
                return max.toLocaleString(undefined, { minimumFractionDigits: 2 });
            }

            // Priority 2: Hunt for realistic integers
            const generalMatches = allText.match(/\d{1,3}(,\d{3})*(\.\d+)?/g);
            if (generalMatches) {
                const numbers = generalMatches
                    .map(n => n.replace(/,/g, ''))
                    .map(n => parseFloat(n))
                    .filter(n => n > 100 && n < 100000); 
                
                if (numbers.length > 0) {
                    return Math.max(...numbers).toLocaleString(undefined, { minimumFractionDigits: 2 });
                }
            }
            return '0.00';
        });

        await wContext.close().catch(() => {});
    } catch(e) {
        console.log(`[BALANCE ERROR]: ${e.message}`);
        wsjobsBal = 'Error';
        if (wContext) await wContext.close().catch(() => {});
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


const updateStatus = async (text) => {
    await bot.editMessageText(text, { 
        chat_id: chatId, 
        message_id: statusMsg.message_id 
    }).catch(() => {});
};





bot.onText(/\/withdraw\s+task/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    let statusMsg = await bot.sendMessage(chatId, `[SYSTEM] Booting Firefox for Secure Withdrawal...`);
    const videoDir = path.join(__dirname, 'videos');
    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir);

    let browser = null;
    let context = null;
    let page = null; 
    
    try {
        process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

        browser = await firefox.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Android 13; Mobile; rv:110.0) Gecko/110.0 Firefox/110.0',
            viewport: { width: 412, height: 915 },
            recordVideo: { dir: videoDir, size: { width: 412, height: 915 } }
        });

        page = await context.newPage();

        // --- THE HUMAN SNIPER (MODAL KILLER) ---
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            setInterval(() => {
                const okBtn = Array.from(document.querySelectorAll('*'))
                    .find(el => el.innerText?.trim() === 'OK' && el.offsetHeight > 0);
                if (okBtn) {
                    const rect = okBtn.getBoundingClientRect();
                    ['mousedown', 'mouseup', 'click'].forEach(type => {
                        okBtn.dispatchEvent(new MouseEvent(type, {
                            view: window, bubbles: true, cancelable: true, 
                            clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
                        }));
                    });
                    setTimeout(() => {
                        const modal = okBtn.closest('div[class*="modal"], div[class*="mask"], div[class*="popup"]');
                        if (modal) modal.remove();
                        document.body.style.filter = 'none';
                        document.body.style.overflow = 'auto';
                    }, 800);
                }
            }, 300);
        });

        

        // Step 1: Account Login & Teleport
        await bot.editMessageText('[SYSTEM] Navigating to Account...', { chat_id: chatId, message_id: statusMsg.message_id });
        await page.goto('https://www.wsjobs-ng.com/account', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(4000);

        const loginInput = await page.$('input[type="text"], input[type="tel"]');
        if (loginInput) {
            await page.fill('input[type="text"], input[type="tel"]', '09163916500');
            await page.fill('input[type="password"]', 'Emmamama');
            const loginBtn = page.locator('text=/LOGIN|SIGN IN|SHIGA|ENTRAR/i').last();
            await loginBtn.dispatchEvent('click');
            await page.waitForURL('**/account', { timeout: 10000 }).catch(() => {});
        }

        await page.goto('https://www.wsjobs-ng.com/account', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000); 

        // --- STEP 2: PRECISION BALANCE SCRAPER ---
        const rawBalance = await page.evaluate(() => {
            const allText = document.body.innerText;
            const decimalMatches = allText.match(/\d+\.\d{2}/g);
            if (decimalMatches) {
                const nums = decimalMatches.map(n => parseFloat(n));
                return Math.max(...nums);
            }
            const generalMatches = allText.match(/\d{1,3}(,\d{3})*(\.\d+)?/g);
            if (generalMatches) {
                const numbers = generalMatches
                    .map(n => n.replace(/,/g, ''))
                    .map(n => parseFloat(n))
                    .filter(n => n > 100 && n < 100000); 
                return numbers.length > 0 ? Math.max(...numbers) : 0;
            }
            return 0;
        });

        const tiers = [50000, 26000, 23000, 20000, 18000, 15000];
        const targetAmount = tiers.find(t => rawBalance >= t);

        if (!targetAmount) {
            const errSnap = await page.screenshot();
            await bot.sendPhoto(chatId, errSnap, { 
                caption: `[DIAGNOSTIC] Detected Balance: ${rawBalance}. Too low for withdrawal.` 
            }, { filename: 'low_balance.png' });
            throw new Error(`Balance ${rawBalance} is too low.`);
        }

        await bot.editMessageText(`[SYSTEM] Target Acquired: ${targetAmount}. Proceeding to Saque...`, { 
            chat_id: chatId, 
            message_id: statusMsg.message_id 
        }).catch(() => {});

                // Step 3: Withdraw Navigation & Execution
        await page.goto('https://www.wsjobs-ng.com/account/withdraw', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(4000);

        // 1. Click the Amount Chip
        await page.evaluate((amt) => {
            const chips = Array.from(document.querySelectorAll('div, span, p, button, [class*="item"]'));
            const targetChip = chips.find(c => c.innerText?.trim() === amt.toString() && c.offsetHeight > 0);
            if (targetChip) {
                targetChip.click();
                // Force a "selected" state trigger
                targetChip.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }, targetAmount);

        // 2. IMPORTANT: Wait for the selection animation to finish and button to stabilize
        await page.waitForTimeout(3000);

                // --- 3. NUCLEAR BUTTON STRIKE (FIREFOX COMPATIBLE) ---
        await page.evaluate(() => {
            const mainBtn = Array.from(document.querySelectorAll('*')).find(b => 
                (b.innerText?.includes('WITHDRAW NOW') || b.innerText?.includes('SACAR AGORA')) && 
                b.offsetHeight > 0 && 
                window.getComputedStyle(b).display !== 'none'
            );

            if (mainBtn) {
                const rect = mainBtn.getBoundingClientRect();
                const x = rect.left + rect.width / 2;
                const y = rect.top + rect.height / 2;

                // Fire coordinate-based MouseEvents (Works on Firefox/Mobile)
                const createEvent = (type) => new MouseEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: x,
                    clientY: y,
                    buttons: 1
                });

                // Human sequence: Press down, release, then click
                mainBtn.dispatchEvent(createEvent('mousedown'));
                mainBtn.dispatchEvent(createEvent('mouseup'));
                mainBtn.dispatchEvent(createEvent('click'));
                
                return "STRIKE_EXECUTED";
            } else {
                throw new Error("Withdraw button not found in DOM");
            }
        });

        // Physical Mouse Backup (Safe for Firefox)
        await page.mouse.click(206, 320).catch(() => {}); 

        await page.waitForTimeout(3000);

    
                   // --- STEP 4: PASSWORD & FINAL CONFIRM ---
        const passInput = page.locator('input[type="password"], .modal-body input, [placeholder*="password"], [placeholder*="senha"]').last();
        
        // 1. Wait for modal visibility
        await passInput.waitFor({ state: 'visible', timeout: 15000 });
        
        // 2. High-Precision Input & Force Blur
        await passInput.click();
        await page.evaluate(el => el.value = '', await passInput.elementHandle()); 
        await passInput.type('111111', { delay: 100 }); 
        await page.keyboard.press('Tab'); // CRITICAL: Forces the framework to lock in the PIN
        await page.waitForTimeout(1500);

        // --- 3. FINAL NUCLEAR STRIKE (TABBATAR CIREWA) ---
        
        // Phase A: Native Playwright Tap (Mobile emulation)
        try {
            const confirmBtn = page.locator('text=/Tabbatar Cirewa|Confirm|Confirmar/i').last();
            await confirmBtn.tap({ force: true, delay: 150, timeout: 3000 });
        } catch (e) {}

        // Phase B: JS Mobile Touch Strike
        await page.evaluate(() => {
            // Annihilate transparent modal traps
            const modalBlockers = document.querySelectorAll('.van-overlay, .modal-mask, [class*="mask"]');
            modalBlockers.forEach(el => el.remove());

            // Reverse search to grab the deepest element
            const elements = Array.from(document.querySelectorAll('button, div, span'));
            const finalBtn = elements.reverse().find(b => 
                (b.innerText?.includes('Tabbatar Cirewa') || b.innerText?.includes('Confirm')) && 
                b.offsetHeight > 0
            );

            if (finalBtn) {
                // Ascend to parent if it's just a span inside the button
                let target = finalBtn;
                if (target.tagName.toLowerCase() === 'SPAN' && target.parentElement) {
                    target = target.parentElement;
                }

                const rect = target.getBoundingClientRect();
                const x = rect.left + rect.width / 2;
                const y = rect.top + rect.height / 2;

                const evData = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
                ['mousedown', 'mouseup', 'click'].forEach(t => target.dispatchEvent(new MouseEvent(t, evData)));

                // Mobile Touch (Bypasses UI locks)
                try {
                    const touchObj = new Touch({ identifier: Date.now(), target: target, clientX: x, clientY: y, radiusX: 2.5, radiusY: 2.5, rotationAngle: 10, force: 0.5 });
                    target.dispatchEvent(new TouchEvent('touchstart', { cancelable: true, bubbles: true, touches: [touchObj], targetTouches: [touchObj], changedTouches: [touchObj] }));
                    target.dispatchEvent(new TouchEvent('touchend', { cancelable: true, bubbles: true, touches: [], targetTouches: [], changedTouches: [touchObj] }));
                } catch(e) {}
                
                target.click();
            }
        });

        // Phase C: Physical Backup Tap (Targeting right-side coordinates of the modal)
        await page.mouse.click(300, 720).catch(() => {}); 
        await page.mouse.click(300, 700).catch(() => {}); 

        await page.waitForTimeout(5000);



        // --- 4. SUCCESS REFRESH, CAPTURE & DELIVERY ---
        
        // 1. Teleport back to the account page to refresh the balance
        await bot.editMessageText(`[SYSTEM] Withdrawal submitted. Refreshing account page...`, { 
            chat_id: chatId, 
            message_id: statusMsg.message_id 
        }).catch(() => {});

        await page.goto('https://www.wsjobs-ng.com/account', { waitUntil: 'domcontentloaded' });
        
        // 2. Wait 5 seconds for the UI and the new balance to fully load
        await page.waitForTimeout(5000); 

        // 3. Take the fresh screenshot
        const finalSnap = await page.screenshot({ type: 'png' });
        
        // 4. Send the photo and clean up the status message
        await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});

        await bot.sendPhoto(chatId, finalSnap, 
            { caption: `[SUCCESS] Withdrawal for ${targetAmount} submitted.` },
            { filename: 'withdraw_final.png' } // MANDATORY to prevent EFATAL
        );

        // 5. Video Cleanup
        const video = page.video();
        await context.close();
        if (video) {
            const vPath = await video.path().catch(() => null);
            if (vPath && fs.existsSync(vPath)) fs.unlinkSync(vPath);
        }


    } catch (err) {
        console.log(`[WITHDRAW ERROR]: ${err.message}`);
        await bot.sendMessage(chatId, `[WITHDRAW ERROR]: ${err.message}`).catch(() => {}); 
        
        if (context) {
            const video = page?.video();
            await context.close().catch(() => {});
            if (video) {
                const vPath = await video.path().catch(() => null);
                if (vPath && fs.existsSync(vPath)) {
                    await bot.sendVideo(chatId, vPath, { 
                        caption: `Diagnostic: Withdrawal Failure\nError: ${err.message}` 
                    }).catch(() => {});
                    if (fs.existsSync(vPath)) fs.unlinkSync(vPath);
                }
            }
        }
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
});

        
        

bot.onText(/\/upscale/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    if (!msg.reply_to_message || !msg.reply_to_message.photo) {
        return bot.sendMessage(chatId, '[ERROR] Reply to an image with /upscale');
    }

    let statusMsg = await bot.sendMessage(chatId, '[SYSTEM] 32GB RAM Engine: Initializing 4K Upscale...');

    try {
        const photo = msg.reply_to_message.photo[msg.reply_to_message.photo.length - 1];
        const fileLink = await bot.getFileLink(photo.file_id);

        // Fetch image into buffer
        const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
        const inputBuffer = Buffer.from(response.data, 'binary');

        await bot.editMessageText('[SYSTEM] Processing Lanczos3 Super-Sampling (4K)...', {
            chat_id: chatId,
            message_id: statusMsg.message_id
        });

        // Use Sharp to upscale to 4K (3840px width)
        const outputBuffer = await sharp(inputBuffer)
            .resize({ 
                width: 3840, 
                kernel: sharp.kernel.lanczos3 // Highest quality downscaling/upscaling algorithm
            })
            .sharpen() // Add HD crispness
            .toFormat('png')
            .toBuffer();

        await bot.sendDocument(chatId, outputBuffer, {
            filename: 'upscaled_4k.png',
            caption: '*Upscale Complete (Local 32GB Engine)*\nResolution: 3840px (4K HD)'
        });

        await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});

    } catch (err) {
        bot.sendMessage(chatId, `[ERROR] Local upscale failed: ${err.message}`);
    }
});


bot.onText(/\/task\s+(\d+)/, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    const targetSuffix = match[1]; 
    let statusMsg = await bot.sendMessage(chatId, `[SYSTEM] Strike Protocol: ${targetSuffix} ⚡`);
    const msgId = statusMsg.message_id;

    const updateStatus = async (text) => {
        await bot.editMessageText(text, { chat_id: chatId, message_id: msgId }).catch(() => {});
    };

    let browser = globalTaskBrowser;
    let context = null;
    let masterPage = null; 
    let pages = [];
    let initialBalanceNum = 0;

    try {
        // --- 1. SMART ENGINE RECOVERY ---
        if (!browser || !browser.isConnected()) {
            process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
            browser = await firefox.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
            globalTaskBrowser = browser;
        }

        // Reuse context if possible, or create fresh
        context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Android 13; Mobile; rv:110.0) Gecko/110.0 Firefox/110.0',
            viewport: { width: 412, height: 915 }
        });

        masterPage = await context.newPage();
        pages.push(masterPage);

        // --- THE HUMAN SNIPER ---
        await masterPage.addInitScript(() => {
            setInterval(() => {
                const okBtn = Array.from(document.querySelectorAll('*')).find(el => el.innerText?.trim() === 'OK' && el.offsetHeight > 0);
                if (okBtn) {
                    const rect = okBtn.getBoundingClientRect();
                    ['mousedown', 'mouseup', 'click'].forEach(t => okBtn.dispatchEvent(new MouseEvent(t, { view: window, bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 })));
                    setTimeout(() => {
                        const modal = okBtn.closest('div[class*="modal"], div[class*="mask"]');
                        if (modal) modal.remove();
                        document.body.style.filter = 'none';
                        document.body.style.overflow = 'auto';
                    }, 800);
                }
            }, 300);
        });

        // --- 2. FAST REFRESH LOGIC ---
        await updateStatus('[SYSTEM] Synchronizing Account State...');
        await masterPage.goto('https://www.wsjobs-ng.com/account', { waitUntil: 'domcontentloaded' });
        await masterPage.waitForTimeout(3000);

        // Check if login is needed
        if (await masterPage.$('input[type="password"]')) {
            await masterPage.fill('input[type="text"]', '09163916500');
            await masterPage.fill('input[type="password"]', 'Emmamama');
            await masterPage.locator('text=/LOGIN|SIGN IN|SHIGA|ENTRAR/i').last().click();
            await masterPage.waitForURL('**/account', { timeout: 10000 }).catch(() => {});
            await masterPage.goto('https://www.wsjobs-ng.com/account');
        }


                // --- 3. PRECISION BALANCE SCRAPER (INITIAL) ---
        await updateStatus('[SYSTEM] Scanning Initial Balance...');
        initialBalanceNum = await masterPage.evaluate(() => {
            const allText = document.body.innerText;
            const decimalMatches = allText.match(/\d+\.\d{2}/g);
            if (decimalMatches) {
                const nums = decimalMatches.map(n => parseFloat(n));
                return Math.max(...nums);
            }
            const generalMatches = allText.match(/\d{1,3}(,\d{3})*(\.\d+)?/g);
            if (generalMatches) {
                const numbers = generalMatches
                    .map(n => n.replace(/,/g, ''))
                    .map(n => parseFloat(n))
                    .filter(n => n > 100 && n < 100000); 
                return numbers.length > 0 ? Math.max(...numbers) : 0;
            }
            return 0;
        });

        await updateStatus(`[SYSTEM] Teleporting to Task Page...`);
        await masterPage.goto('https://www.wsjobs-ng.com/task/whatsapp', { waitUntil: 'domcontentloaded' });
        await masterPage.waitForTimeout(4000);

        // --- 4. TARGET SCAN & TAB SPAWNING ---
        const targetCount = await masterPage.evaluate((suffix) => {
            const btns = Array.from(document.querySelectorAll('*')).filter(el => el.innerText?.trim() === 'SEND');
            let found = 0;
            for (let btn of btns) {
                if (btn.closest('div')?.innerText.includes(suffix)) found++;
            }
            return found > 4 ? 4 : found;
        }, targetSuffix);

        if (targetCount === 0) throw new Error(`Target ${targetSuffix} not found on page.`);

        const totalTabs = targetCount * 2;
        await updateStatus(`[SYSTEM] Found ${targetCount} targets. Launching ${totalTabs} Strike Tabs...`);
        
        for (let i = 1; i < totalTabs; i++) {
            const p = await context.newPage();
            pages.push(p);
            await p.goto('https://www.wsjobs-ng.com/task/whatsapp', { waitUntil: 'domcontentloaded' });
        }

        // --- 5. SYNCHRONIZED STRIKE ---
        await updateStatus('[SYSTEM] EXECUTE SIMULTANEOUS SEND...');
        await Promise.all(pages.map(async (p, idx) => {
            const targetIdx = Math.floor(idx / 2);
            await p.evaluate(({ suffix, index }) => {
                const btns = Array.from(document.querySelectorAll('*')).filter(el => 
                    el.innerText?.trim().toUpperCase() === 'SEND' && el.offsetHeight > 0
                );
                let matches = 0;
                for (let btn of btns) {
                    if (btn.closest('div')?.innerText.includes(suffix)) {
                        if (matches === index) { btn.click(); return; }
                        matches++;
                    }
                }
            }, { suffix: targetSuffix, index: targetIdx });
        }));

        await masterPage.waitForTimeout(3500);

        // --- 6. COORDINATED "MODAL-AWARE" CONFIRM ---
        await updateStatus('[SYSTEM] COORDINATED CONFIRM');
        await Promise.all(pages.map(p => p.evaluate(() => {
            const modal = Array.from(document.querySelectorAll('div')).find(el => 
                (el.innerText?.includes('confirm') || el.innerText?.includes('confirmar')) && 
                el.offsetHeight > 100 && el.offsetHeight < 400
            );

            if (modal) {
                const rect = modal.getBoundingClientRect();
                const x = rect.left + (rect.width * 0.75); 
                const y = rect.top + (rect.height - 30);   

                const evData = { view: window, bubbles: true, clientX: x, clientY: y };
                const clickTarget = document.elementFromPoint(x, y) || modal;
                
                ['mousedown', 'mouseup', 'click'].forEach(t => 
                    clickTarget.dispatchEvent(new MouseEvent(t, evData))
                );
            } else {
                const btn = Array.from(document.querySelectorAll('*')).find(el => 
                    /confirm|confirmar/i.test(el.innerText) && el.offsetHeight > 0
                );
                if (btn) btn.click();
            }
        })));

        await masterPage.waitForTimeout(20000);

        // FIX: Changed 'page' to 'masterPage' to resolve undefined crash
        const finalTaskSnap = await masterPage.screenshot({ type: 'png' });

        // --- 7. PRECISION BALANCE SCRAPER (FINAL) ---
        await updateStatus('[SYSTEM] Fetching Final Balance...');
        await masterPage.goto('https://www.wsjobs-ng.com/account', { waitUntil: 'domcontentloaded' });
        
        // Wait 5 seconds to let the server update the visual balance
        await masterPage.waitForTimeout(5000);

        const finalBalanceNum = await masterPage.evaluate(() => {
            const allText = document.body.innerText;
            const decimalMatches = allText.match(/\d+\.\d{2}/g);
            if (decimalMatches) {
                const nums = decimalMatches.map(n => parseFloat(n));
                return Math.max(...nums);
            }
            const generalMatches = allText.match(/\d{1,3}(,\d{3})*(\.\d+)?/g);
            if (generalMatches) {
                const numbers = generalMatches
                    .map(n => n.replace(/,/g, ''))
                    .map(n => parseFloat(n))
                    .filter(n => n > 100 && n < 100000); 
                return numbers.length > 0 ? Math.max(...numbers) : 0;
            }
            return 0;
        });

        // --- MATH EXECUTION ---
        const diff = finalBalanceNum - initialBalanceNum;
        const profitText = diff > 0 ? diff.toFixed(2) : "0.00";
        
        await bot.deleteMessage(chatId, msgId).catch(() => {});
        
        await bot.sendPhoto(chatId, finalTaskSnap, { 
            caption: `Profit: <code>+${profitText}</code>\nBalance: <code>${finalBalanceNum.toLocaleString(undefined, {minimumFractionDigits: 2})}</code>`,
            parse_mode: 'HTML'
        }, { filename: 'task_result.png' });

    } catch (err) {
        await bot.sendMessage(chatId, `[STRIKE FAILED]: ${err.message}`);
    } finally {
        if (context) {
            await context.close().catch(() => {});
        }
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
    if (!AUTHORIZED.includes(chatId)) return;
    if (!msg.text || msg.text.startsWith('/')) return;


        

    // --- 2. WT BURNER CONVERSATION FLOW (MOVED TO SAFETY!) ---
    if (wtSessions[chatId] && wtSessions[chatId].step) {
        const session = wtSessions[chatId];

        if (session.step === 'USERNAME') {
            session.username = msg.text.trim();
            session.step = 'PASSWORD';
            bot.sendMessage(chatId, `[WT BURNER] Username locked: ${session.username}\n\nNow send the **Password**:`, { parse_mode: 'Markdown' });
            return;
        }

        if (session.step === 'PASSWORD') {
            session.password = msg.text.trim();
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            
            session.step = 'TARGET_OR_AWAITING';
            bot.sendMessage(chatId, `[WT BURNER] Password accepted.\n\nSend the **Target Number (Suffix)** you want to strike. You can keep sending new numbers for the next 15 minutes!`, { parse_mode: 'Markdown' });
            return;
        }

        if (session.step === 'TARGET_OR_AWAITING') {
            session.target = msg.text.trim().replace(/[^0-9]/g, '');
            session.step = 'EXECUTING'; // Lock it so you can't double-fire accidentally
            
            // Clear the 15-minute timer if this is a follow-up strike
            if (session.timer) clearTimeout(session.timer);
            
            let statusMsg = await bot.sendMessage(chatId, `[WT BURNER] Locking onto target: ${session.target}...`);
            const updateStatus = async (text) => bot.editMessageText(text, { chat_id: chatId, message_id: statusMsg.message_id }).catch(() => {});
            
            let pages = [];
            let initialBalanceNum = 0;

            try {
                // 1. Boot Browser OR Re-use existing one
                if (!session.browser) {
                    await updateStatus('[WT BURNER] Launching clean Chrome instance...');
                    session.browser = await puppeteer.launch({
                        headless: true,
                        executablePath: getChromePath(),
                        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
                    });

                    const page1 = await session.browser.newPage();
                    pages.push(page1);
                    session.masterPage = page1; // Save the master tab to the session
                    await page1.setViewport({ width: 412, height: 915 }); 
                    await page1.setUserAgent('Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');

                    // Dynamic Login
                    await updateStatus('[WT BURNER] Injecting credentials...');
                    await page1.goto('https://simpletasks234.com/user', { waitUntil: 'networkidle2' });
                    
                    const allInputs = await page1.$$('input');
                    const visibleInputs = [];
                    for (let input of allInputs) {
                        if (await input.evaluate(el => el.offsetParent !== null)) visibleInputs.push(input);
                    }

                    if (visibleInputs.length >= 2) {
                        await visibleInputs[0].type(session.username, { delay: 50 });
                        await visibleInputs[1].type(session.password, { delay: 50 });
                        await page1.evaluate(() => {
                            const btns = Array.from(document.querySelectorAll('*'));
                            for (let b of btns) if (b.innerText?.trim() === 'Login') b.click();
                        });
                        await page1.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
                    }
                } else {
                    await updateStatus('[WT BURNER] Using already logged-in session...');
                    pages.push(session.masterPage); // Grab the master page from memory
                }

                const masterTab = pages[0];

                // Initial Balance
                await masterTab.goto('https://simpletasks234.com/user', { waitUntil: 'networkidle2' });
                await new Promise(r => setTimeout(r, 3000));
                const initialText = await masterTab.evaluate(() => {
                    const match = document.body.innerText.match(/Account\s*Balance[\s:\n]*([\d,]+(?:\.\d+)?)/i);
                    return match ? match[1] : '0';
                });
                initialBalanceNum = parseFloat(initialText.replace(/,/g, '')) || 0;

                // 2. Sweep & Target Acquisition
                await updateStatus('[WT BURNER] Clearing popups and scanning targets...');
                await masterTab.goto('https://simpletasks234.com/task', { waitUntil: 'networkidle2' });
                await new Promise(r => setTimeout(r, 4000));
                await clearOnboardingPopups(masterTab, null);

                let targetCount = 0;
                for (let attempt = 1; attempt <= 2; attempt++) {
                    for (let i = 0; i < 10; i++) {
                        const tasksExist = await masterTab.evaluate(() => Array.from(document.querySelectorAll('*')).some(el => el.innerText?.trim() === 'Send' && el.offsetParent !== null));
                        if (tasksExist) break;
                        await new Promise(r => setTimeout(r, 1000));
                    }

                    targetCount = await masterTab.evaluate((suffixStr) => {
                        const btns = Array.from(document.querySelectorAll('*')).filter(el => el.innerText?.trim() === 'Send' && el.offsetParent !== null);
                        let count = 0;
                        for (let b of btns) {
                            let txt = b.parentElement?.parentElement?.innerText || '';
                            if (txt.includes(suffixStr)) count++;
                        }
                        return count > 4 ? 4 : count;
                    }, session.target);

                    if (targetCount > 0) break;
                    if (attempt === 1) {
                        await masterTab.reload({ waitUntil: 'networkidle2' });
                        await new Promise(r => setTimeout(r, 5000)); 
                        await clearOnboardingPopups(masterTab, null);
                    }
                }

                if (targetCount === 0) throw new Error(`0 targets found for ${session.target}.`);

                // 3. Clones & Strike
                await updateStatus(`[WT BURNER] Spawning ${targetCount - 1} clone tabs...`);
                for (let i = 1; i < targetCount; i++) {
                    const p = await session.browser.newPage();
                    pages.push(p);
                    await p.setViewport({ width: 412, height: 915 });
                    await p.goto('https://simpletasks234.com/task', { waitUntil: 'networkidle2' });
                }
                
                if (pages.length > 1) {
                    await new Promise(r => setTimeout(r, 3000));
                    await Promise.all(pages.slice(1).map(p => clearOnboardingPopups(p, null)));
                }

                await updateStatus(`[WT BURNER] Firing synchronized ghost-clicks...`);
                const clickResults = await Promise.all(pages.map((p, idx) => {
                    return p.evaluate((suffixStr, tabIndex) => {
                        const btns = Array.from(document.querySelectorAll('*')).filter(el => el.innerText?.trim() === 'Send' && el.offsetParent !== null);
                        let matchCount = 0;
                        for (let b of btns) {
                            let txt = b.parentElement?.parentElement?.innerText || '';
                            if (txt.includes(suffixStr)) {
                                if (matchCount === tabIndex) {
                                    b.click(); return true;
                                }
                                matchCount++;
                            }
                        }
                        return false;
                    }, session.target, idx);
                }));

                await new Promise(r => setTimeout(r, 10000));

                await Promise.all(pages.map(p => p.evaluate(() => {
                    Array.from(document.querySelectorAll('*')).forEach(el => {
                        if (el.innerText?.trim() === 'Confirm' && el.offsetParent !== null) el.click();
                    });
                })));

                await updateStatus(`[WT BURNER] Clicks fired. Server cooldown (15s)...`);
                await new Promise(r => setTimeout(r, 15000));

                // 4. Final Calculation
                const finalTaskSnap = await masterTab.screenshot({ type: 'png' });
                let currentBalanceText = "Unknown";
                let earnedDisplay = "Unknown";

                try {
                    await masterTab.goto('https://simpletasks234.com/user', { waitUntil: 'networkidle2' });
                    await new Promise(r => setTimeout(r, 3000));
                    currentBalanceText = await masterTab.evaluate(() => {
                        const match = document.body.innerText.match(/Account\s*Balance[\s:\n]*([\d,]+(?:\.\d+)?)/i);
                        return match ? match[1] : 'Unknown';
                    });
                    let finalNum = parseFloat(currentBalanceText.replace(/,/g, ''));
                    earnedDisplay = `+${(finalNum - initialBalanceNum).toFixed(2)}`;
                } catch (e) {}

                  await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
                
                
                await bot.sendPhoto(chatId, finalTaskSnap, { 
                    caption: `Complete\nProfit: <code>${earnedDisplay}</code>\nBalance: <code>${currentBalanceText}</code>`,
                    parse_mode: 'HTML'
                });


            } catch (err) {
                await updateStatus(`[ERROR] WT Sequence failed: ${err.message}`);
            } finally {
                // 5. CLEAN UP CLONE TABS TO SAVE RAM
                if (pages.length > 1) {
                    for (let p of pages.slice(1)) {
                        await p.close().catch(()=>{});
                    }
                }
                
                // 6. OPEN IT BACK UP FOR THE NEXT NUMBER
                session.step = 'TARGET_OR_AWAITING';

                // 7. RESET THE 15 MINUTE TIMEBOMB
                session.timer = setTimeout(async () => {
                    if (wtSessions[chatId] && wtSessions[chatId].browser) {
                        await wtSessions[chatId].browser.close().catch(()=>{});
                        wtSessions[chatId] = null;
                        bot.sendMessage(chatId, '[SYSTEM] WT Burner 15-minute auto-timeout reached. Browser destroyed.');
                    }
                }, 15 * 60 * 1000);
            }
            return;
        }
    }


    // --- 3. M4U PAIRING CONTINUOUS LOOP ---
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
                            m4uSession.linkedCount++; 
                            bot.sendMessage(chatId, `[VERIFIED] Number successfully linked!\n\nTotal: ${m4uSession.linkedCount} | Refreshing...`);
                            
                            // 1. FAST RELOAD: Only wait for the initial DOM load
                            await m4uPage.reload({ waitUntil: 'domcontentloaded' });
                            
                            // 2. IMMEDIATE ADD STRIKE: Force click the Add button
                            await m4uPage.evaluate(async () => {
                                // Wait briefly for the JS to hydrate the button
                                await new Promise(r => setTimeout(r, 1000));
                                const addBtn = Array.from(document.querySelectorAll('*')).find(el => 
                                    el.innerText && el.innerText.trim().toLowerCase() === 'add' && el.offsetParent !== null
                                );
                                if (addBtn) addBtn.click();
                            });
                            
                            await new Promise(r => setTimeout(r, 1000));
                            
                            m4uSession.state = 'WAITING_NUMBER';
                            bot.sendMessage(chatId, `[SYSTEM] Ready for next number.`);
                        }
                           else {
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


setInterval(() => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();

    // Trigger at 4:00 AM (4) and 4:00 PM (16)
    if ((hours === 4 || hours === 16) && minutes === 0 && seconds === 0) {
        console.log(`[SCHEDULE] Triggering M4U Auto-Sign-In for ${hours}:00...`);
        performM4USignIn(ADMIN_ID);
    }
}, 1000); 



console.log('System booting. Waiting for Telegram commands...');
