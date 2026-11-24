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

const OWNER_ID = '1416390397881749514';
const SITE_URL = 'https://emolarp.fans';
const OC_IMAGE_URL = (process.env.OC_IMAGE_URL || '').trim();
const PASTEL_PINK = 0xff99cc;
const PASTEL_PURPLE = 0xc792ea;
const PASTEL_LAVENDER = 0xe0b0ff;

const affectionCounts = new Map();
let totalAffectionDelivered = 0;
let lastE621Query = { tags: '', order: 'newest', rating: 'nsfw', ranAt: null };
const recentE621Posts = new Map();

const DEFAULT_BLACKLIST = [
  'gore', 'scat', 'feces', 'feral', 'watersports', 'urine',
  'vomit', 'snuff', 'death', 'young', 'cub', 'loli', 'shota', 'torture'
];

const POPULAR_TAGS = [
  'dragon', 'scalie', 'wolf', 'fox', 'canine', 'feline', 'cat', 'dog',
  'deer', 'otter', 'tiger', 'leopard', 'cheetah', 'lion', 'bear',
  'hyena', 'sergal', 'protogen', 'raccoon', 'rabbit', 'bunny', 'bat',
  'shark', 'avian', 'bird', 'kobold', 'fennec', 'red_panda', 'coyote',
  'jackal', 'pokemon', 'digimon', 'anthro', 'taur', 'femboy', 'tomboy',
  'maid', 'kemonomimi', 'furry', 'cute', 'fluffy', 'muscular', 'chubby',
  'thick_thighs', 'striped_thigh_highs', 'thigh_highs', 'collar', 'choker',
  'bell_collar', 'harness', 'leash', 'hoodie', 'cuddle', 'snuggle', 'hug',
  'kiss', 'bed', 'cozy', 'paws', 'toe_beans', 'tail', 'tail_wagging',
  'blush', 'loving', 'happy', 'smile', 'solo', 'duo', 'group', 'male',
  'female', 'male/male', 'male/female', 'order:score', 'order:favcount',
  'order:rank', 'animated', 'video', 'high_res', 'digital_media_(artwork)'
];

const KAOMOJI = {
  online: ['ฅ^•ﻌ•^ฅ', '(=^･ω･^=)', '(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧', '(≧◡≦)', '(=^･ｪ･^=)', '٩(◕‿◕｡)۶'],
  cute: ['(｡･ω･｡)', '(´｡• ᵕ •｡`)', '(=①ω①=)', '(●´ω｀●)', 'ﾐ・ﻌ・ﾐ', '/ᐠ｡ꞈ｡ᐟ\\'],
  snuggle: ['(つ≧▽≦)つ', '(づ｡◕‿‿◕｡)づ', '(⊃｡•́‿•̀｡)⊃', '(´,,•ω•,,)', '(* ^ ω ^)'],
  headpat: ['(´･･)ﾉ(._.`)', '(っ´ω`)ﾉ(╥ω╥)', '(づ｡◕‿‿◕｡)づ', 'ฅ^•ﻌ•^ฅ'],
  affection: ['(っ˘з(˘⌣˘ )', '(｡・//ε//・｡)', '(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)', '(´ε｀ )♡', '(*≧ω≦*)', '(´▽`ʃ♡ƪ)'],
  playful: ['(=`ω´=)', '(・`ω´・)', 'ฅ^•ﻌ•^ฅ', '(≧◡≦)', '(*≧ω≦*)'],
  blush: ['(｡・//ε//・｡)', '(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)', '(*/ω\\)', '(´,,•ω•,,)', '(´｡• ᵕ •｡`)']
};

function pick(category) {
  const list = KAOMOJI[category] || KAOMOJI.cute;
  return list[Math.floor(Math.random() * list.length)];
}

function recordAffection(fromId, toId) {
  totalAffectionDelivered += 1;
  const key = `${fromId}->${toId}`;
  const next = (affectionCounts.get(key) || 0) + 1;
  affectionCounts.set(key, next);
  return next;
}

const PURRBOT_MAP = {
  snuggle: 'cuddle',
  hug: 'hug',
  lick: 'lick',
  kiss: 'kiss',
  headpat: 'pat',
  earscratch: 'pat',
  boop: 'poke',
  bite: 'bite',
  pawhold: 'fluff',
  milk: 'feed',
  bonk: 'slap',
  blush: 'blush',
  tailwag: 'tail',
  purr: 'comfy'
};

async function fetchActionGif(action) {
  if (action === 'howl') {
    try {
      const e6Wolf = await fetchE621Post('wolf howl', 'newest', 'safe');
      if (e6Wolf?.imageUrl) {
        return { url: e6Wolf.imageUrl, source: `e621.net Wolf Howl #${e6Wolf.id} 🐺` };
      }
    } catch {}
    return {
      url: 'https://cdn.purrbot.site/sfw/okami/img/okami_009.jpg',
      source: 'Okami Wolf Awooo 🐺'
    };
  }

  const endpoint = PURRBOT_MAP[action] || 'cuddle';
  try {
    const res = await fetch(`https://api.purrbot.site/v2/img/sfw/${endpoint}/gif`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.json();
      if (data?.link && !data.error) {
        return { url: data.link, source: `PurrBot Furry • ${endpoint} :3` };
      }
    }
  } catch {}

  return {
    url: 'https://cdn.purrbot.site/sfw/cuddle/gif/cuddle_023.gif',
    source: 'Fluffy Snuggle :3'
  };
}

async function fetchFurrySpecies(species = 'neko') {
  const map = {
    neko: 'neko/gif',
    eevee: 'eevee/gif',
    kitsune: 'kitsune/img',
    okami: 'okami/img',
    holo: 'holo/img'
  };
  const path = map[species] || 'neko/gif';
  try {
    const res = await fetch(`https://api.purrbot.site/v2/img/sfw/${path}`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.json();
      if (data?.link && !data.error) return data.link;
    }
  } catch {}
  return 'https://cdn.purrbot.site/sfw/neko/gif/neko_029.gif';
}

