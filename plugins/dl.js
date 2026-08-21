const { Module } = require('../main');
const config = require('../config');
const { setVar } = require('../plugins/manage');
const axios = require('axios');

const SUPPORTED_URL_REGEX = /https?:\/\/[^\s]+/i;
const ADULT_VIDEO_HOSTS = new Set([
    'pornhub.com',
    'xvideos.com',
    'xnxx.com',
    'xhamster.com',
    'redtube.com',
    'spankbang.com',
    'tube8.com',
    'eporner.com',
    'txxx.com',
    'youporn.com'
]);

function isAutodlOn() {
    return config.AUTODL_ENABLED === 'true';
}

function isPublicAdultVideoUrl(rawUrl) {
    try {
        const hostname = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
        return [...ADULT_VIDEO_HOSTS].some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
    } catch {
        return false;
    }
}

async function setAutodl(on) {
    await setVar('AUTODL_ENABLED', on ? 'true' : 'false');
}

function getHeaderCaption(headers) {
    const value = headers['x-media-caption'];
    if (!value) return '';
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function getVideoBuffer(response) {
    const mediaBuffer = Buffer.from(response.data);
    const ftypIndex = mediaBuffer.indexOf(Buffer.from('ftyp', 'ascii'));
    if (ftypIndex > 0 && ftypIndex < 100) {
        return mediaBuffer.slice(ftypIndex - 4);
    }
    return mediaBuffer;
}

async function sendVideoResponse(message, targetUrl, buffer, caption) {
    if (isPublicAdultVideoUrl(targetUrl)) {
        return message.sendMessage(buffer, 'document', {
            fileName: `adult-video-${Date.now()}.mp4`,
            mimetype: 'video/mp4',
            caption: caption || undefined
        });
    }
    return message.sendMessage(buffer, 'video', {
        caption: caption || undefined
    });
}

async function deleteSuccessfulGroupLink(message) {
    if (!message.isGroup) return;
    try {
        if (typeof message.delete === 'function') {
            await message.delete();
            return;
        }
        const messageKey = message.key || message.data?.key;
        if (messageKey && message.client && typeof message.client.sendMessage === 'function') {
            await message.client.sendMessage(message.jid, { delete: messageKey });
        }
    } catch {}
}

async function performDownload(message, targetUrl, options = {}) {
    const silent = Boolean(options.silent);
    const baseUrl = config.PAIRING_URL;
    if (!baseUrl) {
        if (!silent) await message.sendReply('_Error: download engine URL is not configured._');
        return;
    }

    const engineUrl = `${baseUrl.replace(/\/+$/, '')}/api/download`;
    const sent = silent ? null : await message.sendReply('_Processing..._');

    try {
        const response = await axios.get(`${engineUrl}?url=${encodeURIComponent(targetUrl)}`, {
            responseType: 'arraybuffer',
            validateStatus: () => true,
            timeout: 600000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        if (response.status >= 400) {
            if (silent) return;
            let errorMessage = 'Extraction failed.';
            try {
                errorMessage = JSON.parse(Buffer.from(response.data).toString('utf8')).error || errorMessage;
            } catch {}
            await message.edit(`_Engine error:_ ${errorMessage}`, message.jid, sent.key);
            return;
        }

        const contentType = response.headers['content-type'] || '';
        const headerCaption = getHeaderCaption(response.headers);

        if (contentType.includes('application/json')) {
            const data = JSON.parse(Buffer.from(response.data).toString('utf8'));
            if (data.type !== 'images' || !Array.isArray(data.urls) || data.urls.length === 0) {
                if (!silent) await message.edit('_Unrecognized response from the engine._', message.jid, sent.key);
                return;
            }

            if (!silent) await message.edit('_[Ultar Sync] Success_', message.jid, sent.key);
            for (const imageUrl of data.urls) {
                await message.sendMessage({ url: imageUrl }, 'image');
            }
            const slideshowCaption = data.caption || headerCaption;
            if (slideshowCaption && slideshowCaption.trim()) {
                await message.sendReply(slideshowCaption.trim());
            }
            await deleteSuccessfulGroupLink(message);
            return;
        }

        const mediaBuffer = getVideoBuffer(response);
        if (!mediaBuffer.length) throw new Error('The engine returned an empty media response.');
        if (!silent) await message.edit('_[Ultar Sync] Success_', message.jid, sent.key);
        await sendVideoResponse(message, targetUrl, mediaBuffer, headerCaption);
        await deleteSuccessfulGroupLink(message);
    } catch (error) {
        if (silent) return;
        await message.edit(`_Network error:_ could not reach the engine.\n${error.message}`, message.jid, sent.key);
    }
}

Module({
    pattern: 'dl ?(.*)',
    desc: 'Download media through the central Ultar API engine or toggle autodl.',
    use: 'misc',
    usage: 'dl <url> | dl on|off'
}, async (message, match) => {
    const argument = (match[1] || '').trim();
    const argumentLower = argument.toLowerCase();

    if (argumentLower === 'on' || argumentLower === 'off') {
        await setAutodl(argumentLower === 'on');
        return message.sendReply(`_Autodl turned_ \`${argumentLower}\`_.`);
    }

    let targetUrl = argument;
    if (!targetUrl && message.reply_message && message.reply_message.text) {
        targetUrl = message.reply_message.text.match(SUPPORTED_URL_REGEX)?.[0] || '';
    }
    if (!targetUrl) {
        return message.sendReply('_Please provide a link, or reply to a message containing one._');
    }
    await performDownload(message, targetUrl);
});

Module({
    on: 'text',
    fromMe: false
}, async message => {
    if (!message.isGroup || !isAutodlOn() || !message.text) return;
    const targetUrl = message.text.match(SUPPORTED_URL_REGEX)?.[0];
    if (targetUrl) await performDownload(message, targetUrl, { silent: true });
});
