// npm i discord.js mineflayer dotenv
// .env: TOKEN= OWNER_ID= PANEL_CHANNEL= MC_EMAIL= (MS login) MC_NAME=Minoplays
require('dotenv').config();
const fs = require('fs');
const {
  Client, GatewayIntentBits: G, EmbedBuilder, ActionRowBuilder: Row, ButtonBuilder, ButtonStyle: BS,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle: TS, ChannelType,
  SlashCommandBuilder, PermissionFlagsBits, MessageFlags
} = require('discord.js');
const mineflayer = require('mineflayer');

const E = process.env;
const F = 'data.json';
const db = fs.existsSync(F) ? JSON.parse(fs.readFileSync(F)) :
  { access: [], mods: [], users: {}, orders: {}, n: 329, rate: 0.0075, fundsUSD: 161 };
const save = () => fs.writeFileSync(F, JSON.stringify(db, null, 1));

const COINS = {
  LTC: { cg: 'litecoin', label: 'LTC', net: 'Litecoin' },
  BNB: { cg: 'binancecoin', label: 'BNB', net: 'BNB Chain' },
  USDT: { cg: 'tether', label: 'USDT (BEP-20)', net: 'BEP-20' },
  USDC: { cg: 'usd-coin', label: 'USDC (BEP-20)', net: 'BEP-20' },
  SOL: { cg: 'solana', label: 'SOL', net: 'Solana' },
  ETH: { cg: 'ethereum', label: 'ETH', net: 'Ethereum' },
};
const ADDR = { // basic address sanity
  LTC: /^(ltc1|[LM3])[a-zA-Z0-9]{25,60}$/, BNB: /^0x[a-fA-F0-9]{40}$/, USDT: /^0x[a-fA-F0-9]{40}$/,
  USDC: /^0x[a-fA-F0-9]{40}$/, ETH: /^0x[a-fA-F0-9]{40}$/, SOL: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
};
const MAX = 5e9, MIN = 133.33e6, EXPIRE = 30 * 60e3;

const canUse = id => id === E.OWNER_ID || db.access.includes(id);
const parseAmt = s => {
  const m = /^([\d.]+)\s*([kmbt]?)$/i.exec(s.trim().replace(/[$,]/g, ''));
  if (!m) return NaN;
  return parseFloat(m[1]) * { '': 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[2].toLowerCase()];
};
const fmt = n => n >= 1e9 ? +(n / 1e9).toFixed(2) + 'b' : n >= 1e6 ? +(n / 1e6).toFixed(2) + 'm' : n >= 1e3 ? +(n / 1e3).toFixed(2) + 'k' : '' + n;
const usdOf = amt => +(amt / 1e6 * db.rate).toFixed(2);

