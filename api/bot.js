const { Telegraf, Markup } = require('telegraf');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const bot = new Telegraf(process.env.BOT_TOKEN);

const userState = {};

// Глобальний обробник помилок Telegraf
bot.catch((err, ctx) => {
  console.error(`Telegraf error for update ${ctx.update.update_id}:`, err);
});

/**
 * Динамічний рендер головного бізнес-дашборду
 */
async function sendDashboard(ctx, isEdit = false) {
  try {
    const userId = ctx.from.id;

    let userSetting = await prisma.userSetting.upsert({
      where: { telegramId: BigInt(userId) },
      update: {},
      create: { telegramId: BigInt(userId), mode: 'full', notifTime: '09:00' }
    });

    const notifTime = userSetting.notifTime || '09:00';
    const mode = userSetting.mode || 'full';

    let text = `⚡ *ПЕРСОНАЛЬНИЙ ЕКО-АСИСТЕНТ* [Режим: *${mode.toUpperCase()}*]\n`;
    text += `⏰ *Час сповіщень:* ${notifTime}\n\n`;

    const keyboardButtons = [];

    if (mode === 'student' || mode === 'full') {
      const nextHw = await prisma.homework.findFirst({ where: { userId: BigInt(userId), isCompleted: false } });
      text += nextHw ? `📌 *ДЗ:* ${nextHw.title}\n` : `📌 *ДЗ:* Усе виконано! 🎉\n`;
      keyboardButtons.push([Markup.button.callback('📚 Навчання & Розклад', 'mod_study')]);
    }

    if (mode === 'entrepreneur' || mode === 'full') {
      const activeOrders = await prisma.order.count({ where: { status: 'В роботі' } });
      text += `💼 *Замовлень у роботі:* ${activeOrders}\n`;
      keyboardButtons.push([
        Markup.button.callback('💼 Робота & CRM', 'mod_work'),
        Markup.button.callback('👤 Ліди', 'mod_leads')
      ]);
      keyboardButtons.push([Markup.button.callback('📋 Генератор брифів', 'mod_briefs')]);
    }

    keyboardButtons.push([
      Markup.button.callback('🧠 Другий мозок', 'mod_brain'),
      Markup.button.callback('💰 Фінанси', 'mod_fin')
    ]);
    keyboardButtons.push([
      Markup.button.callback('🧳 У дорозі', 'mod_luggage'),
      Markup.button.callback('✨ Догляд', 'mod_skincare')
    ]);
    keyboardButtons.push([Markup.button.callback('⚙️ Налаштування', 'menu_settings')]);

    const keyboard = Markup.inlineKeyboard(keyboardButtons);

    if (isEdit) {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    } else {
      await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
    }
  } catch (error) {
    console.error('Помилка рендеру дашборду:', error);
    await ctx.reply('⚠️ Сталася помилка при завантаженні дашборду.');
  }
}

// --- СТАРТ ТА ОНБОРДИНГ ---
bot.start(async (ctx) => {
  try {
    delete userState[ctx.from.id];
    const userId = ctx.from.id;
    let userSetting = await prisma.userSetting.findUnique({ where: { telegramId: BigInt(userId) } });

    if (!userSetting) {
      const welcomeText = `👋 Вітаю! Обери свій поточний режим використання:`;
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🎓 Студент', 'set_mode_student')],
        [Markup.button.callback('💼 Підприємець', 'set_mode_entrepreneur')],
        [Markup.button.callback('🚀 Повна версія', 'set_mode_full')]
      ]);
      return ctx.reply(welcomeText, { parse_mode: 'Markdown', ...keyboard });
    }

    await sendDashboard(ctx, false);
  } catch (e) { console.error(e); }
});

bot.action(/^set_mode_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const mode = ctx.match[1];
  const userId = ctx.from.id;

  await prisma.userSetting.upsert({
    where: { telegramId: BigInt(userId) },
    update: { mode },
    create: { telegramId: BigInt(userId), mode }
  });

  await sendDashboard(ctx, true);
});

bot.action('main_menu', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    delete userState[ctx.from.id];
    await sendDashboard(ctx, true);
  } catch (e) { console.error(e); }
});

