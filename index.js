import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ApplicationIntegrationType,
  InteractionContextType,
  Partials
} from 'discord.js';
import http from 'node:http';
import 'dotenv/config';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message]
});

// Safe URL builder
const HTTPS = ['https:', ''].join('//');
const makeUrl = (host, path = '') => `${HTTPS}${host}${path}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Loomie's User ID & Website
const OWNER_ID = '1416390397881749514';
const SITE_URL = makeUrl('emolarp.fans');
const OC_IMAGE_URL = (process.env.OC_IMAGE_URL || '').trim();

// In-memory affection counter & most recent /e621 query tracker
const affectionCounts = new Map();
let totalAffectionDelivered = 0;
let lastE621Query = { tags: '', order: 'newest', rating: 'nsfw', ranAt: null };

function recordAffection(fromId, toId) {
  totalAffectionDelivered += 1;
  const key = `${fromId}->${toId}`;
  const next = (affectionCounts.get(key) || 0) + 1;
  affectionCounts.set(key, next);
  return next;
}

// Mood-matched kaomoji pools :3
const KAOMOJI = {
  online: ['ฅ^•ﻌ•^ฅ', '(=^･ω･^=)', '(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧', '(≧◡≦)', '(=^･ｪ･^=)', '٩(◕‿◕｡)۶'],
  cute: ['(｡･ω･｡)', '(´｡• ᵕ •｡`)', '(=①ω①=)', '(●´ω｀●)', 'ﾐ・ﻌ・ﾐ', '/ᐠ｡ꞈ｡ᐟ\\'],
  snuggle: ['(つ≧▽≦)つ', '(づ｡◕‿‿◕｡)づ', '(⊃｡•́‿•̀｡)⊃', '(´,,•ω•,,)', '(* ^ ω ^)'],
  headpat: ['(´･･)ﾉ(._.\`)', '(っ´ω`)ﾉ(╥ω╥)', '(づ｡◕‿‿◕｡)づ', 'ฅ^•ﻌ•^ฅ'],
  affection: ['(っ˘з(˘⌣˘ )', '(｡・//ε//・｡)', '(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)', '(´ε｀ )♡', '(*≧ω≦*)', '(´▽`ʃ♡ƪ)'],
  playful: ['(=`ω´=)', '(・`ω´・)', 'ฅ^•ﻌ•^ฅ', '(≧◡≦)', '(*≧ω≦*)'],
  blush: ['(｡・//ε//・｡)', '(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)', '(*/ω\\)', '(´,,•ω•,,)', '(´｡• ᵕ •｡`)']
};

class VerboseLogger {
  constructor(enabled = false) {
    this.enabled = enabled;
    this.reset();
  }

  reset() {
    this.startTime = performance.now();
    this.startIso = new Date().toISOString();
    this.entries = [];
    this.issues = [];
    this.successNote = null;
  }

  log(stage, message, data = undefined) {
    if (!this.enabled) return;
    const elapsed = (performance.now() - this.startTime).toFixed(2);
    const iso = new Date().toISOString();
    let line = `[${iso}] [+${elapsed}ms] [${stage}] ${message}`;
    if (data !== undefined) {
      let serialized;
      try {
        serialized = typeof data === 'object' ? JSON.stringify(data) : String(data);
      } catch {
        serialized = '[Unserializable data]';
      }
      line += ` | ${serialized}`;
    }
    this.entries.push(line);
  }

  explainIssue(text) {
    if (!this.enabled) return;
    this.issues.push(text);
  }

  explainSuccess(text) {
    if (!this.enabled) return;
    this.successNote = text;
  }

  clearIssues() {
    this.issues = [];
  }

  renderPlainEnglish() {
    if (this.issues.length > 0) {
      return (
        `⚠️ **What Went Wrong (Plain English):**\n` +
        this.issues.map((i) => `• ${i}`).join('\n') +
        `\n\n💡 *Tip: Check the technical trace below for exact server status and response codes.*`
      );
    }
    if (this.successNote) {
      return `✅ **What Happened (Plain English):** ${this.successNote}`;
    }
    const duration = (performance.now() - this.startTime).toFixed(2);
    return `✅ **What Happened (Plain English):** Everything worked properly in ${duration}ms! The command completed smoothly with zero errors.`;
  }

  renderTechnicalTrace(limit = 1800) {
    let out = this.entries.join('\n');
    if (out.length > limit) {
      const omitted = out.length - limit;
      out = out.slice(0, limit) + `\n... [${omitted} chars omitted to fit Discord payload limit]`;
    }
    return out || 'No trace entries captured.';
  }
}

function pick(category, logger = null) {
  const pool = KAOMOJI[category] || KAOMOJI.cute;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  logger?.log('RANDOM:PICK', `Picked kaomoji from pool "${category}"`, { chosen });
  return chosen;
}

const PASTEL_PINK = 0xffb7c5;
const PASTEL_BLUE = 0xbfe3ff;
const PASTEL_PURPLE = 0xe0bbf7;
const PASTEL_MINT = 0xbff5db;

// Multi-tier Species Fetcher
async function fetchSpeciesMedia(species, logger = null) {
  const t0 = performance.now();
  const lower = species.toLowerCase().trim();

  // Tier 1: Waifu.pics
  const waifuMap = {
    neko: 'neko',
    kitsune: 'fox_girl',
    fox: 'fox_girl',
    waifu: 'waifu',
    maid: 'maid',
    bunny: 'waifu',
    puppy: 'neko'
  };

  const waifuTarget = waifuMap[lower] || (['neko', 'kitsune', 'waifu', 'maid'].includes(lower) ? lower : null);
  if (waifuTarget) {
    const ep = `https://api.waifu.pics/sfw/${waifuTarget}`;
    logger?.log('HTTP:REQ', `Tier 1 [Waifu.pics] GET ${ep}`, { species, waifuTarget });
    try {
      const res = await fetch(ep, { signal: AbortSignal.timeout(6000) });
      const latencyMs = (performance.now() - t0).toFixed(2);
      logger?.log('HTTP:RES', `Tier 1 [Waifu.pics] HTTP ${res.status} in ${latencyMs}ms`, { ok: res.ok });
      if (res.ok) {
        const data = await res.json();
        if (data?.url) {
          logger?.log('SPECIES:HIT', `Resolved species="${species}" via Waifu.pics`, { url: data.url });
          return data.url;
        }
      }
    } catch (err) {
      logger?.log('HTTP:ERR', `Tier 1 [Waifu.pics] failed`, { error: err?.message || String(err) });
    }
  }

  // Tier 2: Nekos.best
  const nbEndpoints = ['neko', 'kitsune', 'waifu', 'husbando'];
  const nbTarget = nbEndpoints.includes(lower) ? lower : 'neko';
  const nbUrl = `https://nekos.best/api/v2/${nbTarget}?amount=1`;
  logger?.log('HTTP:REQ', `Tier 2 [Nekos.best] GET ${nbUrl}`, { species, nbTarget });

  try {
    const res = await fetch(nbUrl, { signal: AbortSignal.timeout(6000) });
    const latencyMs = (performance.now() - t0).toFixed(2);
    logger?.log('HTTP:RES', `Tier 2 [Nekos.best] HTTP ${res.status} in ${latencyMs}ms`, { ok: res.ok });
    if (res.ok) {
      const nbData = await res.json();
      const url = nbData?.results?.[0]?.url || null;
      logger?.log('SPECIES:PARSE', `Tier 2 [Nekos.best] payload`, { url });
      if (url) return url;
    }
  } catch (err) {
    logger?.log('HTTP:ERR', `Tier 2 [Nekos.best] failed`, { error: err?.message || String(err) });
  }

  logger?.log('SPECIES:FAIL', `No media found across all endpoints for species="${species}"`);
  return null;
}

