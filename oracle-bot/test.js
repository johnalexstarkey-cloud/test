// Node unit tests for the pure logic of Oracle Bot.
// Run: node oracle-bot/test.js
const assert = require('assert');
const lib = require('./oracle-bot.user.js');

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

// image traceability: message id in heading + filename prefix + type label + blurb
check(markdown.includes('· msg `' + id1 + '`'), 'message heading shows the message id');
check(images.every((i) => i.filename.startsWith(i.filename.split('_')[0] + '_')), 'image filename is prefixed with its message id');
check(images.some((i) => i.filename.startsWith(id1 + '_')), 'attachment image filename prefixed with its own message id');
check(images.every((i) => /\.(png|jpg|gif|webp|bmp|svg)$/.test(i.filename)), 'saved image filenames carry a real file extension');
check(markdown.includes('(PNG)'), 'image line notes the file type');
check(markdown.includes('About the saved images'), 'blurb explaining image naming is present');
check(!markdown.includes('About spoilers'), 'spoiler note omitted when there are no spoilers');

// --- spoilers -----------------------------------------------------------------
const spoilerMsgs = [
  {
    id: id1, type: 0, author: alice, timestamp: '2026-01-01T12:00:00.000Z',
    content: 'My real point is ||hidden behind a spoiler|| here.',
    attachments: [{ url: 'https://cdn.discordapp.com/a/x?ex=1', filename: 'SPOILER_receipt.png', content_type: 'image/png', flags: 4 }],
    embeds: [], mentions: [],
  },
  {
    id: id2, type: 0, author: bob, timestamp: '2026-01-01T12:05:00.000Z',
    content: 'Plain rebuttal.',
    attachments: [{ url: 'https://cdn.discordapp.com/a/y?ex=1', filename: 'chart.png', content_type: 'image/png' }],
    embeds: [], mentions: [],
  },
];
const sp = lib.buildTranscript(spoilerMsgs, meta);
check(sp.markdown.includes('||hidden behind a spoiler||'), 'spoilered text is preserved verbatim');
check(sp.markdown.includes('Attached image (spoiler)'), 'spoilered image is labelled as a spoiler');
check(sp.markdown.includes('About spoilers'), 'spoiler explanation note appears when spoilers exist');
check(sp.images.length === 2 && sp.images[0].spoiler === true && sp.images[1].spoiler === false,
  'spoiler flag set only on the spoilered image');
check(sp.images[0].filename.includes('SPOILER_receipt.png'), 'spoiler filename prefix preserved in saved name');
check(sp.markdown.split('Attached image (spoiler)').length === 2, 'non-spoiler image not mislabelled');

// interaction table present
check(markdown.includes('Reply interactions'), 'interaction section present');
check(markdown.includes('| Bob | Alice | 1 |'), 'interaction Bob->Alice counted');

// system message filtered out of transcript body but counted in range total
check(markdown.includes('content-bearing: 3'), 'system message excluded from content-bearing count');
check(markdown.includes('**Messages in range:** 4'), 'all 4 messages counted in range');

// --- reactions & message metadata ---------------------------------------------
check(lib.formatEmoji({ id: null, name: '🔥' }) === '🔥', 'unicode emoji rendered as-is');
check(lib.formatEmoji({ id: '123', name: 'pepe' }) === ':pepe:', 'custom emoji rendered as :name:');
check(lib.reactionKey({ id: '123', name: 'pepe' }) === 'pepe%3A123', 'custom emoji key is name:id, url-encoded');
check(lib.reactionKey({ id: null, name: '🔥' }) === encodeURIComponent('🔥'), 'unicode emoji key url-encoded');
check(lib.reactionCount({ count_details: { normal: 2, burst: 1 } }) === 3, 'count falls back to count_details');

const reactMsgs = [
  {
    id: id1, type: 0, author: alice, timestamp: '2026-01-01T12:00:00.000Z',
    edited_timestamp: '2026-01-01T12:02:00.000Z', pinned: true,
    content: 'Opening argument.', attachments: [], embeds: [], mentions: [],
    reactions: [
      { emoji: { id: null, name: '🔥' }, count: 3 },
      { emoji: { id: '77', name: 'based' }, count: 2, reactors: ['Bob', 'Carol'] },
      { emoji: { id: null, name: '💀' }, count: 0 },
    ],
  },
  {
    id: id2, type: 0, author: bob, timestamp: '2026-01-01T12:05:00.000Z',
    content: 'Rebuttal.', attachments: [], embeds: [], mentions: [],
  },
];
const rx = lib.buildTranscript(reactMsgs, { ...meta, withReactors: true });
check(rx.markdown.includes('🔥 ×3'), 'reaction emoji and count rendered');
check(rx.markdown.includes(':based: ×2 (Bob, Carol)'), 'reactor names rendered when available');
check(!rx.markdown.includes('💀'), 'zero-count reaction omitted');
check(rx.markdown.includes('**Reactions:** 5 across the range'), 'total reaction count in header');
check(rx.markdown.includes('| Alice | @alice | 1 | 5 |'), 'participants table shows reactions received');
check(rx.markdown.includes('| Bob | @bob | 1 | 0 |'), 'participant with no reactions shows 0');
check(rx.markdown.includes('✏️ edited'), 'edited message marked with edit time');
check(rx.markdown.includes('📌 pinned'), 'pinned message marked');
check(rx.markdown.includes('**Edited messages:** 1'), 'edited count in header');
check(rx.markdown.includes('About reactions'), 'reactions note present');
check(rx.markdown.includes('Names in parentheses'), 'reactor note reflects withReactors=true');

const rxNoWho = lib.buildTranscript(reactMsgs, { ...meta, withReactors: false });
check(rxNoWho.markdown.includes('Only counts were captured'), 'note reflects counts-only mode');

// no reactions at all -> no reactions column or note
check(!markdown.includes('About reactions'), 'reactions note omitted when there are none');
check(markdown.includes('| Participant | Username | Messages |'), 'participants table stays 3-column without reactions');

// --- ZIP writer ---------------------------------------------------------------
const enc = new TextEncoder();
check(lib.crc32(enc.encode('123456789')) === 0xcbf43926, 'crc32 matches known test vector');
check(lib.crc32(new Uint8Array(0)) === 0, 'crc32 of empty is 0');

(async () => {
  const blob = lib.createZip([
    { name: 'debate-log.md', data: enc.encode('# hello') },
    { name: 'images/pic.bin', data: new Uint8Array([1, 2, 3, 4, 5]) },
  ]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  check(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04, 'zip starts with local file header (PK\\x03\\x04)');
  const eocd = bytes.length - 22; // no zip comment
  check(bytes[eocd] === 0x50 && bytes[eocd + 1] === 0x4b && bytes[eocd + 2] === 0x05 && bytes[eocd + 3] === 0x06, 'zip ends with end-of-central-directory record');
  const entries = bytes[eocd + 10] | (bytes[eocd + 11] << 8);
  check(entries === 2, 'zip central directory records two entries');

  console.log(`\nAll ${passed} checks passed.`);
})();
