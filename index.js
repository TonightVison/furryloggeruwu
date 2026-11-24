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

// Reliable GIF fetcher with 3-tier fallback (PurrBot Furry -> Nekos.best -> Waifu.pics SFW)
async function fetchActionGif(action, vibe = 'furry') {
  // Verified PurrBot SFW GIF endpoints
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

  // Verified Nekos.best SFW GIF endpoints
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

  // Verified Waifu.pics SFW endpoints as final backup
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

  // 1. Try PurrBot Furry / Kemonomimi first when vibe === 'furry'
  if (vibe === 'furry' && purrMap[action]) {
    try {
      const purrRes = await fetch(`https://api.purrbot.site/v2/img/sfw/${purrMap[action]}/gif`, {
        signal: AbortSignal.timeout(5000)
      });
      if (purrRes.ok) {
        const purrData = await purrRes.json();
        if (purrData?.link && !purrData.error) {
          return { url: purrData.link, source: 'PurrBot Furry / Kemonomimi' };
        }
      }
    } catch {
      // Fall through to backup source
    }
  }

  // 2. Try Nekos.best SFW
  try {
    const endpoint = nekosMap[action] || 'cuddle';
    const res = await fetch(`https://nekos.best/api/v2/${endpoint}`, {
      signal: AbortSignal.timeout(5000)
    });
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
  } catch {
    // Fall through to final backup
  }

  // 3. Final backup: Waifu.pics SFW
  try {
    const wEndpoint = waifuMap[action] || 'hug';
    const wRes = await fetch(`https://api.waifu.pics/sfw/${wEndpoint}`, {
      signal: AbortSignal.timeout(5000)
    });
    if (wRes.ok) {
      const wData = await wRes.json();
      if (wData?.url) {
        return { url: wData.url, source: 'Waifu.pics SFW' };
      }
    }
  } catch {
    // All sources unreachable
  }

  return null;
}

// Fetch random SFW species image/GIF from PurrBot with Nekos.best fallback
async function fetchFurrySpecies(species = 'neko') {
  try {
    const res = await fetch(`https://api.purrbot.site/v2/img/sfw/${species}/gif`, {
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.link && !data.error) return data.link;
    }
    const imgRes = await fetch(`https://api.purrbot.site/v2/img/sfw/${species}/img`, {
      signal: AbortSignal.timeout(5000)
    });
    if (imgRes.ok) {
      const imgData = await imgRes.json();
      if (imgData?.link && !imgData.error) return imgData.link;
    }
  } catch {
    // Fall through
  }

  // Fallback to Nekos.best
  try {
    const fallbackEndpoint = ['kitsune', 'okami', 'holo'].includes(species) ? 'kitsune' : 'neko';
    const nbRes = await fetch(`https://nekos.best/api/v2/${fallbackEndpoint}`, {
      signal: AbortSignal.timeout(5000)
    });
    if (nbRes.ok) {
      const nbData = await nbRes.json();
      if (nbData?.results?.[0]?.url) return nbData.results[0].url;
    }
  } catch {
    // Ignore
  }

  return null;
}

// Fetch SFW media from e621.net Booru API with specified tags
async function fetchE621Post(rawTags = '', order = 'random') {
  const cleanedUserTags = rawTags
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t && !t.startsWith('rating:') && !t.startsWith('-rating:') && !t.startsWith('order:'));

  const finalTags = ['-webm', '-swf', ...cleanedUserTags];
  if (order === 'random') finalTags.push('order:random');
  else if (order === 'score') finalTags.push('order:score');

  const query = encodeURIComponent(finalTags.join(' '));
  const url = `https://e621.net/posts.json?limit=25&tags=${query}`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'furry-discord-bot/4.6 (by Loomie on GitHub)'
      },
      signal: AbortSignal.timeout(6000)
    });

    if (!res.ok) return null;
    const data = await res.json();
    const validPosts = (data?.posts || []).filter(
      (p) => p?.file?.url && ['jpg', 'jpeg', 'png', 'gif'].includes(p.file.ext?.toLowerCase())
    );

    if (validPosts.length === 0) return null;

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

