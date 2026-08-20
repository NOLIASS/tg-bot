const { Telegraf, Markup } = require('telegraf');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const bot = new Telegraf(process.env.BOT_TOKEN);

// ЗАМІНИ 'https://your-domain.vercel.app' НА СВІЙ АКТУАЛЬНИЙ ДОМЕН/URL VERCEL
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://your-domain.vercel.app';

async function sendDashboard(ctx, isEdit = false) {
  const text = `
🌐 *ПЕРСОНАЛЬНИЙ ХАБ*
────────────────────────
Натисни кнопку нижче, щоб відкрити повноцінну панель керування з боковим меню:
`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.webApp('🎛 Відкрити Панель Хабу', WEB_APP_URL)]
  ]);

  if (isEdit) {
    try {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    } catch (e) {
      await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
    }
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
  }
}

bot.start(async (ctx) => {
  await sendDashboard(ctx, false);
});

bot.action('main_menu', async (ctx) => {
  await sendDashboard(ctx, true);
});

// Обробник текстових повідомлень (наприклад, збереження замін/нотаток)
bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();

  // Зберігаємо текстове повідомлення у базу як швидку нотатку
  await prisma.quickNote.create({
    data: { content: text }
  });

  try {
    await ctx.deleteMessage();
  } catch (e) {}

  await ctx.reply('✅ Повідомлення збережено в хаб!');
  return sendDashboard(ctx, false);
});

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body);
      return res.status(200).send('OK');
    }
    return res.status(200).send('Hub Bot is running');
  } catch (e) {
    console.error(e);
    return res.status(500).send('Error');
  }
};