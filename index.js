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

// In-memory affection counter, booru query tracker & artwork cache
const affectionCounts = new Map();
let totalAffectionDelivered = 0;
let lastE621Query = { tags: '', order: 'newest', rating: 'nsfw', ranAt: null };
const recentE621Posts = new Map();

// Default safety blacklist - excludes extreme/gross tags automatically
const DEFAULT_BLACKLIST = [
  'gore',
  'scat',
  'feces',
  'feral',
  'watersports',
  'urine',
  'vomit',
  'snuff',
  'death',
  'young',
  'cub',
  'loli',
  'shota',
  'torture'
];

// Curated popular tags for instant Discord autocomplete suggestions
const POPULAR_TAGS = [
  // Species & Types
  'dragon', 'scalie', 'wolf', 'fox', 'canine', 'feline', 'cat', 'dog',
  'deer', 'otter', 'tiger', 'leopard', 'cheetah', 'lion', 'bear',
  'hyena', 'sergal', 'protogen', 'raccoon', 'rabbit', 'bunny', 'bat',
  'shark', 'avian', 'bird', 'kobold', 'fennec', 'red_panda', 'coyote',
  'jackal', 'pokemon', 'digimon', 'anthro', 'taur',
  // Styles & Aesthetics
  'femboy', 'tomboy', 'maid', 'kemonomimi', 'furry', 'cute', 'fluffy',
  'muscular', 'chubby', 'thick_thighs', 'striped_thigh_highs', 'thigh_highs',
  'collar', 'choker', 'bell_collar', 'harness', 'leash', 'hoodie',
  // Interactions & Moods
  'cuddle', 'snuggle', 'hug', 'kiss', 'bed', 'cozy', 'paws', 'toe_beans',
  'tail', 'tail_wagging', 'blush', 'loving', 'happy', 'smile',
  'solo', 'duo', 'group', 'male', 'female', 'male/male', 'male/female',
  // Booru Modifiers & Sorts
  'order:score', 'order:favcount', 'order:rank', 'animated', 'video',
  'high_res', 'digital_media_(artwork)', 'hi_res', 'absurd_res'
];

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
    this.successes = [];
  }

  clearIssues() {
    if (!this.enabled) return;
    this.issues = [];
  }

  explainIssue(plainEnglish) {
    if (!this.enabled) return;
    this.issues.push(plainEnglish.replace(/```/g, "'''"));
  }

  explainSuccess(plainEnglish) {
    if (!this.enabled) return;
    this.successes.push(plainEnglish.replace(/```/g, "'''"));
  }

  log(stage, message, data = undefined) {
    if (!this.enabled) return;
    const elapsed = (performance.now() - this.startTime).toFixed(2);
    const iso = new Date().toISOString();
    let line = `[${iso}] [+${elapsed}ms] [${stage}] ${message}`;
    if (data !== undefined) {
      let serialized;
      try {
        serialized = typeof data === 'string' ? data : JSON.stringify(data);
      } catch {
        serialized = String(data);
      }
      line += ` | ${serialized}`;
    }
    this.entries.push(line);
  }

  format(maxChars = 1400) {
    let out = this.entries.join('\n');
    if (out.length <= maxChars) return out;
    const truncatedNotice = `\n... [${out.length - maxChars} chars omitted to fit Discord payload limit] ...\n`;
    const sliceLen = Math.floor((maxChars - truncatedNotice.length) / 2);
    return out.slice(0, sliceLen) + truncatedNotice + out.slice(-sliceLen);
  }

  buildPlainEnglishSummary(commandName, totalMs) {
    if (this.issues.length > 0) {
      const distinct = [...new Set(this.issues)];
      return `⚠️ **What Happened (Plain English):**\n• ${distinct.join('\n• ')}`;
    }
    const successDetails = this.successes.length > 0 ? ` (${this.successes.join('; ')})` : '';
    return `✅ **What Happened (Plain English):** Everything worked properly in **${totalMs}ms**! \`/${commandName}\` ran smoothly with zero errors${successDetails}.`;
  }
}

function recordAffectionVerbose(fromId, toId, logger = null) {
  const count = recordAffection(fromId, toId);
  logger?.log('AFFECTION', `Recorded affection from ${fromId} to ${toId}`, {
    comboCount: count,
    totalDelivered: totalAffectionDelivered
  });
  return count;
}

function pick(category, logger = null) {
  const list = KAOMOJI[category] || KAOMOJI.cute;
  const idx = Math.floor(Math.random() * list.length);
  const chosen = list[idx];
  return chosen;
}

const PASTEL_PINK = 0xff99cc;
const PASTEL_PURPLE = 0xc792ea;
const PASTEL_LAVENDER = 0xe0b0ff;

// Reliable GIF fetcher with 3-tier fallback (PurrBot Furry -> Nekos.best -> Waifu.pics SFW)
async function fetchActionGif(action, vibe = 'furry', logger = null) {
  const purrMap = {
    snuggle: 'cuddle',
    hug: 'hug',
    lick: 'lick',
    kiss: 'kiss',
    headpat: 'pat',
    earscratch: 'pat',
    boop: 'poke',
    bite: 'bite',
    pawhold: 'cuddle',
    milk: 'feed',
    bonk: 'slap',
    blush: 'blush',
    tailwag: 'tail',
    purr: 'neko',
    howl: 'okami'
  };

  const nekosMap = {
    snuggle: 'cuddle',
    hug: 'hug',
    lick: 'lick',
    kiss: 'kiss',
    headpat: 'pat',
    earscratch: 'pat',
    boop: 'poke',
    bite: 'bite',
    pawhold: 'handhold',
    milk: 'feed',
    bonk: 'bonk',
    blush: 'blush',
    tailwag: 'happy',
    purr: 'neko',
    howl: 'kitsune'
  };

  const waifuMap = {
    snuggle: 'cuddle',
    hug: 'hug',
    lick: 'lick',
    kiss: 'kiss',
    headpat: 'pat',
    earscratch: 'pat',
    boop: 'poke',
    bite: 'bite',
    pawhold: 'handhold',
    milk: 'nom',
    bonk: 'bonk',
    blush: 'blush',
    tailwag: 'happy',
    purr: 'neko',
    howl: 'awoo'
  };

  if (vibe === 'furry' && purrMap[action]) {
    const purrUrl = makeUrl('api.purrbot.site', `/v2/img/sfw/${purrMap[action]}/gif`);
    try {
      const purrRes = await fetch(purrUrl, { signal: AbortSignal.timeout(5000) });
      if (purrRes.ok) {
        const purrData = await purrRes.json();
        if (purrData?.link && !purrData.error) {
          return { url: purrData.link, source: 'PurrBot Furry' };
        }
      }
    } catch (err) {
      logger?.log('HTTP:ERR', `PurrBot failed`, { error: err?.message || String(err) });
    }
  }

  try {
    const endpoint = nekosMap[action] || 'cuddle';
    const nekosUrl = makeUrl('nekos.best', `/api/v2/${endpoint}`);
    const res = await fetch(nekosUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      const item = data?.results?.[0];
      if (item?.url) {
        return {
          url: item.url,
          source: item.anime_name ? `Nekos.best • ${item.anime_name}` : 'Nekos.best SFW'
        };
      }
    }
  } catch (err) {
    logger?.log('HTTP:ERR', `Nekos.best failed`, { error: err?.message || String(err) });
  }

  try {
    const wEndpoint = waifuMap[action] || 'hug';
    const waifuUrl = makeUrl('api.waifu.pics', `/sfw/${wEndpoint}`);
    const wRes = await fetch(waifuUrl, { signal: AbortSignal.timeout(5000) });
    if (wRes.ok) {
      const wData = await wRes.json();
      if (wData?.url) {
        return { url: wData.url, source: 'Waifu.pics SFW' };
      }
    }
  } catch (err) {
    logger?.log('HTTP:ERR', `Waifu.pics failed`, { error: err?.message || String(err) });
  }

  return null;
}

