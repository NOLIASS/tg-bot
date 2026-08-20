const { Telegraf, Markup } = require('telegraf');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const bot = new Telegraf(process.env.BOT_TOKEN);

// Тимчасове сховище станів для покрокового введення даних у чаті
const userState = {};

// --- УНІВЕРСАЛЬНІ КЛАВІАТУРИ ---
const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback('🧴 Догляд', 'menu_skincare'), Markup.button.callback('📚 Розклад', 'menu_schedule')],
  [Markup.button.callback('📝 Задачі та ДЗ', 'menu_hw'), Markup.button.callback('🎯 Цілі', 'menu_goals')],
  [Markup.button.callback('⚙️ Налаштування', 'menu_settings')]
]);

const backToMain = Markup.inlineKeyboard([
  [Markup.button.callback('« Головне меню', 'main_menu')]
]);

// Допоміжна функція для отримання або створення налаштувань користувача
async function getSettings(telegramId) {
  let settings = await prisma.userSettings.findUnique({ where: { telegramId: BigInt(telegramId) } });
  if (!settings) {
    settings = await prisma.userSettings.create({
      data: { telegramId: BigInt(telegramId), morningTime: '08:00', eveningTime: '20:00' }
    });
  }
  return settings;
}

// --- СТАРТ ---
bot.start(async (ctx) => {
  delete userState[ctx.from.id];
  await getSettings(ctx.from.id);
  await ctx.reply('👋 Привіт! Я твій особистий асистент та записник.\nОбери потрібний розділ внизу:', mainMenu);
});

bot.action('main_menu', async (ctx) => {
  delete userState[ctx.from.id];
  await ctx.editMessageText('📌 *Головне меню*:', { parse_mode: 'Markdown', ...mainMenu });
});