// Fetch SFW & NSFW media from e621.net Booru API
async function fetchE621Post(rawTags = '', order = 'newest', rating = 'nsfw', logger = null) {
  // Extract all tags, keeping explicit ratings completely untouched
  const cleanedUserTags = rawTags
    .split(/[\s,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t && !t.startsWith('order:') && t !== 'random');

  const queryTags = [...cleanedUserTags];

  // Check if user manually included a rating in the search tags
  const hasUserRating = cleanedUserTags.some((t) => t.startsWith('rating:') || t.startsWith('-rating:'));

  if (!hasUserRating) {
    if (rating === 'nsfw') {
      // Default: exclude all safe posts (keeps explicit & questionable adult posts)
      queryTags.push('-rating:s');
    } else if (rating === 'explicit') {
      // Hardcore explicit only
      queryTags.push('rating:e');
    } else if (rating === 'safe') {
      // Safe / SFW posts only
      queryTags.push('rating:s');
    } else if (rating === 'questionable') {
      queryTags.push('rating:q');
    }
  }

  if (order === 'score') queryTags.push('order:score');

  const baseHeaders = {
    'User-Agent': 'FurryDiscordBot/6.6 (by Loomie on e621; emolarp.fans)',
    'Accept': 'application/json'
  };

  let authHeader = null;
  if (process.env.E621_USERNAME && process.env.E621_API_KEY) {
    const token = Buffer.from(`${process.env.E621_USERNAME.trim()}:${process.env.E621_API_KEY.trim()}`).toString('base64');
    authHeader = `Basic ${token}`;
  }

  logger?.log('E621:INIT', `Searching e621.net`, {
    rawTags,
    order,
    rating,
    queryTags,
    hasAuth: Boolean(authHeader)
  });

  // Extract or reconstruct media link (guarantees Discord embed loads cleanly)
  function extractMedia(p) {
    const post = p?.post || p;
    if (!post || typeof post !== 'object') return null;
    if (post.flags?.deleted) return null;

    // Modern 2026 e621 schema: post.files { meta, original, sample, preview, video }
    // Legacy e621 schema: post.file, post.sample, post.preview
    const files = post.files || {};
    const meta = files.meta || post.file || {};
    const orig = files.original || {};
    const sample = files.sample || post.sample || {};
    const preview = files.preview || post.preview || {};

    const rawExt = (meta.ext || post.file?.ext || post.file_ext || '').replace(/^\./, '').toLowerCase();
    const md5 = meta.md5 || post.file?.md5 || post.md5;

    const isVideo = ['webm', 'mp4'].includes(rawExt);

    // Deterministic static1.e621.net CDN links
    const directCdn = md5 && rawExt
      ? makeUrl('static1.e621.net', `/data/${md5.slice(0, 2)}/${md5.slice(2, 4)}/${md5}.${rawExt}`)
      : null;

    const sampleCdn = md5
      ? makeUrl('static1.e621.net', `/data/sample/${md5.slice(0, 2)}/${md5.slice(2, 4)}/${md5}.jpg`)
      : null;

    const previewCdn = md5
      ? makeUrl('static1.e621.net', `/data/preview/${md5.slice(0, 2)}/${md5.slice(2, 4)}/${md5}.jpg`)
      : null;

    let displayUrl = null;
    let videoUrl = null;

    if (isVideo) {
      // For WebM/MP4 animations, Discord CANNOT embed video in image: { url }.
      // MUST use sample/preview JPG image for embed:
      displayUrl = sample.jpg || sampleCdn || preview.jpg || previewCdn || sample.url || preview.url || null;
      videoUrl = orig.url || directCdn || files.video?.original?.url || null;
    } else if (rawExt === 'gif') {
      // For animated GIFs, Discord displays them if <= 10MB
      displayUrl = orig.url || directCdn || sample.jpg || sampleCdn || null;
    } else {
      // For images (PNG, JPG, WebP):
      // CRITICAL FIX: Discord fails to load images > 8-10MB (many e621 PNGs are 15MB-35MB).
      // Always prioritize sample.jpg and sampleCdn (lightweight ~300KB JPG) so Discord NEVER fails to load!
      displayUrl = sample.jpg || sampleCdn || orig.url || directCdn || preview.jpg || previewCdn || null;
    }

    if (!displayUrl || typeof displayUrl !== 'string' || !displayUrl.startsWith('http')) {
      displayUrl = post.file_url || post.large_file_url || post.preview_file_url || sampleCdn || directCdn || previewCdn || null;
    }

    // Safety guard: Discord embed image URL must NEVER end in .webm or .mp4
    if (displayUrl && (displayUrl.endsWith('.webm') || displayUrl.endsWith('.mp4'))) {
      displayUrl = sampleCdn || previewCdn || null;
    }

    if (!displayUrl || typeof displayUrl !== 'string' || !displayUrl.startsWith('http')) {
      return null;
    }

    const cleanExt = isVideo ? 'jpg' : (rawExt || 'jpg');

    return {
      post,
      ext: cleanExt,
      isVideo,
      videoUrl,
      displayUrl
    };
  }

  const queryStr = encodeURIComponent(queryTags.join(' '));

  // Try endpoints on e621.net:
  const e621Urls = [
    `${makeUrl('e621.net', '/posts/random.json')}?tags=${queryStr}`,
    `${makeUrl('e621.net', '/posts.json')}?limit=75&tags=${queryStr}`
  ];

  // Try with auth if available; fallback to public headers if auth fails or returns 0 posts
  const headerVariants = [];
  if (authHeader) {
    headerVariants.push({ ...baseHeaders, Authorization: authHeader });
  }
  headerVariants.push({ ...baseHeaders });

  for (const headers of headerVariants) {
    for (const url of e621Urls) {
      const t0 = performance.now();
      logger?.log('HTTP:REQ', `e621.net GET ${url}`);

      try {
        const res = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(8000)
        });
        const latencyMs = (performance.now() - t0).toFixed(2);
        const rawText = await res.text();

        logger?.log('HTTP:RES', `e621.net HTTP ${res.status} in ${latencyMs}ms`);

        if (!res.ok) {
          logger?.explainIssue(`e621.net returned HTTP ${res.status}.`);
          continue;
        }

        let data;
        try {
          data = JSON.parse(rawText);
        } catch {
          logger?.explainIssue(`e621.net returned non-JSON response.`);
          continue;
        }

        // Robust unwrapping of single object or array
        let postsList = [];
        if (Array.isArray(data)) {
          postsList = data;
        } else if (Array.isArray(data?.posts)) {
          postsList = data.posts;
        } else if (data?.post) {
          postsList = [data.post];
        } else if (data?.id) {
          postsList = [data];
        }

        const validPosts = postsList
          .map(extractMedia)
          .filter(Boolean);

        logger?.log('E621:FILTER', `Filtered e621.net results`, {
          rawCount: postsList.length,
          validCount: validPosts.length
        });

        if (validPosts.length === 0) continue;

        // Pick a random post from matching pool
        const picked = validPosts[Math.floor(Math.random() * validPosts.length)];
        const chosen = picked.post;

        let artists = [];
        let species = [];

        if (Array.isArray(chosen.tags)) {
          // Modern e621 schema: array of tag strings
          species = chosen.tags.filter((t) => ['dragon', 'canine', 'feline', 'wolf', 'fox', 'scalie', 'lizard', 'otter', 'cat', 'dog', 'neko', 'equine', 'sergal', 'protogen'].includes(t)).slice(0, 4);
          if (!species.length) species = chosen.tags.slice(0, 3);
        } else if (chosen.tags && typeof chosen.tags === 'object') {
          // Legacy e621 schema: tags object
          artists = (chosen.tags.artist || []).filter((a) => a !== 'conditional_dnp').slice(0, 3);
          species = (chosen.tags.species || []).slice(0, 4);
        }

        const artistStr = artists.length
          ? artists.join(', ')
          : (chosen.uploader_name || chosen.tag_string_artist || 'Artist unknown');

        const speciesStr = species.length
          ? species.join(', ')
          : (chosen.tag_string_species || 'Furry');

        const scoreVal = typeof chosen.stats?.score?.total === 'number'
          ? chosen.stats.score.total
          : (typeof chosen.score === 'object' ? (chosen.score?.total ?? 0) : (chosen.score ?? 0));

        logger?.clearIssues();
        logger?.explainSuccess(`Got post #${chosen.id} (\`.${picked.ext}\`) directly from e621.net in ${latencyMs}ms!`);

        return {
          id: chosen.id,
          imageUrl: picked.displayUrl,
          videoUrl: picked.videoUrl,
          isVideo: picked.isVideo,
          postUrl: makeUrl('e621.net', `/posts/${chosen.id}`),
          score: scoreVal,
          artists: artistStr,
          species: speciesStr,
          searchedTags: cleanedUserTags.length ? cleanedUserTags.join(' ') : 'all posts',
          rating: chosen.rating || 'e',
          ext: picked.ext
        };
      } catch (err) {
        logger?.log('HTTP:ERR', `e621 fetch failed`, { error: err?.message || String(err) });
        logger?.explainIssue(`Connection to e621.net failed (${err?.message || 'network error'}).`);
      }
    }
  }

  return null;
}

