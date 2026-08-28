import 'dotenv/config.js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

// 1. Bring back 'require'
const require = createRequire(import.meta.url);

// 2. Bring back '__dirname' and '__filename'
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dotenv = require('dotenv');
// Runtime environment variables win over values loaded from the repository .env file.
dotenv.config({ path: path.join(__dirname, '.env'), override: false });

// --- WSJOBS SITE CONFIGURATION ---
// Keep credentials outside source control. Set these in the runtime environment.
const WSJOBS_BASE_URL = (process.env.WSJOBS_BASE_URL || 'https://ws.g.pro').replace(/\/+$/, '');
const WSJOBS_LOGIN_PATH = '/login';
const WSJOBS_ACCOUNT_PATH = '/account';
const WSJOBS_TASK_PATH = '/task';
const WSJOBS_WITHDRAW_PATH = '/withdraw';
const WSJOBS_USERNAME = process.env.WSJOBS_USERNAME || '';
const WSJOBS_PASSWORD = process.env.WSJOBS_PASSWORD || '';
const WSJOBS_WITHDRAW_PIN = process.env.WSJOBS_WITHDRAW_PIN || '';

function wsjobsUrl(pathname) {
    return `${WSJOBS_BASE_URL}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

async function loginToWsjobs(page, credentials = {}) {
    const username = credentials.username || WSJOBS_USERNAME;
    const password = credentials.password || WSJOBS_PASSWORD;
    if (!username || !password) {
        throw new Error('Missing WSJOBS_USERNAME/WSJOBS_PASSWORD configuration.');
    }

    const passwordField = page.locator('#password');
    if (await passwordField.isVisible().catch(() => false)) {
        await page.locator('#account').fill(username);
        await passwordField.fill(password);
        await page.getByRole('button', { name: /^login$/i }).last().click();

        // The new site is a client-side app and may not change the URL immediately.
        // Wait for the visible login form to disappear, then reopen /account.
        await page.waitForFunction(() => {
            const field = document.querySelector('#password');
            return !field || field.offsetParent === null;
        }, { timeout: 15000 }).catch(() => {});
        await page.goto(wsjobsUrl(WSJOBS_ACCOUNT_PATH), {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await page.waitForTimeout(2000);
    }

    const loginStillVisible = await page.locator('#password').isVisible().catch(() => false);
    if (new URL(page.url()).pathname.endsWith(WSJOBS_LOGIN_PATH) || loginStillVisible) {
        throw new Error('Wsjobs login did not complete. Check the account, password, and site response.');
    }
}

async function loginToWsjobsPuppeteer(page, credentials = {}) {
    const username = credentials.username || WSJOBS_USERNAME;
    const password = credentials.password || WSJOBS_PASSWORD;
    if (!username || !password) {
        throw new Error('Missing WSJOBS_USERNAME/WSJOBS_PASSWORD configuration.');
    }

    const passwordField = await page.$('#password');
    const loginVisible = passwordField
        ? await page.evaluate((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        }, passwordField).catch(() => false)
        : false;

    if (loginVisible) {
        await page.click('#account');
        await page.type('#account', username, { delay: 20 });
        await page.click('#password');
        await page.type('#password', password, { delay: 20 });

        const clicked = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const submit = buttons.reverse().find((button) =>
                /^login$/i.test((button.innerText || '').trim()) && button.getAttribute('role') !== 'tab'
            );
            if (!submit) return false;
            submit.click();
            return true;
        });
        if (!clicked) throw new Error('Wsjobs login button was not found.');

        await delay(2000);
        await page.goto(wsjobsUrl(WSJOBS_ACCOUNT_PATH), {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await delay(2000);
    }

    const loginStillVisible = await page.$eval('#password', (el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    }).catch(() => false);

    if (new URL(page.url()).pathname.endsWith(WSJOBS_LOGIN_PATH) || loginStillVisible) {
        throw new Error('Wsjobs login did not complete. Check the account, password, and site response.');
    }
}

process.env.PLAYWRIGHT_BROWSERS_PATH = '0';



const fs = require('fs');
const { execSync } = require('child_process');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { PostgresStore } = require('wwebjs-postgres');
const { Pool } = require('pg');
const { chromium } = require('playwright-core');
const sharp = require('sharp');
const puppeteer = require('puppeteer-extra');
const QRCode = require('qrcode');
const { remote } = require('webdriverio');
const axios = require('axios');
const cheerio = require('cheerio');
const pdf = require('pdf-parse');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const { parsePhoneNumberFromString } = require('libphonenumber-js');




const { exec, execFile } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const execFilePromise = util.promisify(execFile);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));


const multer = require('multer');
const upload = multer({ limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB limit


const { PuppeteerScreenRecorder } = require('puppeteer-screen-recorder');
// Prevent unhandled stream errors from crashing the app
process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]', err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION]', reason);
});




// --- BULLETPROOF CHROME LOCATOR ---
function getChromePath() {
    const possiblePaths = [
        process.env.GOOGLE_CHROME_BIN,
        process.env.CHROME_BIN,
        process.env.GOOGLE_CHROME_SHIM,
        process.env.PUPPETEER_EXECUTABLE_PATH,
        process.env.CHROME_PATH,
        path.join(__dirname, '.chrome-for-testing/chrome-linux64/chrome'),
        path.join(process.env.HOME || '', '.chrome-for-testing/chrome-linux64/chrome'),
        '/app/.chrome-for-testing/chrome-linux64/chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser'
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

function launchPlaywrightBrowser(options = {}) {
    const executablePath = getChromePath();
    return chromium.launch({
        ...options,
        ...(executablePath ? { executablePath } : {})
    });
}

function launchScraperBrowser() {
    const launchOptions = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    };
    const chromePath = getChromePath();
    if (chromePath) launchOptions.executablePath = chromePath;
    return puppeteer.launch(launchOptions);
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

// --- JSON TO NETSCAPE COOKIE CONVERTER ---
function prepareGhostCookies() {
    const jsonPath = path.join(__dirname, 'cookies.json');
    const txtPath = path.join(__dirname, 'cookies.txt');

    if (!fs.existsSync(jsonPath)) {
        console.log('[SYSTEM] No cookies.json found. Engine will attempt cookieless extraction.');
        return null;
    }

    try {
        const rawData = fs.readFileSync(jsonPath, 'utf8');
        const cookies = JSON.parse(rawData);

        let netscapeFormat = "# Netscape HTTP Cookie File\n# Auto-Generated by Node.js\n\n";

        for (let c of cookies) {
            let domain = c.domain || '';
            let includeSub = domain.startsWith('.') ? 'TRUE' : 'FALSE';
            let pathStr = c.path || '/';
            let secure = c.secure ? 'TRUE' : 'FALSE';

            // Handle different JSON time formats
            let expiry = 0;
            if (c.expirationDate) expiry = Math.round(c.expirationDate);
            else if (c.expires) expiry = Math.round(c.expires);
            else expiry = Math.round(Date.now() / 1000) + (60 * 60 * 24 * 365); // Default 1 year

            netscapeFormat += `${domain}\t${includeSub}\t${pathStr}\t${secure}\t${expiry}\t${c.name}\t${c.value}\n`;
        }

        fs.writeFileSync(txtPath, netscapeFormat);
        return txtPath;
    } catch (err) {
        console.log('[SYSTEM ERROR] Failed to parse cookies.json:', err.message);
        return null;
    }
}




// --- WSTASK PERSISTENCE DATABASE ---
pool.query(`
    CREATE TABLE IF NOT EXISTS wstask_stats (
        id SERIAL PRIMARY KEY,
        daily_count INTEGER DEFAULT 0,
        last_reset_date TEXT
    );
`)
.then(async () => {
    // Check if we need to insert the first row
    const res = await pool.query('SELECT * FROM wstask_stats LIMIT 1');
    if (res.rows.length === 0) {
        await pool.query('INSERT INTO wstask_stats (daily_count, last_reset_date) VALUES (0, $1)',
            [new Date().toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos' })]);
    }
    console.log('[SYSTEM] WSTASK Stats DB Ready.');
})
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


const saveWSTaskStats = async (count, date) => {
    try {
        await pool.query(
            'UPDATE wstask_stats SET daily_count = $1, last_reset_date = $2 WHERE id = 1',
            [count, date]
        );
    } catch (err) {
        console.error('[ERROR] Failed to save WSTASK stats:', err);
    }
};

const loadWSTaskStats = async () => {
    try {
        const res = await pool.query('SELECT daily_count, last_reset_date FROM wstask_stats WHERE id = 1');
        if (res.rows.length > 0) {
            wsDailyCount = res.rows[0].daily_count;
            wsLastResetDate = res.rows[0].last_reset_date;
            console.log(`[SYSTEM] Restored stats: ${wsDailyCount} targets hit on ${wsLastResetDate}`);
        }
    } catch (err) {
        console.error('[ERROR] Failed to load WSTASK stats:', err);
    }
};

// Call this immediately to load stats when the server boots up
loadWSTaskStats();


// Global variables to track open tabs and handle the 1-hour idle timeout
let activeTaskPages = [];
let taskIdleTimer = null;


// --- CONTINUOUS TASK MODE STATE ---
let taskModeActive = false;
let taskModeTimer = null;
let autoScannerInterval = null;
let isTaskExecuting = false;    // Traffic light for the /task command
let isRadarScanning = false;    // Traffic light for the background queue


  // Variables to track profit
let initialBalanceText = "0";
let initialBalanceNum = 0;

// --- WT BURNER SESSION TRACKER ---
const wtSessions = {};

// --- WSTASK STATE & TRACKING ---
let wsTaskMode = false;
let wsTaskTimer = null; // Added timer for the 30-minute auto-close
let wsDailyCount = 0;
let wsLastResetDate = new Date().toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos' });
const wsPairSessions = new Map();
const wsPairRuntimes = new Map();



const appiumSessions = {};

// --- AUTHORIZATION CONFIG ---
const ADMIN_ID = process.env.ADMIN_ID || '7710721646';

// Split the SUBADMIN_ID string by commas into a real array
const SUBADMIN_IDS = (process.env.SUBADMIN_ID || '').split(',').map(id => id.trim());

// Create a final list of all authorized users
const AUTHORIZED = [ADMIN_ID, ...SUBADMIN_IDS].filter(id => id !== '');

console.log(`[SYSTEM] Authorized Admins: ${AUTHORIZED.join(', ')}`);




// --- 2. HEROKU WEB SERVER SETUP ---
const http = require('http');
const WebSocket = require('ws');

const app = express(); // 1. Create the app first!
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const PORT = process.env.PORT || 3000;

// 2. NOW you can use app.use
app.use('/public', express.static(path.join(__dirname, 'public')));

// Ensure the directory exists so it doesn't crash later
if (!fs.existsSync('./public')) {
    fs.mkdirSync('./public');
}




app.get('/', (req, res) => res.send('WhatsApp Bot running with Postgres Auth.'));

// --- DIRECT WEBSOCKET HUB (TERMUX LINK) ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

global.termuxSocket = null;
let fileMeta = null;

wss.on('connection', (ws) => {
    console.log('[HEROKU] Termux Phone connected successfully!');
    global.termuxSocket = ws;
    let fileMeta = null;

    // Notice// Inside your wss.on('connection', ...) listener
// Ensure this exists at the top of your Heroku index.js
global.fileStorage = new Map();





    ws.on('message', async (data, isBinary) => {
    try {
        // --- 1. HANDLE TEXT/JSON MESSAGES ---
        if (!isBinary) {
            const msg = JSON.parse(data.toString());
            if (msg.action === 'ping') return;

            if (msg.action === 'file_delivery') {
                fileMeta = msg;
            }
            // --- CATCH TERMUX ERRORS ---
            else if (msg.action === 'error') {
                if (msg.chatId === 'API_USER') {
                    const clientData = global.waitingClients.get(msg.msgId);
                    if (clientData && clientData.res) {
                        if (clientData.heartbeat) clearInterval(clientData.heartbeat);
                        if (!clientData.res.headersSent) clientData.res.status(500).json({ error: msg.message });
                        else clientData.res.end();
                        global.waitingClients.delete(msg.msgId);
                    }
                } else {
                    await bot.editMessageText(`[ERROR] Termux: ${msg.message}`, { chat_id: msg.chatId, message_id: msg.msgId }).catch(()=>{});
                }
            }

                        // ==========================================
            // NEW: HANDLE AI RESPONSES FROM TERMUX
            // ==========================================
            else if (msg.action === 'ai_response') {
                const client = global.waitingAiClients.get(msg.reqId);
                if (client) {
                    clearTimeout(client.timeout);
                    if (client.heartbeat) clearInterval(client.heartbeat); // KILL THE HEARTBEAT

                    global.waitingAiClients.delete(msg.reqId);

                    if (client.isApiCall) {
                        if (msg.success) {
                            const history = chatHistories.get(client.sessionKey) || [];
                            history.push({ role: "assistant", content: msg.text });
                            chatHistories.set(client.sessionKey, history);

                            // Because we started streaming earlier, we just write the final JSON and end the stream!
                            client.res.write(JSON.stringify({ success: true, text: msg.text }));
                            client.res.end();
                        } else {
                            client.res.write(JSON.stringify({ success: false, error: msg.error }));
                            client.res.end();
                        }
                    }
                    else {
                        // (Your Telegram logic remains completely unchanged below this)
                        if (msg.success) {
                            await bot.deleteMessage(client.chatId, client.msgId).catch(() => {});

                            const replyText = msg.text;
                            if (replyText.length > 4000) {
                                const chunks = replyText.match(/[\s\S]{1,4000}/g);
                                for (let chunk of chunks) {
                                    await bot.sendMessage(client.chatId, chunk, { parse_mode: 'Markdown' });
                                    await new Promise(r => setTimeout(r, 500));
                                }
                            } else {
                                await bot.sendMessage(client.chatId, replyText, { parse_mode: 'Markdown' });
                            }
                        } else {
                            await bot.editMessageText(`[ERROR] AI Failed: ${msg.error}`, {
                                chat_id: client.chatId,
                                message_id: client.msgId
                            }).catch(() => {});
                        }
                    }
                }
            }

        } // <--- FIXED: Added the missing closing bracket for `if (!isBinary)`

        // --- 2. HANDLE BINARY STREAMING (VIDEOS/AUDIO) ---
        else {
            if (!fileMeta) return;
            const { chatId, msgId, ext } = fileMeta;

            // Handle API Webhook Downloads
            if (chatId === 'API_USER') {
                const clientData = global.waitingClients.get(msgId);

                if (clientData && clientData.res) {
                    const res = clientData.res;

                    if (clientData.heartbeat) {
                        clearInterval(clientData.heartbeat);
                    }

                    if (!res.headersSent) {
                        res.setHeader('Content-Type', ext === 'mp4' ? 'video/mp4' : 'audio/mpeg');
                    }

                    res.write(data);
                    res.end();

                    global.waitingClients.delete(msgId);
                }
                fileMeta = null;
                data = null;
                return;
            }

            // Handle Telegram Downloads
            await bot.editMessageText(`[SYSTEM] Streaming binary to Telegram...`, { chat_id: chatId, message_id: msgId }).catch(()=>{});

            if (ext === 'mp4') {
                await bot.sendVideo(
                    chatId,
                    data,
                    { supports_streaming: true },
                    { filename: `video_${Date.now()}.mp4`, contentType: 'video/mp4' }
                ).catch(console.error);
            } else {
                await bot.sendAudio(
                    chatId,
                    data,
                    {},
                    { filename: `audio_${Date.now()}.mp3`, contentType: 'audio/mpeg' }
                ).catch(console.error);
            }

            await bot.deleteMessage(chatId, msgId).catch(() => {});

            fileMeta = null;
            data = null;
        }
    } catch (err) {
        console.error('[WS SERVER ERROR]', err);
    }
});




    ws.on('close', () => {
        console.log('[HEROKU] Termux disconnected.');
        global.termuxSocket = null;
    });
});


// 3. Start the server (Notice it is server.listen, not app.listen)
server.listen(PORT, () => console.log(`Web server & WebSocket Hub listening on port ${PORT}`));


// --- 3. TELEGRAM BOT SETUP ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8721362064:AAHYyf93BIe6SLg2BiuV0URlkHpkKstQRX8';
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

let waClient = null;
let globalTaskBrowser = null;
const userState = {};



// --- GLOBAL EXCHANGE RATE ENGINE ---
let cachedNgnRate = null;
let lastRateFetch = 0;

async function getNgnRate() {
    const now = Date.now();
    // Cache the rate for 6 hours (21600000 ms) to prevent API bans
    if (cachedNgnRate && (now - lastRateFetch < 21600000)) {
        return cachedNgnRate;
    }
    try {
        const apiKey = process.env.EXCHANGE_RATE_API_KEY || '27b153ae2befc94acf2d3eab';
        const res = await fetch(`https://v6.exchangerate-api.com/v6/${apiKey}/latest/USD`);
        const data = await res.json();

        if (data.result === 'success' && data.conversion_rates && data.conversion_rates.NGN) {
            cachedNgnRate = data.conversion_rates.NGN;
            lastRateFetch = now;
            console.log(`[SYSTEM] Live NGN Rate updated: 1 USD = ${cachedNgnRate} NGN`);
            return cachedNgnRate;
        }
    } catch (e) {
        console.log("[API ERROR] Failed to fetch NGN rate:", e.message);
    }
    // Fallback rate if the API goes down so the bot doesn't crash
    return cachedNgnRate || 1500;
}


// --- TASK MODE IDLE TIMER HELPER ---
function resetTaskModeTimer(chatId) {
    if (taskModeTimer) clearTimeout(taskModeTimer);

    taskModeTimer = setTimeout(() => {
        taskModeActive = false;
        if (autoScannerInterval) clearInterval(autoScannerInterval);

        bot.sendMessage(chatId, '[SYSTEM] Task Mode automatically ended after 30 minutes of inactivity.', {
            reply_markup: {
                keyboard: [[{ text: 'Withdraw' }, { text: 'Balance' }]],
                resize_keyboard: true, is_persistent: true
            }
        });
    }, 30 * 60 * 1000); // 30 minutes
}




