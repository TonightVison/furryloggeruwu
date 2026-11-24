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
let lastE621Query = { tags: '', order: 'newest', ranAt: null };

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
    line = line.replace(/```/g, "'''");
    this.entries.push(line);
    console.log(line);
  }

  buildPlainEnglishSummary(targetCommand, totalMs) {
    if (this.issues.length === 0) {
      const details = this.successes.length > 0
        ? this.successes.join(' ')
        : `/${targetCommand} ran smoothly with zero errors.`;
      return `✅ **What Happened (Plain English):** Everything worked properly in \`${totalMs}ms\`! ${details}`;
    }

    const bulletList = this.issues.map((item) => `• ${item}`).join('\n');
    const silverLining = this.successes.length > 0
      ? `\n*What still worked:* ${this.successes.join(' ')}`
      : '';
    return `⚠️ **What Went Wrong (Plain English):**\n${bulletList}${silverLining}`;
  }

  format(maxLength = 1350) {
    const full = this.entries.join('\n');
    if (full.length <= maxLength) return full;
    const headLen = Math.floor(maxLength * 0.45);
    const tailLen = Math.floor(maxLength * 0.45);
    const omitted = full.length - (headLen + tailLen);
    return `${full.slice(0, headLen)}\n... [${omitted} chars omitted] ...\n${full.slice(full.length - tailLen)}`;
  }
}

function recordAffectionVerbose(fromId, toId, logger = null) {
  const prevTotal = totalAffectionDelivered;
  const key = `${fromId}->${toId}`;
  const prevPair = affectionCounts.get(key) || 0;
  const next = recordAffection(fromId, toId);
  logger?.log('STATE:AFFECTION', `Updated in-memory affection counters for key "${key}"`, {
    key,
    previousPairCount: prevPair,
    newPairCount: next,
    previousGlobalTotal: prevTotal,
    newGlobalTotal: totalAffectionDelivered,
    totalTrackedPairs: affectionCounts.size
  });
  return next;
}

