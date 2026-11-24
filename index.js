import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  WebhookClient,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ApplicationIntegrationType,
  InteractionContextType
} from 'discord.js';
import http from 'node:http';
import 'dotenv/config';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

const LOG_WEBHOOK_URL = process.env.LOG_WEBHOOK_URL;
const UPTIME_WEBHOOK_URL = process.env.UPTIME_WEBHOOK_URL;
const logWebhook = LOG_WEBHOOK_URL ? new WebhookClient({ url: LOG_WEBHOOK_URL }) : null;
const uptimeWebhook = UPTIME_WEBHOOK_URL ? new WebhookClient({ url: UPTIME_WEBHOOK_URL }) : null;

const POLL_INTERVAL_MS = 5 * 60 * 1000;

// Load permanent tracked IDs from Render env var TRACKED_USER_IDS (comma-separated)
const trackedUsers = new Map();
if (process.env.TRACKED_USER_IDS) {
  for (const rawId of process.env.TRACKED_USER_IDS.split(',')) {
    const id = rawId.trim();
    if (/^\d{17,20}$/.test(id)) {
      trackedUsers.set(id, null);
    }
  }
}

const UPTIME_TARGETS = [
  { name: 'emolarp.fans (GitHub Pages)', url: 'https://emolarp.fans', isUp: true },
  { name: 'emolarp-logger (Cloudflare Worker)', url: 'https://emolarp-logger.insanesservices.workers.dev', isUp: true }
];

// Mood-matched kaomoji pools :3
const KAOMOJI = {
  online: ['ฅ^•ﻌ•^ฅ', '(=^･ω･^=)', '(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧', '(≧◡≦)', '(=^･ｪ･^=)', '٩(◕‿◕｡)۶'],
  idle: ['(－_－) zzZ', '(￣o￣) . z Z', '(=^-ω-^=)', '(´꒳`)', '(◡ ‿ ◡ ✿)'],
  dnd: ['(・`ω´・)', '(っ- ‸ – ς)', '(=`ω´=)', '(｡>﹏<｡)', '(*/ω\\)'],
  offline: ['(－_－) zzZ', '(=；ェ；=)', '/ᐠ - ˕ -マ', '(´-ω-`)', '(；ω；)'],
  cute: ['(｡･ω･｡)', '(´｡• ᵕ •｡`)', '(=①ω①=)', '(●´ω｀●)', 'ﾐ・ﻌ・ﾐ', '/ᐠ｡ꞈ｡ᐟ\\'],
  snuggle: ['(つ≧▽≦)つ', '(づ｡◕‿‿◕｡)づ', '(⊃｡•́‿•̀｡)⊃', '(´,,•ω•,,)', '(* ^ ω ^)'],
  headpat: ['(´･･)ﾉ(._.\`)', '(っ´ω`)ﾉ(╥ω╥)', '(づ｡◕‿‿◕｡)づ', 'ฅ^•ﻌ•^ฅ'],
  affection: ['(っ˘з(˘⌣˘ )', '(｡・//ε//・｡)', '(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)', '(´ε｀ )♡', '(*≧ω≦*)', '(´▽`ʃ♡ƪ)']
};

function pick(category) {
  const list = KAOMOJI[category] || KAOMOJI.cute;
  return list[Math.floor(Math.random() * list.length)];
}

function getStatusLabel(status) {
  switch (status) {
    case 'online':
      return `[Online] Cozy & awake ${pick('online')}`;
    case 'idle':
      return `[Idle] Sleepy / AFK ${pick('idle')}`;
    case 'dnd':
      return `[DND] Busy / Do Not Disturb ${pick('dnd')}`;
    default:
      return `[Offline] Asleep ${pick('offline')}`;
  }
}

const PASTEL_PINK = 0xff99cc;
const PASTEL_PURPLE = 0xc792ea;
const PASTEL_LAVENDER = 0xe0b0ff;