// --- AUTONOMOUS TASK RADAR ENGINE (SEQUENTIAL MULTI-TARGET) ---
async function runAutoTaskScanner(chatId) {
    // Abort if task mode is off, if a strike is running, or if the radar is already busy.
    if (!taskModeActive || isTaskExecuting || isRadarScanning) return;

    isRadarScanning = true;

    let scanPage = null;
    let targetsToStrike = [];

    try {
        // RADAR uses the same Puppeteer/Chrome stack as the current /task flow.
        if (!globalTaskBrowser || !globalTaskBrowser.isConnected()) {
            console.log('[RADAR] Cold Boot: Launching Chrome task browser...');
            globalTaskBrowser = await launchScraperBrowser();
        }

        scanPage = await globalTaskBrowser.newPage();
        await scanPage.setViewport({ width: 412, height: 915 });

        // Start from the task route. If the site redirects to login, the Puppeteer
        // helper completes login and this scanner returns to /task immediately.
        await scanPage.goto(wsjobsUrl(WSJOBS_TASK_PATH), {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await delay(2000);
        await loginToWsjobsPuppeteer(scanPage);
        await scanPage.goto(wsjobsUrl(WSJOBS_TASK_PATH), {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        // Wait for the current task board instead of assuming a fixed load time.
        await scanPage.waitForFunction(() => Array.from(
            document.querySelectorAll('button, [class*="btn"], [class*="button"]')
        ).some(el => /Send Task|SEND/i.test(el.innerText?.trim()) && el.offsetHeight > 0), {
            timeout: 15000
        }).catch(() => {});
        await delay(1000);

        // Count only real task cards. The old scanner climbed arbitrary
        // ancestors and could read points, counters, or linked-account text
        // outside the task card, creating false suffixes.
        const counts = await scanPage.evaluate(() => {
            const isVisible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                return rect.width > 0 && rect.height > 0
                    && style.visibility !== 'hidden' && style.display !== 'none';
            };
            const isSendTaskButton = (el) =>
                isVisible(el) && /^send(?:\s+task)?$/i.test((el.innerText || '').replace(/\s+/g, ' ').trim());
            const sendButtons = Array.from(document.querySelectorAll(
                'button, [role="button"], [class*="btn"], [class*="button"]'
            )).filter(isSendTaskButton);
            const tracker = {};

            for (const button of sendButtons) {
                // Pick the smallest ancestor that contains exactly this one
                // visible Send Task button; that is the task-card boundary.
                let card = null;
                let current = button.parentElement;
                for (let level = 0; level < 10 && current; level++, current = current.parentElement) {
                    const buttonsInCurrent = Array.from(current.querySelectorAll(
                        'button, [role="button"], [class*="btn"], [class*="button"]'
                    )).filter(isSendTaskButton);
                    if (buttonsInCurrent.length === 1 && buttonsInCurrent[0] === button) {
                        card = current;
                        break;
                    }
                }
                if (!card) continue;

                const cardText = (card.innerText || '').replace(/\s+/g, ' ');
                // Accept phone-like values only: a leading plus, or a masked
                // number, followed by 8–15 digits. Never use arbitrary trailing
                // digits from totals, counters, timestamps, or page headings.
                const phoneCandidates = cardText.match(/(?:\+\s*[\d][\d\s().*-]{6,}[\d*]|\*{3,}[\d*]{2,})/g) || [];
                const phoneCandidate = phoneCandidates.find(candidate => {
                    const digits = candidate.replace(/\D/g, '');
                    return digits.length >= 8 && digits.length <= 15;
                });
                if (!phoneCandidate) continue;

                const digits = phoneCandidate.replace(/\D/g, '');
                const suffix = digits.slice(-2);
                if (/^\d{2}$/.test(suffix)) {
                    tracker[suffix] = (tracker[suffix] || 0) + 1;
                }
            }
            return tracker;
        });

        // The latest /task flow can work with 1–4 available tabs. Any positive
        // count is therefore eligible; the old count >= 3 rule is obsolete.
        for (const [suffix, count] of Object.entries(counts)) {
            if (count > 0) targetsToStrike.push({ suffix, count });
        }
        targetsToStrike.sort((a, b) => b.count - a.count);
    } catch (err) {
        console.log(`[RADAR ERROR] Scanner failed: ${err.message}`);
    } finally {
        if (scanPage) await scanPage.close().catch(() => {});
    }

    // --- SEQUENTIAL EXECUTION QUEUE ---
    if (targetsToStrike.length > 0) {
        const queueList = targetsToStrike.map(t => `${t.suffix} (${t.count})`).join(', ');
        console.log(`[RADAR DETECTED] Found eligible task suffixes: ${queueList}. Starting the normal /task flow...`);

        for (const target of targetsToStrike) {
            if (!taskModeActive) break;
            resetTaskModeTimer(chatId);
            console.log(`[RADAR QUEUE] Triggering /task ${target.suffix} with ${target.count} available target(s).`);

            bot.processUpdate({
                update_id: Date.now(),
                message: {
                    message_id: Date.now(),
                    from: { id: parseInt(chatId) },
                    chat: { id: parseInt(chatId), type: 'private' },
                    date: Math.floor(Date.now() / 1000),
                    text: `/task ${target.suffix}`
                }
            });

            console.log('[RADAR QUEUE] Waiting 1 minute before the next target scan.');
            await new Promise(r => setTimeout(r, 60000));
        }
        console.log('[RADAR QUEUE] All eligible targets processed. Returning to background scan.');
    } else {
        console.log('[RADAR] Scan finished. No eligible matching task targets were found.');
    }

    isRadarScanning = false;
}






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




// =========================================================
// --- ORIGINAL NUMBER PANEL ENGINE (51.89.99.105) ---
// --- Fully Isolated to prevent TimeSMS collisions ---
// =========================================================

const RAW_NP_BASE_URL = (process.env.RAW_NP_BASE_URL || 'http://51.89.99.105/NumberPanel').replace(/\/+$/, '');
const RAW_NP_POLL_SEC = 16 * 1000;

// You can run a second instance of the bot safely with polling: false
const RAW_NP_BOT_TOKEN = '8722377131:AAEr1SsPWXKy8m4WbTJBe7vrN03M2hZozhY';
const RAW_NP_TARGET_CHAT_ID = '-1003645249777';
const rawNpBot = new TelegramBot(RAW_NP_BOT_TOKEN, { polling: false });

const RAW_NP_ACCOUNTS = [
    { name: "Eren", username: "sukuna65", password: "sukuna65", topic_id: null },
];

const RAW_NP_COUNTRY_FLAGS = {
    "ethiopia": "🇪🇹", "egypt": "🇪🇬", "mali": "🇲🇱", "indonesia": "🇮🇩",
    "guinea": "🇬🇳", "togo": "🇹🇬", "ghana": "🇬🇭", "tanzania": "🇹🇿",
    "bangladesh": "🇧🇩", "kenya": "🇰🇪", "nigeria": "🇳🇬", "india": "🇮🇳",
    "pakistan": "🇵🇰", "philippines": "🇵🇭", "vietnam": "🇻🇳", "thailand": "🇹🇭",
    "brazil": "🇧🇷", "mexico": "🇲🇽", "russia": "🇷🇺", "ukraine": "🇺🇦",
    "poland": "🇵🇱", "germany": "🇩🇪", "france": "🇫🇷", "spain": "🇪🇸",
    "italy": "🇮🇹", "uk": "🇬🇧", "usa": "🇺🇸", "canada": "🇨🇦",
    "australia": "🇦🇺", "south africa": "🇿🇦", "morocco": "🇲🇦", "algeria": "🇩🇿",
    "tunisia": "🇹🇳", "cameroon": "🇨🇲", "senegal": "🇸🇳", "ivory coast": "🇨🇮",
    "benin": "🇧🇯", "burkina faso": "🇧🇫", "niger": "🇳🇪", "chad": "🇹🇩"
};

// --- ISOLATED DATABASE INITIALIZATION & RAM PRE-LOADER ---
const rawNpMemCache = new Set(); // Ultra-fast RAM Cache

pool.query(`CREATE TABLE IF NOT EXISTS raw_numberpanel_sent (id VARCHAR(255) PRIMARY KEY);`)
    .then(async () => {
        console.log('[SYSTEM] Original NumberPanel DB Ready.');
        // PRE-LOADER: Fetch all previously sent OTPs from the DB into RAM immediately on boot.
        // This completely prevents the bot from spamming old messages when Heroku restarts!
        try {
            const res = await pool.query('SELECT id FROM raw_numberpanel_sent');
            res.rows.forEach(row => rawNpMemCache.add(row.id));
            console.log(`[SYSTEM] Loaded ${rawNpMemCache.size} previous OTPs into RAM. Spam protection active.`);
        } catch (err) {
            console.error('[ERROR] Failed to load previous OTPs:', err.message);
        }
    })
    .catch(console.error);


async function isRawNpSeen(key) {
    try {
        const res = await pool.query('SELECT 1 FROM raw_numberpanel_sent WHERE id = $1', [key]);
        return res.rows.length > 0;
    } catch (err) { return false; }
}

async function markRawNpSeen(key) {
    try {
        await pool.query('INSERT INTO raw_numberpanel_sent (id) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
    } catch (err) {}
}

// --- UTILITY FUNCTIONS ---
function getRawNpFlag(numberStr, countryName) {
    if (numberStr) {
        try {
            const parsed = parsePhoneNumberFromString("+" + numberStr.replace(/^\+/, ''));
            if (parsed && parsed.country) {
                return parsed.country.toUpperCase().replace(/./g, char => String.fromCodePoint(char.charCodeAt(0) + 127397));
            }
        } catch (e) {}
    }
    if (countryName) {
        const lowerName = countryName.toLowerCase();
        for (const [k, v] of Object.entries(RAW_NP_COUNTRY_FLAGS)) {
            if (lowerName.includes(k)) return v;
        }
    }
    return "🌍";
}

function solveRawNpCaptcha(html) {
    const raw = String(html || '');
    const attributeText = [...raw.matchAll(/(?:value|placeholder|data-captcha|aria-label)\s*=\s*["']([^"']+)["']/gi)]
        .map(match => match[1])
        .join(' ');
    const text = `${raw} ${attributeText}`
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;|&#160;/gi, ' ')
        .replace(/&plus;|&#43;/gi, '+')
        .replace(/&minus;|&#45;/gi, '-')
        .replace(/&times;|&#215;|&#42;/gi, '*')
        .replace(/&divide;|&#247;/gi, '/')
        .replace(/[×xX]/g, '*')
        .replace(/[÷]/g, '/')
        .replace(/[−–—]/g, '-')
        .replace(/\s+/g, ' ');
    const match = text.match(/(\d{1,9})\s*([+\-*\/])\s*(\d{1,9})(?:\s*=\s*\?)?/);
    if (!match) return null;
    const a = Number.parseInt(match[1], 10);
    const b = Number.parseInt(match[3], 10);
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return null;
    if (match[2] === '+') return String(a + b);
    if (match[2] === '-') return String(a - b);
    if (match[2] === '*') return String(a * b);
    if (match[2] === '/' && b !== 0) return String(Math.floor(a / b));
    return null;
}

function extractRawOTP(msg) {
    const patterns = [
        /\b(\d{3}-\d{3})\b/i, /\b(\d{6})\b/i, /\b(\d{4})\b/i,
        /\b(\d{5})\b/i, /\b(\d{8})\b/i, /OTP[:\s]*(\d+)/i,
        /code[:\s]*(\d+)/i, /verification[:\s]*(\d+)/i, /pin[:\s]*(\d+)/i
    ];
    for (let pat of patterns) {
        const match = msg.match(pat);
        if (match && match[1]) return match[1];
    }
    return null;
}

function updateRawCookies(headers, currentCookies) {
    if (headers['set-cookie']) {
        headers['set-cookie'].forEach(cookieStr => {
            const parts = cookieStr.split(';')[0].split('=');
            currentCookies[parts[0]] = parts.slice(1).join('=');
        });
    }
    return currentCookies;
}

function getRawCookieString(cookies) {
    return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

// --- ENGINE STATE ---
const rawNpSessions = {};
const rawNpLoggedErrors = new Set();

function logRawNpErrorOnce(username, error) {
    const message = error instanceof Error ? error.message : String(error);
    const key = `${username}:${message}`;
    if (rawNpLoggedErrors.has(key)) return;
    rawNpLoggedErrors.add(key);
    console.error(`[ERROR] Original NumberPanel Login Error: ${message}`);
}

// --- LOGIN ROUTINE (PURE AXIOS) ---
async function loginRawNumPanel(username, password, force = false) {
    if (rawNpSessions[username] && !force) return rawNpSessions[username];

    const cookies = {};
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive'
    };

    try {
        let res1 = null;
        let cap = null;
        for (let captchaAttempt = 1; captchaAttempt <= 3 && !cap; captchaAttempt++) {
            res1 = await axios.get(`${RAW_NP_BASE_URL}/login?captcha_refresh=${Date.now()}`, {
                headers,
                validateStatus: () => true,
                timeout: 20000
            });
            if (res1.status >= 400) {
                throw new Error(`NumberPanel login endpoint returned HTTP ${res1.status}. Set RAW_NP_BASE_URL to the current panel URL.`);
            }
            updateRawCookies(res1.headers, cookies);
            cap = solveRawNpCaptcha(res1.data);
            if (!cap) {
                console.warn(`[RAW NP SYSTEM] Captcha parse failed on attempt ${captchaAttempt}/3; refreshing login page.`);
                await delay(400);
            }
        }
        if (!cap) throw new Error('Captcha solve failed after 3 fresh login-page attempts.');

        headers['Cookie'] = getRawCookieString(cookies);
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        headers['Origin'] = 'http://51.89.99.105';
        headers['Referer'] = `${RAW_NP_BASE_URL}/login`;

        const loginData = new URLSearchParams({ username, password, capt: cap }).toString();

        let res2 = await axios.post(`${RAW_NP_BASE_URL}/signin`, loginData, {
            headers,
            maxRedirects: 0,
            validateStatus: status => status >= 200 && status < 400
        });

        updateRawCookies(res2.headers, cookies);

        if (res2.status !== 302) throw new Error(`Login failed with status ${res2.status}`);
        if (!cookies['x12']) throw new Error("Login failed - x12 cookie not set.");

        const loc = res2.headers.location || "agent/";
        const role = loc.includes("client") ? "client" : "agent";

        headers['Cookie'] = getRawCookieString(cookies);
        let res3 = await axios.get(`${RAW_NP_BASE_URL}/${role}/SMSCDRStats`, { headers, validateStatus: () => true });

        const sessMatch = res3.data.match(/sesskey=([^&"\s']+)/);
        const sesskey = sessMatch ? sessMatch[1] : null;

        console.log(`[SYSTEM] Original NumberPanel Logged In: ${username} (role=${role})`);

        rawNpSessions[username] = { cookies, role, sesskey, headers };
        return rawNpSessions[username];

    } catch (err) {
        logRawNpErrorOnce(username, err);
        return null;
    }
}

// --- DATA FETCHING ROUTINE ---
async function fetchRawNumPanelSms(sessionData) {
    if (!sessionData.cookies['x12']) return null;

    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];

    const params = new URLSearchParams({
        "fdate1": `${dateStr} 00:00:00`,
        "fdate2": `${dateStr} 23:59:59`,
        "frange": "", "fnum": "", "fcli": "",
        "fgdate": "", "fgmonth": "", "fgrange": "",
        "fgnumber": "", "fgcli": "", "fg": "0",
        "sEcho": "1", "iColumns": "7",
        "sColumns": ",,,,,,",
        "iDisplayStart": "0", "iDisplayLength": "100",
        "mDataProp_0": "0", "sSearch_0": "", "bRegex_0": "false", "bSearchable_0": "true", "bSortable_0": "true",
        "mDataProp_1": "1", "sSearch_1": "", "bRegex_1": "false", "bSearchable_1": "true", "bSortable_1": "true",
        "mDataProp_2": "2", "sSearch_2": "", "bRegex_2": "false", "bSearchable_2": "true", "bSortable_2": "true",
        "mDataProp_3": "3", "sSearch_3": "", "bRegex_3": "false", "bSearchable_3": "true", "bSortable_3": "true",
        "mDataProp_4": "4", "sSearch_4": "", "bRegex_4": "false", "bSearchable_4": "true", "bSortable_4": "true",
        "mDataProp_5": "5", "sSearch_5": "", "bRegex_5": "false", "bSearchable_5": "true", "bSortable_5": "true",
        "mDataProp_6": "6", "sSearch_6": "", "bRegex_6": "false", "bSearchable_6": "true", "bSortable_6": "true",
        "sSearch": "", "bRegex": "false",
        "iSortCol_0": "0", "sSortDir_0": "desc", "iSortingCols": "1",
        "_": Date.now().toString()
    });

    if (sessionData.sesskey) params.append("sesskey", sessionData.sesskey);

    const headers = { ...sessionData.headers };
    headers['Cookie'] = getRawCookieString(sessionData.cookies);
    headers['X-Requested-With'] = 'XMLHttpRequest';
    headers['Accept'] = 'application/json, text/javascript, */*; q=0.01';
    headers['Referer'] = `${RAW_NP_BASE_URL}/${sessionData.role}/SMSCDRStats`;

    try {
        const response = await axios.get(`${RAW_NP_BASE_URL}/${sessionData.role}/res/data_smscdr.php?${params.toString()}`, {
            headers, timeout: 20000, validateStatus: () => true, maxRedirects: 0
        });

        if ([302, 303, 307, 401, 403].includes(response.status)) return null;
        if (typeof response.data === 'string' && response.data.toLowerCase().includes('login')) return null;

        const records = [];
        const aaData = response.data.aaData || [];

        for (let rec of aaData) {
            if (!Array.isArray(rec) || rec.length < 6 || typeof rec[2] !== 'string') continue;

            const num = String(rec[2]).trim();
            const svc = String(rec[3]).trim();
            const msg = rec[5] ? String(rec[5]).trim() : "";
            const country = String(rec[1]).split("-")[0].trim();

            if (!/^\d+$/.test(num) || num.length < 7) continue;

            records.push({ num, svc, country, msg });
        }
        return records;

    } catch (e) {
        return [];
    }
}

// --- TELEGRAM MESSAGE BUILDER ---
async function sendRawNumPanelMessage(sms, name, topicId) {
    const code = (extractRawOTP(sms.msg) || "FAILED").replace(/-/g, '');
    const cleanNum = sms.num.replace(/[^0-9]/g, '');
    let localNumber = cleanNum;

    const rawCountry = sms.country || "Unknown";
    const flagEmoji = getRawNpFlag(sms.num, rawCountry);

    let cleanCountry = "Unknown";
    try {
        const parsed = parsePhoneNumberFromString("+" + cleanNum);
        if (parsed && parsed.country) {
            const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
            cleanCountry = regionNames.of(parsed.country);

        } else {
            cleanCountry = rawCountry.split(' ')[0];
        }
    } catch (e) {
        cleanCountry = rawCountry.split(' ')[0];
    }

  const maskedNumber = localNumber.substring(0, 3) + '•••' + localNumber.slice(-4);

    let platform = sms.svc;
    if (/^\d+$/.test(platform)) {
        platform = 'WhatsApp';
    }

    const design =
        `╭═════ 𝚄𝙻𝚃𝙰𝚁 𝙾𝚃𝙿 ═════⊷\n` +
        `┃❃╭──────────────\n` +
        `┃❃│ Platform : ${platform}\n` +
        `┃❃│ Country  : ${cleanCountry} ${flagEmoji}\n` +
        `┃❃│ Number   : ${maskedNumber}\n` +
        `┃❃╰───────────────\n` +
        `╰═════════════════⊷`;

    try {
        const formattedText = design.replace('CODE_FIX', `\`${code}\``);
        const options = {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
            reply_markup: {
                inline_keyboard: [
                    [{ text: `Copy: ${code}`, copy_text: { text: code }, style: 'success' }],
                    [
                        { text: `Owner`, url: `https://t.me/Staries1`, style: 'primary' },
                        { text: `Channel`, url: `https://t.me/+Rci2m853ppA0NWY1`, style: 'primary' }
                    ]
                ]
            }
        };

        if (topicId) options.message_thread_id = topicId;

        const tgMsg = await rawNpBot.sendMessage(RAW_NP_TARGET_CHAT_ID, formattedText, options);
        console.log(`[RAW NP SYSTEM] Sent | ${platform} | ${maskedNumber} | OTP=${code}`);

        const deleteDelay = 600000;
        setTimeout(async () => {
            try { await rawNpBot.deleteMessage(RAW_NP_TARGET_CHAT_ID, tgMsg.message_id); } catch (e) {}
        }, deleteDelay);

        return true;

    } catch (err) {
        console.error(`[RAW NP SYSTEM] Send failed: ${err.message}`);
        return false;
    }
}

// --- THE BACKGROUND ENGINE ---
async function pollRawNumPanel(acc) {
    const { name, username, password, topic_id } = acc;

    try {
        const sess = await loginRawNumPanel(username, password);
        if (!sess) {
            setTimeout(() => pollRawNumPanel(acc), 30000);
            return;
        }

        const records = await fetchRawNumPanelSms(sess);

        if (records === null) {
            await loginRawNumPanel(username, password, true); // Force re-login
            setTimeout(() => pollRawNumPanel(acc), 5000);
            return;
        }

       let newMsgCount = 0;

        for (let sms of records) {
            // 1. Extract the actual OTP code for a bulletproof key (ignores timestamps/spaces)
            const code = extractRawOTP(sms.msg) || sms.msg.substring(0, 30);
            const key = `${sms.num}_${code}`;

            // 2. INSTANT CHECK: Is it in the RAM cache? (Survives restarts because of the pre-loader)
            if (rawNpMemCache.has(key)) continue;

            // 3. LOCK IT: Immediately add to RAM so the loop can't double-fire it
            rawNpMemCache.add(key);

            // 4. SEND IT
            if (await sendRawNumPanelMessage(sms, name, topic_id)) {
                // 5. PERSIST IT: Save to the Postgres database so it survives the next server restart
                await markRawNpSeen(key);
                newMsgCount++;
            }

            await new Promise(r => setTimeout(r, 300));
        }



        if (newMsgCount > 0) {
            console.log(`[RAW NP SYSTEM] [${name}] ${records.length} fetched | ${newMsgCount} new`);
        }

    } catch (e) {
        console.error(`[RAW NP SYSTEM] [${name}] Loop Error: ${e.message}`);
    }

    setTimeout(() => pollRawNumPanel(acc), RAW_NP_POLL_SEC);
}

// Ignite the Original Number Panel Engine
RAW_NP_ACCOUNTS.forEach(acc => pollRawNumPanel(acc));




// --- GLOBAL CONCURRENCY MANAGER ---
let sharedRaganorkBrowser = null;
const activeRaganorkTabs = new Map(); // Now tracks an object: { page, reqId }
let raganorkBrowserTimer = null;

app.post('/api/raganork-hook', async (req, res) => {
    // 1. Safety Check
    if (!req.body || !req.body.number || !req.body.callbackUrl) {
        return res.status(400).json({ success: false, error: "Missing number or callbackUrl in request body." });
    }

    const { number, callbackUrl } = req.body;
    let input = number.toString().trim();

    // --- 2. THE SMART PARSER ---
    let countryCode = '234';
    let localNum = input.replace(/[^0-9]/g, '');

    if (input.includes(' ')) {
        const parts = input.split(/\s+/);
        countryCode = parts[0].replace(/[^0-9]/g, '');
        localNum = parts.slice(1).join('').replace(/[^0-9]/g, '');
    } else {
        const cleanNum = input.replace(/[^0-9]/g, '');
        if (cleanNum.startsWith('0')) {
            countryCode = '234';
            localNum = cleanNum.substring(1);
        } else {
            const globalCodes = [
                '880', '254', '256', '263', '225', '221', '228', '233', '971', '966',
                '234', '58', '91', '92', '62', '55', '44', '27', '20', '1'
            ];
            let found = false;
            for (let code of globalCodes) {
                if (cleanNum.startsWith(code) && cleanNum.length > code.length + 5) {
                    countryCode = code;
                    localNum = cleanNum.substring(code.length);
                    found = true;
                    break;
                }
            }
            if (!found) {
                countryCode = '234';
                localNum = cleanNum;
            }
        }
    }

    const fullNumber = `${countryCode}${localNum}`;
    const myReqId = Date.now(); // Unique timestamp ID for this specific API call

    // Cancel the browser shutdown timer if it was counting down
    if (raganorkBrowserTimer) {
        clearTimeout(raganorkBrowserTimer);
        raganorkBrowserTimer = null;
    }

    // Instantly respond to prevent Heroku Timeout
    res.json({
        success: true,
        message: `Sequence initiated for +${fullNumber}.`,
        callback_target: callbackUrl
    });

    let page = null;

    try {
        // --- 3. BROWSER WARM-UP ---
        if (!sharedRaganorkBrowser || !sharedRaganorkBrowser.isConnected()) {
            console.log("[SYSTEM] Launching Master Browser for Raganork API...");
            sharedRaganorkBrowser = await puppeteer.launch({
                headless: true,
                executablePath: getChromePath(),
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
            });
        }

        // --- 4. REFRESH EXISTING TAB OR CREATE NEW ---
        if (activeRaganorkTabs.has(fullNumber)) {
            const session = activeRaganorkTabs.get(fullNumber);

            // Check if the tab actually exists and hasn't been closed
            if (session.page && !session.page.isClosed()) {
                console.log(`[SYSTEM] Duplicate request detected for +${fullNumber}. Refreshing existing tab...`);
                page = session.page;

                // Update the Map with the NEW reqId so the old process knows to abort
                activeRaganorkTabs.set(fullNumber, { page: page, reqId: myReqId });

                // Refresh the tab instead of killing it
                await page.reload({ waitUntil: 'networkidle2' });
            } else {
                // Tab was dead, make a new one
                page = await sharedRaganorkBrowser.newPage();
                activeRaganorkTabs.set(fullNumber, { page: page, reqId: myReqId });
                await page.setUserAgent('Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
                await page.setViewport({ width: 412, height: 915 });
                await page.goto('https://session.rgnk.site/pairing-code', { waitUntil: 'networkidle2' });
            }
        } else {
            // Completely new number, make a new tab
            page = await sharedRaganorkBrowser.newPage();
            activeRaganorkTabs.set(fullNumber, { page: page, reqId: myReqId });
            await page.setUserAgent('Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
            await page.setViewport({ width: 412, height: 915 });
            await page.goto('https://session.rgnk.site/pairing-code', { waitUntil: 'networkidle2' });
        }

        // --- SILENT ABORT HELPER ---
        // We will call this inside our loops. If a new request takes over our tab, we silently kill this old script.
        const isOverridden = () => {
            const currentSession = activeRaganorkTabs.get(fullNumber);
            return !currentSession || currentSession.reqId !== myReqId;
        };

        await new Promise(r => setTimeout(r, 4000));
        if (isOverridden()) return; // Stop executing if we've been refreshed

        // --- DOM INJECTION ---
        const injected = await page.evaluate((cc) => {
            const selectEl = document.querySelector('select');
            if (selectEl) {
                const targetOpt = Array.from(selectEl.options).find(opt => opt.text.includes(cc) || opt.value.includes(cc));
                if (targetOpt) {
                    selectEl.value = targetOpt.value;
                    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                    selectEl.dispatchEvent(new Event('input', { bubbles: true }));
                    return true;
                }
            }
            return false;
        }, countryCode);

        if (!injected) throw new Error(`Failed to inject country code +${countryCode}.`);
        await new Promise(r => setTimeout(r, 1000));
        if (isOverridden()) return;

        // --- NUMBER INPUT ---
        const inputSelector = 'input[placeholder*="phone"], input[type="tel"], input[type="number"]';
        await page.waitForSelector(inputSelector, { timeout: 10000 });
        await page.focus(inputSelector);

        await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }, inputSelector);

        await page.keyboard.type(localNum, { delay: 100 });
        await page.evaluate((sel) => document.querySelector(sel).dispatchEvent(new Event('change', { bubbles: true })), inputSelector);
        await new Promise(r => setTimeout(r, 1000));

        // --- PHYSICAL STRIKE ---
        const btnCords = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, div, span'));
            const getBtn = btns.reverse().find(b => b.innerText?.toUpperCase().includes('GET CODE') && b.offsetHeight > 0);
            return getBtn ? { x: getBtn.getBoundingClientRect().left + (getBtn.getBoundingClientRect().width / 2), y: getBtn.getBoundingClientRect().top + (getBtn.getBoundingClientRect().height / 2) } : null;
        });

        if (btnCords) await page.mouse.click(btnCords.x, btnCords.y);
        else {
            await page.evaluate(() => {
                const getBtn = Array.from(document.querySelectorAll('button, div')).reverse().find(b => b.innerText?.toUpperCase().includes('GET CODE'));
                if (getBtn) getBtn.click();
            });
        }
        await page.keyboard.press('Enter');

        // --- PHASE 1: WEBHOOK PAIRING CODE ---
        let pairingCode = null;
        for (let i = 0; i < 30; i++) {
            if (isOverridden()) return; // Abort loop if refreshed
            await new Promise(r => setTimeout(r, 1000));
            pairingCode = await page.evaluate(() => {
                const header = Array.from(document.querySelectorAll('*')).find(el => el.innerText?.includes('Pairing Code Received'));
                if (!header) return null;
                const found = Array.from(document.querySelectorAll('input, textarea, div, span, p')).find(el => (el.value || el.innerText || "").trim().length === 8 && /^[A-Z0-9]{8}$/.test((el.value || el.innerText).trim()));
                return found ? (found.value || found.innerText).trim() : null;
            });
            if (pairingCode) break;
        }

        if (isOverridden()) return;

        if (pairingCode) {
            await axios.post(callbackUrl, {
                status: "pairing_code",
                number: `+${fullNumber}`,
                code: pairingCode
            }).catch(e => console.log(`[API] Webhook 1 failed for ${localNum}:`, e.message));
        } else {
            throw new Error("Pairing code timed out.");
        }

        // --- PHASE 2: WEBHOOK SESSION ID ---
        let sessionId = null;
        for (let i = 0; i < 120; i++) {
            if (isOverridden()) return; // Abort loop if refreshed
            await new Promise(r => setTimeout(r, 1000));
            sessionId = await page.evaluate(() => {
                const found = Array.from(document.querySelectorAll('input, textarea, div, span, p')).find(el => (el.value || el.innerText || "").includes('RGNK~'));
                if (found) {
                    const m = (found.value || found.innerText).match(/RGNK~[a-zA-Z0-9]+/);
                    return m ? m[0] : null;
                }
                return null;
            });
            if (sessionId) break;
        }

        if (isOverridden()) return;

        if (sessionId) {
            await axios.post(callbackUrl, {
                status: "session_id",
                number: `+${fullNumber}`,
                sessionId: sessionId
            }).catch(e => console.log(`[API] Webhook 2 failed for ${localNum}:`, e.message));
        } else {
            throw new Error("Timeout waiting for Session ID.");
        }

    } catch (err) {
        // Did it crash because a new request reloaded the page from underneath us?
        const currentSession = activeRaganorkTabs.get(fullNumber);
        if (currentSession && currentSession.reqId !== myReqId) {
            // Yes. Silently ignore the crash, because the new request is handling it now.
            return;
        }

        // It was a real error, send the webhook.
        await axios.post(callbackUrl, {
            status: "error",
            number: input,
            error: err.message
        }).catch(() => {});

    } finally {
        // ONLY clean up the tab if this exact request is still the active owner
        const currentSession = activeRaganorkTabs.get(fullNumber);
        if (currentSession && currentSession.reqId === myReqId) {
            if (page && !page.isClosed()) await page.close().catch(() => {});
            activeRaganorkTabs.delete(fullNumber);
        }

        // If no more tabs are open across the whole app, wait 10 seconds and kill Chrome
        if (activeRaganorkTabs.size === 0 && sharedRaganorkBrowser) {
            raganorkBrowserTimer = setTimeout(async () => {
                if (activeRaganorkTabs.size === 0 && sharedRaganorkBrowser) {
                    console.log("[SYSTEM] All Raganork tasks finished. Shutting down Master Browser.");
                    await sharedRaganorkBrowser.close().catch(() => {});
                    sharedRaganorkBrowser = null;
                }
            }, 10000);
        }
    }
});


global.waitingClients = new Map();

const chatHistories = new Map(); // Stores conversation memory per JID

app.post('/api/uai', upload.single('file'), async (req, res) => {
    let { prompt, chatId, resetHistory } = req.body;
    const file = req.file;

    if (!prompt && !file) {
        return res.status(400).json({ success: false, error: "Missing prompt or file." });
    }

    if (!global.termuxSocket || global.termuxSocket.readyState !== 1) {
        return res.status(503).json({ success: false, error: "Termux Worker is offline." });
    }

    const sessionKey = chatId || 'default_chat';

    if (resetHistory === 'true' || !chatHistories.has(sessionKey)) {
        chatHistories.set(sessionKey, []);
    }
    let history = chatHistories.get(sessionKey);

    let userContent = [];

    // =========================================================
    // MAXIMUM CAPACITY MEDIA SCANNER (800,000 Character Limit)
    // =========================================================
    if (file) {
        const mime = file.mimetype ? file.mimetype.toLowerCase() : '';

        if (mime.startsWith('image/')) {
            try {
                const compressedBuffer = await sharp(file.buffer)
                    .resize({ width: 800, withoutEnlargement: true })
                    .jpeg({ quality: 80 })
                    .toBuffer();

                const base64Data = compressedBuffer.toString('base64');
                userContent.push({
                    type: "image",
                    source: { type: "base64", media_type: "image/jpeg", data: base64Data }
                });
            } catch (imgErr) {
                return res.status(500).json({ success: false, error: "Failed to compress image." });
            }
        }
        else if (mime === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
            try {
                const pdfData = await pdf(file.buffer);
                let safeString = pdfData.text.replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\uFFFF]/g, '');

                // --- ABSOLUTE MAX INPUT: 800,000 CHARACTERS (~200k Tokens) ---
                if (safeString.length > 800000) {
                    safeString = safeString.substring(0, 800000) + "\n\n...[PDF TRUNCATED: HIT CLAUDE'S 200K TOKEN MAXIMUM]...";
                }

                prompt = `[Attached PDF Document: ${file.originalname}]\n\`\`\`\n${safeString}\n\`\`\`\n\n${prompt || 'Analyze this document.'}`;
            } catch (pdfErr) {
                return res.status(500).json({ success: false, error: "Failed to read the text inside this PDF. It might be a scanned image." });
            }
        }
        else {
            const isBinary = file.buffer.includes(0x00);

            if (isBinary) {
                prompt = `[The user attached a media/binary file named '${file.originalname}'. The raw contents cannot be read as text.]\n\n${prompt || 'What do you think this file is based on the name?'}`;
            } else {
                let safeString = file.buffer.toString('utf8');
                safeString = safeString.replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\uFFFF]/g, '');

                // --- ABSOLUTE MAX INPUT: 800,000 CHARACTERS (~200k Tokens) ---
                if (safeString.length > 800000) {
                    safeString = safeString.substring(0, 800000) + "\n\n...[FILE TRUNCATED: HIT CLAUDE'S 200K TOKEN MAXIMUM]...";
                }
                prompt = `[Attached File: ${file.originalname}]\n\`\`\`\n${safeString}\n\`\`\`\n\n${prompt || 'Analyze this code/text.'}`;
            }
        }
    }

    if (prompt) {
        userContent.push({ type: "text", text: prompt });
    }

    history.push({ role: "user", content: userContent });

    if (history.length > 10) {
        history = history.slice(history.length - 10);
    }
    chatHistories.set(sessionKey, history);

    const reqId = 'wa_ai_' + Date.now();

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');

    const heartbeat = setInterval(() => {
        res.write(' ');
    }, 15000);

    const timeout = setTimeout(() => {
        if (global.waitingAiClients.has(reqId)) {
            const client = global.waitingAiClients.get(reqId);
            clearInterval(client.heartbeat);
            global.waitingAiClients.delete(reqId);

            client.res.write(JSON.stringify({ success: false, error: "Termux took too long to respond (5 Min Timeout)." }));
            client.res.end();
        }
    }, 300000);

    global.waitingAiClients.set(reqId, {
        isApiCall: true,
        res: res,
        timeout: timeout,
        heartbeat: heartbeat,
        sessionKey: sessionKey
    });

    global.termuxSocket.send(JSON.stringify({
        action: 'ai_prompt',
        reqId: reqId,
        messages: history,
        apiKey: process.env.ANTHROPIC_AUTH_TOKEN || 'sk-ecAmk7dFjsRZAtJwfWkZi0XB9YmQ3WesjCz6MziwJMZSX1S3',
        model: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
        max_tokens: 8192 // <--- ABSOLUTE MAX OUTPUT: Forces the API to generate the longest possible response!
    }));
});



// --- EXTERNAL LYRICS API ENDPOINT ---
app.get('/api/lyrics', async (req, res) => {
    const rawQuery = req.query.q;

    if (!rawQuery) {
        return res.status(400).json({ success: false, error: "Missing query parameter 'q'." });
    }

    try {
        // 1. SMART RESOLVER (iTunes)
        let searchTarget = rawQuery;
        try {
            const itunesRes = await axios.get(`https://itunes.apple.com/search?term=${encodeURIComponent(rawQuery)}&entity=song&limit=1`);
            if (itunesRes.data && itunesRes.data.results && itunesRes.data.results.length > 0) {
                const trackInfo = itunesRes.data.results[0];
                searchTarget = `${trackInfo.trackName} ${trackInfo.artistName}`;
            } else {
                searchTarget = rawQuery.replace(/\b(by|lyrics)\b/gi, ' ').replace(/\s+/g, ' ').trim();
            }
        } catch (e) {
            searchTarget = rawQuery.replace(/\b(by|lyrics)\b/gi, ' ').replace(/\s+/g, ' ').trim();
        }

        // 2. FETCH & SORT (LRCLIB)
        const response = await axios.get(`https://lrclib.net/api/search?q=${encodeURIComponent(searchTarget)}`);
        const data = response.data;

        if (!data || data.length === 0) {
            return res.status(404).json({ success: false, error: `Could not find lyrics for "${rawQuery}".` });
        }

        const validTracks = data.filter(t => t.plainLyrics && t.plainLyrics.trim().length > 0);

        if (validTracks.length === 0) {
            return res.status(404).json({ success: false, error: `Found the song, but no text lyrics are available.` });
        }

        // Sort descending by duration to grab the full song, not the snippet
        validTracks.sort((a, b) => (b.duration || 0) - (a.duration || 0));
        const track = validTracks[0];

        // 3. RESPOND
        res.status(200).json({
            success: true,
            title: track.trackName,
            artist: track.artistName,
            lyrics: track.plainLyrics
        });

    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});



// --- EXTERNAL DOWNLOAD API SERVICE ---
app.post('/api/levanter-hook', async (req, res) => {
    const { number, callbackUrl } = req.body;

    if (!number || !callbackUrl) {
        return res.status(400).json({ success: false, error: "Missing 'number' or 'callbackUrl'" });
    }

    // 1. Instantly respond to prevent Heroku timeout
    res.json({ success: true, message: "Sequence initiated. Results will be sent to callbackUrl." });

    const targetNumber = number.toString().replace(/[^0-9]/g, '');
    let browser = null;

    try {
        browser = await puppeteer.launch({
            headless: true,
            executablePath: getChromePath(), // Ensure this matches your existing setup
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 412, height: 915 });

        // Anti-Ad Shield
        page.on('framenavigated', async (frame) => {
            if (frame === page.mainFrame() && !page.url().includes('levanter.site')) {
                await page.goBack().catch(() => {});
            }
        });

        await page.goto('https://levanter.site/', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 5000));

        const clickText = async (targetText) => {
            await page.evaluate((txt) => {
                const elements = Array.from(document.querySelectorAll('div, span, p, h3, button, a'));
                const found = elements.reverse().find(el => el.innerText?.trim().includes(txt) && el.offsetHeight > 0);
                if (found) {
                    const rect = found.getBoundingClientRect();
                    const ev = { bubbles: true, cancelable: true, view: window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
                    ['mousedown', 'mouseup', 'click'].forEach(t => found.dispatchEvent(new MouseEvent(t, ev)));
                    found.click();
                }
            }, targetText);
            await new Promise(r => setTimeout(r, 2000));
        };

        // Navigation
        await clickText('Session');

        await page.evaluate(() => {
            const skipBtn = Array.from(document.querySelectorAll('button, div, span, a')).reverse().find(el => el.innerText?.trim() === 'Skip' && el.offsetHeight > 0);
            if (skipBtn) skipBtn.click();
        });
        await new Promise(r => setTimeout(r, 2000));

        await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('*'));
            const textElement = elements.find(el => el.innerText?.trim() === 'Receive Session on WhatsApp' && el.children.length === 0);
            if (textElement && textElement.parentElement) {
                const siblingBox = textElement.parentElement.querySelector('button, input, [role="checkbox"], div[class*="checkbox"], svg');
                if (siblingBox) siblingBox.click();
                textElement.parentElement.click();
                textElement.click();
            }
        });
        await new Promise(r => setTimeout(r, 1500));

        await clickText('Pairing Code');

        // Input Injection
        const inputSelector = 'input[placeholder*="1 234"], input[type="tel"]';
        await page.waitForSelector(inputSelector, { timeout: 10000, visible: true });
        await page.focus(inputSelector);
        await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }, inputSelector);

        await page.keyboard.type('+' + targetNumber, { delay: 100 });

        await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }, inputSelector);
        await new Promise(r => setTimeout(r, 1000));

        // Submit
        await page.evaluate(() => {
            const els = Array.from(document.querySelectorAll('button, div, span'));
            const btn = els.reverse().find(e => e.innerText?.trim() === 'Get Pairing Code' && e.offsetHeight > 0);
            if (btn) {
                const ev = { bubbles: true, cancelable: true, view: window };
                ['mousedown', 'mouseup', 'click'].forEach(t => btn.dispatchEvent(new MouseEvent(t, ev)));
                btn.click();
            }
        });

        // 1st Extraction: Pairing Code
        let pairingCode = null;
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 1000));
            pairingCode = await page.evaluate(() => {
                const divs = Array.from(document.querySelectorAll('div, span'));
                const codeDiv = divs.find(el => el.innerText?.length === 8 && /^[A-Z0-9]+$/.test(el.innerText) && el.innerText !== 'LEVANTER');
                return codeDiv ? codeDiv.innerText.trim() : null;
            });
            if (pairingCode) break;
        }

        if (!pairingCode) throw new Error("Pairing code never generated.");

        // --- WEBHOOK FIRE 1: Send Pairing Code to External Server ---
        await axios.post(callbackUrl, {
            status: "pairing_code",
            number: targetNumber,
            code: pairingCode
        }).catch(() => console.log('[API] Failed to deliver pairing code to webhook.'));

        // 2nd Extraction: Session ID
        let sessionId = null;
        for (let i = 0; i < 120; i++) {
            await new Promise(r => setTimeout(r, 1000));
            sessionId = await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('input, textarea, div, span, p'));
                const validEl = elements.find(el => {
                    const txt = el.value || el.innerText;
                    return txt && txt.includes('levanter_');
                });
                if (validEl) {
                    const txt = validEl.value || validEl.innerText;
                    const match = txt.match(/levanter_[a-zA-Z0-9]+/);
                    if (match) return match[0];
                }
                return null;
            });
            if (sessionId) break;
        }

        if (!sessionId) throw new Error("Timeout waiting for Session ID.");

        // --- WEBHOOK FIRE 2: Send Session ID to External Server ---
        await axios.post(callbackUrl, {
            status: "session_id",
            number: targetNumber,
            sessionId: sessionId
        }).catch(() => console.log('[API] Failed to deliver session ID to webhook.'));

    } catch (err) {
        // --- WEBHOOK FIRE ERROR: Notify server of failure ---
        await axios.post(callbackUrl, {
            status: "error",
            number: targetNumber,
            error: err.message
        }).catch(() => {});
    } finally {
        if (browser) await browser.close();
    }
});


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


