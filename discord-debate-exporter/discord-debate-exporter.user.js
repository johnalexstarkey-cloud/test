// ==UserScript==
// @name         Discord Debate Log Exporter
// @namespace    https://github.com/johnalexstarkey-cloud/test
// @version      1.0.0
// @description  Export a range of Discord messages (between two message links) into a Markdown debate transcript with reply threading, and bundle shared images + links into a ZIP for AI review.
// @author       you
// @match        https://discord.com/*
// @match        https://*.discord.com/*
// @icon         https://discord.com/assets/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      cdn.discordapp.com
// @connect      media.discordapp.net
// @connect      discord.com
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @run-at       document-idle
// ==/UserScript==

/*
 * WHAT THIS DOES
 *  - You paste the message LINK of the first message and the LAST message of a debate
 *    (right-click a message -> "Copy Message Link").
 *  - It fetches every message in between (inclusive) using your own logged-in session.
 *  - It writes a Markdown transcript that records who replied to whom, downloads the
 *    images that were shared, and lists every link.
 *  - Everything is bundled into a single .zip you can hand to an AI for a debate review.
 *
 * RATE LIMITS
 *  - Discord throttles the message-history endpoint. This script paces itself (default
 *    ~1.2s between page fetches), honours the `retry_after` value on HTTP 429, respects
 *    the X-RateLimit-Remaining/Reset-After headers, and backs off automatically. Slower
 *    is safer for your account. Nothing here is instantaneous by design.
 *
 * ACCOUNT RISK
 *  - Automating a user account is against Discord's Terms of Service ("self-botting")
 *    and can, in principle, get your account actioned. This tool is read-only and gentle,
 *    but the risk is non-zero. Use on debates you have legitimate access to, and consider
 *    the official Bot API route (see README) if you want a fully compliant setup.
 */

