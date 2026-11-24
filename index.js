import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder
} from 'discord.js';
import 'dotenv/config';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

const LOG_WEBHOOK_URL = process.env.LOG_WEBHOOK_URL;

const STATUS_LABELS = {
  online: '🟢 Online',
  idle: '🌙 Idle',
  dnd: '⛔ Do Not Disturb',
  offline: '⚫ Offline'
};

function getCustomStatus(presence) {
  const custom = presence?.activities?.find((a) => a.type === 4);
  if (!custom) return null;
  const emoji = custom.emoji ? `${custom.emoji.name} ` : '';
  return `${emoji}${custom.state || ''}`.trim() || null;
}

async function sendLogEmbed(embed) {
  if (!LOG_WEBHOOK_URL) {
    console.warn('Missing LOG_WEBHOOK_URL environment variable!');
    return;
  }
  await fetch(LOG_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'furry :3',
      embeds: [embed]
    })
  }).catch(console.error);
}

// 1. Automatic Status & Custom Status Logger
client.on(Events.PresenceUpdate, async (oldPresence, newPresence) => {
  const member = newPresence.member;
  if (!member || member.user.bot) return;

  const oldStatus = oldPresence?.status || 'offline';
  const newStatus = newPresence.status || 'offline';
  const oldCustom = getCustomStatus(oldPresence);
  const newCustom = getCustomStatus(newPresence);

  if (oldStatus === newStatus && oldCustom === newCustom) return;

  const fullUser = await member.user.fetch(true).catch(() => member.user);
  const avatarUrl = fullUser.displayAvatarURL({ size: 512 });
  const bannerUrl = fullUser.bannerURL({ size: 1024 });

  const fields = [
    {
      name: 'Status',
      value: `${STATUS_LABELS[oldStatus] || oldStatus} ➜ **${STATUS_LABELS[newStatus] || newStatus}**`,
      inline: true
    }
  ];

  if (newCustom) {
    fields.push({ name: 'Custom Status', value: `\`${newCustom}\``, inline: true });
  }

  fields.push({
    name: 'Assets',
    value: `[Avatar (PFP)](${avatarUrl})${bannerUrl ? ` • [Banner](${bannerUrl})` : ' • *No Banner*'}`,
    inline: false
  });

  await sendLogEmbed({
    title: '✨ Status Update',
    description: `**${fullUser.username}** (<@${fullUser.id}>)`,
    color: 0xff85c0,
    thumbnail: { url: avatarUrl },
    image: bannerUrl ? { url: bannerUrl } : undefined,
    fields,
    timestamp: new Date().toISOString()
  });
});

// 2. Automatic Username, Display Name, PFP & Banner Logger
client.on(Events.UserUpdate, async (oldUser, newUser) => {
  if (newUser.bot) return;

  const fullNew = await newUser.fetch(true).catch(() => newUser);
  const oldAvatar = oldUser.displayAvatarURL({ size: 512 });
  const newAvatar = fullNew.displayAvatarURL({ size: 512 });
  const oldBanner = oldUser.bannerURL({ size: 1024 });
  const newBanner = fullNew.bannerURL({ size: 1024 });

  const changes = [];

  if (oldUser.username !== fullNew.username) {
    changes.push(`**Username:** \`${oldUser.username}\` ➜ \`${fullNew.username}\``);
  }
  if (oldUser.globalName !== fullNew.globalName) {
    changes.push(`**Display Name:** \`${oldUser.globalName || 'None'}\` ➜ \`${fullNew.globalName || 'None'}\``);
  }
  if (oldAvatar !== newAvatar) {
    changes.push(`**Avatar (PFP):** Updated! [New PFP](${newAvatar})`);
  }
  if (oldBanner !== newBanner) {
    changes.push(
      newBanner
        ? `**Banner:** Updated! [New Banner](${newBanner})`
        : '**Banner:** Removed'
    );
  }

  if (changes.length === 0) return;

  await sendLogEmbed({
    title: '🌸 Profile Updated',
    description: `**${fullNew.username}** (<@${fullNew.id}>)\n\n${changes.join('\n')}`,
    color: 0xb388ff,
    thumbnail: { url: newAvatar },
    image: newBanner ? { url: newBanner } : undefined,
    timestamp: new Date().toISOString()
  });
});

// 3. Register /lookup Command on Ready
client.once(Events.ClientReady, async () => {
  console.log(`furry online as ${client.user.tag} :3`);

  const commands = [
    new SlashCommandBuilder()
      .setName('lookup')
      .setDescription('Log a user’s current username, PFP, banner, and status to the webhook')
      .addUserOption((opt) =>
        opt.setName('user').setDescription('Target user').setRequired(true)
      )
      .toJSON()
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands }).catch(console.error);
});

// 4. Handle /lookup Slash Command
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'lookup') return;
  await interaction.deferReply({ ephemeral: true });

  const targetUser = interaction.options.getUser('user', true);
  const fullUser = await targetUser.fetch(true).catch(() => targetUser);
  const member = await interaction.guild?.members.fetch(fullUser.id).catch(() => null);

  const status = member?.presence?.status || 'offline';
  const customStatus = getCustomStatus(member?.presence);
  const avatarUrl = fullUser.displayAvatarURL({ size: 512 });
  const bannerUrl = fullUser.bannerURL({ size: 1024 });

  const fields = [
    { name: 'Username', value: `\`${fullUser.username}\``, inline: true },
    { name: 'Display Name', value: `\`${fullUser.globalName || 'None'}\``, inline: true },
    { name: 'Status', value: STATUS_LABELS[status] || status, inline: true }
  ];

  if (customStatus) {
    fields.push({ name: 'Custom Status', value: `\`${customStatus}\``, inline: false });
  }

  fields.push({
    name: 'Assets',
    value: `[Avatar (PFP)](${avatarUrl})${bannerUrl ? ` • [Banner](${bannerUrl})` : ' • *No Banner*'}`,
    inline: false
  });

  await sendLogEmbed({
    title: '🔍 Manual Profile Snapshot',
    description: `Target: <@${fullUser.id}> (\`${fullUser.id}\`)`,
    color: 0xff99cc,
    thumbnail: { url: avatarUrl },
    image: bannerUrl ? { url: bannerUrl } : undefined,
    fields,
    timestamp: new Date().toISOString()
  });

  await interaction.editReply(`Sent **${fullUser.username}**'s profile & status snapshot to your webhook! :3`);
});

client.login(process.env.DISCORD_TOKEN);