// Fetch a cute furry/neko/anime action GIF from free public APIs
async function fetchActionGif(action, vibe = 'furry') {
  const endpointMap = {
    snuggle: 'cuddle',
    lick: 'lick',
    kiss: 'kiss',
    headpat: 'pat'
  };
  const endpoint = endpointMap[action] || 'cuddle';

  try {
    if (vibe === 'furry') {
      const purrMap = { snuggle: 'cuddle', lick: 'lick', kiss: 'kiss', headpat: 'pat' };
      const purrRes = await fetch(`https://api.purrbot.site/v2/img/sfw/${purrMap[action]}/gif`, {
        signal: AbortSignal.timeout(4000)
      });
      if (purrRes.ok) {
        const purrData = await purrRes.json();
        if (purrData?.link) return { url: purrData.link, source: 'PurrBot Furry/Neko' };
      }
    }

    const res = await fetch(`https://nekos.best/api/v2/${endpoint}`, {
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      const data = await res.json();
      const item = data?.results?.[0];
      if (item?.url) {
        return {
          url: item.url,
          source: item.anime_name ? `Anime: ${item.anime_name}` : 'Nekos.best'
        };
      }
    }
  } catch {
    // Fallback gracefully
  }
  return null;
}

// Helper: Extract custom status & current game/Spotify activity
function parseActivities(activities = []) {
  let customStatus = null;
  let currentActivity = null;

  for (const a of activities) {
    if (a.type === 4) {
      const emoji = a.emoji ? `${a.emoji.name} ` : '';
      customStatus = `${emoji}${a.state || ''}`.trim() || null;
    } else if (a.name === 'Spotify' && a.details) {
      currentActivity = `Listening to **${a.details}** by *${a.state || 'Unknown'}*`;
    } else if (a.type === 0) {
      currentActivity = `Playing **${a.name}**${a.details ? ` (${a.details})` : ''}`;
    } else if (a.type === 1) {
      currentActivity = `Streaming **${a.name}**`;
    }
  }

  return { customStatus, currentActivity };
}

// Helper: Query Lanyard API as fallback for external users
async function fetchLanyard(userId) {
  try {
    const res = await fetch(`https://api.lanyard.rest/v1/users/${userId}`);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.success || !json.data) return null;

    const d = json.data;
    const { customStatus, currentActivity } = parseActivities(d.activities || []);
    const platforms = [];
    if (d.active_on_discord_desktop) platforms.push('Desktop');
    if (d.active_on_discord_mobile) platforms.push('Mobile');
    if (d.active_on_discord_web) platforms.push('Web');

    return {
      status: d.discord_status || 'offline',
      customStatus,
      currentActivity: d.listening_to_spotify && d.spotify
        ? `Listening to **${d.spotify.song}** by *${d.spotify.artist}*`
        : currentActivity,
      platforms: platforms.length ? platforms.join(', ') : null
    };
  } catch {
    return null;
  }
}

async function findMutualMember(userId) {
  for (const guild of client.guilds.cache.values()) {
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    if (member) return member;
  }
  return null;
}

function buildAssetButtons(avatarUrl, bannerUrl, decoUrl) {
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
  return [row];
}

async function sendCuteLog(embed, components = []) {
  if (!logWebhook) {
    console.warn('Missing LOG_WEBHOOK_URL!');
    return;
  }
  await logWebhook.send({
    username: 'furry • thigh-high patrol :3',
    embeds: [
      {
        ...embed,
        footer: { text: `furry logger • paws & thigh-highs certified ${pick('cute')}` }
      }
    ],
    components
  }).catch(console.error);
}

function buildSnapshot(user, lanyard = null) {
  return {
    username: user.username,
    globalName: user.globalName || null,
    avatarUrl: user.displayAvatarURL({ size: 512 }),
    bannerUrl: user.bannerURL({ size: 1024 }) || null,
    decoUrl: user.avatarDecorationURL({ size: 512 }) || null,
    lanyardStatus: lanyard?.status || null,
    lanyardCustom: lanyard?.customStatus || null
  };
}