// Fetch random SFW species image/GIF from PurrBot with Nekos.best fallback
async function fetchFurrySpecies(species = 'neko', logger = null) {
  try {
    const gifUrl = makeUrl('api.purrbot.site', `/v2/img/sfw/${species}/gif`);
    const res = await fetch(gifUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      if (data?.link && !data.error) return data.link;
    }

    const imgUrl = makeUrl('api.purrbot.site', `/v2/img/sfw/${species}/img`);
    const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(5000) });
    if (imgRes.ok) {
      const imgData = await imgRes.json();
      if (imgData?.link && !imgData.error) return imgData.link;
    }
  } catch (err) {
    logger?.log('HTTP:ERR', `PurrBot error`, { error: err?.message || String(err) });
  }

  try {
    const fallbackEndpoint = ['kitsune', 'okami', 'holo'].includes(species) ? 'kitsune' : 'neko';
    const nbUrl = makeUrl('nekos.best', `/api/v2/${fallbackEndpoint}`);
    const nbRes = await fetch(nbUrl, { signal: AbortSignal.timeout(5000) });
    if (nbRes.ok) {
      const nbData = await nbRes.json();
      const url = nbData?.results?.[0]?.url || null;
      if (url) return url;
    }
  } catch (err) {
    logger?.log('HTTP:ERR', `Nekos.best failed`, { error: err?.message || String(err) });
  }

  return null;
}

// PURE, DIRECT e621.net MEDIA FETCHER
async function fetchE621Post(rawTags = '', order = 'newest', rating = 'nsfw', excludeId = null, logger = null) {
  // Extract all tags, keeping explicit ratings completely untouched
  const cleanedUserTags = rawTags
    .split(/[\s,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t && !t.startsWith('order:') && t !== 'random');

  const queryTags = [...cleanedUserTags];

  // Append safety blacklist (filter extreme tags unless explicitly requested by user)
  for (const badTag of DEFAULT_BLACKLIST) {
    const alreadyPresent = cleanedUserTags.some(
      (t) => t === badTag || t === `-${badTag}` || t.startsWith(`${badTag}:`)
    );
    if (!alreadyPresent) {
      queryTags.push(`-${badTag}`);
    }
  }

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
    const md5 = post.files?.meta?.md5 || post.file?.md5;
    const ext = (post.files?.meta?.ext || post.file?.ext || '').toLowerCase();
    if (!md5 || !ext) return null;

    const sampleJpg = post.files?.sample?.jpg || post.sample?.url || null;
    const originalUrl = post.files?.original?.url || post.file?.url || null;

    const cdnBase = 'https://static1.e621.net/data';
    const sampleCdn = `${cdnBase}/sample/${md5.slice(0, 2)}/${md5.slice(2, 4)}/${md5}.jpg`;
    const directCdn = `${cdnBase}/${md5.slice(0, 2)}/${md5.slice(2, 4)}/${md5}.${ext}`;

    const isVideo = ['webm', 'mp4'].includes(ext);
    const displayUrl = sampleJpg || sampleCdn || directCdn;
    const videoUrl = isVideo ? (originalUrl || directCdn) : null;

    return {
      post,
      displayUrl,
      videoUrl,
      isVideo,
      ext
    };
  }

  const encodedTags = encodeURIComponent(queryTags.join(' '));

  // Sequence: random endpoint first, then standard search pool
  const candidateUrls = [
    `https://e621.net/posts/random.json?tags=${encodedTags}`,
    `https://e621.net/posts.json?limit=75&tags=${encodedTags}`
  ];

  for (let attempt = 0; attempt < candidateUrls.length; attempt++) {
    const targetUrl = candidateUrls[attempt];
    logger?.log('HTTP:REQ', `e621.net GET ${targetUrl}`);

    const reqHeaders = { ...baseHeaders };
    if (authHeader) reqHeaders['Authorization'] = authHeader;

    const reqStart = performance.now();
    let res;

    try {
      res = await fetch(targetUrl, {
        headers: reqHeaders,
        signal: AbortSignal.timeout(9000)
      });
    } catch (netErr) {
      logger?.log('HTTP:ERR', `Attempt ${attempt + 1} timed out or failed: ${netErr.message}`);
      continue;
    }

    const latencyMs = (performance.now() - reqStart).toFixed(2);

    // If e621 returns Cloudflare anti-bot challenge (403), retry without auth
    if (res.status === 403 && authHeader) {
      logger?.log('HTTP:AUTH_RETRY', 'e621 returned 403 with Auth header, retrying anonymously');
      delete reqHeaders['Authorization'];
      try {
        res = await fetch(targetUrl, {
          headers: reqHeaders,
          signal: AbortSignal.timeout(9000)
        });
      } catch {}
    }

    if (res && (res.ok || res.status === 200)) {
      try {
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

        // Pick a random post from matching pool (exclude previous post ID so reroll gives a fresh post!)
        let candidates = validPosts;
        if (excludeId && validPosts.length > 1) {
          const filtered = validPosts.filter((p) => String(p.post.id) !== String(excludeId));
          if (filtered.length > 0) candidates = filtered;
        }
        const picked = candidates[Math.floor(Math.random() * candidates.length)];
        const chosen = picked.post;

        let artists = [];
        let species = [];

        if (Array.isArray(chosen.tags)) {
          species = chosen.tags.filter((t) => ['dragon', 'canine', 'feline', 'wolf', 'fox', 'scalie', 'lizard', 'otter', 'cat', 'dog', 'neko', 'equine', 'sergal', 'protogen'].includes(t)).slice(0, 4);
          if (!species.length) species = chosen.tags.slice(0, 3);
        } else if (chosen.tags && typeof chosen.tags === 'object') {
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

// Helper to fetch a single post by ID (for Bookmark to DMs retrieval)
async function fetchE621PostById(postId) {
  try {
    const url = makeUrl('e621.net', `/posts/${postId}.json`);
    const headers = {
      'User-Agent': 'FurryDiscordBot/6.6 (by Loomie on e621; emolarp.fans)',
      'Accept': 'application/json'
    };
    if (process.env.E621_USERNAME && process.env.E621_API_KEY) {
      const token = Buffer.from(`${process.env.E621_USERNAME.trim()}:${process.env.E621_API_KEY.trim()}`).toString('base64');
      headers['Authorization'] = `Basic ${token}`;
    }
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = await res.json();
    const rawPost = data?.post || data;
    if (!rawPost) return null;

    const md5 = rawPost.files?.meta?.md5 || rawPost.file?.md5;
    const ext = rawPost.files?.meta?.ext || rawPost.file?.ext || 'jpg';
    if (!md5) return null;
    const sampleJpg = rawPost.files?.sample?.jpg || rawPost.sample?.url || null;
    const originalUrl = rawPost.files?.original?.url || rawPost.file?.url || null;
    const cdnBase = 'https://static1.e621.net/data';
    const sampleCdn = `${cdnBase}/sample/${md5.slice(0, 2)}/${md5.slice(2, 4)}/${md5}.jpg`;
    const directCdn = `${cdnBase}/${md5.slice(0, 2)}/${md5.slice(2, 4)}/${md5}.${ext}`;
    const isVideo = ['webm', 'mp4'].includes(ext.toLowerCase());
    const displayUrl = sampleJpg || sampleCdn || directCdn;

    let artists = [];
    let species = [];
    if (Array.isArray(rawPost.tags)) {
      species = rawPost.tags.filter((t) => ['dragon', 'canine', 'feline', 'wolf', 'fox', 'scalie', 'lizard', 'otter', 'cat', 'dog', 'neko', 'equine', 'sergal', 'protogen'].includes(t)).slice(0, 4);
      if (!species.length) species = rawPost.tags.slice(0, 3);
    } else if (rawPost.tags && typeof rawPost.tags === 'object') {
      artists = (rawPost.tags.artist || []).filter((a) => a !== 'conditional_dnp').slice(0, 3);
      species = (rawPost.tags.species || []).slice(0, 4);
    }

    const artistStr = artists.length ? artists.join(', ') : (rawPost.uploader_name || rawPost.tag_string_artist || 'Artist unknown');
    const speciesStr = species.length ? species.join(', ') : (rawPost.tag_string_species || 'Furry');
    const scoreVal = typeof rawPost.stats?.score?.total === 'number' ? rawPost.stats.score.total : (rawPost.score?.total ?? rawPost.score ?? 0);

    return {
      id: rawPost.id,
      imageUrl: displayUrl,
      videoUrl: isVideo ? (originalUrl || directCdn) : null,
      isVideo,
      postUrl: makeUrl('e621.net', `/posts/${rawPost.id}`),
      score: scoreVal,
      artists: artistStr,
      species: speciesStr,
      searchedTags: `post #${rawPost.id}`,
      rating: rawPost.rating || 'e',
      ext
    };
  } catch {
    return null;
  }
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
      backLabel: 'Kiss Back uwu'
    },
    headpat: {
      title: `Cozy Headpat Delivery~!! ${pick('headpat', logger)}`,
      text: `*adjusts striped thigh-highs and reaches up on tiptoes*\n\n<@${fromId}> gives <@${toId}> the softest, warmest headpats and gentle paw-boops!! ${pick('headpat', logger)}`,
      backLabel: 'Headpat Back :3'
    },
    earscratch: {
      title: `Fluffy Ear Scratches~!! ${pick('headpat', logger)}`,
      text: `*gently scritches right behind the ears until the tail thumps happily*\n\n<@${fromId}> gives <@${toId}> the coziest ear scratches ever!! ${pick('headpat', logger)}`,
      backLabel: 'Scratch Back ^w^'
    },
    boop: {
      title: `Soft Paw Snoot-Boop~!! ${pick('playful', logger)}`,
      text: `*reaches out a soft paw pad and gently pokes*\n\n*boop!!* <@${fromId}> boops <@${toId}> right on the nose!! ${pick('playful', logger)}`,
      backLabel: 'Boop Back >w<'
    },
    bite: {
      title: `Playful Love-Nibble~ nom! ${pick('playful', logger)}`,
      text: `*ears flatten playfully and leans in close*\n\n*nom~!* <@${fromId}> gives <@${toId}> a gentle, playful little catboy nibble!! ${pick('playful', logger)}`,
      backLabel: 'Nibble Back :3'
    },
    pawhold: {
      title: `Gentle Paw-Holding~ ${pick('affection', logger)}`,
      text: `*blushes softly and slips soft paw pads into yours*\n\n<@${fromId}> gently holds <@${toId}>'s soft paws and gives them a warm, reassuring squeeze!! ${pick('affection', logger)}`,
      backLabel: 'Hold Paws Back uwu'
    },
    milk: {
      title: `Fresh Cozy Milk Delivery~ uwu ${pick('cute', logger)}`,
      text: `*paws at the air and slides a frosty glass across the table*\n\n<@${fromId}> shares a sweet glass of milk with <@${toId}> for +100% cozy pastel energy!! ${pick('cute', logger)}`,
      backLabel: 'Share Back :3'
    },
    bonk: {
      title: `Playful Paw Bonk~!! >_<`,
      text: `*bonk!!* <@${fromId}> gives <@${toId}> a soft, playful paw-bonk on the head!! ${pick('playful', logger)}`,
      backLabel: 'Bonk Back >w<'
    }
  };
  return copyMap[action];
}

function buildAssetButtons(avatarUrl, bannerUrl, decoUrl, profileUserId = null) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('View PFP :3')
      .setStyle(ButtonStyle.Link)
      .setURL(avatarUrl)
  );
  if (bannerUrl) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel('View Banner ^w^')
        .setStyle(ButtonStyle.Link)
        .setURL(bannerUrl)
    );
  }
  if (decoUrl) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel('Avatar Deco ✨')
        .setStyle(ButtonStyle.Link)
        .setURL(decoUrl)
    );
  }
  if (profileUserId) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel('Open Profile 👤')
        .setStyle(ButtonStyle.Link)
        .setURL(makeUrl('discord.com', `/users/${profileUserId}`))
    );
  }
  return row;
}

