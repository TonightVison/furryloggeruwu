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
  InteractionContextType
} from 'discord.js';
import http from 'node:http';
import 'dotenv/config';

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// Safe URL builder so clipboard extensions never turn URLs into Markdown links!
const HTTPS = ['https:', ''].join('//');
const makeUrl = (host, path = '') => `${HTTPS}${host}${path}`;

// Loomie's User ID & Website
const OWNER_ID = '1416390397881749514';
const SITE_URL = makeUrl('emolarp.fans');
const OC_IMAGE_URL = (process.env.OC_IMAGE_URL || '').trim();

// In-memory affection counter
const affectionCounts = new Map();
let totalAffectionDelivered = 0;

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
    this.startTime = performance.now();
    this.startIso = new Date().toISOString();
    this.entries = [];
    this.issues = [];
    this.successes = [];
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

  // 1. Try PurrBot Furry / Kemonomimi first when vibe === 'furry'
  if (vibe === 'furry' && purrMap[action]) {
    const purrUrl = makeUrl('api.purrbot.site', `/v2/img/sfw/${purrMap[action]}/gif`);
    const t0 = performance.now();
    logger?.log('HTTP:REQ', `Tier 1 [PurrBot] GET ${purrUrl}`, { timeoutMs: 5000 });
    try {
      const purrRes = await fetch(purrUrl, {
        signal: AbortSignal.timeout(5000)
      });
      const latencyMs = (performance.now() - t0).toFixed(2);
      logger?.log('HTTP:RES', `Tier 1 [PurrBot] responded HTTP ${purrRes.status} in ${latencyMs}ms`, {
        ok: purrRes.ok,
        status: purrRes.status
      });
      if (purrRes.ok) {
        const purrData = await purrRes.json();
        logger?.log('GIF:PARSE', `Tier 1 [PurrBot] payload parsed`, {
          hasLink: Boolean(purrData?.link),
          error: purrData?.error ?? false,
          link: purrData?.link || null
        });
        if (purrData?.link && !purrData.error) {
          logger?.explainSuccess(`Grabbed a furry/kemonomimi GIF from PurrBot in ${latencyMs}ms.`);
          return { url: purrData.link, source: 'PurrBot Furry / Kemonomimi' };
        }
        logger?.explainIssue(`PurrBot replied with HTTP 200 for "${purrMap[action]}", but didn't include a valid GIF link, so the bot switched to a backup GIF site.`);
      } else {
        logger?.explainIssue(`PurrBot returned HTTP ${purrRes.status} when asked for a "${purrMap[action]}" GIF, so the bot switched to a backup GIF site.`);
      }
    } catch (err) {
      logger?.log('HTTP:ERR', `Tier 1 [PurrBot] failed, falling back to Tier 2`, {
        error: err?.message || String(err)
      });
      logger?.explainIssue(`PurrBot took too long (>5s) or couldn't be reached (${err?.message || 'network error'}), so the bot switched to Nekos.best.`);
    }
  }

  // 2. Try Nekos.best SFW
  try {
    const endpoint = nekosMap[action] || 'cuddle';
    const nekosUrl = makeUrl('nekos.best', `/api/v2/${endpoint}`);
    const t0 = performance.now();
    logger?.log('HTTP:REQ', `Tier 2 [Nekos.best] GET ${nekosUrl}`, { timeoutMs: 5000 });
    const res = await fetch(nekosUrl, {
      signal: AbortSignal.timeout(5000)
    });
    const latencyMs = (performance.now() - t0).toFixed(2);
    logger?.log('HTTP:RES', `Tier 2 [Nekos.best] responded HTTP ${res.status} in ${latencyMs}ms`, {
      ok: res.ok,
      status: res.status
    });
    if (res.ok) {
      const data = await res.json();
      const item = data?.results?.[0];
      logger?.log('GIF:PARSE', `Tier 2 [Nekos.best] payload parsed`, {
        resultsCount: data?.results?.length || 0,
        url: item?.url || null,
        animeName: item?.anime_name || null
      });
      if (item?.url) {
        logger?.explainSuccess(`Loaded a GIF from Nekos.best in ${latencyMs}ms.`);
        return {
          url: item.url,
          source: item.anime_name ? `Nekos.best • ${item.anime_name}` : 'Nekos.best SFW'
        };
      }
      logger?.explainIssue(`Nekos.best returned an empty list for "${endpoint}", so the bot tried Waifu.pics next.`);
    } else {
      logger?.explainIssue(`Nekos.best returned HTTP ${res.status}, so the bot tried Waifu.pics next.`);
    }
  } catch (err) {
    logger?.log('HTTP:ERR', `Tier 2 [Nekos.best] failed, falling back to Tier 3`, {
      error: err?.message || String(err)
    });
    logger?.explainIssue(`Nekos.best failed to respond (${err?.message || 'timeout'}), so the bot tried Waifu.pics next.`);
  }

  // 3. Final backup: Waifu.pics SFW
  try {
    const wEndpoint = waifuMap[action] || 'hug';
    const waifuUrl = makeUrl('api.waifu.pics', `/sfw/${wEndpoint}`);
    const t0 = performance.now();
    logger?.log('HTTP:REQ', `Tier 3 [Waifu.pics] GET ${waifuUrl}`, { timeoutMs: 5000 });
    const wRes = await fetch(waifuUrl, {
      signal: AbortSignal.timeout(5000)
    });
    const latencyMs = (performance.now() - t0).toFixed(2);
    logger?.log('HTTP:RES', `Tier 3 [Waifu.pics] responded HTTP ${wRes.status} in ${latencyMs}ms`, {
      ok: wRes.ok,
      status: wRes.status
    });
    if (wRes.ok) {
      const wData = await wRes.json();
      logger?.log('GIF:PARSE', `Tier 3 [Waifu.pics] payload parsed`, { url: wData?.url || null });
      if (wData?.url) {
        logger?.explainSuccess(`Loaded a backup GIF from Waifu.pics in ${latencyMs}ms.`);
        return { url: wData.url, source: 'Waifu.pics SFW' };
      }
    }
    logger?.explainIssue(`Waifu.pics also returned HTTP ${wRes.status} with no GIF URL.`);
  } catch (err) {
    logger?.log('HTTP:ERR', `Tier 3 [Waifu.pics] failed; all GIF sources exhausted`, {
      error: err?.message || String(err)
    });
    logger?.explainIssue(`Waifu.pics failed (${err?.message || 'timeout'}).`);
  }

  logger?.log('GIF:FAIL', `All 3 GIF tiers returned no valid media URL`);
  logger?.explainIssue(`None of the 3 GIF providers (PurrBot, Nekos.best, Waifu.pics) returned a working GIF, so the embed was sent without an image.`);
  return null;
}