// 1. Live Status, Custom Status & Game/Spotify Logger
client.on(Events.PresenceUpdate, async (oldPresence, newPresence) => {
  const member = newPresence.member;
  if (!member || member.user.bot) return;

  const oldStatus = oldPresence?.status || 'offline';
  const newStatus = newPresence.status || 'offline';
  const oldAct = parseActivities(oldPresence?.activities);
  const newAct = parseActivities(newPresence.activities);

  if (
    oldStatus === newStatus &&
    oldAct.customStatus === newAct.customStatus &&
    oldAct.currentActivity === newAct.currentActivity
  ) {
    return;
  }

  const fullUser = await member.user.fetch(true).catch(() => member.user);
  const avatarUrl = fullUser.displayAvatarURL({ size: 512 });
  const bannerUrl = fullUser.bannerURL({ size: 1024 });
  const decoUrl = fullUser.avatarDecorationURL({ size: 512 });

  const moodKaomoji = pick(newStatus in KAOMOJI ? newStatus : 'cute');

  const fields = [
    {
      name: 'Vibe / Status',
      value: `${getStatusLabel(oldStatus)} -> **${getStatusLabel(newStatus)}**`,
      inline: true
    },
    {
      name: 'Server',
      value: `\`${member.guild.name}\``,
      inline: true
    }
  ];

  if (newAct.customStatus) {
    fields.push({ name: 'Custom Status', value: `\`${newAct.customStatus}\``, inline: false });
  }
  if (newAct.currentActivity) {
    fields.push({ name: 'Activity', value: newAct.currentActivity, inline: false });
  }

  await sendCuteLog(
    {
      title: `Cutie Status Update~ ${moodKaomoji}`,
      description: `*ears perk up!* **${fullUser.username}** (<@${fullUser.id}>) updated their status, uwu~`,
      color: PASTEL_PINK,
      thumbnail: { url: avatarUrl },
      image: bannerUrl ? { url: bannerUrl } : undefined,
      fields,
      timestamp: new Date().toISOString()
    },
    buildAssetButtons(avatarUrl, bannerUrl, decoUrl)
  );
});

// 2. Live Profile Logger
client.on(Events.UserUpdate, async (oldUser, newUser) => {
  if (newUser.bot) return;

  const fullNew = await newUser.fetch(true).catch(() => newUser);
  const oldAvatar = oldUser.displayAvatarURL({ size: 512 });
  const newAvatar = fullNew.displayAvatarURL({ size: 512 });
  const oldBanner = oldUser.bannerURL({ size: 1024 });
  const newBanner = fullNew.bannerURL({ size: 1024 });
  const oldDeco = oldUser.avatarDecorationURL({ size: 512 });
  const newDeco = fullNew.avatarDecorationURL({ size: 512 });

  const changes = [];
  if (oldUser.username !== fullNew.username) {
    changes.push(`**Username:** \`${oldUser.username}\` -> \`${fullNew.username}\``);
  }
  if (oldUser.globalName !== fullNew.globalName) {
    changes.push(`**Display Name:** \`${oldUser.globalName || 'None'}\` -> \`${fullNew.globalName || 'None'}\``);
  }
  if (oldAvatar !== newAvatar) {
    changes.push(`**Avatar (PFP):** Fresh new look! ${pick('cute')}`);
  }
  if (oldBanner !== newBanner) {
    changes.push(newBanner ? `**Banner:** Updated to a cute new banner! ^w^` : `**Banner:** Removed ${pick('offline')}`);
  }
  if (oldDeco !== newDeco) {
    changes.push(newDeco ? `**Avatar Decoration:** Equipped new decoration! :3` : `**Avatar Decoration:** Removed`);
  }

  if (changes.length === 0) return;

  await sendCuteLog(
    {
      title: `Profile Makeover Alert~ ${pick('cute')}`,
      description: `*tail wags happily!* **${fullNew.username}** (<@${fullNew.id}>) changed their profile:\n\n${changes.join('\n')}`,
      color: PASTEL_PURPLE,
      thumbnail: { url: newAvatar },
      image: newBanner ? { url: newBanner } : undefined,
      timestamp: new Date().toISOString()
    },
    buildAssetButtons(newAvatar, newBanner, newDeco)
  );
});

// 3. Server Nickname & Boost Logger
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (newMember.user.bot) return;
  const changes = [];

  if (oldMember.nickname !== newMember.nickname) {
    changes.push(`**Server Nickname:** \`${oldMember.nickname || 'None'}\` -> \`${newMember.nickname || 'None'}\``);
  }
  if (!oldMember.premiumSince && newMember.premiumSince) {
    changes.push(`**Server Boosted!** Give them extra headpats & thigh-highs!! ${pick('affection')}`);
  }

  if (changes.length === 0) return;

  const avatarUrl = newMember.displayAvatarURL({ size: 512 });
  await sendCuteLog({
    title: `Server Member Update~ ${pick('cute')}`,
    description: `**${newMember.user.username}** (<@${newMember.id}>) in **${newMember.guild.name}**:\n\n${changes.join('\n')}`,
    color: PASTEL_LAVENDER,
    thumbnail: { url: avatarUrl },
    timestamp: new Date().toISOString()
  });
});

