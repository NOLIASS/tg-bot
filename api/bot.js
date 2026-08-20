const { Telegraf, Markup } = require('telegraf');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const bot = new Telegraf(process.env.BOT_TOKEN);

const userState = {};

/**
 * Динамічний рендер головного дашборду залежно від обраного режиму користувача
 */
async function sendDashboard(ctx, isEdit = false) {
  try {
    const userId = ctx.from.id;
    // Отримуємо або створюємо налаштування користувача в базі
    let userSetting = await prisma.userSetting.findUnique({ where: { telegramId: userId } });
    if (!userSetting) {
      userSetting = await prisma.userSetting.create({
        data: { telegramId: userId, mode: 'full', briefsEnabled: true, leadsEnabled: true }
      });
    }

    const mode = userSetting.mode; // 'student', 'entrepreneur', 'full'

    let text = `⚡ *ПЕРСОНАЛЬНИЙ ЕКО-АСИСТЕНТ* [Режим: *${mode.toUpperCase()}*]\n\n`;

    const keyboardButtons = [];

    // Блоки для Студента або Повної версії
    if (mode === 'student' || mode === 'full') {
      const nextHw = await prisma.homework.findFirst({ where: { isCompleted: false } });
      text += nextHw ? `📌 *ДЗ:* ${nextHw.title}\n` : `📌 *ДЗ:* Усе виконано! 🎉\n`;
      keyboardButtons.push([Markup.button.callback('📚 Навчання & ДЗ', 'mod_study')]);
    }

    // Блоки для Підприємця або Повної версії
    if (mode === 'entrepreneur' || mode === 'full') {
      const activeOrders = await prisma.order.count({ where: { status: 'В роботі' } });
      text += `💼 *Замовлень у роботі:* ${activeOrders}\n`;
      
      let row = [Markup.button.callback('💼 Робота & CRM', 'mod_work')];
      if (userSetting.leadsEnabled) row.push(Markup.button.callback('👤 Ліди', 'mod_leads'));
      keyboardButtons.push(row);

      if (userSetting.briefsEnabled) {
        keyboardButtons.push([Markup.button.callback('📋 Генератор брифів', 'mod_briefs')]);
      }
    }

    // Загальні модулі
    keyboardButtons.push([
      Markup.button.callback('🧠 Другий мозок', 'mod_brain'), 
      Markup.button.callback('💰 Фінанси', 'mod_fin')
    ]);
    keyboardButtons.push([Markup.button.callback('⚙️ Налаштування та Модулі', 'menu_settings')]);

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
    
    // Перевіряємо, чи новий користувач
    let userSetting = await prisma.userSetting.findUnique({ where: { telegramId: userId } });
    
    if (!userSetting) {
      // Показуємо екран вибору режиму (Онбординг)
      const welcomeText = `👋 Вітаю! Я твій персональний еко-асистент.\n\nОбери свій поточний режим використання, щоб я налаштував інтерфейс під твої завдання:`;
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

// Обробка вибору режиму при онбордингу
bot.action(/^set_mode_(.+)$/, async (ctx) => {
  const mode = ctx.match[1];
  const userId = ctx.from.id;
  
  await prisma.userSetting.upsert({
    where: { telegramId: userId },
    update: { mode },
    create: { telegramId: userId, mode }
  });

  await ctx.answerCbQuery(`Режим успішно змінено на: ${mode}`);
  await sendDashboard(ctx, true);
});

bot.action('main_menu', async (ctx) => {
  try {
    delete userState[ctx.from.id];
    await sendDashboard(ctx, true);
  } catch (e) { console.error(e); }
});


// ================= 1. МЕНЮ НАЛАШТУВАНЬ ТА КЕРУВАННЯ МОДУЛЯМИ =================
bot.action('menu_settings', async (ctx) => {
  const userId = ctx.from.id;
  const s = await prisma.userSetting.findUnique({ where: { telegramId: userId } });

  const text = `⚙️ *КЕРУВАННЯ МОДУЛЯМИ ТА ФУНКЦІЯМИ*\n\nОбери режим або увімкни/вимкни потрібні фічі:`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(`Режим: ${s.mode.toUpperCase()} 🔄`, 'settings_change_mode')],
    [Markup.button.callback(`${s.leadsEnabled ? '✅' : '❌'} База лідів`, 'toggle_leads')],
    [Markup.button.callback(`${s.briefsEnabled ? '✅' : '❌'} Генератор брифів`, 'toggle_briefs')],
    [Markup.button.callback('« Головне меню', 'main_menu')]
  ]);

  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('settings_change_mode', async (ctx) => {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🎓 Студент', 'set_mode_student')],
    [Markup.button.callback('💼 Підприємець', 'set_mode_entrepreneur')],
    [Markup.button.callback('🚀 Повна версія', 'set_mode_full')],
    [Markup.button.callback('« Назад', 'menu_settings')]
  ]);
  await ctx.editMessageText('Обери новий базовий режим:', { parse_mode: 'Markdown', ...keyboard });
});