// Fetch random SFW species image/GIF from PurrBot with Nekos.best fallback
async function fetchFurrySpecies(species = 'neko', logger = null) {
  logger?.log('SPECIES:INIT', `Fetching SFW furry species media for species="${species}"`);
  try {
    const gifUrl = makeUrl('api.purrbot.site', `/v2/img/sfw/${species}/gif`);
    const t0 = performance.now();
    logger?.log('HTTP:REQ', `Tier 1a [PurrBot GIF] GET ${gifUrl}`, { timeoutMs: 5000 });
    const res = await fetch(gifUrl, {
      signal: AbortSignal.timeout(5000)
    });
    logger?.log('HTTP:RES', `Tier 1a [PurrBot GIF] HTTP ${res.status} in ${(performance.now() - t0).toFixed(2)}ms`);
    if (res.ok) {
      const data = await res.json();
      logger?.log('SPECIES:PARSE', `Tier 1a [PurrBot GIF] payload`, { link: data?.link || null, error: data?.error ?? false });
      if (data?.link && !data.error) {
        logger?.explainSuccess(`Fetched a "${species}" GIF from PurrBot.`);
        return data.link;
      }
    }

    const imgUrl = makeUrl('api.purrbot.site', `/v2/img/sfw/${species}/img`);
    const t1 = performance.now();
    logger?.log('HTTP:REQ', `Tier 1b [PurrBot IMG] GET ${imgUrl}`, { timeoutMs: 5000 });
    const imgRes = await fetch(imgUrl, {
      signal: AbortSignal.timeout(5000)
    });
    logger?.log('HTTP:RES', `Tier 1b [PurrBot IMG] HTTP ${imgRes.status} in ${(performance.now() - t1).toFixed(2)}ms`);
    if (imgRes.ok) {
      const imgData = await imgRes.json();
      logger?.log('SPECIES:PARSE', `Tier 1b [PurrBot IMG] payload`, { link: imgData?.link || null, error: imgData?.error ?? false });
      if (imgData?.link && !imgData.error) {
        logger?.explainSuccess(`Fetched a "${species}" image from PurrBot.`);
        return imgData.link;
      }
    }
    logger?.explainIssue(`PurrBot didn't have a "${species}" image available right now, so the bot switched to Nekos.best.`);
  } catch (err) {
    logger?.log('HTTP:ERR', `Tier 1 [PurrBot] error, falling back to Nekos.best`, { error: err?.message || String(err) });
    logger?.explainIssue(`PurrBot timed out or errored (${err?.message || 'network error'}), so the bot switched to Nekos.best.`);
  }

  try {
    const fallbackEndpoint = ['kitsune', 'okami', 'holo'].includes(species) ? 'kitsune' : 'neko';
    const nbUrl = makeUrl('nekos.best', `/api/v2/${fallbackEndpoint}`);
    const t0 = performance.now();
    logger?.log('HTTP:REQ', `Tier 2 [Nekos.best] GET ${nbUrl}`, { fallbackEndpoint, timeoutMs: 5000 });
    const nbRes = await fetch(nbUrl, {
      signal: AbortSignal.timeout(5000)
    });
    logger?.log('HTTP:RES', `Tier 2 [Nekos.best] HTTP ${nbRes.status} in ${(performance.now() - t0).toFixed(2)}ms`);
    if (nbRes.ok) {
      const nbData = await nbRes.json();
      const url = nbData?.results?.[0]?.url || null;
      logger?.log('SPECIES:PARSE', `Tier 2 [Nekos.best] payload`, { url });
      if (url) {
        logger?.explainSuccess(`Fetched a backup "${fallbackEndpoint}" image from Nekos.best.`);
        return url;
      }
    }
  } catch (err) {
    logger?.log('HTTP:ERR', `Tier 2 [Nekos.best] failed`, { error: err?.message || String(err) });
  }

  logger?.log('SPECIES:FAIL', `No media found across all endpoints for species="${species}"`);
  logger?.explainIssue(`Both PurrBot and Nekos.best failed to return an image for species "${species}".`);
  return null;
}