// ================= 1. НАВЧАННЯ ТА РОЗКЛАД =================
bot.action('mod_study', async (ctx) => {
  await ctx.answerCbQuery();
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📌 Дедлайни та ДЗ', 'st_hw'), Markup.button.callback('📚 Розклад пар', 'st_sched')],
    [Markup.button.callback('« Головне меню', 'main_menu')]
  ]);
  await ctx.editMessageText('📚 *Модуль навчання:*', { parse_mode: 'Markdown', ...keyboard });
});

async function renderSchedule(ctx) {
  const sched = await prisma.schedule.findMany();
  let buttons = sched.map(s => [Markup.button.callback(`📖 [${s.dayOfWeek}] ${s.time} — ${s.subject}`, `sched_item_${s.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати пару', 'sched_add'), Markup.button.callback('« Назад', 'mod_study')]);
  await ctx.editMessageText('📚 *Розклад занять:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

bot.action('st_sched', async (ctx) => {
  await ctx.answerCbQuery();
  await renderSchedule(ctx);
});

bot.action('sched_add', async (ctx) => {
  await ctx.answerCbQuery();
  userState[ctx.from.id] = { step: 'sched_wait_day' };
  await ctx.editMessageText('✍️ Введи день тижня (наприклад, *Понеділок*):', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'st_sched')]]));
});

bot.action(/^sched_item_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const id = parseInt(ctx.match[1]);
  const s = await prisma.schedule.findUnique({ where: { id } });
  if (!s) return ctx.reply('Пару не знайдено');

  const text = `📖 *Пара:* ${s.subject}\n📅 День: ${s.dayOfWeek}\n⏰ Час: ${s.time}`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🗑 Видалити пару', `sched_del_${id}`)],
    [Markup.button.callback('« Назад до розкладу', 'st_sched')]
  ]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action(/^sched_del_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery('Пару видалено');
  await prisma.schedule.delete({ where: { id: parseInt(ctx.match[1]) } });
  await renderSchedule(ctx);
});

async function renderHomework(ctx) {
  const userId = ctx.from.id;
  const list = await prisma.homework.findMany({ where: { userId: BigInt(userId), isCompleted: false } });
  let buttons = list.map(h => [Markup.button.callback(`✔️ ${h.title}`, `hw_item_${h.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати ДЗ', 'hw_add'), Markup.button.callback('« Назад', 'mod_study')]);
  await ctx.editMessageText('📌 *Домашні завдання:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

bot.action('st_hw', async (ctx) => {
  await ctx.answerCbQuery();
  await renderHomework(ctx);
});

bot.action('hw_add', async (ctx) => {
  await ctx.answerCbQuery();
  userState[ctx.from.id] = { step: 'hw_wait_title' };
  await ctx.editMessageText('✍️ Введи назву домашнього завдання:', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'st_hw')]]));
});

bot.action(/^hw_item_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const id = parseInt(ctx.match[1]);
  const hw = await prisma.homework.findUnique({ where: { id } });
  if (!hw) return ctx.reply('Завдання не знайдено');

  const dateStr = hw.dueDate ? hw.dueDate.toISOString().split('T')[0] : 'Без дати';
  const text = `📌 *Завдання:* ${hw.title}\n📅 Дедлайн: ${dateStr}\nСтатус: ${hw.isCompleted ? '✅ Виконано' : '⏳ В процесі'}`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(hw.isCompleted ? '↩️ Повернути в роботу' : '✔️ Виконати', `hw_toggle_${id}`)],
    [Markup.button.callback('🗑 Видалити', `hw_del_${id}`)],
    [Markup.button.callback('« Назад до ДЗ', 'st_hw')]
  ]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action(/^hw_toggle_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery('Статус оновлено!');
  const id = parseInt(ctx.match[1]);
  const hw = await prisma.homework.findUnique({ where: { id } });
  await prisma.homework.update({ where: { id }, data: { isCompleted: !hw.isCompleted } });
  await renderHomework(ctx);
});

bot.action(/^hw_del_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery('Видалено!');
  const id = parseInt(ctx.match[1]);
  await prisma.homework.delete({ where: { id } });
  await renderHomework(ctx);
});


// ================= 2. РОБОТА ТА CRM =================
bot.action('mod_work', async (ctx) => {
  await ctx.answerCbQuery();
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📋 Усі замовлення', 'crm_all'), Markup.button.callback('⏳ В роботі', 'crm_in_progress')],
    [Markup.button.callback('✅ Виконані', 'crm_done'), Markup.button.callback('➕ Додати замовлення', 'ord_add')],
    [Markup.button.callback('« Головне меню', 'main_menu')]
  ]);
  await ctx.editMessageText('💼 *Міні-CRM (Фільтрація угод):*', { parse_mode: 'Markdown', ...keyboard });
});

