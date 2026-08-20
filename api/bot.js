const { Telegraf, Markup } = require('telegraf');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const bot = new Telegraf(process.env.BOT_TOKEN);

// Просте сховище станів для введення текстів (для Serverless краще використовувати пам'ять на час сесії)
const userState = {};

// --- КЛАВІАТУРИ ---
const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback('🧴 Догляд', 'menu_skincare'), Markup.button.callback('📚 Розклад пар', 'menu_schedule')],
  [Markup.button.callback('📝 ДЗ та Дедлайни', 'menu_hw'), Markup.button.callback('⚙️ Налаштування', 'menu_settings')]
]);

const backToMain = Markup.inlineKeyboard([
  [Markup.button.callback('« Головне меню', 'main_menu')]
]);

// /start
bot.start(async (ctx) => {
  delete userState[ctx.from.id];
  await ctx.reply('👋 Привіт! Я твій універсальний асистент. Обери розділ нижче:', mainMenu);
});

bot.action('main_menu', async (ctx) => {
  delete userState[ctx.from.id];
  await ctx.editMessageText('Головне меню:', mainMenu);
});

// ================= МЕНЮ: ДОГЛЯД =================
bot.action('menu_skincare', async (ctx) => {
  const items = await prisma.skincareItem.findMany();
  let buttons = items.map(item => [
    Markup.button.callback(`✨ ${item.name} (${item.scheduleDays})`, `skin_view_${item.id}`)
  ]);
  buttons.push([Markup.button.callback('➕ Додати засіб', 'skin_add')]);
  buttons.push([Markup.button.callback('« Головне меню', 'main_menu')]);

  await ctx.editMessageText('🧴 *Трекер догляду за обличчям:*\nОбери засіб для перегляду/видалення або додай новий:', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
});

bot.action('skin_add', async (ctx) => {
  userState[ctx.from.id] = { step: 'skin_wait_name' };
  await ctx.editMessageText('✍️ Введи назву засобу (наприклад, *Азелаїнка* або *Пінка*):', {
    parse_mode: 'Markdown',
    ...backToMain
  });
});

bot.action(/^skin_view_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  const item = await prisma.skincareItem.findUnique({ where: { id } });
  if (!item) return ctx.answerCbQuery('Засіб не знайдено.');

  const text = `🧴 *Засіб:* ${item.name}\n📅 *Дні:* ${item.scheduleDays}\n⏰ *Час:* ${item.timeSlot}`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🗑 Видалити засіб', `skin_del_${item.id}`)],
    [Markup.button.callback('« До догляду', 'menu_skincare')]
  ]);

  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action(/^skin_del_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  await prisma.skincareItem.delete({ where: { id } });
  await ctx.answerCbQuery('Засіб видалено!');
  ctx.chat.id = ctx.chat.id || ctx.update.callback_query.message.chat.id;
  // Повертаємось у меню догляду
  const items = await prisma.skincareItem.findMany();
  let buttons = items.map(i => [Markup.button.callback(`✨ ${i.name}`, `skin_view_${i.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати засіб', 'skin_add')]);
  buttons.push([Markup.button.callback('« Головне меню', 'main_menu')]);
  await ctx.editMessageText('🧴 Засіб видалено. Список оновлено:', Markup.inlineKeyboard(buttons));
});


// ================= МЕНЮ: РОЗКЛАД =================
bot.action('menu_schedule', async (ctx) => {
  const schedule = await prisma.schedule.findMany({ orderBy: { id: 'asc' } });
  let buttons = schedule.map(s => [
    Markup.button.callback(`📚 ${s.dayOfWeek} | ${s.time} - ${s.subject}`, `sched_del_${s.id}`)
  ]);
  buttons.push([Markup.button.callback('➕ Додати пару', 'sched_add')]);
  buttons.push([Markup.button.callback('« Головне меню', 'main_menu')]);

  let text = '📚 *Розклад пар*\nНатисни на пару, щоб видалити її, або додай нову:';
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('sched_add', async (ctx) => {
  userState[ctx.from.id] = { step: 'sched_wait_data' };
  await ctx.editMessageText('✍️ Напиши розклад у форматі:\n`День, Час, Предмет, Аудиторія`\n\n_Приклад: Понеділок, 08:30, Математика, 204_', {
    parse_mode: 'Markdown',
    ...backToMain
  });
});

bot.action(/^sched_del_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  await prisma.schedule.delete({ where: { id } });
  await ctx.answerCbQuery('Пару видалено!');
  // Оновлюємо список
  const schedule = await prisma.schedule.findMany();
  let buttons = schedule.map(s => [Markup.button.callback(`📚 ${s.dayOfWeek} - ${s.subject}`, `sched_del_${s.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати пару', 'sched_add')]);
  buttons.push([Markup.button.callback('« Головне меню', 'main_menu')]);
  await ctx.editMessageText('📚 Пару видалено. Актуальний розклад:', Markup.inlineKeyboard(buttons));
});


// ================= МЕНЮ: ДОМАШНІ ЗАВДАННЯ =================
bot.action('menu_hw', async (ctx) => {
  const homeworks = await prisma.homework.findMany({ where: { isCompleted: false }, orderBy: { dueDate: 'asc' } });
  let buttons = homeworks.map(hw => [
    `📌 ${hw.title} (до ${new Date(hw.dueDate).toLocaleDateString()})`,
    `hw_done_${hw.id}`
  ].map((text, idx) => idx === 0 ? Markup.button.callback(text, `hw_done_${hw.id}`) : null)); // спрощена генерація кнопок виконано
  
  // Перебудуємо кнопки акуратно
  let keyboardButtons = homeworks.map(hw => [
    Markup.button.callback(`✔️ Виконано: ${hw.title}`, `hw_done_${hw.id}`)
  ]);
  keyboardButtons.push([Markup.button.callback('➕ Додати ДЗ', 'hw_add')]);
  keyboardButtons.push([Markup.button.callback('« Головне меню', 'main_menu')]);

  let text = '📝 *Менеджер домашніх завдань*\nСписок активних завдань:';
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(keyboardButtons) });
});

bot.action('hw_add', async (ctx) => {
  userState[ctx.from.id] = { step: 'hw_wait_data' };
  await ctx.editMessageText('✍️ Введи ДЗ у форматі:\n`Предмет/Завдання, ДД.ММ.РРРР`\n\n_Приклад: Фізика лабораторна, 25.08.2026_', {
    parse_mode: 'Markdown',
    ...backToMain
  });
});

bot.action(/^hw_done_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  await prisma.homework.update({ where: { id }, data: { isCompleted: true } });
  await ctx.answerCbQuery('Чудово! Завдання позначено як виконане 🎉');
  
  // Повертаємось у меню ДЗ
  const homeworks = await prisma.homework.findMany({ where: { isCompleted: false } });
  let keyboardButtons = homeworks.map(hw => [Markup.button.callback(`✔️ Виконано: ${hw.title}`, `hw_done_${hw.id}`)]);
  keyboardButtons.push([Markup.button.callback('➕ Додати ДЗ', 'hw_add')]);
  keyboardButtons.push([Markup.button.callback('« Головне меню', 'main_menu')]);
  await ctx.editMessageText('📝 Завдання виконано! Актуальні залишок:', Markup.inlineKeyboard(keyboardButtons));
});