function extractE621Media(p) {
  const post = p?.post || p;
  if (!post || typeof post !== 'object' || post.flags?.deleted) return null;

  const md5 = post.files?.meta?.md5 || post.file?.md5;
  const ext = (post.files?.meta?.ext || post.file?.ext || '').toLowerCase();
  if (!md5 || !ext) return null;

  const sampleJpg = post.files?.sample?.jpg || post.sample?.url || null;
  const originalUrl = post.files?.original?.url || post.file?.url || null;
  const cdn = 'https://static1.e621.net/data';
  const sampleCdn = `${cdn}/sample/${md5.slice(0, 2)}/${md5.slice(2, 4)}/${md5}.jpg`;
  const directCdn = `${cdn}/${md5.slice(0, 2)}/${md5.slice(2, 4)}/${md5}.${ext}`;
  const isVideo = ['webm', 'mp4'].includes(ext);

  return {
    post,
    displayUrl: sampleJpg || sampleCdn || directCdn,
    videoUrl: isVideo ? (originalUrl || directCdn) : null,
    isVideo,
    ext
  };
}

async function fetchE621Post(rawTags = '', order = 'newest', rating = 'nsfw', excludeId = null) {
  const cleanedUserTags = rawTags
    .split(/[\s,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t && !t.startsWith('order:') && t !== 'random');

  const queryTags = [];
  for (const t of cleanedUserTags.slice(0, 3)) {
    queryTags.push(t);
  }

  const hasRating = cleanedUserTags.some((t) => t.startsWith('rating:') || t.startsWith('-rating:'));
  if (!hasRating) {
    if (rating === 'nsfw') queryTags.push('-rating:s');
    else if (rating === 'explicit') queryTags.push('rating:e');
    else if (rating === 'safe') queryTags.push('rating:s');
    else if (rating === 'questionable') queryTags.push('rating:q');
  }

  if (order === 'score' && queryTags.length < 5) {
    queryTags.push('order:score');
  }

  const headers = {
    'User-Agent': 'FurryDiscordBot/6.7 (by Loomie on e621; emolarp.fans)',
    'Accept': 'application/json'
  };
  if (process.env.E621_USERNAME && process.env.E621_API_KEY) {
    headers['Authorization'] = `Basic ${Buffer.from(`${process.env.E621_USERNAME.trim()}:${process.env.E621_API_KEY.trim()}`).toString('base64')}`;
  }

  const encodedTags = encodeURIComponent(queryTags.join(' '));
  const urls = [
    `https://e621.net/posts.json?limit=75&tags=${encodedTags}`,
    `https://e621.net/posts/random.json?tags=${encodedTags}`
  ];

  for (const targetUrl of urls) {
    try {
      const res = await fetch(targetUrl, { headers, signal: AbortSignal.timeout(9000) });
      if (!res.ok) continue;
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data?.posts || (data?.post ? [data.post] : (data?.id ? [data] : [])));
      const extracted = list.map(extractE621Media).filter(Boolean);
      if (!extracted.length) continue;

      const valid = extracted.filter(({ post }) => {
        const tagStr = (typeof post.tag_string === 'string' ? post.tag_string : Object.values(post.tags || {}).flat().join(' ')).toLowerCase();
        return !DEFAULT_BLACKLIST.some((bad) => tagStr.includes(bad));
      });

      const pool = valid.length ? valid : extracted;
      let candidates = pool;
      if (excludeId && pool.length > 1) {
        const filtered = pool.filter((p) => String(p.post.id) !== String(excludeId));
        if (filtered.length) candidates = filtered;
      }

      const picked = candidates[Math.floor(Math.random() * candidates.length)];
      const chosen = picked.post;

      let artists = [];
      let species = [];
      if (chosen.tags && typeof chosen.tags === 'object') {
        artists = (chosen.tags.artist || []).filter((a) => a !== 'conditional_dnp').slice(0, 3);
        species = (chosen.tags.species || []).slice(0, 4);
      } else if (Array.isArray(chosen.tags)) {
        species = chosen.tags.filter((t) => ['dragon', 'canine', 'feline', 'wolf', 'fox', 'scalie', 'otter', 'cat', 'dog'].includes(t)).slice(0, 4);
      }

      return {
        id: chosen.id,
        imageUrl: picked.displayUrl,
        videoUrl: picked.videoUrl,
        isVideo: picked.isVideo,
        postUrl: `https://e621.net/posts/${chosen.id}`,
        score: chosen.score?.total ?? chosen.stats?.score?.total ?? chosen.score ?? 0,
        artists: artists.length ? artists.join(', ') : (chosen.uploader_name || chosen.tag_string_artist || 'Artist unknown'),
        species: species.length ? species.join(', ') : (chosen.tag_string_species || 'Furry'),
        searchedTags: cleanedUserTags.length ? cleanedUserTags.join(' ') : 'all posts',
        rating: chosen.rating || 'e',
        ext: picked.ext
      };
    } catch {}
  }
  return null;
}