bot.action('toggle_leads', async (ctx) => {
  const userId = ctx.from.id;
  const s = await prisma.userSetting.findUnique({ where: { telegramId: userId } });
  await prisma.userSetting.update({ where: { telegramId: userId }, data: { leadsEnabled: !s.leadsEnabled } });
  await ctx.answerCbQuery('Статус модулю лідів змінено');
  return menu_settings_refresh(ctx);
});

bot.action('toggle_briefs', async (ctx) => {
  const userId = ctx.from.id;
  const s = await prisma.userSetting.findUnique({ where: { telegramId: userId } });
  await prisma.userSetting.update({ where: { telegramId: userId }, data: { briefsEnabled: !s.briefsEnabled } });
  await ctx.answerCbQuery('Статус генератора брифів змінено');
  return menu_settings_refresh(ctx);
});

async function menu_settings_refresh(ctx) {
  const userId = ctx.from.id;
  const s = await prisma.userSetting.findUnique({ where: { telegramId: userId } });
  const text = `⚙️ *КЕРУВАННЯ МОДУЛЯМИ ТА ФУНКЦІЯМИ*\n\nОбери режим або увімкни/вимкни потрібні фічі:`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(`Режим: ${s.mode.toUpperCase()} 🔄`, 'settings_change_mode')],
    [Markup.button.callback(`${s.leadsEnabled ? '✅' : '❌'} База лідів`, 'toggle_leads')],
    [Markup.button.callback(`${s.briefsEnabled ? '✅' : '❌'} Генератор брифів`, 'toggle_briefs')],
    [Markup.button.callback('« Головне меню', 'main_menu')]
  ]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
}


// ================= 2. НОВІ ФІЧІ: ЛІДИ ТА БРИФИ =================
bot.action('mod_leads', async (ctx) => {
  const leads = await prisma.leadContact.findMany();
  let text = '👤 *База лідів та контактів:*\n\n';
  if (leads.length === 0) text += '_Поки немає збережених лідів._\n';
  leads.forEach((l, idx) => { text += `${idx + 1}. *${l.name}* (${l.source}) — ${l.contactInfo}\n`; });

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('➕ Додати ліда', 'lead_add')],
    [Markup.button.callback('« Головне меню', 'main_menu')]
  ]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('lead_add', async (ctx) => {
  userState[ctx.from.id] = { step: 'lead_wait_name' };
  await ctx.editMessageText('✍️ Введи імʼя ліда:', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'mod_leads')]]));
});

bot.action('mod_briefs', async (ctx) => {
  const text = `📋 *Генератор брифів та ТЗ*\n\nОбери тип проєкту для генерації швидкого опитування замовнику:`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🌐 Лендінг (Сайт)', 'brief_landing')],
    [Markup.button.callback('🛒 Інтернет-магазин', 'brief_shop')],
    [Markup.button.callback('« Головне меню', 'main_menu')]
  ]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('brief_landing', async (ctx) => {
  const briefText = `📋 *Бриф на розробку Лендінгу*\n\n1. Розкажіть про ваш продукт/послугу.\n2. Хто ваша цільова аудиторія?\n3. Які є приклади (референси) сайтів, що вам подобаються?\n4. Бажані терміни та бюджет?`;
  await ctx.editMessageText(briefText, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'mod_briefs')]]) });
});

bot.action('brief_shop', async (ctx) => {
  const briefText = `📋 *Бриф на Інтернет-магазин*\n\n1. Яка кількість товарів планується?\n2. Потрібна інтеграція з CRM чи платежами?\n3. Чи є готові дизайни / фірмовий стиль?\n4. Бажані терміни?`;
  await ctx.editMessageText(briefText, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'mod_briefs')]]) });
});