// Fetch media from e621.net (Auth -> Unauthenticated e621 -> Unauthenticated e926)
async function fetchE621Post(rawTags = '', order = 'random', logger = null) {
  const tagAliases = {
    sfw: 'rating:s',
    safe: 'rating:s',
    nsfw: '-rating:s',
    explicit: 'rating:e',
    questionable: 'rating:q'
  };

  const cleanedUserTags = rawTags
    .split(/[\s,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t && !t.startsWith('order:'))
    .map((t) => tagAliases[t] || t);

  const allowedExts = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

  const primaryTags = [...cleanedUserTags];
  if (order === 'random') primaryTags.push('order:random');
  else if (order === 'score') primaryTags.push('order:score');

  const e621User = (process.env.E621_USERNAME || 'loomieaccount').trim();
  const e621Key = (process.env.E621_API_KEY || 'q8iuHtnR1XvvWaYKyVB55hyk').trim();

  const baseHeaders = {
    'User-Agent': `FurryDiscordBot/5.1 (by ${e621User} on e621)`,
    'Accept': 'application/json'
  };

  const authHeaders = { ...baseHeaders };
  if (e621User && e621Key) {
    const token = Buffer.from(`${e621User}:${e621Key}`).toString('base64');
    authHeaders['Authorization'] = `Basic ${token}`;
  }

  // 1) e621.net with Basic Auth, 2) e621.net without Auth (bypasses unactivated account/blacklist filters), 3) e926.net without Auth
  const endpoints = [
    { label: 'e621.net (auth)', host: makeUrl('e621.net', '/posts.json'), tags: primaryTags, headers: authHeaders },
    { label: 'e621.net (public)', host: makeUrl('e621.net', '/posts.json'), tags: primaryTags, headers: baseHeaders },
    { label: 'e926.net (public)', host: makeUrl('e926.net', '/posts.json'), tags: primaryTags, headers: baseHeaders }
  ];

  logger?.log('E621:INIT', `Prepared Booru search query`, {
    rawTags,
    order,
    cleanedUserTags,
    authenticated: Boolean(e621User && e621Key),
    userAgent: baseHeaders['User-Agent']
  });

  for (let i = 0; i < endpoints.length; i++) {
    const { label, host, tags, headers } = endpoints[i];
    const query = encodeURIComponent(tags.join(' '));
    const url = `${host}?limit=60&tags=${query}`;
    const t0 = performance.now();

    logger?.log('HTTP:REQ', `Attempt #${i + 1}/${endpoints.length} [${label}] GET ${url}`, { tags });

    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(8000)
      });
      const latencyMs = (performance.now() - t0).toFixed(2);
      logger?.log('HTTP:RES', `Attempt #${i + 1} [${label}] HTTP ${res.status} in ${latencyMs}ms`, {
        ok: res.ok,
        status: res.status
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          logger?.explainIssue(`${label} rejected the request (HTTP ${res.status}) — make sure your e621 account email is activated in Gmail.`);
        } else if (res.status === 429) {
          logger?.explainIssue(`${label} rate-limited the bot (HTTP 429) — wait a few seconds before rolling again.`);
        } else if (res.status === 422) {
          logger?.explainIssue(`${label} rejected the search tags (HTTP 422) — check tag syntax or reduce the number of tags.`);
        } else {
          logger?.explainIssue(`${label} returned HTTP ${res.status}.`);
        }
        continue;
      }

      const data = await res.json();
      const rawCount = data?.posts?.length || 0;

      const validPosts = (data?.posts || [])
        .map((p) => {
          const ext = p?.file?.ext?.toLowerCase();
          const md5 = p?.file?.md5;
          const directUrl =
            p?.file?.url ||
            (md5 && ext
              ? makeUrl('static1.e621.net', `/data/${md5.slice(0, 2)}/${md5.slice(2, 4)}/${md5}.${ext}`)
              : null);
          const displayUrl =
            ext === 'gif' ? directUrl : (p?.file?.size > 8_000_000 && p?.sample?.url ? p.sample.url : directUrl);
          return { post: p, ext, displayUrl };
        })
        .filter((item) => item.displayUrl && allowedExts.includes(item.ext));

      logger?.log('E621:FILTER', `Filtered posts for valid extensions`, {
        label,
        rawPostCount: rawCount,
        validPostCount: validPosts.length
      });

      if (rawCount === 0) {
        logger?.explainIssue(`${label} responded OK, but found 0 posts matching \`${cleanedUserTags.join(' ') || 'your query'}\` (your e621 account blacklist/unactivated email may have hidden results, so trying next fallback).`);
        continue;
      }

      if (validPosts.length === 0) {
        logger?.explainIssue(`${label} found ${rawCount} posts for \`${cleanedUserTags.join(' ')}\`, but all of them were \`.webm\`/\`.swf\` videos.`);
        continue;
      }

      const poolLimit = Math.min(validPosts.length, order === 'score' ? 15 : validPosts.length);
      const selectedIdx = order === 'newest' ? 0 : Math.floor(Math.random() * poolLimit);
      const picked = validPosts[selectedIdx];
      const chosen = picked.post;

      const artists = (chosen.tags?.artist || []).filter((a) => a !== 'conditional_dnp').slice(0, 3);
      const species = (chosen.tags?.species || []).slice(0, 4);

      const result = {
        id: chosen.id,
        imageUrl: picked.displayUrl,
        postUrl: `${host.replace('/posts.json', '')}/posts/${chosen.id}`,
        score: chosen.score?.total ?? 0,
        artists: artists.length ? artists.join(', ') : 'Unknown',
        species: species.length ? species.join(', ') : 'Unspecified',
        searchedTags: cleanedUserTags.length ? cleanedUserTags.join(' ') : 'all posts'
      };

      logger?.log('E621:SELECT', `Selected post #${result.id} from ${label}`, {
        id: result.id,
        ext: picked.ext,
        score: result.score,
        imageUrl: result.imageUrl
      });

      logger?.explainSuccess(`Pulled post #${result.id} (\`.${picked.ext}\`, score ${result.score}) from ${label} out of ${validPosts.length} matching results in ${latencyMs}ms.`);
      return result;
    } catch (err) {
      logger?.log('HTTP:ERR', `Attempt #${i + 1} [${label}] threw exception`, { error: err?.message || String(err) });
      logger?.explainIssue(`Connection to ${label} failed or timed out (${err?.message || 'network error'}).`);
    }
  }

  logger?.log('E621:FAIL', `All query attempts returned 0 valid posts`);
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
  logger?.log('COPY:BUILD', `Constructed action copy template for "${action}"`, {
    fromId,
    toId,
    title: chosen?.title,
    backLabel: chosen?.backLabel
  });
  return chosen;
}