function buildActionCopy(action, fromId, toId, logger = null) {
  const copyMap = {
    snuggle: {
      title: `Cozy Snuggle Pile~!! ${pick('snuggle', logger)}`,
      text: `*adjusts oversized pastel hoodie & striped thigh-highs, curling up close*\n\n<@${fromId}> wraps <@${toId}> in the warmest, fluffiest snuggles and gentle tail-wraps!! ${pick('snuggle', logger)}`,
      backLabel: 'Snuggle Back :3'
    },
    hug: {
      title: `Warm Fluffy Hug~!! ${pick('snuggle', logger)}`,
      text: `*opens arms wide and rushes in for a big squeeze*\n\n<@${fromId}> pulls <@${toId}> into the tightest, coziest hug ever!! ${pick('snuggle', logger)}`,
      backLabel: 'Hug Back ^w^'
    },
    lick: {
      title: `Playful Paw & Cheek Lick~ ${pick('affection', logger)}`,
      text: `*ears perk up and tail wags wildly*\n\n<@${fromId}> leans in and gives <@${toId}> a super cute, playful puppy-boy lick right on the cheek!! ${pick('affection', logger)}`,
      backLabel: 'Lick Back >w<'
    },
    kiss: {
      title: `Sweet Pastel Kiss~ ${pick('affection', logger)}`,
      text: `*blushes softly and paws at the air*\n\n<@${fromId}> gives <@${toId}> the sweetest, softest forehead & cheek kiss!! ${pick('affection', logger)}`,
      backLabel: 'Kiss Back >///<'
    },
    boop: {
      title: `Gentle Nose Boop~!! ${pick('playful', logger)}`,
      text: `*reaches forward with soft paws and gently presses your nose*\n\n**BOOP!** <@${fromId}> booped <@${toId}> right on their cute snoot!! ${pick('playful', logger)}`,
      backLabel: 'Boop Back >:3'
    },
    headpat: {
      title: `Warm Gentle Headpats~ ${pick('headpat', logger)}`,
      text: `*gently reaches up and softly strokes between your ears*\n\n<@${fromId}> gives <@${toId}> the softest, most loving headpats! Good cutie!! ${pick('headpat', logger)}`,
      backLabel: 'Headpat Back :3'
    },
    cuddle: {
      title: `Sweet Cozy Cuddle~ ${pick('snuggle', logger)}`,
      text: `*pulls a pastel blanket over both of you, tail resting lightly across your lap*\n\n<@${fromId}> and <@${toId}> are locked in an adorable cuddle session!! ${pick('snuggle', logger)}`,
      backLabel: 'Cuddle Back ^///^'
    },
    bite: {
      title: `Playful Soft Nibble~ ${pick('playful', logger)}`,
      text: `*mischievous toothy grin and twitching fluffy ears*\n\n*nom!* <@${fromId}> gave <@${toId}> a gentle, playful affection nibble!! ${pick('playful', logger)}`,
      backLabel: 'Nibble Back >:3'
    },
    holdhands: {
      title: `Warm Paw Holding~ ${pick('affection', logger)}`,
      text: `*shyly reaches out and gently interlocks fingers and soft beans*\n\n<@${fromId}> is holding paws with <@${toId}>! It feels warm and safe... ${pick('affection', logger)}`,
      backLabel: 'Hold Paws Back :3'
    },
    poke: {
      title: `Cheeky Paw Poke~ ${pick('playful', logger)}`,
      text: `*sneaks up on tiptoes and pokes your side with a soft claw*\n\n*poke poke!* <@${fromId}> poked <@${toId}> to get their attention!! ${pick('playful', logger)}`,
      backLabel: 'Poke Back >w<'
    },
    glomp: {
      title: `High-Velocity Flying Glomp~!! 🐾`,
      text: `*takes a running start, launching through the air with outstretched paws*\n\n**OOF!** <@${fromId}> completely tackled <@${toId}> with an unstoppable affection dive!! ${pick('playful', logger)}`,
      backLabel: 'Glomp Back!! >:3'
    },
    blush: {
      title: `Flustered Rosy Cheeks~ ${pick('blush', logger)}`,
      text: `*hides flushed pink face inside oversized hoodie sleeves*\n\n<@${fromId}> got completely flustered and blushed because of <@${toId}>!! ${pick('blush', logger)}`,
      backLabel: 'Tease the Cutie :3'
    },
    nuzzle: {
      title: `Warm Whisker & Cheek Nuzzle~ ${pick('snuggle', logger)}`,
      text: `*leans in close, rubbing soft cheek fur and whiskers against your shoulder*\n\n<@${fromId}> nuzzles against <@${toId}> lovingly... ${pick('snuggle', logger)}`,
      backLabel: 'Nuzzle Back ^w^'
    },
    rawr: {
      title: `Ferocious Pocket-Size RAWR~!! 🦖`,
      text: `*fluffs up ears, bares tiny fangs and lets out the cutest little growl*\n\n**RAAAWR!** Means "I love you" in dinosaur language!! <@${fromId}> rawrs loudly at <@${toId}>!! ${pick('playful', logger)}`,
      backLabel: 'Rawr Back! >:3'
    },
    pounce: {
      title: `Stealthy Playful Pounce~!! 🐾`,
      text: `*wiggles hind paws, lowers down and leaps gracefully through the air*\n\n*POUNCE!* <@${fromId}> lands softly on <@${toId}>! Caught ya!! ${pick('playful', logger)}`,
      backLabel: 'Pounce Back ^w^'
    },
    groom: {
      title: `Tender Fur Preening & Groom~ ${pick('cute', logger)}`,
      text: `*carefully combs through messy tufts of fur with gentle, soft paws*\n\n<@${fromId}> is tidying up and grooming <@${toId}>'s fluffy coat so they look their best!! ${pick('cute', logger)}`,
      backLabel: 'Preen Back :3'
    },
    yeet: {
      title: `Comedic Orbital Yeet~!! 🚀`,
      text: `*picks you up effortlessly by your hoodie waistband and spins in a circle*\n\n**YEET!** <@${fromId}> launched <@${toId}> straight into low Earth orbit!! *twinkle in the sky* 🌟`,
      backLabel: 'Yeet Back >:D'
    },
    cry: {
      title: `Sniffling Puppy Tears... (╥﹏╥)`,
      text: `*eyes well up with giant teardrops, ears drooping all the way down*\n\n<@${fromId}> is crying softly near <@${toId}>... please comfort them with warm snuggles!`,
      backLabel: 'Comfort the Cutie (つ´ω`)つ'
    },
    slap: {
      title: `Dramatic Squeaky Paw-Bap~!! 💢`,
      text: `*puffs out cheeks and delivers a comical squeaky-toy slap to your arm*\n\n*BAP!* <@${fromId}> slapped <@${toId}>!! Don't be naughty!! >_<`,
      backLabel: 'Bap Back >:('
    },
    highfive: {
      title: `Crisp Fluffy High Five~!! 🐾`,
      text: `*raises soft paw high into the air with a wide grin*\n\n**CLAP!** <@${fromId}> and <@${toId}> locked in a perfectly crisp high-five!! ${pick('online', logger)}`,
      backLabel: 'High Five Back! :3'
    }
  };

  return copyMap[action] || null;
}

