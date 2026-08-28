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
const WSJOBS_POINTS_PER_DOLLAR = 10000;
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




const { execFile } = require('child_process');
const util = require('util');
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
        protocolTimeout: 120000,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    };
    const chromePath = getChromePath();
    if (chromePath) launchOptions.executablePath = chromePath;
    return puppeteer.launch(launchOptions);
}

async function isPuppeteerBrowserHealthy(browser) {
    if (!browser) return false;
    if (typeof browser.isConnected === 'function') return browser.isConnected();
    if (typeof browser.connected === 'boolean') return browser.connected;
    try {
        await browser.version();
        return true;
    } catch {
        return false;
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

let fileMeta = null;

wss.on('connection', (ws) => {
    console.log('[HEROKU] Termux Phone connected successfully!');

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
        // RADAR must use the browser owned by Task Mode. It opens a new
        // scanning tab, but never launches a second Chrome process.
        if (!(await isPuppeteerBrowserHealthy(globalTaskBrowser))) {
            throw new Error('Shared Task Mode Chrome browser is not available. Start Task Mode first.');
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
    const bearer = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
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

async function readWsjobsCurrentBalancePuppeteer(page) {
    return await page.evaluate(() => {
        const allText = document.body?.innerText || '';
        const decimalMatches = allText.match(/\d+\.\d{2}/g);
        if (decimalMatches) {
            return Math.max(...decimalMatches.map(value => parseFloat(value)));
        }
        const generalMatches = allText.match(/\d{1,3}(,\d{3})*(\.\d+)?/g) || [];
        const numbers = generalMatches
            .map(value => parseFloat(value.replace(/,/g, '')))
            .filter(value => value > 100 && value < 1000000);
        return numbers.length ? Math.max(...numbers) : null;
    }).catch(() => null);
}

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
        if (/send\s+successful|successfully\s+sent|task\s+sent\s+successfully|successful.*send|send.*completed/i.test(text)) {
            return { status: 'success', message: 'Send successful' };
        }
        if (/temporarily\s+unable|unable\s+to\s+send|try\s+another\s+number/i.test(text)) {
            return { status: 'failed', message: failedMessage };
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

async function waitForWsjobsTaskStep(page, tabNumber, step, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const ready = await page.evaluate((expectedStep) => {
            const visible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                return rect.width > 0 && rect.height > 0
                    && style.visibility !== 'hidden' && style.display !== 'none';
            };
            const buttons = Array.from(document.querySelectorAll(
                'button, [role="button"], [class*="btn"], [class*="button"]'
            )).filter(visible);
            return expectedStep === 'task'
                ? buttons.some(el => /\bsend(?:\s+task)?\b/i.test(
                    (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
                ))
                : buttons.some(el => /\bconfirm\b/i.test(
                    (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
                ));
        }, step).catch(() => false);
        if (ready) return;
        await delay(250);
    }

    const diagnostics = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        buttons: Array.from(document.querySelectorAll('button, [role="button"], [class*="btn"], [class*="button"]'))
            .filter(el => el.offsetParent !== null)
            .map(el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .slice(0, 20),
        body: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 300)
    })).catch(() => ({ url: 'unavailable', title: '', buttons: [], body: '' }));
    throw new Error(`Tab ${tabNumber} timed out waiting for ${step} readiness after ${timeoutMs}ms. URL=${diagnostics.url}; buttons=${JSON.stringify(diagnostics.buttons)}; body=${JSON.stringify(diagnostics.body)}`);
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
    let ownsBrowser = false;
    let pages = [];
    let totalPoints = 0;
    let totalSuccess = 0;
    let initialTodayPoints = null;
    let finalTodayPoints = null;
    let currentBalance = null;
    let lastFeedbackResults = [];
    let lastPointsPerTask = null;
    let loopCount = 1;

    try {
        if (await isPuppeteerBrowserHealthy(globalTaskBrowser)) {
            browser = globalTaskBrowser;
            console.log('[TASK] Reusing shared Chrome browser for /task tabs.');
        } else {
            browser = await launchScraperBrowser();
            ownsBrowser = true;
            console.log('[TASK] Launched dedicated Chrome browser for direct /task.');
        }

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
                await waitForWsjobsTaskStep(page, activePages.indexOf(page) + 1, 'task');
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
                                // Extract and canonicalize the phone number from
                                // this card so duplicate claims can be rejected.
                                const textMatch = (curr.innerText || '').match(/\+?\s*\d[\d\s().-]{7,}\d/g);
                                const normalizedNumber = textMatch
                                    ? textMatch[0].replace(/\D/g, '')
                                    : '';
                                if (normalizedNumber.length < 8 || normalizedNumber.length > 15) {
                                    return 'Unknown';
                                }
                                const foundNumber = `+${normalizedNumber}`;

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
                throw new Error(`Only ${activeTabsCount - unknownClaims}/${activeTabsCount} tab(s) claimed a matching task; exact phone numbers could not be verified.`);
            }

            const claimIndexByNumber = new Map();
            const duplicateClaims = [];
            claimedNumbers.forEach((number, index) => {
                const normalized = String(number).replace(/\D/g, '');
                if (claimIndexByNumber.has(normalized)) {
                    duplicateClaims.push(`${number} (Tabs ${claimIndexByNumber.get(normalized) + 1} and ${index + 1})`);
                } else {
                    claimIndexByNumber.set(normalized, index);
                }
            });
            if (duplicateClaims.length > 0) {
                throw new Error(`Duplicate task claim detected before Confirm: ${duplicateClaims.join('; ')}.`);
            }

            // WAIT FOR EVERY CONFIRM MODAL TO BE READY. Do not suppress a
            // missing modal: that would make the final report claim tabs ran
            // when only a subset actually submitted.
            await updateStatus(`[SYSTEM] Loop ${loopCount}: Synchronizing ${activeTabsCount} confirmation modal(s)...`);
            // Wait for every tab one by one. Only after this loop completes are
            // all tabs guaranteed to be sitting at Confirm.
            for (const page of activePages) {
                await waitForWsjobsTaskStep(page, activePages.indexOf(page) + 1, 'Confirm');
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
                await updateStatus(`[SYSTEM] Loop ${loopCount}: Waiting for feedback from Tab ${idx + 1}/${activeTabsCount}...`);
                const result = await waitForWsjobsTaskFeedbackPuppeteer(
                    activePages[idx], idx + 1, 15000
                );
                feedbackResults.push(result);
                await updateStatus(`[SYSTEM] Loop ${loopCount}: Tab ${idx + 1}/${activeTabsCount} reported ${result.status}.`);
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
            if (successfulFeedback > 0 && Number.isFinite(loopPointsEarned)) {
                lastPointsPerTask = loopPointsEarned / successfulFeedback;
            }
            totalPoints = finalTodayPoints - initialTodayPoints;
            totalSuccess += successfulFeedback;

            const feedbackSummary = feedbackResults.map(result =>
                `Tab ${result.tabNumber}: ${result.status}${result.message ? ` (${result.message})` : ''}`
            ).join('\n');
            const targetsClaimedStr = claimedNumbers.join('\n');
            const loopDollarsEarned = loopPointsEarned / WSJOBS_POINTS_PER_DOLLAR;
            const totalDollarsEarned = totalPoints / WSJOBS_POINTS_PER_DOLLAR;
            await updateStatus(`[SYSTEM] Loop ${loopCount} Result:\n\nTargets Hit:\n${targetsClaimedStr}\n\nFeedback:\n${feedbackSummary}\n\nToday Points: ${startingPoints} → ${finalTodayPoints}\nLoop Points Earned: $${loopDollarsEarned.toFixed(2)} (${loopPointsEarned} points)\nTotal Earned: $${totalDollarsEarned.toFixed(2)} (${totalPoints} points)`);

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

        // Fetch the current account balance only after every task tab has
        // reported and the points refresh is complete.
        await updateStatus('[SYSTEM] All task tabs finished. Refreshing account balance...');
        await masterPage.goto(wsjobsUrl(WSJOBS_ACCOUNT_PATH), {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await delay(4000);
        if (new URL(masterPage.url()).pathname.endsWith(WSJOBS_LOGIN_PATH)) {
            await loginToWsjobsPuppeteer(masterPage);
            await masterPage.goto(wsjobsUrl(WSJOBS_ACCOUNT_PATH), {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            await delay(3000);
        }
        currentBalance = await readWsjobsCurrentBalancePuppeteer(masterPage);
        if (currentBalance === null) {
            throw new Error('Could not read the current account balance after the task finished.');
        }
        const formattedBalance = currentBalance.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        const finalFeedbackSummary = lastFeedbackResults.length
            ? lastFeedbackResults.map(result => `Tab ${result.tabNumber}: ${result.status}`).join('\n')
            : 'No tab feedback recorded.';
        const pointsPerTaskText = lastPointsPerTask === null
            ? 'Unavailable'
            : `$${(lastPointsPerTask / WSJOBS_POINTS_PER_DOLLAR).toFixed(2)} (${lastPointsPerTask.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} points)`;
        const dollarsEarnedText = `$${(totalPoints / WSJOBS_POINTS_PER_DOLLAR).toFixed(2)} (${totalPoints.toLocaleString()} points)`;
        await updateStatus(`[SYSTEM] Strike Protocol Finished.\n\nVerified successful tabs: ${totalSuccess}\nEarned: ${dollarsEarnedText}\nPer Successful Task: ${pointsPerTaskText}\nBalance: ${formattedBalance}\n\nLast tab feedback:\n${finalFeedbackSummary}`);

        const finalSnap = await masterPage.screenshot({ type: 'png' }).catch(() => null);

        if (!finalSnap) {
            await bot.sendMessage(chatId, `[SYSTEM] Strike Protocol Complete. Screenshot capture timed out; final balance: ${formattedBalance}.`);
        } else {
            await bot.sendPhoto(chatId, finalSnap, {
            caption: `*Strike Protocol Complete*\nSuffix: \`${targetSuffix}\`\nVerified Successful Tabs: \`${totalSuccess}\`\nEarned: \`${dollarsEarnedText}\`\nPer Successful Task: \`${pointsPerTaskText}\`\nBalance: \`${formattedBalance}\`\n\nLast Tab Feedback:\n${finalFeedbackSummary}`,
            parse_mode: 'Markdown'
        });
        }

        await bot.deleteMessage(chatId, msgId).catch(() => {});

    } catch (err) {
        await bot.sendMessage(chatId, `[STRIKE FAILED]: ${err.message}`);
    } finally {
        if (ownsBrowser && browser) {
            await browser.close().catch(() => {});
        } else {
            // Keep the shared Chrome session alive for RADAR and later /task
            // requests, but remove this command's temporary tabs.
            for (const page of pages) {
                await page.close().catch(() => {});
            }
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





async function injectWsjobsHumanSniper(page) {
    await page.evaluateOnNewDocument(() => {
        setInterval(() => {
            const okBtn = Array.from(document.querySelectorAll('button, [class*="btn"]'))
                .find(el => el.innerText?.trim() === 'OK' && el.offsetHeight > 0);
            if (!okBtn) return;
            const rect = okBtn.getBoundingClientRect();
            ['mousedown', 'mouseup', 'click'].forEach(type => {
                okBtn.dispatchEvent(new MouseEvent(type, {
                    view: window, bubbles: true, cancelable: true,
                    clientX: rect.left + rect.width / 2,
                    clientY: rect.top + rect.height / 2
                }));
            });
            setTimeout(() => {
                const modal = okBtn.closest('div[class*="modal"], div[class*="mask"], .van-overlay');
                if (modal) modal.remove();
                document.body.style.filter = 'none';
                document.body.style.overflow = 'auto';
            }, 800);
        }, 300);
    });
}

async function runWsjobsWithdrawalTask(msg) {
    const chatId = msg.chat.id.toString();
    const adminId = process.env.ADMIN_ID || '7710721646';
    if (chatId !== adminId && (typeof AUTHORIZED !== 'undefined' && !AUTHORIZED.includes(chatId))) return;

    const TOTAL_TABS = 5;
    let statusMsg = await bot.sendMessage(chatId, `[SYSTEM] Booting Chrome for Secure ${TOTAL_TABS}-Tab Withdrawal...`);
    const videoDir = path.join(__dirname, 'videos');
    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir);

    let browser = null;
    let pages = [];

    try {
        browser = await launchScraperBrowser();

        // ==========================================
        // 1. MASTER TAB BOOT & LOGIN
        // ==========================================
        const masterPage = await browser.newPage();
        await masterPage.setViewport({ width: 412, height: 915 });
        pages.push(masterPage);
        await injectWsjobsHumanSniper(masterPage);

        await bot.editMessageText('[SYSTEM] Navigating to Account & Logging in...', { chat_id: chatId, message_id: statusMsg.message_id });
        await masterPage.goto(wsjobsUrl(WSJOBS_ACCOUNT_PATH), { waitUntil: 'domcontentloaded' });
        await delay(4000);

        await loginToWsjobsPuppeteer(masterPage);

        // Teleport directly to the new withdraw page
        await masterPage.goto(wsjobsUrl(WSJOBS_WITHDRAW_PATH), { waitUntil: 'domcontentloaded' });
        await delay(5000);

        // --- 2. PRECISION BALANCE SCRAPER (NEW UI) ---
        const rawBalance = await masterPage.evaluate(() => {
            const allText = document.body.innerText;
            // Target the "Available: 10175.00" text directly
            const availMatch = allText.match(/Available:\s*([\d,.]+)/i);
            if (availMatch) {
                return parseFloat(availMatch[1].replace(/,/g, ''));
            }
            // Fallback scanner
            const decimalMatches = allText.match(/\d+\.\d{2}/g);
            if (decimalMatches) return Math.max(...decimalMatches.map(n => parseFloat(n)));
            return 0;
        });

        // New Menu Tiers based on the screenshot
        const tiers = [100000, 50000, 40000, 30000, 20000, 10000];
        const targetAmount = tiers.find(t => rawBalance >= t);

        if (!targetAmount) {
            const errSnap = await masterPage.screenshot();
            await bot.sendPhoto(chatId, errSnap, {
                caption: `[DIAGNOSTIC] Detected Balance: ${rawBalance}. Too low for minimum 10,000 withdrawal.`
            }, { filename: 'low_balance.png' });
            throw new Error(`Balance ${rawBalance} is too low.`);
        }

        await bot.editMessageText(`[SYSTEM] Target Acquired: ${targetAmount.toLocaleString()}. Processing ${TOTAL_TABS} tabs sequentially...`, { chat_id: chatId, message_id: statusMsg.message_id }).catch(() => {});

        // ==========================================
        // 3. SEQUENTIAL TAB PREPARATION (ONE BY ONE)
        // ==========================================
        for (let i = 0; i < TOTAL_TABS; i++) {
            let p;
            if (i === 0) {
                p = masterPage;
            } else {
                p = await browser.newPage();
                await p.setViewport({ width: 412, height: 915 });
                pages.push(p);
                await injectWsjobsHumanSniper(p);

                await p.goto(wsjobsUrl(WSJOBS_WITHDRAW_PATH), { waitUntil: 'domcontentloaded' });
                await delay(4000);
            }

            console.log(`[TAB ${i + 1}] Processing...`);

            // 1. Click the Amount Chip (e.g. "10,000")
            await p.evaluate((amt) => {
                const amtStr = amt.toLocaleString('en-US'); // Formats to "10,000"
                const chips = Array.from(document.querySelectorAll('div, span, button, [class*="item"]'));
                const targetChip = chips.find(c => c.innerText?.trim() === amtStr && c.offsetHeight > 0);
                if (targetChip) {
                    targetChip.click();
                    targetChip.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, targetAmount);

            await delay(2000);

            // 2. NUCLEAR BUTTON STRIKE (Submit Withdrawal)
            await p.evaluate(() => {
                const mainBtn = Array.from(document.querySelectorAll('button, div, span, [class*="btn"]'))
                    .reverse()
                    .find(b => b.innerText?.trim() === 'Submit Withdrawal' && b.offsetHeight > 0);

                if (mainBtn) {
                    const ev = { bubbles: true, cancelable: true, view: window };
                    ['mousedown', 'mouseup', 'click'].forEach(t => mainBtn.dispatchEvent(new MouseEvent(t, ev)));
                    mainBtn.click();
                }
            });

            await delay(2500);

            // 3. PASSWORD ENTRY & LOCK IN (101010)
            await p.waitForFunction(() => Array.from(document.querySelectorAll('input')).some(input => {
                const rect = input.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            }), { timeout: 15000 });
            const inputHandles = await p.$$('input');
            let passInput = null;
            for (const candidate of inputHandles.reverse()) {
                if (await candidate.boundingBox().catch(() => null)) {
                    passInput = candidate;
                    break;
                }
            }
            if (!passInput) throw new Error(`Tab ${i + 1}: withdrawal PIN input was not visible.`);
            await passInput.click();
            await passInput.press('Control+A').catch(async () => {
                await p.keyboard.down('Control');
                await p.keyboard.press('A');
                await p.keyboard.up('Control');
            });
            await passInput.type('101010'); // Existing configured withdrawal PIN flow

            await delay(1000);

            console.log(`[TAB ${i + 1}] Sitting at Confirm Modal.`);
        }

        // ==========================================
        // 4. SYNCHRONIZED MASS STRIKE (PROMISE.ALL)
        // ==========================================
        await bot.editMessageText(`[SYSTEM] All ${TOTAL_TABS} tabs loaded. Firing simultaneous "Continue" strike!`, { chat_id: chatId, message_id: statusMsg.message_id });

        await Promise.all(pages.map(async (p, i) => {
            try {
                await p.evaluate(() => {
                    const elements = Array.from(document.querySelectorAll('button, div, span, [class*="btn"]'));
                    const finalBtn = elements.reverse().find(b => b.innerText?.trim() === 'Continue' && b.offsetHeight > 0);

                    if (finalBtn) {
                        const evData = { bubbles: true, cancelable: true, view: window };
                        ['mousedown', 'mouseup', 'click'].forEach(t => finalBtn.dispatchEvent(new MouseEvent(t, evData)));
                        finalBtn.click();
                    }
                });

                console.log(`[TAB ${i + 1}] Strike Executed`);
            } catch (err) {
                console.log(`[TAB ${i + 1}] Strike Error: ${err.message}`);
            }
        }));

        await delay(2000);

        // ==========================================
        // 5. COMPLETION, BALANCE CAPTURE & DELIVERY
        // ==========================================
        await bot.editMessageText(`[SYSTEM] Strike complete. Capturing balance and screenshot...`, { chat_id: chatId, message_id: statusMsg.message_id }).catch(() => {});

        let refreshError = null;
        try {
            await masterPage.goto(wsjobsUrl(WSJOBS_ACCOUNT_PATH), {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            });
            await delay(1500);
        } catch (error) {
            refreshError = error.message;
        }

        const finalBalance = await readWsjobsCurrentBalancePuppeteer(masterPage);
        const balanceText = finalBalance === null
            ? 'Unavailable'
            : finalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const finalSnap = await masterPage.screenshot({ type: 'png' }).catch(() => null);

        await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        const completionText = `[SUCCESS] Mass Withdrawal Strike (${TOTAL_TABS} Tabs) submitted.\\nBalance: ${balanceText}${refreshError ? `\\nAccount refresh note: ${refreshError}` : ''}`;
        if (finalSnap) {
            await bot.sendPhoto(chatId, finalSnap,
                { caption: completionText },
                { filename: 'withdraw_final.png' }
            );
        } else {
            await bot.sendMessage(chatId, `${completionText}\\nScreenshot capture timed out.`);
        }

    } catch (err) {
        console.log(`[WITHDRAW ERROR]: ${err.message}`);
        await bot.sendMessage(chatId, `[WITHDRAW ERROR]: ${err.message}`).catch(() => {});

        try {
            const errSnap = await pages[0]?.screenshot({ type: 'png' }).catch(() => null);
            if (errSnap) {
                await bot.sendPhoto(chatId, errSnap, { caption: `[DIAGNOSTIC] Chrome screen state at failure.` }).catch(() => {});
            }
        } catch (e) {}
    } finally {
        for (const p of pages) await p.close().catch(() => {});
        if (browser) await browser.close().catch(() => {});
    }
}

// The menu button requests explicit confirmation before submitting a withdrawal.
bot.onText(/^Withdraw$/i, async (msg) => {
    const chatId = msg.chat.id.toString();
    const adminId = process.env.ADMIN_ID || '7710721646';
    if (chatId !== adminId && (typeof AUTHORIZED !== 'undefined' && !AUTHORIZED.includes(chatId))) return;

    await bot.sendMessage(chatId,
        'This will open the Wsjobs withdrawal task and submit the configured withdrawal amount across its tabs. Confirm to continue.',
        { reply_markup: { inline_keyboard: [[
            { text: 'Confirm Withdraw', callback_data: 'wsjobs_withdraw_confirm' },
            { text: 'Cancel', callback_data: 'wsjobs_withdraw_cancel' }
        ]] } }
    );
});

bot.on('callback_query', async (query) => {
    const chatId = String(query.message?.chat?.id || '');
    const adminId = process.env.ADMIN_ID || '7710721646';
    if (!chatId || (chatId !== adminId && (typeof AUTHORIZED !== 'undefined' && !AUTHORIZED.includes(chatId)))) {
        await bot.answerCallbackQuery(query.id).catch(() => {});
        return;
    }

    if (query.data === 'wsjobs_pair_cancel') {
        const pairingSession = wsPairSessions.get(chatId);
        if (!pairingSession) {
            await bot.answerCallbackQuery(query.id, { text: 'No active pairing sequence.' }).catch(() => {});
            return;
        }
        pairingSession.cancelled = true;
        await bot.answerCallbackQuery(query.id, { text: 'Pairing cancelled.' }).catch(() => {});
        await bot.editMessageText('[PAIRING CANCELLED] Stopping this number’s pairing sequence. The Chrome session will remain open.', {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { inline_keyboard: [] }
        }).catch(() => {});
        return;
    }

    if (query.data === 'wsjobs_withdraw_cancel') {
        await bot.answerCallbackQuery(query.id, { text: 'Withdrawal cancelled.' }).catch(() => {});
        await bot.editMessageText('Withdrawal cancelled.', {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { inline_keyboard: [] }
        }).catch(() => {});
        return;
    }

    if (query.data === 'wsjobs_withdraw_confirm') {
        await bot.answerCallbackQuery(query.id, { text: 'Withdrawal confirmed.' }).catch(() => {});
        await bot.editMessageText('Withdrawal confirmed. Starting the Wsjobs withdrawal task...', {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { inline_keyboard: [] }
        }).catch(() => {});
        await runWsjobsWithdrawalTask({ chat: { id: chatId } });
    }
});

bot.onText(/\/withdraw\s+task/i, runWsjobsWithdrawalTask);

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

        // Read the visible pairing-code element itself. Do not scan the whole
        // page for any eight-character word: the dashboard contains unrelated
        // text such as "WHATSAPP", which previously looked like a code and
        // prevented the disappearance check from ever becoming true.
        const visible = (el) => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0
                && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const codePattern = /\b(?:\d{4}\s*[-–—]\s*\d{4}|\d{8}|[A-Z0-9]{4}\s*[-–—]\s*[A-Z0-9]{4})\b/gi;
        const codeElements = Array.from(document.querySelectorAll('*'))
            .filter(visible)
            .map(el => ({ el, text: (el.innerText || '').replace(/\s+/g, ' ').trim() }))
            .filter(({ text }) => text.length > 0 && text.length <= 80)
            .map(({ el, text }) => ({ el, text, matches: text.match(codePattern) || [] }))
            .filter(({ matches }) => matches.length > 0);

        // Prefer the smallest visible element containing a code. This avoids
        // selecting a large parent card whose text also contains other labels.
        codeElements.sort((a, b) => a.text.length - b.text.length);
        const candidates = codeElements.flatMap(({ matches }) => matches);
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
    const pairingSession = wsPairSessions.get(chatId);
    if (pairingSession) pairingSession.statusMessageId = statusMsg.message_id;
    const throwIfPairingCancelled = () => {
        if (wsPairSessions.get(chatId)?.cancelled) {
            const error = new Error('Pairing cancelled by user.');
            error.code = 'WS_PAIR_CANCELLED';
            throw error;
        }
    };
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
            throwIfPairingCancelled();
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
                throwIfPairingCancelled();
                await delay(1000);
                throwIfPairingCancelled();
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
                            }], [{
                                text: 'Cancel Pairing',
                                callback_data: 'wsjobs_pair_cancel'
                            }]]
                    }
                }
            );

            let disappearedChecks = 0;
            const deadline = Date.now() + 180000;
            while (Date.now() < deadline) {
                throwIfPairingCancelled();
                await delay(500);
                throwIfPairingCancelled();
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

        // --- ADDED AUTO-TRIGGER LOGIC HERE ---
        const targetSuffix = phoneInfo.localNumber.slice(-2); // Extract last 2 digits

        await updateStatus(`[PAIRING COMPLETE] All 4 numbers were processed successfully.\n\nAuto-Triggering Task Strike Protocol for suffix ${targetSuffix}...`, {
            reply_markup: { remove_keyboard: true }
        });

        // Automatically feed the task command back into the bot
        bot.processUpdate({
            update_id: Date.now(),
            message: {
                message_id: Date.now(),
                from: { id: parseInt(chatId) },
                chat: { id: parseInt(chatId), type: 'private' },
                date: Math.floor(Date.now() / 1000),
                text: `/task ${targetSuffix}`
            }
        });

    } catch (error) {
        if (error.code === 'WS_PAIR_CANCELLED') {
            await updateStatus('[PAIRING CANCELLED] This number’s pairing sequence was stopped. The Chrome session remains open for the next number.', {
                reply_markup: { inline_keyboard: [] }
            });
        } else {
            await updateStatus(`[PAIRING FAILED] ${error.message}`);
            await sendWsjobsPairingDiagnostics(chatId, runtime, error.message);
        }
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
        wsPairSessions.set(chatId, { startedAt: Date.now(), number: pairInput.internationalNumber, cancelled: false });
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