function buildActionCopy(action, fromId, toId) {
  const copyMap = {
    snuggle: {
      title: `Cozy Snuggle Pile~!! ${pick('snuggle')}`,
      text: `*adjusts oversized pastel hoodie & striped thigh-highs, curling up close*\n\n<@${fromId}> wraps <@${toId}> in the warmest, fluffiest snuggles and gentle tail-wraps!! ${pick('snuggle')}`,
      backLabel: 'Snuggle Back :3'
    },
    hug: {
      title: `Warm Fluffy Hug~!! ${pick('snuggle')}`,
      text: `*opens arms wide and rushes in for a big squeeze*\n\n<@${fromId}> pulls <@${toId}> into the tightest, coziest hug ever!! ${pick('snuggle')}`,
      backLabel: 'Hug Back ^w^'
    },
    lick: {
      title: `Playful Paw & Cheek Lick~ ${pick('affection')}`,
      text: `*ears perk up and tail wags wildly*\n\n<@${fromId}> leans in and gives <@${toId}> a super cute, playful puppy-boy lick right on the cheek!! ${pick('affection')}`,
      backLabel: 'Lick Back >w<'
    },
    kiss: {
      title: `Sweet Pastel Kiss~ ${pick('affection')}`,
      text: `*blushes softly and paws at the air*\n\n<@${fromId}> gives <@${toId}> the sweetest, softest forehead & cheek kiss!! ${pick('affection')}`,
      backLabel: 'Kiss Back uwu'
    },
    headpat: {
      title: `Cozy Headpat Delivery~!! ${pick('headpat')}`,
      text: `*adjusts striped thigh-highs and reaches up on tiptoes*\n\n<@${fromId}> gives <@${toId}> the softest, warmest headpats and gentle paw-boops!! ${pick('headpat')}`,
      backLabel: 'Headpat Back :3'
    },
    earscratch: {
      title: `Fluffy Ear Scratches~!! ${pick('headpat')}`,
      text: `*gently scritches right behind the ears until the tail thumps happily*\n\n<@${fromId}> gives <@${toId}> the coziest ear scratches ever!! ${pick('headpat')}`,
      backLabel: 'Scratch Back ^w^'
    },
    boop: {
      title: `Soft Paw Snoot-Boop~!! ${pick('playful')}`,
      text: `*reaches out a soft paw pad and gently pokes*\n\n*boop!!* <@${fromId}> boops <@${toId}> right on the nose!! ${pick('playful')}`,
      backLabel: 'Boop Back >w<'
    },
    bite: {
      title: `Playful Love-Nibble~ nom! ${pick('playful')}`,
      text: `*ears flatten playfully and leans in close*\n\n*nom~!* <@${fromId}> gives <@${toId}> a gentle, playful little catboy nibble!! ${pick('playful')}`,
      backLabel: 'Nibble Back :3'
    },
    milk: {
      title: `Fresh Cozy Milk Delivery~ uwu ${pick('cute')}`,
      text: `*paws at the air and slides a frosty glass across the table*\n\n<@${fromId}> shares a sweet glass of milk with <@${toId}> for +100% cozy pastel energy!! ${pick('cute')}`,
      backLabel: 'Share Back :3'
    },
    bonk: {
      title: `Playful Paw Bonk~!! >_<`,
      text: `*bonk!!* <@${fromId}> gives <@${toId}> a soft, playful paw-bonk on the head!! ${pick('playful')}`,
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
        .setURL(`https://discord.com/users/${profileUserId}`)
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
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setLabel('View on e621 ^w^')
      .setStyle(ButtonStyle.Link)
      .setURL(post.postUrl)
  );

  return {
    embeds: [{
      title: `e621 Safe Booru Pull~ ${pick('cute')}`,
      description:
        `*ears perk up and tail wags!* Found a fresh SFW post for \`${post.searchedTags}\`! ${pick('online')}\n\n` +
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
        title: `Random ${labelMap[species] || 'Furry'} Cutie~ ${pick('cute')}`,
        description: `*ears perk up and tail wags happily!* Here is a fresh SFW **${labelMap[species] || species}** card for you, uwu~ ${pick('online')} • [emolarp.fans](${SITE_URL})`,
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
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/users/${OWNER_ID}`),
      new ButtonBuilder()
        .setLabel('emolarp.fans ^w^')
        .setStyle(ButtonStyle.Link)
        .setURL(SITE_URL)
    );

    await interaction.editReply({
      embeds: [{
        title: `Loomie's Deer OC Showcase~ ${pick('cute')}`,
        description:
          `*ears perk up and tail wags happily!* Meet **Loomie** (<@${OWNER_ID}>)'s adorable deer kemonomimi/anthro OC! ${pick('online')}\n\n` +
          `• **Species:** Cozy Deer Kemonomimi / Anthro\n` +
          `• **Signature Fit:** Oversized pastel hoodie, striped thigh-highs, chokers & fluffy animated tail~\n` +
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
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(backBtn);

    await interaction.editReply({
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
      title = `Flustered & Blushing~!! ${pick('blush')}`;
      description = cutie
        ? `*hides face inside oversized pastel hoodie sleeves*\n\n<@${cutie.id}> made <@${interaction.user.id}> blush super bright pink!! ${pick('blush')} • [emolarp.fans](${SITE_URL})`
        : `*pulls hoodie sleeves over hands and looks away*\n\n<@${interaction.user.id}> is blushing so hard right now, uwu~!! ${pick('blush')} • [emolarp.fans](${SITE_URL})`;
    } else if (action === 'tailwag') {
      title = `Happy Tail Wags~!! ${pick('online')}`;
      description = cutie
        ? `*ears perk up straight and tail swishes back and forth at max speed*\n\n<@${interaction.user.id}> is wagging their tail super happily at <@${cutie.id}>!! ${pick('online')} • [emolarp.fans](${SITE_URL})`
        : `*bounces on tiptoes in striped thigh-highs*\n\n<@${interaction.user.id}> can't stop wagging their tail happily!! ${pick('online')} • [emolarp.fans](${SITE_URL})`;
    } else if (action === 'purr') {
      title = `Cozy Catboy Purrs~ prrrrr :3`;
      description = cutie
        ? `*curls up in an oversized pastel hoodie and rumbles softly*\n\n<@${interaction.user.id}> is purring happily for <@${cutie.id}>!! ${pick('snuggle')} • [emolarp.fans](${SITE_URL})`
        : `*kneads soft paws on a fluffy blanket*\n\n*prrrrrrrr~* <@${interaction.user.id}> is super cozy and purring loudly!! ${pick('snuggle')} • [emolarp.fans](${SITE_URL})`;
    } else {
      title = `Cute Little Awooo~ ^w^`;
      description = cutie
        ? `*tilts head back and perks up fluffy ears*\n\n*awooooooo~!!* <@${interaction.user.id}> lets out a cute little howl with <@${cutie.id}>!! ${pick('online')} • [emolarp.fans](${SITE_URL})`
        : `*ears perk up and tail wags*\n\n*awooooooo~!!* <@${interaction.user.id}> lets out the cutest little howl!! ${pick('online')} • [emolarp.fans](${SITE_URL})`;
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

    let verdict = `Certified adorable! Deserves unlimited headpats ${pick('headpat')}`;
    if (score >= 95) verdict = `MAXIMUM OVERLOAD!! Certified pastel thigh-high & oversized-hoodie icon!! ${pick('online')}`;
    else if (score >= 85) verdict = `Super fluffy & dangerously cute! Extra snuggles required ${pick('snuggle')}`;

    await interaction.reply({
      embeds: [{
        title: `Official Paw & Thigh-High Cute Meter~ ${pick('cute')}`,
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
        title: `Pastel Ship Compatibility~ ${pick('affection')}`,
        description:
          `*paws at the air excitedly!*\n\n` +
          `<@${c1.id}> + <@${c2.id}> = **${shipName}** ${pick('cute')}\n` +
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
      `Yeeeesss, 100%!! ${pick('online')}`,
      `My ears perked up—signs point to yes, uwu~ :3`,
      `Definitely!! Treat yourself to extra headpats too ^w^`,
      `Hmm... ask again after a cozy nap and some snuggles~ (－_－) zzZ`,
      `My tail says maybe! Let's see how the vibes go~ ${pick('cute')}`,
      `Awr, doesn't look like it right now >_<`,
      `Nuh-uh, my paws say no this time! ${pick('blush')}`
    ];
    const answer = replies[Math.floor(Math.random() * replies.length)];

    await interaction.reply({
      embeds: [{
        title: `Pastel Catboy 8-Ball~ ${pick('cute')}`,
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
        title: `Affection Meter~ ${pick('affection')}`,
        description: `*tail wags happily!*\n\n<@${interaction.user.id}> has shared affection with <@${cutie.id}> **${count}** time${count === 1 ? '' : 's'}! ${pick('cute')}\n\n[emolarp.fans](${SITE_URL}) :3`,
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
          title: `${fullUser.username}'s Lookbook~ ${pick('cute')}`,
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
        title: `furry Status & Paw-formance~ ${pick('online')}`,
        description: `*tail wags happily!* Built for Loomie—cozy, awake, and ready for snuggles in DMs and servers, uwu~\n\nWebsite: [emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_LAVENDER,
        fields: [
          { name: 'Ping', value: `\`${client.ws.ping}ms\``, inline: true },
          { name: 'Awake For', value: `\`${hrs}h ${mins % 60}m\``, inline: true },
          { name: 'Total Affection Given', value: `\`${totalAffectionDelivered}\` combos ${pick('affection')}`, inline: true }
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