function buildE621Response(post, rawTags = '', order = 'newest', rating = 'nsfw', logger = null) {
  const safeCustomId = `e621:${rating}:${order}:${rawTags.slice(0, 65)}`;
  const buttons = [
    new ButtonBuilder()
      .setCustomId(safeCustomId)
      .setLabel('Roll Again :3')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setLabel('View on e621.net ^w^')
      .setStyle(ButtonStyle.Link)
      .setURL(post.postUrl)
  ];

  if (post.videoUrl) {
    buttons.push(
      new ButtonBuilder()
        .setLabel('Watch Video / WebM 🎥')
        .setStyle(ButtonStyle.Link)
        .setURL(post.videoUrl)
    );
  }

  const row = new ActionRowBuilder().addComponents(buttons);

  const ratingMap = {
    s: 'Safe (SFW) 🌱',
    q: 'Questionable 🔥',
    e: 'Explicit (NSFW) 🔞'
  };
  const ratingLabel = ratingMap[post.rating] || 'NSFW / Adult 🔞';

  let desc =
    `*ears perk up and tail wags!* Found a post for \`${post.searchedTags}\`! ${pick('online', logger)}\n\n` +
    `• **Artist:** \`${post.artists}\` • **Species/Tags:** \`${post.species}\` • **Score:** \`${post.score}\` • **Rating:** \`${ratingLabel}\`\n`;

  if (post.isVideo) {
    desc += `• 🎥 **Animated Video:** [Click to Watch (${post.ext.toUpperCase()})](${post.videoUrl || post.postUrl})\n`;
  }
  desc += `• [emolarp.fans](${SITE_URL}) :3`;

  logger?.log('EMBED:E621', `Constructed e621 embed`, {
    postId: post.id,
    postUrl: post.postUrl,
    imageUrl: post.imageUrl,
    isVideo: post.isVideo,
    rating: post.rating
  });

  return {
    embeds: [{
      title: `e621 Booru Pull~ ${pick('cute', logger)}`,
      description: desc,
      color: PASTEL_PINK,
      image: { url: post.imageUrl },
      footer: { text: `e621.net • Post #${post.id} • Rating: ${ratingLabel} • paws certified :3` }
    }],
    components: [row]
  };
}

// Parse /log input
async function parseLogCommandInput(interaction, logger) {
  const rawCommandOption = (interaction.options.getString('command', true) || '').trim();
  const rawArgsOption = (interaction.options.getString('args') || '').trim();

  const explicitOptions = {
    cutie: interaction.options.getUser('cutie') || null,
    cutie2: interaction.options.getUser('cutie2') || null,
    vibe: interaction.options.getString('vibe') || null,
    tags: interaction.options.getString('tags') || null,
    rating: interaction.options.getString('rating') || null,
    order: interaction.options.getString('order') || null,
    species: interaction.options.getString('species') || null,
    question: interaction.options.getString('question') || null,
    user_id: interaction.options.getString('user_id') || null,
    scope: interaction.options.getString('scope') || null
  };

  const combinedTokens = `${rawCommandOption} ${rawArgsOption}`.trim().split(/\s+/).filter(Boolean);
  let targetCommand = (combinedTokens.shift() || '').replace(/^\/+/, '').toLowerCase();

  while (targetCommand === 'log' && combinedTokens.length > 0) {
    targetCommand = combinedTokens.shift().replace(/^\/+/, '').toLowerCase();
  }

  let remainder = combinedTokens.join(' ').trim();

  const inlineKv = {};
  remainder = remainder
    .replace(/\b(order|rating|vibe|species|user_id|cutie|cutie2|scope)[:=]([^\s]+)/gi, (_, k, v) => {
      inlineKv[k.toLowerCase()] = v.trim();
      return '';
    })
    .trim();

  const inlineMultiMatch = remainder.match(/\b(tags|question)[:=](.+)$/i);
  if (inlineMultiMatch) {
    inlineKv[inlineMultiMatch[1].toLowerCase()] = inlineMultiMatch[2].trim();
    remainder = remainder.slice(0, inlineMultiMatch.index).trim();
  }

  let cutieParam = explicitOptions.cutie;
  let cutie2Param = explicitOptions.cutie2;

  if (inlineKv.cutie) {
    const id = inlineKv.cutie.replace(/[<@!>]/g, '');
    cutieParam = await client.users.fetch(id).catch(() => null);
  }
  if (inlineKv.cutie2) {
    const id = inlineKv.cutie2.replace(/[<@!>]/g, '');
    cutie2Param = await client.users.fetch(id).catch(() => null);
  }

  const mentionIds = [...remainder.matchAll(/<@!?(\d+)>/g)].map((m) => m[1]);
  if (!cutieParam && mentionIds.length > 0) {
    cutieParam = await client.users.fetch(mentionIds[0]).catch(() => null);
  }
  if (!cutie2Param && mentionIds.length > 1) {
    cutie2Param = await client.users.fetch(mentionIds[1]).catch(() => null);
  }

  remainder = remainder.replace(/<@!?\d+>/g, '').trim();

  let tagsParam = explicitOptions.tags || inlineKv.tags || '';
  if (!tagsParam && targetCommand === 'e621' && remainder) {
    tagsParam = remainder;
  }

  let questionParam = explicitOptions.question || inlineKv.question || '';
  if (!questionParam && targetCommand === '8ball' && remainder) {
    questionParam = remainder;
  }

  const finalParams = {
    cutie: cutieParam || (targetCommand !== 'avatar' ? interaction.user : null),
    cutie2: cutie2Param || null,
    vibe: explicitOptions.vibe || inlineKv.vibe || 'furry',
    tags: tagsParam,
    rating: explicitOptions.rating || inlineKv.rating || 'nsfw',
    order: explicitOptions.order || inlineKv.order || 'newest',
    species: explicitOptions.species || inlineKv.species || (targetCommand === 'species' && remainder ? remainder : 'neko'),
    question: questionParam || 'Will today be super cute?',
    user_id: explicitOptions.user_id || inlineKv.user_id || null,
    scope: explicitOptions.scope || inlineKv.scope || 'both'
  };

  logger.log('PARSER:OUTPUT', `Resolved target command "${targetCommand}"`, {
    targetCommand,
    finalParams: {
      ...finalParams,
      cutie: finalParams.cutie ? `${finalParams.cutie.tag} (${finalParams.cutie.id})` : null,
      cutie2: finalParams.cutie2 ? `${finalParams.cutie2.tag} (${finalParams.cutie2.id})` : null
    }
  });

  return { targetCommand, finalParams };
}