function buildAssetButtons(avatarUrl, bannerUrl, decoUrl, profileUserId = null, logger = null) {
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
  logger?.log('COMPONENT:ASSET_BTNS', `Built asset link buttons`, {
    buttonCount: row.components.length,
    hasBanner: Boolean(bannerUrl),
    hasDecoration: Boolean(decoUrl),
    profileUserId
  });
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

// Register Slash Commands
client.once(Events.ClientReady, async () => {
  console.log(`furry online as ${client.user.tag} for Loomie (${OWNER_ID}) :3`);
  client.user.setActivity('paws, snuggles & emolarp.fans :3', { type: 3 });

  const commands = [
    makeEverywhere(
      new SlashCommandBuilder()
        .setName('e621')
        .setDescription('Pull furry images & GIFs from e621.net using booru tags! :3')
        .addStringOption((opt) =>
          opt
            .setName('tags')
            .setDescription('Space-separated booru tags (e.g. "deer kemonomimi") :3')
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('order')
            .setDescription('How to sort results! ^w^')
            .setRequired(false)
            .addChoices(
              { name: 'Random :3', value: 'random' },
              { name: 'Top Score ^w^', value: 'score' },
              { name: 'Newest uwu', value: 'newest' }
            )
        )
    ),
    makeEverywhere(
      new SlashCommandBuilder()
        .setName('oc')
        .setDescription('Meet Loomie’s deer OC & check out Loomie’s profile and website! :3')
    ),
    makeEverywhere(
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
        )
    ),
    makeEverywhere(
      new SlashCommandBuilder()
        .setName('snuggle')
        .setDescription('Wrap a cutie in cozy oversized-hoodie & thigh-high snuggles uwu!')
        .addUserOption((opt) =>
          opt.setName('cutie').setDescription('Who are we snuggling? :3').setRequired(true)
        )
        .addStringOption(addVibeOption)
    ),
    makeEverywhere(
      new SlashCommandBuilder()
        .setName('hug')
        .setDescription('Give a cutie a big, warm, fluffy hug~ ^w^')
        .addUserOption((opt) =>
          opt.setName('cutie').setDescription('Who needs a warm hug? :3').setRequired(true)
        )
        .addStringOption(addVibeOption)
    ),
    makeEverywhere(
      new SlashCommandBuilder()
        .setName('lick')
        .setDescription('Give a cutie a playful catboy/puppy lick~ nya!')
        .addUserOption((opt) =>
          opt.setName('cutie').setDescription('Who gets a playful lick? >w<').setRequired(true)
        )
        .addStringOption(addVibeOption)
    ),
    makeEverywhere(
      new SlashCommandBuilder()
        .setName('kiss')
        .setDescription('Give a cutie a sweet pastel forehead or cheek kiss~ ^w^')
        .addUserOption((opt) =>
          opt.setName('cutie').setDescription('Who gets a sweet kiss? :3').setRequired(true)
        )
        .addStringOption(addVibeOption)
    ),
    makeEverywhere(
      new SlashCommandBuilder()
        .setName('headpat')
        .setDescription('Give a cutie cozy headpats and paw boops uwu!')
        .addUserOption((opt) =>
          opt.setName('cutie').setDescription('Who deserves headpats? :3').setRequired(true)
        )
        .addStringOption(addVibeOption)
    ),
    makeEverywhere(
      new SlashCommandBuilder()
        .setName('earscratch')
        .setDescription('Scratch behind a cutie’s fluffy ears until their tail thumps~ :3')
        .addUserOption((opt) =>
          opt.setName('cutie').setDescription('Whose fluffy ears are we scratching? ^w^').setRequired(true)
        )
        .addStringOption(addVibeOption)
    ),
    makeEverywhere(
      new SlashCommandBuilder()
        .setName('boop')
        .setDescription('Boop a cutie right on the snoot with a soft paw~ :3')
        .addUserOption((opt) =>
          opt.setName('cutie').setDescription('Whose nose are we booping? >w<').setRequired(true)
        )
        .addStringOption(addVibeOption)
    ),
    makeEverywhere(
      new SlashCommandBuilder()
        .setName('bite')
        .setDescription('Give a cutie a playful little catboy love-nibble~ nom!')
        .addUserOption((opt) =>
          opt.setName('cutie').setDescription('Who gets a gentle nibble? :3').setRequired(true)
        )
        .addStringOption(addVibeOption)
    ),
    makeEverywhere(
      new SlashCommandBuilder()
        .setName('milk')
        .setDescription('Share a frosty glass of milk with a cutie~ uwu')
        .addUserOption((opt) =>
          opt.setName('cutie').setDescription('Who gets a glass of milk? :3').setRequired(true)
        )
        .addStringOption(addVibeOption)
    ),
    makeEverywhere(
      new SlashCommandBuilder()
        .setName('bonk')
        .setDescription('Give a silly cutie a playful paw-bonk~ >_<')
        .addUserOption((opt) =>
          opt.setName('cutie').setDescription('Who needs a soft bonk? >w<').setRequired(true)
        )
        .addStringOption(addVibeOption)
    ),
    makeEverywhere(
      new SlashCommandBuilder()
        .setName('blush')
        .setDescription('Get all flustered and red-faced uwu~')
        .addUserOption((opt) =>
          opt.setName('cutie').setDescription('Optional: who made you blush? >w<').setRequired(false)
        )
        .addStringOption(addVibeOption)
    ),
    makeEverywhere(
      new SlashCommandBuilder()
        .setName('tailwag')
        .setDescription('Wag your tail happily like an excited puppy/catboy~ :3')
        .addUserOption((opt) =>
          opt.setName('cutie').setDescription('Optional: who are you wagging your tail at? ^w^').setRequired(false)
        )
        .addStringOption(addVibeOption)
    ),
    makeEverywhere(
      new SlashCommandBuilder()
        .setName('purr')
        .setDescription('Curl up and purr loudly like a cozy catboy~ prrrr :3')
        .addUserOption((opt) =>
          opt.setName('cutie').setDescription('Optional: who are you purring for? uwu').setRequired(false)
        )
    ),
    makeEverywhere(
      new SlashCommandBuilder()
        .setName('howl')
        .setDescription('Let out a cute little wolf/deer awooo~ ^w^')
        .addUserOption((opt) =>
          opt.setName('cutie').setDescription('Optional: who are you howling with? :3').setRequired(false)
        )
    ),
    makeEverywhere(
      new SlashCommandBuilder()
        .setName('cutemeter')
        .setDescription('Scan a cutie with the official thigh-high & paw cuteness meter! ^w^')
        .addUserOption((opt) =>
          opt.setName('cutie').setDescription('Who are we scanning? (defaults to you!)').setRequired(false)
        )
    ),
    makeEverywhere(
      new SlashCommandBuilder()
        .setName('ship')
        .setDescription('Check the cozy compatibility score between two cuties~ :3')
        .addUserOption((opt) =>
          opt.setName('cutie1').setDescription('First cutie!').setRequired(true)
        )
        .addUserOption((opt) =>
          opt.setName('cutie2').setDescription('Second cutie!').setRequired(true)
        )
    ),
    makeEverywhere(
      new SlashCommandBuilder()
        .setName('8ball')
        .setDescription('Ask the pastel catboy crystal ball a yes/no question~ uwu')
        .addStringOption((opt) =>
          opt.setName('question').setDescription('What do you want to ask? :3').setRequired(true)
        )
    ),
    makeEverywhere(
      new SlashCommandBuilder()
        .setName('lovecount')
        .setDescription('Check how much affection you have given a cutie~ :3')
        .addUserOption((opt) =>
          opt.setName('cutie').setDescription('Check affection count for this cutie!').setRequired(true)
        )
    ),
    makeEverywhere(
      new SlashCommandBuilder()
        .setName('avatar')
        .setDescription('Show a cutie HD PFP, banner & avatar decoration + profile link! uwu')
        .addStringOption((opt) =>
          opt.setName('user_id').setDescription('Discord User ID or @mention (defaults to you!)').setRequired(false)
        )
    ),
    makeEverywhere(
      new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Check furry uptime, ping & total affection delivered! :3')
    ),
    makeEverywhere(
      new SlashCommandBuilder()
        .setName('log')
        .setDescription('Run any command and get a plain-English explanation + verbose logs! :3')
        .addStringOption((opt) =>
          opt
            .setName('command')
            .setDescription('Command & args to run (e.g. "e621 deer", "hug @user", "stats") :3')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('args')
            .setDescription('Extra arguments (tags, question, @user, species, vibe) :3')
            .setRequired(false)
        )
        .addUserOption((opt) =>
          opt
            .setName('cutie')
            .setDescription('Target cutie for actions, cutemeter, lovecount, or ship! :3')
            .setRequired(false)
        )
        .addUserOption((opt) =>
          opt
            .setName('cutie2')
            .setDescription('Second cutie for /ship compatibility! ^w^')
            .setRequired(false)
        )
        .addStringOption(addVibeOption)
        .addStringOption((opt) =>
          opt
            .setName('tags')
            .setDescription('Space-separated booru tags for /e621 :3')
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('order')
            .setDescription('Sort order for /e621 results ^w^')
            .setRequired(false)
            .addChoices(
              { name: 'Random :3', value: 'random' },
              { name: 'Top Score ^w^', value: 'score' },
              { name: 'Newest uwu', value: 'newest' }
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
          opt
            .setName('question')
            .setDescription('Yes/no question for /8ball :3')
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('user_id')
            .setDescription('Discord User ID or @mention for /avatar :3')
            .setRequired(false)
        )
    )
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log(`Registered ${commands.length} global slash commands successfully! :3`);
  } catch (err) {
    console.error('Failed to register slash commands:', err);
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
  'log'
];

// Helper to build an e621 embed + Roll Again / View Post buttons
function buildE621Response(post, rawTags = '', order = 'random', logger = null) {
  const safeCustomId = `e621:${order}:${rawTags.slice(0, 75)}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(safeCustomId)
      .setLabel('Roll Again :3')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setLabel('View on e621 ^w^')
      .setStyle(ButtonStyle.Link)
      .setURL(post.postUrl)
  );

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
        `*ears perk up and tail wags!* Found a fresh post for \`${post.searchedTags}\`! ${pick('online', logger)}\n\n` +
        `• **Artist:** \`${post.artists}\` • **Species:** \`${post.species}\` • **Score:** \`${post.score}\`\n` +
        `• [emolarp.fans](${SITE_URL}) :3`,
      color: PASTEL_PINK,
      image: { url: post.imageUrl },
      footer: { text: `e621.net • Post #${post.id} • paws & thigh-highs certified :3` }
    }],
    components: [row]
  };
}