function addVibeOption(opt) {
  return opt
    .setName('vibe')
    .setDescription('Choose aesthetic vibe: fluffy furry or cute anime :3')
    .setRequired(false)
    .addChoices(
      { name: 'Furry / Kemono :3', value: 'furry' },
      { name: 'Anime / Waifu ^w^', value: 'anime' }
    );
}

function buildCommandJson(builder, forEverywhere = true) {
  if (!forEverywhere) return builder.toJSON();
  return builder
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel
    )
    .toJSON();
}

function getCommandDefinitions(forEverywhere = true) {
  const rawBuilders = [
    new SlashCommandBuilder()
      .setName('e621')
      .setDescription('Pull furry art & GIFs directly from e621.net! :3')
      .addStringOption((opt) =>
        opt
          .setName('tags')
          .setDescription('Space-separated booru tags (e.g. "dragon", "fox cuddle") :3')
          .setAutocomplete(true)
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
      ),

    new SlashCommandBuilder()
      .setName('yiff')
      .setDescription('Instant explicit furry booru search! (Locked to explicit NSFW) 🔥')
      .addStringOption((opt) =>
        opt
          .setName('tags')
          .setDescription('Space-separated booru tags (e.g. "dragon", "fox cuddle") :3')
          .setAutocomplete(true)
          .setRequired(false)
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
      ),

    new SlashCommandBuilder()
      .setName('oc')
      .setDescription('Meet Loomie’s deer OC & check out Loomie’s profile and website! :3'),

    new SlashCommandBuilder()
      .setName('furrypic')
      .setDescription('Get a cute SFW furry / kemonomimi GIF or art card! :3')
      .addStringOption((opt) =>
        opt
          .setName('species')
          .setDescription('Pick your favorite fluffy vibe! ^w^')
          .setRequired(false)
          .addChoices(
            { name: 'Neko / Catboy :3', value: 'neko' },
            { name: 'Kitsune / Fox ^w^', value: 'kitsune' },
            { name: 'Okami / Wolf uwu', value: 'okami' },
            { name: 'Eevee >w<', value: 'eevee' },
            { name: 'Holo (Wolf) :3', value: 'holo' }
          )
      ),

    new SlashCommandBuilder()
      .setName('snuggle')
      .setDescription('Wrap a cutie in cozy snuggles uwu!')
      .addUserOption((opt) => opt.setName('cutie').setDescription('Who are we snuggling? :3').setRequired(true))
      .addStringOption(addVibeOption),

    new SlashCommandBuilder()
      .setName('hug')
      .setDescription('Give a cutie a big, warm, fluffy hug~ ^w^')
      .addUserOption((opt) => opt.setName('cutie').setDescription('Who needs a warm hug? :3').setRequired(true))
      .addStringOption(addVibeOption),

    new SlashCommandBuilder()
      .setName('lick')
      .setDescription('Give a cutie a playful lick~ nya!')
      .addUserOption((opt) => opt.setName('cutie').setDescription('Who gets a playful lick? >w<').setRequired(true))
      .addStringOption(addVibeOption),

    new SlashCommandBuilder()
      .setName('kiss')
      .setDescription('Give a cutie a sweet kiss~ ^w^')
      .addUserOption((opt) => opt.setName('cutie').setDescription('Who gets a sweet kiss? :3').setRequired(true))
      .addStringOption(addVibeOption),

    new SlashCommandBuilder()
      .setName('headpat')
      .setDescription('Give a cutie cozy headpats and paw boops uwu!')
      .addUserOption((opt) => opt.setName('cutie').setDescription('Who deserves headpats? :3').setRequired(true))
      .addStringOption(addVibeOption),

    new SlashCommandBuilder()
      .setName('earscratch')
      .setDescription('Scratch behind a cutie’s fluffy ears~ :3')
      .addUserOption((opt) => opt.setName('cutie').setDescription('Whose fluffy ears are we scratching? ^w^').setRequired(true))
      .addStringOption(addVibeOption),

    new SlashCommandBuilder()
      .setName('boop')
      .setDescription('Boop a cutie right on the snoot with a soft paw~ :3')
      .addUserOption((opt) => opt.setName('cutie').setDescription('Whose nose are we booping? >w<').setRequired(true))
      .addStringOption(addVibeOption),

    new SlashCommandBuilder()
      .setName('bite')
      .setDescription('Give a cutie a playful love-nibble~ nom!')
      .addUserOption((opt) => opt.setName('cutie').setDescription('Who gets a gentle nibble? :3').setRequired(true))
      .addStringOption(addVibeOption),

    new SlashCommandBuilder()
      .setName('pawhold')
      .setDescription('Hold a cutie’s soft paws gently~ uwu')
      .addUserOption((opt) => opt.setName('cutie').setDescription('Whose paws are we holding? :3').setRequired(true))
      .addStringOption(addVibeOption),

    new SlashCommandBuilder()
      .setName('milk')
      .setDescription('Share a frosty glass of milk with a cutie~ uwu')
      .addUserOption((opt) => opt.setName('cutie').setDescription('Who gets a glass of milk? :3').setRequired(true))
      .addStringOption(addVibeOption),

    new SlashCommandBuilder()
      .setName('bonk')
      .setDescription('Give a silly cutie a playful paw-bonk~ >_<')
      .addUserOption((opt) => opt.setName('cutie').setDescription('Who needs a soft bonk? >w<').setRequired(true))
      .addStringOption(addVibeOption),

    new SlashCommandBuilder()
      .setName('blush')
      .setDescription('Get all flustered and red-faced uwu~')
      .addUserOption((opt) => opt.setName('cutie').setDescription('Optional: who made you blush? >w<').setRequired(false))
      .addStringOption(addVibeOption),

    new SlashCommandBuilder()
      .setName('tailwag')
      .setDescription('Wag your tail happily like an excited puppy/catboy~ :3')
      .addUserOption((opt) => opt.setName('cutie').setDescription('Optional: who are you wagging your tail at? ^w^').setRequired(false))
      .addStringOption(addVibeOption),

    new SlashCommandBuilder()
      .setName('purr')
      .setDescription('Curl up and purr loudly like a cozy catboy~ prrrr :3')
      .addUserOption((opt) => opt.setName('cutie').setDescription('Optional: who are you purring for? uwu').setRequired(false)),

    new SlashCommandBuilder()
      .setName('howl')
      .setDescription('Let out a cute little wolf/deer awooo~ ^w^')
      .addUserOption((opt) => opt.setName('cutie').setDescription('Optional: who are you howling with? :3').setRequired(false)),

    new SlashCommandBuilder()
      .setName('cutemeter')
      .setDescription('Scan a cutie with the cuteness meter! ^w^')
      .addUserOption((opt) => opt.setName('cutie').setDescription('Who are we scanning? (defaults to you!)').setRequired(false)),

    new SlashCommandBuilder()
      .setName('ship')
      .setDescription('Check compatibility score between two cuties~ :3')
      .addUserOption((opt) => opt.setName('cutie1').setDescription('First cutie!').setRequired(true))
      .addUserOption((opt) => opt.setName('cutie2').setDescription('Second cutie!').setRequired(true)),

    new SlashCommandBuilder()
      .setName('8ball')
      .setDescription('Ask the pastel catboy crystal ball a yes/no question~ uwu')
      .addStringOption((opt) => opt.setName('question').setDescription('What do you want to ask? :3').setRequired(true)),

    new SlashCommandBuilder()
      .setName('lovecount')
      .setDescription('Check how much affection you have given a cutie~ :3')
      .addUserOption((opt) => opt.setName('cutie').setDescription('Check affection count for this cutie!').setRequired(true)),

    new SlashCommandBuilder()
      .setName('avatar')
      .setDescription('Show a cutie HD PFP, banner & avatar decoration + profile link! uwu')
      .addStringOption((opt) => opt.setName('user_id').setDescription('Discord User ID or @mention (defaults to you!)').setRequired(false)),

    new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Check furry uptime, ping & total affection delivered! :3'),

    new SlashCommandBuilder()
      .setName('update')
      .setDescription('Force re-register & sync slash commands to server/global! (Owner only) :3')
      .addStringOption((opt) =>
        opt
          .setName('scope')
          .setDescription('Choose where to sync: guild (instant!), global, or both! ^w^')
          .setRequired(false)
          .addChoices(
            { name: 'Current Server (Instant! 0s delay) :3', value: 'guild' },
            { name: 'Global (All Servers & DMs) ^w^', value: 'global' },
            { name: 'Both (Instant Server + Global) uwu', value: 'both' }
          )
      ),

    new SlashCommandBuilder()
      .setName('log')
      .setDescription('Run any command and get a fresh plain-English explanation + verbose logs! :3')
      .addStringOption((opt) =>
        opt
          .setName('command')
          .setDescription('Command to diagnose (e.g. "e621", "snuggle", "update") :3')
          .setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName('args')
          .setDescription('Optional space-separated args (e.g. "dragon order:score") ^w^')
          .setRequired(false)
      )
      .addUserOption((opt) => opt.setName('cutie').setDescription('Target user :3').setRequired(false))
      .addUserOption((opt) => opt.setName('cutie2').setDescription('Second target user for /ship ^w^').setRequired(false))
      .addStringOption((opt) => opt.setName('vibe').setDescription('vibe: furry or anime').setRequired(false))
      .addStringOption((opt) => opt.setName('tags').setDescription('tags for booru commands :3').setRequired(false))
      .addStringOption((opt) =>
        opt
          .setName('rating')
          .setDescription('rating for booru commands')
          .setRequired(false)
          .addChoices(
            { name: 'nsfw', value: 'nsfw' },
            { name: 'explicit', value: 'explicit' },
            { name: 'safe', value: 'safe' },
            { name: 'all', value: 'all' }
          )
      )
      .addStringOption((opt) =>
        opt
          .setName('order')
          .setDescription('order: newest or score')
          .setRequired(false)
          .addChoices(
            { name: 'newest', value: 'newest' },
            { name: 'score', value: 'score' }
          )
      )
      .addStringOption((opt) => opt.setName('species').setDescription('species for /furrypic').setRequired(false))
      .addStringOption((opt) => opt.setName('question').setDescription('question for /8ball').setRequired(false))
      .addStringOption((opt) => opt.setName('user_id').setDescription('user_id for /avatar').setRequired(false))
      .addStringOption((opt) =>
        opt
          .setName('scope')
          .setDescription('scope for /update')
          .setRequired(false)
          .addChoices(
            { name: 'guild', value: 'guild' },
            { name: 'global', value: 'global' },
            { name: 'both', value: 'both' }
          )
      )
  ];

  return rawBuilders.map((b) => buildCommandJson(b, forEverywhere));
}