// 4. Poll External Tracked Users
async function pollTrackedUsers() {
  for (const [userId, prev] of trackedUsers.entries()) {
    try {
      const fullUser = await client.users.fetch(userId, { force: true });
      const lanyard = await fetchLanyard(userId);
      const current = buildSnapshot(fullUser, lanyard);

      if (!prev) {
        trackedUsers.set(userId, current);
        continue;
      }

      const changes = [];
      if (prev.username !== current.username) {
        changes.push(`**Username:** \`${prev.username}\` -> \`${current.username}\``);
      }
      if (prev.globalName !== current.globalName) {
        changes.push(`**Display Name:** \`${prev.globalName || 'None'}\` -> \`${current.globalName || 'None'}\``);
      }
      if (prev.avatarUrl !== current.avatarUrl) {
        changes.push(`**Avatar (PFP):** Updated! ${pick('cute')}`);
      }
      if (prev.bannerUrl !== current.bannerUrl) {
        changes.push(current.bannerUrl ? `**Banner:** Updated! ^w^` : `**Banner:** Removed ${pick('offline')}`);
      }
      if (prev.decoUrl !== current.decoUrl) {
        changes.push(current.decoUrl ? `**Avatar Decoration:** Updated! :3` : `**Avatar Decoration:** Removed`);
      }
      if (lanyard && prev.lanyardStatus && prev.lanyardStatus !== current.lanyardStatus) {
        changes.push(`**Lanyard Status:** ${getStatusLabel(prev.lanyardStatus)} -> **${getStatusLabel(current.lanyardStatus)}**`);
      }
      if (lanyard && prev.lanyardCustom !== current.lanyardCustom) {
        changes.push(`**Lanyard Custom Status:** \`${current.lanyardCustom || 'Cleared'}\``);
      }

      trackedUsers.set(userId, current);

      if (changes.length > 0) {
        await sendCuteLog(
          {
            title: `External Cutie Updated~ ${pick('cute')}`,
            description: `*paws at the air!* **${current.username}** (\`${userId}\`) updated:\n\n${changes.join('\n')}`,
            color: PASTEL_PURPLE,
            thumbnail: { url: current.avatarUrl },
            image: current.bannerUrl ? { url: current.bannerUrl } : undefined,
            timestamp: new Date().toISOString()
          },
          buildAssetButtons(current.avatarUrl, current.bannerUrl, current.decoUrl)
        );
      }
    } catch (err) {
      console.error(`Failed to fetch tracked user ${userId}:`, err.message);
    }
  }
}

// 5. Optional emolarp.fans Uptime Monitor
async function checkWebsiteUptime() {
  if (!uptimeWebhook) return;
  for (const target of UPTIME_TARGETS) {
    const start = Date.now();
    try {
      const res = await fetch(target.url, { signal: AbortSignal.timeout(10000) });
      const ms = Date.now() - start;
      if (res.ok && !target.isUp) {
        target.isUp = true;
        await uptimeWebhook.send({
          username: 'furry uptime monitor :3',
          embeds: [{
            title: `Back Online! • ${target.name} ${pick('online')}`,
            description: `*tail wags happily!* Recovered with HTTP **${res.status}** (${ms}ms) uwu~`,
            color: PASTEL_PINK,
            timestamp: new Date().toISOString()
          }]
        }).catch(console.error);
      } else if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      if (target.isUp) {
        target.isUp = false;
        await uptimeWebhook.send({
          username: 'furry uptime monitor :3',
          embeds: [{
            title: `Service Down! • ${target.name} ${pick('offline')}`,
            description: `*ears droop!* Couldn't reach \`${target.url}\` (\`${err.message}\`)`,
            color: PASTEL_PURPLE,
            timestamp: new Date().toISOString()
          }]
        }).catch(console.error);
      }
    }
  }
}