async function fetchE621PostById(postId) {
  try {
    const headers = {
      'User-Agent': 'FurryDiscordBot/6.7 (by Loomie on e621; emolarp.fans)',
      'Accept': 'application/json'
    };
    if (process.env.E621_USERNAME && process.env.E621_API_KEY) {
      headers['Authorization'] = `Basic ${Buffer.from(`${process.env.E621_USERNAME.trim()}:${process.env.E621_API_KEY.trim()}`).toString('base64')}`;
    }
    const res = await fetch(`https://e621.net/posts/${postId}.json`, { headers, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = await res.json();
    const rawPost = data?.post || data;
    const media = extractE621Media(rawPost);
    if (!media) return null;

    return {
      id: rawPost.id,
      imageUrl: media.displayUrl,
      videoUrl: media.videoUrl,
      isVideo: media.isVideo,
      postUrl: `https://e621.net/posts/${rawPost.id}`,
      score: rawPost.score?.total ?? rawPost.stats?.score?.total ?? 0,
      artists: rawPost.uploader_name || rawPost.tag_string_artist || 'Artist unknown',
      species: rawPost.tag_string_species || 'Furry',
      searchedTags: `post #${rawPost.id}`,
      rating: rawPost.rating || 'e',
      ext: media.ext
    };
  } catch {
    return null;
  }
}

function buildE621Response(post, rawTags = '', order = 'newest', rating = 'nsfw') {
  recentE621Posts.set(String(post.id), post);
  if (recentE621Posts.size > 200) {
    recentE621Posts.delete(recentE621Posts.keys().next().value);
  }

  const buttons = [
    new ButtonBuilder()
      .setCustomId(`e621:${rating}:${order}:${post.id}:${rawTags.slice(0, 50)}`)
      .setLabel('Roll Again :3')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`save:${post.id}`)
      .setLabel('Bookmark 🐾')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setLabel('View on e621.net ^w^')
      .setStyle(ButtonStyle.Link)
      .setURL(post.postUrl)
  ];

  if (post.imageUrl && post.imageUrl.startsWith('http')) {
    buttons.splice(2, 0,
      new ButtonBuilder()
        .setLabel('Open Image 🖼️')
        .setStyle(ButtonStyle.Link)
        .setURL(post.imageUrl)
    );
  }

  if (post.videoUrl && post.videoUrl.startsWith('http')) {
    buttons.push(
      new ButtonBuilder()
        .setLabel('Watch Video 🎥')
        .setStyle(ButtonStyle.Link)
        .setURL(post.videoUrl)
    );
  }

  const ratingLabel = { s: 'Safe (SFW) 🌱', q: 'Questionable 🔥', e: 'Explicit (NSFW) 🔞' }[post.rating] || 'NSFW / Adult 🔞';
  let desc = `*ears perk up and tail wags!* Found a post for \`${post.searchedTags}\`! ${pick('online')}\n\n` +
    `• **Artist:** \`${post.artists}\` • **Species/Tags:** \`${post.species}\` • **Score:** \`${post.score}\` • **Rating:** \`${ratingLabel}\`\n`;

  if (post.isVideo) {
    desc += `• 🎥 **Animated Video:** [Click to Watch (${post.ext.toUpperCase()})](${post.videoUrl || post.postUrl})\n`;
  }
  desc += `• 💡 *Tap **"Roll Again :3"** or click **"Open Image 🖼️"**! :3*\n• [emolarp.fans](${SITE_URL}) :3`;

  const embed = {
    title: `${rating === 'explicit' || rating === 'nsfw' ? 'e621 Adult Booru Pull~' : 'e621 Booru Pull~'} ${pick('cute')}`,
    description: desc,
    color: PASTEL_PINK,
    footer: { text: `e621.net • Post #${post.id} • Rating: ${ratingLabel} • paws certified :3` }
  };

  if (post.imageUrl && post.imageUrl.startsWith('http')) {
    embed.image = { url: post.imageUrl };
  }

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(buttons)]
  };
}

function buildActionCopy(action, fromId, toId) {
  const map = {
    snuggle: {
      title: `Cozy Snuggle Pile~!! ${pick('snuggle')}`,
      text: `<@${fromId}> wraps <@${toId}> in warm, fluffy snuggles and gentle tail-wraps!! ${pick('snuggle')}`,
      backLabel: 'Snuggle Back :3'
    },
    hug: {
      title: `Warm Fluffy Hug~!! ${pick('snuggle')}`,
      text: `<@${fromId}> pulls <@${toId}> into the tightest, coziest hug ever!! ${pick('snuggle')}`,
      backLabel: 'Hug Back ^w^'
    },
    lick: {
      title: `Playful Paw & Cheek Lick~ ${pick('affection')}`,
      text: `<@${fromId}> gives <@${toId}> a playful puppy-boy lick right on the cheek!! ${pick('affection')}`,
      backLabel: 'Lick Back >w<'
    },
    kiss: {
      title: `Sweet Pastel Kiss~ ${pick('affection')}`,
      text: `<@${fromId}> gives <@${toId}> the sweetest, softest forehead & cheek kiss!! ${pick('affection')}`,
      backLabel: 'Kiss Back uwu'
    },
    headpat: {
      title: `Cozy Headpat Delivery~!! ${pick('headpat')}`,
      text: `<@${fromId}> gives <@${toId}> the softest headpats and gentle paw-boops!! ${pick('headpat')}`,
      backLabel: 'Headpat Back :3'
    },
    earscratch: {
      title: `Fluffy Ear Scratches~!! ${pick('headpat')}`,
      text: `<@${fromId}> gives <@${toId}> cozy ear scratches until their tail thumps happily!! ${pick('headpat')}`,
      backLabel: 'Scratch Back ^w^'
    },
    boop: {
      title: `Soft Paw Snoot-Boop~!! ${pick('playful')}`,
      text: `*boop!!* <@${fromId}> boops <@${toId}> right on the nose with a soft paw pad!! ${pick('playful')}`,
      backLabel: 'Boop Back >w<'
    },
    bite: {
      title: `Playful Love-Nibble~ nom! ${pick('playful')}`,
      text: `*nom~!* <@${fromId}> gives <@${toId}> a gentle, playful little love-nibble!! ${pick('playful')}`,
      backLabel: 'Nibble Back :3'
    },
    pawhold: {
      title: `Gentle Paw-Holding~ ${pick('affection')}`,
      text: `<@${fromId}> gently holds <@${toId}>'s soft paws and gives them a warm squeeze!! ${pick('affection')}`,
      backLabel: 'Hold Paws Back uwu'
    },
    milk: {
      title: `Fresh Cozy Milk Delivery~ uwu ${pick('cute')}`,
      text: `<@${fromId}> shares a sweet glass of milk with <@${toId}> for +100% cozy energy!! ${pick('cute')}`,
      backLabel: 'Share Back :3'
    },
    bonk: {
      title: `Playful Squeaky-Toy Bonk~!! ⭐`,
      text: `*squeak-bonk!!* <@${fromId}> gives <@${toId}> a playful toy-hammer bonk on the noggin!! ⭐ ${pick('playful')}`,
      backLabel: 'Bonk Back >w<'
    }
  };
  return map[action];
}

