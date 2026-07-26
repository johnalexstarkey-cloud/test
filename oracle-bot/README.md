# 🔮 Oracle Bot — Discord Debate Log Exporter

Consult the machine god about who won. A browser userscript that exports a **range of
messages** from a Discord channel — from a start message to an end message you choose —
into a single Markdown transcript, bundled with the shared images and links in a ZIP.
Built for **debate reviews**: hand the ZIP to an AI and ask it to pick a winner.

It records:

- **Who replied to whom** (Discord reply threading) — both inline and as a summary table
- **Every image** shared in the range (downloaded into the ZIP, so the archive doesn't rot when Discord's CDN links expire)
- **Every link** shared
- **Reactions** on each message (emoji + count, and optionally *who* reacted), plus a per-participant "reactions received" tally
- **Edited** and **pinned** markers on messages
- **Spoilered** content, included in full and labelled as spoilers
- A **participant table** and a **reply-interaction table** so a judge can see engagement at a glance

**Dependency-free** — no external libraries, so it behaves identically in Greasemonkey,
Tampermonkey, and Violentmonkey. The ZIP is built by a small built-in writer.

---

## ⚠️ Read this first — account risk

This runs on **your personal account** in the browser, using your own session token —
the same technique as [undiscord](https://github.com/victornpb/undiscord). Automating a
user account ("self-botting") is **against Discord's Terms of Service** and *can* get an
account actioned. Oracle Bot is **read-only** and deliberately paced to be gentle, which
makes it low-risk, but the risk is not zero. Use it only on channels you legitimately
have access to, and decide for yourself.

**Fully ToS-compliant alternative:** use a real Discord **bot token** instead. See
[Official bot alternative](#official-bot-alternative). It needs a server admin to add a
bot, but it carries no account risk.

---

## Install

Works in **Greasemonkey** (Firefox), **Tampermonkey**, or **Violentmonkey**.

1. Install one of those userscript managers if you don't have one. You're using
   **Greasemonkey**, so this is written for it — the steps are the same in the others.
2. Click the Greasemonkey icon → **New user script…** (the pencil / "＋" menu).
3. Delete the template it gives you, paste in the entire contents of
   **`oracle-bot.user.js`**, and save (**Ctrl+S**, or File → Save).
4. Open **`discord.com/app`** in Firefox (the web app — **not** the desktop client). A
   purple **🔮 Oracle Bot** button appears bottom-right.

> The Discord desktop app doesn't run userscripts. Use the browser.

### Greasemonkey notes

- **Nothing to configure** — there's no `@require`, so Greasemonkey 4's lack of `@require` support doesn't matter here.
- Greasemonkey may prompt once to allow **cross-site requests** (that's how images are downloaded from Discord's CDN). Allow it, or images will be left as links.
- The script reads your token through `unsafeWindow` (needed on Firefox because of its script sandbox); this is handled automatically.

## Use

1. Find the **first** message of the debate → hover it → click the **⋯** (or right-click) → **Copy Message Link**.
2. Find the **last** message → **Copy Message Link**.
3. Click **🔮 Oracle Bot**, paste the **start link** and **end link**, then press **Consult the Oracle → ZIP**.
4. You get `oracle-bot-<channel>-<timestamp>.zip` containing:
   - `debate-log.md` — the transcript
   - `images/` — every downloaded image

The start and end messages must be in the **same channel**. If you paste them in the
wrong order, Oracle Bot swaps them for you.

### Options

| Option | Default | What it does |
|---|---|---|
| Fetch delay | 1200 ms | Pause between each page of 100 messages. Raise it for a very large range or if you're cautious about rate limits. |
| Image delay | 400 ms | Pause between image downloads. |
| Download shared images | on | Off = images are left as links only (smaller ZIP, faster). |
| Fetch *who* reacted | off | Reaction **counts** are always captured for free. Turning this on also records the names of the people who reacted — but it costs **one extra request per reaction**, so it's much slower on a busy channel. Leave it off unless who-reacted matters to your review. |

## Rate limiting

Discord throttles the message-history endpoint. Oracle Bot:

- Paces itself (~1.2 s per 100-message page by default).
- Honors the `Retry-After` / `retry_after` value on **HTTP 429** and waits it out.
- Watches the `X-RateLimit-Remaining` / `X-RateLimit-Reset-After` headers and pauses when a bucket is exhausted.
- **Backs off automatically** — each 429 increases the base delay — so a long export just gets slower, it doesn't hammer the API.

Exporting is intentionally not instant. A few thousand messages take a couple of minutes; that's the safe way to do it.

## Feeding it to an AI for a verdict

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
3. Call `GET /channels/{id}/messages?after=...` with `Authorization: Bot <token>` and the same pagination logic this script uses. The message JSON is identical, so the whole `buildTranscript` logic can be reused in a small Node script.

No account risk, but requires bot access to the server.
[DiscordChatExporter](https://github.com/Tyrrrz/DiscordChatExporter) is a mature,
standalone alternative if you want something off-the-shelf (it supports both bot and
user tokens).

## Testing

Pure logic (transcript building, snowflake math, and the ZIP writer) is unit-tested
against mock Discord message objects and a known CRC32 vector:

```
node oracle-bot/test.js
```

## How it works (technical)

- **Token:** read from Discord's own webpack modules (`webpackChunkdiscord_app` → `getToken()`) via `unsafeWindow`, with a localStorage fallback. Sent as the `Authorization` header, exactly like the Discord client.
- **Range fetch:** paginates `GET /api/v10/channels/{id}/messages?limit=100&after={id}`. Starts at `startId − 1` (so the start message is included), sorts each batch oldest→newest by snowflake, keeps messages with `id ≤ endId`, and stops once it passes the end message or hits the end of the channel.
- **Reply threading:** from `message_reference.message_id`, resolved against the fetched set (or the inlined `referenced_message`).
- **Reactions:** counts come free on the message object (`reactions[]`). Reactor *names* are not included there, so the opt-in fetches `GET /messages/{id}/reactions/{emoji}` once per emoji per reacted message (custom emoji keyed as `name:id`), paced and rate-limited like the main fetch. Capped at the first 100 reactors per emoji, with `…` appended if there were more.
- **Images:** attachment images and pasted-image embeds are downloaded via `GM.xmlHttpRequest`/`GM_xmlhttpRequest` (bypasses CDN CORS), with a plain-`fetch` fallback; other attachments and embeds are kept as links.
- **Packaging:** a built-in store-only ZIP writer (CRC-32 + local headers + central directory) bundles the Markdown and images into one download — no third-party library.
