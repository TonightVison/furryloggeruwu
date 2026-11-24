import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder
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
const POLL_INTERVAL_MS = 5 * 60 * 1000; // Check external tracked users every 5 minutes

// Load any comma-separated IDs from Render env var TRACKED_USER_IDS (e.g. "123456789,987654321")
const trackedUsers = new Map();
if (process.env.TRACKED_USER_IDS) {
  for (const rawId of process.env.TRACKED_USER_IDS.split(',')) {
    const id = rawId.trim();
    if (/^\d{17,20}$/.test(id)) {
      trackedUsers.set(id, null);
    }
  }
}

const STATUS_LABELS = {
  online: '🟢 Online',
  idle: '🌙 Idle',
  dnd: '⛔ Do Not Disturb',
  offline: '⚫ Offline / Unavailable'
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

// Helper to snapshot a user's public profile fields
function buildSnapshot(user) {
  return {
    username: user.username,
    globalName: user.globalName || null,
    avatarUrl: user.displayAvatarURL({ size: 512 }),
    bannerUrl: user.bannerURL({ size: 1024 }) || null
  };
}

// 1. Live Status & Custom Status Logger (Server Members Only — Discord API rule!)
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

// 2. Live Username, Display Name, PFP & Banner Logger (Server Members)
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

// 3. Poll External Tracked User IDs (Users NOT in the server!)
async function pollTrackedUsers() {
  for (const [userId, prev] of trackedUsers.entries()) {
    try {
      const fullUser = await client.users.fetch(userId, { force: true });
      const current = buildSnapshot(fullUser);

      if (!prev) {
        trackedUsers.set(userId, current);
        continue;
      }

      const changes = [];
      if (prev.username !== current.username) {
        changes.push(`**Username:** \`${prev.username}\` ➜ \`${current.username}\``);
      }
      if (prev.globalName !== current.globalName) {
        changes.push(`**Display Name:** \`${prev.globalName || 'None'}\` ➜ \`${current.globalName || 'None'}\``);
      }
      if (prev.avatarUrl !== current.avatarUrl) {
        changes.push(`**Avatar (PFP):** Updated! [New PFP](${current.avatarUrl})`);
      }
      if (prev.bannerUrl !== current.bannerUrl) {
        changes.push(
          current.bannerUrl
            ? `**Banner:** Updated! [New Banner](${current.bannerUrl})`
            : '**Banner:** Removed'
        );
      }

      trackedUsers.set(userId, current);

      if (changes.length > 0) {
        await sendLogEmbed({
          title: '🌸 External User Updated',
          description: `**${current.username}** (\`${userId}\`)\n\n${changes.join('\n')}`,
          color: 0xb388ff,
          thumbnail: { url: current.avatarUrl },
          image: current.bannerUrl ? { url: current.bannerUrl } : undefined,
          timestamp: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error(`Failed to fetch tracked user ${userId}:`, err.message);
    }
  }
}

// 4. Register Slash Commands
client.once(Events.ClientReady, async () => {
  console.log(`furry online as ${client.user.tag} :3`);

  const commands = [
    new SlashCommandBuilder()
      .setName('lookup')
      .setDescription('Log any user’s current username, PFP, banner, and status (if in server)')
      .addStringOption((opt) =>
        opt.setName('user_id').setDescription('Discord User ID (works even outside the server!)').setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('track')
      .setDescription('Add a user ID (even outside the server) to monitor profile changes')
      .addStringOption((opt) =>
        opt.setName('user_id').setDescription('Discord User ID to track').setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('untrack')
      .setDescription('Stop monitoring an external user ID')
      .addStringOption((opt) =>
        opt.setName('user_id').setDescription('Discord User ID to remove').setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('tracked')
      .setDescription('List all external user IDs currently being tracked')
      .toJSON()
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands }).catch(console.error);

  await pollTrackedUsers();
  setInterval(pollTrackedUsers, POLL_INTERVAL_MS);
});

// 5. Handle Slash Commands
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'lookup') {
    await interaction.deferReply({ ephemeral: true });
    const rawId = interaction.options.getString('user_id', true).replace(/[<@!>]/g, '').trim();

    try {
      const fullUser = await client.users.fetch(rawId, { force: true });
      const member = await interaction.guild?.members.fetch(fullUser.id).catch(() => null);

      const status = member ? (member.presence?.status || 'offline') : null;
      const customStatus = member ? getCustomStatus(member.presence) : null;
      const avatarUrl = fullUser.displayAvatarURL({ size: 512 });
      const bannerUrl = fullUser.bannerURL({ size: 1024 });

      const fields = [
        { name: 'Username', value: `\`${fullUser.username}\``, inline: true },
        { name: 'Display Name', value: `\`${fullUser.globalName || 'None'}\``, inline: true },
        {
          name: 'Status',
          value: member ? (STATUS_LABELS[status] || status) : '*Not in server (unavailable)*',
          inline: true
        }
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
        title: '🔍 Profile Snapshot',
        description: `Target: **${fullUser.username}** (\`${fullUser.id}\`)`,
        color: 0xff99cc,
        thumbnail: { url: avatarUrl },
        image: bannerUrl ? { url: bannerUrl } : undefined,
        fields,
        timestamp: new Date().toISOString()
      });

      await interaction.editReply(`Sent **${fullUser.username}**'s profile snapshot to your webhook! :3`);
    } catch {
      await interaction.editReply('Could not find a Discord user with that ID! Make sure Developer Mode is on and you copied the numeric User ID, >_<');
    }
  }

  if (interaction.commandName === 'track') {
    await interaction.deferReply({ ephemeral: true });
    const rawId = interaction.options.getString('user_id', true).replace(/[<@!>]/g, '').trim();

    if (!/^\d{17,20}$/.test(rawId)) {
      return interaction.editReply('Please enter a valid numeric Discord User ID! :3');
    }

    try {
      const fullUser = await client.users.fetch(rawId, { force: true });
      trackedUsers.set(rawId, buildSnapshot(fullUser));
      await interaction.editReply(
        `Now tracking **${fullUser.username}** (\`${rawId}\`) every 5 minutes for username, display name, PFP, and banner updates! :3\n*(Tip: Add \`${rawId}\` to \`TRACKED_USER_IDS\` in Render if you want it saved across restarts!)*`
      );
    } catch {
      await interaction.editReply('Could not fetch that User ID—double-check that it is valid! >_<');
    }
  }

  if (interaction.commandName === 'untrack') {
    const rawId = interaction.options.getString('user_id', true).replace(/[<@!>]/g, '').trim();
    const removed = trackedUsers.delete(rawId);
    await interaction.reply({
      content: removed ? `Stopped tracking \`${rawId}\`! :3` : `\`${rawId}\` wasn't on the tracking list, uwu`,
      ephemeral: true
    });
  }

  if (interaction.commandName === 'tracked') {
    const ids = [...trackedUsers.keys()];
    await interaction.reply({
      content: ids.length
        ? `**Currently tracked external User IDs (${ids.length}):**\n${ids.map((id) => `• \`${id}\``).join('\n')}`
        : 'No external User IDs are being tracked yet! Use `/track user_id:...` to add someone :3',
      ephemeral: true
    });
  }
});

// 6. Tiny HTTP Keep-Alive Server for Render's Free Web Service
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('furry is awake :3');
}).listen(PORT, () => {
  console.log(`Health server listening on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
