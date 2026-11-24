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

// Loomie's User ID & Website
const OWNER_ID = '1416390397881749514';
const SITE_URL = 'https://emolarp.fans';
const OC_IMAGE_URL = (process.env.OC_IMAGE_URL || '').trim();

// All 29 of Loomie's Custom Application Emojis
// Tip: If any animated emoji doesn't move in Discord, change '<:' to '<a:' for that one!
const EMOJI = {
  // Batch 2 (Boykisser & Furry Cuddles/Kisses)
  furryHug: '<:furry_hug:1574664122237190194>',
  furryHug1: '<:Furry_hug1:1574664120970641499>',
  furryCuddle: '<:Furry_Cuddle:1574664119489925121>',
  furryKisses: '<:Furry_Kisses:1574664117526986874>',
  femboysMwah: '<:femboys_mwah_kiss_GG_f:1574664116323483752>',
  boykisser: '<:boykisser:1574664113789997137>',
  bkYapping: '<:boykisser_meow_yapping:1574664112343093348>',
  bkWave: '<:boykisser_hi_wave:1574664110967234570>',
  bkHappy: '<:boykisser_happy:1574664109708812399>',
  bkPeek: '<:boykisser_lurk_peek:1574664108249452639>',
  wfBkBlush: '<:WF_boykisser_blush:1574664106802151546>',
  bkBlush: '<:boykisser_blush:1574664105694855169>',

  // Batch 1 (Furry, Femboy & Deer)
  furry: '<:furry:1574663049581699082>',
  bootyShake: '<:Furry_Booty_Shake:1574663048185126932>',
  foxJump: '<:fox_jump_furry:1574663046209605753>',
  dancing: '<:dancing_furry:1574663044758380605>',
  furryAss: '<:furry_ass:1574663043525386290>',
  scream: '<:furry_screm_scream:1574663042136801300>',
  laugh: '<:gif_furry_laugh:1574663040438378506>',
  felix: '<:felix_femboy_reserves_GG:1574663038643085392>',
  femboy: '<:femboy:1574663036680151133>',
  femboy1: '<:femboy1:1574663035518193695>',
  thinking: '<:Femboy_Thinking:1574663034297655396>',
  milk: '<:femboy_milk:1574663033085501500>',
  uchFemboy: '<:UCH_femboy:1574663031311433868>',
  uchHeart: '<:UCH_femboy1:1574663029990363196>',
  rawr: '<:femboy2:1574663028610302004>',
  femboy3: '<:femboy3:1574663027318460557>',
  woof: '<:woof:1574659549699379290>'
};

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

function pick(category) {
  const list = KAOMOJI[category] || KAOMOJI.cute;
  return list[Math.floor(Math.random() * list.length)];
}

const PASTEL_PINK = 0xff99cc;
const PASTEL_PURPLE = 0xc792ea;
const PASTEL_LAVENDER = 0xe0b0ff;

// Fetch SFW media from e621.net Booru API with specified tags!
async function fetchE621Post(rawTags = '', order = 'random') {
  // Strip any explicit/questionable rating overrides so DMs & servers stay strictly SFW (rating:s)
  const cleanedUserTags = rawTags
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t && !t.startsWith('rating:') && !t.startsWith('-rating:') && !t.startsWith('order:'));

  const finalTags = ['rating:s', '-webm', '-swf', ...cleanedUserTags];
  if (order === 'random') finalTags.push('order:random');
  else if (order === 'score') finalTags.push('order:score');

  const query = encodeURIComponent(finalTags.join(' '));
  const url = `https://e621.net/posts.json?limit=25&tags=${query}`;

  try {
    const res = await fetch(url, {
      headers: {
        // e621 requires a descriptive User-Agent header!
        'User-Agent': 'furry-discord-bot/4.5 (by Loomie on GitHub)'
      },
      signal: AbortSignal.timeout(6000)
    });

    if (!res.ok) return null;
    const data = await res.json();
    const validPosts = (data?.posts || []).filter(
      (p) => p?.file?.url && ['jpg', 'jpeg', 'png', 'gif'].includes(p.file.ext?.toLowerCase())
    );

    if (validPosts.length === 0) return null;

    // Pick random from top results when sorting by score/newest, or first from order:random
    const chosen = order === 'random'
      ? validPosts[0]
      : validPosts[Math.floor(Math.random() * Math.min(validPosts.length, 10))];

    const artists = (chosen.tags?.artist || []).filter((a) => a !== 'conditional_dnp').slice(0, 3);
    const species = (chosen.tags?.species || []).slice(0, 4);

    return {
      id: chosen.id,
      imageUrl: chosen.file.url,
      postUrl: `https://e621.net/posts/${chosen.id}`,
      score: chosen.score?.total ?? 0,
      artists: artists.length ? artists.join(', ') : 'Unknown',
      species: species.length ? species.join(', ') : 'Unspecified',
      searchedTags: cleanedUserTags.length ? cleanedUserTags.join(' ') : 'all safe posts'
    };
  } catch {
    return null;
  }
}