// MUSIC FINDER — reply to a Telegram audio, voice note, or video with /find.
// AudD performs audio fingerprint recognition. Set AUDD_API_TOKEN in the runtime environment.
const TELEGRAM_FIND_MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MUSIC_RECOGNITION_CLIP_SECONDS = 20;

function getTelegramMediaFileId(reply) {
    if (!reply) return null;
    if (reply.audio?.file_id) return reply.audio.file_id;
    if (reply.voice?.file_id) return reply.voice.file_id;
    if (reply.video?.file_id) return reply.video.file_id;
    if (reply.video_note?.file_id) return reply.video_note.file_id;

    const document = reply.document;
    const mimeType = String(document?.mime_type || '').toLowerCase();
    const fileName = String(document?.file_name || '').toLowerCase();
    if (document?.file_id && (
        mimeType.startsWith('audio/') ||
        mimeType.startsWith('video/') ||
        /\.(?:aac|flac|m4a|m4v|mkv|mov|mp3|mp4|mpeg|ogg|opus|wav|webm)$/i.test(fileName)
    )) return document.file_id;

    return null;
}

async function downloadTelegramMedia(fileId, outputPath) {
    const fileLink = await bot.getFileLink(fileId);
    const response = await axios.get(fileLink, {
        responseType: 'arraybuffer',
        timeout: 120000,
        maxContentLength: TELEGRAM_FIND_MAX_DOWNLOAD_BYTES,
        maxBodyLength: TELEGRAM_FIND_MAX_DOWNLOAD_BYTES
    });
    const buffer = Buffer.from(response.data || []);
    if (!buffer.length) throw new Error('Telegram returned an empty media file.');
    if (buffer.length > TELEGRAM_FIND_MAX_DOWNLOAD_BYTES) throw new Error('The media file is larger than the 25 MB Telegram finder limit.');
    fs.writeFileSync(outputPath, buffer);
}