bot.action('crm_all', async (ctx) => {
  await ctx.answerCbQuery();
  await renderCrmList(ctx, {});
});

bot.action('crm_in_progress', async (ctx) => {
  await ctx.answerCbQuery();
  await renderCrmList(ctx, { status: 'В роботі' });
});

bot.action('crm_done', async (ctx) => {
  await ctx.answerCbQuery();
  await renderCrmList(ctx, { status: 'Виконано' });
});

async function renderCrmList(ctx, filter = {}) {
  try {
    const orders = await prisma.order.findMany({ where: filter });
    let buttons = orders.map(o => [Markup.button.callback(`👤 ${o.clientName} | ${o.niche} (${o.amount} $) [${o.status}]`, `ord_item_${o.id}`)]);
    buttons.push([Markup.button.callback('➕ Додати замовлення', 'ord_add'), Markup.button.callback('« Назад', 'mod_work')]);
    if (ctx.callbackQuery) {
      await ctx.editMessageText('💼 *Список угод за фільтром:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    }
  } catch (e) { console.error(e); }
}

bot.action('ord_add', async (ctx) => {
  await ctx.answerCbQuery();
  userState[ctx.from.id] = { step: 'ord_wait_client' };
  await ctx.editMessageText('✍️ Введи ПІБ клієнта або назву проєкту:', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'mod_work')]]));
});

bot.action(/^ord_item_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const id = parseInt(ctx.match[1]);
  const o = await prisma.order.findUnique({ where: { id } });
  if (!o) return ctx.reply('Замовлення не знайдено');

  const text = `💼 *Клієнт / Проєкт:* ${o.clientName}\n🏷 Ніша: ${o.niche}\n💵 Сума: ${o.amount} $\n📌 Статус: *${o.status}*`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔄 Змінити статус', `ord_status_${id}`), Markup.button.callback('🗑 Видалити', `ord_del_${id}`)],
    [Markup.button.callback('« Назад до CRM', 'mod_work')]
  ]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action(/^ord_status_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const id = parseInt(ctx.match[1]);
  const o = await prisma.order.findUnique({ where: { id } });
  const nextStatus = o.status === 'Новий' ? 'В роботі' : o.status === 'В роботі' ? 'Виконано' : 'Новий';
  await prisma.order.update({ where: { id }, data: { status: nextStatus } });

  // Оновлюємо картку замовлення
  const updated = await prisma.order.findUnique({ where: { id } });
  const text = `💼 *Клієнт / Проєкт:* ${updated.clientName}\n🏷 Ніша: ${updated.niche}\n💵 Сума: ${updated.amount} $\n📌 Статус: *${updated.status}*`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔄 Змінити статус', `ord_status_${id}`), Markup.button.callback('🗑 Видалити', `ord_del_${id}`)],
    [Markup.button.callback('« Назад до CRM', 'mod_work')]
  ]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action(/^ord_del_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery('Замовлення видалено!');
  const id = parseInt(ctx.match[1]);
  await prisma.order.delete({ where: { id } });
  await renderCrmList(ctx, {});
});