function pick(category, logger = null) {
  const list = KAOMOJI[category] || KAOMOJI.cute;
  const idx = Math.floor(Math.random() * list.length);
  const chosen = list[idx];
  logger?.log('RNG:KAOMOJI', `Picked kaomoji from category "${category}"`, {
    requestedCategory: category,
    fallbackUsed: !KAOMOJI[category],
    poolSize: list.length,
    selectedIndex: idx,
    chosen
  });
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
    milk: 'nom',
    bonk: 'bonk',
    blush: 'blush',
    tailwag: 'happy',
    purr: 'neko',
    howl: 'awoo'
  };

  logger?.log('GIF:INIT', `Starting 3-tier GIF resolution for action="${action}" vibe="${vibe}"`, {
    tier1_purrbot: vibe === 'furry' ? purrMap[action] || null : 'skipped (vibe != furry)',
    tier2_nekosbest: nekosMap[action] || 'cuddle',
    tier3_waifupics: waifuMap[action] || 'hug'
  });

  // 1. PurrBot Furry
  if (vibe === 'furry' && purrMap[action]) {
    const purrUrl = makeUrl('api.purrbot.site', `/v2/img/sfw/${purrMap[action]}/gif`);
    const t0 = performance.now();
    try {
      const purrRes = await fetch(purrUrl, { signal: AbortSignal.timeout(5000) });
      const latencyMs = (performance.now() - t0).toFixed(2);
      if (purrRes.ok) {
        const purrData = await purrRes.json();
        if (purrData?.link && !purrData.error) {
          logger?.clearIssues();
          logger?.explainSuccess(`Grabbed a furry GIF from PurrBot in ${latencyMs}ms.`);
          return { url: purrData.link, source: 'PurrBot Furry / Kemonomimi' };
        }
      }
    } catch (err) {
      logger?.log('HTTP:ERR', `PurrBot failed`, { error: err?.message || String(err) });
    }
  }

  // 2. Nekos.best
  try {
    const endpoint = nekosMap[action] || 'cuddle';
    const nekosUrl = makeUrl('nekos.best', `/api/v2/${endpoint}`);
    const t0 = performance.now();
    const res = await fetch(nekosUrl, { signal: AbortSignal.timeout(5000) });
    const latencyMs = (performance.now() - t0).toFixed(2);
    if (res.ok) {
      const data = await res.json();
      const item = data?.results?.[0];
      if (item?.url) {
        logger?.clearIssues();
        logger?.explainSuccess(`Loaded a GIF from Nekos.best in ${latencyMs}ms.`);
        return {
          url: item.url,
          source: item.anime_name ? `Nekos.best • ${item.anime_name}` : 'Nekos.best SFW'
        };
      }
    }
  } catch (err) {
    logger?.log('HTTP:ERR', `Nekos.best failed`, { error: err?.message || String(err) });
  }

  // 3. Waifu.pics
  try {
    const wEndpoint = waifuMap[action] || 'hug';
    const waifuUrl = makeUrl('api.waifu.pics', `/sfw/${wEndpoint}`);
    const t0 = performance.now();
    const wRes = await fetch(waifuUrl, { signal: AbortSignal.timeout(5000) });
    const latencyMs = (performance.now() - t0).toFixed(2);
    if (wRes.ok) {
      const wData = await wRes.json();
      if (wData?.url) {
        logger?.clearIssues();
        logger?.explainSuccess(`Loaded a backup GIF from Waifu.pics in ${latencyMs}ms.`);
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
  logger?.log('SPECIES:INIT', `Fetching SFW furry species media for species="${species}"`);
  try {
    const gifUrl = makeUrl('api.purrbot.site', `/v2/img/sfw/${species}/gif`);
    const res = await fetch(gifUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      if (data?.link && !data.error) {
        logger?.clearIssues();
        logger?.explainSuccess(`Fetched a "${species}" GIF from PurrBot.`);
        return data.link;
      }
    }

    const imgUrl = makeUrl('api.purrbot.site', `/v2/img/sfw/${species}/img`);
    const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(5000) });
    if (imgRes.ok) {
      const imgData = await imgRes.json();
      if (imgData?.link && !imgData.error) {
        logger?.clearIssues();
        logger?.explainSuccess(`Fetched a "${species}" image from PurrBot.`);
        return imgData.link;
      }
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
      if (url) {
        logger?.clearIssues();
        logger?.explainSuccess(`Fetched a backup "${fallbackEndpoint}" image from Nekos.best.`);
        return url;
      }
    }
  } catch (err) {
    logger?.log('HTTP:ERR', `Nekos.best failed`, { error: err?.message || String(err) });
  }

  return null;
}