// Parse /log invocation into a target command name and normalized parameter object
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
    user_id: interaction.options.getString('user_id') || null
  };

  logger.log('PARSER:RAW', `Inspecting raw /log inputs`, {
    rawCommandOption,
    rawArgsOption,
    explicitOptions: {
      ...explicitOptions,
      cutie: explicitOptions.cutie ? `${explicitOptions.cutie.username} (${explicitOptions.cutie.id})` : null,
      cutie2: explicitOptions.cutie2 ? `${explicitOptions.cutie2.username} (${explicitOptions.cutie2.id})` : null
    }
  });

  const combinedTokens = `${rawCommandOption} ${rawArgsOption}`.trim().split(/\s+/).filter(Boolean);
  let targetCommand = (combinedTokens.shift() || '').replace(/^\/+/, '').toLowerCase();

  while (targetCommand === 'log' && combinedTokens.length > 0) {
    targetCommand = combinedTokens.shift().replace(/^\/+/, '').toLowerCase();
    logger.log('PARSER:UNWRAP', `Unwrapped nested /log prefix -> targetCommand="${targetCommand}"`);
  }

  let remainder = combinedTokens.join(' ').trim();

  const inlineKv = {};
  remainder = remainder
    .replace(/\b(order|vibe|species|user_id|cutie|cutie2)[:=]([^\s]+)/gi, (_, k, v) => {
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

  logger.log('PARSER:TOKENIZE', `Tokenized target command and inline arguments`, {
    targetCommand,
    inlineKv,
    extractedUserIds,
    remainderWithoutMentions
  });

  async function resolveUserById(rawId, label) {
    const cleanId = rawId.replace(/[<@!>]/g, '').trim();
    if (!cleanId) return null;
    const t0 = performance.now();
    logger.log('DISCORD:FETCH_USER', `Resolving user for ${label} (id="${cleanId}")`);
    try {
      const u = await client.users.fetch(cleanId);
      logger.log('DISCORD:FETCH_USER_OK', `Resolved ${label} -> ${u.username} (${u.id}) in ${(performance.now() - t0).toFixed(2)}ms`);
      return u;
    } catch (err) {
      logger.log('DISCORD:FETCH_USER_ERR', `Could not fetch user id="${cleanId}" for ${label}`, {
        error: err?.message || String(err)
      });
      logger.explainIssue(`Couldn't find a Discord user with ID \`${cleanId}\` — make sure you copied the full numeric User ID or @mentioned them.`);
      return null;
    }
  }

  let cutie = explicitOptions.cutie;
  if (!cutie && inlineKv.cutie) {
    cutie = await resolveUserById(inlineKv.cutie, 'inlineKv.cutie');
  }
  if (!cutie && extractedUserIds[0]) {
    cutie = await resolveUserById(extractedUserIds[0], 'positional_user_1');
  }

  let cutie2 = explicitOptions.cutie2;
  if (!cutie2 && inlineKv.cutie2) {
    cutie2 = await resolveUserById(inlineKv.cutie2, 'inlineKv.cutie2');
  }
  if (!cutie2 && extractedUserIds[1]) {
    cutie2 = await resolveUserById(extractedUserIds[1], 'positional_user_2');
  }

  let vibe = explicitOptions.vibe || inlineKv.vibe || null;
  let species = explicitOptions.species || inlineKv.species || null;
  let order = explicitOptions.order || inlineKv.order || null;
  let tags = explicitOptions.tags ?? inlineKv.tags ?? null;
  let question = explicitOptions.question ?? inlineKv.question ?? null;
  let user_id = explicitOptions.user_id || inlineKv.user_id || extractedUserIds[0] || null;

  const remTokens = remainderWithoutMentions ? remainderWithoutMentions.split(/\s+/) : [];

  if (targetCommand === 'e621') {
    const validOrders = ['random', 'score', 'newest'];
    const filteredTagTokens = [];
    for (const tok of remTokens) {
      if (!order && validOrders.includes(tok.toLowerCase())) {
        order = tok.toLowerCase();
      } else {
        filteredTagTokens.push(tok);
      }
    }
    if (tags === null) {
      tags = filteredTagTokens.join(' ');
    }
  } else if (targetCommand === 'furrypic') {
    const validSpecies = ['neko', 'kitsune', 'okami', 'eevee', 'holo'];
    if (!species && remTokens.length > 0 && validSpecies.includes(remTokens[0].toLowerCase())) {
      species = remTokens[0].toLowerCase();
    } else if (!species && remTokens.length > 0) {
      logger.explainIssue(`"${remTokens[0]}" isn't one of the supported species (\`neko\`, \`kitsune\`, \`okami\`, \`eevee\`, \`holo\`), so it defaulted to \`neko\`.`);
    }
  } else if (TARGET_ACTIONS.includes(targetCommand) || SOLO_ACTIONS.includes(targetCommand)) {
    const validVibes = ['furry', 'anime'];
    for (const tok of remTokens) {
      if (!vibe && validVibes.includes(tok.toLowerCase())) {
        vibe = tok.toLowerCase();
      }
    }
  } else if (targetCommand === '8ball') {
    if (!question && remainder) {
      question = remainder;
    }
  } else if (targetCommand === 'avatar') {
    if (!user_id && remTokens[0]) {
      user_id = remTokens[0];
    }
  }

  const resolvedParams = {
    cutie,
    cutie2,
    vibe: vibe || 'furry',
    tags: tags || '',
    order: order || 'random',
    species: species || 'neko',
    question,
    user_id
  };

  logger.log('PARSER:RESOLVED', `Final normalized parameters for /${targetCommand}`, {
    targetCommand,
    cutie: resolvedParams.cutie ? `${resolvedParams.cutie.username} (${resolvedParams.cutie.id})` : null,
    cutie2: resolvedParams.cutie2 ? `${resolvedParams.cutie2.username} (${resolvedParams.cutie2.id})` : null,
    vibe: resolvedParams.vibe,
    tags: resolvedParams.tags,
    order: resolvedParams.order,
    species: resolvedParams.species,
    question: resolvedParams.question,
    user_id: resolvedParams.user_id
  });

  return { targetCommand, params: resolvedParams };
}

// Unified command execution engine with deep instrumentation
async function executeBotCommand(commandName, params, interaction, logger = null) {
  logger?.log('EXEC:ENTER', `Entering handler for command "/${commandName}"`, {
    invokerId: interaction.user.id,
    invokerTag: interaction.user.tag
  });

  if (commandName === 'e621') {
    const rawTags = params.tags || '';
    const order = params.order || 'random';
    logger?.log('CMD:E621', `Executing /e621 with tags="${rawTags}" order="${order}"`);
    const post = await fetchE621Post(rawTags, order, logger);

    if (!post) {
      logger?.log('CMD:E621_EMPTY', `No valid post returned from e621 for tags="${rawTags}"`);
      return {
        content: `Awr~ I couldn't find any image/GIF posts on e621 for \`${rawTags || 'your search'}\`! Try simpler underscore tags like \`deer\`, \`fox cuddle\`, or \`cat_boy\`, >_<`
      };
    }

    return buildE621Response(post, rawTags, order, logger);
  }

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

  if (commandName === 'oc') {
    const t0 = performance.now();
    logger?.log('CMD:OC', `Fetching owner profile OWNER_ID="${OWNER_ID}" (force=true)`);
    const loomieUser = await client.users.fetch(OWNER_ID, { force: true }).catch((err) => {
      logger?.log('CMD:OC_WARN', `Failed to fetch OWNER_ID, falling back to interaction.user`, {
        error: err?.message || String(err)
      });
      logger?.explainIssue(`Couldn't fetch Loomie's profile from Discord directly, so it fell back to your own avatar.`);
      return interaction.user;
    });
    logger?.log('CMD:OC_USER', `Resolved profile user in ${(performance.now() - t0).toFixed(2)}ms`, {
      id: loomieUser.id,
      username: loomieUser.username,
      ocImageConfigured: Boolean(OC_IMAGE_URL)
    });
    logger?.explainSuccess(`Built Loomie's OC showcase card.`);

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

  if (TARGET_ACTIONS.includes(commandName)) {
    const action = commandName;
    let cutie = params.cutie;
    if (!cutie) {
      cutie = interaction.user;
      logger?.log('CMD:TARGET_FALLBACK', `No target "cutie" provided for /${action}; defaulting to invoker ${cutie.username} (${cutie.id})`);
    }
    const vibe = params.vibe || 'furry';
    logger?.log('CMD:TARGET_ACTION', `Running target action "/${action}"`, {
      fromUser: `${interaction.user.username} (${interaction.user.id})`,
      toUser: `${cutie.username} (${cutie.id})`,
      vibe
    });

    const gif = await fetchActionGif(action, vibe, logger);
    const count = recordAffectionVerbose(interaction.user.id, cutie.id, logger);
    const chosen = buildActionCopy(action, interaction.user.id, cutie.id, logger);
    logger?.explainSuccess(`Updated affection combo with ${cutie.username} to ${count}.`);

    const backCustomId = `back:${action}:${interaction.user.id}:${cutie.id}:${vibe}`;
    const backBtn = new ButtonBuilder()
      .setCustomId(backCustomId)
      .setLabel(chosen.backLabel)
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(backBtn);
    logger?.log('COMPONENT:BACK_BTN', `Built Return-Affection interactive button`, {
      customId: backCustomId,
      label: chosen.backLabel
    });

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

  if (SOLO_ACTIONS.includes(commandName)) {
    const action = commandName;
    const cutie = params.cutie || null;
    const vibe = params.vibe || 'furry';
    logger?.log('CMD:SOLO_ACTION', `Running reaction command "/${action}"`, {
      mode: cutie ? 'targeted' : 'solo',
      targetUser: cutie ? `${cutie.username} (${cutie.id})` : null,
      vibe
    });

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

  if (commandName === 'cutemeter') {
    const cutie = params.cutie || interaction.user;
    const isOwner = cutie.id === OWNER_ID;
    const remainder = Number(BigInt(cutie.id) % 31n);
    const score = isOwner ? 100 : remainder + 70;
    const bars = Math.round(score / 10);
    const meter = `[${'='.repeat(bars)}${'-'.repeat(10 - bars)}]`;

    logger?.log('MATH:CUTEMETER', `Computed cuteness score for user ${cutie.username} (${cutie.id})`, {
      userIdBigInt: cutie.id,
      isOwnerOverride: isOwner,
      mod31Remainder: remainder,
      computedScore: score,
      filledBars: bars,
      meter
    });
    logger?.explainSuccess(`Calculated ${score}% cuteness score for ${cutie.username}.`);

    let verdict = `Certified adorable! Deserves unlimited headpats ${pick('headpat', logger)}`;
    if (score >= 95) verdict = `MAXIMUM OVERLOAD!! Certified pastel thigh-high & oversized-hoodie icon!! ${pick('online', logger)}`;
    else if (score >= 85) verdict = `Super fluffy & dangerously cute! Extra snuggles required ${pick('snuggle', logger)}`;

    return {
      embeds: [{
        title: `Official Paw & Thigh-High Cute Meter~ ${pick('cute', logger)}`,
        description: `*ears perk up and scanner beeps happily!*\n\n**Target:** <@${cutie.id}>\n**Cuteness Score:** **${score}%** \`${meter}\`\n**Verdict:** ${verdict}\n\n[emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_PINK,
        thumbnail: { url: cutie.displayAvatarURL({ size: 256 }) }
      }]
    };
  }

  if (commandName === 'ship') {
    let c1 = params.cutie;
    let c2 = params.cutie2;
    if (!c1) {
      c1 = interaction.user;
      logger?.log('CMD:SHIP_FALLBACK', `cutie1 not provided; defaulting to invoker ${c1.username} (${c1.id})`);
    }
    if (!c2) {
      c2 = client.user || interaction.user;
      logger?.log('CMD:SHIP_FALLBACK', `cutie2 not provided; defaulting to ${c2.username} (${c2.id})`);
    }

    const split1 = Math.ceil(c1.username.length / 2);
    const split2 = Math.floor(c2.username.length / 2);
    const name1 = c1.username.slice(0, split1);
    const name2 = c2.username.slice(split2);
    const shipName = `${name1}${name2}`;
    const combined = BigInt(c1.id) + BigInt(c2.id);
    const mod41 = Number(combined % 41n);
    const score = mod41 + 60;

    logger?.log('MATH:SHIP', `Calculated ship compatibility and combined name`, {
      user1: `${c1.username} (${c1.id})`,
      user2: `${c2.username} (${c2.id})`,
      shipName,
      finalScore: score
    });
    logger?.explainSuccess(`Paired ${c1.username} + ${c2.username} ("${shipName}") at ${score}% compatibility.`);

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

  if (commandName === '8ball') {
    let question = params.question;
    if (!question) {
      question = 'Will I get extra headpats and cozy snuggles today?';
      logger?.log('CMD:8BALL_FALLBACK', `No question provided; using default diagnostic question="${question}"`);
    }
    const replies = [
      `Yeeeesss, 100%!! ${pick('online', logger)}`,
      `My ears perked up—signs point to yes, uwu~ :3`,
      `Definitely!! Treat yourself to extra headpats too ^w^`,
      `Hmm... ask again after a cozy nap and some snuggles~ (－_－) zzZ`,
      `My tail says maybe! Let's see how the vibes go~ ${pick('cute', logger)}`,
      `Awr, doesn't look like it right now >_<`,
      `Nuh-uh, my paws say no this time! ${pick('blush', logger)}`
    ];
    const idx = Math.floor(Math.random() * replies.length);
    const answer = replies[idx];

    logger?.log('RNG:8BALL', `Rolled 8-ball crystal ball response`, { question, answer });
    logger?.explainSuccess(`Picked 8-ball reply #${idx + 1} out of ${replies.length}.`);

    return {
      embeds: [{
        title: `Pastel Catboy 8-Ball~ ${pick('cute', logger)}`,
        description: `*shakes paws and peers into a glowing pink crystal ball*\n\n**Question:** ${question}\n**Answer:** **${answer}**\n\n[emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_LAVENDER
      }]
    };
  }

  if (commandName === 'lovecount') {
    let cutie = params.cutie;
    if (!cutie) {
      cutie = interaction.user;
      logger?.log('CMD:LOVECOUNT_FALLBACK', `No target cutie provided; defaulting to invoker ${cutie.username} (${cutie.id})`);
    }
    const key = `${interaction.user.id}->${cutie.id}`;
    const count = affectionCounts.get(key) || 0;
    logger?.log('STATE:LOOKUP', `Looked up affection count in affectionCounts map`, {
      lookupKey: key,
      foundValue: count
    });
    logger?.explainSuccess(`Looked up your affection count with ${cutie.username} (${count} total).`);

    return {
      embeds: [{
        title: `Affection Meter~ ${pick('affection', logger)}`,
        description: `*tail wags happily!*\n\n<@${interaction.user.id}> has shared affection with <@${cutie.id}> **${count}** time${count === 1 ? '' : 's'}! ${pick('cute', logger)}\n\n[emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_PINK,
        thumbnail: { url: cutie.displayAvatarURL({ size: 256 }) }
      }]
    };
  }

  if (commandName === 'avatar') {
    const rawInput = params.user_id || (params.cutie ? params.cutie.id : null);
    const rawId = rawInput ? rawInput.replace(/[<@!>]/g, '').trim() : interaction.user.id;
    logger?.log('CMD:AVATAR', `Resolving full user profile & assets`, { rawInput, sanitizedSnowflakeId: rawId });

    try {
      const t0 = performance.now();
      const fullUser = await client.users.fetch(rawId, { force: true });
      const latencyMs = (performance.now() - t0).toFixed(2);
      const avatarUrl = fullUser.displayAvatarURL({ size: 512 });
      const bannerUrl = fullUser.bannerURL({ size: 1024 });
      const decoUrl = fullUser.avatarDecorationURL({ size: 512 });

      logger?.log('DISCORD:USER_ASSETS', `Fetched user profile in ${latencyMs}ms`, {
        id: fullUser.id,
        username: fullUser.username,
        avatarUrl,
        bannerUrl: bannerUrl || null,
        decoUrl: decoUrl || null
      });
      logger?.explainSuccess(`Fetched ${fullUser.username}'s avatar${bannerUrl ? ', banner,' : ''} and profile details in ${latencyMs}ms.`);

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
        components: buildAssetButtons(avatarUrl, bannerUrl, decoUrl, fullUser.id, logger)
      };
    } catch (err) {
      logger?.log('DISCORD:USER_ERR', `Failed to fetch user with ID "${rawId}"`, {
        error: err?.message || String(err)
      });
      logger?.explainIssue(`Discord couldn't find any account with User ID \`${rawId}\` (${err?.message || 'Unknown User'}).`);
      return {
        content: `Awr~ I couldn’t find anyone with that ID! Make sure Developer Mode is on and copy the numeric User ID, >_<`
      };
    }
  }

  if (commandName === 'stats') {
    const uptimeSec = Math.floor(process.uptime());
    const mins = Math.floor(uptimeSec / 60);
    const hrs = Math.floor(mins / 60);
    const mem = process.memoryUsage();
    logger?.log('CMD:STATS', `Collected runtime & bot telemetry`, {
      wsPingMs: client.ws.ping,
      uptimeSec,
      totalAffectionDelivered,
      rssMB: (mem.rss / 1048576).toFixed(2)
    });
    logger?.explainSuccess(`Bot is online with ${client.ws.ping}ms Discord ping and ${hrs}h ${mins % 60}m uptime.`);

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
  logger?.log('EXEC:UNKNOWN_CMD', `Unrecognized command "${commandName}"`, {
    requestedCommand: commandName,
    supportedCommands: validList
  });
  logger?.explainIssue(`\`/${commandName}\` isn't a valid command on this bot! Valid commands you can test are: \`${validList}\`.`);
  return {
    content: `Awr~ Unknown command \`/${commandName}\`! >_<\nAvailable commands to run with \`/log\`: \`${validList}\` :3`
  };
}

// Handle Slash Commands & Interactive Buttons
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Handle "Roll Again" button for /e621
    if (interaction.isButton() && interaction.customId.startsWith('e621:')) {
      const [, order, ...tagParts] = interaction.customId.split(':');
      const rawTags = tagParts.join(':');
      await interaction.deferReply();

      const post = await fetchE621Post(rawTags, order || 'random');
      if (!post) {
        return interaction.editReply(`Awr~ Couldn't find another e621 post for \`${rawTags || 'those tags'}\` right now! >_<`);
      }
      await interaction.editReply(buildE621Response(post, rawTags, order || 'random'));
      return;
    }

    // Handle "Return the Affection" Button Clicks!
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

    // /log — Run any command and print a Plain-English Diagnosis + verbose logs!
    if (interaction.commandName === 'log') {
      const deferStart = performance.now();
      await interaction.deferReply();

      const logger = new VerboseLogger(true);
      const memStart = process.memoryUsage();

      logger.log('INIT', `Initialized verbose logger for /log`, {
        interactionId: interaction.id,
        user: `${interaction.user.tag} (${interaction.user.id})`,
        guildId: interaction.guildId || 'DM',
        deferMs: (performance.now() - deferStart).toFixed(2)
      });

      logger.log('RUNTIME', `Process & Gateway telemetry snapshot`, {
        nodeVersion: process.version,
        uptimeSec: Math.floor(process.uptime()),
        wsPingMs: client.ws.ping,
        rssMB: (memStart.rss / 1048576).toFixed(2),
        heapUsedMB: (memStart.heapUsed / 1048576).toFixed(2)
      });

      const { targetCommand, params } = await parseLogCommandInput(interaction, logger);
      const resultPayload = await executeBotCommand(targetCommand, params, interaction, logger);

      const memEnd = process.memoryUsage();
      const totalMs = (performance.now() - logger.startTime).toFixed(2);
      logger.log('PAYLOAD:READY', `Command "/${targetCommand}" produced output payload`, {
        hasContent: Boolean(resultPayload.content),
        embedCount: resultPayload.embeds?.length || 0,
        componentRows: resultPayload.components?.length || 0
      });
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

    // Standard direct command execution
    const deferredCommands = ['e621', 'furrypic', 'oc', ...TARGET_ACTIONS, ...SOLO_ACTIONS, 'avatar'];
    const needsDefer = deferredCommands.includes(interaction.commandName);
    if (needsDefer) {
      await interaction.deferReply();
    }

    const directParams = {
      cutie: interaction.options.getUser('cutie') || interaction.options.getUser('cutie1') || null,
      cutie2: interaction.options.getUser('cutie2') || null,
      vibe: interaction.options.getString('vibe') || 'furry',
      tags: interaction.options.getString('tags') || '',
      order: interaction.options.getString('order') || 'random',
      species: interaction.options.getString('species') || 'neko',
      question: interaction.options.getString('question') || null,
      user_id: interaction.options.getString('user_id') || null
    };

    const payload = await executeBotCommand(interaction.commandName, directParams, interaction, null);
    if (needsDefer) {
      await interaction.editReply(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch (err) {
    console.error('Interaction handler error:', err);
    const errMsg = `Awr~ Something went wrong running that command: \`${err?.message || String(err)}\` >_<`.slice(0, 1950);
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
    uptimeSeconds: Math.floor(process.uptime())
  }));
}).listen(PORT, () => {
  console.log(`Health server listening on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