async function mojang(name) { // returns {id,name} or null
  try {
    const r = await fetch('https://api.mojang.com/users/profiles/minecraft/' + encodeURIComponent(name));
    return r.status === 200 ? await r.json() : null;
  } catch { return null; }
}
const skin = id => `https://mc-heads.net/avatar/${id}/128`;
async function price(cg) {
  const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cg}&vs_currencies=usd`);
  return (await r.json())[cg].usd;
}

// ---------- embeds ----------
const panelEmbed = () => new EmbedBuilder().setColor(0x2b1a2e)
  .setTitle('💸 Sell In-Game Money')
  .setDescription(
    'Pay the bot in-game and receive **LTC, ETH, BNB, SOL, USDT or USDC** in your wallet **automatically**, with a blockchain transaction link.\n──────────\n' +
    `**Rate:** $${db.rate} per 1m\n**Payout funds:** ≈ $${db.fundsUSD}\n**Limits:** $${+(MIN / 1e6).toFixed(2)}m min • $5b max\n──────────\n` +
    'Click **Sell Now**, pick the coin you want, and a private thread is created for your order. Your username and wallet are saved for next time.')
  .setTimestamp();
const panelRow = () => new Row().addComponents(
  new ButtonBuilder().setCustomId('sell').setLabel('Sell Now').setEmoji('💸').setStyle(BS.Primary));

// ---------- client ----------
const client = new Client({ intents: [G.Guilds] });

client.once('clientReady', async () => {
  const cmds = [
    new SlashCommandBuilder().setName('panel').setDescription('Post sell panel'),
    new SlashCommandBuilder().setName('access').setDescription('Who can use bot cmds')
      .addSubcommand(s => s.setName('add').setDescription('add').addUserOption(o => o.setName('user').setRequired(true).setDescription('u')))
      .addSubcommand(s => s.setName('remove').setDescription('remove').addUserOption(o => o.setName('user').setRequired(true).setDescription('u')))
      .addSubcommand(s => s.setName('list').setDescription('list')),
    new SlashCommandBuilder().setName('mods').setDescription('Mods auto-added to every thread')
      .addSubcommand(s => s.setName('add').setDescription('add').addUserOption(o => o.setName('user').setRequired(true).setDescription('u')))
      .addSubcommand(s => s.setName('remove').setDescription('remove').addUserOption(o => o.setName('user').setRequired(true).setDescription('u')))
      .addSubcommand(s => s.setName('list').setDescription('list')),
    new SlashCommandBuilder().setName('setrate').setDescription('USD per 1m')
      .addNumberOption(o => o.setName('rate').setRequired(true).setDescription('e.g. 0.0075')),
    new SlashCommandBuilder().setName('setfunds').setDescription('Payout funds shown on panel (USD)')
      .addNumberOption(o => o.setName('usd').setRequired(true).setDescription('usd')),
    new SlashCommandBuilder().setName('checkign').setDescription('Check IGN exists + skin')
      .addStringOption(o => o.setName('ign').setRequired(true).setDescription('ign')),
  ].map(c => c.setDefaultMemberPermissions(null).toJSON());
  await client.application.commands.set(cmds);
  console.log('up', client.user.tag);
});

client.on('interactionCreate', async i => {
  try {
    // ---- slash cmds: allowlist only ----
    if (i.isChatInputCommand()) {
      if (!canUse(i.user.id)) return i.reply({ content: 'No access.', flags: MessageFlags.Ephemeral });
      const eph = { flags: MessageFlags.Ephemeral };
      if (i.commandName === 'panel') {
        const m = await i.channel.send({ embeds: [panelEmbed()], components: [panelRow()] });
        db.panel = { c: m.channelId, m: m.id }; save();
        return i.reply({ content: 'Posted.', ...eph });
      }
      if (i.commandName === 'access' || i.commandName === 'mods') {
        const key = i.commandName, sub = i.options.getSubcommand();
        if (key === 'access' && i.user.id !== E.OWNER_ID && sub !== 'list')
          return i.reply({ content: 'Owner only.', ...eph });
        if (sub === 'list') return i.reply({ content: db[key].map(x => `<@${x}>`).join(' ') || 'none', ...eph });
        const u = i.options.getUser('user');
        db[key] = sub === 'add' ? [...new Set([...db[key], u.id])] : db[key].filter(x => x !== u.id);
        save();
        return i.reply({ content: `${sub} ${u} ✔`, ...eph });
      }
      if (i.commandName === 'setrate') { db.rate = i.options.getNumber('rate'); save(); return i.reply({ content: 'ok', ...eph }); }
      if (i.commandName === 'setfunds') { db.fundsUSD = i.options.getNumber('usd'); save(); return i.reply({ content: 'ok', ...eph }); }
      if (i.commandName === 'checkign') {
        const p = await mojang(i.options.getString('ign'));
        return i.reply(p ? { embeds: [new EmbedBuilder().setTitle(p.name).setThumbnail(skin(p.id)).setDescription('✅ exists')], ...eph }
          : { content: '❌ not found', ...eph });
      }
    }

    // ---- Sell Now -> pick coin ----
    if (i.isButton() && i.customId === 'sell') {
      const u = db.users[i.user.id] || {};
      const menu = new StringSelectMenuBuilder().setCustomId('coin').setPlaceholder('Pick a coin')
        .addOptions(Object.entries(COINS).map(([k, c]) => ({
          label: c.label, value: k, description: `Up to $5b in-game` + (u.last === k ? ' • Last used' : '') })));
      return i.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [new EmbedBuilder().setColor(0x2b1a2e).setTitle('💸 Pick your payout coin')
          .setDescription('Which coin and network do you want to be paid in? Only coins we can pay out right now are listed.')],
        components: [new Row().addComponents(menu)],
      });
    }

    // ---- coin chosen -> saved details or modal ----
    if (i.isStringSelectMenu() && i.customId === 'coin') {
      const coin = i.values[0], u = db.users[i.user.id] || {};
      u.pending = coin; db.users[i.user.id] = u; save();
      if (u.ign && u.wallets?.[coin]) return i.update(detailsMsg(i.user.id, coin));
      return i.showModal(detailsModal(coin, u));
    }

    // ---- details modal submit ----
    if (i.isModalSubmit() && i.customId.startsWith('det:')) {
      const coin = i.customId.slice(4);
      const ign = i.fields.getTextInputValue('ign').trim();
      const addr = i.fields.getTextInputValue('addr').trim();
      const priv = /^a/i.test(i.fields.getTextInputValue('priv') || '') ? 'anon' : 'public';
      const p = await mojang(ign);
      if (!p) return i.reply({ content: `❌ IGN \`${ign}\` doesn't exist (Mojang).`, flags: MessageFlags.Ephemeral });
      if (!ADDR[coin].test(addr)) return i.reply({ content: `❌ Bad ${coin} address.`, flags: MessageFlags.Ephemeral });
      const u = db.users[i.user.id] || {};
      Object.assign(u, { ign: p.name, uuid: p.id, priv, last: coin, pending: coin });
      u.wallets = { ...(u.wallets || {}), [coin]: addr };
      db.users[i.user.id] = u; save();
      return i.reply({ ...detailsMsg(i.user.id, coin), flags: MessageFlags.Ephemeral });
    }

    if (i.isButton() && i.customId.startsWith('edit:')) {
      const coin = i.customId.slice(5);
      return i.showModal(detailsModal(coin, db.users[i.user.id] || {}));
    }
    if (i.isButton() && i.customId.startsWith('cont:')) {
      const coin = i.customId.slice(5);
      return i.showModal(new ModalBuilder().setCustomId('amt:' + coin).setTitle('Amount to sell')
        .addComponents(new Row().addComponents(new TextInputBuilder().setCustomId('amt')
          .setLabel('Amount (e.g. 500m, 1b)').setStyle(TS.Short).setRequired(true))));
    }

    // ---- amount -> create order + private thread ----
    if (i.isModalSubmit() && i.customId.startsWith('amt:')) {
      const coin = i.customId.slice(4), u = db.users[i.user.id];
      const amt = parseAmt(i.fields.getTextInputValue('amt'));
      if (!amt || amt < MIN || amt > MAX)
        return i.reply({ content: `❌ Amount must be ${fmt(MIN)} – ${fmt(MAX)}.`, flags: MessageFlags.Ephemeral });
      const usd = usdOf(amt);
      if (usd > db.fundsUSD) return i.reply({ content: '❌ Not enough payout funds.', flags: MessageFlags.Ephemeral });
      const p = await mojang(u.ign); // re-check at order time
      if (!p) return i.reply({ content: '❌ IGN no longer valid.', flags: MessageFlags.Ephemeral });
      await i.deferReply({ flags: MessageFlags.Ephemeral });

      const id = ++db.n;
      const th = await i.channel.threads.create({
        name: `${u.ign.toLowerCase()}-${id}`, type: ChannelType.PrivateThread, invitable: false,
        autoArchiveDuration: 1440 });
      await th.members.add(i.user.id);
      for (const m of db.mods) await th.members.add(m).catch(() => {});

      const order = { id, user: i.user.id, ign: p.name, uuid: p.id, coin, addr: u.wallets[coin], amt, usd,
        thread: th.id, status: 'open', exp: Date.now() + EXPIRE };
      db.orders[id] = order; save();

      const bot = E.MC_NAME || 'Minoplays';
      const emb = new EmbedBuilder().setColor(0x2b1a2e).setThumbnail(skin(p.id))
        .setTitle(`💸 Sell Order #${id}`)
        .setDescription(`Selling **${fmt(amt)}** for **$${usd.toFixed(2)}** in **${coin}**\n──────────\n` +
          `🎮 **Pay in-game from ${p.name} to ${bot}**\n\`\`\`/pay ${bot} ${fmt(amt)}\`\`\`` +
          `This ticket is on **${bot}** — pay that exact name. Max $5b per ticket.\n\n**Payout address:**\n\`\`\`${order.addr}\`\`\`──────────\n` +
          `Expires <t:${Math.floor(order.exp / 1e3)}:R> • The payment **must** come from the username above. Your crypto is sent automatically after we receive it.`);
      await th.send({ embeds: [emb], components: [new Row().addComponents(
        new ButtonBuilder().setCustomId('cancel:' + id).setLabel('Cancel Order').setEmoji('🚫').setStyle(BS.Secondary),
        new ButtonBuilder().setCustomId('close:' + id).setLabel('Close Thread').setEmoji('🔒').setStyle(BS.Secondary))] });
      return i.editReply({ embeds: [new EmbedBuilder().setColor(0x2b1a2e)
        .setTitle(`💸 Order #${id} created — head to your private thread: <#${th.id}>`)] });
    }

    // ---- cancel / close ----
    if (i.isButton() && /^(cancel|close):/.test(i.customId)) {
      const [act, id] = i.customId.split(':'), o = db.orders[id];
      if (!o) return i.reply({ content: 'gone', flags: MessageFlags.Ephemeral });
      if (i.user.id !== o.user && !db.mods.includes(i.user.id) && !canUse(i.user.id))
        return i.reply({ content: 'Not yours.', flags: MessageFlags.Ephemeral });
      if (act === 'cancel' && o.status === 'open') { o.status = 'cancelled'; save(); }
      await i.reply(act === 'cancel' ? 'Order cancelled.' : 'Closing…');
      if (act === 'close') { o.status === 'open' && (o.status = 'cancelled'); save(); await i.channel.setLocked(true).catch(() => {}); await i.channel.setArchived(true).catch(() => {}); }
    }
  } catch (e) {
    console.error(e);
    if (!i.replied && !i.deferred) i.reply({ content: 'Error.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

function detailsModal(coin, u) {
  const t = (id, label, val, req = true, style = TS.Short) =>
    new Row().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(req).setValue(val || ''));
  return new ModalBuilder().setCustomId('det:' + coin).setTitle('Edit your details').addComponents(
    t('ign', 'Minecraft username', u.ign),
    t('addr', `${coin} address`, u.wallets?.[coin]),
    t('priv', 'Privacy (public / anonymous)', u.priv || 'public', false));
}
function detailsMsg(uid, coin) {
  const u = db.users[uid];
  return {
    embeds: [new EmbedBuilder().setColor(0x2b1a2e).setThumbnail(skin(u.uuid)).setTitle(`💸 Getting paid in ${coin}`)
      .setDescription(`In-game payment from **${u.ign}**\nPayout to \`${u.wallets[coin]}\`\nHit **Continue** to enter the amount, or **Edit** to change these.`)],
    components: [new Row().addComponents(
      new ButtonBuilder().setCustomId('cont:' + coin).setLabel('Continue').setEmoji('➡️').setStyle(BS.Success),
      new ButtonBuilder().setCustomId('edit:' + coin).setLabel('Edit').setEmoji('✏️').setStyle(BS.Secondary))],
    components_: undefined,
  };
}

// ---------- payout (YOU implement per coin) ----------
async function payout(o) {
  // TODO: send crypto to o.addr. LTC: litecoin RPC / BlockCypher; BNB/USDT/USDC: ethers + BSC RPC; SOL: @solana/web3.js
  // price: const coinAmt = o.usd / await price(COINS[o.coin].cg);
  // return { txid, url }
  throw new Error('payout() not implemented');
}

// ---------- minecraft bot: watch /pay chat ----------
const mc = mineflayer.createBot({
  host: 'donutsmp.net', username: E.MC_EMAIL, auth: 'microsoft', version: false });
mc.on('spawn', () => console.log('mc in'));
mc.on('end', r => { console.log('mc end', r); process.exit(1); }); // let pm2/systemd restart
// ADJUST regex to real DonutSMP msg, e.g. "Faerex_x paid you $1B."
const PAID = /^(\w{3,16}) (?:paid|sent) you \$?([\d.,]+\s*[kmbt]?)/i;
mc.on('messagecreate', () => {});
mc.on('message', async msg => {
  const m = PAID.exec(msg.toString().trim());
  if (!m) return;
  const from = m[1].toLowerCase(), amt = parseAmt(m[2]);
  const o = Object.values(db.orders).find(x =>
    x.status === 'open' && x.ign.toLowerCase() === from && amt >= x.amt && Date.now() < x.exp);
  if (!o) return;
  o.status = 'paid'; save();
  const th = await client.channels.fetch(o.thread).catch(() => null);
  try {
    const r = await payout(o);
    o.status = 'done'; o.tx = r.txid; save();
    th?.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle(`✅ Order #${o.id} paid`)
      .setDescription(`Sent **$${o.usd.toFixed(2)}** in ${o.coin}\n[Transaction](${r.url})`)] });
  } catch (e) {
    o.status = 'payout_failed'; save();
    th?.send(`⚠️ Payment received, payout failed. Mods: ${db.mods.map(x => `<@${x}>`).join(' ')}`);
  }
});

// expire sweeper
setInterval(async () => {
  for (const o of Object.values(db.orders)) if (o.status === 'open' && Date.now() > o.exp) {
    o.status = 'expired'; save();
    (await client.channels.fetch(o.thread).catch(() => null))?.send('⌛ Order expired.');
  }
}, 30e3);

client.login(E.TOKEN);