// Fetch cute SFW furry/neko/kitsune/okami GIFs from PurrBot & Nekos.best
async function fetchActionGif(action, vibe = 'furry') {
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

  try {
    if (vibe === 'furry' && purrMap[action]) {
      const purrEndpoint = purrMap[action];
      const purrRes = await fetch(`https://api.purrbot.site/v2/img/sfw/${purrEndpoint}/gif`, {
        signal: AbortSignal.timeout(4000)
      });
      if (purrRes.ok) {
        const purrData = await purrRes.json();
        if (purrData?.link) {
          return { url: purrData.link, source: 'PurrBot SFW Furry / Kemonomimi' };
        }
      }
    }

    const endpoint = nekosMap[action] || 'cuddle';
    const res = await fetch(`https://nekos.best/api/v2/${endpoint}`, {
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      const data = await res.json();
      const item = data?.results?.[0];
      if (item?.url) {
        return {
          url: item.url,
          source: item.anime_name ? `Anime: ${item.anime_name}` : 'Nekos.best SFW'
        };
      }
    }
  } catch {
    // Fallback gracefully
  }
  return null;
}

// Fetch random SFW species image/GIF from PurrBot
async function fetchFurrySpecies(species = 'neko') {
  try {
    const res = await fetch(`https://api.purrbot.site/v2/img/sfw/${species}/gif`, {
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.link) return data.link;
    }
    const imgRes = await fetch(`https://api.purrbot.site/v2/img/sfw/${species}/img`, {
      signal: AbortSignal.timeout(4000)
    });
    if (imgRes.ok) {
      const imgData = await imgRes.json();
      if (imgData?.link) return imgData.link;
    }
  } catch {
    // Fallback gracefully
  }
  return null;
}

function buildActionCopy(action, fromId, toId) {
  const copyMap = {
    snuggle: {
      btnEmoji: '1574664119489925121',
      title: `${EMOJI.furryCuddle} Cozy Snuggle Pile~!! ${pick('snuggle')}`,
      text: `*adjusts oversized pastel hoodie & striped thigh-highs, curling up close*\n\n<@${fromId}> wraps <@${toId}> in the warmest, fluffiest snuggles and gentle tail-wraps!! ${EMOJI.femboy1} ${pick('snuggle')}`,
      backLabel: 'Snuggle Back :3'
    },
    hug: {
      btnEmoji: '1574664122237190194',
      title: `${EMOJI.furryHug} Warm Fluffy Hug~!! ${pick('snuggle')}`,
      text: `*opens arms wide and rushes in for a big squeeze*\n\n<@${fromId}> pulls <@${toId}> into the tightest, coziest hug ever!! ${EMOJI.furryHug1} ${pick('snuggle')}`,
      backLabel: 'Hug Back ^w^'
    },
    lick: {
      btnEmoji: '1574664112343093348',
      title: `${EMOJI.bkYapping} Playful Paw & Cheek Lick~ ${pick('affection')}`,
      text: `*ears perk up and tail wags wildly*\n\n<@${fromId}> leans in and gives <@${toId}> a super cute, playful puppy-boy lick right on the cheek!! ${EMOJI.woof} ${pick('affection')}`,
      backLabel: 'Lick Back >w<'
    },
    kiss: {
      btnEmoji: '1574664117526986874',
      title: `${EMOJI.furryKisses} Sweet Pastel Kiss~ ${pick('affection')}`,
      text: `*blushes softly and paws at the air*\n\n<@${fromId}> gives <@${toId}> the sweetest, softest forehead & cheek kiss!! ${EMOJI.femboysMwah} ${pick('affection')}`,
      backLabel: 'Kiss Back uwu'
    },
    headpat: {
      btnEmoji: '1574664109708812399',
      title: `${EMOJI.bkHappy} Cozy Headpat Delivery~!! ${pick('headpat')}`,
      text: `*adjusts striped thigh-highs and reaches up on tiptoes*\n\n<@${fromId}> gives <@${toId}> the softest, warmest headpats and gentle paw-boops!! ${EMOJI.furry} ${pick('headpat')}`,
      backLabel: 'Headpat Back :3'
    },
    earscratch: {
      btnEmoji: '1574659549699379290',
      title: `${EMOJI.woof} Fluffy Ear Scratches~!! ${pick('headpat')}`,
      text: `*gently scritches right behind the ears until the tail thumps happily*\n\n<@${fromId}> gives <@${toId}> the coziest ear scratches ever!! ${EMOJI.bkHappy} ${pick('headpat')}`,
      backLabel: 'Scratch Back ^w^'
    },
    boop: {
      btnEmoji: '1574664108249452639',
      title: `${EMOJI.bkPeek} Soft Paw Snoot-Boop~!! ${pick('playful')}`,
      text: `*reaches out a soft paw pad and gently pokes*\n\n*boop!!* <@${fromId}> boops <@${toId}> right on the nose!! ${EMOJI.boykisser} ${pick('playful')}`,
      backLabel: 'Boop Back >w<'
    },
    bite: {
      btnEmoji: '1574663042136801300',
      title: `${EMOJI.scream} Playful Love-Nibble~ nom! ${pick('playful')}`,
      text: `*ears flatten playfully and leans in close*\n\n*nom~!* <@${fromId}> gives <@${toId}> a gentle, playful little catboy nibble!! ${EMOJI.laugh} ${pick('playful')}`,
      backLabel: 'Nibble Back :3'
    },
    milk: {
      btnEmoji: '1574663033085501500',
      title: `${EMOJI.milk} Fresh Femboy Milk Delivery~ uwu`,
      text: `*paws at the air and slides a frosty glass across the table*\n\n<@${fromId}> shares a sweet glass of ${EMOJI.milk} with <@${toId}> for +100% cozy pastel energy!! ${pick('cute')}`,
      backLabel: 'Share Back :3'
    },
    bonk: {
      btnEmoji: '1574663042136801300',
      title: `${EMOJI.scream} Playful Paw Bonk~!! >_<`,
      text: `*bonk!!* <@${fromId}> gives <@${toId}> a soft, playful paw-bonk on the head!! ${EMOJI.laugh} ${pick('playful')}`,
      backLabel: 'Bonk Back >w<'
    }
  };
  return copyMap[action];
}

function buildAssetButtons(avatarUrl, bannerUrl, decoUrl, profileUserId = null) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('View PFP :3')
      .setEmoji('1574664113789997137')
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
        .setEmoji('1574659549699379290')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/users/${profileUserId}`)
    );
  }
  return [row];
}

const addVibeOption = (opt) =>
  opt
    .setName('vibe')
    .setDescription('Pick furry/neko or anime GIF style! :3')
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
        .setDescription('Pull SFW furry images & GIFs from e621.net using booru tags! :3')
        .addStringOption((opt) =>
          opt
            .setName('tags')
            .setDescription('Space-separated booru tags (e.g. "deer kemonomimi", "fox cuddle") :3')
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
        .setName('emote')
        .setDescription('Send any of Loomie’s 29 custom furry & femboy emojis in chat! :3')
        .addSubcommand((sub) =>
          sub
            .setName('furry')
            .setDescription('Pick from Loomie’s 17 furry, boykisser & deer emojis! :3')
            .addStringOption((opt) =>
              opt
                .setName('pick')
                .setDescription('Choose a furry/boykisser emoji! ^w^')
                .setRequired(true)
                .addChoices(
                  { name: 'furry_hug', value: 'furryHug' },
                  { name: 'Furry_hug1', value: 'furryHug1' },
                  { name: 'Furry_Cuddle', value: 'furryCuddle' },
                  { name: 'Furry_Kisses', value: 'furryKisses' },
                  { name: 'boykisser', value: 'boykisser' },
                  { name: 'boykisser_meow_yapping', value: 'bkYapping' },
                  { name: 'boykisser_hi_wave', value: 'bkWave' },
                  { name: 'boykisser_happy', value: 'bkHappy' },
                  { name: 'boykisser_lurk_peek', value: 'bkPeek' },
                  { name: 'WF_boykisser_blush', value: 'wfBkBlush' },
                  { name: 'boykisser_blush', value: 'bkBlush' },
                  { name: 'woof (deer)', value: 'woof' },
                  { name: 'furry', value: 'furry' },
                  { name: 'dancing_furry', value: 'dancing' },
                  { name: 'fox_jump_furry', value: 'foxJump' },
                  { name: 'furry_screm_scream', value: 'scream' },
                  { name: 'gif_furry_laugh', value: 'laugh' }
                )
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName('femboy')
            .setDescription('Pick from Loomie’s 12 femboy & cheeky emojis! uwu')
            .addStringOption((opt) =>
              opt
                .setName('pick')
                .setDescription('Choose a femboy emoji! :3')
                .setRequired(true)
                .addChoices(
                  { name: 'femboys_mwah_kiss_GG', value: 'femboysMwah' },
                  { name: 'femboy', value: 'femboy' },
                  { name: 'femboy1', value: 'femboy1' },
                  { name: 'femboy2 (rawr :3)', value: 'rawr' },
                  { name: 'femboy3', value: 'femboy3' },
                  { name: 'UCH_femboy', value: 'uchFemboy' },
                  { name: 'UCH_femboy1 (heart)', value: 'uchHeart' },
                  { name: 'Femboy_Thinking', value: 'thinking' },
                  { name: 'femboy_milk', value: 'milk' },
                  { name: 'felix_femboy_reserves_GG', value: 'felix' },
                  { name: 'Furry_Booty_Shake', value: 'bootyShake' },
                  { name: 'furry_ass', value: 'furryAss' }
                )
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
        .setDescription('Share a frosty glass of femboy_milk with a cutie~ uwu')
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
    )
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands }).catch(console.error);
});

// Helper to build an e621 embed + Roll Again / View Post buttons
function buildE621Response(post, rawTags = '', order = 'random') {
  const safeCustomId = `e621:${order}:${rawTags.slice(0, 75)}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(safeCustomId)
      .setLabel('Roll Again :3')
      .setEmoji('1574663049581699082')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setLabel('View on e621 ^w^')
      .setStyle(ButtonStyle.Link)
      .setURL(post.postUrl)
  );

  return {
    embeds: [{
      title: `${EMOJI.furry} e621 Safe Booru Pull~ ${pick('cute')}`,
      description:
        `*ears perk up and tail wags!* Found a fresh SFW post for \`${post.searchedTags}\`! ${EMOJI.bkHappy}\n\n` +
        `• **Artist:** \`${post.artists}\` • **Species:** \`${post.species}\` • **Score:** \`${post.score}\`\n` +
        `• [emolarp.fans](${SITE_URL}) :3`,
      color: PASTEL_PINK,
      image: { url: post.imageUrl },
      footer: { text: `e621.net (rating:s) • Post #${post.id} • paws & thigh-highs certified :3` }
    }],
    components: [row]
  };
}

