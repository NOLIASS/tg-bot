const { Telegraf, Markup } = require('telegraf');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const bot = new Telegraf(process.env.BOT_TOKEN);

// Головне меню
const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback('🧴 Догляд', 'menu_skincare'), Markup.button.callback('📚 Розклад', 'menu_schedule')],
  [Markup.button.callback('📝 Домашні завдання', 'menu_hw'), Markup.button.callback('⚙️ Налаштування', 'menu_settings')]
]);

const backBtn = Markup.inlineKeyboard([Markup.button.callback('« Назад', 'main_menu')]);

// Команда /start
bot.start((ctx) => ctx.reply('Привіт! Я твій студентський асистент.', mainMenu));

// Обробка кнопок
bot.action('main_menu', (ctx) => ctx.editMessageText('Головне меню:', mainMenu));

bot.action('menu_schedule', async (ctx) => {
  const data = await prisma.schedule.findMany();
  let text = data.length ? data.map(i => `${i.dayOfWeek} ${i.time}: ${i.subject}`).join('\n') : 'Розклад порожній.';
  ctx.editMessageText(text, backBtn);
});

bot.action('menu_hw', async (ctx) => {
  const data = await prisma.homework.findMany({ where: { isCompleted: false } });
  let text = data.length ? data.map(i => `${i.title} (до ${i.dueDate.toLocaleDateString()})`).join('\n') : 'Дедлайнів немає!';
  ctx.editMessageText(text, backBtn);
});

bot.action('menu_skincare', async (ctx) => {
  const data = await prisma.skincareItem.findMany();
  let text = data.length ? data.map(i => `${i.name} (частота: ${i.frequencyDays} дн.)`).join('\n') : 'Список догляду порожній.';
  ctx.editMessageText(text, backBtn);
});

bot.action('menu_settings', (ctx) => ctx.editMessageText('Тут будуть налаштування.', backBtn));

// Логіка Vercel Webhook
module.exports = async (req, res) => {
  if (req.method === 'POST') {
    await bot.handleUpdate(req.body);
    return res.status(200).send('OK');
  }
  return res.status(200).send('Bot is running');
};