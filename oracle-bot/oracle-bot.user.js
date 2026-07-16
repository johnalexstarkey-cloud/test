// ==UserScript==
// @name         Oracle Bot — Discord Debate Log Exporter
// @namespace    https://github.com/johnalexstarkey-cloud/test
// @version      1.2.0
// @description  Consult the machine god. Export a range of Discord messages (between two message links) into a Markdown debate transcript with reply threading, shared images, and links, bundled as a ZIP for AI review. Dependency-free — runs in Greasemonkey, Tampermonkey, and Violentmonkey.
// @author       you
// @match        https://discord.com/*
// @match        https://*.discord.com/*
// @icon         https://discord.com/assets/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        unsafeWindow
// @connect      cdn.discordapp.com
// @connect      media.discordapp.net
// @connect      discord.com
// @run-at       document-idle
// ==/UserScript==

/*
 * ORACLE BOT — consult the machine god about who won the debate.
 *
 * WHAT THIS DOES
 *  - You paste the message LINK of the first message and the LAST message of a debate
 *    (right-click a message -> "Copy Message Link").
 *  - It fetches every message in between (inclusive) using your own logged-in session.
 *  - It writes a Markdown transcript that records who replied to whom, downloads the
 *    images that were shared, and lists every link.
 *  - Everything is bundled into a single .zip you can hand to an AI for a debate verdict.
 *
 * DEPENDENCY-FREE
 *  - No @require, no external libraries. The ZIP is built by a small built-in writer,
 *    so it works the same in Greasemonkey, Tampermonkey, and Violentmonkey.
 *
 * RATE LIMITS
 *  - Discord throttles the message-history endpoint. Oracle Bot paces itself (~1.2s
 *    between page fetches), honours `retry_after` on HTTP 429, respects the
 *    X-RateLimit-Remaining/Reset-After headers, and backs off automatically.
 *
 * ACCOUNT RISK
 *  - Automating a user account is against Discord's Terms of Service ("self-botting")
 *    and can, in principle, get your account actioned. This tool is read-only and gentle,
 *    but the risk is non-zero. See README for the official Bot API route if you want a
 *    fully compliant setup.
 */