function addVibeOption(opt) {
  return opt.setName('vibe').setDescription('Choose vibe: furry or anime :3').setRequired(false)
    .addChoices({ name: 'Furry :3', value: 'furry' }, { name: 'Anime ^w^', value: 'anime' });
}

function buildCommandJson(builder, forEverywhere = true) {
  if (!forEverywhere) return builder.toJSON();
  return builder
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
    .toJSON();
}

function getCommandDefinitions(forEverywhere = true) {
  const builders = [
    new SlashCommandBuilder().setName('e621').setDescription('Pull furry art & GIFs directly from e621.net! :3')
      .addStringOption((opt) => opt.setName('tags').setDescription('Tags to search (e.g. "dragon", "fox cuddle")').setAutocomplete(true).setRequired(false))
      .addStringOption((opt) => opt.setName('rating').setDescription('Content rating (Defaults to NSFW)').setRequired(false)
        .addChoices({ name: '🔞 NSFW / Adult (Default)', value: 'nsfw' }, { name: '🔥 Explicit Only', value: 'explicit' }, { name: '🌱 Safe / SFW Only', value: 'safe' }, { name: '✨ All Ratings', value: 'all' }))
      .addStringOption((opt) => opt.setName('order').setDescription('Sort results').setRequired(false)
        .addChoices({ name: 'Newest uwu', value: 'newest' }, { name: 'Top Score ^w^', value: 'score' })),

    new SlashCommandBuilder().setName('yiff').setDescription('Instant explicit furry booru search! 🔥')
      .addStringOption((opt) => opt.setName('tags').setDescription('Tags to search').setAutocomplete(true).setRequired(false))
      .addStringOption((opt) => opt.setName('order').setDescription('Sort results').setRequired(false)
        .addChoices({ name: 'Newest uwu', value: 'newest' }, { name: 'Top Score ^w^', value: 'score' })),

    new SlashCommandBuilder().setName('oc').setDescription('Meet Loomie’s deer OC & website! :3'),
    new SlashCommandBuilder().setName('furrypic').setDescription('Get a cute SFW furry GIF or art card! :3')
      .addStringOption((opt) => opt.setName('species').setDescription('Species vibe').setRequired(false)
        .addChoices({ name: 'Neko :3', value: 'neko' }, { name: 'Kitsune ^w^', value: 'kitsune' }, { name: 'Okami uwu', value: 'okami' }, { name: 'Eevee >w<', value: 'eevee' }, { name: 'Holo :3', value: 'holo' })),

    new SlashCommandBuilder().setName('snuggle').setDescription('Wrap a cutie in cozy snuggles!').addUserOption((o) => o.setName('cutie').setDescription('Target').setRequired(true)).addStringOption(addVibeOption),
    new SlashCommandBuilder().setName('hug').setDescription('Give a big warm fluffy hug!').addUserOption((o) => o.setName('cutie').setDescription('Target').setRequired(true)).addStringOption(addVibeOption),
    new SlashCommandBuilder().setName('lick').setDescription('Give a cutie a playful lick!').addUserOption((o) => o.setName('cutie').setDescription('Target').setRequired(true)).addStringOption(addVibeOption),
    new SlashCommandBuilder().setName('kiss').setDescription('Give a cutie a sweet kiss!').addUserOption((o) => o.setName('cutie').setDescription('Target').setRequired(true)).addStringOption(addVibeOption),
    new SlashCommandBuilder().setName('headpat').setDescription('Give a cutie cozy headpats!').addUserOption((o) => o.setName('cutie').setDescription('Target').setRequired(true)).addStringOption(addVibeOption),
    new SlashCommandBuilder().setName('earscratch').setDescription('Scratch behind fluffy ears!').addUserOption((o) => o.setName('cutie').setDescription('Target').setRequired(true)).addStringOption(addVibeOption),
    new SlashCommandBuilder().setName('boop').setDescription('Boop a cutie right on the snoot!').addUserOption((o) => o.setName('cutie').setDescription('Target').setRequired(true)).addStringOption(addVibeOption),
    new SlashCommandBuilder().setName('bite').setDescription('Give a cutie a playful love-nibble!').addUserOption((o) => o.setName('cutie').setDescription('Target').setRequired(true)).addStringOption(addVibeOption),
    new SlashCommandBuilder().setName('pawhold').setDescription('Hold a cutie’s soft paws gently!').addUserOption((o) => o.setName('cutie').setDescription('Target').setRequired(true)).addStringOption(addVibeOption),
    new SlashCommandBuilder().setName('milk').setDescription('Share a frosty glass of milk!').addUserOption((o) => o.setName('cutie').setDescription('Target').setRequired(true)).addStringOption(addVibeOption),
    new SlashCommandBuilder().setName('bonk').setDescription('Give a playful squeaky-toy bonk!').addUserOption((o) => o.setName('cutie').setDescription('Target').setRequired(true)).addStringOption(addVibeOption),

    new SlashCommandBuilder().setName('blush').setDescription('Get all flustered and blush uwu~').addUserOption((o) => o.setName('cutie').setDescription('Optional: who made you blush?').setRequired(false)).addStringOption(addVibeOption),
    new SlashCommandBuilder().setName('tailwag').setDescription('Wag your tail happily!').addUserOption((o) => o.setName('cutie').setDescription('Optional: wag at who?').setRequired(false)).addStringOption(addVibeOption),
    new SlashCommandBuilder().setName('purr').setDescription('Curl up and purr softly!').addUserOption((o) => o.setName('cutie').setDescription('Optional: purr for who?').setRequired(false)),
    new SlashCommandBuilder().setName('howl').setDescription('Let out a cute wolf howl awooo~').addUserOption((o) => o.setName('cutie').setDescription('Optional: howl with who?').setRequired(false)),

    new SlashCommandBuilder().setName('cutemeter').setDescription('Scan cuteness percentage!').addUserOption((o) => o.setName('cutie').setDescription('Target').setRequired(false)),
    new SlashCommandBuilder().setName('ship').setDescription('Check compatibility between two cuties!')
      .addUserOption((o) => o.setName('cutie1').setDescription('First cutie').setRequired(true))
      .addUserOption((o) => o.setName('cutie2').setDescription('Second cutie').setRequired(true)),
    new SlashCommandBuilder().setName('8ball').setDescription('Ask the crystal ball a question!')
      .addStringOption((o) => o.setName('question').setDescription('Question').setRequired(true)),
    new SlashCommandBuilder().setName('lovecount').setDescription('Check affection count!')
      .addUserOption((o) => o.setName('cutie').setDescription('Target').setRequired(true)),
    new SlashCommandBuilder().setName('avatar').setDescription('Show HD avatar & profile!')
      .addStringOption((o) => o.setName('user_id').setDescription('User ID or mention').setRequired(false)),
    new SlashCommandBuilder().setName('stats').setDescription('Check bot uptime, ping & stats!'),
    new SlashCommandBuilder().setName('log').setDescription('Run a command with technical trace info :3')
      .addStringOption((o) => o.setName('command').setDescription('Command to test (e.g. e621, howl, stats)').setRequired(true))
      .addStringOption((o) => o.setName('tags').setDescription('Tags for e621').setRequired(false))
      .addUserOption((o) => o.setName('cutie').setDescription('Target cutie').setRequired(false)),
    new SlashCommandBuilder().setName('update').setDescription('Sync slash commands (Owner only)')
      .addStringOption((o) => o.setName('scope').setDescription('Scope').setRequired(false)
        .addChoices({ name: 'Server (Instant)', value: 'guild' }, { name: 'Global', value: 'global' }, { name: 'Both', value: 'both' }))
  ];

  return builders.map((b) => buildCommandJson(b, forEverywhere));
}

