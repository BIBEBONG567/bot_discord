require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');

// ==========================================
// PHẦN 1: HTTP SERVER (GIỮ BOT KHÔNG BỊ NGỦ)
// ==========================================
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

// ==========================================
// PHẦN 2: CẤU HÌNH DISCORD BOT
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ĐƯỜNG DẪN API LẤY DANH SÁCH EXE (Sửa lại cho khớp với Backend của bạn)
const API_EXE_LIST_PATH = process.env.API_EXE_LIST_PATH || '/api/admin/exe/list';

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

// Hàm lấy danh sách EXE từ Web (Đã bọc try-catch an toàn)
async function getExeList() {
    try {
        const adminToken = await getAdminToken();
        const res = await axios.get(`${process.env.SERVER_URL}${API_EXE_LIST_PATH}`, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        return res.data; // Trả về mảng: [{ id: 1, name: 'app.exe' }, ...]
    } catch (error) {
        console.error('[CẢNH BÁO] Không thể lấy danh sách EXE từ Web. Kiểm tra lại API_EXE_LIST_PATH trong file .env hoặc code Backend.');
        return []; // Trả về mảng rỗng để bot không bị crash
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

    if (message.content.startsWith('!gan_exe')) {
        if (!hasPermission(message.member)) return message.reply('❌ Bạn không có quyền sử dụng lệnh này.');
        
        const args = message.content.split(' ');
        const keyCode = args[1];
        const attachment = message.attachments.first();

        if (!keyCode) return message.reply('⚠️ Cú pháp: `!gan_exe <KEY> (kèm file EXE đính kèm)`');
        if (!attachment || !attachment.name.endsWith('.exe')) return message.reply('⚠️ Vui lòng đính kèm file `.exe`.');

        const processingMsg = await message.reply(`⏳ Đang xử lý gán file EXE vào Key \`${keyCode}\`...`);

        try {
            const adminToken = await getAdminToken();
            const response = await axios.get(attachment.url, { responseType: 'stream' });
            const tempFilePath = path.join(__dirname, attachment.name);
            const writer = fs.createWriteStream(tempFilePath);
            response.data.pipe(writer);
            await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });

            const formData = new FormData();
            formData.append('file', fs.createReadStream(tempFilePath));
            formData.append('name', attachment.name);

            const uploadRes = await axios.post(`${process.env.SERVER_URL}/api/admin/exe/upload`, formData, {
                headers: { ...formData.getHeaders(), Authorization: `Bearer ${adminToken}` }
            });

            const exeId = uploadRes.data.id || uploadRes.data.exeId;
            await axios.put(`${process.env.SERVER_URL}/api/admin/keys/${keyCode}/assign-exe`, 
                { exe_id: exeId },
                { headers: { Authorization: `Bearer ${adminToken}` } }
            );

            fs.unlinkSync(tempFilePath);
            await processingMsg.edit(`✅ Đã gán file \`${attachment.name}\` vào Key \`${keyCode}\`.`);
        } catch (error) {
            console.error('Lỗi API:', error.response ? error.response.data : error.message);
            await processingMsg.edit('❌ Lỗi kết nối tới Server khi gán EXE.');
        }
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

            // Nếu lấy được danh sách EXE thì tạo menu, không thì báo lỗi nhẹ nhàng
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
                resultEmbed.addFields({ name: '⚠️ Lưu ý', value: 'Không thể lấy danh sách EXE từ Web (Hoặc Web đang trống). Hãy kiểm tra lại API Backend.' });
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
            await axios.put(`${process.env.SERVER_URL}/api/admin/keys/${keyCode}/assign-exe`, 
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
