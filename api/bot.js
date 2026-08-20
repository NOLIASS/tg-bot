const { Telegraf, Markup } = require('telegraf');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const bot = new Telegraf(process.env.BOT_TOKEN);

const userState = {};

/**
 * Динамічний рендер головного бізнес-дашборду
 */
async function sendDashboard(ctx, isEdit = false) {
  try {
    const userId = ctx.from.id;
    let userSetting = await prisma.userSetting.findUnique({ where: { telegramId: userId } });
    if (!userSetting) {
      userSetting = await prisma.userSetting.create({
        data: { telegramId: userId, mode: 'full', notifTime: '09:00' }
      });
    }

    const mode = userSetting.mode;
    let text = `⚡ *ПЕРСОНАЛЬНИЙ ЕКО-АСИСТЕНТ* [Режим: *${mode.toUpperCase()}*]\n`;
    text += `⏰ *Час сповіщень:* ${userSetting.notifTime}\n\n`;

    const keyboardButtons = [];

    if (mode === 'student' || mode === 'full') {
      const nextHw = await prisma.homework.findFirst({ where: { isCompleted: false } });
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
    let userSetting = await prisma.userSetting.findUnique({ where: { telegramId: userId } });

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
    where: { telegramId: userId },
    update: { mode },
    create: { telegramId: userId, mode }
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


// ================= 1. НАВЧАННЯ ТА РОЗКЛАД (Гнучке управління) =================
bot.action('mod_study', async (ctx) => {
  await ctx.answerCbQuery();
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📌 Дедлайни та ДЗ', 'st_hw'), Markup.button.callback('📚 Розклад пар', 'st_sched')],
    [Markup.button.callback('« Головне меню', 'main_menu')]
  ]);
  await ctx.editMessageText('📚 *Модуль навчання:*', { parse_mode: 'Markdown', ...keyboard });
});

bot.action('st_sched', async (ctx) => {
  await ctx.answerCbQuery();
  const sched = await prisma.schedule.findMany();
  let buttons = sched.map(s => [Markup.button.callback(`📖 [${s.dayOfWeek}] ${s.time} — ${s.subject}`, `sched_del_${s.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати пару', 'sched_add'), Markup.button.callback('« Назад', 'mod_study')]);
  await ctx.editMessageText('📚 *Розклад занять:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('sched_add', async (ctx) => {
  await ctx.answerCbQuery();
  userState[ctx.from.id] = { step: 'sched_wait_day' };
  await ctx.editMessageText('✍️ Введи день тижня (наприклад, *Понеділок*):', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'st_sched')]]));
});

bot.action(/^sched_del_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery('Пару видалено');
  await prisma.schedule.delete({ where: { id: parseInt(ctx.match[1]) } });
  return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.update.callback_query, data: 'st_sched' } });
});

bot.action('st_hw', async (ctx) => {
  await ctx.answerCbQuery();
  const list = await prisma.homework.findMany({ where: { isCompleted: false } });
  let buttons = list.map(h => [Markup.button.callback(`✔️ ${h.title} (${h.subject || 'Без предмету'})`, `hw_done_${h.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати ДЗ', 'hw_add'), Markup.button.callback('« Назад', 'mod_study')]);
  await ctx.editMessageText('📌 *Домашні завдання:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('hw_add', async (ctx) => {
  await ctx.answerCbQuery();
  userState[ctx.from.id] = { step: 'hw_wait_title' };
  await ctx.editMessageText('✍️ Введи назву домашнього завдання:', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'st_hw')]]));
});

bot.action(/^hw_done_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery('Виконано! 🎉');
  await prisma.homework.update({ where: { id: parseInt(ctx.match[1]) }, data: { isCompleted: true } });
  return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.update.callback_query, data: 'st_hw' } });
});


// ================= 2. РОБОТА ТА ГНУЧКА CRM (Фільтри, не обов'язкові поля) =================
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
    let buttons = orders.map(o => [Markup.button.callback(`👤 ${o.clientName} | ${o.niche} (${o.amount} ${o.currency}) [${o.status}]`, `ord_toggle_${o.id}`)]);
    buttons.push([Markup.button.callback('➕ Додати замовлення', 'ord_add'), Markup.button.callback('« Назад', 'mod_work')]);
    if (ctx.callbackQuery) {
      await ctx.editMessageText('💼 *Список угод за фільтром:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    }
  } catch (e) { console.error(e); }
}

bot.action('ord_add', async (ctx) => {
  await ctx.answerCbQuery();
  userState[ctx.from.id] = { step: 'ord_wait_client' };
  await ctx.editMessageText('✍️ Введи ПІБ клієнта або назву проєкту (або натисни «Пропустити»):', Markup.inlineKeyboard([
    [Markup.button.callback('⏭ Пропустити', 'ord_skip_client')],
    [Markup.button.callback('« Назад', 'mod_work')]
  ]));
});