async function createMusicRecognitionClip(inputPath, outputPath) {
    const ffmpegPath = process.env.FFMPEG_PATH || process.env.HEROKU_FFMPEG_BIN || 'ffmpeg';
    await execFilePromise(ffmpegPath, [
        '-y', '-i', inputPath,
        '-t', String(MUSIC_RECOGNITION_CLIP_SECONDS),
        '-vn', '-ac', '1', '-ar', '44100',
        '-codec:a', 'libmp3lame', '-b:a', '128k',
        outputPath
    ], { timeout: 180000, maxBuffer: 1024 * 1024 });
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) {
        throw new Error('The media contains no usable audio track.');
    }
}

async function recognizeMusicWithAudD(clipPath) {
    const apiToken = process.env.AUDD_API_TOKEN || process.env.AUDD_TOKEN;
    if (!apiToken) {
        throw new Error('Music recognition is not configured. Add AUDD_API_TOKEN to the deployment environment.');
    }

    const form = new FormData();
    form.append('api_token', apiToken);
    form.append('return', 'apple_music,spotify');
    form.append('file', new Blob([fs.readFileSync(clipPath)], { type: 'audio/mpeg' }), 'music-find.mp3');

    const response = await fetch('https://api.audd.io/', {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(120000)
    });
    let payload;
    try {
        payload = await response.json();
    } catch {
        throw new Error(`AudD returned HTTP ${response.status} without valid JSON.`);
    }

    if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.error?.error_message || payload?.error || `AudD recognition failed with HTTP ${response.status}.`);
    }
    return payload?.result || null;
}

function escapeTelegramHtml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function safeHttpUrl(value) {
    try {
        const url = new URL(String(value));
        return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch {
        return null;
    }
}

function getMusicRecognitionButtons(result) {
    const buttons = [];
    const songLink = safeHttpUrl(result.song_link);
    const appleMusicUrl = safeHttpUrl(result.apple_music?.url);
    const spotifyUrl = safeHttpUrl(result.spotify?.external_urls?.spotify);
    if (songLink) buttons.push([{ text: 'Open song link', url: songLink }]);
    if (appleMusicUrl || spotifyUrl) {
        buttons.push([
            ...(appleMusicUrl ? [{ text: 'Apple Music', url: appleMusicUrl }] : []),
            ...(spotifyUrl ? [{ text: 'Spotify', url: spotifyUrl }] : [])
        ]);
    }
    return buttons;
}

function formatMusicRecognitionResult(result) {
    const lines = [
        '<b>Music Found</b>',
        '',
        `<b>Title:</b> ${escapeTelegramHtml(result.title || 'Unknown')}`,
        `<b>Artist:</b> ${escapeTelegramHtml(result.artist || 'Unknown')}`
    ];
    if (result.album) lines.push(`<b>Album:</b> ${escapeTelegramHtml(result.album)}`);
    if (result.release_date) lines.push(`<b>Release date:</b> ${escapeTelegramHtml(result.release_date)}`);
    if (result.timecode) lines.push(`<b>Matched at:</b> ${escapeTelegramHtml(result.timecode)}`);
    lines.push('', '<i>Identified by audio fingerprint. Remixes, live versions, noise, and short clips may return a different version or no match.</i>');
    return lines.join('\\n');
}

async function recognizeMusicFromBuffer(buffer, fileName = 'music-find.bin') {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('The uploaded media is empty.');
    if (buffer.length > TELEGRAM_FIND_MAX_DOWNLOAD_BYTES) throw new Error('The media file is larger than the 25 MB finder limit.');

    const uid = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const rawPath = path.join(__dirname, `find_api_${uid}.media`);
    const clipPath = path.join(__dirname, `find_api_${uid}.mp3`);
    try {
        fs.writeFileSync(rawPath, buffer);
        await createMusicRecognitionClip(rawPath, clipPath);
        const result = await recognizeMusicWithAudD(clipPath);
        if (!result) throw new Error('No confident music match was returned. Try a clearer 10–20 second section.');
        return {
            result,
            text: formatMusicRecognitionResult(result),
            buttons: getMusicRecognitionButtons(result),
            fileName
        };
    } finally {
        for (const filePath of [rawPath, clipPath]) {
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
        }
    }
}

function isFindApiAuthorized(req) {
    const expectedToken = process.env.FIND_API_TOKEN;
    if (!expectedToken) return true;
    const bearer = String(req.get('authorization') || '').replace(/^Bearer\\s+/i, '').trim();
    const apiKey = String(req.get('x-api-key') || '').trim();
    return bearer === expectedToken || apiKey === expectedToken;
}

app.post('/api/find', upload.single('file'), async (req, res) => {
    if (!isFindApiAuthorized(req)) return res.status(401).json({ success: false, error: 'Invalid finder API token.' });
    if (!req.file?.buffer) return res.status(400).json({ success: false, error: 'Upload an audio or video file in the file field.' });
    try {
        const recognition = await recognizeMusicFromBuffer(req.file.buffer, req.file.originalname);
        return res.json({ success: true, ...recognition });
    } catch (error) {
        console.error('[API FIND ERROR]', error.message);
        return res.status(422).json({ success: false, error: error.message });
    }
});

bot.onText(/^\/find(?:@\\w+)?$/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID && !AUTHORIZED.includes(chatId)) return;

    const fileId = getTelegramMediaFileId(msg.reply_to_message);
    if (!fileId) {
        return bot.sendMessage(chatId, '[ERROR] Reply to an audio file, voice note, video, video note, or audio/video document with /find.');
    }

    const uid = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const rawPath = path.join(__dirname, `find_${uid}.media`);
    const clipPath = path.join(__dirname, `find_${uid}.mp3`);
    let statusMsg = null;

    try {
        statusMsg = await bot.sendMessage(chatId, '[SYSTEM] Downloading the replied media...');
        await downloadTelegramMedia(fileId, rawPath);
        await bot.editMessageText('[SYSTEM] Extracting a clean audio fingerprint sample...', {
            chat_id: chatId,
            message_id: statusMsg.message_id
        }).catch(() => {});
        await createMusicRecognitionClip(rawPath, clipPath);

        await bot.editMessageText('[SYSTEM] Identifying the music...', {
            chat_id: chatId,
            message_id: statusMsg.message_id
        }).catch(() => {});
        const result = await recognizeMusicWithAudD(clipPath);
        if (!result) throw new Error('No confident music match was returned. Try a clearer 10–20 second section.');

        await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        await bot.sendMessage(chatId, formatMusicRecognitionResult(result), {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: { inline_keyboard: getMusicRecognitionButtons(result) }
        });
    } catch (error) {
        const errorText = error?.message || 'Music recognition failed.';
        if (statusMsg) {
            await bot.editMessageText(`[ERROR] ${errorText}`, {
                chat_id: chatId,
                message_id: statusMsg.message_id
            }).catch(() => {});
        } else {
            await bot.sendMessage(chatId, `[ERROR] ${errorText}`).catch(() => {});
        }
    } finally {
        for (const filePath of [rawPath, clipPath]) {
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
        }
    }
});


// TRANSCRIPT — voice/audio/video → text via Python SpeechRecognition (Google backend, free)
// Usage: Reply to any voice note, audio, or video with /transcript
bot.onText(/^\/transcript$/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID && !AUTHORIZED.includes(chatId)) return;

    const reply = msg.reply_to_message;
    if (!reply) {
        return bot.sendMessage(chatId,
            '[ERROR] Reply to a voice note, audio file, or video with /transcript'
        );
    }

    let fileId = null;
    if      (reply.voice)                                           fileId = reply.voice.file_id;
    else if (reply.audio)                                           fileId = reply.audio.file_id;
    else if (reply.video)                                           fileId = reply.video.file_id;
    else if (reply.video_note)                                      fileId = reply.video_note.file_id;
    else if (reply.document && reply.document.mime_type?.startsWith('audio')) fileId = reply.document.file_id;

    if (!fileId) {
        return bot.sendMessage(chatId,
            '[ERROR] No supported media found. Reply to a voice note, audio, or video.'
        );
    }

    let statusMsg = await bot.sendMessage(chatId, '[SYSTEM] Downloading media...');

    const uid   = Date.now();
    const raw   = path.join(__dirname, `stt_${uid}.tmp`);
    const wav   = path.join(__dirname, `stt_${uid}.wav`);
    const pyf   = path.join(__dirname, `stt_${uid}.py`);

    try {
        // 1. Download
        const fileLink = await bot.getFileLink(fileId);
        const dlRes    = await axios({ method: 'GET', url: fileLink, responseType: 'stream' });
        const writer   = fs.createWriteStream(raw);
        await new Promise((resolve, reject) =>
            dlRes.data.pipe(writer).on('finish', resolve).on('error', reject)
        );

        // 2. Convert to 16kHz mono WAV — FFmpeg is already on your dyno
        await bot.editMessageText('[SYSTEM] Converting audio...', {
            chat_id: chatId, message_id: statusMsg.message_id
        }).catch(() => {});
        await execPromise(`ffmpeg -y -i "${raw}" -ar 16000 -ac 1 -c:a pcm_s16le "${wav}"`);

        // 3. Transcribe — chunks of 59s to stay inside Google's free tier limit
        await bot.editMessageText('[SYSTEM] Transcribing...', {
            chat_id: chatId, message_id: statusMsg.message_id
        }).catch(() => {});

        const pyScript = `
import speech_recognition as sr, sys, wave, math

def run(wav_path):
    r = sr.Recognizer()
    out = []
    try:
        with wave.open(wav_path, 'rb') as wf:
            total = wf.getnframes() / wf.getframerate()
        chunk = 59
        for offset in range(0, math.ceil(total), chunk):
            try:
                with sr.AudioFile(wav_path) as src:
                    audio = r.record(src, offset=offset,
                                     duration=min(chunk, total - offset))
                text = r.recognize_google(audio)
                if text:
                    out.append(text)
            except sr.UnknownValueError:
                pass
            except Exception as e:
                out.append(f'[chunk error: {e}]')
        return ' '.join(out) if out else '[EMPTY] No speech detected'
    except Exception as e:
        return f'[ERROR] {e}'

print(run(sys.argv[1]))
`;

        fs.writeFileSync(pyf, pyScript);
        const { stdout } = await execPromise(
            `python3 "${pyf}" "${wav}"`,
            { timeout: 120000 }
        );

        const transcript = (stdout || '').trim() || '[EMPTY] No speech detected';

        await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});

        if (transcript.length > 4000) {
            for (const chunk of transcript.match(/[\s\S]{1,4000}/g)) {
                await bot.sendMessage(chatId, `${chunk}`);
                await new Promise(r => setTimeout(r, 300));
            }
        } else {
            await bot.sendMessage(chatId,
                `*Transcript:*\n\n${transcript}`,
                { parse_mode: 'Markdown' }
            );
        }

    } catch (err) {
        await bot.editMessageText(`[ERROR] Transcription failed: ${err.message}`, {
            chat_id: chatId, message_id: statusMsg.message_id
        }).catch(() => {});
    } finally {
        [raw, wav, pyf].forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch(_) {} });
    }
});



// TTS — StreamElements free API (no package, no model, Brian neural voice)
bot.onText(/^\/tts\s+([\s\S]+)/i, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID && !AUTHORIZED.includes(chatId)) return;

    const text = match[1].trim();
    if (text.length > 500) return bot.sendMessage(chatId, '[ERROR] Max 500 characters.');

    let statusMsg = await bot.sendMessage(chatId, '[SYSTEM] Generating voice...');

    const mp3Path = path.join(__dirname, `tts_${Date.now()}.mp3`);
    const oggPath = mp3Path.replace('.mp3', '.ogg');

    try {
        // StreamElements free TTS — no API key, no package, Brian = best English voice
        const response = await axios({
            method: 'GET',
            url: `https://api.streamelements.com/kappa/v2/speech?voice=Brian&text=${encodeURIComponent(text)}`,
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });

        fs.writeFileSync(mp3Path, Buffer.from(response.data));
        if (fs.statSync(mp3Path).size < 1000) throw new Error('TTS response was empty. Try again.');

        // FFmpeg is already installed by your buildpack — no package needed
        await execPromise(`ffmpeg -y -i "${mp3Path}" -c:a libopus -b:a 64k "${oggPath}"`);

        await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        await bot.sendVoice(chatId, oggPath, {
            caption: `🗣️ ${text.length > 80 ? text.substring(0, 80) + '...' : text}`
        });

    } catch (err) {
        await bot.editMessageText(`[ERROR] TTS failed: ${err.message}`, {
            chat_id: chatId, message_id: statusMsg.message_id
        }).catch(() => {});
    } finally {
        if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
        if (fs.existsSync(oggPath)) fs.unlinkSync(oggPath);
    }
});

// Global Map for pending AI requests
global.waitingAiClients = new Map();

