require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const axios = require('axios');
const http = require('http');

// ==========================================
// PHẦN 1: HTTP SERVER CHO RENDER (GIỮ BOT KHÔNG BỊ NGỦ)
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

client.once('ready', () => {
    console.log(`[Bot] Đã đăng nhập thành công dưới tên ${client.user.tag}!`);
});

// Hàm kiểm tra quyền dựa trên cấp bậc Role (Role Hierarchy)
function hasPermission(member) {
    const userHighestRole = member.roles.highest;
    const botHighestRole = member.guild.members.me.roles.highest;
    
    // Chỉ cho phép nếu Role của User CAO HƠN Role của Bot
    if (userHighestRole.position > botHighestRole.position) {
        return true;
    }
    return false;
}

// Hàm gọi API tạo key từ Server Render
async function generateKey(days) {
    // 1. Đăng nhập lấy Token Admin
    const loginRes = await axios.post(`${process.env.SERVER_URL}/api/admin/login`, {
        username: process.env.ADMIN_USER,
        password: process.env.ADMIN_PASS
    });
    const adminToken = loginRes.data.token;

    // 2. Tạo Key
    const createKeyRes = await axios.post(
        `${process.env.SERVER_URL}/api/admin/keys`,
        { days: days, count: 1 },
        { headers: { Authorization: `Bearer ${adminToken}` } }
    );

    return createKeyRes.data.keys[0];
}

// Xử lý khi có tin nhắn chat
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Lệnh gọi Menu: !key
    if (message.content === '!key') {
        // Kiểm tra quyền
        if (!hasPermission(message.member)) {
            return message.reply('❌ Bạn không có quyền sử dụng lệnh này. Role của bạn phải cao hơn Role của Bot.');
        }

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

// Xử lý khi người dùng chọn Menu
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isStringSelectMenu()) return;

    if (interaction.customId === 'select_key_duration') {
        // Kiểm tra quyền
        if (!hasPermission(interaction.member)) {
            return interaction.reply({ content: '❌ Bạn không có quyền làm việc này.', ephemeral: true });
        }

        const days = parseInt(interaction.values[0]);
        
        // Phản hồi ẩn (chỉ người bấm thấy)
        await interaction.reply({ content: `⏳ Đang tạo Key ${days} ngày, vui lòng đợi trong giây lát...`, ephemeral: true });

        try {
            const newKey = await generateKey(days);

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

            // Gửi tin nhắn thành công vào kênh chat
            await interaction.channel.send({ embeds: [resultEmbed] });
            
            // Xóa cái Menu "Cửa Hàng Bán Key" đi để kênh chat sạch sẽ
            await interaction.message.delete();

        } catch (error) {
            console.error('Lỗi API:', error.response ? error.response.data : error.message);
            await interaction.followUp({ content: '❌ Lỗi kết nối tới Server. Vui lòng thử lại sau!', ephemeral: true });
        }
    }
});

// Đăng nhập Bot và bắt lỗi nếu Token sai
client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error("LỖI ĐĂNG NHẬP BOT (Kiểm tra lại DISCORD_TOKEN trong file .env):", err.message);
});