bot.action('ord_skip_client', async (ctx) => {
  await ctx.answerCbQuery();
  userState[ctx.from.id].client = 'Без імені';
  userState[ctx.from.id].step = 'ord_wait_phone';
  await ctx.editMessageText('📞 Введи номер телефону (необов’язково, можеш пропустити):', Markup.inlineKeyboard([
    [Markup.button.callback('⏭ Пропустити', 'ord_skip_phone')]
  ]));
});

bot.action('ord_skip_phone', async (ctx) => {
  await ctx.answerCbQuery();
  userState[ctx.from.id].phone = 'Не вказано';
  userState[ctx.from.id].step = 'ord_wait_niche';
  await ctx.editMessageText('🏷 Введи сферу / нішу (наприклад, Лендінг, SMM):');
});

bot.action(/^ord_toggle_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const order = await prisma.order.findUnique({ where: { id: parseInt(ctx.match[1]) } });
  const nextStatus = order.status === 'Новий' ? 'В роботі' : order.status === 'В роботі' ? 'Виконано' : 'Новий';
  await prisma.order.update({ where: { id: order.id }, data: { status: nextStatus } });
  await ctx.answerCbQuery(`Статус: ${nextStatus}`);
  return renderCrmList(ctx, {});
});


// ================= 3. ІНШІ МОДУЛІ (БРИФИ, ЛІДИ, ДОГЛЯД, ТОЩО) =================
bot.action('mod_leads', async (ctx) => {
  await ctx.answerCbQuery();
  const leads = await prisma.leadContact.findMany();
  let text = '👤 *База лідів:*\n\n';
  leads.forEach((l, idx) => { text += `${idx + 1}. *${l.name}* (${l.contactInfo})\n`; });
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('➕ Додати ліда', 'lead_add')],
    [Markup.button.callback('« Головне меню', 'main_menu')]
  ]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('lead_add', async (ctx) => {
  await ctx.answerCbQuery();
  userState[ctx.from.id] = { step: 'lead_wait_name' };
  await ctx.editMessageText("✍️ Введи ім'я ліда:", Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'mod_leads')]]));
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
  let text = '🧠 *Другий мозок:*\n\n';
  notes.forEach((n, idx) => { text += `${idx + 1}. ${n.content}\n`; });
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('➕ Додати ідею', 'brain_add'), Markup.button.callback('« Меню', 'main_menu')]]) });
});

bot.action('brain_add', async (ctx) => {
  await ctx.answerCbQuery();
  userState[ctx.from.id] = { step: 'brain_wait_note' };
  await ctx.editMessageText('✍️ Напиши ідею:', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'mod_brain')]]));
});

bot.action('mod_fin', async (ctx) => {
  await ctx.answerCbQuery();
  const subs = await prisma.subscription.findMany();
  let text = '💰 *Фінанси та підписки:*\n\n';
  subs.forEach(s => { text += `🔹 ${s.title} — ${s.amount} ${s.currency || '$'}\n`; });
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('➕ Додати платіж', 'fin_add'), Markup.button.callback('« Меню', 'main_menu')]]) });
});

bot.action('fin_add', async (ctx) => {
  await ctx.answerCbQuery();
  userState[ctx.from.id] = { step: 'fin_wait_title' };
  await ctx.editMessageText('✍️ Введи назву платежу:', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'mod_fin')]]));
});

bot.action('mod_luggage', async (ctx) => {
  await ctx.answerCbQuery();
  const items = await prisma.luggageItem.findMany();
  let buttons = items.map(i => [Markup.button.callback(`${i.isPacked ? '✅' : '🔲'} ${i.title}`, `lug_tgl_${i.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати річ', 'lug_add'), Markup.button.callback('« Меню', 'main_menu')]);
  await ctx.editMessageText('🧳 *Багаж у дорогу:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('lug_add', async (ctx) => {
  await ctx.answerCbQuery();
  userState[ctx.from.id] = { step: 'lug_wait_title' };
  await ctx.editMessageText('✍️ Введи назву речі:', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'mod_luggage')]]));
});

bot.action(/^lug_tgl_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const item = await prisma.luggageItem.findUnique({ where: { id: parseInt(ctx.match[1]) } });
  await prisma.luggageItem.update({ where: { id: item.id }, data: { isPacked: !item.isPacked } });
  return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.update.callback_query, data: 'mod_luggage' } });
});

bot.action('mod_skincare', async (ctx) => {
  await ctx.answerCbQuery();
  const routines = await prisma.skincareRoutine.findMany();
  let text = "✨ *Б'юті-рутина та догляд:*\n\n";
  let buttons = routines.map(r => [Markup.button.callback(`✔️ Виконати: ${r.title} (${r.frequency})`, `skin_done_${r.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати процедуру', 'skin_add'), Markup.button.callback('« Меню', 'main_menu')]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('skin_add', async (ctx) => {
  await ctx.answerCbQuery();
  userState[ctx.from.id] = { step: 'skin_wait_title' };
  await ctx.editMessageText('✍️ Введи процедуру (наприклад, Скраб):', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'mod_skincare')]]));
});