(function () {
  'use strict';

  const HAS_DOM = typeof document !== 'undefined' && typeof window !== 'undefined';
  if (HAS_DOM) {
    if (window.__debateExporterLoaded) return;
    window.__debateExporterLoaded = true;
  }

  // ----------------------------------------------------------------------------
  // Small helpers
  // ----------------------------------------------------------------------------
  const DISCORD_EPOCH = 1420070400000n; // 2015-01-01, for reference / snowflake math
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
    // YYYY-MM-DD HH:MM UTC
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
  // Auth token (from Discord's own webpack modules; localStorage fallback)
  // ----------------------------------------------------------------------------
  function getToken() {
    let token = null;
    try {
      window.webpackChunkdiscord_app.push([
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

    // Fallback: read from a fresh iframe's localStorage (works only if not stripped).
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
    const endBig = BigInt(endId);
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
        baseDelay = Math.min(baseDelay * 1.5, 10000); // adaptive slow-down
        log(`Rate limited — waiting ${(wait / 1000).toFixed(1)}s (base delay now ${baseDelay}ms).`, 'warn');
        await sleep(wait);
        continue; // retry the same page
      }
      if (resp.status === 401) throw new Error('401 Unauthorized — could not read your token, or it is stale. Reload Discord and try again.');
      if (resp.status === 403) throw new Error('403 Forbidden — your account cannot read this channel.');
      if (!resp.ok) throw new Error(`Unexpected HTTP ${resp.status} fetching messages.`);

      let batch;
      try { batch = await resp.json(); } catch (e) { throw new Error('Could not parse message batch.'); }
      if (!Array.isArray(batch) || batch.length === 0) break;

      batch.sort((a, b) => cmpSnowflake(a.id, b.id)); // oldest -> newest

      for (const msg of batch) {
        if (cmpSnowflake(msg.id, endId) > 0) { done = true; break; } // passed the end message
        messages.push(msg);
      }

      after = batch[batch.length - 1].id;
      if (batch.length < 100) done = true; // reached the end of the channel

      onProgress(messages.length);
      log(`Fetched ${messages.length} messages so far…`);

      // Pace ourselves using the rate-limit headers when present.
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
    text = text.replace(/<a?:(\w+):\d+>/g, ':$1:'); // custom emoji -> :name:
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

  function buildTranscript(messages, meta) {
    const byId = new Map(messages.map((m) => [m.id, m]));
    const images = []; // { url, path, filename }
    const participants = new Map(); // id -> { name, username, count }
    const interactions = new Map(); // "responder target" -> count
    let imageIndex = 0;

    // Keep normal + reply messages that actually carry content/attachments/embeds.
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

      // participant tally
      if (!participants.has(author.id)) {
        participants.set(author.id, { name, username: uname, count: 0 });
      }
      participants.get(author.id).count++;

      lines.push(`### [${when}] ${name} ${uname}`.trimEnd());

      // reply threading
      const ref = m.message_reference && m.message_reference.message_id;
      if (ref) {
        const target = byId.get(ref) || m.referenced_message || null;
        if (target && target.author) {
          const targetName = displayName(target.author);
          lines.push(`↩ *replying to ${targetName}: "${snippet(cleanContent(target))}"*`);
          const key = name + ' ' + targetName;
          interactions.set(key, (interactions.get(key) || 0) + 1);
        } else {
          lines.push(`↩ *replying to a message outside the exported range*`);
        }
      }

      const body = cleanContent(m);
      if (body) lines.push('', body, '');
      else lines.push('');

      // stickers
      (m.sticker_items || []).forEach((s) => lines.push(`🏷 sticker: ${s.name}`));

      // attachments (download images, list files)
      const attImgs = [];
      const attFiles = [];
      (m.attachments || []).forEach((a) => {
        const ct = (a.content_type || '').toLowerCase();
        const isImg = ct.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.filename || '');
        if (isImg && meta.includeImages) {
          const filename = `${m.id}_${imageIndex++}_${sanitizeFilename(a.filename)}`;
          const path = `images/${filename}`;
          images.push({ url: a.url, path, filename, proxy: a.proxy_url });
          attImgs.push(`🖼 ![${a.filename || 'image'}](${path})`);
        } else {
          attFiles.push(`📎 [${a.filename || 'file'}](${a.url})`);
        }
      });
      attImgs.forEach((l) => lines.push(l));
      attFiles.forEach((l) => lines.push(l));

      // embeds: capture pasted-image embeds + collect embed links
      const embedLinks = new Set();
      (m.embeds || []).forEach((e) => {
        if (e.url) embedLinks.add(e.url);
        if (e.type === 'image' && (e.image || e.thumbnail) && meta.includeImages) {
          const src = (e.image && (e.image.url || e.image.proxy_url)) ||
            (e.thumbnail && (e.thumbnail.url || e.thumbnail.proxy_url));
          if (src) {
            const clean = src.split('?')[0];
            const base = sanitizeFilename(clean.substring(clean.lastIndexOf('/') + 1) || 'embed.png');
            const filename = `${m.id}_${imageIndex++}_${base}`;
            const path = `images/${filename}`;
            images.push({ url: src, path, filename });
            lines.push(`🖼 ![embedded image](${path})`);
          }
        }
      });

      // links: from content + embeds
      const links = new Set();
      let mt;
      const contentRaw = m.content || '';
      while ((mt = URL_RE.exec(contentRaw)) !== null) links.add(mt[1]);
      embedLinks.forEach((l) => links.add(l));
      if (links.size) {
        [...links].forEach((l) => lines.push(`🔗 ${l}`));
      }

      lines.push('', '---', '');
    }

    // Header
    const header = [];
    header.push('# Debate Transcript', '');
    header.push(`- **Channel ID:** ${meta.channelId}`);
    if (meta.guildId && meta.guildId !== '@me') header.push(`- **Guild ID:** ${meta.guildId}`);
    header.push(`- **Range:** ${meta.rangeStart} → ${meta.rangeEnd}`);
    header.push(`- **Messages in range:** ${messages.length} (content-bearing: ${kept.length})`);
    header.push(`- **Images captured:** ${images.length}`);
    header.push(`- **Exported:** ${fmtDate(new Date())}`);
    header.push('');

    // Participants table
    header.push('## Participants', '');
    header.push('| Participant | Username | Messages |');
    header.push('|---|---|---|');
    [...participants.values()]
      .sort((a, b) => b.count - a.count)
      .forEach((p) => header.push(`| ${p.name} | ${p.username} | ${p.count} |`));
    header.push('');

    // Interaction (reply) summary — who responded to whom
    if (interactions.size) {
      header.push('## Reply interactions (who responded to whom)', '');
      header.push('| Responder | Replied to | Count |');
      header.push('|---|---|---|');
      [...interactions.entries()]
        .sort((a, b) => b[1] - a[1])
        .forEach(([key, count]) => {
          const [responder, target] = key.split(' ');
          header.push(`| ${responder} | ${target} | ${count} |`);
        });
      header.push('');
    }

    header.push('---', '', '## Transcript', '');

    const markdown = header.join('\n') + '\n' + lines.join('\n');
    return { markdown, images };
  }

  // ----------------------------------------------------------------------------
  // Download images via GM_xmlhttpRequest (bypasses CORS on Discord's CDN).
  // ----------------------------------------------------------------------------
  function gmFetchBlob(url) {
    return new Promise((resolve, reject) => {
      if (!gmRequest) return reject(new Error('GM_xmlhttpRequest unavailable'));
      gmRequest({
        method: 'GET',
        url,
        responseType: 'arraybuffer',
        timeout: 30000,
        onload: (r) =>
          r.status >= 200 && r.status < 300
            ? resolve(r.response)
            : reject(new Error('HTTP ' + r.status)),
        onerror: () => reject(new Error('network error')),
        ontimeout: () => reject(new Error('timeout')),
      });
    });
  }

  async function downloadImages(images, zip, opts, log, onProgress, shouldStop) {
    let ok = 0, fail = 0;
    for (let i = 0; i < images.length; i++) {
      if (shouldStop()) throw new Error('Cancelled by user.');
      const img = images[i];
      let buf = null;
      try {
        buf = await gmFetchBlob(img.url);
      } catch (e) {
        if (img.proxy) {
          try { buf = await gmFetchBlob(img.proxy); } catch (_) {}
        }
      }
      if (buf) {
        zip.file(img.path, buf);
        ok++;
      } else {
        fail++;
        log(`Could not download image: ${img.filename}`, 'warn');
      }
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
    #dbg-btn{position:fixed;right:16px;bottom:16px;z-index:99999;background:#5865F2;color:#fff;
      border:none;border-radius:10px;padding:10px 14px;font:600 13px/1 sans-serif;cursor:pointer;
      box-shadow:0 4px 14px rgba(0,0,0,.4)}
    #dbg-btn:hover{background:#4752c4}
    #dbg-panel{position:fixed;right:16px;bottom:64px;z-index:99999;width:360px;max-height:78vh;
      overflow:auto;background:#2b2d31;color:#dbdee1;border-radius:12px;padding:16px;
      font:13px/1.5 sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5);display:none}
    #dbg-panel h3{margin:0 0 6px;font-size:15px;color:#fff}
    #dbg-panel label{display:block;margin:10px 0 4px;font-weight:600;color:#b5bac1}
    #dbg-panel input[type=text],#dbg-panel input[type=number]{width:100%;box-sizing:border-box;
      background:#1e1f22;border:1px solid #1e1f22;border-radius:6px;color:#fff;padding:8px}
    #dbg-panel .row{display:flex;gap:8px}
    #dbg-panel .row>div{flex:1}
    #dbg-panel .chk{display:flex;align-items:center;gap:8px;margin-top:10px;font-weight:600;color:#b5bac1}
    #dbg-run{margin-top:14px;width:100%;background:#248046;color:#fff;border:none;border-radius:8px;
      padding:10px;font-weight:700;cursor:pointer}
    #dbg-run:hover{background:#1a6334}
    #dbg-run:disabled{background:#4e5058;cursor:default}
    #dbg-cancel{margin-top:8px;width:100%;background:#3a3c41;color:#f2c4c4;border:none;border-radius:8px;
      padding:8px;font-weight:600;cursor:pointer;display:none}
    #dbg-bar{height:6px;background:#1e1f22;border-radius:3px;margin-top:12px;overflow:hidden;display:none}
    #dbg-bar>div{height:100%;width:0;background:#5865F2;transition:width .2s}
    #dbg-log{margin-top:10px;background:#1e1f22;border-radius:6px;padding:8px;max-height:180px;
      overflow:auto;font:11px/1.5 monospace;white-space:pre-wrap}
    #dbg-log .warn{color:#f0b232}
    #dbg-log .err{color:#f23f43}
    #dbg-note{margin-top:10px;font-size:11px;color:#949ba4}
  `;
  document.head.appendChild(style);

  const btn = document.createElement('button');
  btn.id = 'dbg-btn';
  btn.textContent = '🗳 Debate Export';
  document.body.appendChild(btn);

  const panel = document.createElement('div');
  panel.id = 'dbg-panel';
  panel.innerHTML = `
    <h3>Debate Log Exporter</h3>
    <div style="font-size:11px;color:#949ba4">Right-click the first &amp; last message → <b>Copy Message Link</b>, paste below.</div>
    <label>Start message link</label>
    <input id="dbg-start" type="text" placeholder="https://discord.com/channels/.../.../...">
    <label>End message link</label>
    <input id="dbg-end" type="text" placeholder="https://discord.com/channels/.../.../...">
    <div class="row">
      <div>
        <label>Fetch delay (ms)</label>
        <input id="dbg-delay" type="number" value="1200" min="300" step="100">
      </div>
      <div>
        <label>Image delay (ms)</label>
        <input id="dbg-imgdelay" type="number" value="400" min="0" step="50">
      </div>
    </div>
    <label class="chk"><input id="dbg-img" type="checkbox" checked> Download shared images into the ZIP</label>
    <button id="dbg-run">Export debate → ZIP</button>
    <button id="dbg-cancel">Cancel</button>
    <div id="dbg-bar"><div></div></div>
    <div id="dbg-log"></div>
    <div id="dbg-note">Read-only. Paces itself to respect Discord rate limits. Self-botting is against Discord ToS — use at your own discretion.</div>
  `;
  document.body.appendChild(panel);

  const $ = (id) => panel.querySelector(id);
  const logBox = $('#dbg-log');
  const bar = $('#dbg-bar');
  const barFill = bar.firstElementChild;
  const runBtn = $('#dbg-run');
  const cancelBtn = $('#dbg-cancel');

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
    const start = parseMessageLink($('#dbg-start').value);
    const end = parseMessageLink($('#dbg-end').value);

    if (!start || !end) return log('Both message links must look like https://discord.com/channels/.../.../...', 'err');
    if (start.channelId !== end.channelId) return log('Start and end messages are in different channels.', 'err');

    let startId = start.messageId, endId = end.messageId;
    if (cmpSnowflake(startId, endId) > 0) {
      [startId, endId] = [endId, startId]; // auto-swap if pasted out of order
      log('Start was newer than end — swapped them for you.', 'warn');
    }

    const token = getToken();
    if (!token) return log('Could not read your Discord token. Reload Discord and try again.', 'err');
    if (!gmRequest && $('#dbg-img').checked) {
      log('GM_xmlhttpRequest unavailable — install via Tampermonkey to download images. Continuing with links only.', 'warn');
    }

    const opts = {
      requestDelay: Math.max(300, parseInt($('#dbg-delay').value, 10) || 1200),
      imageDelay: Math.max(0, parseInt($('#dbg-imgdelay').value, 10) || 400),
    };
    const includeImages = $('#dbg-img').checked && !!gmRequest;

    runBtn.disabled = true;
    cancelBtn.style.display = 'block';
    bar.style.display = 'block';
    barFill.style.width = '0';

    try {
      log(`Fetching messages between ${startId} and ${endId}…`);
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

      const zip = new JSZip();
      zip.file('debate-log.md', markdown);

      if (includeImages && images.length) {
        log(`Downloading ${images.length} images…`);
        await downloadImages(images, zip, opts, log,
          (done, total) => { barFill.style.width = (45 + (done / total) * 45) + '%'; },
          () => cancelled
        );
      } else if (!includeImages && images.length) {
        log(`${images.length} images left as links (download disabled).`);
      }

      log('Zipping…');
      barFill.style.width = '95%';
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `debate-${start.channelId}-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      barFill.style.width = '100%';
      log('Done! ZIP downloaded.');
    } catch (e) {
      log('Error: ' + e.message, 'err');
    } finally {
      runBtn.disabled = false;
      cancelBtn.style.display = 'none';
    }
  });
})();