async function deployCommands({ guildId = null, scope = 'both', logger = null } = {}) {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const clientId = client.user?.id || process.env.CLIENT_ID;

  if (!clientId) {
    const errorMsg = 'Cannot deploy commands: CLIENT_ID is missing and client is not logged in.';
    logger?.log('DEPLOY:ERR', errorMsg);
    throw new Error(errorMsg);
  }

  const results = { globalCount: null, guildCount: null, errors: [] };
  logger?.log('DEPLOY:START', `Starting command deployment`, { clientId, guildId, scope });

  if (scope === 'global' || scope === 'both') {
    try {
      const globalBody = getCommandDefinitions(true);
      const res = await rest.put(Routes.applicationCommands(clientId), { body: globalBody });
      results.globalCount = Array.isArray(res) ? res.length : globalBody.length;
      logger?.log('DEPLOY:GLOBAL_OK', `Successfully registered ${results.globalCount} global commands`);
    } catch (err) {
      results.errors.push(`Global deploy failed: ${err.message}`);
      logger?.log('DEPLOY:GLOBAL_FAIL', `Global deploy error: ${err.message}`);
    }
  }

  if ((scope === 'guild' || scope === 'both') && guildId) {
    try {
      const guildBody = getCommandDefinitions(false);
      const res = await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: guildBody });
      results.guildCount = Array.isArray(res) ? res.length : guildBody.length;
      logger?.log('DEPLOY:GUILD_OK', `Successfully registered ${results.guildCount} commands for guild ${guildId}`);
    } catch (err) {
      results.errors.push(`Guild deploy failed: ${err.message}`);
      logger?.log('DEPLOY:GUILD_FAIL', `Guild deploy error: ${err.message}`);
    }
  }

  return results;
}

client.once(Events.ClientReady, async () => {
  console.log(`Loomie's Furry Bot is online as ${client.user.tag}! :3`);
  client.user.setActivity('paws, snuggles & emolarp.fans :3', { type: 3 });

  try {
    const res = await deployCommands({ scope: 'global' });
    console.log(`Registered ${res.globalCount ?? 'all'} global slash commands successfully! :3`);
  } catch (err) {
    console.error('Initial command deployment failed:', err);
  }
});

const TARGET_ACTIONS = ['snuggle', 'hug', 'lick', 'kiss', 'headpat', 'earscratch', 'boop', 'bite', 'pawhold', 'milk', 'bonk'];
const SOLO_ACTIONS = ['blush', 'tailwag', 'purr', 'howl'];
const ALL_COMMANDS = [
  'e621',
  'yiff',
  'oc',
  'furrypic',
  ...TARGET_ACTIONS,
  ...SOLO_ACTIONS,
  'cutemeter',
  'ship',
  '8ball',
  'lovecount',
  'avatar',
  'stats',
  'update',
  'log'
];