// Handle Slash Commands & Interactive Buttons
client.on(Events.InteractionCreate, async (interaction) => {
  // Handle "Roll Again" button for /e621
  if (interaction.isButton() && interaction.customId.startsWith('e621:')) {
    const [, order, ...tagParts] = interaction.customId.split(':');
    const rawTags = tagParts.join(':');
    await interaction.deferReply();

    const post = await fetchE621Post(rawTags, order || 'random');
    if (!post) {
      return interaction.editReply(`Awr~ Couldn't find another SFW e621 post for \`${rawTags || 'those tags'}\` right now! >_<`);
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
        description: `${chosen.text}\n\n${EMOJI.uchHeart} *Affection combo with <@${senderId}>: **${count}** time${count === 1 ? '' : 's'}! ^w^* • [emolarp.fans](${SITE_URL})`,
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

  // /e621 — Pull SFW booru images/GIFs from e621.net with custom tags!
  if (interaction.commandName === 'e621') {
    await interaction.deferReply();
    const rawTags = interaction.options.getString('tags') || '';
    const order = interaction.options.getString('order') || 'random';
    const post = await fetchE621Post(rawTags, order);

    if (!post) {
      return interaction.editReply(
        `Awr~ I couldn't find any SFW (\`rating:s\`) image/GIF posts on e621 for \`${rawTags || 'your search'}\`! Try simpler underscore tags like \`deer\`, \`fox cuddle\`, or \`cat_boy\`, >_<`
      );
    }

    await interaction.editReply(buildE621Response(post, rawTags, order));
    return;
  }

  // /emote — Send any of Loomie's 29 custom emojis!
  if (interaction.commandName === 'emote') {
    const key = interaction.options.getString('pick', true);
    const chosenEmoji = EMOJI[key] || EMOJI.boykisser;
    await interaction.reply({ content: chosenEmoji });
    return;
  }

  // /furrypic — Random SFW furry / kemonomimi art & GIF card!
  if (interaction.commandName === 'furrypic') {
    await interaction.deferReply();
    const species = interaction.options.getString('species') || 'neko';
    const mediaUrl = await fetchFurrySpecies(species);
    const labelMap = {
      neko: 'Neko / Catboy',
      kitsune: 'Kitsune / Fox',
      okami: 'Okami / Wolf',
      eevee: 'Eevee',
      holo: 'Wolf Girl'
    };

    await interaction.editReply({
      embeds: [{
        title: `${EMOJI.furry} Random ${labelMap[species] || 'Furry'} Cutie~ ${pick('cute')}`,
        description: `*ears perk up and tail wags happily!* Here is a fresh SFW **${labelMap[species] || species}** card for you, uwu~ ${EMOJI.bkHappy} • [emolarp.fans](${SITE_URL})`,
        color: PASTEL_PINK,
        image: mediaUrl ? { url: mediaUrl } : undefined,
        footer: { text: 'PurrBot SFW • paws & thigh-highs certified :3' }
      }]
    });
    return;
  }

  // /oc — Loomie's Deer OC & Profile Card!
  if (interaction.commandName === 'oc') {
    await interaction.deferReply();
    const loomieUser = await client.users.fetch(OWNER_ID, { force: true }).catch(() => interaction.user);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("Loomie's Profile :3")
        .setEmoji('1574659549699379290')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/users/${OWNER_ID}`),
      new ButtonBuilder()
        .setLabel('emolarp.fans ^w^')
        .setEmoji('1574664113789997137')
        .setStyle(ButtonStyle.Link)
        .setURL(SITE_URL)
    );

    await interaction.editReply({
      embeds: [{
        title: `${EMOJI.woof} Loomie's Deer OC Showcase~ ${pick('cute')}`,
        description:
          `*ears perk up and tail wags happily!* Meet **Loomie** (<@${OWNER_ID}>)'s adorable deer kemonomimi/anthro OC! ${EMOJI.bkWave} ${pick('online')}\n\n` +
          `• **Species:** Cozy Deer Kemonomimi / Anthro ${EMOJI.woof}\n` +
          `• **Signature Fit:** Oversized pastel hoodie, striped thigh-highs, chokers & fluffy animated tail~ ${EMOJI.femboy1}\n` +
          `• **Website:** [emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_PINK,
        thumbnail: { url: loomieUser.displayAvatarURL({ size: 256 }) },
        image: OC_IMAGE_URL ? { url: OC_IMAGE_URL } : undefined,
        footer: { text: `Made with love for Loomie • paws & thigh-highs certified ${pick('cute')}` }
      }],
      components: [row]
    });
    return;
  }

  const targetActions = ['snuggle', 'hug', 'lick', 'kiss', 'headpat', 'earscratch', 'boop', 'bite', 'milk', 'bonk'];
  const soloActions = ['blush', 'tailwag', 'purr', 'howl'];

  // Target Action Commands + "Return Affection" Button + Small Website Link!
  if (targetActions.includes(interaction.commandName)) {
    await interaction.deferReply();
    const action = interaction.commandName;
    const cutie = interaction.options.getUser('cutie', true);
    const vibe = interaction.options.getString('vibe') || 'furry';
    const gif = await fetchActionGif(action, vibe);
    const count = recordAffection(interaction.user.id, cutie.id);
    const chosen = buildActionCopy(action, interaction.user.id, cutie.id);

    const backBtn = new ButtonBuilder()
      .setCustomId(`back:${action}:${interaction.user.id}:${cutie.id}:${vibe}`)
      .setLabel(chosen.backLabel)
      .setEmoji(chosen.btnEmoji)
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(backBtn);

    await interaction.editReply({
      embeds: [{
        title: chosen.title,
        description: `${chosen.text}\n\n${EMOJI.uchHeart} *Combo with <@${cutie.id}>: **${count}** time${count === 1 ? '' : 's'}! ^w^* • [emolarp.fans](${SITE_URL})`,
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
    });
    return;
  }

  // Solo / Optional-Target Reaction Commands (/blush, /tailwag, /purr, /howl)
  if (soloActions.includes(interaction.commandName)) {
    await interaction.deferReply();
    const action = interaction.commandName;
    const cutie = interaction.options.getUser('cutie');
    const vibe = interaction.options.getString('vibe') || 'furry';
    const gif = await fetchActionGif(action, vibe);

    let title = '';
    let description = '';

    if (action === 'blush') {
      title = `${EMOJI.bkBlush} Flustered & Blushing~!! ${pick('blush')}`;
      description = cutie
        ? `*hides face inside oversized pastel hoodie sleeves*\n\n<@${cutie.id}> made <@${interaction.user.id}> blush super bright pink!! ${EMOJI.wfBkBlush} ${pick('blush')} • [emolarp.fans](${SITE_URL})`
        : `*pulls hoodie sleeves over hands and looks away*\n\n<@${interaction.user.id}> is blushing so hard right now, uwu~!! ${EMOJI.wfBkBlush} ${pick('blush')} • [emolarp.fans](${SITE_URL})`;
    } else if (action === 'tailwag') {
      title = `${EMOJI.bkHappy} Happy Tail Wags~!! ${pick('online')}`;
      description = cutie
        ? `*ears perk up straight and tail swishes back and forth at max speed*\n\n<@${interaction.user.id}> is wagging their tail super happily at <@${cutie.id}>!! ${EMOJI.dancing} ${pick('online')} • [emolarp.fans](${SITE_URL})`
        : `*bounces on tiptoes in striped thigh-highs*\n\n<@${interaction.user.id}> can't stop wagging their tail happily!! ${EMOJI.dancing} ${pick('online')} • [emolarp.fans](${SITE_URL})`;
    } else if (action === 'purr') {
      title = `${EMOJI.furryCuddle} Cozy Catboy Purrs~ prrrrr :3`;
      description = cutie
        ? `*curls up in an oversized pastel hoodie and rumbles softly*\n\n<@${interaction.user.id}> is purring happily for <@${cutie.id}>!! ${EMOJI.furry} ${pick('snuggle')} • [emolarp.fans](${SITE_URL})`
        : `*kneads soft paws on a fluffy blanket*\n\n*prrrrrrrr~* <@${interaction.user.id}> is super cozy and purring loudly!! ${EMOJI.furry} ${pick('snuggle')} • [emolarp.fans](${SITE_URL})`;
    } else {
      title = `${EMOJI.woof} Cute Little Awooo~ ^w^`;
      description = cutie
        ? `*tilts head back and perks up fluffy ears*\n\n*awooooooo~!!* <@${interaction.user.id}> lets out a cute little howl with <@${cutie.id}>!! ${EMOJI.foxJump} ${pick('online')} • [emolarp.fans](${SITE_URL})`
        : `*ears perk up and tail wags*\n\n*awooooooo~!!* <@${interaction.user.id}> lets out the cutest little howl!! ${EMOJI.foxJump} ${pick('online')} • [emolarp.fans](${SITE_URL})`;
    }

    await interaction.editReply({
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
    });
    return;
  }

  // /cutemeter
  if (interaction.commandName === 'cutemeter') {
    const cutie = interaction.options.getUser('cutie') || interaction.user;
    const score = cutie.id === OWNER_ID ? 100 : ((Number(BigInt(cutie.id) % 31n)) + 70);
    const bars = Math.round(score / 10);
    const meter = `[${'='.repeat(bars)}${'-'.repeat(10 - bars)}]`;

    let verdict = `${EMOJI.furry} Certified adorable! Deserves unlimited headpats ${pick('headpat')}`;
    if (score >= 95) verdict = `${EMOJI.uchHeart} MAXIMUM OVERLOAD!! Certified pastel thigh-high & oversized-hoodie icon!! ${pick('online')}`;
    else if (score >= 85) verdict = `${EMOJI.furryCuddle} Super fluffy & dangerously cute! Extra snuggles required ${pick('snuggle')}`;

    await interaction.reply({
      embeds: [{
        title: `${EMOJI.boykisser} Official Paw & Thigh-High Cute Meter~ ${pick('cute')}`,
        description: `*ears perk up and scanner beeps happily!*\n\n**Target:** <@${cutie.id}>\n**Cuteness Score:** **${score}%** \`${meter}\`\n**Verdict:** ${verdict}\n\n[emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_PINK,
        thumbnail: { url: cutie.displayAvatarURL({ size: 256 }) }
      }]
    });
    return;
  }

  // /ship
  if (interaction.commandName === 'ship') {
    const c1 = interaction.options.getUser('cutie1', true);
    const c2 = interaction.options.getUser('cutie2', true);
    const name1 = c1.username.slice(0, Math.ceil(c1.username.length / 2));
    const name2 = c2.username.slice(Math.floor(c2.username.length / 2));
    const shipName = `${name1}${name2}`;
    const combined = BigInt(c1.id) + BigInt(c2.id);
    const score = Number(combined % 41n) + 60;

    await interaction.reply({
      embeds: [{
        title: `${EMOJI.furryKisses} Pastel Ship Compatibility~ ${pick('affection')}`,
        description:
          `*paws at the air excitedly!*\n\n` +
          `<@${c1.id}> + <@${c2.id}> = **${shipName}** ${EMOJI.femboysMwah} ${pick('cute')}\n` +
          `**Snuggle Compatibility:** **${score}%**!\n\n` +
          `${score >= 85 ? `*Destined for matching thigh-highs & endless cuddle piles!! ${pick('snuggle')}*` : `*Super sweet duo! Definitely share a hoodie together uwu :3*`}\n\n` +
          `[emolarp.fans](${SITE_URL}) ^w^`,
        color: PASTEL_PURPLE
      }]
    });
    return;
  }

  // /8ball
  if (interaction.commandName === '8ball') {
    const question = interaction.options.getString('question', true);
    const replies = [
      `Yeeeesss, 100%!! ${EMOJI.bkHappy} ${pick('online')}`,
      `My ears perked up—signs point to yes, uwu~ ${EMOJI.woof} :3`,
      `Definitely!! Treat yourself to some ${EMOJI.milk} and extra headpats too ^w^`,
      `Hmm... ask again after a cozy nap and some snuggles~ (－_－) zzZ`,
      `My tail says maybe! Let's see how the vibes go~ ${EMOJI.femboy1} ${pick('cute')}`,
      `Awr, doesn't look like it right now >_<`,
      `Nuh-uh, my paws say no this time! ${EMOJI.bkBlush} ${pick('blush')}`
    ];
    const answer = replies[Math.floor(Math.random() * replies.length)];

    await interaction.reply({
      embeds: [{
        title: `${EMOJI.thinking} Pastel Catboy 8-Ball~ ${pick('cute')}`,
        description: `*shakes paws and peers into a glowing pink crystal ball*\n\n**Question:** ${question}\n**Answer:** **${answer}**\n\n[emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_LAVENDER
      }]
    });
    return;
  }

  // /lovecount
  if (interaction.commandName === 'lovecount') {
    const cutie = interaction.options.getUser('cutie', true);
    const count = affectionCounts.get(`${interaction.user.id}->${cutie.id}`) || 0;
    await interaction.reply({
      embeds: [{
        title: `${EMOJI.uchHeart} Affection Meter~ ${pick('affection')}`,
        description: `*tail wags happily!*\n\n<@${interaction.user.id}> has shared affection with <@${cutie.id}> **${count}** time${count === 1 ? '' : 's'}! ${EMOJI.milk} ${pick('cute')}\n\n[emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_PINK,
        thumbnail: { url: cutie.displayAvatarURL({ size: 256 }) }
      }]
    });
    return;
  }

  // /avatar (with clickable Discord Profile link button + emolarp.fans!)
  if (interaction.commandName === 'avatar') {
    await interaction.deferReply();
    const rawInput = interaction.options.getString('user_id');
    const rawId = rawInput ? rawInput.replace(/[<@!>]/g, '').trim() : interaction.user.id;

    try {
      const fullUser = await client.users.fetch(rawId, { force: true });
      const avatarUrl = fullUser.displayAvatarURL({ size: 512 });
      const bannerUrl = fullUser.bannerURL({ size: 1024 });
      const decoUrl = fullUser.avatarDecorationURL({ size: 512 });

      await interaction.editReply({
        embeds: [{
          title: `${EMOJI.boykisser} ${fullUser.username}'s Lookbook~ ${pick('cute')}`,
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
      });
    } catch {
      await interaction.editReply(`Awr~ I couldn’t find anyone with that ID! Make sure Developer Mode is on and copy the numeric User ID, >_<`);
    }
    return;
  }

  // /stats
  if (interaction.commandName === 'stats') {
    const uptimeSec = Math.floor(process.uptime());
    const mins = Math.floor(uptimeSec / 60);
    const hrs = Math.floor(mins / 60);
    await interaction.reply({
      embeds: [{
        title: `${EMOJI.bkWave} furry Status & Paw-formance~ ${pick('online')}`,
        description: `*tail wags happily!* Built for Loomie—cozy, awake, and ready for snuggles in DMs and servers, uwu~ ${EMOJI.woof}\n\nWebsite: [emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_LAVENDER,
        fields: [
          { name: 'Ping', value: `\`${client.ws.ping}ms\``, inline: true },
          { name: 'Awake For', value: `\`${hrs}h ${mins % 60}m\``, inline: true },
          { name: 'Total Affection Given', value: `\`${totalAffectionDelivered}\` combos ${EMOJI.uchHeart}`, inline: true }
        ]
      }],
      ephemeral: true
    });
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
