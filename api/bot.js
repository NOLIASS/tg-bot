const { Telegraf, Markup } = require('telegraf');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const bot = new Telegraf(process.env.BOT_TOKEN);

const userState = {};

// --- МІНІМАЛІСТИЧНИЙ ДАШБОРД (ГОЛОВНИЙ ЕКРАН) ---
async function sendDashboard(ctx, isEdit = false) {
  const telegramId = ctx.from.id;

  // Витягуємо найголовніше: найближче ДЗ, головну ціль та кількість речей у дорозі
  const nextHw = await prisma.homework.findFirst({
    where: { isCompleted: false },
    orderBy: { dueDate: 'asc' }
  });

  const mainGoal = await prisma.goal.findFirst({
    where: { isCompleted: false },
    orderBy: { targetDate: 'asc' }
  });

  const tripItems = await prisma.tripItem.findMany({ where: { isPacked: false } });

  // Формуємо чистий, не перевантажений екран
  let text = `⚡ *ОБРАНИЙ АСИСТЕНТ*\n\n`;
  
  if (nextHw) {
    const daysLeft = Math.ceil((new Date(nextHw.dueDate) - new Date()) / (1000 * 60 * 60 * 24));
    text += `📌 *Найближчий дедлайн:* ${nextHw.title} (через ${daysLeft >= 0 ? daysLeft : 0} дн.)\n`;
  } else {
    text += `📌 *Дедлайнів немає!*\n`;
  }

  if (mainGoal) {
    text += `🎯 *Головна ціль:* ${mainGoal.title} — [${mainGoal.progress}%]\n`;
  }

  if (tripItems.length > 0) {
    text += `🧳 *В дорогу:* залишилось зібрати речей: ${tripItems.length}\n`;
  }

  text += `\n_Обери розділ нижче:_`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📌 Задачі та ДЗ', 'menu_hw'), Markup.button.callback('🎯 Головна ціль', 'menu_goals')],
    [Markup.button.callback('🧳 У дорогу (Поїздка)', 'menu_trip'), Markup.button.callback('🧴 Догляд', 'menu_skincare')],
    [Markup.button.callback('📚 Розклад', 'menu_schedule'), Markup.button.callback('⚙️ Налаштування', 'menu_settings')]
  ]);

  if (isEdit) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
  }
}

// Старт
bot.start(async (ctx) => {
  delete userState[ctx.from.id];
  await sendDashboard(ctx, false);
});

bot.action('main_menu', async (ctx) => {
  delete userState[ctx.from.id];
  await sendDashboard(ctx, true);
});


// ================= 1. ФУНКЦІЯ "У ДОРОГУ" (БАГАЖ ПОЛЬЩА-УКРАЇНА) =================
bot.action('menu_trip', async (ctx) => {
  const items = await prisma.tripItem.findMany({ orderBy: { category: 'asc' } });
  
  let text = `🧳 *Чек-лист "У дорогу" (Польща ⇄ Україна)*\n\n`;
  let buttons = items.map(i => [
    Markup.button.callback(`${i.isPacked ? '✅' : '🔲'} [${i.category}] ${i.title} (${i.quantity} шт.)`, `trip_toggle_${i.id}`)
  ]);

  buttons.push([Markup.button.callback('➕ Додати річ у багаж', 'trip_add')]);
  buttons.push([Markup.button.callback('« Головне меню', 'main_menu')]);

  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('trip_add', async (ctx) => {
  userState[ctx.from.id] = { step: 'trip_wait_cat' };
  await ctx.editMessageText('🗂 Вибери категорію речей:', Markup.inlineKeyboard([
    [Markup.button.callback('💻 Техніка', 'trip_cat_Техніка'), Markup.button.callback('👕 Одяг', 'trip_cat_Одяг')],
    [Markup.button.callback('📄 Документи / Гроші', 'trip_cat_Документи'), Markup.button.callback('🎒 Інше', 'trip_cat_Інше')],
    [Markup.button.callback('« Назад', 'menu_trip')]
  ]));
});

bot.action(/^trip_cat_(.+)$/, async (ctx) => {
  const category = ctx.match[1];
  userState[ctx.from.id] = { step: 'trip_wait_title', category };
  await ctx.editMessageText(`✍️ Введи назву речі для категорії *${category}* (наприклад, *MacBook* або *Павербанк*):`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'menu_trip')]])
  });
});