// Helper to build an e621 embed + Roll Again / View Post buttons
function buildE621Response(post, rawTags = '', order = 'newest', rating = 'nsfw', logger = null) {
  // Store post in memory cache for instant DM bookmark retrieval
  recentE621Posts.set(String(post.id), post);
  if (recentE621Posts.size > 200) {
    const firstKey = recentE621Posts.keys().next().value;
    recentE621Posts.delete(firstKey);
  }

  // Include post.id in customId so reroll guarantees picking a different post
  const safeCustomId = `e621:${rating}:${order}:${post.id}:${rawTags.slice(0, 50)}`;
  const bookmarkCustomId = `save:${post.id}`;
  const buttons = [
    new ButtonBuilder()
      .setCustomId(safeCustomId)
      .setLabel('Roll Again :3')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(bookmarkCustomId)
      .setLabel('Bookmark 🐾')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setLabel('Open Image 🖼️')
      .setStyle(ButtonStyle.Link)
      .setURL(post.imageUrl),
    new ButtonBuilder()
      .setLabel('View on e621.net ^w^')
      .setStyle(ButtonStyle.Link)
      .setURL(post.postUrl)
  ];

  if (post.videoUrl) {
    buttons.push(
      new ButtonBuilder()
        .setLabel('Watch Video 🎥')
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
  desc += `• 💡 *If the image doesn't load right away, tap **"Roll Again :3"** or click **"Open Image 🖼️"**! :3*\n`;
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
      title: `${rating === 'explicit' || rating === 'nsfw' ? 'e621 Adult Booru Pull~' : 'e621 Booru Pull~'} ${pick('cute', logger)}`,
      description: desc,
      color: PASTEL_PINK,
      image: { url: post.imageUrl },
      footer: { text: `e621.net • Post #${post.id} • Rating: ${ratingLabel} • paws certified :3` }
    }],
    components: [row]
  };
}

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

  const extractedUserIds = [];
  const mentionRegex = /<@!?(\d{15,21})>|\b(\d{17,20})\b/g;
  let m;
  while ((m = mentionRegex.exec(remainder)) !== null) {
    extractedUserIds.push(m[1] || m[2]);
  }
  const remainderWithoutMentions = remainder.replace(mentionRegex, '').replace(/\s+/g, ' ').trim();

  async function resolveUserById(rawId) {
    const cleanId = rawId.replace(/[<@!>]/g, '').trim();
    if (!cleanId) return null;
    try {
      const u = await client.users.fetch(cleanId);
      return u;
    } catch {
      return null;
    }
  }

  let cutie = explicitOptions.cutie;
  if (!cutie && inlineKv.cutie) cutie = await resolveUserById(inlineKv.cutie);
  if (!cutie && extractedUserIds[0]) cutie = await resolveUserById(extractedUserIds[0]);

  let cutie2 = explicitOptions.cutie2;
  if (!cutie2 && inlineKv.cutie2) cutie2 = await resolveUserById(inlineKv.cutie2);
  if (!cutie2 && extractedUserIds[1]) cutie2 = await resolveUserById(extractedUserIds[1]);

  let vibe = explicitOptions.vibe || inlineKv.vibe || null;
  let species = explicitOptions.species || inlineKv.species || null;
  let order = explicitOptions.order || inlineKv.order || null;
  let tags = explicitOptions.tags ?? inlineKv.tags ?? null;
  let question = explicitOptions.question ?? inlineKv.question ?? null;
  let user_id = explicitOptions.user_id || inlineKv.user_id || extractedUserIds[0] || null;
  let scope = explicitOptions.scope || inlineKv.scope || null;

  const remTokens = remainderWithoutMentions ? remainderWithoutMentions.split(/\s+/) : [];

  if (targetCommand === 'e621' || targetCommand === 'yiff') {
    if (targetCommand === 'yiff') explicitOptions.rating = 'explicit';
    const validOrders = ['score', 'newest'];
    const filteredTagTokens = [];
    for (const tok of remTokens) {
      if (!order && validOrders.includes(tok.toLowerCase())) {
        order = tok.toLowerCase();
      } else if (tok.toLowerCase() !== 'random') {
        filteredTagTokens.push(tok);
      }
    }
    if (tags === null) {
      tags = filteredTagTokens.join(' ');
    }
    if (!tags && lastE621Query.tags) {
      tags = lastE621Query.tags;
      if (!order) order = lastE621Query.order;
    }
  } else if (targetCommand === 'furrypic') {
    if (!species && remTokens.length > 0) {
      species = remTokens[0].toLowerCase();
    }
  } else if (TARGET_ACTIONS.includes(targetCommand) || SOLO_ACTIONS.includes(targetCommand)) {
    const validVibes = ['furry', 'anime'];
    for (const tok of remTokens) {
      if (!vibe && validVibes.includes(tok.toLowerCase())) {
        vibe = tok.toLowerCase();
      }
    }
  } else if (targetCommand === '8ball') {
    if (question === null && remainderWithoutMentions) {
      question = remainderWithoutMentions;
    }
  } else if (targetCommand === 'update') {
    if (!scope && remTokens.length > 0) {
      const s = remTokens[0].toLowerCase();
      if (['guild', 'global', 'both'].includes(s)) scope = s;
    }
  }

  const resolvedParams = {
    cutie,
    cutie2,
    vibe: vibe || 'furry',
    tags: tags || '',
    rating: explicitOptions.rating || inlineKv.rating || 'nsfw',
    order: order || 'newest',
    species: species || 'neko',
    question,
    user_id,
    scope: scope || 'both'
  };

  return { targetCommand, params: resolvedParams };
}