// Helper to enable all commands in Servers, Bot DMs, and Private/Group DMs!
function enableEverywhere(builder) {
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

const addVibeOption = (opt) =>
  opt
    .setName('vibe')
    .setDescription('Pick furry/neko or anime GIF style! :3')
    .setRequired(false)
    .addChoices(
      { name: 'Furry / Neko (PurrBot) :3', value: 'furry' },
      { name: 'Kemonomimi / Anime (Nekos.best) ^w^', value: 'anime' }
    );

// 6. Register All Slash Commands (Enabled in DMs + Servers!)
client.once(Events.ClientReady, async () => {
  console.log(`furry online as ${client.user.tag} :3`);
  client.user.setActivity('paws & thigh-highs :3', { type: 3 });

  const commands = [
    enableEverywhere(
      new SlashCommandBuilder()
        .setName('lookup')
        .setDescription('Log any user PFP, banner, decoration & status (mutual server or Lanyard) :3')
        .addStringOption((opt) =>
          opt.setName('user_id').setDescription('Discord User ID or @mention').setRequired(true)
        )
    ),
    enableEverywhere(
      new SlashCommandBuilder()
        .setName('avatar')
        .setDescription('Show a cutie HD PFP, banner & avatar decoration right in chat! uwu')
        .addStringOption((opt) =>
          opt.setName('user_id').setDescription('Discord User ID or @mention (defaults to you!)').setRequired(false)
        )
    ),
    enableEverywhere(
      new SlashCommandBuilder()
        .setName('track')
        .setDescription('Add a User ID to monitor profile & Lanyard updates every 5 mins ^w^')
        .addStringOption((opt) =>
          opt.setName('user_id').setDescription('Discord User ID to watch').setRequired(true)
        )
    ),
    enableEverywhere(
      new SlashCommandBuilder()
        .setName('untrack')
        .setDescription('Stop tracking an external User ID >_<')
        .addStringOption((opt) =>
          opt.setName('user_id').setDescription('Discord User ID to remove').setRequired(true)
        )
    ),
    enableEverywhere(
      new SlashCommandBuilder()
        .setName('tracked')
        .setDescription('See all external User IDs furry is watching~ :3')
    ),
    enableEverywhere(
      new SlashCommandBuilder()
        .setName('snuggle')
        .setDescription('Wrap a cutie in cozy oversized-hoodie & thigh-high snuggles uwu!')
        .addUserOption((opt) =>
          opt.setName('cutie').setDescription('Who are we snuggling? :3').setRequired(true)
        )
        .addStringOption(addVibeOption)
    ),
    enableEverywhere(
      new SlashCommandBuilder()
        .setName('lick')
        .setDescription('Give a cutie a playful catboy/puppy lick~ nya!')
        .addUserOption((opt) =>
          opt.setName('cutie').setDescription('Who gets a playful lick? >w<').setRequired(true)
        )
        .addStringOption(addVibeOption)
    ),
    enableEverywhere(
      new SlashCommandBuilder()
        .setName('kiss')
        .setDescription('Give a cutie a sweet pastel forehead or cheek kiss~ ^w^')
        .addUserOption((opt) =>
          opt.setName('cutie').setDescription('Who gets a sweet kiss? :3').setRequired(true)
        )
        .addStringOption(addVibeOption)
    ),
    enableEverywhere(
      new SlashCommandBuilder()
        .setName('headpat')
        .setDescription('Give a cutie cozy headpats and paw boops uwu!')
        .addUserOption((opt) =>
          opt.setName('cutie').setDescription('Who deserves headpats? :3').setRequired(true)
        )
        .addStringOption(addVibeOption)
    ),
    enableEverywhere(
      new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Check furry uptime, ping & tracked cuties! :3')
    )
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands }).catch(console.error);

  await pollTrackedUsers();
  await checkWebsiteUptime();
  setInterval(pollTrackedUsers, POLL_INTERVAL_MS);
  setInterval(checkWebsiteUptime, POLL_INTERVAL_MS);
});