bot.action(/^trip_toggle_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  const item = await prisma.tripItem.findUnique({ where: { id } });
  if (item) {
    await prisma.tripItem.update({ where: { id }, data: { isPacked: !item.isPacked } });
  }
  // Оновлюємо меню поїздки
  const items = await prisma.tripItem.findMany();
  let buttons = items.map(i => [
    Markup.button.callback(`${i.isPacked ? '✅' : '🔲'} [${i.category}] ${i.title} (${i.quantity} шт.)`, `trip_toggle_${i.id}`)
  ]);
  buttons.push([Markup.button.callback('➕ Додати річ у багаж', 'trip_add')]);
  buttons.push([Markup.button.callback('« Головне меню', 'main_menu')]);
  await ctx.editMessageText(`🧳 *Чек-лист "У дорогу"*\nНатисни, щоб змінити статус:`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});


// ================= 2. ЗАСОБИ ТА ДОГЛЯД =================
bot.action('menu_skincare', async (ctx) => {
  const items = await prisma.skincareItem.findMany();
  let buttons = items.map(i => [Markup.button.callback(`✨ ${i.name} [${i.timeSlot}]`, `skin_del_${i.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати засіб', 'skin_add'), Markup.button.callback('« Меню', 'main_menu')]);
  await ctx.editMessageText('🧴 *Трекер догляду*\nНатисни на засіб, щоб видалити його:', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('skin_add', async (ctx) => {
  userState[ctx.from.id] = { step: 'skin_wait_name' };
  await ctx.editMessageText('✍️ Введи назву засобу (наприклад, *Азелаїнка*):', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'menu_skincare')]]));
});

bot.action(/^skin_del_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  await prisma.skincareItem.delete({ where: { id } });
  await ctx.answerCbQuery('Видалено!');
  const items = await prisma.skincareItem.findMany();
  let buttons = items.map(i => [Markup.button.callback(`✨ ${i.name}`, `skin_del_${i.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати', 'skin_add'), Markup.button.callback('« Меню', 'main_menu')]);
  await ctx.editMessageText('🧴 Актуальний догляд:', Markup.inlineKeyboard(buttons));
});


// ================= 3. ЗАДАЧІ ТА ДЗ =================
bot.action('menu_hw', async (ctx) => {
  const homeworks = await prisma.homework.findMany({ where: { isCompleted: false }, orderBy: { dueDate: 'asc' } });
  let buttons = homeworks.map(hw => [
    Markup.button.callback(`📌 ${hw.title} (до ${new Date(hw.dueDate).toLocaleDateString()})`, `hw_done_${hw.id}`)
  ]);
  buttons.push([Markup.button.callback('➕ Додати задачу', 'hw_add'), Markup.button.callback('« Меню', 'main_menu')]);
  await ctx.editMessageText('📝 *Задачі та дедлайни*\nКлікни, щоб позначити виконаним:', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('hw_add', async (ctx) => {
  userState[ctx.from.id] = { step: 'hw_wait_title' };
  await ctx.editMessageText('✍️ Введи назву задачі:', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'menu_hw')]]));
});

bot.action(/^hw_done_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  await prisma.homework.update({ where: { id }, data: { isCompleted: true } });
  await ctx.answerCbQuery('Виконано! 🎉');
  const homeworks = await prisma.homework.findMany({ where: { isCompleted: false } });
  let buttons = homeworks.map(hw => [Markup.button.callback(`✔️ ${hw.title}`, `hw_done_${hw.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати задачу', 'hw_add'), Markup.button.callback('« Меню', 'main_menu')]);
  await ctx.editMessageText('📝 Актуальні задачі:', Markup.inlineKeyboard(buttons));
});


// ================= 4. ЦІЛІ =================
bot.action('menu_goals', async (ctx) => {
  const goals = await prisma.goal.findMany({ where: { isCompleted: false } });
  let buttons = goals.map(g => [Markup.button.callback(`🎯 ${g.title} [${g.progress}%]`, `goal_view_${g.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати ціль', 'goal_add'), Markup.button.callback('« Меню', 'main_menu')]);
  await ctx.editMessageText('🎯 *Твої цілі*\nВибери ціль для оновлення прогресу:', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('goal_add', async (ctx) => {
  userState[ctx.from.id] = { step: 'goal_wait_title' };
  await ctx.editMessageText('✍️ Введи назву цілі (наприклад, *Вивчити TypeScript*):', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'menu_goals')]]));
});

bot.action(/^goal_view_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  const goal = await prisma.goal.findUnique({ where: { id } });
  if (!goal) return ctx.answerCbQuery('Ціль не знайдено.');

  const text = `🎯 *Ціль:* ${goal.title}\n📊 *Прогрес:* ${goal.progress}%\n📅 *Дедлайн:* ${new Date(goal.targetDate).toLocaleDateString()}`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('➕ 25%', `goal_p_${goal.id}_25`), Markup.button.callback('➕ 50%', `goal_p_${goal.id}_50`), Markup.button.callback('🎉 100%', `goal_p_${goal.id}_100`)],
    [Markup.button.callback('🗑 Видалити', `goal_del_${goal.id}`), Markup.button.callback('« Назад', 'menu_goals')]
  ]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action(/^goal_p_(\d+)_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  const progress = parseInt(ctx.match[2]);
  await prisma.goal.update({ where: { id }, data: { progress, isCompleted: progress >= 100 } });
  await ctx.answerCbQuery(`Прогрес: ${progress}% 🚀`);
  
  const goal = await prisma.goal.findUnique({ where: { id } });
  const text = `🎯 *Ціль:* ${goal.title}\n📊 *Прогрес:* ${goal.progress}%\n📅 *Дедлайн:* ${new Date(goal.targetDate).toLocaleDateString()}`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('➕ 25%', `goal_p_${goal.id}_25`), Markup.button.callback('➕ 50%', `goal_p_${goal.id}_50`), Markup.button.callback('🎉 100%', `goal_p_${goal.id}_100`)],
    [Markup.button.callback('🗑 Видалити', `goal_del_${goal.id}`), Markup.button.callback('« Назад', 'menu_goals')]
  ]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action(/^goal_del_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  await prisma.goal.delete({ where: { id } });
  await ctx.answerCbQuery('Ціль видалено.');
  
  const goals = await prisma.goal.findMany();
  let buttons = goals.map(g => [Markup.button.callback(`🎯 ${g.title} [${g.progress}%]`, `goal_view_${g.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати ціль', 'goal_add'), Markup.button.callback('« Меню', 'main_menu')]);
  await ctx.editMessageText('🎯 Ціль видалено:', Markup.inlineKeyboard(buttons));
});


// ================= 5. РОЗКЛАД =================
bot.action('menu_schedule', async (ctx) => {
  const schedule = await prisma.schedule.findMany();
  let buttons = schedule.map(s => [Markup.button.callback(`📚 ${s.dayOfWeek} ${s.time} - ${s.subject}`, `sched_del_${s.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати пару', 'sched_add'), Markup.button.callback('« Меню', 'main_menu')]);
  await ctx.editMessageText('📚 *Розклад пар*:', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('sched_add', async (ctx) => {
  userState[ctx.from.id] = { step: 'sched_wait_data' };
  await ctx.editMessageText('✍️ Введи розклад у форматі: `День, Час, Предмет`', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'menu_schedule')]]));
});

bot.action(/^sched_del_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  await prisma.schedule.delete({ where: { id } });
  await ctx.answerCbQuery('Видалено!');
  const schedule = await prisma.schedule.findMany();
  let buttons = schedule.map(s => [Markup.button.callback(`📚 ${s.dayOfWeek} - ${s.subject}`, `sched_del_${s.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати', 'sched_add'), Markup.button.callback('« Меню', 'main_menu')]);
  await ctx.editMessageText('📚 Розклад оновлено:', Markup.inlineKeyboard(buttons));
});

bot.action('menu_settings', async (ctx) => {
  await ctx.editMessageText('⚙️ *Налаштування сповіщень*\nСлоти часу активні.', Markup.inlineKeyboard([[Markup.button.callback('« Головне меню', 'main_menu')]]));
});


// ================= FSM (ВВЕДЕННЯ ДАНИХ) =================
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const state = userState[userId];
  const text = ctx.message.text.trim();

  if (!state) {
    return sendDashboard(ctx, false);
  }

  // --- Поїздка / У дорогу ---
  if (state.step === 'trip_wait_title') {
    state.tripTitle = text;
    state.step = 'trip_wait_qty';
    return ctx.reply('🔢 Введи кількість (наприклад, `1` або `2`):');
  }
  if (state.step === 'trip_wait_qty') {
    const qty = parseInt(text) || 1;
    await prisma.tripItem.create({
      data: { category: state.category, title: state.tripTitle, quantity: qty }
    });
    delete userState[userId];
    return ctx.reply('✅ Річ успішно додана до чей-листу поїздки!', Markup.inlineKeyboard([[Markup.button.callback('« До головного меню', 'main_menu')]]));
  }

  // --- Догляд ---
  if (state.step === 'skin_wait_name') {
    await prisma.skincareItem.create({ data: { name: text, scheduleDays: 'Щодня', timeSlot: 'Зранку/Ввечері' } });
    delete userState[userId];
    return ctx.reply('✅ Засіб додано!', Markup.inlineKeyboard([[Markup.button.callback('« Головне меню', 'main_menu')]]));
  }

  // --- Задачі ---
  if (state.step === 'hw_wait_title') {
    state.hwTitle = text;
    state.step = 'hw_wait_date';
    return ctx.reply('📅 Введи дедлайн (`ДД.ММ.РРРР`):');
  }
  if (state.step === 'hw_wait_date') {
    const [d, m, y] = text.split('.');
    const dueDate = new Date(`${y}-${m}-${d}`);
    await prisma.homework.create({
      data: { title: state.hwTitle, dueDate: isNaN(dueDate) ? new Date() : dueDate }
    });
    delete userState[userId];
    return ctx.reply('✅ Задачу збережено!', Markup.inlineKeyboard([[Markup.button.callback('« Головне меню', 'main_menu')]]));
  }

  // --- Цілі ---
  if (state.step === 'goal_wait_title') {
    state.goalTitle = text;
    state.step = 'goal_wait_date';
    return ctx.reply('📅 Введи дедлайн цілі (`ДД.ММ.РРРР`):');
  }
  if (state.step === 'goal_wait_date') {
    const [d, m, y] = text.split('.');
    const targetDate = new Date(`${y}-${m}-${d}`);
    await prisma.goal.create({
      data: { title: state.goalTitle, targetDate: isNaN(targetDate) ? new Date() : targetDate, progress: 0 }
    });
    delete userState[userId];
    return ctx.reply('🎯 Ціль створено!', Markup.inlineKeyboard([[Markup.button.callback('« Головне меню', 'main_menu')]]));
  }

  // --- Розклад ---
  if (state.step === 'sched_wait_data') {
    const p = text.split(',').map(x => x.trim());
    if (p.length >= 3) {
      await prisma.schedule.create({ data: { dayOfWeek: p[0], time: p[1], subject: p[2] } });
      delete userState[userId];
      return ctx.reply('✅ Пару додано!', Markup.inlineKeyboard([[Markup.button.callback('« Головне меню', 'main_menu')]]));
    }
    return ctx.reply('❌ Формат: День, Час, Предмет');
  }
});

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body);
      return res.status(200).send('OK');
    }
    return res.status(200).send('Minimalist Assistant is running');
  } catch (e) {
    console.error(e);
    return res.status(500).send('Error');
  }
};