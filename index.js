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

// In-memory affection counter: tracks how many times userA gave affection to userB
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

// Fetch cute furry/neko or anime GIFs from PurrBot & Nekos.best
async function fetchActionGif(action, vibe = 'furry') {
  const purrMap = {
    snuggle: 'cuddle',
    hug: 'hug',
    lick: 'lick',
    kiss: 'kiss',
    headpat: 'pat',
    boop: 'poke',
    bite: 'bite',
    blush: 'blush',
    tailwag: 'tail'
  };

  const nekosMap = {
    snuggle: 'cuddle',
    hug: 'hug',
    lick: 'lick',
    kiss: 'kiss',
    headpat: 'pat',
    boop: 'poke',
    bite: 'bite',
    blush: 'blush',
    tailwag: 'happy'
  };

  try {
    if (vibe === 'furry' && purrMap[action]) {
      const purrRes = await fetch(`https://api.purrbot.site/v2/img/sfw/${purrMap[action]}/gif`, {
        signal: AbortSignal.timeout(4000)
      });
      if (purrRes.ok) {
        const purrData = await purrRes.json();
        if (purrData?.link) {
          return { url: purrData.link, source: 'PurrBot Furry / Neko' };
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
          source: item.anime_name ? `Anime: ${item.anime_name}` : 'Nekos.best'
        };
      }
    }
  } catch {
    // Fallback gracefully so commands never fail
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

const addVibeOption = (opt) =>
  opt
    .setName('vibe')
    .setDescription('Pick furry/neko or anime GIF style! :3')
    .setRequired(false)
    .addChoices(
      { name: 'Furry / Neko (PurrBot) :3', value: 'furry' },
      { name: 'Kemonomimi / Anime (Nekos.best) ^w^', value: 'anime' }
    );

// Enable Server, Bot DM, Group DM & User-Install contexts everywhere
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
  console.log(`furry online as ${client.user.tag} :3`);
  client.user.setActivity('paws, snuggles & thigh-highs :3', { type: 3 });

  const commands = [
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
        .setName('lovecount')
        .setDescription('Check how much affection you have given a cutie~ :3')
        .addUserOption((opt) =>
          opt.setName('cutie').setDescription('Check affection count for this cutie!').setRequired(true)
        )
    ),
    makeEverywhere(
      new SlashCommandBuilder()
        .setName('avatar')
        .setDescription('Show a cutie HD PFP, banner & avatar decoration right in chat! uwu')
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

// Handle Slash Commands
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const targetActions = ['snuggle', 'hug', 'lick', 'kiss', 'headpat', 'boop', 'bite'];
  const soloActions = ['blush', 'tailwag'];

  // Target Action Commands
  if (targetActions.includes(interaction.commandName)) {
    await interaction.deferReply();
    const action = interaction.commandName;
    const cutie = interaction.options.getUser('cutie', true);
    const vibe = interaction.options.getString('vibe') || 'furry';
    const gif = await fetchActionGif(action, vibe);
    const count = recordAffection(interaction.user.id, cutie.id);

    const copyMap = {
      snuggle: {
        title: `Cozy Snuggle Pile~!! ${pick('snuggle')}`,
        text: `*adjusts oversized pastel hoodie & striped thigh-highs, curling up close*\n\n<@${interaction.user.id}> wraps <@${cutie.id}> in the warmest, fluffiest snuggles and gentle tail-wraps!! ${pick('snuggle')}`
      },
      hug: {
        title: `Warm Fluffy Hug~!! ${pick('snuggle')}`,
        text: `*opens arms wide and rushes in for a big squeeze*\n\n<@${interaction.user.id}> pulls <@${cutie.id}> into the tightest, coziest hug ever!! ${pick('snuggle')}`
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
      },
      boop: {
        title: `Soft Paw Snoot-Boop~!! ${pick('playful')}`,
        text: `*reaches out a soft paw pad and gently pokes*\n\n*boop!!* <@${interaction.user.id}> boops <@${cutie.id}> right on the nose!! ${pick('playful')}`
      },
      bite: {
        title: `Playful Love-Nibble~ nom! ${pick('playful')}`,
        text: `*ears flatten playfully and leans in close*\n\n*nom~!* <@${interaction.user.id}> gives <@${cutie.id}> a gentle, playful little catboy nibble!! ${pick('playful')}`
      }
    };

    const chosen = copyMap[action];
    await interaction.editReply({
      embeds: [{
        title: chosen.title,
        description: `${chosen.text}\n\n*Affection combo with <@${cutie.id}>: **${count}** time${count === 1 ? '' : 's'}! ^w^*`,
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

  // Solo / Optional-Target Reaction Commands (/blush, /tailwag)
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
        ? `*hides face inside oversized pastel hoodie sleeves*\n\n<@${cutie.id}> made <@${interaction.user.id}> blush super bright pink!! ${pick('blush')}`
        : `*pulls hoodie sleeves over hands and looks away*\n\n<@${interaction.user.id}> is blushing so hard right now, uwu~!! ${pick('blush')}`;
    } else {
      title = `Happy Tail Wags~!! ${pick('online')}`;
      description = cutie
        ? `*ears perk up straight and tail swishes back and forth at max speed*\n\n<@${interaction.user.id}> is wagging their tail super happily at <@${cutie.id}>!! ${pick('online')}`
        : `*bounces on tiptoes in striped thigh-highs*\n\n<@${interaction.user.id}> can't stop wagging their tail happily!! ${pick('online')}`;
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
  }

  // /lovecount
  if (interaction.commandName === 'lovecount') {
    const cutie = interaction.options.getUser('cutie', true);
    const count = affectionCounts.get(`${interaction.user.id}->${cutie.id}`) || 0;
    await interaction.reply({
      embeds: [{
        title: `Affection Meter~ ${pick('affection')}`,
        description: `*tail wags happily!*\n\n<@${interaction.user.id}> has snuggled, hugged, kissed, licked, booped, nibbled, or headpatted <@${cutie.id}> **${count}** time${count === 1 ? '' : 's'}! ${pick('cute')}`,
        color: PASTEL_PINK,
        thumbnail: { url: cutie.displayAvatarURL({ size: 256 }) }
      }]
    });
  }

  // /avatar
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
          description: `*ears perk up!* Showing **${fullUser.username}** (\`${fullUser.id}\`), uwu~`,
          color: PASTEL_PURPLE,
          thumbnail: { url: avatarUrl },
          image: bannerUrl ? { url: bannerUrl } : undefined,
          fields: [
            { name: 'Username', value: `\`${fullUser.username}\``, inline: true },
            { name: 'Display Name', value: `\`${fullUser.globalName || 'None'}\``, inline: true }
          ],
          timestamp: new Date().toISOString()
        }],
        components: buildAssetButtons(avatarUrl, bannerUrl, decoUrl)
      });
    } catch {
      await interaction.editReply(`Awr~ I couldn’t find anyone with that ID! Make sure Developer Mode is on and copy the numeric User ID, >_<`);
    }
  }

  // /stats
  if (interaction.commandName === 'stats') {
    const uptimeSec = Math.floor(process.uptime());
    const mins = Math.floor(uptimeSec / 60);
    const hrs = Math.floor(mins / 60);
    await interaction.reply({
      embeds: [{
        title: `furry Status & Paw-formance~ ${pick('online')}`,
        description: '*tail wags happily!* Cozy, awake, and ready for snuggles in DMs and servers, uwu~',
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
    bot: client.user?.tag || 'booting...',
    totalAffectionDelivered,
    uptimeSeconds: Math.floor(process.uptime())
  }));
}).listen(PORT, () => {
  console.log(`Health server listening on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
