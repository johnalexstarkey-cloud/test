# Discord Debate Log Exporter

A browser userscript that exports a **range of messages** from a Discord channel —
from a start message to an end message you choose — into a single Markdown
transcript, bundled with the shared images and links in a ZIP. Built for
**debate reviews**: hand the ZIP to an AI and ask it to pick a winner.

It records:

- **Who replied to whom** (Discord reply threading) — both inline and as a summary table
- **Every image** shared in the range (downloaded into the ZIP, so the archive doesn't rot when Discord's CDN links expire)
- **Every link** shared
- A **participant table** and a **reply-interaction table** so a judge can see engagement at a glance

---

## ⚠️ Read this first — account risk

This runs on **your personal account** in the browser, using your own session token —
the same technique as [undiscord](https://github.com/victornpb/undiscord). Automating a
user account ("self-botting") is **against Discord's Terms of Service** and *can* get an
account actioned. This tool is **read-only** and deliberately paced to be gentle, which
makes it low-risk, but the risk is not zero. Use it only on channels you legitimately
have access to, and decide for yourself.

**Fully ToS-compliant alternative:** use a real Discord **bot token** instead. See
[Official bot alternative](#official-bot-alternative) below. It needs a server admin to
add a bot, but it carries no account risk.

---

## Install

1. Install a userscript manager — **[Tampermonkey](https://www.tampermonkey.net/)** is recommended (Chrome/Edge/Firefox/Brave). Image downloading relies on Tampermonkey's `GM_xmlhttpRequest`.
2. Open `discord-debate-exporter.user.js`, copy its contents into a new Tampermonkey script, and save. (Or, if you serve the raw file, click it and Tampermonkey will offer to install.)
3. Open **`discord.com/app`** in the browser (the web app — not the desktop client). A blue **🗳 Debate Export** button appears bottom-right.

> The desktop app doesn't run userscripts. Use the browser.

## Use

1. In Discord, turn on **Developer Mode** if you want raw IDs (Settings → Advanced), though it's not required.
2. Find the **first** message of the debate → right-click it → **Copy Message Link**.
3. Find the **last** message → right-click → **Copy Message Link**.
4. Click **🗳 Debate Export**, paste both links, and press **Export debate → ZIP**.
5. You get `debate-<channel>-<timestamp>.zip` containing:
   - `debate-log.md` — the transcript
   - `images/` — every downloaded image

The start and end messages must be in the **same channel**. If you paste them in the
wrong order, the script swaps them for you.

### Options

| Option | Default | What it does |
|---|---|---|
| Fetch delay | 1200 ms | Pause between each page of 100 messages. Raise it if you're exporting a huge range or feel nervous about rate limits. |
| Image delay | 400 ms | Pause between image downloads. |
| Download shared images | on | Off = images are left as links only (smaller ZIP, faster). |

## Rate limiting

Discord throttles the message-history endpoint. The script:

- Paces itself (~1.2 s per 100-message page by default).
- Honors the `Retry-After` / `retry_after` value on **HTTP 429** and waits it out.
- Watches the `X-RateLimit-Remaining` / `X-RateLimit-Reset-After` headers and pauses when a bucket is exhausted.
- **Backs off automatically** — each 429 increases the base delay — so a long export just gets slower, it doesn't hammer the API.

Exporting is intentionally not instant. A few thousand messages take a couple of minutes; that's the safe way to do it.

## Feeding it to an AI for review

Unzip and give the AI `debate-log.md` (and the `images/` folder if the debate hinges on
screenshots). A prompt that works well:

> You are judging a debate. The transcript below records each message, who replied to
> whom, and the images/links shared. Identify the participants and their positions,
> evaluate argument quality, evidence, and rebuttals, then declare a clear winner with
> reasoning. Transcript follows:

The **reply-interaction table** at the top helps the model see who actually engaged whom
versus who talked past the other side.

## Official bot alternative

If you'd rather not touch the ToS line, use a proper bot:

1. Create an application + bot at <https://discord.com/developers/applications>, enable the **Message Content Intent**.
2. A server admin invites the bot with **Read Message History** permission to the channel.
3. Call `GET /channels/{id}/messages?after=...` with `Authorization: Bot <token>` and the same pagination logic this script uses. The message JSON is identical, so the whole `buildTranscript` logic in the userscript can be reused in a small Node script.

This has no account risk, but requires bot access to the server.
[DiscordChatExporter](https://github.com/Tyrrrz/DiscordChatExporter) is a mature,
standalone alternative if you want something off-the-shelf (it supports both bot and
user tokens).

## Testing

Pure transcript logic is unit-tested against mock Discord message objects:

```
node discord-debate-exporter/test.js
```

## How it works (technical)

- **Token:** read from Discord's own webpack modules (`webpackChunkdiscord_app` → `getToken()`), with a localStorage fallback. Sent as the `Authorization` header, exactly like the Discord client.
- **Range fetch:** paginates `GET /api/v10/channels/{id}/messages?limit=100&after={id}`. Starts at `startId − 1` (so the start message is included), sorts each batch oldest→newest by snowflake, keeps messages with `id ≤ endId`, and stops once it passes the end message or hits the end of the channel.
- **Reply threading:** from `message_reference.message_id`, resolved against the fetched set (or the inlined `referenced_message`).
- **Images:** attachment images and pasted-image embeds are downloaded via `GM_xmlhttpRequest` (bypasses CDN CORS) and stored in the ZIP; other attachments and embeds are kept as links.
- **Packaging:** [JSZip](https://stuk.github.io/jszip/) (loaded via `@require`) bundles the Markdown and images into one download.