// PURE, DIRECT e621.net NSFW MEDIA FETCHER (NO DANBOORU, NO OTHER BOORUS)
async function fetchE621Post(rawTags = '', order = 'newest', logger = null) {
  // Extract all tags, keeping explicit ratings untouched
  const cleanedUserTags = rawTags
    .split(/[\s,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t && !t.startsWith('order:') && t !== 'random');

  const allowedExts = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
  const queryTags = [...cleanedUserTags];
  if (order === 'score') queryTags.push('order:score');

  // Headers: Clean custom User-Agent without broken fake credentials
  const headers = {
    'User-Agent': 'FurryDiscordBot/6.0 (by Loomie on e621; emolarp.fans)',
    'Accept': 'application/json'
  };

  // Only attach Basic Auth if you configured real env variables
  if (process.env.E621_USERNAME && process.env.E621_API_KEY) {
    const token = Buffer.from(`${process.env.E621_USERNAME.trim()}:${process.env.E621_API_KEY.trim()}`).toString('base64');
    headers['Authorization'] = `Basic ${token}`;
  }

  logger?.log('E621:INIT', `Searching e621.net`, {
    rawTags,
    order,
    queryTags,
    hasAuth: Boolean(headers['Authorization'])
  });

  function extractMedia(p) {
    if (!p) return null;
    if (p.flags?.deleted || p.flags?.flagged_for_deletion) return null;

    const ext = (p.file?.ext || p.file_ext || '').toLowerCase();
    const md5 = p.file?.md5 || p.md5;

    // Direct CDN links from static1.e621.net
    const reconstructed = md5 && ext && allowedExts.includes(ext)
      ? makeUrl('static1.e621.net', `/data/${md5.slice(0, 2)}/${md5.slice(2, 4)}/${md5}.${ext}`)
      : null;

    const reconstructedSample = md5
      ? makeUrl('static1.e621.net', `/data/sample/${md5.slice(0, 2)}/${md5.slice(2, 4)}/${md5}.jpg`)
      : null;

    const isLarge = (p.file?.size || 0) > 8_000_000;

    const candidates = [
      ext === 'gif' ? p.file?.url : null,
      isLarge ? p.sample?.url : null,
      p.file?.url,
      p.sample?.url,
      reconstructed,
      reconstructedSample,
      p.preview?.url,
      p.file_url,
      p.large_file_url
    ].filter((u) => typeof u === 'string' && u.startsWith('http'));

    const chosenUrl = candidates[0] || null;
    if (!chosenUrl) return null;

    const inferredExt = ext || chosenUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'jpg';

    return {
      post: p,
      ext: inferredExt,
      displayUrl: chosenUrl
    };
  }

  const queryStr = encodeURIComponent(queryTags.join(' '));

  // Endpoints on e621.net ONLY:
  // 1. Dedicated Random Endpoint (pulls random NSFW post matching tags)
  // 2. Listing Endpoint (fetches 75 posts and randomly selects one)
  const e621Urls = [
    `${makeUrl('e621.net', '/posts/random.json')}?tags=${queryStr}`,
    `${makeUrl('e621.net', '/posts.json')}?limit=75&tags=${queryStr}`
  ];

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

      let postsList = [];
      if (data?.post) {
        postsList = [data.post];
      } else if (Array.isArray(data?.posts)) {
        postsList = data.posts;
      } else if (Array.isArray(data)) {
        postsList = data;
      }

      const validPosts = postsList
        .map(extractMedia)
        .filter((item) => item && item.displayUrl && allowedExts.includes(item.ext));

      logger?.log('E621:FILTER', `Filtered e621.net results`, {
        rawCount: postsList.length,
        validCount: validPosts.length
      });

      if (validPosts.length === 0) continue;

      // Pick a random post from the matches
      const picked = validPosts[Math.floor(Math.random() * validPosts.length)];
      const chosen = picked.post;
      const artists = (chosen.tags?.artist || []).filter((a) => a !== 'conditional_dnp').slice(0, 3);
      const species = (chosen.tags?.species || []).slice(0, 4);
      const scoreVal = typeof chosen.score === 'object' ? (chosen.score?.total ?? 0) : (chosen.score ?? 0);

      logger?.clearIssues();
      logger?.explainSuccess(`Got post #${chosen.id} (\`.${picked.ext}\`) directly from e621.net in ${latencyMs}ms!`);

      return {
        id: chosen.id,
        imageUrl: picked.displayUrl,
        postUrl: makeUrl('e621.net', `/posts/${chosen.id}`),
        score: scoreVal,
        artists: artists.length ? artists.join(', ') : (chosen.tag_string_artist || 'Unknown'),
        species: species.length ? species.join(', ') : (chosen.tag_string_species || 'Unspecified'),
        searchedTags: cleanedUserTags.length ? cleanedUserTags.join(' ') : 'all posts',
        rating: chosen.rating || 'e'
      };
    } catch (err) {
      logger?.log('HTTP:ERR', `e621 fetch failed`, { error: err?.message || String(err) });
      logger?.explainIssue(`Connection to e621.net failed (${err?.message || 'network error'}).`);
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
  const chosen = copyMap[action];
  return chosen;
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
        .setLabel('View Decoration uwu')
        .setStyle(ButtonStyle.Link)
        .setURL(decoUrl)
    );
  }
  if (profileUserId) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel('Profile :3')
        .setStyle(ButtonStyle.Link)
        .setURL(makeUrl('discord.com', `/users/${profileUserId}`))
    );
  }
  return [row];
}