// ================= 3. ІНШІ МОДУЛІ (ЛІДИ, БРИФИ, МОЗОК, ФІНАНСИ, БАГАЖ, ДОГЛЯД) =================
bot.action('mod_leads', async (ctx) => {
  await ctx.answerCbQuery();
  const leads = await prisma.leadContact.findMany();
  let text = '👤 *База лідів:*\n\n';
  let buttons = leads.map(l => [Markup.button.callback(`👤 ${l.name} (${l.contactInfo})`, `lead_item_${l.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати ліда', 'lead_add'), Markup.button.callback('« Головне меню', 'main_menu')]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('lead_add', async (ctx) => {
  await ctx.answerCbQuery();
  userState[ctx.from.id] = { step: 'lead_wait_name' };
  await ctx.editMessageText("✍️ Введи ім'я ліда:", Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'mod_leads')]]));
});

bot.action(/^lead_item_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const id = parseInt(ctx.match[1]);
  const l = await prisma.leadContact.findUnique({ where: { id } });
  if (!l) return ctx.reply('Ліда не знайдено');
  const text = `👤 *Ім'я:* ${l.name}\n📞 Контакт: ${l.contactInfo}\n🌐 Джерело: ${l.source}`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🗑 Видалити ліда', `lead_del_${id}`)],
    [Markup.button.callback('« Назад до лідів', 'mod_leads')]
  ]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action(/^lead_del_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery('Ліда видалено');
  await prisma.leadContact.delete({ where: { id: parseInt(ctx.match[1]) } });
  const leads = await prisma.leadContact.findMany();
  let buttons = leads.map(l => [Markup.button.callback(`👤 ${l.name}`, `lead_item_${l.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати ліда', 'lead_add'), Markup.button.callback('« Меню', 'main_menu')]);
  await ctx.editMessageText('👤 *База лідів:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('mod_briefs', async (ctx) => {
  await ctx.answerCbQuery();
  const text = `📋 *Генератор брифів*\n\nОбери проєкт:`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🌐 Лендінг', 'brief_landing')],
    [Markup.button.callback('🛒 Інтернет-магазин', 'brief_shop')],
    [Markup.button.callback('« Головне меню', 'main_menu')]
  ]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('brief_landing', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('📋 *Бриф на Лендінг:*\n1. Про продукт\n2. Цільова аудиторія\n3. Референси', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'mod_briefs')]]));
});

bot.action('brief_shop', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('📋 *Бриф на Магазин:*\n1. Кількість товарів\n2. Платіжна система', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'mod_briefs')]]));
});

bot.action('mod_brain', async (ctx) => {
  await ctx.answerCbQuery();
  const notes = await prisma.quickNote.findMany({ take: 5, orderBy: { id: 'desc' } });
  let buttons = notes.map(n => [Markup.button.callback(`🧠 ${n.content.substring(0, 30)}...`, `brain_item_${n.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати ідею', 'brain_add'), Markup.button.callback('« Меню', 'main_menu')]);
  await ctx.editMessageText('🧠 *Другий мозок (Нотатки):*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('brain_add', async (ctx) => {
  await ctx.answerCbQuery();
  userState[ctx.from.id] = { step: 'brain_wait_note' };
  await ctx.editMessageText('✍️ Напиши ідею:', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'mod_brain')]]));
});

bot.action(/^brain_item_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const id = parseInt(ctx.match[1]);
  const n = await prisma.quickNote.findUnique({ where: { id } });
  if (!n) return ctx.reply('Нотатку не знайдено');
  const text = `🧠 *Нотатка / Ідея:*\n\n${n.content}`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🗑 Видалити', `brain_del_${id}`)],
    [Markup.button.callback('« Назад', 'mod_brain')]
  ]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action(/^brain_del_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery('Видалено!');
  await prisma.quickNote.delete({ where: { id: parseInt(ctx.match[1]) } });
  const notes = await prisma.quickNote.findMany({ take: 5, orderBy: { id: 'desc' } });
  let buttons = notes.map(n => [Markup.button.callback(`🧠 ${n.content.substring(0, 30)}...`, `brain_item_${n.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати ідею', 'brain_add'), Markup.button.callback('« Меню', 'main_menu')]);
  await ctx.editMessageText('🧠 *Другий мозок (Нотатки):*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('mod_fin', async (ctx) => {
  await ctx.answerCbQuery();
  const subs = await prisma.subscription.findMany();
  let buttons = subs.map(s => [Markup.button.callback(`🔹 ${s.title} — ${s.amount} $`, `fin_item_${s.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати платіж', 'fin_add'), Markup.button.callback('« Меню', 'main_menu')]);
  await ctx.editMessageText('💰 *Фінанси та підписки:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('fin_add', async (ctx) => {
  await ctx.answerCbQuery();
  userState[ctx.from.id] = { step: 'fin_wait_title' };
  await ctx.editMessageText('✍️ Введи назву платежу:', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'mod_fin')]]));
});

bot.action(/^fin_item_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const id = parseInt(ctx.match[1]);
  const s = await prisma.subscription.findUnique({ where: { id } });
  if (!s) return ctx.reply('Платіж не знайдено');
  const text = `💰 *Платіж:* ${s.title}\n💵 Сума: ${s.amount} $`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🗑 Видалити платіж', `fin_del_${id}`)],
    [Markup.button.callback('« Назад до фінансів', 'mod_fin')]
  ]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action(/^fin_del_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery('Видалено!');
  await prisma.subscription.delete({ where: { id: parseInt(ctx.match[1]) } });
  const subs = await prisma.subscription.findMany();
  let buttons = subs.map(s => [Markup.button.callback(`🔹 ${s.title} — ${s.amount} $`, `fin_item_${s.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати платіж', 'fin_add'), Markup.button.callback('« Меню', 'main_menu')]);
  await ctx.editMessageText('💰 *Фінанси та підписки:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

async function renderLuggage(ctx) {
  const items = await prisma.tripItem.findMany();
  let buttons = items.map(i => [Markup.button.callback(`${i.isPacked ? '✅' : '🔲'} ${i.title}`, `lug_item_${i.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати річ', 'lug_add'), Markup.button.callback('« Меню', 'main_menu')]);
  await ctx.editMessageText('🧳 *Багаж у дорогу:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

bot.action('mod_luggage', async (ctx) => {
  await ctx.answerCbQuery();
  await renderLuggage(ctx);
});

bot.action('lug_add', async (ctx) => {
  await ctx.answerCbQuery();
  userState[ctx.from.id] = { step: 'lug_wait_title' };
  await ctx.editMessageText('✍️ Введи назву речі:', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'mod_luggage')]]));
});

bot.action(/^lug_item_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const id = parseInt(ctx.match[1]);
  const i = await prisma.tripItem.findUnique({ where: { id } });
  if (!i) return ctx.reply('Річ не знайдено');
  const text = `🧳 *Річ:* ${i.title}\nСтатус: ${i.isPacked ? '✅ Зібрано' : '🔲 Не зібрано'}`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(i.isPacked ? '🔄 Позначити як незібране' : '✅ Зібрати', `lug_toggle_${id}`)],
    [Markup.button.callback('🗑 Видалити', `lug_del_${id}`)],
    [Markup.button.callback('« Назад до багажу', 'mod_luggage')]
  ]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action(/^lug_toggle_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery('Оновлено!');
  const id = parseInt(ctx.match[1]);
  const i = await prisma.tripItem.findUnique({ where: { id } });
  await prisma.tripItem.update({ where: { id }, data: { isPacked: !i.isPacked } });
  await renderLuggage(ctx);
});

bot.action(/^lug_del_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery('Видалено!');
  await prisma.tripItem.delete({ where: { id: parseInt(ctx.match[1]) } });
  await renderLuggage(ctx);
});

async function renderSkincare(ctx) {
  const userId = ctx.from.id;
  const routines = await prisma.skincareRoutine.findMany({ where: { userId: BigInt(userId) } });
  let text = "✨ *Б'юті-рутина та догляд:*\n\n";
  let buttons = routines.map(r => [Markup.button.callback(`✔️ ${r.title} (${r.frequency}) 🕐 ${r.notifTimes || '—'}`, `skin_item_${r.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати процедуру', 'skin_add'), Markup.button.callback('« Меню', 'main_menu')]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

bot.action('mod_skincare', async (ctx) => {
  await ctx.answerCbQuery();
  await renderSkincare(ctx);
});

bot.action('skin_add', async (ctx) => {
  await ctx.answerCbQuery();
  userState[ctx.from.id] = { step: 'skin_wait_title' };
  await ctx.editMessageText('✍️ Введи процедуру (наприклад, Скраб):', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'mod_skincare')]]));
});

bot.action(/^skin_item_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const id = parseInt(ctx.match[1]);
  const item = await prisma.skincareRoutine.findUnique({ where: { id } });
  if (!item) return ctx.reply('Процедуру не знайдено');

  const text = `✨ *Процедура:* ${item.title}\n⏳ Частота: ${item.frequency}\n⏰ Час сповіщень: ${item.notifTimes || '—'}`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🗑 Видалити процедуру', `skin_del_${id}`)],
    [Markup.button.callback('« Назад до догляду', 'mod_skincare')]
  ]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action(/^skin_del_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery('Процедуру видалено!');
  const id = parseInt(ctx.match[1]);
  await prisma.skincareRoutine.delete({ where: { id } });
  await renderSkincare(ctx);
});


// ================= 4. НАЛАШТУВАННЯ ЧАСУ СПОВІЩЕНЬ =================
bot.action('menu_settings', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const s = await prisma.userSetting.findUnique({ where: { telegramId: BigInt(userId) } });
  const text = `⚙️ *Налаштування*\n\n⏰ Поточний час сповіщень: *${s ? s.notifTime : '09:00'}*`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⏰ Змінити час сповіщень', 'set_notif_time')],
    [Markup.button.callback('« Головне меню', 'main_menu')]
  ]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('set_notif_time', async (ctx) => {
  await ctx.answerCbQuery();
  userState[ctx.from.id] = { step: 'wait_notif_time' };
  await ctx.editMessageText('✍️ Введи новий час сповіщень у форматі `HH:MM` (наприклад, `09:30`):', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'menu_settings')]]));
});


// ================= FSM (ГНУЧКЕ ЗБЕРЕЖЕННЯ) =================
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const state = userState[userId];
  const text = ctx.message.text.trim();

  try {
    if (!state) {
      await prisma.quickNote.create({ data: { content: text } });
      try { await ctx.deleteMessage(); } catch (e) { }
      return ctx.reply('🧠 Збережено в «Другий мозок»!');
    }

    if (state.step === 'wait_notif_time') {
      await prisma.userSetting.update({ where: { telegramId: BigInt(userId) }, data: { notifTime: text } });
      delete userState[userId];
      return ctx.reply(`✅ Час сповіщень змінено на ${text}!`, Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'main_menu')]]));
    }

    if (state.step === 'sched_wait_day') {
      state.schedDay = text;
      state.step = 'sched_wait_time';
      return ctx.reply('⏰ Введи час пари (наприклад, `08:30`):');
    }
    if (state.step === 'sched_wait_time') {
      state.schedTime = text;
      state.step = 'sched_wait_subj';
      return ctx.reply('📖 Введи назву предмета/пари:');
    }
    if (state.step === 'sched_wait_subj') {
      await prisma.schedule.create({ data: { dayOfWeek: state.schedDay, time: state.schedTime, subject: text } });
      delete userState[userId];
      return ctx.reply('✅ Пару успішно додано до розкладу!', Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'main_menu')]]));
    }

    if (state.step === 'hw_wait_title') {
      state.hwTitle = text;
      state.step = 'hw_wait_date';
      return ctx.reply('📅 Введи дедлайн (у форматі `РРРР-ММ-ДД`, наприклад `2026-06-15`):');
    }
    if (state.step === 'hw_wait_date') {
      await prisma.homework.create({
        data: {
          title: state.hwTitle,
          dueDate: new Date(text),
          userId: BigInt(userId)
        }
      });
      delete userState[userId];
      return ctx.reply('✅ Домашнє завдання збережено!', Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'main_menu')]]));
    }

    if (state.step === 'ord_wait_client') {
      state.client = text;
      state.step = 'ord_wait_niche';
      return ctx.reply('🏷 Введи сферу / нішу (наприклад, Лендінг):');
    }
    if (state.step === 'ord_wait_niche') {
      state.niche = text;
      state.step = 'ord_wait_amount';
      return ctx.reply('💵 Введи суму (наприклад, `250`):');
    }
    if (state.step === 'ord_wait_amount') {
      await prisma.order.create({
        data: {
          clientName: state.client,
          niche: state.niche,
          amount: parseFloat(text) || 0,
          status: 'В роботі'
        }
      });
      delete userState[userId];
      return ctx.reply('✅ Успішно додано до CRM!', Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'main_menu')]]));
    }

    if (state.step === 'lead_wait_name') {
      state.leadName = text;
      state.step = 'lead_wait_contact';
      return ctx.reply('📞 Введи контакт ліда:');
    }
    if (state.step === 'lead_wait_contact') {
      await prisma.leadContact.create({ data: { name: state.leadName, contactInfo: text, source: 'Telegram' } });
      delete userState[userId];
      return ctx.reply('✅ Ліда збережено!', Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'main_menu')]]));
    }

    if (state.step === 'brain_wait_note') {
      await prisma.quickNote.create({ data: { content: text } });
      delete userState[userId];
      return ctx.reply('🧠 Ідею збережено!', Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'main_menu')]]));
    }

    if (state.step === 'lug_wait_title') {
      await prisma.tripItem.create({ data: { title: text } });
      delete userState[userId];
      return ctx.reply('✅ Додано в багаж!', Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'main_menu')]]));
    }

    if (state.step === 'skin_wait_title') {
      state.skinTitle = text;
      state.step = 'skin_wait_freq';
      return ctx.reply('⏳ Введи частоту (наприклад: *щодня*):');
    }
    if (state.step === 'skin_wait_freq') {
      state.skinFreq = text;
      state.step = 'skin_wait_times';
      return ctx.reply('⏰ Введи час(и) сповіщення (наприклад: `09:00, 21:00`):');
    }
    if (state.step === 'skin_wait_times') {
      await prisma.skincareRoutine.create({
        data: { title: state.skinTitle, frequency: state.skinFreq, notifTimes: text, userId: BigInt(userId) }
      });
      delete userState[userId];
      return ctx.reply('✨ Процедуру збережено!', Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'main_menu')]]));
    }

    if (state.step === 'fin_wait_title') {
      state.finTitle = text;
      state.step = 'fin_wait_amount';
      return ctx.reply('💵 Введи суму платежу:');
    }
    if (state.step === 'fin_wait_amount') {
      await prisma.subscription.create({ data: { title: state.finTitle, amount: parseFloat(text) || 0, payDate: new Date() } });
      delete userState[userId];
      return ctx.reply('✅ Платіж збережено!', Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'main_menu')]]));
    }

  } catch (err) {
    console.error('Помилка FSM:', err);
    delete userState[userId];
    await ctx.reply('❌ Сталася помилка при збереженні.');
  }
});


// ================= ГЛОБАЛЬНА ФУНКЦІЯ ПЕРЕВІРКИ СПОВІЩЕНЬ =================
// ================= ГЛОБАЛЬНА ФУНКЦІЯ ПЕРЕВІРКИ СПОВІЩЕНЬ =================
async function checkAndSendNotifications() {
  try {
    // 1. Перевірка догляду
    const routines = await prisma.skincareRoutine.findMany();
    for (const routine of routines) {
      if (!routine.userId) continue;

      // Отримуємо таймзону користувача з бази (за замовчуванням Europe/Warsaw)
      const userSetting = await prisma.userSetting.findUnique({
        where: { telegramId: routine.userId }
      });
      const userTz = userSetting?.timezone || 'Europe/Warsaw';

      // Вираховуємо поточний час саме для цього користувача
      const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: userTz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      const currentTime = formatter.format(new Date());

      if (routine.notifTimes && routine.notifTimes.includes(currentTime)) {
        await bot.telegram.sendMessage(
          Number(routine.userId),
          `✨ *Час догляду:* Настав час для процедури — *${routine.title}*!`,
          { parse_mode: 'Markdown' }
        ).catch(() => { });
      }
    }

    // 2. Перевірка ДЗ на завтра (о 09:00 ранку за часом користувача)
    const settingsList = await prisma.userSetting.findMany();
    for (const setting of settingsList) {
      const userTz = setting.timezone || 'Europe/Warsaw';

      const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: userTz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      const currentTime = formatter.format(new Date());

      if (currentTime === '09:00') {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        const homeworkDueTomorrow = await prisma.homework.findMany({
          where: {
            userId: setting.telegramId,
            isCompleted: false,
            dueDate: {
              gte: new Date(tomorrowStr + 'T00:00:00Z'),
              lte: new Date(tomorrowStr + 'T23:59:59Z')
            }
          }
        });

        for (const hw of homeworkDueTomorrow) {
          await bot.telegram.sendMessage(
            Number(setting.telegramId),
            `⚠️ *Нагадування:* Завтра дедлайн за домашнім завданням: *${hw.title}*!`,
            { parse_mode: 'Markdown' }
          ).catch(() => { });
        }
      }
    }

    return true;
  } catch (err) {
    console.error('Помилка cron-функції:', err);
    return false;
  }
}

// ================= ЕНДПОЇНТ ДЛЯ ВЕБХУКА ТА CRON =================
module.exports = async (req, res) => {
  try {
    // Виклик планувальником (cron-job.org)
    if (req.url?.includes('/api/cron') || req.query?.action === 'cron') {
      await checkAndSendNotifications();
      return res.status(200).send('Cron executed successfully');
    }

    if (req.method === 'POST') {
      await bot.handleUpdate(req.body);
      return res.status(200).send('OK');
    }

    return res.status(200).send('Bot is running');
  } catch (e) {
    console.error(e);
    return res.status(500).send('Error');
  }
};