// ================= 3. БАЗОВІ МОДУЛІ (НАВЧАННЯ, CRM, МОЗОК) =================
bot.action('mod_study', async (ctx) => {
  const list = await prisma.homework.findMany({ where: { isCompleted: false } });
  let buttons = list.map(h => [Markup.button.callback(`✔️ ${h.title}`, `hw_done_${h.id}`)]);
  buttons.push([Markup.button.callback('« Головне меню', 'main_menu')]);
  await ctx.editMessageText('📌 *Твої завдання / ДЗ:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^hw_done_(\d+)$/, async (ctx) => {
  await prisma.homework.update({ where: { id: parseInt(ctx.match[1]) }, data: { isCompleted: true } });
  await ctx.answerCbQuery('Виконано! 🎉');
  await sendDashboard(ctx, true);
});

bot.action('mod_work', async (ctx) => {
  const orders = await prisma.order.findMany();
  let buttons = orders.map(o => [Markup.button.callback(`👤 ${o.clientName} | ${o.niche} (${o.amount}$) [${o.status}]`, `ord_toggle_${o.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати угоду', 'ord_add'), Markup.button.callback('« Головне меню', 'main_menu')]);
  await ctx.editMessageText('💼 *Міні-CRM замовлень:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('ord_add', async (ctx) => {
  userState[ctx.from.id] = { step: 'ord_wait_client' };
  await ctx.editMessageText('✍️ Введи імʼя клієнта:', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'mod_work')]]));
});

bot.action(/^ord_toggle_(\d+)$/, async (ctx) => {
  const order = await prisma.order.findUnique({ where: { id: parseInt(ctx.match[1]) } });
  const nextStatus = order.status === 'Новий' ? 'В роботі' : order.status === 'В роботі' ? 'Виконано' : 'Новий';
  await prisma.order.update({ where: { id: order.id }, data: { status: nextStatus } });
  await ctx.answerCbQuery(`Статус змінено на: ${nextStatus}`);
  await sendDashboard(ctx, true);
});

bot.action('mod_brain', async (ctx) => {
  const notes = await prisma.quickNote.findMany({ take: 5, orderBy: { id: 'desc' } });
  let text = '🧠 *Другий мозок (Inbox нотаток):*\n\n';
  notes.forEach((n, idx) => { text += `${idx + 1}. ${n.content}\n`; });

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('➕ Додати ідею', 'brain_add')],
    [Markup.button.callback('« Головне меню', 'main_menu')]
  ]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('brain_add', async (ctx) => {
  userState[ctx.from.id] = { step: 'brain_wait_note' };
  await ctx.editMessageText('✍️ Напиши ідею або посилання:', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'mod_brain')]]));
});

bot.action('mod_fin', async (ctx) => {
  const subs = await prisma.subscription.findMany();
  let text = '💰 *Фінанси та підписки:*\n\n';
  subs.forEach(s => { text += `🔹 ${s.title} — ${s.amount}$\n`; });

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('➕ Додати платіж', 'fin_add')],
    [Markup.button.callback('« Головне меню', 'main_menu')]
  ]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('fin_add', async (ctx) => {
  userState[ctx.from.id] = { step: 'fin_wait_title' };
  await ctx.editMessageText('✍️ Введи назву платежу:', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'mod_fin')]]));
});


// ================= FSM (ПОКРОКОВЕ ЗБЕРЕЖЕННЯ) =================
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const state = userState[userId];
  const text = ctx.message.text.trim();

  try {
    if (!state) {
      await prisma.quickNote.create({ data: { content: text } });
      try { await ctx.deleteMessage(); } catch (e) {}
      return ctx.reply('🧠 Збережено в «Другий мозок»!');
    }

    // Збереження ліда
    if (state.step === 'lead_wait_name') {
      state.leadName = text;
      state.step = 'lead_wait_contact';
      return ctx.reply('✍️ Введи контакт (телефон або Telegram нік):');
    }
    if (state.step === 'lead_wait_contact') {
      state.leadContact = text;
      state.step = 'lead_wait_source';
      return ctx.reply('✍️ Введи джерело (наприклад, *Meta Ads* або *Органіка*):');
    }
    if (state.step === 'lead_wait_source') {
      await prisma.leadContact.create({
        data: { name: state.leadName, contactInfo: state.leadContact, source: text }
      });
      delete userState[userId];
      return ctx.reply('✅ Ліда успішно збережено в базу!', Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'main_menu')]]));
    }

    // CRM замовлення
    if (state.step === 'ord_wait_client') {
      state.client = text;
      state.step = 'ord_wait_niche';
      return ctx.reply('✍️ Введи нішу / послугу:');
    }
    if (state.step === 'ord_wait_niche') {
      state.niche = text;
      state.step = 'ord_wait_amount';
      return ctx.reply('💵 Введи суму в доларах:');
    }
    if (state.step === 'ord_wait_amount') {
      await prisma.order.create({ data: { clientName: state.client, niche: state.niche, amount: parseFloat(text) || 0 } });
      delete userState[userId];
      return ctx.reply('✅ Замовлення додано до CRM!', Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'main_menu')]]));
    }

    // Другий мозок
    if (state.step === 'brain_wait_note') {
      await prisma.quickNote.create({ data: { content: text } });
      delete userState[userId];
      return ctx.reply('🧠 Ідею збережено!', Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'main_menu')]]));
    }

    // Фінанси
    if (state.step === 'fin_wait_title') {
      state.finTitle = text;
      state.step = 'fin_wait_amount';
      return ctx.reply('💵 Введи вартість платежу:');
    }
    if (state.step === 'fin_wait_amount') {
      await prisma.subscription.create({ data: { title: state.finTitle, amount: parseFloat(text) || 0, payDate: new Date() } });
      delete userState[userId];
      return ctx.reply('✅ Платіж збережено!', Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'main_menu')]]));
    }
  } catch (err) {
    console.error('Помилка FSM:', err);
    delete userState[userId];
    await ctx.reply('❌ Сталася помилка. Спробуй ще раз.');
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