// Node unit tests for the pure logic of the Discord Debate Log Exporter.
// Run: node discord-debate-exporter/test.js
const assert = require('assert');
const lib = require('./discord-debate-exporter.user.js');

const EPOCH = 1420070400000n;
const snowflake = (isoDate) =>
  ((BigInt(new Date(isoDate).getTime()) - EPOCH) << 22n).toString();

const id1 = snowflake('2026-01-01T12:00:00Z');
const id2 = snowflake('2026-01-01T12:05:00Z');
const id3 = snowflake('2026-01-01T12:10:00Z');
const idSys = snowflake('2026-01-01T12:12:00Z');

const alice = { id: '111', username: 'alice', global_name: 'Alice' };
const bob = { id: '222', username: 'bob', global_name: 'Bob' };

const messages = [
  {
    id: id1, type: 0, author: alice, timestamp: '2026-01-01T12:00:00.000Z',
    content: 'I argue that pineapple belongs on pizza because sweetness balances salt.',
    attachments: [{ url: 'https://cdn.discordapp.com/a/pizza.png?ex=1', proxy_url: 'https://media.discordapp.net/a/pizza.png', filename: 'pizza.png', content_type: 'image/png' }],
    embeds: [], mentions: [],
  },
  {
    id: id2, type: 19, author: bob, timestamp: '2026-01-01T12:05:00.000Z',
    content: 'No <@111>, your premise is flawed. See https://example.com/proof for details.',
    attachments: [], embeds: [], mentions: [alice],
    message_reference: { message_id: id1 },
  },
  {
    id: id3, type: 19, author: alice, timestamp: '2026-01-01T12:10:00.000Z',
    content: 'Counter-evidence attached :fire:',
    attachments: [], mentions: [],
    message_reference: { message_id: id2 },
    embeds: [{ type: 'image', url: 'https://i.imgur.com/x.png', image: { url: 'https://i.imgur.com/x.png', proxy_url: 'https://media.discordapp.net/x.png' } }],
  },
  {
    id: idSys, type: 7, author: bob, timestamp: '2026-01-01T12:12:00.000Z',
    content: '', attachments: [], embeds: [], mentions: [],
  },
];

const meta = {
  channelId: '999', guildId: '888', includeImages: true,
  rangeStart: '2026-01-01 12:00 UTC', rangeEnd: '2026-01-01 12:10 UTC',
};

const { markdown, images } = lib.buildTranscript(messages, meta);

// --- assertions ---------------------------------------------------------------
let passed = 0;
const check = (cond, label) => { assert.ok(cond, 'FAILED: ' + label); passed++; console.log('  ok -', label); };

check(lib.parseMessageLink('https://discord.com/channels/888/999/123').messageId === '123', 'parseMessageLink extracts message id');
check(lib.parseMessageLink('not a link') === null, 'parseMessageLink rejects garbage');
check(lib.cmpSnowflake(id2, id1) === 1, 'snowflake compare orders by time');

check(markdown.includes('# Debate Transcript'), 'has title');
check(markdown.includes('Alice') && markdown.includes('@alice'), 'participant Alice listed');
check(markdown.includes('| Bob | @bob | 1 |'), 'participant table counts Bob = 1');

// reply threading
check(markdown.includes('replying to Alice:'), 'Bob shown replying to Alice');
check(markdown.includes('replying to Bob:'), 'Alice shown replying to Bob');

// mention resolved to @Alice, not raw <@111>
check(!markdown.includes('<@111>'), 'raw mention token stripped');
check(markdown.includes('@Alice'), 'mention resolved to display name');

// emoji shortcode preserved
check(markdown.includes(':fire:'), 'custom emoji rendered as shortcode');

// links captured
check(markdown.includes('🔗 https://example.com/proof'), 'link from content captured');

// images collected (1 attachment + 1 embed image)
check(images.length === 2, 'two images collected (attachment + embed)');
check(images.some((i) => i.filename.includes('pizza.png')), 'attachment image named');
check(markdown.includes('images/'), 'image referenced with relative path');

// interaction table present
check(markdown.includes('Reply interactions'), 'interaction section present');
check(markdown.includes('| Bob | Alice | 1 |'), 'interaction Bob->Alice counted');

// system message filtered out of transcript body but counted in range total
check(markdown.includes('content-bearing: 3'), 'system message excluded from content-bearing count');
check(markdown.includes('**Messages in range:** 4'), 'all 4 messages counted in range');

console.log(`\nAll ${passed} checks passed.`);