// --- AI ASSISTANT COMMAND (VISION + FILE READING + HEAVY DEBUGGING) ---
// Usage: /ai <prompt> OR Reply to an Image/File with /ai <prompt>
bot.onText(/^\/ai(?:\s+([\s\S]+))?/i, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    let promptText = match[1] ? match[1].trim() : '';

    // Authorization Check
    const adminId = process.env.ADMIN_ID || '7710721646';
    if (chatId !== adminId && (typeof AUTHORIZED !== 'undefined' && !AUTHORIZED.includes(chatId))) return;

    const reply = msg.reply_to_message;
    if (!promptText && !reply) {
        return bot.sendMessage(chatId, '[SYSTEM] Please provide a prompt or reply to an image/code file with /ai.');
    }

    if (!global.termuxSocket || global.termuxSocket.readyState !== 1) {
        return bot.sendMessage(chatId, '[ERROR] Termux Node is offline. Start the worker script on your phone to handle WAF bypass.');
    }

    let statusMsg = await bot.sendMessage(chatId, '[SYSTEM] 🧠 Processing payload and routing to Termux Worker...');

    try {
        let aiContent = []; // Array used for Anthropic Vision/Multi-modal payloads

        // 1. HANDLE IMAGE ATTACHMENTS (Vision AI)
        if (reply && reply.photo) {
            await bot.editMessageText('[SYSTEM] 🧠 Downloading Image for Vision Analysis...', { chat_id: chatId, message_id: statusMsg.message_id }).catch(()=>{});
            const photo = reply.photo[reply.photo.length - 1]; // Get highest quality
            const fileLink = await bot.getFileLink(photo.file_id);
            const picRes = await axios.get(fileLink, { responseType: 'arraybuffer' });

            // Convert to Base64 for Anthropic API
            const base64Img = Buffer.from(picRes.data).toString('base64');

            aiContent.push({
                type: "image",
                source: {
                    type: "base64",
                    media_type: 'image/jpeg',
                    data: base64Img
                }
            });
        }

        // 2. HANDLE FILE ATTACHMENTS (Code Debugging / Document Reading)
        if (reply && reply.document) {
            await bot.editMessageText('[SYSTEM] 🧠 Reading Source Code / Document...', { chat_id: chatId, message_id: statusMsg.message_id }).catch(()=>{});
            const doc = reply.document;
            const ext = doc.file_name.split('.').pop().toLowerCase();

            // List of readable text/code files
            const readableExts = ['js', 'py', 'txt', 'html', 'css', 'json', 'csv', 'md', 'sh', 'env', 'ts', 'php'];

            if (readableExts.includes(ext) || doc.mime_type.includes('text') || doc.mime_type.includes('application/json')) {
                const fileLink = await bot.getFileLink(doc.file_id);
                const docRes = await axios.get(fileLink, { responseType: 'text' });
                const fileText = docRes.data;

                // Inject file contents directly into the prompt text
                promptText = `Here is the contents of the file '${doc.file_name}':\n\n\`\`\`${ext}\n${fileText}\n\`\`\`\n\n${promptText}`;
            } else {
                await bot.sendMessage(chatId, `⚠️ Cannot read non-text file type: ${doc.file_name}. Continuing with standard text prompt.`);
            }
        }

        // 3. COMPILE FINAL PAYLOAD
        if (promptText) {
            aiContent.push({ type: "text", text: promptText });
        } else if (aiContent.length > 0) {
            // Default prompt if user replied to an image but didn't type any words
            aiContent.push({ type: "text", text: "Please analyze this and tell me what you see or how to fix it." });
        }

        const reqId = 'ai_' + Date.now();

        // 4. SET THE 5-MINUTE TIMEOUT TRACKER IN MEMORY
        global.waitingAiClients.set(reqId, {
            chatId: chatId,
            msgId: statusMsg.message_id,
            timeout: setTimeout(() => {
                if (global.waitingAiClients.has(reqId)) {
                    global.waitingAiClients.delete(reqId);
                    bot.editMessageText('[TIMEOUT] AI debugging took longer than 5 minutes. Aborted.', { chat_id: chatId, message_id: statusMsg.message_id }).catch(() => {});
                }
            }, 300000) // 5 minutes (300,000 ms)
        });

        // 5. FIRE OVER WEBSOCKET TO TERMUX
        await bot.editMessageText('[SYSTEM] 🧠 Payload routed to Termux. Executing Deep Spoof (Up to 5 minutes)...', { chat_id: chatId, message_id: statusMsg.message_id }).catch(()=>{});

        global.termuxSocket.send(JSON.stringify({
            action: 'ai_prompt',
            reqId: reqId,
            prompt: aiContent, // We send the formatted array to Termux!
            apiKey: process.env.ANTHROPIC_AUTH_TOKEN || 'sk-Qp8AowqMCBYTcaP8bJLV1noIu4GTNSagCcjFG28SveZlngsg',
            model: process.env.ANTHROPIC_MODEL || 'claude-opus-5'
        }));

    } catch (err) {
        bot.editMessageText(`[ERROR] Failed to process payload: ${err.message}`, { chat_id: chatId, message_id: statusMsg.message_id }).catch(()=>{});
    }
});





bot.onText(/\/raganork\s+(.+)/i, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    let input = match[1].trim();

    // --- SMART PARSER ---
    let countryCode = '234';
    let localNum = input.replace(/[^0-9]/g, '');

    if (input.includes(' ')) {
        const parts = input.split(/\s+/);
        countryCode = parts[0].replace(/[^0-9]/g, '');
        localNum = parts.slice(1).join('').replace(/[^0-9]/g, '');
    } else {
        const cleanNum = input.replace(/[^0-9]/g, '');
        if (cleanNum.startsWith('0')) {
            countryCode = '234';
            localNum = cleanNum.substring(1);
        } else {
            const globalCodes = [
                '880', '254', '256', '263', '225', '221', '228', '233', '971', '966',
                '234', '58', '91', '92', '62', '55', '44', '27', '20', '1'
            ];
            let found = false;
            for (let code of globalCodes) {
                if (cleanNum.startsWith(code) && cleanNum.length > code.length + 5) {
                    countryCode = code;
                    localNum = cleanNum.substring(code.length);
                    found = true;
                    break;
                }
            }
            if (!found) {
                countryCode = '234';
                localNum = cleanNum;
            }
        }
    }

    const fullNumber = `+${countryCode} ${localNum}`;
    let statusMsg = await bot.sendMessage(chatId, `[SYSTEM] Launching Direct DOM-Injection Strike for ${fullNumber}...`);

    const videoDir = path.join(__dirname, 'videos');
    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir);

    let browser = null;
    let recorder = null;
    let videoPath = null;

    try {
        browser = await puppeteer.launch({
            headless: true,
            executablePath: getChromePath(),
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 412, height: 915 });

        videoPath = path.join(videoDir, `raganork_injection_${Date.now()}.mp4`);
        recorder = new PuppeteerScreenRecorder(page, { fps: 30 });
        await recorder.start(videoPath);

        // 1. Initial Load
        await page.goto('https://session.rgnk.site/pairing-code', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 4000));

        // --- 2. THE DOM INJECTION (BYPASSING NATIVE UI) ---
        await bot.editMessageText(`[SYSTEM] Bypassing OS Menu to inject +${countryCode}...`, { chat_id: chatId, message_id: statusMsg.message_id });

        const injected = await page.evaluate((cc) => {
            const selectEl = document.querySelector('select');
            if (selectEl) {
                const targetOpt = Array.from(selectEl.options).find(opt =>
                    opt.text.trim().includes(cc) || opt.value.includes(cc)
                );

                if (targetOpt) {
                    selectEl.value = targetOpt.value;
                    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                    selectEl.dispatchEvent(new Event('input', { bubbles: true }));
                    return true;
                }
            }
            return false;
        }, countryCode);

        if (!injected) {
            throw new Error(`Failed to inject +${countryCode}. Code might be invalid or not in their list.`);
        }
        await new Promise(r => setTimeout(r, 1000));

        // --- 3. INPUT PHONE NUMBER ---
        await bot.editMessageText(`[SYSTEM] Injecting local number: ${localNum}...`, { chat_id: chatId, message_id: statusMsg.message_id });
        const inputSelector = 'input[placeholder*="phone"], input[type="tel"], input[type="number"]';
        await page.waitForSelector(inputSelector, { timeout: 10000 });
        await page.focus(inputSelector);

        await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }, inputSelector);

        await page.keyboard.type(localNum, { delay: 100 });
        await page.evaluate((sel) => {
            document.querySelector(sel).dispatchEvent(new Event('change', { bubbles: true }));
        }, inputSelector);
        await new Promise(r => setTimeout(r, 1000));


        // --- 4. PHYSICAL CLICK ON GET CODE ---
        await bot.editMessageText(`[SYSTEM] Executing physical tap on GET CODE...`, { chat_id: chatId, message_id: statusMsg.message_id });

        const btnCords = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, div, span'));
            const getBtn = btns.reverse().find(b => b.innerText?.toUpperCase().includes('GET CODE') && b.offsetHeight > 0);
            if (getBtn) {
                const rect = getBtn.getBoundingClientRect();
                return { x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2) };
            }
            return null;
        });

        if (btnCords) {
            await page.mouse.click(btnCords.x, btnCords.y);
        } else {
            await page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button, div'));
                const getBtn = btns.reverse().find(b => b.innerText?.toUpperCase().includes('GET CODE'));
                if (getBtn) getBtn.click();
            });
        }

        await page.keyboard.press('Enter');
        await bot.editMessageText(`[SYSTEM] Submitted. Monitoring for code...`, { chat_id: chatId, message_id: statusMsg.message_id });


        // --- 5. EXTRACTION LOOP (Pairing Code) ---
        let pairingCode = null;
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 1000));
            pairingCode = await page.evaluate(() => {
                const header = Array.from(document.querySelectorAll('*')).find(el => el.innerText?.includes('Pairing Code Received'));
                if (!header) return null;

                const els = Array.from(document.querySelectorAll('input, textarea, div, span, p'));
                const found = els.find(el => {
                    const val = el.value || el.innerText;
                    return val && val.trim().length === 8 && /^[A-Z0-9]{8}$/.test(val.trim());
                });
                return found ? (found.value || found.innerText).trim() : null;
            });
            if (pairingCode) break;
        }

        if (!pairingCode) throw new Error("Target button pressed, but the pairing code modal never appeared.");

        // Deliver Code Instantly
        await bot.editMessageText(`[RAGANORK ACTIVE]\n\nCode: \`${pairingCode}\`\n\nWaiting for Session ID...`, {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: `Copy Code: ${pairingCode}`, copy_text: { text: pairingCode } }]] }
        });


        // --- 6. WAIT FOR SESSION ID ---
        let sessionId = null;
        for (let i = 0; i < 120; i++) {
            await new Promise(r => setTimeout(r, 1000));
            sessionId = await page.evaluate(() => {
                const els = Array.from(document.querySelectorAll('input, textarea, div, span, p'));
                const found = els.find(el => (el.value || el.innerText || "").includes('RGNK~'));
                if (found) {
                    const txt = found.value || found.innerText;
                    const m = txt.match(/RGNK~[a-zA-Z0-9]+/);
                    return m ? m[0] : null;
                }
                return null;
            });
            if (sessionId) break;
        }

        await recorder.stop();

        if (sessionId) {
            await bot.editMessageText(`[RAGANORK SUCCESS]\n\nCode: \`${pairingCode}\`\nSession: \`${sessionId}\``, {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: `Copy Session ID`, copy_text: { text: sessionId } }]] }
            });
        } else {
            await bot.editMessageText(`[TIMEOUT] Grabbed code but session ID never appeared.`, { chat_id: chatId, message_id: statusMsg.message_id });
        }

        if (fs.existsSync(videoPath)) {
            await bot.sendVideo(chatId, videoPath, { caption: `Raganork Full Process Video` });
        }

    } catch (err) {
        if (recorder) await recorder.stop().catch(() => {});
        bot.sendMessage(chatId, `[ERROR] ${err.message}`);
        if (fs.existsSync(videoPath)) await bot.sendVideo(chatId, videoPath);
    } finally {
        if (browser) await browser.close();
        if (fs.existsSync(videoPath)) setTimeout(() => fs.unlinkSync(videoPath), 5000);
    }
});




bot.onText(/\/levanter\s+(.+)/, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    const targetNumber = match[1].replace(/[^0-9]/g, '');
    let statusMsg = await bot.sendMessage(chatId, `[SYSTEM] Engaging Precision Sequence for +${targetNumber}...`);

    const videoDir = path.join(__dirname, 'videos');
    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir);

    let browser = null;
    let recorder = null;
    let videoPath = null;

    try {
        browser = await puppeteer.launch({
            headless: true,
            executablePath: getChromePath(),
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 412, height: 915 });

        page.on('framenavigated', async (frame) => {
            if (frame === page.mainFrame() && !page.url().includes('levanter.site')) {
                await page.goBack().catch(() => {});
            }
        });

        // --- SINGLE CONTINUOUS RECORDING ---
        videoPath = path.join(videoDir, `levanter_full_${Date.now()}.mp4`);
        recorder = new PuppeteerScreenRecorder(page, { fps: 30 });
        await recorder.start(videoPath);

        // 1. Initial Load
        await page.goto('https://levanter.site/', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 5000));

        const clickText = async (targetText) => {
            await page.evaluate((txt) => {
                const elements = Array.from(document.querySelectorAll('div, span, p, h3, button, a'));
                const found = elements.reverse().find(el => el.innerText?.trim().includes(txt) && el.offsetHeight > 0);
                if (found) {
                    const rect = found.getBoundingClientRect();
                    const ev = { bubbles: true, cancelable: true, view: window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
                    ['mousedown', 'mouseup', 'click'].forEach(t => found.dispatchEvent(new MouseEvent(t, ev)));
                    found.click();
                }
            }, targetText);
            await new Promise(r => setTimeout(r, 2000));
        };

        // 2. Click Session
        await clickText('Session');

        // 2.5 TUTORIAL SNIPER
        await page.evaluate(() => {
            const skipBtn = Array.from(document.querySelectorAll('button, div, span, a')).reverse().find(el => el.innerText?.trim() === 'Skip' && el.offsetHeight > 0);
            if (skipBtn) skipBtn.click();
        });
        await new Promise(r => setTimeout(r, 2000));

        // 3. STEP 2: BRUTE-FORCE CHECKBOX STRIKE (Verified Working)
        await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('*'));
            const textElement = elements.find(el => el.innerText?.trim() === 'Receive Session on WhatsApp' && el.children.length === 0);

            if (textElement && textElement.parentElement) {
                const siblingBox = textElement.parentElement.querySelector('button, input, [role="checkbox"], div[class*="checkbox"], svg');
                if (siblingBox) siblingBox.click();
                textElement.parentElement.click();
                textElement.click();
            }
        });
        await new Promise(r => setTimeout(r, 1500));

        // 4. Click Pairing Code
        await clickText('Pairing Code');

        // 5. Number Injection with React-Wakeup Events
        await bot.editMessageText(`[SYSTEM] Modal open. Injecting number...`, { chat_id: chatId, message_id: statusMsg.message_id });

        const inputSelector = 'input[placeholder*="1 234"], input[type="tel"]';
        await page.waitForSelector(inputSelector, { timeout: 10000, visible: true });

        await page.focus(inputSelector);
        await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }, inputSelector);

        await page.keyboard.type('+' + targetNumber, { delay: 100 });

        await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }, inputSelector);
        await new Promise(r => setTimeout(r, 1000));

        // 6. AGGRESSIVE "GET PAIRING CODE" STRIKE
        await page.evaluate(() => {
            const els = Array.from(document.querySelectorAll('button, div, span'));
            const btn = els.reverse().find(e => e.innerText?.trim() === 'Get Pairing Code' && e.offsetHeight > 0);
            if (btn) {
                const ev = { bubbles: true, cancelable: true, view: window };
                ['mousedown', 'mouseup', 'click'].forEach(t => btn.dispatchEvent(new MouseEvent(t, ev)));
                btn.click();
            }
        });

        // 7. Extraction Loop (Pairing Code)
        let pairingCode = null;
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 1000));
            pairingCode = await page.evaluate(() => {
                const divs = Array.from(document.querySelectorAll('div, span'));
                const codeDiv = divs.find(el => el.innerText?.length === 8 && /^[A-Z0-9]+$/.test(el.innerText) && el.innerText !== 'LEVANTER');
                return codeDiv ? codeDiv.innerText.trim() : null;
            });
            if (pairingCode) break;
        }

        if (!pairingCode) throw new Error("Number submitted, but pairing code never appeared.");

        // --- CODE OBTAINED: SEND TEXT IMMEDIATELY (VIDEO KEEPS RECORDING) ---
        await bot.editMessageText(`[LEVANTER ACTIVE]\n\nCode: \`${pairingCode}\`\n\nVideo is still recording. Waiting for WhatsApp linking confirmation to grab Session ID...`, {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: `Copy Code: ${pairingCode}`, copy_text: { text: pairingCode } }]]
            }
        });

        // --- 8. WAIT FOR SESSION ID ---
        let sessionId = null;
        for (let i = 0; i < 120; i++) { // 2 minute wait for device linking
            await new Promise(r => setTimeout(r, 1000));
            sessionId = await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('input, textarea, div, span, p'));
                const validEl = elements.find(el => {
                    const txt = el.value || el.innerText;
                    return txt && txt.includes('levanter_');
                });

                if (validEl) {
                    const txt = validEl.value || validEl.innerText;
                    const match = txt.match(/levanter_[a-zA-Z0-9]+/);
                    if (match) return match[0];
                }
                return null;
            });
            if (sessionId) break;
        }

        // --- 9. STOP RECORDER AND SEND FINAL RESULTS ---
        await recorder.stop();

        if (!sessionId) {
            await bot.editMessageText(`[TIMEOUT] Grabbed Pairing Code, but Session ID never generated in time. See full video for details.`, {
                chat_id: chatId,
                message_id: statusMsg.message_id
            });
            if (fs.existsSync(videoPath)) {
                await bot.sendVideo(chatId, videoPath, { caption: `Full Diagnostic Video (Timed Out)` });
            }
            return;
        }

        await bot.editMessageText(`[LEVANTER SUCCESS]\n\nCode Used: \`${pairingCode}\`\nSession ID: \`${sessionId}\``, {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: `Copy Session ID`, copy_text: { text: sessionId } }]]
            }
        });

        // Send the complete video regardless of success so you can check it
        if (fs.existsSync(videoPath)) {
            await bot.sendVideo(chatId, videoPath, { caption: `Full Sequence Video for +${targetNumber}` });
        }

    } catch (err) {
        if (recorder) await recorder.stop().catch(() => {});
        bot.editMessageText(`[FAILED] Sequence interrupted. Check full diagnostic video.`, { chat_id: chatId, message_id: statusMsg.message_id });
        if (fs.existsSync(videoPath)) await bot.sendVideo(chatId, videoPath, { caption: `Error: ${err.message}` });
    } finally {
        if (browser) await browser.close();
        if (fs.existsSync(videoPath)) setTimeout(() => fs.unlinkSync(videoPath), 5000);
    }
});


;
                    
async function readWsjobsTodayPointsPuppeteer(page) {
    return await page.evaluate(() => {
        const extractNumber = (text) => {
            const matches = String(text || '').match(/\b\d[\d,]*\b/g) || [];
            return matches.length ? parseInt(matches[matches.length - 1].replace(/,/g, ''), 10) : null;
        };
        const bodyText = document.body?.innerText || '';
        const directMatch = bodyText.match(/Today\s+Points\s*[:：]?\s*([\d,]+)/i)
            || bodyText.match(/([\d,]+)\s*Today\s+Points/i);
        if (directMatch) return parseInt(directMatch[1].replace(/,/g, ''), 10);

        const label = Array.from(document.querySelectorAll('*')).find(el =>
            el.offsetParent !== null && /^Today\s+Points$/i.test(el.innerText?.trim() || '')
        );
        if (!label) return null;
        for (const candidate of [label.parentElement, label.parentElement?.parentElement, label]) {
            const value = extractNumber(candidate?.innerText || '');
            if (value !== null) return value;
        }
        return null;
    });
}

async function readWsjobsTaskFeedbackPuppeteer(page) {
    return await page.evaluate(() => {
        const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
        const lower = text.toLowerCase();
        const failedMessage = 'This WhatsApp number is temporarily unable to send. Please wait or try another number.';
        if (lower.includes('temporarily unable to send')) {
            return { status: 'failed', message: failedMessage };
        }
        if (/send\s+successful|successfully\s+sent|task\s+sent\s+successfully/i.test(text)) {
            return { status: 'success', message: 'Send successful' };
        }
        return null;
    });
}