// Master Command Router
async function executeBotCommand(commandName, params, interaction, logger = null) {
  logger?.log('EXEC:ENTER', `Entering handler for command "/${commandName}"`, {
    invokerId: interaction.user.id,
    invokerTag: interaction.user.tag
  });

  // /e621 — Direct e621.net booru pull (defaulting to NSFW/Adult)
  if (commandName === 'e621') {
    const rawTags = params.tags !== undefined && params.tags !== '' ? params.tags : lastE621Query.tags;
    const order = params.order || lastE621Query.order || 'newest';
    const rating = params.rating || lastE621Query.rating || 'nsfw';
    lastE621Query = { tags: rawTags, order, rating, ranAt: new Date().toISOString() };

    logger?.log('CMD:E621', `Executing /e621 with tags="${rawTags}" rating="${rating}" order="${order}" on e621.net`, { lastE621Query });
    const post = await fetchE621Post(rawTags, order, rating, logger);

    if (!post) {
      logger?.log('CMD:E621_EMPTY', `No valid post returned from e621.net for tags="${rawTags}" rating="${rating}"`);
      return {
        content: `Awr~ I couldn't find any ${rating === 'safe' ? 'safe' : 'NSFW'} posts on e621.net for \`${rawTags || 'your search'}\`! Try simpler tags like \`deer\`, \`dragon\`, or \`fox\`, >_<`
      };
    }

    return buildE621Response(post, rawTags, order, rating, logger);
  }

  // /update — Re-deploy commands, sync guilds, test connectivity (Owner only)
  if (commandName === 'update') {
    if (interaction.user.id !== OWNER_ID) {
      return {
        content: `Awr~ Only Loomie (<@${OWNER_ID}>) can run \`/update\`! >_< ${pick('blush', logger)}`,
        ephemeral: true
      };
    }

    const scope = params.scope || 'both';
    logger?.log('CMD:UPDATE', `Running /update with scope="${scope}" in guild="${interaction.guildId || 'DM'}"`);

    const deployRes = await deployCommands({
      guildId: interaction.guildId,
      scope,
      logger
    });

    let e621Status = 'Testing...';
    try {
      const e621Check = await fetchE621Post('deer', 'newest', 'nsfw', logger);
      e621Status = e621Check ? `✅ Working (Post #${e621Check.id})` : '⚠️ No media returned';
    } catch (e) {
      e621Status = `❌ Error: ${e.message}`;
    }

    const fields = [
      { name: 'Global Commands', value: `\`${deployRes.globalCount ?? 'Unchanged'}\` deployed`, inline: true },
      { name: 'Server Commands', value: interaction.guildId ? `\`${deployRes.guildCount ?? 'Unchanged'}\` (Instant Sync!)` : 'N/A (DM)', inline: true },
      { name: 'Gateway Ping', value: `\`${client.ws.ping}ms\``, inline: true },
      { name: 'e621.net Check', value: e621Status, inline: true },
      { name: 'Total Commands', value: `\`${ALL_COMMANDS.length}\` registered`, inline: true },
      { name: 'Website', value: `[emolarp.fans](${SITE_URL})`, inline: true }
    ];

    logger?.explainSuccess(`Commands redeployed successfully! Guild commands synced immediately without cache delay.`);

    return {
      embeds: [{
        title: `⚡ Command Cache Force-Synchronized! ${pick('online', logger)}`,
        description: `All slash commands have been re-registered directly with Discord API! If commands still don't show up in your Discord client, restart Discord (Ctrl+R) to refresh your client's UI cache. :3`,
        color: PASTEL_MINT,
        fields,
        footer: { text: `Triggered by Loomie (${OWNER_ID}) • ${new Date().toLocaleTimeString()}` }
      }]
    };
  }

  // /log — Verbose execution trace & plain English explanations
  if (commandName === 'log') {
    const { targetCommand, finalParams } = await parseLogCommandInput(interaction, logger);

    if (!targetCommand) {
      return {
        content: `Awr~ Please specify a command to test, like \`/log command: e621 args: dragon rating: nsfw\` or \`/log command: ping\`! >_<`
      };
    }

    logger.log('LOG:START', `Running nested execution for command "/${targetCommand}"`, { finalParams });
    const payload = await executeBotCommand(targetCommand, finalParams, interaction, logger);

    const technicalTrace = logger.renderTechnicalTrace(1500);
    const plainEnglish = logger.renderPlainEnglish();

    const traceEmbed = {
      title: `📋 Technical Trace (\`/${targetCommand}\` • ${logger.entries.length} events)`,
      description: `\`\`\`log\n${technicalTrace}\n\`\`\``,
      color: logger.issues.length ? 0xff6b81 : PASTEL_BLUE,
      footer: { text: `Trace duration: ${(performance.now() - logger.startTime).toFixed(2)}ms` }
    };

    const outPayload = { ...payload };

    if (outPayload.embeds && Array.isArray(outPayload.embeds)) {
      outPayload.embeds = [...outPayload.embeds, traceEmbed];
    } else {
      outPayload.embeds = [traceEmbed];
    }

    const plainEnglishBlock = `${plainEnglish}\n\n`;
    if (outPayload.content) {
      outPayload.content = `${outPayload.content}\n\n${plainEnglishBlock}`;
    } else {
      outPayload.content = plainEnglishBlock;
    }

    return outPayload;
  }

  // Roleplay Actions (/snuggle, /hug, etc.)
  const actionData = buildActionCopy(commandName, interaction.user.id, params.cutie?.id || interaction.user.id, logger);
  if (actionData) {
    const fromId = interaction.user.id;
    const toId = params.cutie?.id || interaction.user.id;
    const count = recordAffection(fromId, toId);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`act:${commandName}:${fromId}`)
        .setLabel(actionData.backLabel)
        .setStyle(ButtonStyle.Primary)
    );

    return {
      embeds: [{
        title: actionData.title,
        description:
          `${actionData.text}\n\n` +
          `💖 **Total Affection Count:** \`${count}\` times between you two! (Overall delivered: \`${totalAffectionDelivered}\`)\n` +
          `• [emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_PINK,
        footer: { text: `emolarp.fans • paws & affection certified :3` }
      }],
      components: [row]
    };
  }

  // /species
  if (commandName === 'species') {
    const chosen = params.species || 'neko';
    const mediaUrl = await fetchSpeciesMedia(chosen, logger);

    const embed = {
      title: `Species Transform: ${chosen.toUpperCase()}~ ${pick('cute', logger)}`,
      description:
        `*ears wiggle and tail twitches softly!*\n\n` +
        `<@${interaction.user.id}> is vibing as an adorable **${chosen}**!! ${pick('snuggle', logger)}\n\n` +
        `• [emolarp.fans](${SITE_URL}) :3`,
      color: PASTEL_PURPLE,
      footer: { text: `emolarp.fans • species generator :3` }
    };

    if (mediaUrl) {
      embed.image = { url: mediaUrl };
    }

    return { embeds: [embed] };
  }

  // /ship
  if (commandName === 'ship') {
    const c1 = params.cutie || interaction.user;
    const c2 = params.cutie2 || interaction.user;
    const seed = (Number(BigInt(c1.id) ^ BigInt(c2.id)) % 100) + 1;
    const percentage = Math.abs(seed);

    let meter = '▓'.repeat(Math.floor(percentage / 10)) + '░'.repeat(10 - Math.floor(percentage / 10));

    return {
      embeds: [{
        title: `Compatibility Love Meter~ ${pick('affection', logger)}`,
        description:
          `💖 **Match:** <@${c1.id}> × <@${c2.id}>\n\n` +
          `**Rate:** \`${percentage}%\` [${meter}]\n\n` +
          (percentage > 75
            ? `*AWWWW!!* Soulmates forever and ever!! ${pick('blush', logger)}`
            : percentage > 45
            ? `A super cozy and cute match!! ${pick('snuggle', logger)}`
            : `Opposites attract, maybe with more cuddles?! ${pick('playful', logger)}`) +
          `\n\n• [emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_PINK
      }]
    };
  }

  // /8ball
  if (commandName === '8ball') {
    const answers = [
      `Yes, absolutely yes!! ${pick('cute', logger)}`,
      `Most pawsitively yes!! ${pick('online', logger)}`,
      `My tail is wagging, so YES!! ${pick('snuggle', logger)}`,
      `Better not tell you right now, snuggle me first! ${pick('blush', logger)}`,
      `Cannot predict now, too busy purring~ ${pick('playful', logger)}`,
      `My paws say no... >_<`,
      `Very doubtful, awr... (╥﹏╥)`
    ];
    const answer = answers[Math.floor(Math.random() * answers.length)];

    return {
      embeds: [{
        title: `Mystic Fluffy 8-Ball~ 🔮`,
        description:
          `**Question:** ${params.question}\n\n` +
          `**Answer:** ${answer}\n\n` +
          `• [emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_BLUE
      }]
    };
  }

  // /avatar
  if (commandName === 'avatar') {
    const targetUser = params.cutie || interaction.user;
    const avatarUrl = targetUser.displayAvatarURL({ size: 1024, dynamic: true });

    return {
      embeds: [{
        title: `${targetUser.username}'s Cute Avatar~ ${pick('cute', logger)}`,
        description: `[Direct Image Link](${avatarUrl}) • [emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_PURPLE,
        image: { url: avatarUrl }
      }]
    };
  }

  // /banner
  if (commandName === 'banner') {
    const targetUser = await client.users.fetch(params.cutie?.id || interaction.user.id, { force: true });
    const bannerUrl = targetUser.bannerURL({ size: 1024, dynamic: true });

    if (!bannerUrl) {
      return {
        content: `Awr~ <@${targetUser.id}> doesn't have a custom profile banner set! >_< ${pick('blush', logger)}`
      };
    }

    return {
      embeds: [{
        title: `${targetUser.username}'s Profile Banner~ ${pick('cute', logger)}`,
        description: `[Direct Banner Link](${bannerUrl}) • [emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_PURPLE,
        image: { url: bannerUrl }
      }]
    };
  }

  // /ping
  if (commandName === 'ping') {
    const latency = Date.now() - interaction.createdTimestamp;
    const wsPing = client.ws.ping;

    return {
      embeds: [{
        title: `Pong!! Paws are Fast~ ${pick('online', logger)}`,
        description:
          `• **Gateway Ping:** \`${wsPing}ms\`\n` +
          `• **Interaction Roundtrip:** \`${latency}ms\`\n` +
          `• **Website:** [emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_MINT
      }]
    };
  }

  // /oc
  if (commandName === 'oc') {
    const embed = {
      title: `Loomie's Cutie OC~ ${pick('cute', logger)}`,
      description:
        `*twirls around showing off pastel oversized hoodie, thigh-highs, and cat ears!*\n\n` +
        `• **Owner:** Loomie (<@${OWNER_ID}>)\n` +
        `• **Official Site:** [emolarp.fans](${SITE_URL})\n\n` +
        `Thank you for snuggling with my bot!! ${pick('affection', logger)}`,
      color: PASTEL_PINK,
      footer: { text: `emolarp.fans • Official OC Showcase` }
    };

    if (OC_IMAGE_URL) {
      embed.image = { url: OC_IMAGE_URL };
    }

    return { embeds: [embed] };
  }

  // /help
  if (commandName === 'help') {
    return {
      embeds: [{
        title: `Furry Bot Command Guide~ ${pick('online', logger)}`,
        description:
          `**Art & Booru Search:**\n` +
          `• \`/e621 [tags] [rating] [order]\` — Pure e621.net booru query (Defaults to NSFW, filters out safe posts!)\n` +
          `• \`/species [species]\` — Dynamic species transform image generator\n\n` +
          `**Cozy Roleplay (Interactive Buttons):**\n` +
          `• \`/snuggle\`, \`/hug\`, \`/lick\`, \`/kiss\`, \`/boop\`, \`/headpat\`, \`/cuddle\`, \`/bite\`, \`/holdhands\`, \`/poke\`, \`/glomp\`, \`/nuzzle\`, \`/rawr\`, \`/pounce\`, \`/groom\`, \`/yeet\`, \`/cry\`, \`/slap\`, \`/highfive\`, \`/blush\`\n\n` +
          `**Admin & Diagnostics:**\n` +
          `• \`/update [scope]\` or \`!update\` — Instant guild command cache flush & re-sync (Owner only)\n` +
          `• \`/log command: <cmd> args: <args>\` — Extremely detailed execution trace with plain English diagnosis\n\n` +
          `• **Official Website:** [emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_PINK
      }]
    };
  }

  return {
    content: `Awr~ Unknown command \`/${commandName}\`! Type \`/help\` to see everything I can do! >_<`
  };
}

// All Slash Command Definitions
const ALL_ACTIONS = [
  ['snuggle', 'Wrap a cutie in cozy warm snuggles!'],
  ['hug', 'Give a big warm fluffy squeeze!'],
  ['lick', 'Give a cute puppy cheek lick!'],
  ['kiss', 'Give a soft pastel kiss!'],
  ['boop', 'Boop someone on their cute nose!'],
  ['headpat', 'Gently pat a good cutie on the head!'],
  ['cuddle', 'Curl up together for a sweet cuddle!'],
  ['bite', 'Give a tiny playful affection nibble!'],
  ['holdhands', 'Interlock warm fluffy paws!'],
  ['poke', 'Poke a cutie playfully to get attention!'],
  ['glomp', 'Launch an unstoppable flying tackle hug!'],
  ['blush', 'Get flustered with pink rosy cheeks!'],
  ['nuzzle', 'Nuzzle your nose and whiskers softly!'],
  ['rawr', 'Let out a ferocious cute little rawr!'],
  ['pounce', 'Playfully pounce on an unsuspecting cutie!'],
  ['groom', 'Carefully preen and tidy someone’s fur!'],
  ['yeet', 'Comically yeet someone into low orbit!'],
  ['cry', 'Sniffle and shed big soft puppy tears!'],
  ['slap', 'Deliver a dramatic squeaky-toy slap!'],
  ['highfive', 'Slap a crisp high-five together!']
];

const slashActionCommands = ALL_ACTIONS.map(([name, desc]) =>
  new SlashCommandBuilder()
    .setName(name)
    .setDescription(desc)
    .addUserOption((o) => o.setName('cutie').setDescription('The cutie to target').setRequired(false))
    .setIntegrationTypes([
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall
    ])
    .setContexts([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel
    ])
);

const ALL_COMMANDS = [
  ...slashActionCommands,
  new SlashCommandBuilder()
    .setName('e621')
    .setDescription('Pull furry art & GIFs directly from e621.net! :3')
    .addStringOption((opt) =>
      opt
        .setName('tags')
        .setDescription('Space-separated booru tags (e.g. "dragon", "fox cuddle") :3')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('rating')
        .setDescription('Filter content rating (Defaults to NSFW / Adult) :3')
        .setRequired(false)
        .addChoices(
          { name: '🔞 NSFW / Adult (Default - no safe posts)', value: 'nsfw' },
          { name: '🔥 Explicit Only (Hardcore)', value: 'explicit' },
          { name: '🌱 Safe / SFW Only', value: 'safe' },
          { name: '✨ All Ratings (Include everything)', value: 'all' }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName('order')
        .setDescription('How to sort results! ^w^')
        .setRequired(false)
        .addChoices(
          { name: 'Newest uwu', value: 'newest' },
          { name: 'Top Score ^w^', value: 'score' }
        )
    )
    .setIntegrationTypes([
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall
    ])
    .setContexts([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel
    ]),
  new SlashCommandBuilder()
    .setName('update')
    .setDescription('Force-synchronize slash commands to this server or globally (Owner only)')
    .addStringOption((o) =>
      o
        .setName('scope')
        .setDescription('Where to register commands')
        .setRequired(false)
        .addChoices(
          { name: 'Guild & Global (Recommended)', value: 'both' },
          { name: 'Current Guild Only (Instant)', value: 'guild' },
          { name: 'Global Only', value: 'global' }
        )
    )
    .setIntegrationTypes([
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall
    ])
    .setContexts([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel
    ]),
  new SlashCommandBuilder()
    .setName('log')
    .setDescription('Run any command with a verbose diagnostic trace')
    .addStringOption((o) => o.setName('command').setDescription('The command to test (e.g. e621, ping)').setRequired(true))
    .addStringOption((o) => o.setName('args').setDescription('Arguments (e.g. dragon, @cutie)').setRequired(false))
    .addUserOption((o) => o.setName('cutie').setDescription('Cutie target for actions').setRequired(false))
    .addUserOption((o) => o.setName('cutie2').setDescription('Second cutie for /ship').setRequired(false))
    .addStringOption((o) => o.setName('tags').setDescription('Tags for /e621').setRequired(false))
    .addStringOption((opt) =>
      opt
        .setName('rating')
        .setDescription('Filter content rating for /e621 :3')
        .setRequired(false)
        .addChoices(
          { name: '🔞 NSFW / Adult (Default - no safe posts)', value: 'nsfw' },
          { name: '🔥 Explicit Only (Hardcore)', value: 'explicit' },
          { name: '🌱 Safe / SFW Only', value: 'safe' },
          { name: '✨ All Ratings (Include everything)', value: 'all' }
        )
    )
    .addStringOption((o) => o.setName('order').setDescription('Order for /e621').setRequired(false))
    .addStringOption((o) => o.setName('species').setDescription('Species for /species').setRequired(false))
    .addStringOption((o) => o.setName('question').setDescription('Question for /8ball').setRequired(false))
    .setIntegrationTypes([
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall
    ])
    .setContexts([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel
    ]),
  new SlashCommandBuilder()
    .setName('species')
    .setDescription('Transform into an adorable species!')
    .addStringOption((o) =>
      o
        .setName('species')
        .setDescription('Species type')
        .setRequired(false)
        .addChoices(
          { name: 'Neko (Catgirl)', value: 'neko' },
          { name: 'Kitsune (Fox)', value: 'kitsune' },
          { name: 'Waifu', value: 'waifu' },
          { name: 'Maid', value: 'maid' }
        )
    )
    .setIntegrationTypes([
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall
    ])
    .setContexts([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel
    ]),
  new SlashCommandBuilder()
    .setName('ship')
    .setDescription('Calculate compatibility percentage between two cuties!')
    .addUserOption((o) => o.setName('cutie1').setDescription('First cutie').setRequired(true))
    .addUserOption((o) => o.setName('cutie2').setDescription('Second cutie').setRequired(false))
    .setIntegrationTypes([
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall
    ])
    .setContexts([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel
    ]),
  new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the magical fuzzy 8-ball anything!')
    .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true))
    .setIntegrationTypes([
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall
    ])
    .setContexts([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel
    ]),
  new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('View full-resolution avatar of yourself or a friend')
    .addUserOption((o) => o.setName('cutie').setDescription('The cutie to view').setRequired(false))
    .setIntegrationTypes([
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall
    ])
    .setContexts([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel
    ]),
  new SlashCommandBuilder()
    .setName('banner')
    .setDescription('View custom profile banner of yourself or a friend')
    .addUserOption((o) => o.setName('cutie').setDescription('The cutie to inspect').setRequired(false))
    .setIntegrationTypes([
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall
    ])
    .setContexts([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel
    ]),
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check WebSocket gateway ping & connection latency')
    .setIntegrationTypes([
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall
    ])
    .setContexts([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel
    ]),
  new SlashCommandBuilder()
    .setName('oc')
    .setDescription('Show Loomie\'s official cutie OC!')
    .setIntegrationTypes([
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall
    ])
    .setContexts([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel
    ]),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show complete command guide & website information')
    .setIntegrationTypes([
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall
    ])
    .setContexts([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel
    ])
];

// Deploy & Synchronize Commands
async function deployCommands({ guildId = null, scope = 'both', logger = null } = {}) {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const payload = ALL_COMMANDS.map((c) => c.toJSON());
  const res = { globalCount: null, guildCount: null };

  if (scope === 'global' || scope === 'both') {
    logger?.log('DEPLOY:GLOBAL', `Registering ${payload.length} global slash commands with Discord API`);
    const data = await rest.put(Routes.applicationCommands(client.user.id), { body: payload });
    res.globalCount = Array.isArray(data) ? data.length : payload.length;
    logger?.log('DEPLOY:GLOBAL_OK', `Successfully registered ${res.globalCount} global commands`);
  }

  if ((scope === 'guild' || scope === 'both') && guildId) {
    logger?.log('DEPLOY:GUILD', `Registering ${payload.length} instant guild commands for guildId="${guildId}"`);
    const data = await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: payload });
    res.guildCount = Array.isArray(data) ? data.length : payload.length;
    logger?.log('DEPLOY:GUILD_OK', `Successfully registered ${res.guildCount} guild commands`);
  }

  return res;
}

// Bot Gateway Events
client.once(Events.ClientReady, async () => {
  console.log(`[BOOT] Logged in as ${client.user.tag}! ${pick('online')}`);
  console.log(`[BOOT] Loomie's ID: ${OWNER_ID} | Website: ${SITE_URL}`);

  try {
    await deployCommands({ scope: 'global' });
    console.log(`[BOOT] Commands deployed globally!`);
  } catch (err) {
    console.error(`[BOOT] Failed to deploy global commands:`, err);
  }
});

// Text command listener (!update / !sync)
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const isOwner = message.author.id === OWNER_ID;
  const isMentioned = client.user && message.mentions.has(client.user.id);
  const content = (message.content || '').trim().toLowerCase();

  const isUpdateTrigger =
    content.startsWith('!update') ||
    content.startsWith('!sync') ||
    (isMentioned && content.includes('update'));

  if (!isUpdateTrigger) return;

  if (!isOwner) {
    return message.reply(`Awr~ Only Loomie (<@${OWNER_ID}>) can use the update command! >_<`);
  }

  const statusMsg = await message.reply(`*paws at the keyboard...* 🔄 Synchronizing all slash commands for this server and globally, please wait! :3`);

  const deployRes = await deployCommands({
    guildId: message.guildId,
    scope: 'both'
  });

  let e621Status = 'Testing...';
  try {
    const e621Check = await fetchE621Post('deer', 'newest', 'nsfw');
    e621Status = e621Check ? `✅ Working (Post #${e621Check.id})` : '⚠️ No media returned';
  } catch (e) {
    e621Status = `❌ Error: ${e.message}`;
  }

  const fields = [
    { name: 'Server Commands', value: message.guildId ? `\`${deployRes.guildCount}\` (Instant Sync!)` : 'N/A (DM)', inline: true },
    { name: 'Global Commands', value: `\`${deployRes.globalCount}\` deployed`, inline: true },
    { name: 'Gateway Ping', value: `\`${client.ws.ping}ms\``, inline: true },
    { name: 'e621.net Check', value: e621Status, inline: true },
    { name: 'Website', value: `[emolarp.fans](${SITE_URL})`, inline: true }
  ];

  await statusMsg.edit({
    content: null,
    embeds: [{
      title: `⚡ Commands Synchronized! ${pick('online')}`,
      description: `All slash commands have been registered with Discord! Server commands update instantly. If commands are still missing in your client, press **Ctrl+R** to reload Discord. :3`,
      color: PASTEL_MINT,
      fields,
      footer: { text: `Triggered by Loomie (${OWNER_ID})` }
    }]
  });
});

