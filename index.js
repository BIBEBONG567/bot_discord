require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');

const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', bot: 'running' }));
    } else {
        res.writeHead(404);
        res.end();
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Health Server] Đang chạy trên cổng ${PORT}`);
});

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const API_EXE_LIST_PATH = process.env.API_EXE_LIST_PATH || '/api/admin/payloads'; // Đã đổi thành path mới

client.once('ready', () => {
    console.log(`[Bot] Đã đăng nhập thành công dưới tên ${client.user.tag}!`);
});

function hasPermission(member) {
    return member.roles.highest.position > member.guild.members.me.roles.highest.position;
}

async function getAdminToken() {
    const loginRes = await axios.post(`${process.env.SERVER_URL}/api/admin/login`, {
        username: process.env.ADMIN_USER,
        password: process.env.ADMIN_PASS
    });
    return loginRes.data.token;
}

async function generateKey(days) {
    const adminToken = await getAdminToken();
    const createKeyRes = await axios.post(
        `${process.env.SERVER_URL}/api/admin/keys`,
        { days: days, count: 1 },
        { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    return createKeyRes.data.keys[0];
}

async function getExeList() {
    try {
        const adminToken = await getAdminToken();
        const res = await axios.get(`${process.env.SERVER_URL}${API_EXE_LIST_PATH}`, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        return res.data;
    } catch (error) {
        console.error('[CẢNH BÁO] Không thể lấy danh sách EXE. Kiểm tra lại API.');
        return []; 
    }
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!key') {
        if (!hasPermission(message.member)) return message.reply('❌ Bạn không có quyền sử dụng lệnh này.');

        const embed = new EmbedBuilder()
            .setColor('#c96f3a')
            .setTitle('🛒 Cửa Hàng Bán Key')
            .setDescription('Vui lòng chọn thời hạn bạn muốn mua từ menu bên dưới.');

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_key_duration')
            .setPlaceholder('Chọn thời hạn key...')
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('Key 1 Ngày').setValue('1').setEmoji('🎫'),
                new StringSelectMenuOptionBuilder().setLabel('Key 7 Ngày').setValue('7').setEmoji('🎟️'),
                new StringSelectMenuOptionBuilder().setLabel('Key 30 Ngày').setValue('30').setEmoji('💳'),
                new StringSelectMenuOptionBuilder().setLabel('Key 90 Ngày').setValue('90').setEmoji('💎'),
                new StringSelectMenuOptionBuilder().setLabel('Key 365 Ngày (Vĩnh Viễn)').setValue('365').setEmoji('👑')
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);
        await message.reply({ embeds: [embed], components: [row] });
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isStringSelectMenu()) return;

    if (interaction.customId === 'select_key_duration') {
        if (!hasPermission(interaction.member)) return interaction.reply({ content: '❌ Bạn không có quyền.', ephemeral: true });

        const days = parseInt(interaction.values[0]);
        await interaction.reply({ content: `⏳ Đang tạo Key ${days} ngày...`, ephemeral: true });

        try {
            const newKey = await generateKey(days);
            const exeList = await getExeList();

            const resultEmbed = new EmbedBuilder()
                .setColor('#7a9a4a')
                .setTitle('🎉 Tạo Key Thành Công')
                .setDescription(`<@${interaction.user.id}> đã tạo thành công Key thời hạn **${days} ngày**.`)
                .addFields(
                    { name: 'License Key', value: `\`\`\`${newKey}\`\`\`` },
                    { name: 'Thời hạn', value: `${days} ngày` },
                    { name: 'Hướng dẫn', value: 'Mở phần mềm Loader, dán Key này vào và bấm Kích Hoạt.' }
                )
                .setTimestamp();

            const components = [];

            if (exeList && exeList.length > 0) {
                const exeMenu = new StringSelectMenuBuilder()
                    .setCustomId(`assign_exe_${newKey}`)
                    .setPlaceholder('Chọn file EXE để gán vào Key này...')
                    .addOptions(
                        exeList.slice(0, 25).map(exe => 
                            new StringSelectMenuOptionBuilder()
                                .setLabel(exe.name || exe.ten_file || `File ID: ${exe.id}`)
                                .setValue(exe.id.toString())
                        )
                    );
                components.push(new ActionRowBuilder().addComponents(exeMenu));
            } else {
                resultEmbed.addFields({ name: '⚠️ Lưu ý', value: 'Không thể lấy danh sách EXE từ Web.' });
            }

            await interaction.channel.send({ embeds: [resultEmbed], components: components });
            await interaction.message.delete();

        } catch (error) {
            console.error('Lỗi API:', error.response ? error.response.data : error.message);
            await interaction.followUp({ content: '❌ Lỗi kết nối tới Server.', ephemeral: true });
        }
    }

    if (interaction.customId.startsWith('assign_exe_')) {
        if (!hasPermission(interaction.member)) return interaction.reply({ content: '❌ Bạn không có quyền.', ephemeral: true });

        const keyCode = interaction.customId.replace('assign_exe_', '');
        const exeId = interaction.values[0];

        await interaction.reply({ content: `⏳ Đang gán EXE vào Key \`${keyCode}\`...`, ephemeral: true });

        try {
            const adminToken = await getAdminToken();
            // Đã đổi thành axios.post để khớp với Backend
            await axios.post(`${process.env.SERVER_URL}/api/admin/keys/${keyCode}/assign-exe`, 
                { exe_id: exeId },
                { headers: { Authorization: `Bearer ${adminToken}` } }
            );

            await interaction.editReply({ content: `✅ Đã gán thành công EXE vào Key \`${keyCode}\`!` });
            await interaction.message.edit({ components: [] });

        } catch (error) {
            console.error('Lỗi API Gán EXE:', error.response ? error.response.data : error.message);
            await interaction.editReply({ content: '❌ Lỗi kết nối tới Server khi gán EXE.' });
        }
    }
});

client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error("LỖI ĐĂNG NHẬP BOT:", err.message);
});