(function () {
  'use strict';

  const HAS_DOM = typeof document !== 'undefined' && typeof window !== 'undefined';
  if (HAS_DOM) {
    if (window.__oracleBotLoaded) return;
    window.__oracleBotLoaded = true;
  }

  // In Firefox (Greasemonkey/Tampermonkey/Violentmonkey), page globals like
  // webpackChunkdiscord_app live behind an Xray wrapper — reach them via unsafeWindow.
  const pageWindow =
    (typeof unsafeWindow !== 'undefined' && unsafeWindow) ||
    (typeof window !== 'undefined' ? window : undefined);

  // ----------------------------------------------------------------------------
  // Small helpers
  // ----------------------------------------------------------------------------
  const DISCORD_EPOCH = 1420070400000n; // 2015-01-01, for snowflake math
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const gmRequest =
    (typeof GM_xmlhttpRequest !== 'undefined' && GM_xmlhttpRequest) ||
    (typeof GM !== 'undefined' && GM.xmlHttpRequest) ||
    null;

  function cmpSnowflake(a, b) {
    const x = BigInt(a), y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }

  function snowflakeToDate(id) {
    return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
  }

  function fmtDate(d) {
    const p = (n) => String(n).padStart(2, '0');
    return (
      `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
      `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
    );
  }

  function sanitizeFilename(name) {
    return (name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
  }

  function parseMessageLink(link) {
    // https://discord.com/channels/{guild|@me}/{channel}/{message}
    const m = String(link).trim().match(/channels\/(@me|\d+)\/(\d+)\/(\d+)/);
    if (!m) return null;
    return { guildId: m[1], channelId: m[2], messageId: m[3] };
  }

  // ----------------------------------------------------------------------------
  // Minimal store-only ZIP writer (no compression, no dependencies).
  // Produces a standard .zip openable by Windows/macOS/Linux/7-Zip.
  // ----------------------------------------------------------------------------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function concatBytes(parts) {
    let len = 0;
    for (const p of parts) len += p.length;
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  const u16 = (n) => new Uint8Array([n & 255, (n >> 8) & 255]);
  const u32 = (n) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);

  function createZip(files) {
    // files: [{ name: string, data: Uint8Array }]
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const push = (arr) => { chunks.push(arr); offset += arr.length; };

    for (const f of files) {
      const nameBytes = enc.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const size = data.length;
      const localOffset = offset;

      const local = concatBytes([
        u32(0x04034b50), u16(20), u16(0x0800), u16(0), // sig, ver, flags(utf8), method=store
        u16(0), u16(0),                                 // mod time/date
        u32(crc), u32(size), u32(size),                 // crc, compressed, uncompressed
        u16(nameBytes.length), u16(0),                  // name len, extra len
        nameBytes,
      ]);
      push(local);
      push(data);

      central.push(concatBytes([
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0),
        u16(0), u16(0),
        u32(crc), u32(size), u32(size),
        u16(nameBytes.length), u16(0), u16(0),
        u16(0), u16(0), u32(0),
        u32(localOffset),
        nameBytes,
      ]));
    }

    const cdStart = offset;
    let cdSize = 0;
    for (const cd of central) { push(cd); cdSize += cd.length; }

    push(concatBytes([
      u32(0x06054b50), u16(0), u16(0),
      u16(central.length), u16(central.length),
      u32(cdSize), u32(cdStart), u16(0),
    ]));

    return new Blob(chunks, { type: 'application/zip' });
  }

  // ----------------------------------------------------------------------------
  // Auth token (from Discord's own webpack modules; localStorage fallback)
  // ----------------------------------------------------------------------------
  function getToken() {
    let token = null;
    try {
      pageWindow.webpackChunkdiscord_app.push([
        [Math.random()],
        {},
        (req) => {
          for (const id of Object.keys(req.c)) {
            const mod = req.c[id];
            const exp = mod && mod.exports;
            if (!exp) continue;
            try {
              if (exp.default && typeof exp.default.getToken === 'function') {
                token = exp.default.getToken();
              } else if (typeof exp.getToken === 'function') {
                token = exp.getToken();
              }
            } catch (_) {}
          }
        },
      ]);
    } catch (_) {}
    if (token) return token;

    try {
      const iframe = document.createElement('iframe');
      document.head.appendChild(iframe);
      const raw = iframe.contentWindow.localStorage.token;
      iframe.remove();
      if (raw) token = JSON.parse(raw);
    } catch (_) {}
    return token;
  }

  // ----------------------------------------------------------------------------
  // Fetch a contiguous message range [startId, endId] from one channel.
  // ----------------------------------------------------------------------------
  async function fetchRange({ token, channelId, startId, endId }, opts, log, onProgress, shouldStop) {
    const messages = [];
    let after = (BigInt(startId) - 1n).toString(); // -1 so the start message is included
    let baseDelay = opts.requestDelay;
    let done = false;
    const HARD_CAP = 200000;

    while (!done) {
      if (shouldStop()) throw new Error('Cancelled by user.');
      if (messages.length > HARD_CAP) {
        log(`Reached safety cap of ${HARD_CAP} messages; stopping.`, 'warn');
        break;
      }

      const url =
        `https://discord.com/api/v10/channels/${channelId}/messages?limit=100&after=${after}`;
      let resp;
      try {
        resp = await fetch(url, { headers: { Authorization: token }, credentials: 'include' });
      } catch (e) {
        log(`Network error, retrying in 3s: ${e.message}`, 'warn');
        await sleep(3000);
        continue;
      }

      if (resp.status === 429) {
        let body = {};
        try { body = await resp.json(); } catch (_) {}
        const wait = Math.ceil((body.retry_after ? body.retry_after * 1000 : baseDelay) + 600);
        baseDelay = Math.min(baseDelay * 1.5, 10000);
        log(`Rate limited — waiting ${(wait / 1000).toFixed(1)}s (base delay now ${baseDelay}ms).`, 'warn');
        await sleep(wait);
        continue;
      }
      if (resp.status === 401) throw new Error('401 Unauthorized — could not read your token, or it is stale. Reload Discord and try again.');
      if (resp.status === 403) throw new Error('403 Forbidden — your account cannot read this channel.');
      if (!resp.ok) throw new Error(`Unexpected HTTP ${resp.status} fetching messages.`);

      let batch;
      try { batch = await resp.json(); } catch (e) { throw new Error('Could not parse message batch.'); }
      if (!Array.isArray(batch) || batch.length === 0) break;

      batch.sort((a, b) => cmpSnowflake(a.id, b.id)); // oldest -> newest

      for (const msg of batch) {
        if (cmpSnowflake(msg.id, endId) > 0) { done = true; break; }
        messages.push(msg);
      }

      after = batch[batch.length - 1].id;
      if (batch.length < 100) done = true;

      onProgress(messages.length);
      log(`Fetched ${messages.length} messages so far…`);

      const remaining = resp.headers.get('x-ratelimit-remaining');
      const resetAfter = parseFloat(resp.headers.get('x-ratelimit-reset-after') || '0');
      if (remaining !== null && parseInt(remaining, 10) <= 0 && resetAfter > 0) {
        await sleep(resetAfter * 1000 + 300);
      } else if (!done) {
        await sleep(baseDelay);
      }
    }
    return messages;
  }

  // ----------------------------------------------------------------------------
  // Turn raw messages into a Markdown transcript + collect images/links.
  // ----------------------------------------------------------------------------
  function cleanContent(msg) {
    let text = msg.content || '';
    const nameById = {};
    (msg.mentions || []).forEach((u) => {
      nameById[u.id] = u.global_name || u.username || u.id;
    });
    text = text.replace(/<@!?(\d+)>/g, (_, id) => '@' + (nameById[id] || 'user'));
    text = text.replace(/<#(\d+)>/g, '#channel');
    text = text.replace(/<@&(\d+)>/g, '@role');
    text = text.replace(/<a?:(\w+):\d+>/g, ':$1:');
    return text;
  }

  function displayName(author) {
    if (!author) return 'unknown';
    return author.global_name || author.username || 'unknown';
  }

  function snippet(text, n = 80) {
    const s = (text || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) + '…' : s || '(no text)';
  }

  const URL_RE = /(https?:\/\/[^\s<>()]+)/g;

  // Work out the real file type + canonical extension for an image, preferring
  // the server-supplied content type and falling back to the filename/URL.
  function imageMeta(contentType, filenameOrUrl) {
    let ext = '';
    if (contentType && contentType.toLowerCase().startsWith('image/')) {
      ext = contentType.toLowerCase().split('/')[1].split(';')[0].trim();
    }
    if (!ext) {
      const m = String(filenameOrUrl || '').split('?')[0].match(/\.([a-zA-Z0-9]+)$/);
      if (m) ext = m[1].toLowerCase();
    }
    if (ext === 'jpeg') ext = 'jpg';
    if (ext === 'svg+xml') ext = 'svg';
    if (!ext) ext = 'png';
    return { ext, label: ext.toUpperCase() };
  }

  // Saved image filename: <messageID>_<n>_<original>.<ext>
  // The messageID prefix ties the file back to the exact message it came from.
  function buildImageName(msgId, idx, originalName, ext) {
    let base = sanitizeFilename(originalName || 'image').replace(/\.[a-zA-Z0-9]+$/, '');
    if (!base) base = 'image';
    return `${msgId}_${idx}_${base}.${ext}`;
  }

  function buildTranscript(messages, meta) {
    const byId = new Map(messages.map((m) => [m.id, m]));
    const images = [];
    const participants = new Map();
    const interactions = new Map();
    let imageIndex = 0;

    const kept = messages.filter((m) => {
      const type = m.type;
      const hasBody = (m.content && m.content.trim()) ||
        (m.attachments && m.attachments.length) ||
        (m.embeds && m.embeds.length) ||
        (m.sticker_items && m.sticker_items.length);
      return (type === 0 || type === 19 || type === 21) && hasBody;
    });

    const lines = [];
    for (const m of kept) {
      const author = m.author || {};
      const name = displayName(author);
      const uname = author.username ? '@' + author.username : '';
      const when = fmtDate(new Date(m.timestamp || snowflakeToDate(m.id)));

      if (!participants.has(author.id)) {
        participants.set(author.id, { name, username: uname, count: 0 });
      }
      participants.get(author.id).count++;

      const heading = `### [${when}] ${name} ${uname}`.trimEnd();
      lines.push(`${heading} · msg \`${m.id}\``);

      const ref = m.message_reference && m.message_reference.message_id;
      if (ref) {
        const target = byId.get(ref) || m.referenced_message || null;
        if (target && target.author) {
          const targetName = displayName(target.author);
          lines.push(`↩ *replying to ${targetName}: "${snippet(cleanContent(target))}"*`);
          const key = name + ' ' + targetName;
          interactions.set(key, (interactions.get(key) || 0) + 1);
        } else {
          lines.push(`↩ *replying to a message outside the exported range*`);
        }
      }

      const body = cleanContent(m);
      if (body) lines.push('', body, '');
      else lines.push('');

      (m.sticker_items || []).forEach((s) => lines.push(`🏷 sticker: ${s.name}`));

      const attImgs = [];
      const attFiles = [];
      (m.attachments || []).forEach((a) => {
        const ct = (a.content_type || '').toLowerCase();
        const isImg = ct.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.filename || '');
        if (isImg && meta.includeImages) {
          const { ext, label } = imageMeta(a.content_type, a.filename);
          const filename = buildImageName(m.id, imageIndex++, a.filename, ext);
          const path = `images/${filename}`;
          images.push({ url: a.url, path, filename, proxy: a.proxy_url });
          attImgs.push(`🖼 **Attached image:** \`${path}\` (${label}) — ![${a.filename || 'image'}](${path})`);
        } else {
          attFiles.push(`📎 [${a.filename || 'file'}](${a.url})`);
        }
      });
      attImgs.forEach((l) => lines.push(l));
      attFiles.forEach((l) => lines.push(l));

      const embedLinks = new Set();
      (m.embeds || []).forEach((e) => {
        if (e.url) embedLinks.add(e.url);
        if (e.type === 'image' && (e.image || e.thumbnail) && meta.includeImages) {
          const src = (e.image && (e.image.url || e.image.proxy_url)) ||
            (e.thumbnail && (e.thumbnail.url || e.thumbnail.proxy_url));
          if (src) {
            const { ext, label } = imageMeta(null, src);
            const clean = src.split('?')[0];
            const orig = clean.substring(clean.lastIndexOf('/') + 1) || 'embed';
            const filename = buildImageName(m.id, imageIndex++, orig, ext);
            const path = `images/${filename}`;
            images.push({ url: src, path, filename });
            lines.push(`🖼 **Embedded image:** \`${path}\` (${label}) — ![embedded image](${path})`);
          }
        }
      });

      const links = new Set();
      let mt;
      const contentRaw = m.content || '';
      while ((mt = URL_RE.exec(contentRaw)) !== null) links.add(mt[1]);
      embedLinks.forEach((l) => links.add(l));
      if (links.size) [...links].forEach((l) => lines.push(`🔗 ${l}`));

      lines.push('', '---', '');
    }

    const header = [];
    header.push('# Debate Transcript', '');
    header.push('*Compiled by Oracle Bot 🔮 — consult the machine god for a verdict.*', '');
    header.push(`- **Channel ID:** ${meta.channelId}`);
    if (meta.guildId && meta.guildId !== '@me') header.push(`- **Guild ID:** ${meta.guildId}`);
    header.push(`- **Range:** ${meta.rangeStart} → ${meta.rangeEnd}`);
    header.push(`- **Messages in range:** ${messages.length} (content-bearing: ${kept.length})`);
    header.push(`- **Images captured:** ${images.length}`);
    header.push(`- **Exported:** ${fmtDate(new Date())}`);
    header.push('');

    if (images.length) {
      header.push('> **About the saved images.** Every image shared in this range is saved in the `images/` folder.');
      header.push('> Each file is named `<messageID>_<n>_<original>.<ext>`. The `<messageID>` prefix matches the id');
      header.push('> shown after **msg** in that message\'s heading below, so you can tell exactly which message an');
      header.push('> image was attached to (and `<n>` orders multiple images within the same message). The extension');
      header.push('> (`.png`, `.jpg`, `.gif`, `.webp`, …) is the image\'s real file type, and every image line also');
      header.push('> notes that type in parentheses, e.g. `(PNG)`.');
      header.push('');
    }

    header.push('## Participants', '');
    header.push('| Participant | Username | Messages |');
    header.push('|---|---|---|');
    [...participants.values()]
      .sort((a, b) => b.count - a.count)
      .forEach((p) => header.push(`| ${p.name} | ${p.username} | ${p.count} |`));
    header.push('');

    if (interactions.size) {
      header.push('## Reply interactions (who responded to whom)', '');
      header.push('| Responder | Replied to | Count |');
      header.push('|---|---|---|');
      [...interactions.entries()]
        .sort((a, b) => b[1] - a[1])
        .forEach(([key, count]) => {
          const [responder, target] = key.split(' ');
          header.push(`| ${responder} | ${target} | ${count} |`);
        });
      header.push('');
    }

    header.push('---', '', '## Transcript', '');

    const markdown = header.join('\n') + '\n' + lines.join('\n');
    return { markdown, images };
  }

  // ----------------------------------------------------------------------------
  // Image bytes: GM request (bypasses CORS), with a plain-fetch fallback.
  // ----------------------------------------------------------------------------
  function gmFetchBytes(url) {
    return new Promise((resolve, reject) => {
      if (!gmRequest) return reject(new Error('GM request unavailable'));
      gmRequest({
        method: 'GET',
        url,
        responseType: 'arraybuffer',
        overrideMimeType: 'text/plain; charset=x-user-defined',
        timeout: 30000,
        onload: (r) => {
          if (r.status < 200 || r.status >= 300) return reject(new Error('HTTP ' + r.status));
          if (r.response && r.response.byteLength != null) {
            resolve(new Uint8Array(r.response));
          } else if (typeof r.responseText === 'string') {
            const s = r.responseText;
            const b = new Uint8Array(s.length);
            for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
            resolve(b);
          } else reject(new Error('empty response'));
        },
        onerror: () => reject(new Error('network error')),
        ontimeout: () => reject(new Error('timeout')),
      });
    });
  }

  async function fetchBytes(url) {
    try {
      return await gmFetchBytes(url);
    } catch (e) {
      const r = await fetch(url); // works only if the CDN allows CORS
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return new Uint8Array(await r.arrayBuffer());
    }
  }

  async function downloadImages(images, zipFiles, opts, log, onProgress, shouldStop) {
    let ok = 0, fail = 0;
    for (let i = 0; i < images.length; i++) {
      if (shouldStop()) throw new Error('Cancelled by user.');
      const img = images[i];
      let bytes = null;
      try {
        bytes = await fetchBytes(img.url);
      } catch (e) {
        if (img.proxy) { try { bytes = await fetchBytes(img.proxy); } catch (_) {} }
      }
      if (bytes) { zipFiles.push({ name: img.path, data: bytes }); ok++; }
      else { fail++; log(`Could not download image: ${img.filename}`, 'warn'); }
      onProgress(i + 1, images.length);
      await sleep(opts.imageDelay);
    }
    log(`Images: ${ok} saved, ${fail} failed.`);
  }

  // ----------------------------------------------------------------------------
  // Export pure functions for Node-based unit tests (no-op in the browser).
  // ----------------------------------------------------------------------------
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      cmpSnowflake, snowflakeToDate, fmtDate, sanitizeFilename,
      parseMessageLink, cleanContent, displayName, snippet, buildTranscript,
      crc32, createZip,
    };
  }

  // ----------------------------------------------------------------------------
  // Browser-only bootstrap (skipped entirely under Node).
  // ----------------------------------------------------------------------------
  if (!HAS_DOM) return;

  // ----------------------------------------------------------------------------
  // UI
  // ----------------------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = `
    #ob-btn{position:fixed;right:16px;bottom:16px;z-index:99999;background:#5865F2;color:#fff;
      border:none;border-radius:10px;padding:10px 14px;font:600 13px/1 sans-serif;cursor:pointer;
      box-shadow:0 4px 14px rgba(0,0,0,.4)}
    #ob-btn:hover{background:#4752c4}
    #ob-panel{position:fixed;right:16px;bottom:64px;z-index:99999;width:360px;max-height:78vh;
      overflow:auto;background:#2b2d31;color:#dbdee1;border-radius:12px;padding:16px;
      font:13px/1.5 sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5);display:none}
    #ob-panel h3{margin:0 0 6px;font-size:15px;color:#fff}
    #ob-panel label{display:block;margin:10px 0 4px;font-weight:600;color:#b5bac1}
    #ob-panel input[type=text],#ob-panel input[type=number]{width:100%;box-sizing:border-box;
      background:#1e1f22;border:1px solid #1e1f22;border-radius:6px;color:#fff;padding:8px}
    #ob-panel .row{display:flex;gap:8px}
    #ob-panel .row>div{flex:1}
    #ob-panel .chk{display:flex;align-items:center;gap:8px;margin-top:10px;font-weight:600;color:#b5bac1}
    #ob-run{margin-top:14px;width:100%;background:#248046;color:#fff;border:none;border-radius:8px;
      padding:10px;font-weight:700;cursor:pointer}
    #ob-run:hover{background:#1a6334}
    #ob-run:disabled{background:#4e5058;cursor:default}
    #ob-cancel{margin-top:8px;width:100%;background:#3a3c41;color:#f2c4c4;border:none;border-radius:8px;
      padding:8px;font-weight:600;cursor:pointer;display:none}
    #ob-bar{height:6px;background:#1e1f22;border-radius:3px;margin-top:12px;overflow:hidden;display:none}
    #ob-bar>div{height:100%;width:0;background:#5865F2;transition:width .2s}
    #ob-log{margin-top:10px;background:#1e1f22;border-radius:6px;padding:8px;max-height:180px;
      overflow:auto;font:11px/1.5 monospace;white-space:pre-wrap}
    #ob-log .warn{color:#f0b232}
    #ob-log .err{color:#f23f43}
    #ob-note{margin-top:10px;font-size:11px;color:#949ba4}
  `;
  document.head.appendChild(style);

  const btn = document.createElement('button');
  btn.id = 'ob-btn';
  btn.textContent = '🔮 Oracle Bot';
  document.body.appendChild(btn);

  const panel = document.createElement('div');
  panel.id = 'ob-panel';
  panel.innerHTML = `
    <h3>🔮 Oracle Bot</h3>
    <div style="font-size:11px;color:#949ba4">Right-click the first &amp; last message → <b>Copy Message Link</b>, paste below. Consult the machine god for a verdict.</div>
    <label>Start message link</label>
    <input id="ob-start" type="text" placeholder="https://discord.com/channels/.../.../...">
    <label>End message link</label>
    <input id="ob-end" type="text" placeholder="https://discord.com/channels/.../.../...">
    <div class="row">
      <div>
        <label>Fetch delay (ms)</label>
        <input id="ob-delay" type="number" value="1200" min="300" step="100">
      </div>
      <div>
        <label>Image delay (ms)</label>
        <input id="ob-imgdelay" type="number" value="400" min="0" step="50">
      </div>
    </div>
    <label class="chk"><input id="ob-img" type="checkbox" checked> Download shared images into the ZIP</label>
    <button id="ob-run">Consult the Oracle → ZIP</button>
    <button id="ob-cancel">Cancel</button>
    <div id="ob-bar"><div></div></div>
    <div id="ob-log"></div>
    <div id="ob-note">Read-only. Paces itself to respect Discord rate limits. Self-botting is against Discord ToS — use at your own discretion.</div>
  `;
  document.body.appendChild(panel);

  const $ = (id) => panel.querySelector(id);
  const logBox = $('#ob-log');
  const bar = $('#ob-bar');
  const barFill = bar.firstElementChild;
  const runBtn = $('#ob-run');
  const cancelBtn = $('#ob-cancel');

  function log(msg, level) {
    const line = document.createElement('div');
    if (level) line.className = level;
    line.textContent = msg;
    logBox.appendChild(line);
    logBox.scrollTop = logBox.scrollHeight;
  }

  btn.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
  });

  let cancelled = false;
  cancelBtn.addEventListener('click', () => { cancelled = true; log('Cancelling…', 'warn'); });

  runBtn.addEventListener('click', async () => {
    cancelled = false;
    logBox.innerHTML = '';
    const start = parseMessageLink($('#ob-start').value);
    const end = parseMessageLink($('#ob-end').value);

    if (!start || !end) return log('Both message links must look like https://discord.com/channels/.../.../...', 'err');
    if (start.channelId !== end.channelId) return log('Start and end messages are in different channels.', 'err');

    let startId = start.messageId, endId = end.messageId;
    if (cmpSnowflake(startId, endId) > 0) {
      [startId, endId] = [endId, startId];
      log('Start was newer than end — swapped them for you.', 'warn');
    }

    const token = getToken();
    if (!token) return log('Could not read your Discord token. Reload Discord and try again.', 'err');

    const includeImages = $('#ob-img').checked;
    if (includeImages && !gmRequest) {
      log('No GM.xmlHttpRequest — will try direct fetch for images (may fail on some CDNs).', 'warn');
    }

    const opts = {
      requestDelay: Math.max(300, parseInt($('#ob-delay').value, 10) || 1200),
      imageDelay: Math.max(0, parseInt($('#ob-imgdelay').value, 10) || 400),
    };

    runBtn.disabled = true;
    cancelBtn.style.display = 'block';
    bar.style.display = 'block';
    barFill.style.width = '0';

    try {
      log(`Consulting the archives between ${startId} and ${endId}…`);
      const messages = await fetchRange(
        { token, channelId: start.channelId, startId, endId },
        opts, log,
        () => { barFill.style.width = '35%'; },
        () => cancelled
      );
      if (!messages.length) { log('No messages found in that range.', 'warn'); return; }
      log(`Got ${messages.length} messages. Building transcript…`);
      barFill.style.width = '45%';

      const meta = {
        channelId: start.channelId,
        guildId: start.guildId,
        includeImages,
        rangeStart: fmtDate(new Date(messages[0].timestamp)),
        rangeEnd: fmtDate(new Date(messages[messages.length - 1].timestamp)),
      };
      const { markdown, images } = buildTranscript(messages, meta);

      const zipFiles = [{ name: 'debate-log.md', data: new TextEncoder().encode(markdown) }];

      if (includeImages && images.length) {
        log(`Downloading ${images.length} images…`);
        await downloadImages(images, zipFiles, opts, log,
          (done, total) => { barFill.style.width = (45 + (done / total) * 45) + '%'; },
          () => cancelled
        );
      } else if (!includeImages && images.length) {
        log(`${images.length} images left as links (download disabled).`);
      }

      log('Sealing the scroll (zipping)…');
      barFill.style.width = '95%';
      const blob = createZip(zipFiles);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `oracle-bot-${start.channelId}-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      barFill.style.width = '100%';
      log('The Oracle has spoken. ZIP downloaded.');
    } catch (e) {
      log('Error: ' + e.message, 'err');
    } finally {
      runBtn.disabled = false;
      cancelBtn.style.display = 'none';
    }
  });
})();