async function deployCommands({ guildId = null, scope = 'both' } = {}) {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const clientId = client.user?.id || process.env.CLIENT_ID;
  if (!clientId) throw new Error('Missing CLIENT_ID and client user');

  const results = { globalCount: null, guildCount: null };
  if (scope === 'global' || scope === 'both') {
    const res = await rest.put(Routes.applicationCommands(clientId), { body: getCommandDefinitions(true) });
    results.globalCount = Array.isArray(res) ? res.length : 0;
  }
  if ((scope === 'guild' || scope === 'both') && guildId) {
    const res = await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: getCommandDefinitions(false) });
    results.guildCount = Array.isArray(res) ? res.length : 0;
  }
  return results;
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  client.user.setActivity('paws, snuggles & emolarp.fans :3', { type: 3 });
  try {
    for (const [guildId] of client.guilds.cache) {
      await deployCommands({ guildId, scope: 'guild' }).catch(() => {});
    }
    await deployCommands({ scope: 'global' });
  } catch (err) {
    console.error('Initial deploy error:', err);
  }
});

const TARGET_ACTIONS = ['snuggle', 'hug', 'lick', 'kiss', 'headpat', 'earscratch', 'boop', 'bite', 'pawhold', 'milk', 'bonk'];
const SOLO_ACTIONS = ['blush', 'tailwag', 'purr', 'howl'];