// Interactive Button Clicks & Slash Commands
client.on(Events.InteractionCreate, async (interaction) => {
  // Handle Action Buttons (Roll Again & Interactive Actions)
  if (interaction.isButton()) {
    try {
      const parts = interaction.customId.split(':');
      const prefix = parts[0];

      if (prefix === 'e621') {
        await interaction.deferUpdate();

        let rating = 'nsfw';
        let order = 'newest';
        let rawTags = '';

        if (['nsfw', 'safe', 'explicit', 'all'].includes(parts[1])) {
          rating = parts[1];
          order = parts[2] || 'newest';
          rawTags = parts.slice(3).join(':');
        } else {
          order = parts[1] || 'newest';
          rawTags = parts.slice(2).join(':');
        }

        const post = await fetchE621Post(rawTags, order, rating);
        if (!post) {
          return interaction.followUp({
            content: `Awr~ I couldn't find another ${rating === 'safe' ? 'safe' : 'NSFW'} post for \`${rawTags || 'your search'}\`! Try simpler tags like \`deer\`, \`dragon\`, or \`fox\`, >_<`,
            ephemeral: true
          });
        }

        const payload = buildE621Response(post, rawTags, order, rating);
        return interaction.editReply(payload);
      }

      if (prefix === 'act') {
        const action = parts[1];
        const targetUserId = parts[2];
        const count = recordAffection(interaction.user.id, targetUserId);

        const actionData = buildActionCopy(action, interaction.user.id, targetUserId);
        if (!actionData) return;

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`act:${action}:${interaction.user.id}`)
            .setLabel(actionData.backLabel)
            .setStyle(ButtonStyle.Primary)
        );

        return interaction.reply({
          embeds: [{
            title: actionData.title,
            description:
              `${actionData.text}\n\n` +
              `💖 **Total Affection Count:** \`${count}\` times between you two! (Overall delivered: \`${totalAffectionDelivered}\`)\n` +
              `• [emolarp.fans](${SITE_URL}) :3`,
            color: PASTEL_PINK,
            footer: { text: `emolarp.fans • paws & affection certified :3` }
          }],
          components: [row]
        });
      }
    } catch (err) {
      console.error('Button error:', err);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const logger = new VerboseLogger(interaction.commandName === 'log');

  try {
    const deferredCommands = ['e621', 'log', 'species', ...ALL_ACTIONS.map(([n]) => n), 'avatar', 'banner', 'update'];
    const needsDefer = deferredCommands.includes(interaction.commandName);
    if (needsDefer) {
      await interaction.deferReply();
    }

    const directParams = {
      cutie: interaction.options.getUser('cutie') || interaction.options.getUser('cutie1') || null,
      cutie2: interaction.options.getUser('cutie2') || null,
      vibe: interaction.options.getString('vibe') || 'furry',
      tags: interaction.options.getString('tags') || '',
      rating: interaction.options.getString('rating') || 'nsfw',
      order: interaction.options.getString('order') || 'newest',
      species: interaction.options.getString('species') || 'neko',
      question: interaction.options.getString('question') || null,
      user_id: interaction.options.getString('user_id') || null,
      scope: interaction.options.getString('scope') || 'both'
    };

    const payload = await executeBotCommand(interaction.commandName, directParams, interaction, logger);
    if (needsDefer) {
      await interaction.editReply(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch (err) {
    console.error('Interaction handler error:', err);
    const errMsg = `Awr~ Something went wrong: \`${err?.message || String(err)}\` >_<`.slice(0, 1950);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: errMsg }).catch(() => {});
    } else {
      await interaction.reply({ content: errMsg, ephemeral: true }).catch(() => {});
    }
  }
});

// Tiny HTTP Keep-Alive Server for Render + UptimeRobot
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: `awake ${pick('online')}`,
    owner: `Loomie (${OWNER_ID}) :3`,
    website: SITE_URL,
    bot: client.user?.tag || 'booting...',
    totalAffectionDelivered,
    lastE621Query,
    uptimeSeconds: Math.floor(process.uptime())
  }));
}).listen(PORT, () => {
  console.log(`Health server listening on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