// 7. Handle All Slash Commands
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // /lookup & /avatar
  if (interaction.commandName === 'lookup' || interaction.commandName === 'avatar') {
    const isLookup = interaction.commandName === 'lookup';
    await interaction.deferReply({ ephemeral: isLookup });

    const rawInput = interaction.options.getString('user_id');
    const rawId = rawInput ? rawInput.replace(/[<@!>]/g, '').trim() : interaction.user.id;

    try {
      const fullUser = await client.users.fetch(rawId, { force: true });
      const mutualMember = await findMutualMember(fullUser.id);
      const lanyard = !mutualMember ? await fetchLanyard(fullUser.id) : null;

      let statusText = `*Not in a mutual server or Lanyard ${pick('offline')}*`;
      let customText = null;
      let activityText = null;

      if (mutualMember) {
        const s = mutualMember.presence?.status || 'offline';
        const parsed = parseActivities(mutualMember.presence?.activities);
        statusText = `${getStatusLabel(s)} *(via ${mutualMember.guild.name})*`;
        customText = parsed.customStatus;
        activityText = parsed.currentActivity;
      } else if (lanyard) {
        statusText = `${getStatusLabel(lanyard.status)} *(via Lanyard${lanyard.platforms ? ` • ${lanyard.platforms}` : ''})*`;
        customText = lanyard.customStatus;
        activityText = lanyard.currentActivity;
      }

      const avatarUrl = fullUser.displayAvatarURL({ size: 512 });
      const bannerUrl = fullUser.bannerURL({ size: 1024 });
      const decoUrl = fullUser.avatarDecorationURL({ size: 512 });

      const fields = [
        { name: 'Username', value: `\`${fullUser.username}\``, inline: true },
        { name: 'Display Name', value: `\`${fullUser.globalName || 'None'}\``, inline: true },
        { name: 'Status', value: statusText, inline: false }
      ];

      if (customText) fields.push({ name: 'Custom Status', value: `\`${customText}\``, inline: false });
      if (activityText) fields.push({ name: 'Activity', value: activityText, inline: false });

      const embed = {
        title: isLookup ? `Cutie Profile Snapshot~ ${pick('cute')}` : `${fullUser.username}'s Lookbook~ ${pick('cute')}`,
        description: `*ears perk up!* Target: **${fullUser.username}** (\`${fullUser.id}\`)`,
        color: PASTEL_PINK,
        thumbnail: { url: avatarUrl },
        image: bannerUrl ? { url: bannerUrl } : undefined,
        fields,
        timestamp: new Date().toISOString()
      };

      const buttons = buildAssetButtons(avatarUrl, bannerUrl, decoUrl);

      if (isLookup) {
        await sendCuteLog(embed, buttons);
        await interaction.editReply(`*tail wags happily!* Sent **${fullUser.username}**'s profile & status snapshot to your webhook, uwu~ ${pick('online')}`);
      } else {
        await interaction.editReply({ embeds: [embed], components: buttons });
      }
    } catch {
      await interaction.editReply(`Awr~ I couldn’t find anyone with that ID! Make sure Developer Mode is on and copy the numeric User ID, ${pick('offline')}`);
    }
  }

  // /track
  if (interaction.commandName === 'track') {
    await interaction.deferReply({ ephemeral: true });
    const rawId = interaction.options.getString('user_id', true).replace(/[<@!>]/g, '').trim();

    if (!/^\d{17,20}$/.test(rawId)) {
      return interaction.editReply(`Nya~ Please paste a valid numeric Discord User ID! ${pick('cute')}`);
    }

    try {
      const fullUser = await client.users.fetch(rawId, { force: true });
      const lanyard = await fetchLanyard(rawId);
      trackedUsers.set(rawId, buildSnapshot(fullUser, lanyard));
      await interaction.editReply(
        `*paws at the air!* Now watching **${fullUser.username}** (\`${rawId}\`) every 5 mins${lanyard ? ` (with Lanyard status active!! ${pick('online')})` : ''}! :3\n*(Tip: Add \`${rawId}\` to \`TRACKED_USER_IDS\` in Render so it stays saved across restarts, uwu~)*`
      );
    } catch {
      await interaction.editReply(`Awr~ Couldn’t fetch that User ID—double-check the numbers for me! ${pick('offline')}`);
    }
  }

  // /untrack
  if (interaction.commandName === 'untrack') {
    const rawId = interaction.options.getString('user_id', true).replace(/[<@!>]/g, '').trim();
    const removed = trackedUsers.delete(rawId);
    await interaction.reply({
      content: removed ? `*tail swishes* Stopped watching \`${rawId}\`, uwu~ ${pick('cute')}` : `\`${rawId}\` wasn't on my watch list, nya~`,
      ephemeral: true
    });
  }

  // /tracked
  if (interaction.commandName === 'tracked') {
    const ids = [...trackedUsers.keys()];
    await interaction.reply({
      content: ids.length
        ? `**Cuties I'm watching (${ids.length}) ${pick('cute')}:**\n${ids.map((id) => `• \`${id}\``).join('\n')}`
        : `No external User IDs on my watch list yet! Use \`/track user_id:...\` to add a cutie~ ${pick('cute')}`,
      ephemeral: true
    });
  }

  // Cute Furry/Anime Action Commands with Mood-Matched Kaomojis!
  if (['snuggle', 'lick', 'kiss', 'headpat'].includes(interaction.commandName)) {
    await interaction.deferReply();
    const action = interaction.commandName;
    const cutie = interaction.options.getUser('cutie', true);
    const vibe = interaction.options.getString('vibe') || 'furry';
    const gif = await fetchActionGif(action, vibe);

    const copyMap = {
      snuggle: {
        title: `Cozy Snuggle Pile~!! ${pick('snuggle')}`,
        text: `*adjusts oversized pastel hoodie & striped thigh-highs, curling up close*\n\n<@${interaction.user.id}> wraps <@${cutie.id}> in the warmest, fluffiest snuggles and gentle tail-wraps!! ${pick('snuggle')}`
      },
      lick: {
        title: `Playful Paw & Cheek Lick~ ${pick('affection')}`,
        text: `*ears perk up and tail wags wildly*\n\n<@${interaction.user.id}> leans in and gives <@${cutie.id}> a super cute, playful puppy-boy lick right on the cheek!! ${pick('affection')}`
      },
      kiss: {
        title: `Sweet Pastel Kiss~ ${pick('affection')}`,
        text: `*blushes softly and paws at the air*\n\n<@${interaction.user.id}> gives <@${cutie.id}> the sweetest, softest forehead & cheek kiss!! ${pick('affection')}`
      },
      headpat: {
        title: `Cozy Headpat Delivery~!! ${pick('headpat')}`,
        text: `*adjusts striped thigh-highs and reaches up on tiptoes*\n\n<@${interaction.user.id}> gives <@${cutie.id}> the softest, warmest headpats and gentle paw-boops!! ${pick('headpat')}`
      }
    };

    const chosen = copyMap[action];
    await interaction.editReply({
      embeds: [{
        title: chosen.title,
        description: chosen.text,
        color: PASTEL_PINK,
        thumbnail: { url: cutie.displayAvatarURL({ size: 256 }) },
        image: gif?.url ? { url: gif.url } : undefined,
        footer: {
          text: gif?.source
            ? `${gif.source} • paws & thigh-highs certified :3`
            : 'paws & thigh-highs certified uwu :3'
        }
      }]
    });
  }

  // /stats
  if (interaction.commandName === 'stats') {
    const uptimeSec = Math.floor(process.uptime());
    const mins = Math.floor(uptimeSec / 60);
    const hrs = Math.floor(mins / 60);
    await interaction.reply({
      embeds: [{
        title: `furry Status & Paw-formance~ ${pick('online')}`,
        description: '*tail wags happily!* Everything is cozy and running smoothly, uwu~',
        color: PASTEL_LAVENDER,
        fields: [
          { name: 'Ping', value: `\`${client.ws.ping}ms\``, inline: true },
          { name: 'Awake For', value: `\`${hrs}h ${mins % 60}m\``, inline: true },
          { name: 'Servers / Tracked', value: `\`${client.guilds.cache.size}\` servers • \`${trackedUsers.size}\` IDs`, inline: true }
        ]
      }],
      ephemeral: true
    });
  }
});

// 8. Tiny HTTP Keep-Alive Server for Render + UptimeRobot
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: `awake ${pick('online')}`,
    bot: client.user?.tag || 'booting...',
    trackedUsers: trackedUsers.size,
    uptimeSeconds: Math.floor(process.uptime())
  }));
}).listen(PORT, () => {
  console.log(`Health server listening on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
