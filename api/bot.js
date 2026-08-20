const { Telegraf, Markup } = require('telegraf');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const bot = new Telegraf(process.env.BOT_TOKEN);

const userState = {};

// --- СТРУКТУРОВАНИЙ ГОЛОВНИЙ ХАБ ---
async function sendDashboard(ctx, isEdit = false) {
  const nextHw = await prisma.homework.findFirst({ where: { isCompleted: false }, orderBy: { dueDate: 'asc' } });
  const mainGoal = await prisma.goal.findFirst({ where: { isCompleted: false }, orderBy: { targetDate: 'asc' } });
  const tripCount = await prisma.tripItem.count({ where: { isPacked: false } });
  const activeOrders = await prisma.order.count({ where: { status: 'В роботі' } });

  let text = `
🌐 *ПЕРСОНАЛЬНИЙ ХАБ*
────────────────────────
#️⃣ *Навчання / ДЗ*
   ${nextHw ? `📌 ${nextHw.title}` : '✅ Усе виконано! 🎉'}

🎯 *Головна ціль*
   ${mainGoal ? `🎯 ${mainGoal.title} [${mainGoal.progress}%]` : '🎯 Немає активних цілей'}

🧳 *Багаж у дорогу*
   📦 Залишилось зібрати: ${tripCount} речей

💼 *Робочі замовлення*
   🛠 В роботі: ${activeOrders} проєктів
────────────────────────
_Обери розділ нижче для керування:_
`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📚 Навчання & ДЗ', 'mod_study'), Markup.button.callback('💼 Робота & CRM', 'mod_work')],
    [Markup.button.callback('🧳 У дорогу', 'mod_trip'), Markup.button.callback('🧠 Другий мозок', 'mod_brain')],
    [Markup.button.callback('💰 Фінанси & Підписки', 'mod_fin'), Markup.button.callback('⚙️ Налаштування', 'menu_settings')]
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
  delete userState[ctx.from.id];
  await sendDashboard(ctx, false);
});

bot.action('main_menu', async (ctx) => {
  delete userState[ctx.from.id];
  await sendDashboard(ctx, true);
});


// ================= 1. МОДУЛЬ: НАВЧАННЯ & СТУДЕНТСТВО =================
bot.action('mod_study', async (ctx) => {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📌 Дедлайни та ДЗ', 'st_hw'), Markup.button.callback('📚 Розклад пар', 'st_sched')],
    [Markup.button.callback('🧠 Картки / Квізи', 'st_quiz')],
    [Markup.button.callback('« Головне меню', 'main_menu')]
  ]);
  await ctx.editMessageText('📚 *Розділ: Навчання*\n────────────────────────\nОбери підрозділ нижче:', { parse_mode: 'Markdown', ...keyboard });
});

bot.action('st_hw', async (ctx) => {
  const list = await prisma.homework.findMany({ where: { isCompleted: false } });
  let buttons = list.map(h => [Markup.button.callback(`✔️ ${h.title}`, `hw_done_${h.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати ДЗ', 'hw_add'), Markup.button.callback('« Назад', 'mod_study')]);
  await ctx.editMessageText('📌 *Твої завдання:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('hw_add', async (ctx) => {
  userState[ctx.from.id] = { step: 'hw_wait_title' };
  await ctx.editMessageText('✍️ Введи назву задачі/ДЗ:', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'st_hw')]]));
});

bot.action(/^hw_done_(\d+)$/, async (ctx) => {
  await prisma.homework.update({ where: { id: parseInt(ctx.match[1]) }, data: { isCompleted: true } });
  await ctx.answerCbQuery('Виконано! 🎉');
  await sendDashboard(ctx, true);
});

bot.action('st_sched', async (ctx) => {
  const sched = await prisma.schedule.findMany();
  let buttons = sched.map(s => [Markup.button.callback(`📖 ${s.dayOfWeek} ${s.time} — ${s.subject}`, `sched_del_${s.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати пару', 'sched_add'), Markup.button.callback('« Назад', 'mod_study')]);
  await ctx.editMessageText('📚 *Розклад пар:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('sched_add', async (ctx) => {
  userState[ctx.from.id] = { step: 'sched_wait_data' };
  await ctx.editMessageText('✍️ Введи у форматі: `День, Час, Предмет`', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'st_sched')]]));
});

bot.action(/^sched_del_(\d+)$/, async (ctx) => {
  await prisma.schedule.delete({ where: { id: parseInt(ctx.match[1]) } });
  await ctx.answerCbQuery('Видалено');
  await sendDashboard(ctx, true);
});

bot.action('st_quiz', async (ctx) => {
  const card = await prisma.flashcard.findFirst();
  if (!card) {
    return ctx.editMessageText('🧠 Картки відсутні. Додай першу!', Markup.inlineKeyboard([
      [Markup.button.callback('➕ Додати картку', 'quiz_add')],
      [Markup.button.callback('« Назад', 'mod_study')]
    ]));
  }
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('👀 Показати відповідь', `quiz_ans_${card.id}`)],
    [Markup.button.callback('➕ Додати ще', 'quiz_add'), Markup.button.callback('« Назад', 'mod_study')]
  ]);
  await ctx.editMessageText(`🧠 *Питання:* ${card.question}`, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('quiz_add', async (ctx) => {
  userState[ctx.from.id] = { step: 'quiz_wait_q' };
  await ctx.editMessageText('✍️ Введи запитання для картки:', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'st_quiz')]]));
});