async function executeBotCommand(commandName, params, interaction) {
  if (commandName === 'e621' || commandName === 'yiff') {
    const isYiff = commandName === 'yiff';
    const rawTags = params.tags !== undefined && params.tags !== '' ? params.tags : lastE621Query.tags;
    const order = params.order || lastE621Query.order || 'newest';
    const rating = isYiff ? 'explicit' : (params.rating || lastE621Query.rating || 'nsfw');
    lastE621Query = { tags: rawTags, order, rating, ranAt: new Date().toISOString() };

    const post = await fetchE621Post(rawTags, order, rating);
    if (!post) {
      return { content: `Awr~ No ${rating === 'safe' ? 'safe' : 'NSFW'} posts found on e621.net for \`${rawTags || 'your search'}\`! >_<` };
    }
    return buildE621Response(post, rawTags, order, rating);
  }

  if (commandName === 'update') {
    if (interaction.user.id !== OWNER_ID) {
      return { content: `Awr~ Only Loomie (<@${OWNER_ID}>) can run \`/update\`! >_<`, ephemeral: true };
    }
    const scope = params.scope || 'both';
    const res = await deployCommands({ guildId: interaction.guildId, scope });
    return {
      embeds: [{
        title: `Commands Synchronized~ ${pick('online')}`,
        description: `Successfully deployed slash commands!\n\n• Server: \`${res.guildCount ?? 'N/A'}\` (Instant)\n• Global: \`${res.globalCount ?? 'Unchanged'}\`\n• Gateway Ping: \`${client.ws.ping}ms\`\n• [emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_PINK
      }]
    };
  }

  if (commandName === 'furrypic') {
    const species = params.species || 'neko';
    const mediaUrl = await fetchFurrySpecies(species);
    const embed = {
      title: `Random SFW Furry Cutie~ ${pick('cute')}`,
      description: `Fresh SFW **${species}** card for you! ${pick('online')} • [emolarp.fans](${SITE_URL})`,
      color: PASTEL_PINK,
      footer: { text: 'PurrBot SFW • paws certified :3' }
    };
    if (mediaUrl && mediaUrl.startsWith('http')) {
      embed.image = { url: mediaUrl };
    }
    return { embeds: [embed] };
  }

  if (commandName === 'oc') {
    const loomieUser = await client.users.fetch(OWNER_ID).catch(() => interaction.user);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Loomie's Profile :3").setStyle(ButtonStyle.Link).setURL(`https://discord.com/users/${OWNER_ID}`),
      new ButtonBuilder().setLabel('emolarp.fans ^w^').setStyle(ButtonStyle.Link).setURL(SITE_URL)
    );
    const embed = {
      title: `Loomie's Deer OC Showcase~ ${pick('cute')}`,
      description: `Meet **Loomie** (<@${OWNER_ID}>)'s deer OC! ${pick('online')}\n\n• **Species:** Cozy Deer Kemonomimi / Anthro\n• **Signature Fit:** Oversized pastel hoodie, striped thigh-highs, fluffy tail~\n• **Website:** [emolarp.fans](${SITE_URL}) :3`,
      color: PASTEL_PINK
    };
    if (loomieUser?.displayAvatarURL) {
      embed.thumbnail = { url: loomieUser.displayAvatarURL({ size: 256 }) };
    }
    if (OC_IMAGE_URL && OC_IMAGE_URL.startsWith('http')) {
      embed.image = { url: OC_IMAGE_URL };
    }
    return {
      embeds: [embed],
      components: [row]
    };
  }

  if (TARGET_ACTIONS.includes(commandName)) {
    const cutie = params.cutie || interaction.user;
    const gif = await fetchActionGif(commandName);
    const count = recordAffection(interaction.user.id, cutie.id);
    const chosen = buildActionCopy(commandName, interaction.user.id, cutie.id);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`back:${commandName}:${interaction.user.id}:${cutie.id}:${params.vibe || 'furry'}`).setLabel(chosen.backLabel).setStyle(ButtonStyle.Secondary)
    );

    const embed = {
      title: chosen.title,
      description: `${chosen.text}\n\n*Combo with <@${cutie.id}>: **${count}** time${count === 1 ? '' : 's'}! ^w^* • [emolarp.fans](${SITE_URL})`,
      color: PASTEL_PINK
    };
    if (cutie?.displayAvatarURL) {
      embed.thumbnail = { url: cutie.displayAvatarURL({ size: 256 }) };
    }
    if (gif?.url) {
      embed.image = { url: gif.url };
      embed.footer = { text: `${gif.source || 'Furry Animation'} • paws certified :3` };
    }

    return {
      embeds: [embed],
      components: [row]
    };
  }

  if (SOLO_ACTIONS.includes(commandName)) {
    const cutie = params.cutie || null;
    const gif = await fetchActionGif(commandName);
    let title = '';
    let description = '';

    if (commandName === 'blush') {
      title = `Flustered & Blushing~!! ${pick('blush')}`;
      description = cutie
        ? `<@${cutie.id}> made <@${interaction.user.id}> blush super bright pink!! ${pick('blush')} • [emolarp.fans](${SITE_URL})`
        : `<@${interaction.user.id}> is blushing so hard right now, uwu~!! ${pick('blush')} • [emolarp.fans](${SITE_URL})`;
    } else if (commandName === 'tailwag') {
      title = `Happy Tail Wags~!! ${pick('online')}`;
      description = cutie
        ? `<@${interaction.user.id}> is wagging their tail super happily at <@${cutie.id}>!! ${pick('online')} • [emolarp.fans](${SITE_URL})`
        : `<@${interaction.user.id}> can't stop wagging their tail happily!! ${pick('online')} • [emolarp.fans](${SITE_URL})`;
    } else if (commandName === 'purr') {
      title = `Cozy Purrs~ prrrrr :3`;
      description = cutie
        ? `<@${interaction.user.id}> curls up and purrs softly against <@${cutie.id}>!! ${pick('snuggle')} • [emolarp.fans](${SITE_URL})`
        : `<@${interaction.user.id}> is super cozy and purring loudly!! ${pick('snuggle')} • [emolarp.fans](${SITE_URL})`;
    } else {
      title = `Cute Wolf Howl~ 🐺 ${pick('online')}`;
      description = cutie
        ? `*awooooooo~!!* <@${interaction.user.id}> lets out the sweetest wolf-pup howl with <@${cutie.id}>!! ${pick('online')} • [emolarp.fans](${SITE_URL})`
        : `*awooooooo~!!* <@${interaction.user.id}> lets out a sweet, fluffy little howl to the moon! 🐺✨ • [emolarp.fans](${SITE_URL})`;
    }

    const embed = {
      title,
      description,
      color: PASTEL_LAVENDER
    };
    const avatarTarget = cutie || interaction.user;
    if (avatarTarget?.displayAvatarURL) {
      embed.thumbnail = { url: avatarTarget.displayAvatarURL({ size: 256 }) };
    }
    if (gif?.url) {
      embed.image = { url: gif.url };
      embed.footer = { text: `${gif.source || 'Furry Animation'} • paws certified :3` };
    }

    return { embeds: [embed] };
  }

  if (commandName === 'cutemeter') {
    const cutie = params.cutie || interaction.user;
    const score = cutie.id === OWNER_ID ? 100 : Number(BigInt(cutie.id) % 31n) + 70;
    const meter = `[${'='.repeat(Math.round(score / 10))}${'-'.repeat(10 - Math.round(score / 10))}]`;
    const embed = {
      title: `Cute Meter~ ${pick('cute')}`,
      description: `**Target:** <@${cutie.id}>\n**Score:** **${score}%** \`${meter}\`\n**Verdict:** Certified adorable! Deserves unlimited headpats ${pick('headpat')}\n\n[emolarp.fans](${SITE_URL}) :3`,
      color: PASTEL_PINK
    };
    if (cutie?.displayAvatarURL) {
      embed.thumbnail = { url: cutie.displayAvatarURL({ size: 256 }) };
    }
    return { embeds: [embed] };
  }

  if (commandName === 'ship') {
    const c1 = params.cutie || interaction.user;
    const c2 = params.cutie2 || client.user || interaction.user;
    const name = `${c1.username.slice(0, Math.ceil(c1.username.length / 2))}${c2.username.slice(Math.floor(c2.username.length / 2))}`;
    const score = Number((BigInt(c1.id) + BigInt(c2.id)) % 41n) + 60;
    return {
      embeds: [{
        title: `Love Compatibility Meter~ ${pick('affection')}`,
        description: `💕 **Ship:** **${name}** (<@${c1.id}> x <@${c2.id}>)\n💖 **Compatibility:** **${score}%**\n\nMeant to snuggle forever! uwu~ • [emolarp.fans](${SITE_URL})`,
        color: PASTEL_PINK
      }]
    };
  }

  if (commandName === '8ball') {
    const answers = [
      `Yes, absolutely! ${pick('online')}`, `Most definitely uwu! :3`,
      `Without a doubt! Cuddle-certified answer :3`, `Ask again after some warm snuggles >_<`,
      `Very doubtful... but Loomie still loves you! ${pick('affection')}`
    ];
    return {
      embeds: [{
        title: `Pastel 8-Ball~ 🔮 ${pick('cute')}`,
        description: `**Question:** "${params.question || 'Will I get cuddles?'}"\n**Answer:** ${answers[Math.floor(Math.random() * answers.length)]}\n\n[emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_PURPLE
      }]
    };
  }

  if (commandName === 'lovecount') {
    const cutie = params.cutie || interaction.user;
    const count = affectionCounts.get(`${interaction.user.id}->${cutie.id}`) || 0;
    const embed = {
      title: `Affection Counter~ ${pick('affection')}`,
      description: `You have showered <@${cutie.id}> with love **${count}** time${count === 1 ? '' : 's'}!\n\n*Total delivered bot-wide: **${totalAffectionDelivered}** times!* ${pick('online')} • [emolarp.fans](${SITE_URL})`,
      color: PASTEL_PINK
    };
    if (cutie?.displayAvatarURL) {
      embed.thumbnail = { url: cutie.displayAvatarURL({ size: 256 }) };
    }
    return { embeds: [embed] };
  }

  if (commandName === 'avatar') {
    const rawTarget = (params.user_id || '').replace(/[<@!>]/g, '').trim();
    const targetUser = rawTarget ? (await client.users.fetch(rawTarget).catch(() => null)) : (await client.users.fetch(interaction.user.id).catch(() => interaction.user));
    if (!targetUser) return { content: `Awr~ User \`${rawTarget}\` not found! >_<` };

    const avatarUrl = targetUser.displayAvatarURL({ size: 1024, extension: 'png' });
    const bannerUrl = targetUser.bannerURL?.({ size: 1024, extension: 'png' }) || null;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('View PFP :3').setStyle(ButtonStyle.Link).setURL(avatarUrl),
      new ButtonBuilder().setLabel('Profile 👤').setStyle(ButtonStyle.Link).setURL(`https://discord.com/users/${targetUser.id}`)
    );
    if (bannerUrl) row.addComponents(new ButtonBuilder().setLabel('Banner ^w^').setStyle(ButtonStyle.Link).setURL(bannerUrl));

    const embed = {
      title: `${targetUser.username}'s Avatar & Profile~ ${pick('cute')}`,
      description: `• **Username:** \`${targetUser.tag}\`\n• **ID:** \`${targetUser.id}\`\n\n[emolarp.fans](${SITE_URL}) :3`,
      color: PASTEL_PINK,
      image: { url: avatarUrl }
    };
    if (bannerUrl) embed.thumbnail = { url: bannerUrl };

    return {
      embeds: [embed],
      components: [row]
    };
  }

  if (commandName === 'stats') {
    const sec = Math.floor(process.uptime());
    return {
      embeds: [{
        title: `Furry Bot Vital Stats~ ${pick('online')}`,
        description: `• **Ping:** \`${client.ws.ping}ms\`\n• **Uptime:** \`${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m ${sec % 60}s\`\n• **Total Affection:** \`${totalAffectionDelivered}\` times\n• **Host:** Render (Linux Node.js v24)\n• [emolarp.fans](${SITE_URL}) :3`,
        color: PASTEL_PINK
      }]
    };
  }

  return { content: `Awr~ Unknown command \`/${commandName}\`! >_<` };
}

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  const isOwner = message.author.id === OWNER_ID;
  const isMentioned = client.user && message.mentions.has(client.user.id);
  const content = (message.content || '').trim().toLowerCase();

  if (content.startsWith('!update') || content.startsWith('!sync') || (isMentioned && content.includes('update'))) {
    if (!isOwner) return message.reply(`Awr~ Only Loomie (<@${OWNER_ID}>) can sync commands! >_< ${pick('blush')}`);
    const statusMsg = await message.reply(`*deploying slash commands...* ${pick('online')}`);
    try {
      const res = await deployCommands({ guildId: message.guildId, scope: message.guildId ? 'both' : 'global' });
      return statusMsg.edit(`✅ **Synced!** Deployed \`${res.guildCount ?? 0}\` server commands and \`${res.globalCount ?? 0}\` global commands! Press \`Ctrl + R\` in Discord :3`);
    } catch (err) {
      return statusMsg.edit(`❌ Error: \`${err.message}\``);
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      const focused = typeof interaction.options.getFocused === 'function' ? interaction.options.getFocused(true) : { name: 'tags', value: '' };
      if (focused.name === 'tags') {
        const raw = focused.value || '';
        const lastSpace = raw.lastIndexOf(' ');
        const prefix = lastSpace >= 0 ? raw.slice(0, lastSpace + 1) : '';
        const word = (lastSpace >= 0 ? raw.slice(lastSpace + 1) : raw).toLowerCase().trim();

        const matches = !word
          ? POPULAR_TAGS.slice(0, 25)
          : [...POPULAR_TAGS.filter((t) => t.startsWith(word)), ...POPULAR_TAGS.filter((t) => !t.startsWith(word) && t.includes(word))].slice(0, 25);

        await interaction.respond(matches.map((tag) => ({ name: `${prefix}${tag}`.slice(0, 100), value: `${prefix}${tag}`.slice(0, 100) }))).catch(() => {});
      }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('save:')) {
      const postId = interaction.customId.split(':')[1];
      const post = recentE621Posts.get(postId) || await fetchE621PostById(postId);
      if (!post) return interaction.reply({ content: `Awr~ Could not retrieve post #${postId} details >_<`, ephemeral: true });

      try {
        const dm = await interaction.user.createDM();
        const embed = {
          title: `Saved Artwork (#${post.id}) ~ ${pick('cute')}`,
          description: `• **Artist:** \`${post.artists}\`\n• **Species/Tags:** \`${post.species}\`\n• **Score:** \`${post.score}\` • **Rating:** \`${String(post.rating).toUpperCase()}\`\n• **Post:** [View on e621.net](${post.postUrl})\n• **Direct:** [Full Image](${post.imageUrl})\n` +
            (post.videoUrl ? `• **Video:** [Watch Video (${String(post.ext).toUpperCase()})](${post.videoUrl})\n` : '') +
            `\n[emolarp.fans](${SITE_URL}) :3`,
          color: PASTEL_PINK,
          footer: { text: `Saved to your DMs • e621.net • Loomie's Bot :3` }
        };
        if (post.imageUrl && post.imageUrl.startsWith('http')) {
          embed.image = { url: post.imageUrl };
        }
        await dm.send({ embeds: [embed] });
        return interaction.reply({ content: `Saved post **#${post.id}** to your DMs! ₍ᐢ. .ᐢ₎`, ephemeral: true });
      } catch {
        return interaction.reply({ content: `Awr~ Couldn't send DMs! Please enable DMs for this server >_<`, ephemeral: true });
      }
    }

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
      if (!post) return interaction.followUp({ content: `Awr~ Couldn't find another post for \`${rawTags || 'search'}\`! :3`, ephemeral: true });
      return interaction.editReply(buildE621Response(post, rawTags, order, rating));
    }

    if (interaction.isButton() && interaction.customId.startsWith('back:')) {
      const [, action, senderId, receiverId] = interaction.customId.split(':');
      if (receiverId && interaction.user.id !== receiverId && interaction.user.id !== senderId) {
        return interaction.reply({ content: `That button is for <@${receiverId}> to reply, nya!`, ephemeral: true });
      }
      await interaction.deferReply();
      const gif = await fetchActionGif(action);
      const count = recordAffection(interaction.user.id, senderId);
      const chosen = buildActionCopy(action, interaction.user.id, senderId);
      const targetUser = await client.users.fetch(senderId).catch(() => null);

      const embed = {
        title: `${chosen.title} (Returned!)`,
        description: `${chosen.text}\n\n*Combo with <@${senderId}>: **${count}** time${count === 1 ? '' : 's'}! ^w^* • [emolarp.fans](${SITE_URL})`,
        color: PASTEL_PURPLE
      };
      if (targetUser?.displayAvatarURL) {
        embed.thumbnail = { url: targetUser.displayAvatarURL({ size: 256 }) };
      }
      if (gif?.url) {
        embed.image = { url: gif.url };
        embed.footer = { text: `${gif.source || 'Furry Animation'} • paws certified :3` };
      }

      return interaction.editReply({ embeds: [embed] });
    }

    if (!interaction.isChatInputCommand()) return;

    await interaction.deferReply();

    if (interaction.commandName === 'log') {
      const cmdRaw = (interaction.options.getString('command') || '').replace(/^\/+/, '').trim().split(/\s+/);
      const subCmd = cmdRaw[0] || 'stats';
      const inlineTags = cmdRaw.slice(1).join(' ') || interaction.options.getString('tags') || '';
      const params = {
        tags: inlineTags,
        cutie: interaction.options.getUser('cutie') || null,
        order: 'newest',
        rating: subCmd === 'yiff' ? 'explicit' : 'nsfw',
        vibe: 'furry',
        species: 'neko',
        user_id: null,
        scope: 'both'
      };
      const payload = await executeBotCommand(subCmd, params, interaction);
      const content = `\`[LOG]\` Executed \`/${subCmd}\` | Ping: \`${client.ws.ping}ms\``;
      return interaction.editReply({ ...payload, content });
    }

    const params = {
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

    const payload = await executeBotCommand(interaction.commandName, params, interaction);
    await interaction.editReply(payload);
  } catch (err) {
    console.error('Interaction error:', err);
    const msg = `Awr~ Error: \`${err?.message || String(err)}\` >_<`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: msg }).catch(() => {});
    else await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
  }
});

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: `awake ${pick('online')}`, owner: `Loomie (${OWNER_ID})`, bot: client.user?.tag || 'booting...', totalAffectionDelivered, uptime: Math.floor(process.uptime()) }));
}).listen(PORT, () => console.log(`Health server on port ${PORT}`));

client.login(process.env.DISCORD_TOKEN);