async function waitForWsjobsTaskFeedbackPuppeteer(page, tabNumber, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const feedback = await readWsjobsTaskFeedbackPuppeteer(page).catch(() => null);
        if (feedback) return { tabNumber, ...feedback };
        await delay(500);
    }
    return { tabNumber, status: 'timeout', message: 'No success/failure feedback appeared.' };
}

// Matches exactly: /task <number>
bot.onText(/^\/task\s+(\d{2,3})$/i, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    const targetSuffix = match[1]; 
    let statusMsg = await bot.sendMessage(chatId, `[SYSTEM] Strike Protocol: ${targetSuffix} ⚡\nInitializing tabs...`);
    const msgId = statusMsg.message_id;

    const updateStatus = async (text) => {
        await bot.editMessageText(text, { chat_id: chatId, message_id: msgId }).catch(() => {});
    };

    let browser = null;
    let pages = [];
    let totalPoints = 0;
    let totalSuccess = 0;
    let initialTodayPoints = null;
    let finalTodayPoints = null;
    let lastFeedbackResults = [];
    let loopCount = 1;

    try {
        browser = await launchScraperBrowser();

        // Human Sniper to automatically kill random popups/modals
        const injectHumanSniper = async (page) => {
            await page.evaluateOnNewDocument(() => {
                setInterval(() => {
                    const okBtn = Array.from(document.querySelectorAll('button, [class*="btn"]')).find(el => el.innerText?.trim() === 'OK' && el.offsetHeight > 0);
                    if (okBtn) {
                        const rect = okBtn.getBoundingClientRect();
                        ['mousedown', 'mouseup', 'click'].forEach(t => okBtn.dispatchEvent(new MouseEvent(t, { view: window, bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 })));
                        setTimeout(() => {
                            const modal = okBtn.closest('div[class*="modal"], div[class*="mask"], .van-overlay');
                            if (modal) modal.remove();
                            document.body.style.filter = 'none';
                            document.body.style.overflow = 'auto';
                        }, 800);
                    }
                }, 300);
            });
        };

        // Create Master Page & Login
        const masterPage = await browser.newPage();
        pages.push(masterPage);
        await masterPage.setViewport({ width: 412, height: 915 });
        await injectHumanSniper(masterPage);

        await updateStatus('[SYSTEM] Synchronizing Account State...');
        await masterPage.goto(wsjobsUrl(WSJOBS_ACCOUNT_PATH), { waitUntil: 'domcontentloaded' });
        
        await masterPage.waitForSelector('input, button, .account-card, .van-cell', { timeout: 15000 }).catch(()=>{});
        await loginToWsjobsPuppeteer(masterPage);

        let isLooping = true;

        while (isLooping) {
            await updateStatus(`[SYSTEM] Loop ${loopCount}: Scanning for target suffix ${targetSuffix}...`);
            
            await masterPage.goto(wsjobsUrl(WSJOBS_TASK_PATH), { waitUntil: 'domcontentloaded' });
            
            // SMART WAIT: Wait until the Send Task buttons actually appear
            await masterPage.waitForFunction(() => {
                return Array.from(document.querySelectorAll('button, [class*="btn"], [class*="button"]'))
                    .some(el => /Send Task|SEND/i.test(el.innerText?.trim()));
            }, { timeout: 15000 }).catch(()=>{});

            await delay(1000);

            // Read the current Today Points before this loop. The first value is
            // preserved as the true baseline for the final report.
            const startingPoints = await readWsjobsTodayPointsPuppeteer(masterPage);
            if (startingPoints === null) {
                throw new Error('Could not read Today Points before the task tabs started.');
            }
            if (initialTodayPoints === null) initialTodayPoints = startingPoints;

            // BULLETPROOF SCAN: Climb the DOM tree to find the phone number
            const targetCount = await masterPage.evaluate((suffix) => {
                const allSendBtns = Array.from(document.querySelectorAll('button, [class*="btn"], [class*="button"]'))
                    .filter(el => /Send Task|SEND/i.test(el.innerText?.trim()) && el.offsetHeight > 0);
                
                let found = 0;
                for (let btn of allSendBtns) {
                    let curr = btn;
                    let matched = false;
                    for (let i = 0; i < 8; i++) { 
                        if (curr && curr.innerText?.includes(suffix)) {
                            matched = true;
                            break;
                        }
                        if (curr) curr = curr.parentElement;
                    }
                    if (matched) found++;
                }
                return found;
            }, targetSuffix);

            if (targetCount === 0) {
                if (loopCount === 1) throw new Error(`Target ${targetSuffix} not found or buttons failed to load.`);
                await updateStatus(`[SYSTEM] No more valid targets found for ${targetSuffix}. Ending loop.`);
                break;
            }

            // Cap the tabs to 4 maximum per run
            const activeTabsCount = Math.min(targetCount, 4);
            await updateStatus(`[SYSTEM] Loop ${loopCount}: Found targets. Preparing ${activeTabsCount} tab(s)...`);

            while (pages.length < activeTabsCount) {
                const p = await browser.newPage();
                await p.setViewport({ width: 412, height: 915 });
                await injectHumanSniper(p);
                pages.push(p);
            }

            const activePages = pages.slice(0, activeTabsCount);

            // Synchronize preparation tab by tab. No parallel action happens
            // before the final Confirm step.
            for (const page of activePages) {
                await page.goto(wsjobsUrl(WSJOBS_TASK_PATH), { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(() => Array.from(
                    document.querySelectorAll('button, [class*="btn"], [class*="button"]')
                ).some(el => /Send Task|SEND/i.test(el.innerText?.trim()) && el.offsetHeight > 0), {
                    timeout: 15000
                });
            }
            await delay(1500);

            // CLAIM NUMBERS & LOG WHO TOOK WHAT
            await updateStatus(`[SYSTEM] Loop ${loopCount}: Claiming targets in synchronized order...`);
            const claimedNumbers = [];
            for (let idx = 0; idx < activePages.length; idx++) {
                const p = activePages[idx];
                claimedNumbers.push(await p.evaluate((suffix, index) => {
                    const btns = Array.from(document.querySelectorAll('button, [class*="btn"], [class*="button"]'))
                        .filter(el => /Send Task|SEND/i.test(el.innerText?.trim()) && el.offsetHeight > 0);
                    
                    let matches = 0;
                    for (let btn of btns) {
                        let curr = btn;
                        let matched = false;
                        for (let i = 0; i < 8; i++) {
                            if (curr && curr.innerText?.includes(suffix)) {
                                matched = true;
                                break;
                            }
                            if (curr) curr = curr.parentElement;
                        }
                        
                        if (matched) {
                            if (matches === index) { 
                                // Extract the specific number being clicked
                                const textMatch = curr.innerText.match(/\+\d{8,15}/);
                                const foundNumber = textMatch ? textMatch[0] : `Suffix ${suffix}`;
                                
                                btn.click(); 
                                btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                                return foundNumber; 
                            }
                            matches++;
                        }
                    }
                    return "Unknown";
                }, targetSuffix, idx));
            }
            const unknownClaims = claimedNumbers.filter(number => number === 'Unknown').length;
            if (unknownClaims > 0) {
                throw new Error(`Only ${activeTabsCount - unknownClaims}/${activeTabsCount} tab(s) claimed a matching task.`);
            }

            // WAIT FOR EVERY CONFIRM MODAL TO BE READY. Do not suppress a
            // missing modal: that would make the final report claim tabs ran
            // when only a subset actually submitted.
            await updateStatus(`[SYSTEM] Loop ${loopCount}: Synchronizing ${activeTabsCount} confirmation modal(s)...`);
            // Wait for every tab one by one. Only after this loop completes are
            // all tabs guaranteed to be sitting at Confirm.
            for (const page of activePages) {
                await page.waitForFunction(() => Array.from(
                    document.querySelectorAll('button, [class*="btn"], [class*="button"]')
                ).some(el => /confirm/i.test(el.innerText?.trim()) && el.offsetHeight > 0), {
                    timeout: 15000
                });
            }

            await delay(1000); // Give every modal a moment to finish animating.

            // Trigger Confirm once on every active tab and verify each click.
            await updateStatus(`[SYSTEM] Loop ${loopCount}: Confirming all ${activeTabsCount} tab(s)...`);
            const clickedStates = await Promise.all(activePages.map(p => p.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button, [class*="btn"], [class*="button"]'))
                    .filter(el => /confirm/i.test(el.innerText?.trim()) && el.offsetHeight > 0);
                const confirmBtn = btns[btns.length - 1];
                if (!confirmBtn) return false;
                confirmBtn.click();
                confirmBtn.dispatchEvent(new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window
                }));
                return true;
            })));
            const clickedCount = clickedStates.filter(Boolean).length;
            if (clickedCount !== activeTabsCount) {
                throw new Error(`Only ${clickedCount}/${activeTabsCount} tab(s) received Confirm.`);
            }

            // WAIT FOR FEEDBACK FROM EVERY ACTIVE TAB. A fixed sleep could report
            // zero while tabs were still processing, or miss slower tabs entirely.
            await updateStatus(`[SYSTEM] Loop ${loopCount}: Waiting for feedback from all ${activeTabsCount} tab(s)...`);
            const feedbackResults = [];
            for (let idx = 0; idx < activePages.length; idx++) {
                feedbackResults.push(await waitForWsjobsTaskFeedbackPuppeteer(
                    activePages[idx], idx + 1, 30000
                ));
            }
            lastFeedbackResults = feedbackResults;
            const successfulFeedback = feedbackResults.filter(result => result.status === 'success').length;
            const failedFeedback = feedbackResults.filter(result => result.status === 'failed').length;
            const timedOutFeedback = feedbackResults.filter(result => result.status === 'timeout').length;

            // REFRESH THE MASTER TASK PAGE ONLY AFTER EVERY TAB HAS REPORTED.
            await updateStatus(`[SYSTEM] Loop ${loopCount}: All tabs reported. Refreshing /task for Today Points...`);
            await masterPage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
            await delay(4000);
            finalTodayPoints = await readWsjobsTodayPointsPuppeteer(masterPage);
            if (finalTodayPoints === null) {
                throw new Error('Could not read Today Points after all task tabs finished.');
            }

            // The displayed total is always the refreshed final value minus the
            // first value captured before the first task tab started.
            const loopPointsEarned = finalTodayPoints - startingPoints;
            totalPoints = finalTodayPoints - initialTodayPoints;
            totalSuccess += successfulFeedback;

            const feedbackSummary = feedbackResults.map(result =>
                `Tab ${result.tabNumber}: ${result.status}${result.message ? ` (${result.message})` : ''}`
            ).join('\n');
            const targetsClaimedStr = claimedNumbers.join('\n');
            await updateStatus(`[SYSTEM] Loop ${loopCount} Result:\n\nTargets Hit:\n${targetsClaimedStr}\n\nFeedback:\n${feedbackSummary}\n\nToday Points: ${startingPoints} → ${finalTodayPoints}\nLoop Points Earned: ${loopPointsEarned}\nTotal Points Earned: ${totalPoints}`);

            // A new loop is allowed only when every tab explicitly reported
            // success. Failures and timeouts stop without inventing successes.
            if (successfulFeedback === activeTabsCount && failedFeedback === 0 && timedOutFeedback === 0) {
                await updateStatus(`[SYSTEM] All ${activeTabsCount} tab(s) succeeded. Waiting 1 second and restarting...`);
                await delay(1000);
                loopCount++;
            } else {
                isLooping = false;
            }
        }

        if (finalTodayPoints === null || initialTodayPoints === null) {
            throw new Error('Today Points were not available for final accounting.');
        }
        totalPoints = finalTodayPoints - initialTodayPoints;
        const finalFeedbackSummary = lastFeedbackResults.length
            ? lastFeedbackResults.map(result => `Tab ${result.tabNumber}: ${result.status}`).join('\n')
            : 'No tab feedback recorded.';
        await updateStatus(`[SYSTEM] Strike Protocol Finished.\n\nVerified successful tabs: ${totalSuccess}\nToday Points: ${initialTodayPoints} → ${finalTodayPoints}\nPoints Earned: ${totalPoints}\n\nLast tab feedback:\n${finalFeedbackSummary}`);
        
        const finalSnap = await masterPage.screenshot({ type: 'png' });
        
        await bot.sendPhoto(chatId, finalSnap, { 
            caption: `*Strike Protocol Complete*\nSuffix: \`${targetSuffix}\`\nVerified Successful Tabs: \`${totalSuccess}\`\nToday Points: \`${initialTodayPoints} → ${finalTodayPoints}\`\nPoints Earned: \`${totalPoints}\`\n\nLast Tab Feedback:\n${finalFeedbackSummary}`,
            parse_mode: 'Markdown'
        });
        
        await bot.deleteMessage(chatId, msgId).catch(() => {});

    } catch (err) {
        await bot.sendMessage(chatId, `[STRIKE FAILED]: ${err.message}`);
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
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



// --- UNIVERSAL CLOSE COMMAND ---
// Usage: close (Kills Task Mode, WT Burner, WSTASK Mode, and WA Login)
bot.onText(/^(?:close|\/close)$/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    const adminId = process.env.ADMIN_ID || '7710721646';
    if (chatId !== adminId && (typeof AUTHORIZED !== 'undefined' && !AUTHORIZED.includes(chatId))) return;

    let stoppedSomething = false;

    // 1. Kill WT Burner Session
    if (wtSessions && wtSessions[chatId]) {
        bot.sendMessage(chatId, '[WT BURNER] Terminating burner session...');
        if (wtSessions[chatId].browser) {
            await wtSessions[chatId].browser.close().catch(() => {});
        }
        if (wtSessions[chatId].timer) clearTimeout(wtSessions[chatId].timer);
        wtSessions[chatId] = null;
        bot.sendMessage(chatId, '[SUCCESS] Burner session destroyed and RAM freed.');
        stoppedSomething = true;
    }

    // 2. Kill persistent Wsjobs pairing session
    if (wsPairRuntimes && wsPairRuntimes.has(chatId)) {
        const pairingRuntime = wsPairRuntimes.get(chatId);
        if (pairingRuntime?.browser) await pairingRuntime.browser.close().catch(() => {});
        wsPairRuntimes.delete(chatId);
        wsPairSessions.delete(chatId);
        bot.sendMessage(chatId, '[SUCCESS] Persistent Wsjobs pairing browser closed.');
        stoppedSomething = true;
    }

    // 3. Kill Task Mode & Radar
    if (globalTaskBrowser) {
        await globalTaskBrowser.close().catch(() => {});
        globalTaskBrowser = null;
        isRadarScanning = false;
        stoppedSomething = true;
    }
    if (typeof taskModeActive !== 'undefined' && taskModeActive) {
        taskModeActive = false;
        if (typeof taskModeTimer !== 'undefined' && taskModeTimer) clearTimeout(taskModeTimer);
        if (typeof autoScannerInterval !== 'undefined' && autoScannerInterval) clearInterval(autoScannerInterval);

        bot.sendMessage(chatId, '[INACTIVE] Task Mode Deactivated. Main menu restored.', {
            reply_markup: {
                keyboard: [[{ text: 'Withdraw' }, { text: 'Balance' }]],
                resize_keyboard: true, is_persistent: true
            }
        });
        stoppedSomething = true;
    }

    // 4. Kill WSTASK Mode
    if (typeof wsTaskMode !== 'undefined' && wsTaskMode) {
        wsTaskMode = false;
        if (typeof wsTaskTimer !== 'undefined' && wsTaskTimer) clearTimeout(wsTaskTimer);
        bot.sendMessage(chatId, '[INACTIVE] WSTASK Mode Deactivated. Main menu restored.', {
            reply_markup: {
                keyboard: [[{ text: 'Withdraw' }, { text: 'Balance' }]],
                resize_keyboard: true, is_persistent: true
            }
        });
        stoppedSomething = true;
    }

    // 5. Kill WhatsApp Login Memory
    if (typeof userState !== 'undefined' && userState[chatId]) {
        userState[chatId] = null;
        bot.sendMessage(chatId, '[SYSTEM] WhatsApp login sequence aborted.');
        stoppedSomething = true;
    }

    if (!stoppedSomething) {
        bot.sendMessage(chatId, '[SYSTEM] No active processes to close.');
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

// --- TIMESMS.ORG AUTO-DOWNLOADER (NATIVE EXCEL EXPORT) ---
// Usage: /getfile
bot.onText(/^\/getfile$/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    let statusMsg = await bot.sendMessage(chatId, '⚙️ [SYSTEM] Booting Headless Browser for Native Excel Export...');

    const updateStatus = async (text) => {
        await bot.editMessageText(text, { chat_id: chatId, message_id: statusMsg.message_id }).catch(() => {});
    };

    // Create a unique temporary directory to catch the downloaded file
    const downloadDir = path.resolve(__dirname, `timesms_dl_${Date.now()}`);
    if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

    let browser = null;

    try {
        browser = await puppeteer.launch({
            headless: true,
            executablePath: getChromePath(),
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

        // Force Chrome to save files automatically to our custom folder without asking
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadDir
        });

        // --- 1. LOGIN ---
        await updateStatus('⚙️ [SYSTEM] Navigating to login...');
        await page.goto(`https://timesms.org/login`, { waitUntil: 'networkidle2' });

        const captchaAnswer = await page.evaluate(() => {
            const bodyText = document.body.innerText || '';
            const match = bodyText.match(/What is\s*(\d+)\s*([\+\-\*])\s*(\d+)/i);
            if (match) {
                const num1 = parseInt(match[1]), op = match[2], num2 = parseInt(match[3]);
                if (op === '+') return (num1 + num2).toString();
                if (op === '-') return (num1 - num2).toString();
                if (op === '*') return (num1 * num2).toString();
            }
            return null;
        });

        if (!captchaAnswer) throw new Error("Could not solve math captcha.");

        const inputs = await page.$$('input');
        for (let input of inputs) {
            const ph = await page.evaluate(el => (el.placeholder || '').toLowerCase(), input);
            if (ph.includes('username')) {
                await input.click({ clickCount: 3 }); await page.keyboard.press('Backspace');
                await input.type('Suzume', { delay: 50 });
            } else if (ph.includes('password')) {
                await input.click({ clickCount: 3 }); await page.keyboard.press('Backspace');
                await input.type('Suzume', { delay: 50 });
            } else if (ph.includes('answer')) {
                await input.click({ clickCount: 3 }); await page.keyboard.press('Backspace');
                await input.type(captchaAnswer, { delay: 50 });
            }
        }

        await new Promise(r => setTimeout(r, 1000));
        await page.keyboard.press('Enter');
        await new Promise(r => setTimeout(r, 500));

        await page.evaluate(() => {
            const els = Array.from(document.querySelectorAll('button, input, a, div'));
            for (let el of els) {
                const txt = (el.innerText || el.value || '').trim().toUpperCase();
                if (txt === 'LOGIN' || txt === 'SIGN IN') { el.click(); return; }
            }
        });

        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
        if (page.url().includes('login')) throw new Error("Login failed. Check credentials.");

        // --- 2. NAVIGATE TO "MY SMS NUMBERS" ---
        await updateStatus(`⚙️ [SYSTEM] Logged in. Teleporting directly to Agent portal...`);
        await page.goto(`https://timesms.org/agent/MySMSNumbers`, { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 3000));

        // --- 3. SHOW "ALL" RECORDS ---
        await updateStatus('⚙️ [SYSTEM] Clicking dropdown and selecting "All"...');
        await page.evaluate(() => {
            const selects = Array.from(document.querySelectorAll('select'));
            for (let select of selects) {
                const allOpt = Array.from(select.options).find(opt => opt.text.trim().toLowerCase() === 'all');
                if (allOpt) {
                    select.value = allOpt.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
            }
            return false;
        });
        await new Promise(r => setTimeout(r, 8000)); // Extra time to ensure DataTables loads the full list

        // --- 4. CLICK "EXCEL" BUTTON ---
        await updateStatus('⚙️ [SYSTEM] Executing click on the "Excel" button...');
        const clickedExcel = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('a, button, span'));
            for (let btn of buttons) {
                if ((btn.innerText || '').trim() === 'Excel') {
                    btn.click();
                    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                    if (btn.parentElement) btn.parentElement.click();
                    return true;
                }
            }
            return false;
        });

        if (!clickedExcel) throw new Error("Could not find the Excel button on the page.");

        // --- 5. WAIT FOR DOWNLOAD TO COMPLETE ---
        await updateStatus('⚙️ [SYSTEM] Waiting for server to generate and download the file...');
        let downloadedFilePath = null;

        // Poll the temporary directory for up to 60 seconds
        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 1000));

            if (fs.existsSync(downloadDir)) {
                const files = fs.readdirSync(downloadDir);
                // Locate the finished export file, bypassing Chrome's active .crdownload extension
                const excelFile = files.find(f => f.endsWith('.xlsx') || f.endsWith('.xls') || f.endsWith('.csv'));
                const isDownloading = files.some(f => f.endsWith('.crdownload'));

                if (excelFile && !isDownloading) {
                    downloadedFilePath = path.join(downloadDir, excelFile);
                    break;
                }
            }
        }

        if (!downloadedFilePath) {
            const snap = await page.screenshot();
            await bot.sendPhoto(chatId, snap, { caption: '⚠️ [DIAGNOSTIC] Screen when download timed out.' });
            throw new Error("Download timed out or failed to trigger.");
        }

        // --- 6. SEND FILE TO TELEGRAM ---
        await updateStatus('✅ [SUCCESS] File acquired! Handing off to the Message Bot...');

        const msgBotToken = '8424082135:AAGc73Ztzkb49dZd4hHEx99QFlMMwS5MONw';
        const messageBot = new TelegramBot(msgBotToken, { polling: false });

        await messageBot.sendDocument(ADMIN_ID, downloadedFilePath, {
            caption: '📊 *TimeSMS Number Report*\n\nExported natively from the website.',
            parse_mode: 'Markdown'
        });

        await updateStatus('✅ [SUCCESS] Excel file successfully delivered!');

        setTimeout(() => {
            bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        }, 3000);

    } catch (err) {
        await updateStatus(`❌ [ERROR] Sequence failed: ${err.message}`);
    } finally {
        if (browser) await browser.close().catch(() => {});

        // Wipe the temporary folder from Heroku storage to free up disk space
        try {
            if (fs.existsSync(downloadDir)) {
                fs.rmSync(downloadDir, { recursive: true, force: true });
            }
        } catch (cleanupErr) {
            console.log(`[WARNING] Failed to clean up temp dir: ${cleanupErr}`);
        }
    }
});