const addVibeOption = (opt) =>
  opt
    .setName('vibe')
    .setDescription('Pick furry/kemonomimi or anime GIF style! :3')
    .setRequired(false)
    .addChoices(
      { name: 'Furry / Kemonomimi (PurrBot) :3', value: 'furry' },
      { name: 'Anime (Nekos.best) ^w^', value: 'anime' }
    );

function makeEverywhere(builder) {
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
      .setDescription('Pull furry NSFW art & GIFs directly from e621.net! :3')
      .addStringOption((opt) =>
        opt
          .setName('tags')
          .setDescription('Space-separated booru tags (e.g. "dragon", "fox cuddle") :3')
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

    // Update slash command
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
          .setDescription('Command & args (e.g. "e621 dragon", "update", "stats") :3')
          .setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName('args')
          .setDescription('Extra arguments (tags, question, @user, species, vibe) :3')
          .setRequired(false)
      )
      .addUserOption((opt) =>
        opt.setName('cutie').setDescription('Target cutie for actions, cutemeter, lovecount, or ship! :3').setRequired(false)
      )
      .addUserOption((opt) =>
        opt.setName('cutie2').setDescription('Second cutie for /ship compatibility! ^w^').setRequired(false)
      )
      .addStringOption(addVibeOption)
      .addStringOption((opt) =>
        opt.setName('tags').setDescription('Space-separated booru tags for /e621 :3').setRequired(false)
      )
      .addStringOption((opt) =>
        opt
          .setName('order')
          .setDescription('Sort order for /e621 results ^w^')
          .setRequired(false)
          .addChoices(
            { name: 'Newest uwu', value: 'newest' },
            { name: 'Top Score ^w^', value: 'score' }
          )
      )
      .addStringOption((opt) =>
        opt
          .setName('species')
          .setDescription('Species for /furrypic ^w^')
          .setRequired(false)
          .addChoices(
            { name: 'Neko / Catboy :3', value: 'neko' },
            { name: 'Kitsune / Fox ^w^', value: 'kitsune' },
            { name: 'Okami / Wolf uwu', value: 'okami' },
            { name: 'Eevee >w<', value: 'eevee' },
            { name: 'Holo (Wolf) :3', value: 'holo' }
          )
      )
      .addStringOption((opt) =>
        opt.setName('question').setDescription('Yes/no question for /8ball :3').setRequired(false)
      )
      .addStringOption((opt) =>
        opt.setName('user_id').setDescription('Discord User ID or @mention for /avatar :3').setRequired(false)
      )
      .addStringOption((opt) =>
        opt.setName('scope').setDescription('Scope for /update ("guild", "global", or "both") :3').setRequired(false)
      )
  ];

  if (forEverywhere) {
    return rawBuilders.map((b) => makeEverywhere(b));
  }
  return rawBuilders.map((b) => b.toJSON());
}

// Deploy & sync commands
async function deployCommands({ guildId = null, scope = 'both', logger = null } = {}) {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const results = { guildCount: null, globalCount: null };

  logger?.log('DEPLOY:INIT', `Starting slash command synchronization`, { scope, guildId });

  // 1. Instant Guild Sync
  if ((scope === 'guild' || scope === 'both') && guildId) {
    try {
      const guildCommands = getCommandDefinitions(false);
      const res = await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), {
        body: guildCommands
      });
      results.guildCount = Array.isArray(res) ? res.length : guildCommands.length;
      logger?.log('DEPLOY:GUILD_OK', `Successfully registered ${results.guildCount} commands to guild "${guildId}"`);
    } catch (err) {
      console.error('Failed to register guild commands:', err);
    }
  }

  // 2. Global Sync
  if (scope === 'global' || scope === 'both') {
    try {
      const globalCommands = getCommandDefinitions(true);
      const res = await rest.put(Routes.applicationCommands(client.user.id), {
        body: globalCommands
      });
      results.globalCount = Array.isArray(res) ? res.length : globalCommands.length;
    } catch (err) {
      if (err?.message?.includes('integration_types') || err?.code === 50035) {
        try {
          const fallback = getCommandDefinitions(false);
          const res = await rest.put(Routes.applicationCommands(client.user.id), { body: fallback });
          results.globalCount = Array.isArray(res) ? res.length : fallback.length;
        } catch (innerErr) {
          console.error('Failed to register global commands (fallback):', innerErr);
        }
      } else {
        console.error('Failed to register global commands:', err);
      }
    }
  }

  return results;
}