bot.action(/^quiz_ans_(\d+)$/, async (ctx) => {
  const card = await prisma.flashcard.findUnique({ where: { id: parseInt(ctx.match[1]) } });
  await ctx.editMessageText(`🧠 *Питання:* ${card.question}\n\n✅ *Відповідь:* ${card.answer}`, Markup.inlineKeyboard([
    [Markup.button.callback('🔄 Наступна картка', 'st_quiz')],
    [Markup.button.callback('« Назад', 'mod_study')]
  ]));
});


// ================= 2. МОДУЛЬ: РОБОТА & МІНІ-CRM =================
bot.action('mod_work', async (ctx) => {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💼 Мої замовлення (CRM)', 'work_crm'), Markup.button.callback('⏱ Тайм-трекер', 'work_time')],
    [Markup.button.callback('🧮 Калькулятор маржі', 'work_calc')],
    [Markup.button.callback('« Головне меню', 'main_menu')]
  ]);
  await ctx.editMessageText('💼 *Модуль: Робота та Фріланс*\n────────────────────────', { parse_mode: 'Markdown', ...keyboard });
});

bot.action('work_crm', async (ctx) => {
  const orders = await prisma.order.findMany();
  let buttons = orders.map(o => [Markup.button.callback(`👤 ${o.clientName} | ${o.niche} (${o.amount}$) [${o.status}]`, `ord_toggle_${o.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати замовлення', 'ord_add'), Markup.button.callback('« Назад', 'mod_work')]);
  await ctx.editMessageText('💼 *Міні-CRM замовлень:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('ord_add', async (ctx) => {
  userState[ctx.from.id] = { step: 'ord_wait_client' };
  await ctx.editMessageText('✍️ Введи імʼя клієнта:', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'work_crm')]]));
});

bot.action(/^ord_toggle_(\d+)$/, async (ctx) => {
  const order = await prisma.order.findUnique({ where: { id: parseInt(ctx.match[1]) } });
  const nextStatus = order.status === 'Новий' ? 'В роботі' : order.status === 'В роботі' ? 'Виконано' : 'Новий';
  await prisma.order.update({ where: { id: order.id }, data: { status: nextStatus } });
  await ctx.answerCbQuery(`Статус змінено на: ${nextStatus}`);
  await sendDashboard(ctx, true);
});

bot.action('work_time', async (ctx) => {
  userState[ctx.from.id] = { step: 'time_wait_project' };
  await ctx.editMessageText('⏱ Введи назву проєкту/завдання, для якого запускаєш тайм-трекер:', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'mod_work')]]));
});

bot.action('work_calc', async (ctx) => {
  await ctx.editMessageText('🧮 Калькулятор маржі: Напиши ціну закупівлі та ціну продажу через пробіл (наприклад: `100 250`), і бот порахує прибуток.', Markup.inlineKeyboard([
    [Markup.button.callback('« Назад', 'mod_work')]
  ]));
  userState[ctx.from.id] = { step: 'calc_wait_numbers' };
});


// ================= 3. МОДУЛЬ: У ДОРОГУ =================
bot.action('mod_trip', async (ctx) => {
  const items = await prisma.tripItem.findMany();
  let buttons = items.map(i => [Markup.button.callback(`${i.isPacked ? '✅' : '🔲'} [${i.category}] ${i.title} (${i.quantity} шт.)`, `trip_tgl_${i.id}`)]);
  buttons.push([Markup.button.callback('➕ Додати річ', 'trip_add'), Markup.button.callback('« Головне меню', 'main_menu')]);
  await ctx.editMessageText('🧳 *Чек-лист поїздки:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('trip_add', async (ctx) => {
  userState[ctx.from.id] = { step: 'trip_wait_cat' };
  await ctx.editMessageText('🗂 Обери категорію:', Markup.inlineKeyboard([
    [Markup.button.callback('💻 Техніка', 'trip_c_Техніка'), Markup.button.callback('👕 Одяг', 'trip_c_Одяг')],
    [Markup.button.callback('📄 Документи', 'trip_c_Документи')],
    [Markup.button.callback('« Назад', 'mod_trip')]
  ]));
});

bot.action(/^trip_c_(.+)$/, async (ctx) => {
  userState[ctx.from.id] = { step: 'trip_wait_title', category: ctx.match[1] };
  await ctx.editMessageText(`✍️ Введи назву речі для категорії *${ctx.match[1]}*:`, Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'mod_trip')]]));
});

bot.action(/^trip_tgl_(\d+)$/, async (ctx) => {
  const item = await prisma.tripItem.findUnique({ where: { id: parseInt(ctx.match[1]) } });
  await prisma.tripItem.update({ where: { id: item.id }, data: { isPacked: !item.isPacked } });
  await ctx.answerCbQuery('Статус оновлено');
  await sendDashboard(ctx, true);
});


// ================= 4. МОДУЛЬ: ДРУГИЙ МОЗОК =================
bot.action('mod_brain', async (ctx) => {
  const notes = await prisma.quickNote.findMany({ take: 5, orderBy: { id: 'desc' } });
  let text = '🧠 *Другий мозок (Inbox нотаток):*\n────────────────────────\n';
  notes.forEach((n, idx) => { text += `${idx + 1}. ${n.content}\n`; });

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('➕ Додати нотатку/ідею', 'brain_add')],
    [Markup.button.callback('« Головне меню', 'main_menu')]
  ]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('brain_add', async (ctx) => {
  userState[ctx.from.id] = { step: 'brain_wait_note' };
  await ctx.editMessageText('✍️ Напиши або скінь будь-яку ідею/посилання, щоб зберегти її в базу:', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'mod_brain')]]));
});


// ================= 5. МОДУЛЬ: ФІНАНСИ & ПІДПИСКИ =================
bot.action('mod_fin', async (ctx) => {
  const subs = await prisma.subscription.findMany();
  let text = '💰 *Регулярні платежі та підписки:*\n────────────────────────\n';
  subs.forEach(s => { text += `🔹 ${s.title} — ${s.amount}$\n`; });

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('➕ Додати підписку', 'fin_add')],
    [Markup.button.callback('« Головне меню', 'main_menu')]
  ]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('fin_add', async (ctx) => {
  userState[ctx.from.id] = { step: 'fin_wait_title' };
  await ctx.editMessageText('✍️ Введи назву підписки/платежу:', Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'mod_fin')]]));
});

bot.action('menu_settings', async (ctx) => {
  await ctx.editMessageText('⚙️ *Налаштування активні*', Markup.inlineKeyboard([[Markup.button.callback('« Головне меню', 'main_menu')]]));
});


// ================= FSM (ПОКРОКОВЕ ЗБЕРЕЖЕННЯ) =================
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const state = userState[userId];
  const text = ctx.message.text.trim();

  // Видаляємо вхідне повідомлення користувача для чистоти «інтерфейсу сайту»
  try { await ctx.deleteMessage(); } catch (e) {}

  if (!state) return;

  if (state.step === 'hw_wait_title') {
    await prisma.homework.create({ data: { title: text, dueDate: new Date(Date.now() + 86400000 * 3) } });
    delete userState[userId];
    return sendDashboard(ctx, true);
  }
  if (state.step === 'sched_wait_data') {
    const p = text.split(',').map(x => x.trim());
    await prisma.schedule.create({ data: { dayOfWeek: p[0] || 'Пн', time: p[1] || '08:30', subject: p[2] || 'Пара' } });
    delete userState[userId];
    return sendDashboard(ctx, true);
  }
  if (state.step === 'quiz_wait_q') {
    state.q = text;
    state.step = 'quiz_wait_a';
    return;
  }
  if (state.step === 'quiz_wait_a') {
    await prisma.flashcard.create({ data: { question: state.q, answer: text } });
    delete userState[userId];
    return sendDashboard(ctx, true);
  }
  if (state.step === 'ord_wait_client') {
    state.client = text;
    state.step = 'ord_wait_niche';
    return;
  }
  if (state.step === 'ord_wait_niche') {
    state.niche = text;
    state.step = 'ord_wait_amount';
    return;
  }
  if (state.step === 'ord_wait_amount') {
    await prisma.order.create({ data: { clientName: state.client, niche: state.niche, amount: parseFloat(text) || 0 } });
    delete userState[userId];
    return sendDashboard(ctx, true);
  }
  if (state.step === 'time_wait_project') {
    await prisma.TimeLog.create({ data: { projectName: text } });
    delete userState[userId];
    return sendDashboard(ctx, true);
  }
  if (state.step === 'calc_wait_numbers') {
    const [buy, sell] = text.split(' ').map(Number);
    delete userState[userId];
    return sendDashboard(ctx, true);
  }
  if (state.step === 'trip_wait_title') {
    await prisma.tripItem.create({ data: { category: state.category, title: text, quantity: 1 } });
    delete userState[userId];
    return sendDashboard(ctx, true);
  }
  if (state.step === 'brain_wait_note') {
    await prisma.quickNote.create({ data: { content: text } });
    delete userState[userId];
    return sendDashboard(ctx, true);
  }
  if (state.step === 'fin_wait_title') {
    state.finTitle = text;
    state.step = 'fin_wait_amount';
    return;
  }
  if (state.step === 'fin_wait_amount') {
    await prisma.subscription.create({ data: { title: state.finTitle, amount: parseFloat(text) || 0, payDate: new Date() } });
    delete userState[userId];
    return sendDashboard(ctx, true);
  }
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