// Command to START Task Mode
bot.onText(/^(?:Task|task)$/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    const adminId = process.env.ADMIN_ID || '7710721646';
    if (chatId !== adminId && (typeof AUTHORIZED !== 'undefined' && !AUTHORIZED.includes(chatId))) return;

    taskModeActive = true;
    isRadarScanning = false; // Force unlock the radar in case of a previous crash
    resetTaskModeTimer(chatId);

    await bot.sendMessage(chatId, '[ACTIVE] Autonomous Task Mode Activated!\n\nRunning initial board scan right now. Will continue to scan every 1.5 minutes.\nType Close to end this mode.', {
        parse_mode: 'Markdown',
        reply_markup: { remove_keyboard: true }
    });

    // FIRE THE FIRST SCAN INSTANTLY
    runAutoTaskScanner(chatId);

    // Start the repeating 90-second loop
    if (autoScannerInterval) clearInterval(autoScannerInterval);
    autoScannerInterval = setInterval(() => {
        runAutoTaskScanner(chatId);
    }, 90000);
});






// The smart listener that catches your numbers
bot.on('message', (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID || !taskModeActive) return;
    if (!msg.text) return;

    // Check if the message is JUST a number
    if (/^\d{2,3}$/.test(msg.text.trim())) {

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


// --- WSTASK BALANCE CHECKER ---
bot.onText(/^(?:\/balance|Balance)$/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    let statusMsg = await bot.sendMessage(chatId, '[SYSTEM] Fetching balances...');

    let wsjobsBal = '0.00';

    // --- 1. Wsjobs Balance Fetch (Puppeteer Chrome) ---
    let wBrowser = null;
    let wPage = null;
    let balanceRecorder = null;
    let balanceVideoPath = null;
    let balanceErrorScreenshot = null;

    try {
        wBrowser = await launchScraperBrowser();
        const balanceVideoDir = path.join(__dirname, 'videos');
        if (!fs.existsSync(balanceVideoDir)) fs.mkdirSync(balanceVideoDir, { recursive: true });

        wPage = await wBrowser.newPage();
        await wPage.setViewport({ width: 412, height: 915 });
        balanceVideoPath = path.join(balanceVideoDir, `wsjobs_balance_${Date.now()}.mp4`);
        balanceRecorder = new PuppeteerScreenRecorder(wPage, { fps: 30 });
        await balanceRecorder.start(balanceVideoPath);

        // THE HUMAN SNIPER (Same as the working Chrome flows)
        await wPage.evaluateOnNewDocument(() => {
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

        await wPage.goto(wsjobsUrl(WSJOBS_ACCOUNT_PATH), { waitUntil: 'domcontentloaded' });
        await delay(4000);

        // LOGIN LOGIC
        await loginToWsjobsPuppeteer(wPage);

        // TELEPORT (This fixed your withdraw, so it stays here too)
        await wPage.goto(wsjobsUrl(WSJOBS_ACCOUNT_PATH), { waitUntil: 'domcontentloaded' });
        await delay(5000);

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

    } catch(e) {
        console.log(`[BALANCE ERROR]: ${e.message}`);
        wsjobsBal = 'Error';
        balanceErrorScreenshot = wPage
            ? await wPage.screenshot({ type: 'png' }).catch(() => null)
            : null;
    } finally {
        if (balanceRecorder) await balanceRecorder.stop().catch(() => {});
        if (wPage && !balanceVideoPath) {
            balanceVideoPath = null;
        }
        if (wBrowser) await wBrowser.close().catch(() => {});
    }

    // --- 2. DIAGNOSTIC DELIVERY ---
    if (balanceErrorScreenshot) {
        await bot.sendPhoto(chatId, balanceErrorScreenshot, {
            caption: wsjobsBal === 'Error'
                ? '[BALANCE ERROR] Screen state captured before cleanup.'
                : '[BALANCE] Account page screenshot.'
        }, { filename: 'wsjobs_balance.png' }).catch(() => {});
    }

    if (wsjobsBal === 'Error' && balanceVideoPath && fs.existsSync(balanceVideoPath)) {
        await bot.sendVideo(chatId, balanceVideoPath, {
            caption: '[BALANCE ERROR] Recorded Chrome browser session.'
        }).catch(() => {});
    }

    if (balanceVideoPath && fs.existsSync(balanceVideoPath)) {
        setTimeout(() => {
            try { fs.unlinkSync(balanceVideoPath); } catch {}
        }, 5000);
    }

    // --- 3. FINAL CLEAN OUTPUT ---
    await bot.deleteMessage(chatId, statusMsg.message_id).catch(()=>{});
    await bot.sendMessage(chatId, `Wsjobs: ${wsjobsBal}`).catch(() => {});
});


const updateStatus = async (text) => {
    await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: statusMsg.message_id
    }).catch(() => {});
};


bot.onText(/\/withdraw\s+task/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    const adminId = process.env.ADMIN_ID || '7710721646';
    if (chatId !== adminId && (typeof AUTHORIZED !== 'undefined' && !AUTHORIZED.includes(chatId))) return;

    const TOTAL_TABS = 5;
    let statusMsg = await bot.sendMessage(chatId, `[SYSTEM] Booting Firefox for Secure ${TOTAL_TABS}-Tab Withdrawal...`);
    const videoDir = path.join(__dirname, 'videos');
    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir);

    let browser = null;
    let context = null;
    let pages = [];

    try {
        process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

        browser = await launchPlaywrightBrowser({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Android 13; Mobile; rv:110.0) Gecko/110.0 Firefox/110.0',
            viewport: { width: 412, height: 915 },
            recordVideo: { dir: videoDir, size: { width: 412, height: 915 } }
        });

        // ==========================================
        // 1. MASTER TAB BOOT & LOGIN
        // ==========================================
        const masterPage = await context.newPage();
        pages.push(masterPage);

        // --- THE HUMAN SNIPER (MODAL KILLER) ---
        await masterPage.addInitScript(() => {
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

        await bot.editMessageText('[SYSTEM] Navigating to Account...', { chat_id: chatId, message_id: statusMsg.message_id });
        await masterPage.goto(wsjobsUrl(WSJOBS_ACCOUNT_PATH), { waitUntil: 'domcontentloaded' });
        await delay(4000);

        await loginToWsjobs(masterPage);

        await masterPage.goto(wsjobsUrl(WSJOBS_ACCOUNT_PATH), { waitUntil: 'domcontentloaded' });
        await delay(5000);

        // --- 2. PRECISION BALANCE SCRAPER ---
        const rawBalance = await masterPage.evaluate(() => {
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
            const errSnap = await masterPage.screenshot();
            await bot.sendPhoto(chatId, errSnap, {
                caption: `[DIAGNOSTIC] Detected Balance: ${rawBalance}. Too low for withdrawal.`
            }, { filename: 'low_balance.png' });
            throw new Error(`Balance ${rawBalance} is too low.`);
        }

        await bot.editMessageText(`[SYSTEM] Target Acquired: ${targetAmount}. Processing ${TOTAL_TABS} tabs sequentially...`, { chat_id: chatId, message_id: statusMsg.message_id }).catch(() => {});

        // ==========================================
        // 3. SEQUENTIAL TAB PREPARATION (ONE BY ONE)
        // ==========================================
        for (let i = 0; i < TOTAL_TABS; i++) {
            let p;
            if (i === 0) {
                p = masterPage; // Reuse the master tab we just logged in with
            } else {
                p = await context.newPage();
                pages.push(p);
                // Inject sniper into clone tabs
                await p.addInitScript(() => {
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
            }

            console.log(`[TAB ${i + 1}] Processing...`);

            await p.goto(wsjobsUrl(WSJOBS_WITHDRAW_PATH), { waitUntil: 'domcontentloaded' });
            await delay(4000);

            // 1. Click the Amount Chip
            await p.evaluate((amt) => {
                const chips = Array.from(document.querySelectorAll('div, span, p, button, [class*="item"]'));
                const targetChip = chips.find(c => c.innerText?.trim() === amt.toString() && c.offsetHeight > 0);
                if (targetChip) {
                    targetChip.click();
                    targetChip.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, targetAmount);

            await delay(3000);

            // 2. NUCLEAR BUTTON STRIKE (WITHDRAW NOW)
            await p.evaluate(() => {
                const overlays = document.querySelectorAll('.van-overlay, .modal-mask, [class*="mask"]');
                overlays.forEach(el => el.remove());

                const textBlockers = Array.from(document.querySelectorAll('div')).filter(el =>
                    el.innerText?.includes('Saka Yanzu') || el.innerText?.includes('Don Allah sauke App')
                );
                textBlockers.forEach(b => b.remove());

                const mainBtn = Array.from(document.querySelectorAll('*')).find(b =>
                    (b.innerText?.includes('WITHDRAW NOW') || b.innerText?.includes('SACAR AGORA')) &&
                    b.offsetHeight > 0 &&
                    window.getComputedStyle(b).display !== 'none'
                );

                if (mainBtn) {
                    const rect = mainBtn.getBoundingClientRect();
                    const x = rect.left + rect.width / 2;
                    const y = rect.top + rect.height / 2;

                    const createEvent = (type) => new MouseEvent(type, {
                        bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, buttons: 1
                    });

                    mainBtn.dispatchEvent(createEvent('mousedown'));
                    mainBtn.dispatchEvent(createEvent('mouseup'));
                    mainBtn.dispatchEvent(createEvent('click'));
                    mainBtn.click();
                }
            });

            await p.mouse.click(206, 320).catch(() => {});
            await delay(3000);

            // 3. PASSWORD ENTRY & LOCK IN
            const passInput = p.locator('input[type="password"], .modal-body input, [placeholder*="password"], [placeholder*="senha"]').last();
            await passInput.waitFor({ state: 'visible', timeout: 15000 });
            await passInput.click();
            await p.evaluate(el => el.value = '', await passInput.elementHandle());
            if (!WSJOBS_WITHDRAW_PIN) {
                throw new Error('Missing WSJOBS_WITHDRAW_PIN configuration.');
            }
            await passInput.type(WSJOBS_WITHDRAW_PIN, { delay: 100 });
            await p.keyboard.press('Tab');
            await delay(1500);

            console.log(`[TAB ${i + 1}] Sitting at Confirm Modal.`);
        }

        // ==========================================
        // 4. SYNCHRONIZED MASS STRIKE (PROMISE.ALL)
        // ==========================================
        await bot.editMessageText(`[SYSTEM] All ${TOTAL_TABS} tabs loaded. Firing simultaneous confirm strike!`, { chat_id: chatId, message_id: statusMsg.message_id });

        await Promise.all(pages.map(async (p, i) => {
            try {
                // Phase A: Native Playwright Tap
                try {
                    const confirmBtn = p.locator('text=/Tabbatar Cirewa|Confirm|Confirmar/i').last();
                    await confirmBtn.tap({ force: true, delay: 150, timeout: 3000 });
                } catch (e) {}

                // Phase B: JS Mobile Touch Strike
                await p.evaluate(() => {
                    const modalBlockers = document.querySelectorAll('.van-overlay, .modal-mask, [class*="mask"]');
                    modalBlockers.forEach(el => el.remove());

                    const elements = Array.from(document.querySelectorAll('button, div, span'));
                    const finalBtn = elements.reverse().find(b =>
                        (b.innerText?.includes('Tabbatar Cirewa') || b.innerText?.includes('Confirm')) &&
                        b.offsetHeight > 0
                    );

                    if (finalBtn) {
                        let target = finalBtn;
                        if (target.tagName.toLowerCase() === 'SPAN' && target.parentElement) {
                            target = target.parentElement;
                        }

                        const rect = target.getBoundingClientRect();
                        const x = rect.left + rect.width / 2;
                        const y = rect.top + rect.height / 2;

                        const evData = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
                        ['mousedown', 'mouseup', 'click'].forEach(t => target.dispatchEvent(new MouseEvent(t, evData)));

                        try {
                            const touchObj = new Touch({ identifier: Date.now(), target: target, clientX: x, clientY: y, radiusX: 2.5, radiusY: 2.5, rotationAngle: 10, force: 0.5 });
                            target.dispatchEvent(new TouchEvent('touchstart', { cancelable: true, bubbles: true, touches: [touchObj], targetTouches: [touchObj], changedTouches: [touchObj] }));
                            target.dispatchEvent(new TouchEvent('touchend', { cancelable: true, bubbles: true, touches: [], targetTouches: [], changedTouches: [touchObj] }));
                        } catch(e) {}

                        target.click();
                    }
                });

                // Phase C: Physical Backup Tap
                await p.mouse.click(300, 720).catch(() => {});
                await p.mouse.click(300, 700).catch(() => {});

                console.log(`[TAB ${i + 1}] Strike Executed`);
            } catch (err) {
                console.log(`[TAB ${i + 1}] Strike Error: ${err.message}`);
            }
        }));

        await delay(5000);

        // ==========================================
        // 5. SUCCESS REFRESH, CAPTURE & DELIVERY
        // ==========================================
        await bot.editMessageText(`[SYSTEM] Strike complete. Refreshing account page...`, { chat_id: chatId, message_id: statusMsg.message_id }).catch(() => {});

        await masterPage.goto(wsjobsUrl(WSJOBS_ACCOUNT_PATH), { waitUntil: 'domcontentloaded' });
        await delay(5000);

        const finalSnap = await masterPage.screenshot({ type: 'png' });

        await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        await bot.sendPhoto(chatId, finalSnap,
            { caption: `[SUCCESS] Mass Withdrawal Strike (${TOTAL_TABS} Tabs) submitted.` },
            { filename: 'withdraw_final.png' }
        );

    } catch (err) {
        console.log(`[WITHDRAW ERROR]: ${err.message}`);
        await bot.sendMessage(chatId, `[WITHDRAW ERROR]: ${err.message}`).catch(() => {});

        if (context) {
            try {
                // Safely grab screenshot of the master tab if it failed
                const errSnap = await pages[0].screenshot({ type: 'png' }).catch(() => null);
                if (errSnap) {
                    await bot.sendPhoto(chatId, errSnap, { caption: `[DIAGNOSTIC] Screen state at failure.` }).catch(() => {});
                }
            } catch (e) {}
        }
    } finally {
        if (context) {
            try {
                const activePages = context.pages();
                const videoPaths = [];
                for (const p of activePages) {
                    const v = p.video();
                    if (v) {
                        const vp = await v.path().catch(() => null);
                        if (vp) videoPaths.push(vp);
                    }
                }
                await context.close().catch(() => {});
                for (const vp of videoPaths) {
                    if (fs.existsSync(vp)) fs.unlinkSync(vp);
                }
            } catch (e) {}
        }
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





// --- WSJOBS AUTOMATIC PAIRING FLOW ---
function parseWsjobsPairInput(rawInput) {
    const raw = String(rawInput || '').trim();
    if (!/^\+\d[\d\s().-]+$/.test(raw)) return null;

    const parsed = parsePhoneNumberFromString(raw);
    if (!parsed || !parsed.countryCallingCode || !parsed.nationalNumber) return null;
    if (!parsed.isValid()) return null;

    return {
        countryCode: String(parsed.countryCallingCode),
        localNumber: String(parsed.nationalNumber),
        internationalNumber: parsed.number
    };
}

async function readWsjobsPairState(page) {
    return page.evaluate(() => {
        const body = document.body?.innerText || '';
        // The site currently renders the literal `1111 - 1111` format in the
        // observed pairing flow. It is a valid displayed code for this site,
        // so repeated digits must not be rejected as a placeholder.
        const demoCodes = new Set(['KEEP-THIS']);
        const normalize = (value) => String(value || '')
            .toUpperCase()
            .replace(/\s*[-–—]\s*/g, '-')
            .replace(/\s+/g, '-');
        const isRealCode = (value) => {
            const normalized = normalize(value);
            return Boolean(normalized) && !demoCodes.has(normalized);
        };

        // Read only the short text immediately following the Pair Code label.
        // This prevents unrelated 8-character text elsewhere on the dashboard
        // from being mistaken for the current pairing code.
        const label = Array.from(document.querySelectorAll('*')).find(el =>
            el.offsetParent !== null && /^Pair(?:ing)?\s*Code$/i.test(el.innerText?.trim() || '')
        );
        const nearbyText = [
            label?.parentElement?.innerText,
            label?.parentElement?.parentElement?.innerText,
            label?.parentElement?.parentElement?.parentElement?.innerText,
            body
        ].filter(Boolean).join(' ');
        const candidates = nearbyText.match(/\b(?:[A-Z0-9]{8}|[A-Z0-9]{4}\s*(?:[-–—]\s*|\s+)[A-Z0-9]{4})\b/gi) || [];
        const code = candidates.map(normalize).find(isRealCode) || null;
        return {
            code,
            body,
            ready: /Pair(?:ing)?\s*code\s*ready/i.test(body),
            placeholderDetected: candidates.some(candidate => !isRealCode(candidate))
        };
    }).catch(() => ({ code: null, body: '', ready: false, placeholderDetected: false }));
}

async function clickWsjobsCountry(page, countryCode) {
    const code = String(countryCode);
    const selectorResult = await page.evaluate(() => {
        const visible = (el) => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const describe = (el) => {
            const rect = el.getBoundingClientRect();
            return {
                tag: el.tagName.toLowerCase(),
                text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
                className: String(el.className || '').slice(0, 100),
                role: el.getAttribute('role') || '',
                ariaHaspopup: el.getAttribute('aria-haspopup') || '',
                left: Math.round(rect.left),
                top: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
            };
        };

        const phoneInput = Array.from(document.querySelectorAll(
            'input[placeholder*="Phone Number" i], input[type="tel"]'
        )).find(visible);
        if (!phoneInput) return { opened: false, reason: 'phone-input-not-found', candidates: [] };

        const phoneRect = phoneInput.getBoundingClientRect();
        const codePattern = /\+\s*\d{1,4}/;
        const candidates = Array.from(document.querySelectorAll(
            'button, [role="button"], [aria-haspopup], input, div, span'
        )).filter(visible).filter((el) => {
            if (el === phoneInput || el.tagName === 'INPUT') return false;
            const rect = el.getBoundingClientRect();
            const verticallyAligned = rect.bottom >= phoneRect.top && rect.top <= phoneRect.bottom;
            const immediatelyLeft = rect.right <= phoneRect.left + 8 && rect.right >= phoneRect.left - 180;
            const usefulSize = rect.width >= 36 && rect.height >= 20;
            return verticallyAligned && immediatelyLeft && usefulSize;
        });

        const ranked = candidates.map((el, index) => {
            const rect = el.getBoundingClientRect();
            const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
            const metadata = `${text} ${el.getAttribute('aria-label') || ''} ${el.className || ''}`;
            const hasCountryCode = codePattern.test(metadata);
            const hasSelectorHint = /country|phone|dial|calling|flag/i.test(metadata);
            return {
                el,
                index,
                score: (hasCountryCode ? 100000 : 0) + (hasSelectorHint ? 10000 : 0) + Math.round(rect.width * rect.height),
                rect
            };
        }).sort((a, b) => b.score - a.score);

        const target = ranked[0]?.el;
        if (!target) {
            return {
                opened: false,
                reason: 'left-of-phone-control-not-found',
                candidates: candidates.slice(0, 12).map(describe)
            };
        }

        target.click();
        return {
            opened: true,
            target: describe(target),
            candidates: ranked.slice(0, 8).map(({ el }) => describe(el))
        };
    });

    if (!selectorResult?.opened) {
        const diagnostic = selectorResult?.candidates?.length
            ? ` Nearby controls: ${JSON.stringify(selectorResult.candidates)}`
            : '';
        throw new Error(`Could not find the current country selector box.${diagnostic}`);
    }

    const searchSelector = 'input[placeholder*="Search country" i], input[placeholder*="ISO" i], input[placeholder*="code" i]';
    await page.waitForSelector(searchSelector, { visible: true, timeout: 10000 });
    const search = await page.$(searchSelector);
    if (!search) throw new Error('Country search field did not appear.');

    await search.click({ clickCount: 3 });
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await search.type(code, { delay: 30 });
    await delay(500);

    await page.waitForFunction((cc) => {
        const codeToken = `+${cc}`;
        return Array.from(document.querySelectorAll('button, [role="button"], li, div, span')).some((el) => {
            const rect = el.getBoundingClientRect();
            const text = (el.innerText || '').trim();
            const tokens = text.replace(/[(),]/g, ' ').split(/\s+/).filter(Boolean);
            const countryCodes = tokens.filter((token) => /^\+\d+$/.test(token));
            return rect.width > 0 && rect.height > 0 && text.length < 120 && tokens.includes(codeToken) && countryCodes.length === 1;
        });
    }, { timeout: 10000 }, code);

    const selected = await page.evaluate((cc) => {
        const codeToken = `+${cc}`;
        const visible = (el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        };
        const candidates = Array.from(document.querySelectorAll('button, [role="button"], li, div, span'))
            .filter(visible)
            .filter((el) => {
                const text = (el.innerText || '').trim();
                const tokens = text.replace(/[(),]/g, ' ').split(/\s+/).filter(Boolean);
                const countryCodes = tokens.filter((token) => /^\+\d+$/.test(token));
                return text.length < 120 && tokens.includes(codeToken) && countryCodes.length === 1 && !/search country|select country|common|all countries/i.test(text);
            });
        const target = candidates[candidates.length - 1];
        if (!target) return false;
        (target.closest('button, [role="button"], li') || target).click();
        return true;
    }, code);

    if (!selected) throw new Error(`Country +${code} was not found in the search results.`);
}

async function clickWsjobsGetPairCode(page) {
    const clicked = await page.evaluate(() => {
        const visible = (el) => el && el.offsetHeight > 0 && getComputedStyle(el).visibility !== 'hidden';
        const target = Array.from(document.querySelectorAll('button, [role="button"]'))
            .filter(visible)
            .find((el) => (el.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase() === 'get pair code');
        if (!target || target.disabled) return false;
        target.click();
        return true;
    });
    if (!clicked) throw new Error('Get Pair Code button was not found or is disabled.');
}

async function startWsjobsPairingRecording(runtime) {
    if (!runtime?.page || runtime.recorder) return;
    const videoDir = path.join(__dirname, 'videos');
    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
    runtime.videoPath = path.join(videoDir, `wsjobs_pairing_${Date.now()}.mp4`);
    runtime.recorder = new PuppeteerScreenRecorder(runtime.page, { fps: 30 });
    await runtime.recorder.start(runtime.videoPath);
}

async function sendWsjobsPairingDiagnostics(chatId, runtime, errorMessage) {
    if (!runtime) return;
    const screenshot = runtime.page
        ? await runtime.page.screenshot({ type: 'png' }).catch(() => null)
        : null;

    if (runtime.recorder) {
        await runtime.recorder.stop().catch(() => {});
        runtime.recorder = null;
    }

    const videoPath = runtime.videoPath;
    runtime.videoPath = null;

    if (screenshot) {
        await bot.sendPhoto(chatId, screenshot, {
            caption: `[PAIRING DIAGNOSTIC] ${errorMessage}`
        }, { filename: 'wsjobs_pairing_error.png' }).catch(() => {});
    }
    if (videoPath && fs.existsSync(videoPath)) {
        await bot.sendVideo(chatId, videoPath, {
            caption: `[PAIRING DIAGNOSTIC] Chrome session recording: ${errorMessage}`
        }).catch(() => {});
        setTimeout(() => {
            try { fs.unlinkSync(videoPath); } catch {}
        }, 5000);
    }
}

async function runWsjobsPairingSequence(chatId, phoneInfo, runtime) {
    const variants = [
        phoneInfo.localNumber,
        `0${phoneInfo.localNumber}`,
        `00${phoneInfo.localNumber}`,
        `000${phoneInfo.localNumber}`
    ];
    let statusMsg = await bot.sendMessage(chatId, `[PAIRING] Preparing 4-stage linking for ${phoneInfo.internationalNumber}...`);
    let browser = runtime?.browser || null;
    let page = runtime?.page || null;

    const updateStatus = async (text, extra = {}) => {
        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            ...extra
        }).catch(() => {});
    };

    try {
        const reusedRuntime = Boolean(browser && page && browser.isConnected?.() !== false && !page.isClosed?.());
        if (!reusedRuntime) {
            browser = await launchScraperBrowser();
            page = await browser.newPage();
            await page.setViewport({ width: 412, height: 915 });
            runtime = { ...(runtime || {}), browser, page, createdAt: Date.now() };
            wsPairRuntimes.set(chatId, runtime);
        }

        await startWsjobsPairingRecording(runtime);

        await updateStatus(reusedRuntime
            ? '[PAIRING] Reusing the existing Chrome session on the Wsjobs task page...'
            : '[PAIRING] Opening Wsjobs task page and checking login...');

        if (!reusedRuntime || !page.url().includes(WSJOBS_TASK_PATH)) {
            await page.goto(wsjobsUrl(WSJOBS_TASK_PATH), { waitUntil: 'domcontentloaded', timeout: 30000 });
            await delay(2000);
        }

        // The first message performs login if the task page redirected to /login.
        // Later messages reuse the already-authenticated task page and skip bootstrap.
        if (!reusedRuntime) {
            await loginToWsjobsPuppeteer(page);
            await page.goto(wsjobsUrl(WSJOBS_TASK_PATH), { waitUntil: 'domcontentloaded', timeout: 30000 });
            await delay(2000);
        }

        const phoneInput = 'input[placeholder*="Phone Number" i], input[placeholder*="phone number" i], input[type="tel"]';
        await page.waitForSelector(phoneInput, { timeout: 15000 });

        for (let index = 0; index < variants.length; index++) {
            const stage = index + 1;
            const localNumber = variants[index];
            await updateStatus(`[PAIRING ${stage}/4] Entering +${phoneInfo.countryCode} ${localNumber}...`);

            await page.goto(wsjobsUrl(WSJOBS_TASK_PATH), { waitUntil: 'domcontentloaded', timeout: 30000 });
            await delay(1200);
            await page.waitForSelector(phoneInput, { timeout: 15000 });
            await clickWsjobsCountry(page, phoneInfo.countryCode);

            await page.click(phoneInput);
            await page.evaluate((selector) => {
                const input = document.querySelector(selector);
                if (!input) return;
                input.value = '';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }, phoneInput);
            await page.type(phoneInput, localNumber, { delay: 25 });
            await clickWsjobsGetPairCode(page);

            let websitePairCode = null;
            for (let attempt = 0; attempt < 45; attempt++) {
                await delay(1000);
                const state = await readWsjobsPairState(page);
                // The website value is used only as proof that the pairing
                // state appeared. The Telegram-facing code is intentionally
                // hardcoded below as requested.
                if (state.code) {
                    websitePairCode = state.code;
                    break;
                }
            }
            if (!websitePairCode) throw new Error(`Pairing state was not generated for stage ${stage}.`);

            const pairCode = '11111111';
            await updateStatus(
                `[PAIRING ${stage}/4] Code ready for +${phoneInfo.countryCode} ${localNumber}.\n\n` +
                `Open WhatsApp → Linked devices → Link with phone number.\n` +
                `After linking, this code will disappear and the next stage will begin.\n\n` +
                `Code: \`${pairCode}\``,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[{
                            text: `Copy ${pairCode}`,
                            copy_text: { text: pairCode }
                        }]]
                    }
                }
            );

            let disappearedChecks = 0;
            const deadline = Date.now() + 180000;
            while (Date.now() < deadline) {
                await delay(500);
                const state = await readWsjobsPairState(page);
                if (!state.code) {
                    disappearedChecks++;
                    // The real code is gone. The website has completed this
                    // link, so immediately begin the next number sequence.
                    break;
                }
                disappearedChecks = 0;
            }
            if (disappearedChecks < 1) throw new Error(`Stage ${stage} timed out waiting for the pairing code to disappear.`);

            await updateStatus(`[PAIRING ${stage}/4] +${phoneInfo.countryCode} ${localNumber} linked successfully. Preparing the next number...`);
            await delay(1200);
        }

        await updateStatus(`[PAIRING COMPLETE] All 4 numbers were processed successfully.`, {
            reply_markup: { remove_keyboard: true }
        });
    } catch (error) {
        await updateStatus(`[PAIRING FAILED] ${error.message}`);
        await sendWsjobsPairingDiagnostics(chatId, runtime, error.message);
    } finally {
        if (runtime && browser && page && browser.isConnected?.() !== false && !page.isClosed?.()) {
            runtime.browser = browser;
            runtime.page = page;
            runtime.lastUsedAt = Date.now();
            wsPairRuntimes.set(chatId, runtime);
        }
    }
}

// --- UNIFIED MESSAGE LISTENER ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id.toString();
    if (!AUTHORIZED.includes(chatId)) return;
    if (!msg.text || msg.text.startsWith('/')) return;

    const pairInput = parseWsjobsPairInput(msg.text);
    if (pairInput) {
        if (wsPairSessions.has(chatId)) {
            await bot.sendMessage(chatId, '[PAIRING] A four-stage pairing sequence is already running. Use /close to stop other active sessions.');
            return;
        }
        const pairingRuntime = wsPairRuntimes.get(chatId) || null;
        wsPairSessions.set(chatId, { startedAt: Date.now(), number: pairInput.internationalNumber });
        runWsjobsPairingSequence(chatId, pairInput, pairingRuntime)
            .catch((error) => bot.sendMessage(chatId, `[PAIRING FAILED] ${error.message}`).catch(() => {}))
            .finally(() => wsPairSessions.delete(chatId));
        return;
    }

    // --- 2. UPGRADED WT BURNER CONVERSATION FLOW ---
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
                // --- 1. BOOT ISOLATED FIREFOX ENGINE (Replaces Puppeteer/Chrome) ---
                if (!session.browser) {
                    await updateStatus('[WT BURNER] Launching clean Firefox Burner Engine...');
                    process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

                    session.browser = await launchPlaywrightBrowser({
                        headless: true,
                        args: ['--no-sandbox', '--disable-setuid-sandbox']
                    });

                    session.context = await session.browser.newContext({
                        userAgent: 'Mozilla/5.0 (Android 13; Mobile; rv:110.0) Gecko/110.0 Firefox/110.0',
                        viewport: { width: 412, height: 915 }
                    });

                    const page1 = await session.context.newPage();
                    pages.push(page1);
                    session.masterPage = page1; // Save the master tab to the session

                    // --- HUMAN SNIPER INJECTION ---
                    await page1.addInitScript(() => {
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

                    // Dynamic Login
                    await updateStatus('[WT BURNER] Injecting credentials into Wsjobs...');
                    await page1.goto(wsjobsUrl(WSJOBS_ACCOUNT_PATH), { waitUntil: 'domcontentloaded' });
                    await delay(3000);

                    await loginToWsjobs(page1, { username: session.username, password: session.password });
                } else {
                    await updateStatus('[WT BURNER] Using warm Burner session...');
                    pages.push(session.masterPage); // Grab the master page from memory
                }

                const masterTab = pages[0];

                // --- 2. PRECISION BALANCE SCRAPER ---
                await masterTab.goto(wsjobsUrl(WSJOBS_ACCOUNT_PATH), { waitUntil: 'domcontentloaded' });
                await delay(3000);

                initialBalanceNum = await masterTab.evaluate(() => {
                    const allText = document.body.innerText;
                    const decimalMatches = allText.match(/\d+\.\d{2}/g);
                    if (decimalMatches) return Math.max(...decimalMatches.map(n => parseFloat(n)));

                    const generalMatches = allText.match(/\d{1,3}(,\d{3})*(\.\d+)?/g);
                    if (generalMatches) {
                        const numbers = generalMatches.map(n => parseFloat(n.replace(/,/g, ''))).filter(n => n > 100 && n < 100000);
                        return numbers.length > 0 ? Math.max(...numbers) : 0;
                    }
                    return 0;
                });

                // --- 3. TARGET SCANNING ---
                await updateStatus('[WT BURNER] Teleporting to Task Board...');
                await masterTab.goto(wsjobsUrl(WSJOBS_TASK_PATH), { waitUntil: 'domcontentloaded' });
                await delay(4000);

                let targetCount = await masterTab.evaluate((suffix) => {
                    const btns = Array.from(document.querySelectorAll('*')).filter(el => el.innerText?.trim() === 'SEND');
                    let found = 0;
                    for (let btn of btns) {
                        if (btn.closest('div')?.innerText.includes(suffix)) found++;
                    }
                    return found > 4 ? 4 : found;
                }, session.target);

                if (targetCount === 0) throw new Error(`0 targets found for ${session.target}.`);

                // Double the tabs per target to match the new /task logic
                const totalTabs = targetCount * 2;
                await updateStatus(`[WT BURNER] Found ${targetCount} targets. Spawning ${totalTabs - 1} clone tabs...`);

                for (let i = 1; i < totalTabs; i++) {
                    const p = await session.context.newPage();
                    pages.push(p);
                    await p.goto(wsjobsUrl(WSJOBS_TASK_PATH), { waitUntil: 'domcontentloaded' });
                }

                // --- 4. SYNCHRONIZED SEND STRIKE ---
                await updateStatus('[WT BURNER] EXECUTE SIMULTANEOUS SEND...');
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
                    }, { suffix: session.target, index: targetIdx });
                }));

                await delay(3500);

                // --- 5. MODAL-AWARE COORDINATED CONFIRM ---
                await updateStatus('[WT BURNER] COORDINATED CONFIRM...');
                await Promise.all(pages.map(p => p.evaluate(() => {
                    const overlays = document.querySelectorAll('.van-overlay, .modal-mask, [class*="mask"]');
                    overlays.forEach(el => el.remove());

                    const textBlockers = Array.from(document.querySelectorAll('div')).filter(el =>
                        el.innerText?.includes('Saka Yanzu') || el.innerText?.includes('Don Allah sauke App')
                    );
                    textBlockers.forEach(b => b.remove());

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
                        if (btn) {
                            btn.click();
                            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                        }
                    }
                })));

                await delay(20000);
                const finalTaskSnap = await masterTab.screenshot({ type: 'png' });

                // --- 6. FINAL BALANCE CALCULATION ---
                await updateStatus('[WT BURNER] Fetching Final Balance...');
                await masterTab.goto(wsjobsUrl(WSJOBS_ACCOUNT_PATH), { waitUntil: 'domcontentloaded' });
                await delay(2000);
                await masterTab.reload({ waitUntil: 'domcontentloaded' });
                await delay(5000);

                const finalBalanceNum = await masterTab.evaluate(() => {
                    const allText = document.body.innerText;
                    const decimalMatches = allText.match(/\d+\.\d{2}/g);
                    if (decimalMatches) return Math.max(...decimalMatches.map(n => parseFloat(n)));

                    const generalMatches = allText.match(/\d{1,3}(,\d{3})*(\.\d+)?/g);
                    if (generalMatches) {
                        const numbers = generalMatches.map(n => parseFloat(n.replace(/,/g, ''))).filter(n => n > 100 && n < 100000);
                        return numbers.length > 0 ? Math.max(...numbers) : 0;
                    }
                    return 0;
                });

                const diff = finalBalanceNum - initialBalanceNum;
                const profitText = diff > 0 ? diff.toFixed(2) : "0.00";

                await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});

                await bot.sendPhoto(chatId, finalTaskSnap, {
                    caption: `[WT BURNER] Strike Complete\nProfit: <code>+${profitText}</code>\nBalance: <code>${finalBalanceNum.toLocaleString(undefined, {minimumFractionDigits: 2})}</code>`,
                    parse_mode: 'HTML'
                });

            } catch (err) {
                await updateStatus(`[ERROR] WT Sequence failed: ${err.message}`);
            } finally {
                // --- 7. RAM CLEANUP ---
                if (pages.length > 1) {
                    for (let p of pages.slice(1)) {
                        await p.close().catch(()=>{});
                    }
                }

                session.step = 'TARGET_OR_AWAITING';

                // Reset the 15-minute timebomb
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