// Register Slash Commands on startup
client.once(Events.ClientReady, async () => {
  console.log(`furry online as ${client.user.tag} for Loomie (${OWNER_ID}) :3`);
  client.user.setActivity('paws, snuggles & emolarp.fans :3', { type: 3 });

  try {
    const res = await deployCommands({ scope: 'global' });
    console.log(`Registered ${res.globalCount ?? 'all'} global slash commands successfully! :3`);
  } catch (err) {
    console.error('Initial command deployment failed:', err);
  }
});

const TARGET_ACTIONS = ['snuggle', 'hug', 'lick', 'kiss', 'headpat', 'earscratch', 'boop', 'bite', 'milk', 'bonk'];
const SOLO_ACTIONS = ['blush', 'tailwag', 'purr', 'howl'];
const ALL_COMMANDS = [
  'e621',
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
function buildE621Response(post, rawTags = '', order = 'newest', logger = null) {
  const safeCustomId = `e621:${order}:${rawTags.slice(0, 75)}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(safeCustomId)
      .setLabel('Roll Again :3')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setLabel('View on e621.net ^w^')
      .setStyle(ButtonStyle.Link)
      .setURL(post.postUrl)
  );

  const ratingMap = { s: 'Safe', q: 'Questionable', e: 'Explicit (NSFW)' };
  const ratingLabel = ratingMap[post.rating] || 'NSFW / Adult';

  logger?.log('EMBED:E621', `Constructed e621 embed & action row`, {
    postId: post.id,
    safeCustomId,
    postUrl: post.postUrl,
    imageUrl: post.imageUrl
  });

  return {
    embeds: [{
      title: `e621 Booru Pull~ ${pick('cute', logger)}`,
      description:
        `*ears perk up and tail wags!* Found an adult post for \`${post.searchedTags}\`! ${pick('online', logger)}\n\n` +
        `• **Artist:** \`${post.artists}\` • **Tags/Species:** \`${post.species}\` • **Score:** \`${post.score}\` • **Rating:** \`${ratingLabel}\`\n` +
        `• [emolarp.fans](${SITE_URL}) :3`,
      color: PASTEL_PINK,
      image: { url: post.imageUrl },
      footer: { text: `e621.net • Post #${post.id} • paws & thigh-highs certified :3` }
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
    .replace(/\b(order|vibe|species|user_id|cutie|cutie2|scope)[:=]([^\s]+)/gi, (_, k, v) => {
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

  if (targetCommand === 'e621') {
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
    const validSpecies = ['neko', 'kitsune', 'okami', 'eevee', 'holo'];
    if (!species && remTokens.length > 0 && validSpecies.includes(remTokens[0].toLowerCase())) {
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
    if (!question && remainder) question = remainder;
  } else if (targetCommand === 'avatar') {
    if (!user_id && remTokens[0]) user_id = remTokens[0];
  } else if (targetCommand === 'update') {
    if (!scope && remTokens[0]) {
      const s = remTokens[0].toLowerCase();
      if (['guild', 'global', 'both'].includes(s)) scope = s;
    }
  }

  const resolvedParams = {
    cutie,
    cutie2,
    vibe: vibe || 'furry',
    tags: tags || '',
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

  // /e621 — Direct e621.net adult booru pull
  if (commandName === 'e621') {
    const rawTags = params.tags !== undefined && params.tags !== '' ? params.tags : lastE621Query.tags;
    const order = params.order || lastE621Query.order || 'newest';
    lastE621Query = { tags: rawTags, order, ranAt: new Date().toISOString() };

    logger?.log('CMD:E621', `Executing /e621 with tags="${rawTags}" order="${order}" on e621.net`, { lastE621Query });
    const post = await fetchE621Post(rawTags, order, logger);

    if (!post) {
      logger?.log('CMD:E621_EMPTY', `No valid post returned from e621.net for tags="${rawTags}"`);
      return {
        content: `Awr~ I couldn't find any adult posts on e621.net for \`${rawTags || 'your search'}\`! Try simpler underscore tags like \`deer\`, \`dragon\`, or \`fox\`, >_<`
      };
    }

    return buildE621Response(post, rawTags, order, logger);
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
        footer: { text: `furry bot v6.0 • update requested by Loomie :3` }
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
    logger?.log('CMD:FURRYPIC', `Executing /furrypic for species="${species}" (${labelMap[species] || 'Furry'})`);
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
        ? `*curls up in an oversized pastel hoodie and rumbles softly*\n\n<@${interaction.user.id}> is purring happily for <@${cutie.id}>!! ${pick('snuggle', logger)} • [emolarp.fans](${SITE_URL})`
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
        title: `Pastel Ship Compatibility~ ${pick('affection', logger)}`,
        description:
          `*paws at the air excitedly!*\n\n` +
          `<@${c1.id}> + <@${c2.id}> = **${shipName}** ${pick('cute', logger)}\n` +
          `**Snuggle Compatibility:** **${score}%**!\n\n` +
          `${score >= 85 ? `*Destined for matching thigh-highs & endless cuddle piles!! ${pick('snuggle', logger)}*` : `*Super sweet duo! Definitely share a hoodie together uwu :3*`}\n\n` +
          `[emolarp.fans](${SITE_URL}) ^w^`,
        color: PASTEL_PURPLE
      }]
    };
  }

  // /8ball
  if (commandName === '8ball') {
    let question = params.question || 'Will I get extra headpats today?';
    const replies = [
      `Yeeeesss, 100%!! ${pick('online', logger)}`,
      `My ears perked up—signs point to yes, uwu~ :3`,
      `Definitely!! Treat yourself to extra headpats too ^w^`,
      `Hmm... ask again after a cozy nap and some snuggles~ (－_－) zzZ`,
      `My tail says maybe! Let's see how the vibes go~ ${pick('cute', logger)}`,
      `Awr, doesn't look like it right now >_<`,
      `Nuh-uh, my paws say no this time! ${pick('blush', logger)}`
    ];
    const answer = replies[Math.floor(Math.random() * replies.length)];

    return {
      embeds: [{
        title: `Pastel Catboy 8-Ball~ ${pick('cute', logger)}`,
        description: `*shakes paws and peers into a glowing pink crystal ball*\n\n**Question:** ${question}\n**Answer:** **${answer}**\n\n[emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_LAVENDER
      }]
    };
  }

  // /lovecount
  if (commandName === 'lovecount') {
    let cutie = params.cutie || interaction.user;
    const key = `${interaction.user.id}->${cutie.id}`;
    const count = affectionCounts.get(key) || 0;

    return {
      embeds: [{
        title: `Affection Meter~ ${pick('affection', logger)}`,
        description: `*tail wags happily!*\n\n<@${interaction.user.id}> has shared affection with <@${cutie.id}> **${count}** time${count === 1 ? '' : 's'}! ${pick('cute', logger)}\n\n[emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_PINK,
        thumbnail: { url: cutie.displayAvatarURL({ size: 256 }) }
      }]
    };
  }

  // /avatar
  if (commandName === 'avatar') {
    const rawInput = params.user_id || (params.cutie ? params.cutie.id : null);
    const rawId = rawInput ? rawInput.replace(/[<@!>]/g, '').trim() : interaction.user.id;

    try {
      const fullUser = await client.users.fetch(rawId, { force: true });
      const avatarUrl = fullUser.displayAvatarURL({ size: 512 });
      const bannerUrl = fullUser.bannerURL({ size: 1024 });
      const decoUrl = fullUser.avatarDecorationURL({ size: 512 });

      return {
        embeds: [{
          title: `${fullUser.username}'s Lookbook~ ${pick('cute', logger)}`,
          description: `*ears perk up!* Showing **${fullUser.username}** (\`${fullUser.id}\`), uwu~ • [emolarp.fans](${SITE_URL})`,
          color: PASTEL_PURPLE,
          thumbnail: { url: avatarUrl },
          image: bannerUrl ? { url: bannerUrl } : undefined,
          fields: [
            { name: 'Username', value: `\`${fullUser.username}\``, inline: true },
            { name: 'Display Name', value: `\`${fullUser.globalName || 'None'}\``, inline: true }
          ],
          timestamp: new Date().toISOString()
        }],
        components: buildAssetButtons(avatarUrl, bannerUrl, decoUrl, fullUser.id)
      };
    } catch {
      return {
        content: `Awr~ I couldn’t find anyone with that ID! Make sure Developer Mode is on and copy the numeric User ID, >_<`
      };
    }
  }

  // /stats
  if (commandName === 'stats') {
    const uptimeSec = Math.floor(process.uptime());
    const mins = Math.floor(uptimeSec / 60);
    const hrs = Math.floor(mins / 60);

    return {
      embeds: [{
        title: `furry Status & Paw-formance~ ${pick('online', logger)}`,
        description: `*tail wags happily!* Built for Loomie—cozy, awake, and ready for snuggles in DMs and servers, uwu~\n\nWebsite: [emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_LAVENDER,
        fields: [
          { name: 'Ping', value: `\`${client.ws.ping}ms\``, inline: true },
          { name: 'Awake For', value: `\`${hrs}h ${mins % 60}m\``, inline: true },
          { name: 'Total Affection Given', value: `\`${totalAffectionDelivered}\` combos ${pick('affection', logger)}`, inline: true }
        ]
      }],
      ephemeral: true
    };
  }

  const validList = ALL_COMMANDS.filter((c) => c !== 'log').join(', ');
  return {
    content: `Awr~ Unknown command \`/${commandName}\`! >_<\nAvailable commands to run with \`/log\`: \`${validList}\` :3`
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
    const e621Check = await fetchE621Post('deer', 'newest');
    e621Status = e621Check ? `✅ Online & Working (Post #${e621Check.id})` : '⚠️ No media returned';
  } catch (e) {
    e621Status = `❌ Error: ${e.message}`;
  }

  await statusMsg.edit({
    content:
      `*tail wags happily!* ✨ **Slash Commands Successfully Updated!**\n\n` +
      `• **Current Server:** \`${deployRes.guildCount ?? 0}\` commands synced **INSTANTLY** (0s delay!)\n` +
      `• **Global (All Servers/DMs):** \`${deployRes.globalCount ?? 0}\` commands deployed\n` +
      `• **e621.net Check:** ${e621Status}\n` +
      `• **Tip:** If the slash command menu hasn't refreshed on your screen, press **Ctrl + R** on Discord desktop or restart mobile Discord to clear Discord's local cache :3\n` +
      `• [emolarp.fans](${SITE_URL}) ^w^`
  });
});