// ================= 1. ТРЕКЕР ДОГЛЯДУ =================
bot.action('menu_skincare', async (ctx) => {
  const items = await prisma.skincareItem.findMany();
  let buttons = items.map(i => [
    Markup.button.callback(`✨ ${i.name} [${i.timeSlot}]`, `skin_view_${i.id}`)
  ]);
  buttons.push([Markup.button.callback('➕ Додати засіб', 'skin_add')]);
  buttons.push([Markup.button.callback('« Головне меню', 'main_menu')]);

  await ctx.editMessageText('🧴 *Трекер догляду за обличчям*\nОбери засіб для керування:', {
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

  const text = `🧴 *Засіб:* ${item.name}\n📅 *Дні:* ${item.scheduleDays}\n⏰ *Коли:* ${item.timeSlot}`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🗑 Видалити засіб', `skin_del_${item.id}`)],
    [Markup.button.callback('« Назад до догляду', 'menu_skincare')]
  ]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action(/^skin_del_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  await prisma.skincareItem.delete({ where: { id } });
  await ctx.answerCbQuery('Засіб видалено.');
  
  // Повертаємось у меню догляду
  const items = await prisma.skincareItem.findMany();
  let buttons = items.map(i => [Markup.button.callback(`✨ ${i.name}`, `skin_view_${i.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати засіб', 'skin_add')]);
  buttons.push([Markup.button.callback('« Головне меню', 'main_menu')]);
  await ctx.editMessageText('🧴 Засіб видалено. Актуальний список:', Markup.inlineKeyboard(buttons));
});


// ================= 2. РОЗКЛАД ПАР =================
bot.action('menu_schedule', async (ctx) => {
  const schedule = await prisma.schedule.findMany({ orderBy: { id: 'asc' } });
  let buttons = schedule.map(s => [
    Markup.button.callback(`📚 ${s.dayOfWeek} | ${s.time} — ${s.subject}`, `sched_del_${s.id}`)
  ]);
  buttons.push([Markup.button.callback('➕ Додати пару', 'sched_add')]);
  buttons.push([Markup.button.callback('« Головне меню', 'main_menu')]);

  await ctx.editMessageText('📚 *Розклад занять*\nНатисни на пару, щоб видалити її:', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
});

bot.action('sched_add', async (ctx) => {
  userState[ctx.from.id] = { step: 'sched_wait_data' };
  await ctx.editMessageText('✍️ Напиши розклад у форматі:\n`День, Час, Предмет, Аудиторія`\n\n_Приклад: Понеділок, 08:30, Програмування, 302_', {
    parse_mode: 'Markdown',
    ...backToMain
  });
});

bot.action(/^sched_del_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  await prisma.schedule.delete({ where: { id } });
  await ctx.answerCbQuery('Пару видалено.');
  
  const schedule = await prisma.schedule.findMany();
  let buttons = schedule.map(s => [Markup.button.callback(`📚 ${s.dayOfWeek} — ${s.subject}`, `sched_del_${s.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати пару', 'sched_add')]);
  buttons.push([Markup.button.callback('« Головне меню', 'main_menu')]);
  await ctx.editMessageText('📚 Пару видалено:', Markup.inlineKeyboard(buttons));
});


// ================= 3. МЕНЕДЖЕР ЗАДАЧ ТА ДЗ =================
bot.action('menu_hw', async (ctx) => {
  const homeworks = await prisma.homework.findMany({ where: { isCompleted: false }, orderBy: { dueDate: 'asc' } });
  let buttons = homeworks.map(hw => {
    const icon = hw.priority === 'Важливий 🔥' ? '🔥' : '📌';
    const dateStr = new Date(hw.dueDate).toLocaleDateString();
    return [Markup.button.callback(`${icon} ${hw.title} (до ${dateStr})`, `hw_done_${hw.id}`)];
  });
  buttons.push([Markup.button.callback('➕ Додати задачу/ДЗ', 'hw_add')]);
  buttons.push([Markup.button.callback('« Головне меню', 'main_menu')]);

  await ctx.editMessageText('📝 *Менеджер завдань та дедлайнів*\nНатисни на завдання, щоб позначити як виконане:', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
});

bot.action('hw_add', async (ctx) => {
  userState[ctx.from.id] = { step: 'hw_wait_title' };
  await ctx.editMessageText('✍️ Введи назву завдання або предмета:', {
    parse_mode: 'Markdown',
    ...backToMain
  });
});

bot.action(/^hw_done_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  await prisma.homework.update({ where: { id }, data: { isCompleted: true } });
  await ctx.answerCbQuery('Завдання виконано! 🎉');

  const homeworks = await prisma.homework.findMany({ where: { isCompleted: false } });
  let buttons = homeworks.map(hw => [Markup.button.callback(`✔️ ${hw.title}`, `hw_done_${hw.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати задачу/ДЗ', 'hw_add')]);
  buttons.push([Markup.button.callback('« Головне меню', 'main_menu')]);
  await ctx.editMessageText('📝 Актуальні завдання:', Markup.inlineKeyboard(buttons));
});


// ================= 4. ТРЕКЕР ЦІЛЕЙ (З ПРОГРЕСОМ) =================
bot.action('menu_goals', async (ctx) => {
  const goals = await prisma.goal.findMany({ orderBy: { targetDate: 'asc' } });
  let buttons = goals.map(g => [
    Markup.button.callback(`🎯 ${g.title} [${g.progress}%]`, `goal_view_${g.id}`)
  ]);
  buttons.push([Markup.button.callback('➕ Додати ціль', 'goal_add')]);
  buttons.push([Markup.button.callback('« Головне меню', 'main_menu')]);

  await ctx.editMessageText('🎯 *Трекер цілей*\nВибери ціль для перевірки прогресу або редагування:', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
});

bot.action('goal_add', async (ctx) => {
  userState[ctx.from.id] = { step: 'goal_wait_title' };
  await ctx.editMessageText('✍️ Введи назву цілі (наприклад, *Вивчити React Hooks*):', {
    parse_mode: 'Markdown',
    ...backToMain
  });
});

bot.action(/^goal_view_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  const goal = await prisma.goal.findUnique({ where: { id } });
  if (!goal) return ctx.answerCbQuery('Ціль не знайдено.');

  const dateStr = new Date(goal.targetDate).toLocaleDateString();
  const text = `🎯 *Ціль:* ${goal.title}\n📅 *Дедлайн:* ${dateStr}\n📊 *Прогрес:* ${goal.progress}%`;
  
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('➕ 25%', `goal_prog_${goal.id}_25`),
      Markup.button.callback('➕ 50%', `goal_prog_${goal.id}_50`),
      Markup.button.callback('🎉 100%', `goal_prog_${goal.id}_100`)
    ],
    [Markup.button.callback('🗑 Видалити ціль', `goal_del_${goal.id}`)],
    [Markup.button.callback('« До цілей', 'menu_goals')]
  ]);

  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action(/^goal_prog_(\d+)_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  const progress = parseInt(ctx.match[2]);
  await prisma.goal.update({ where: { id }, data: { progress, isCompleted: progress >= 100 } });
  await ctx.answerCbQuery(`Прогрес оновлено: ${progress}% 🚀`);
  
  // Повертаємось у перегляд цілі
  const goal = await prisma.goal.findUnique({ where: { id } });
  const dateStr = new Date(goal.targetDate).toLocaleDateString();
  const text = `🎯 *Ціль:* ${goal.title}\n📅 *Дедлайн:* ${dateStr}\n📊 *Прогрес:* ${goal.progress}%`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('➕ 25%', `goal_prog_${goal.id}_25`), Markup.button.callback('➕ 50%', `goal_prog_${goal.id}_50`), Markup.button.callback('🎉 100%', `goal_prog_${goal.id}_100`)],
    [Markup.button.callback('🗑 Видалити ціль', `goal_del_${goal.id}`)],
    [Markup.button.callback('« До цілей', 'menu_goals')]
  ]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action(/^goal_del_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  await prisma.goal.delete({ where: { id } });
  await ctx.answerCbQuery('Ціль видалено.');
  
  const goals = await prisma.goal.findMany();
  let buttons = goals.map(g => [Markup.button.callback(`🎯 ${g.title} [${g.progress}%]`, `goal_view_${g.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати ціль', 'goal_add')]);
  buttons.push([Markup.button.callback('« Головне меню', 'main_menu')]);
  await ctx.editMessageText('🎯 Ціль видалено:', Markup.inlineKeyboard(buttons));
});


// ================= 5. НАЛАШТУВАННЯ (ДІАПАЗОНИ ЧАСУ) =================
bot.action('menu_settings', async (ctx) => {
  const settings = await getSettings(ctx.from.id);
  const text = `⚙️ *Налаштування сповіщень*\n\n🌅 *Ранковий слот:* ${settings.morningTime} (діапазон 6:00 - 10:00)\n🌃 *Вечірній слот:* ${settings.eveningTime} (діапазон до 00:00)\n🔔 *Статус:* ${settings.notifications ? 'Увімкнено ✅' : 'Вимкнено ❌'}`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🌅 Змінити час ранку', 'set_morning')],
    [Markup.button.callback('🌃 Змінити час вечора', 'set_evening')],
    [Markup.button.callback('« Головне меню', 'main_menu')]
  ]);

  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('set_morning', async (ctx) => {
  userState[ctx.from.id] = { step: 'settings_wait_morning' };
  await ctx.editMessageText('⏰ Введи новий час для ранкового сповіщення в межах діапазону від 06:00 до 10:00 (наприклад, `08:30`):', {
    parse_mode: 'Markdown',
    ...backToMain
  });
});

bot.action('set_evening', async (ctx) => {
  userState[ctx.from.id] = { step: 'settings_wait_evening' };
  await ctx.editMessageText('⏰ Введи новий час для вечірнього сповіщення (наприклад, `21:00`):', {
    parse_mode: 'Markdown',
    ...backToMain
  });
});


// ================= FSM (ПОКРОКОВЕ ВВЕДЕННЯ ДАНИХ) =================
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const state = userState[userId];
  const text = ctx.message.text.trim();

  if (!state) {
    return ctx.reply('Використовуй кнопочне меню для навігації 👇', mainMenu);
  }

  // --- Логіка догляду ---
  if (state.step === 'skin_wait_name') {
    state.name = text;
    state.step = 'skin_wait_days';
    return ctx.reply('📅 Введи дні використання (наприклад: *Щодня* або *Понеділок, Четвер*):', { parse_mode: 'Markdown' });
  }
  if (state.step === 'skin_wait_days') {
    state.days = text;
    state.step = 'skin_wait_slot';
    return ctx.reply('⏰ Введи часовий слот: *Зранку*, *Ввечері* або *Зранку і ввечері*:');
  }
  if (state.step === 'skin_wait_slot') {
    await prisma.skincareItem.create({
      data: { name: state.name, scheduleDays: state.days, timeSlot: text }
    });
    delete userState[userId];
    return ctx.reply('✅ Засіб успішно додано до трекера догляду!', mainMenu);
  }

  // --- Логіка розкладу ---
  if (state.step === 'sched_wait_data') {
    const parts = text.split(',').map(p => p.trim());
    if (parts.length >= 3) {
      await prisma.schedule.create({
        data: { dayOfWeek: parts[0], time: parts[1], subject: parts[2], room: parts[3] || 'н/д' }
      });
      delete userState[userId];
      return ctx.reply('✅ Пара успішно додана до розкладу!', mainMenu);
    }
    return ctx.reply('❌ Неправильний формат. Спробуй ще раз: День, Час, Предмет, Аудиторія');
  }

  // --- Логіка ДЗ / завдань ---
  if (state.step === 'hw_wait_title') {
    state.hwTitle = text;
    state.step = 'hw_wait_date';
    return ctx.reply('📅 Введи дату дедлайну у форматі `ДД.ММ.РРРР` (наприклад, 25.08.2026):');
  }
  if (state.step === 'hw_wait_date') {
    const [d, m, y] = text.split('.');
    state.hwDate = new Date(`${y}-${m}-${d}`);
    state.step = 'hw_wait_priority';
    
    return ctx.reply('🔥 Обери пріоритет завдання:', Markup.inlineKeyboard([
      [Markup.button.callback('Важливий 🔥', 'prio_high'), Markup.button.callback('Звичайний 📌', 'prio_normal')]
    ]));
  }

  // --- Логіка цілей ---
  if (state.step === 'goal_wait_title') {
    state.goalTitle = text;
    state.step = 'goal_wait_date';
    return ctx.reply('📅 Введи дедлайн цілі у форматі `ДД.ММ.РРРР` (наприклад, через місяць - 20.09.2026):');
  }
  if (state.step === 'goal_wait_date') {
    const [d, m, y] = text.split('.');
    const targetDate = new Date(`${y}-${m}-${d}`);
    
    await prisma.goal.create({
      data: { title: state.goalTitle, targetDate: isNaN(targetDate) ? new Date() : targetDate, progress: 0 }
    });
    delete userState[userId];
    return ctx.reply('🎯 Нову ціль успішно збережено!', mainMenu);
  }

  // --- Налаштування часу сповіщень ---
  if (state.step === 'settings_wait_morning') {
    await prisma.userSettings.update({
      where: { telegramId: BigInt(userId) },
      data: { morningTime: text }
    });
    delete userState[userId];
    return ctx.reply(`✅ Ранковий час сповіщень оновлено на ${text}!`, mainMenu);
  }

  if (state.step === 'settings_wait_evening') {
    await prisma.userSettings.update({
      where: { telegramId: BigInt(userId) },
      data: { eveningTime: text }
    });
    delete userState[userId];
    return ctx.reply(`✅ Вечірній час сповіщень оновлено на ${text}!`, mainMenu);
  }
});

// Обробка інлайн-кнопок вибору пріоритету ДЗ
bot.action(/^prio_(high|normal)$/, async (ctx) => {
  const userId = ctx.from.id;
  const state = userState[userId];
  if (!state) return ctx.answerCbQuery('Сесія закінчилася.');

  const priority = ctx.match[1] === 'high' ? 'Важливий 🔥' : 'Звичайний';

  await prisma.homework.create({
    data: {
      title: state.hwTitle,
      dueDate: isNaN(state.hwDate) ? new Date() : state.hwDate,
      priority: priority
    }
  });

  delete userState[userId];
  await ctx.answerCbQuery('Завдання збережено!');
  await ctx.editMessageText('✅ Завдання та дедлайн успішно додано до менеджера!', mainMenu);
});


// --- VERCEL SERVERLESS HANDLER ---
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body);
      return res.status(200).send('OK');
    }
    return res.status(200).send('Assistant Bot is active on Vercel!');
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).send('Error');
  }
};