// Unified command execution engine
async function executeBotCommand(commandName, params, interaction, logger = null) {
  logger?.log('EXEC:ENTER', `Entering handler for command "/${commandName}"`, {
    invokerId: interaction.user.id,
    invokerTag: interaction.user.tag
  });

  // /e621 & /yiff — Direct e621.net booru pulls (:3 & 🔥)
  if (commandName === 'e621' || commandName === 'yiff') {
    const isYiff = commandName === 'yiff';
    const rawTags = params.tags !== undefined && params.tags !== '' ? params.tags : lastE621Query.tags;
    const order = params.order || lastE621Query.order || 'newest';
    const rating = isYiff ? 'explicit' : (params.rating || lastE621Query.rating || 'nsfw');
    lastE621Query = { tags: rawTags, order, rating, ranAt: new Date().toISOString() };

    logger?.log('CMD:E621', `Executing /${commandName} with tags="${rawTags}" rating="${rating}" order="${order}" on e621.net`, { lastE621Query });
    const post = await fetchE621Post(rawTags, order, rating, null, logger);

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
      const e621Check = await fetchE621Post('deer', 'newest', logger);
      e621Status = e621Check ? `✅ Working (Post #${e621Check.id})` : '⚠️ No media returned';
    } catch (e) {
      e621Status = `❌ Error: ${e.message}`;
    }

    const fields = [
      { name: 'Global Commands', value: `\`${deployRes.globalCount ?? 'Unchanged'}\` deployed`, inline: true },
      { name: 'Server Commands', value: interaction.guildId ? `\`${deployRes.guildCount ?? 'Unchanged'}\` (Instant Sync!)` : 'N/A (DM)', inline: true },
      { name: 'Gateway Ping', value: `\`${client.ws.ping}ms\``, inline: true },
      { name: 'e621.net Check', value: e621Status, inline: true },
      { name: 'Total Commands', value: `\`${ALL_COMMANDS.length}\` registered`, inline: true }
    ];

    return {
      embeds: [{
        title: `Bot & Commands Synchronized~ ${pick('online', logger)}`,
        description:
          `*ears perk up and tail wags proudly!* Successfully updated and re-registered slash commands!\n\n` +
          `• **Instant Refresh:** In this server, commands updated **immediately**.\n` +
          `• **Client Cache:** If you don't see changes in Discord right away, press \`Ctrl + R\` on Desktop or restart mobile Discord to refresh cached slash commands :3\n` +
          `• [emolarp.fans](${SITE_URL}) ^w^`,
        color: PASTEL_PINK,
        fields,
        footer: { text: `furry bot v6.6 • update requested by Loomie :3` }
      }]
    };
  }

  // /furrypic
  if (commandName === 'furrypic') {
    const species = params.species || 'neko';
    const labelMap = {
      neko: 'Neko / Catboy',
      kitsune: 'Kitsune / Fox',
      okami: 'Okami / Wolf',
      eevee: 'Eevee',
      holo: 'Wolf Girl'
    };
    const mediaUrl = await fetchFurrySpecies(species, logger);

    return {
      embeds: [{
        title: `Random ${labelMap[species] || 'Furry'} Cutie~ ${pick('cute', logger)}`,
        description: `*ears perk up and tail wags happily!* Here is a fresh SFW **${labelMap[species] || species}** card for you, uwu~ ${pick('online', logger)} • [emolarp.fans](${SITE_URL})`,
        color: PASTEL_PINK,
        image: mediaUrl ? { url: mediaUrl } : undefined,
        footer: { text: 'PurrBot SFW • paws & thigh-highs certified :3' }
      }]
    };
  }

  // /oc
  if (commandName === 'oc') {
    const loomieUser = await client.users.fetch(OWNER_ID, { force: true }).catch(() => interaction.user);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("Loomie's Profile :3")
        .setStyle(ButtonStyle.Link)
        .setURL(makeUrl('discord.com', `/users/${OWNER_ID}`)),
      new ButtonBuilder()
        .setLabel('emolarp.fans ^w^')
        .setStyle(ButtonStyle.Link)
        .setURL(SITE_URL)
    );

    return {
      embeds: [{
        title: `Loomie's Deer OC Showcase~ ${pick('cute', logger)}`,
        description:
          `*ears perk up and tail wags happily!* Meet **Loomie** (<@${OWNER_ID}>)'s adorable deer kemonomimi/anthro OC! ${pick('online', logger)}\n\n` +
          `• **Species:** Cozy Deer Kemonomimi / Anthro\n` +
          `• **Signature Fit:** Oversized pastel hoodie, striped thigh-highs, chokers & fluffy animated tail~\n` +
          `• **Website:** [emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_PINK,
        thumbnail: { url: loomieUser.displayAvatarURL({ size: 256 }) },
        image: OC_IMAGE_URL ? { url: OC_IMAGE_URL } : undefined,
        footer: { text: `Made with love for Loomie • paws & thigh-highs certified ${pick('cute', logger)}` }
      }],
      components: [row]
    };
  }

  // Target Actions
  if (TARGET_ACTIONS.includes(commandName)) {
    const action = commandName;
    let cutie = params.cutie || interaction.user;
    const vibe = params.vibe || 'furry';

    const gif = await fetchActionGif(action, vibe, logger);
    const count = recordAffectionVerbose(interaction.user.id, cutie.id, logger);
    const chosen = buildActionCopy(action, interaction.user.id, cutie.id, logger);

    const backCustomId = `back:${action}:${interaction.user.id}:${cutie.id}:${vibe}`;
    const backBtn = new ButtonBuilder()
      .setCustomId(backCustomId)
      .setLabel(chosen.backLabel)
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(backBtn);

    return {
      embeds: [{
        title: chosen.title,
        description: `${chosen.text}\n\n*Combo with <@${cutie.id}>: **${count}** time${count === 1 ? '' : 's'}! ^w^* • [emolarp.fans](${SITE_URL})`,
        color: PASTEL_PINK,
        thumbnail: { url: cutie.displayAvatarURL({ size: 256 }) },
        image: gif?.url ? { url: gif.url } : undefined,
        footer: {
          text: gif?.source
            ? `${gif.source} • paws & thigh-highs certified :3`
            : 'paws & thigh-highs certified uwu :3'
        }
      }],
      components: [row]
    };
  }

  // Solo Actions
  if (SOLO_ACTIONS.includes(commandName)) {
    const action = commandName;
    const cutie = params.cutie || null;
    const vibe = params.vibe || 'furry';

    const gif = await fetchActionGif(action, vibe, logger);

    let title = '';
    let description = '';

    if (action === 'blush') {
      title = `Flustered & Blushing~!! ${pick('blush', logger)}`;
      description = cutie
        ? `*hides face inside oversized pastel hoodie sleeves*\n\n<@${cutie.id}> made <@${interaction.user.id}> blush super bright pink!! ${pick('blush', logger)} • [emolarp.fans](${SITE_URL})`
        : `*pulls hoodie sleeves over hands and looks away*\n\n<@${interaction.user.id}> is blushing so hard right now, uwu~!! ${pick('blush', logger)} • [emolarp.fans](${SITE_URL})`;
    } else if (action === 'tailwag') {
      title = `Happy Tail Wags~!! ${pick('online', logger)}`;
      description = cutie
        ? `*ears perk up straight and tail swishes back and forth at max speed*\n\n<@${interaction.user.id}> is wagging their tail super happily at <@${cutie.id}>!! ${pick('online', logger)} • [emolarp.fans](${SITE_URL})`
        : `*bounces on tiptoes in striped thigh-highs*\n\n<@${interaction.user.id}> can't stop wagging their tail happily!! ${pick('online', logger)} • [emolarp.fans](${SITE_URL})`;
    } else if (action === 'purr') {
      title = `Cozy Catboy Purrs~ prrrrr :3`;
      description = cutie
        ? `*curls up against <@${cutie.id}> in an oversized pastel hoodie and rumbles softly*\n\n<@${interaction.user.id}> purrs softly against <@${cutie.id}>!! ${pick('snuggle', logger)} • [emolarp.fans](${SITE_URL})`
        : `*kneads soft paws on a fluffy blanket*\n\n*prrrrrrrr~* <@${interaction.user.id}> is super cozy and purring loudly!! ${pick('snuggle', logger)} • [emolarp.fans](${SITE_URL})`;
    } else {
      title = `Cute Little Awooo~ ^w^`;
      description = cutie
        ? `*tilts head back and perks up fluffy ears*\n\n*awooooooo~!!* <@${interaction.user.id}> lets out a cute little howl with <@${cutie.id}>!! ${pick('online', logger)} • [emolarp.fans](${SITE_URL})`
        : `*ears perk up and tail wags*\n\n*awooooooo~!!* <@${interaction.user.id}> lets out the cutest little howl!! ${pick('online', logger)} • [emolarp.fans](${SITE_URL})`;
    }

    return {
      embeds: [{
        title,
        description,
        color: PASTEL_LAVENDER,
        thumbnail: { url: (cutie || interaction.user).displayAvatarURL({ size: 256 }) },
        image: gif?.url ? { url: gif.url } : undefined,
        footer: {
          text: gif?.source
            ? `${gif.source} • paws & thigh-highs certified :3`
            : 'paws & thigh-highs certified uwu :3'
        }
      }]
    };
  }

  // /cutemeter
  if (commandName === 'cutemeter') {
    const cutie = params.cutie || interaction.user;
    const isOwner = cutie.id === OWNER_ID;
    const remainder = Number(BigInt(cutie.id) % 31n);
    const score = isOwner ? 100 : remainder + 70;
    const bars = Math.round(score / 10);
    const meter = `[${'='.repeat(bars)}${'-'.repeat(10 - bars)}]`;

    let verdict = `Certified adorable! Deserves unlimited headpats ${pick('headpat', logger)}`;
    if (score >= 95) verdict = `MAXIMUM OVERLOAD!! Certified icon!! ${pick('online', logger)}`;
    else if (score >= 85) verdict = `Super fluffy & dangerously cute! Extra snuggles required ${pick('snuggle', logger)}`;

    return {
      embeds: [{
        title: `Official Cute Meter~ ${pick('cute', logger)}`,
        description: `*ears perk up and scanner beeps!*\n\n**Target:** <@${cutie.id}>\n**Cuteness Score:** **${score}%** \`${meter}\`\n**Verdict:** ${verdict}\n\n[emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_PINK,
        thumbnail: { url: cutie.displayAvatarURL({ size: 256 }) }
      }]
    };
  }

  // /ship
  if (commandName === 'ship') {
    let c1 = params.cutie || interaction.user;
    let c2 = params.cutie2 || client.user || interaction.user;

    const split1 = Math.ceil(c1.username.length / 2);
    const split2 = Math.floor(c2.username.length / 2);
    const shipName = `${c1.username.slice(0, split1)}${c2.username.slice(split2)}`;
    const combined = BigInt(c1.id) + BigInt(c2.id);
    const score = Number(combined % 41n) + 60;

    return {
      embeds: [{
        title: `Furry Love Compatibility Meter~ ${pick('affection', logger)}`,
        description:
          `*scans energy fields with a warm purr!*\n\n` +
          `💕 **Ship Name:** **${shipName}**\n` +
          `🐾 **Pairing:** <@${c1.id}> x <@${c2.id}>\n` +
          `💖 **Compatibility Score:** **${score}%**\n\n` +
          `*verdict:* Absolutely meant to snuggle forever and share sweet cuddles uwu~ • [emolarp.fans](${SITE_URL})`,
        color: PASTEL_PINK
      }]
    };
  }

  // /8ball
  if (commandName === '8ball') {
    const question = params.question || 'Will Loomie give me headpats?';
    const answers = [
      `Yes, absolutely! The fluffy prophecy has spoken nya~ ${pick('online', logger)}`,
      `Most definitely uwu! Stars and paws align! ${pick('cute', logger)}`,
      `Without a doubt! Cuddle-certified answer :3`,
      `Ask again after some warm snuggles >_< ${pick('snuggle', logger)}`,
      `My crystal paws are a little cloudy, ask again later! ^w^`,
      `Don't count on it silly cutie >_< ${pick('playful', logger)}`,
      `Very doubtful... but Loomie still loves you! ${pick('affection', logger)}`
    ];
    const pickedAnswer = answers[Math.floor(Math.random() * answers.length)];

    return {
      embeds: [{
        title: `Magic Furry 8-Ball~ 🔮 ${pick('cute', logger)}`,
        description: `**Question:** *"${question}"*\n\n**Answer:** ${pickedAnswer}\n\n[emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_PURPLE
      }]
    };
  }

  // /lovecount
  if (commandName === 'lovecount') {
    const cutie = params.cutie || interaction.user;
    const key = `${interaction.user.id}->${cutie.id}`;
    const count = affectionCounts.get(key) || 0;

    return {
      embeds: [{
        title: `Affection Counter~ ${pick('affection', logger)}`,
        description:
          `*checks fluffy memory logs!*\n\n` +
          `You have showered <@${cutie.id}> with love **${count}** time${count === 1 ? '' : 's'}!\n\n` +
          `*Total affection delivered bot-wide: **${totalAffectionDelivered}** times!* ${pick('online', logger)} • [emolarp.fans](${SITE_URL})`,
        color: PASTEL_PINK,
        thumbnail: { url: cutie.displayAvatarURL({ size: 256 }) }
      }]
    };
  }

  // /avatar
  if (commandName === 'avatar') {
    const rawTarget = (params.user_id || '').replace(/[<@!>]/g, '').trim();
    let targetUser = interaction.user;

    if (rawTarget) {
      targetUser = await client.users.fetch(rawTarget, { force: true }).catch(() => null);
      if (!targetUser) {
        return {
          content: `Awr~ I couldn't find any Discord cutie with ID or mention \`${rawTarget}\`! >_<`
        };
      }
    } else {
      targetUser = await client.users.fetch(interaction.user.id, { force: true }).catch(() => interaction.user);
    }

    const avatarUrl = targetUser.displayAvatarURL({ size: 1024, extension: 'png', forceStatic: false });
    const bannerUrl = targetUser.bannerURL({ size: 1024, extension: 'png', forceStatic: false }) || null;
    const decoData = targetUser.avatarDecorationData;
    const decoUrl = decoData?.asset
      ? `https://cdn.discordapp.com/avatar-decoration-presets/${decoData.asset}.png?size=512`
      : null;

    const row = buildAssetButtons(avatarUrl, bannerUrl, decoUrl, targetUser.id);

    return {
      embeds: [{
        title: `${targetUser.username}'s HD Avatar & Profile Showcase~ ${pick('cute', logger)}`,
        description:
          `*ears perk up and inspects profile in 4K!*\n\n` +
          `• **Username:** \`${targetUser.tag}\`\n` +
          `• **User ID:** \`${targetUser.id}\`\n` +
          `• **Banner:** ${bannerUrl ? '[Click to View Banner](' + bannerUrl + ')' : '*No banner set*'}\n` +
          `• **Avatar Deco:** ${decoUrl ? '[Click to View Decoration](' + decoUrl + ')' : '*None*'}\n\n` +
          `[emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_PINK,
        image: { url: avatarUrl },
        thumbnail: bannerUrl ? { url: bannerUrl } : undefined,
        footer: { text: 'Avatar HD Explorer • paws & thigh-highs certified :3' }
      }],
      components: [row]
    };
  }

  // /stats
  if (commandName === 'stats') {
    const uptimeSec = Math.floor(process.uptime());
    const h = Math.floor(uptimeSec / 3600);
    const m = Math.floor((uptimeSec % 3600) / 60);
    const s = uptimeSec % 60;
    const ping = client.ws.ping;

    return {
      embeds: [{
        title: `Furry Bot Vital Stats~ ${pick('online', logger)}`,
        description:
          `*ears twitch and runs system diagnostics!*\n\n` +
          `• **Gateway Ping:** \`${ping}ms\` (Super speedy!)\n` +
          `• **Uptime:** \`${h}h ${m}m ${s}s\`\n` +
          `• **Total Affection Delivered:** \`${totalAffectionDelivered}\` snuggles/kisses/headpats!\n` +
          `• **Last Booru Query:** \`${lastE621Query.tags || 'none yet'}\` (\`${lastE621Query.rating}\`)\n` +
          `• **Server Host:** Render (Linux Node.js v24)\n` +
          `• **Loomie's OC & Website:** [emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_PINK,
        footer: { text: `PurrBot v6.6 • paws & thigh-highs certified :3` }
      }]
    };
  }

  return {
    content: `Awr~ Unknown command \`/${commandName}\`! >_<`
  };
}

// Prefix / Message Command Fallback (!update or @bot update)
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const isOwner = message.author.id === OWNER_ID;
  const isMentioned = client.user && message.mentions.has(client.user.id);
  const content = (message.content || '').trim().toLowerCase();

  const isUpdateTrigger =
    content.startsWith('!update') ||
    content.startsWith('!sync') ||
    (isMentioned && content.includes('update'));

  if (isUpdateTrigger) {
    if (!isOwner) {
      return message.reply(`Awr~ Only Loomie (<@${OWNER_ID}>) can sync slash commands! >_< ${pick('blush')}`);
    }

    const statusMsg = await message.reply(`*ears perk up and tail wags!* Deploying slash commands right now... ${pick('online')}`);

    try {
      const deployRes = await deployCommands({
        guildId: message.guildId,
        scope: message.guildId ? 'both' : 'global'
      });

      return statusMsg.edit(
        `✅ **Synchronized!** Deployed \`${deployRes.guildCount ?? 0}\` commands to this server instantly and \`${deployRes.globalCount ?? 0}\` globally! Press \`Ctrl + R\` in Discord if commands don't show up immediately :3`
      );
    } catch (err) {
      return statusMsg.edit(`❌ **Deployment Error:** \`${err.message}\``);
    }
  }
});

// Handle Slash Commands, Interactive Buttons & Live Autocomplete
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Live tag autocomplete for /e621 tags: and /yiff tags:
    if (interaction.isAutocomplete()) {
      try {
        const focused = typeof interaction.options.getFocused === 'function'
          ? interaction.options.getFocused(true)
          : { name: 'tags', value: '' };

        if (focused.name === 'tags') {
          const rawVal = focused.value || '';
          const lastSpaceIdx = rawVal.lastIndexOf(' ');
          const prefix = lastSpaceIdx >= 0 ? rawVal.slice(0, lastSpaceIdx + 1) : '';
          const word = (lastSpaceIdx >= 0 ? rawVal.slice(lastSpaceIdx + 1) : rawVal).toLowerCase().trim();

          let matches = [];
          if (!word) {
            matches = POPULAR_TAGS.slice(0, 25);
          } else {
            const startsWith = POPULAR_TAGS.filter((t) => t.toLowerCase().startsWith(word));
            const contains = POPULAR_TAGS.filter((t) => !t.toLowerCase().startsWith(word) && t.toLowerCase().includes(word));
            matches = [...startsWith, ...contains].slice(0, 25);
          }

          const suggestions = matches.map((tag) => {
            const full = `${prefix}${tag}`.slice(0, 100);
            return { name: full, value: full };
          });

          await interaction.respond(suggestions).catch(() => {});
        }
      } catch (autoErr) {
        console.error('Autocomplete error:', autoErr);
      }
      return;
    }

    // Handle "Bookmark 🐾" button to DM artwork privately
    if (interaction.isButton() && interaction.customId.startsWith('save:')) {
      const postId = interaction.customId.split(':')[1];
      let post = recentE621Posts.get(postId);

      if (!post) {
        post = await fetchE621PostById(postId);
      }

      if (!post) {
        return interaction.reply({
          content: `Awr~ I couldn't retrieve the details for post #${postId}! Try viewing it directly on e621 >_< ${pick('blush')}`,
          ephemeral: true
        });
      }

      try {
        const dm = await interaction.user.createDM();
        await dm.send({
          embeds: [{
            title: `Saved Artwork (#${post.id}) ~ ${pick('cute')}`,
            description:
              `*ears perk up and delivers artwork straight to your DMs!*\n\n` +
              `• **Artist:** \`${post.artists}\`\n` +
              `• **Species / Tags:** \`${post.species}\`\n` +
              `• **Score:** \`${post.score}\` • **Rating:** \`${String(post.rating).toUpperCase()}\`\n` +
              `• **Post Link:** [View on e621.net](${post.postUrl})\n` +
              `• **Direct Image:** [Open Full Quality](${post.imageUrl})\n` +
              (post.videoUrl ? `• **Video File:** [Watch Video (${String(post.ext).toUpperCase()})](${post.videoUrl})\n` : '') +
              `\n*Saved from [emolarp.fans](${SITE_URL}) • paws certified :3*`,
            color: PASTEL_PINK,
            image: { url: post.imageUrl },
            footer: { text: `Saved to your DMs • e621.net • Loomie's Furry Bot :3` }
          }]
        });

        return interaction.reply({
          content: `Saved post **#${post.id}** to your DMs! ₍ᐢ. .ᐢ₎ Check your private messages~ :3`,
          ephemeral: true
        });
      } catch (dmErr) {
        return interaction.reply({
          content: `Awr~ I couldn't send the artwork to your DMs! Please make sure your DMs are open for this server >_< ${pick('blush')}`,
          ephemeral: true
        });
      }
    }

    // Handle "Roll Again" button for /e621
    if (interaction.isButton() && interaction.customId.startsWith('e621:')) {
      const parts = interaction.customId.split(':');
      let rating = 'nsfw';
      let order = 'newest';
      let excludeId = null;
      let rawTags = '';

      if (['nsfw', 'safe', 'explicit', 'all'].includes(parts[1])) {
        rating = parts[1];
        order = parts[2] || 'newest';
        if (/^\d+$/.test(parts[3])) {
          excludeId = parts[3];
          rawTags = parts.slice(4).join(':');
        } else {
          rawTags = parts.slice(3).join(':');
        }
      } else {
        order = parts[1] || 'newest';
        rawTags = parts.slice(2).join(':');
      }

      await interaction.deferUpdate();

      const post = await fetchE621Post(rawTags, order, rating, excludeId);
      if (!post) {
        return interaction.followUp({
          content: `Awr~ Couldn't find another post for \`${rawTags || 'your search'}\`! Try again in a moment :3`,
          ephemeral: true
        });
      }

      const freshResponse = buildE621Response(post, rawTags, order, rating);
      await interaction.editReply(freshResponse);
      return;
    }

    // Handle "Action Back" reciprocal button
    if (interaction.isButton() && interaction.customId.startsWith('back:')) {
      const [, action, senderId, receiverId, vibe] = interaction.customId.split(':');

      if (receiverId && interaction.user.id !== receiverId && interaction.user.id !== senderId) {
        return interaction.reply({
          content: `Awr~ That button is for <@${receiverId}> to hug/snuggle back, nya! ${pick('blush')}`,
          ephemeral: true
        });
      }

      await interaction.deferReply();

      const gif = await fetchActionGif(action, vibe || 'furry');
      const count = recordAffection(interaction.user.id, senderId);
      const chosen = buildActionCopy(action, interaction.user.id, senderId);
      const targetUser = await client.users.fetch(senderId).catch(() => null);

      await interaction.editReply({
        embeds: [{
          title: `${chosen.title} (Returned!)`,
          description: `${chosen.text}\n\n*Affection combo with <@${senderId}>: **${count}** time${count === 1 ? '' : 's'}! ^w^* • [emolarp.fans](${SITE_URL})`,
          color: PASTEL_PURPLE,
          thumbnail: targetUser ? { url: targetUser.displayAvatarURL({ size: 256 }) } : undefined,
          image: gif?.url ? { url: gif.url } : undefined,
          footer: {
            text: gif?.source
              ? `${gif.source} • paws & thigh-highs certified :3`
              : 'paws & thigh-highs certified uwu :3'
          }
        }]
      });
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    // /log
    if (interaction.commandName === 'log') {
      const deferStart = performance.now();
      await interaction.deferReply();

      const logger = new VerboseLogger(true);
      logger.reset();
      const memStart = process.memoryUsage();

      logger.log('INIT', `Initialized fresh verbose logger for /log`, {
        interactionId: interaction.id,
        user: `${interaction.user.tag} (${interaction.user.id})`,
        guildId: interaction.guildId || 'DM',
        deferMs: (performance.now() - deferStart).toFixed(2)
      });

      const { targetCommand, params } = await parseLogCommandInput(interaction, logger);
      const resultPayload = await executeBotCommand(targetCommand, params, interaction, logger);

      const memEnd = process.memoryUsage();
      const totalMs = (performance.now() - logger.startTime).toFixed(2);
      logger.log('COMPLETE', `Finished /${targetCommand} execution in ${totalMs}ms`, {
        totalDurationMs: Number(totalMs),
        totalLogEntries: logger.entries.length + 1,
        heapUsedMB: (memEnd.heapUsed / 1048576).toFixed(2)
      });

      const plainEnglishSummary = logger.buildPlainEnglishSummary(targetCommand, totalMs);
      const baseContent = resultPayload.content ? `${resultPayload.content}\n\n` : '';
      const header = `${plainEnglishSummary}\n\n**📋 Technical Trace (\`/${targetCommand}\` • \`${logger.entries.length} events\`)**`;
      const maxLogChars = Math.max(250, 1920 - baseContent.length - header.length - 16);
      const formattedLog = logger.format(maxLogChars);
      const contentWithLogs = `${baseContent}${header}\n\`\`\`log\n${formattedLog}\n\`\`\``.slice(0, 2000);

      const finalPayload = {
        ...resultPayload,
        content: contentWithLogs
      };
      delete finalPayload.ephemeral;

      if (finalPayload.embeds?.length > 0) {
        const mainEmbed = { ...finalPayload.embeds[0] };
        if (mainEmbed.description && mainEmbed.description.length > 4000) {
          mainEmbed.description = mainEmbed.description.slice(0, 4000) + '...';
        }
        finalPayload.embeds = [mainEmbed, ...finalPayload.embeds.slice(1)];
      }

      await interaction.editReply(finalPayload);
      return;
    }

    // Direct command execution
    const deferredCommands = ['e621', 'yiff', 'furrypic', 'oc', ...TARGET_ACTIONS, ...SOLO_ACTIONS, 'avatar', 'update'];
    const needsDefer = deferredCommands.includes(interaction.commandName);
    if (needsDefer) {
      await interaction.deferReply();
    }

    const directParams = {
      cutie: interaction.options.getUser('cutie') || interaction.options.getUser('cutie1') || null,
      cutie2: interaction.options.getUser('cutie2') || null,
      vibe: interaction.options.getString('vibe') || 'furry',
      tags: interaction.options.getString('tags') || '',
      rating: interaction.commandName === 'yiff' ? 'explicit' : (interaction.options.getString('rating') || 'nsfw'),
      order: interaction.options.getString('order') || 'newest',
      species: interaction.options.getString('species') || 'neko',
      question: interaction.options.getString('question') || null,
      user_id: interaction.options.getString('user_id') || null,
      scope: interaction.options.getString('scope') || 'both'
    };

    const payload = await executeBotCommand(interaction.commandName, directParams, interaction, null);
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