// Handle Slash Commands & Interactive Buttons
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Handle "Roll Again" button for /e621
    if (interaction.isButton() && interaction.customId.startsWith('e621:')) {
      const [, order, ...tagParts] = interaction.customId.split(':');
      const rawTags = tagParts.join(':');
      lastE621Query = { tags: rawTags, order: order || 'newest', ranAt: new Date().toISOString() };
      await interaction.deferReply();

      const post = await fetchE621Post(rawTags, order || 'newest');
      if (!post) {
        return interaction.editReply(`Awr~ Couldn't find another post on e621.net for \`${rawTags || 'those tags'}\` right now! >_<`);
      }
      await interaction.editReply(buildE621Response(post, rawTags, order || 'newest'));
      return;
    }

    // Handle "Return the Affection" Button Clicks
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
    const deferredCommands = ['e621', 'furrypic', 'oc', ...TARGET_ACTIONS, ...SOLO_ACTIONS, 'avatar', 'update'];
    const needsDefer = deferredCommands.includes(interaction.commandName);
    if (needsDefer) {
      await interaction.deferReply();
    }

    const directParams = {
      cutie: interaction.options.getUser('cutie') || interaction.options.getUser('cutie1') || null,
      cutie2: interaction.options.getUser('cutie2') || null,
      vibe: interaction.options.getString('vibe') || 'furry',
      tags: interaction.options.getString('tags') || '',
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