bot.action(/^skin_done_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery('Записано! ✨');
  await prisma.skincareRoutine.update({ where: { id: parseInt(ctx.match[1]) }, data: { lastDone: new Date() } });
  return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.update.callback_query, data: 'mod_skincare' } });
});


// ================= 4. НАЛАШТУВАННЯ ЧАСУ СПОВІЩЕНЬ =================
bot.action('menu_settings', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const s = await prisma.userSetting.findUnique({ where: { telegramId: userId } });
  const text = `⚙️ *Налаштування*\n\n⏰ Поточний час сповіщень: *${s.notifTime}*`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⏰ Змінити час сповіщень', 'set_notif_time')],
    [Markup.button.callback('« Головне меню', 'main_menu')]
  ]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('set_notif_time', async (ctx) => {
  await ctx.answerCbQuery();
  userState[ctx.from.id] = { step: 'wait_notif_time' };
  await ctx.editMessageText('✍️ Введи новий час сповіщень у форматі `HH:MM` (наприклад, `09:30` або `18:00`):', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'menu_settings')]]));
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

    // Час сповіщень
    if (state.step === 'wait_notif_time') {
      await prisma.userSetting.update({ where: { telegramId: userId }, data: { notifTime: text } });
      delete userState[userId];
      return ctx.reply(`✅ Час сповіщень змінено на ${text}!`, Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'main_menu')]]));
    }

    // Розклад
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

    // ДЗ
    if (state.step === 'hw_wait_title') {
      state.hwTitle = text;
      state.step = 'hw_wait_subj';
      return ctx.reply('📚 Введи предмет (необов’язково, або пропусти):');
    }
    if (state.step === 'hw_wait_subj') {
      await prisma.homework.create({ data: { title: state.hwTitle, subject: text, dueDate: new Date(Date.now() + 86400000 * 2) } });
      delete userState[userId];
      return ctx.reply('✅ Домашнє завдання збережено!', Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'main_menu')]]));
    }

    // CRM Замовлення (гнучке)
    if (state.step === 'ord_wait_client') {
      state.client = text;
      state.step = 'ord_wait_phone';
      return ctx.reply('📞 Введи номер телефону (необов’язково):');
    }
    if (state.step === 'ord_wait_phone') {
      state.phone = text;
      state.step = 'ord_wait_niche';
      return ctx.reply('🏷 Введи сферу / нішу (наприклад, Лендінг, SMM):');
    }
    if (state.step === 'ord_wait_niche') {
      state.niche = text;
      state.step = 'ord_wait_amount';
      return ctx.reply('💵 Введи суму (наприклад, `250`):');
    }
    if (state.step === 'ord_wait_amount') {
      state.amount = parseFloat(text) || 0;
      state.step = 'ord_wait_currency';
      return ctx.reply('💱 Обери валюту (наприклад: `$`, `UAH`, `PLN`):');
    }
    if (state.step === 'ord_wait_currency') {
      await prisma.order.create({
        data: {
          clientName: state.client || 'Без імені',
          phone: state.phone || 'Не вказано',
          niche: state.niche || 'Інше',
          amount: state.amount || 0,
          currency: text || '$',
          status: 'В роботі'
        }
      });
      delete userState[userId];
      return ctx.reply('✅ Успішно додано до CRM!', Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'main_menu')]]));
    }

    // Інші базові FSM
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
      await prisma.luggageItem.create({ data: { title: text } });
      delete userState[userId];
      return ctx.reply('✅ Додано в багаж!', Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'main_menu')]]));
    }
    if (state.step === 'skin_wait_title') {
      state.skinTitle = text;
      state.step = 'skin_wait_freq';
      return ctx.reply('⏳ Введи частоту (наприклад: *щодня*, *через день*):');
    }
    if (state.step === 'skin_wait_freq') {
      await prisma.skincareRoutine.create({ data: { title: state.skinTitle, frequency: text } });
      delete userState[userId];
      return ctx.reply('✨ Процедуру збережено!', Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'main_menu')]]));
    }
    if (state.step === 'fin_wait_title') {
      state.finTitle = text;
      state.step = 'fin_wait_amount';
      return ctx.reply('💵 Введи суму платежу:');
    }
    if (state.step === 'fin_wait_amount') {
      await prisma.subscription.create({ data: { title: state.finTitle, amount: parseFloat(text) || 0, currency: '$', payDate: new Date() } });
      delete userState[userId];
      return ctx.reply('✅ Платіж збережено!', Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'main_menu')]]));
    }

  } catch (err) {
    console.error('Помилка FSM:', err);
    delete userState[userId];
    await ctx.reply('❌ Сталася помилка при збереженні.');
  }
});

module.exports = async (req, res) => {
  try {
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