bot.action('menu_settings', async (ctx) => {
  await ctx.editMessageText('⚙️ *Налаштування*\nТут можна керувати сповіщеннями.', { parse_mode: 'Markdown', ...backToMain });
});


// ================= ОБРОБКА ТЕКСТОВИХ ПОВІДОМЛЕНЬ (FSM) =================
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const state = userState[userId];
  const text = ctx.message.text;

  if (!state) {
    return ctx.reply('Використовуй кнопки меню для навігації 👇', mainMenu);
  }

  // Логіка додавання догляду по кроках
  if (state.step === 'skin_wait_name') {
    state.name = text;
    state.step = 'skin_wait_days';
    return ctx.reply('📅 Введи дні використання (наприклад: *Щодня* або *Понеділок, Четвер*):', { parse_mode: 'Markdown' });
  }

  if (state.step === 'skin_wait_days') {
    state.days = text;
    state.step = 'skin_wait_time';
    return ctx.reply('⏰ Введи час / часовий слот (наприклад: *Зранку і ввечері* або *21:00*):');
  }

  if (state.step === 'skin_wait_time') {
    await prisma.skincareItem.create({
      data: {
        name: state.name,
        scheduleDays: state.days,
        timeSlot: text
      }
    });
    delete userState[userId];
    return ctx.reply('✅ Успішно додано новий засіб до трекера!', mainMenu);
  }

  // Логіка додавання розкладу
  if (state.step === 'sched_wait_data') {
    const parts = text.split(',').map(p => p.trim());
    if (parts.length >= 3) {
      await prisma.schedule.create({
        data: {
          dayOfWeek: parts[0],
          time: parts[1],
          subject: parts[2],
          room: parts[3] || 'н/д'
        }
      });
      delete userState[userId];
      return ctx.reply('✅ Пара успішно додана до розкладу!', mainMenu);
    } else {
      return ctx.reply('❌ Неправильний формат. Спробуй ще раз (День, Час, Предмет, Аудиторія):');
    }
  }

  // Логіка додавання ДЗ
  if (state.step === 'hw_wait_data') {
    const parts = text.split(',').map(p => p.trim());
    if (parts.length >= 2) {
      const [day, month, year] = parts[1].split('.');
      const dueDate = new Date(`${year}-${month}-${day}`);
      
      await prisma.homework.create({
        data: {
          title: parts[0],
          dueDate: isNaN(dueDate) ? new Date() : dueDate
        }
      });
      delete userState[userId];
      return ctx.reply('✅ Дедлайн успішно збережено!', mainMenu);
    } else {
      return ctx.reply('❌ Неправильний формат дати. Введи у форматі: Назва, ДД.ММ.РРРР');
    }
  }
});

// --- VERCEL HANDLER ---
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body);
      res.status(200).send('OK');
    } else {
      res.status(200).send('Bot Serverless is active!');
    }
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Error');
  }
};