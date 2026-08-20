const { Telegraf, Markup } = require('telegraf');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const bot = new Telegraf(process.env.BOT_TOKEN);

// Головна функція створення/оновлення панелі хабу в чаті
async function sendHubMenu(ctx, category = 'all', isEdit = true) {
  let text = '';
  let keyboard = [];

  // Контент для кожного розділу
  switch (category) {
    case 'study':
      text = `📚 *НАВЧАННЯ ТА РОЗКЛАД*\n\n• Актуальні заміни: Немає\n• Найближчі завдання: Перевірити розклад пар.`;
      break;
    case 'work':
      text = `💼 *РОБОТА & ФРИЛАНС*\n\n• Активні проєкти: Лендинги та сайти в розробці.\n• Статус: Усе за графіком.`;
      break;
    case 'trip':
      text = `🧳 *ПОЇЗДКА*\n\n• Чек-лист речей у дорогу.\n• Документи та квитки готові.`;
      break;
    case 'brain':
      text = `🧠 *ДРУГИЙ МОЗОК*\n\n• Швидкі нотатки та збережені ідеї. Напиши текст сюди, щоб зберегти його.`;
      break;
    case 'fin':
      text = `💰 *ФІНАНСИ*\n\n• Витрати, підписки та бюджети.`;
      break;
    default:
      text = `🌐 *ПЕРСОНАЛЬНИЙ ХАБ*\n\nОбери потрібний розділ за допомогою кнопок нижче, або надішли повідомлення, щоб зберегти нотатку:`;
      break;
  }

  // Створюємо інтерфейс кнопок (як меню-панель)
  keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('🌐 Усі', 'hub_all'),
      Markup.button.callback('📚 Навчання', 'hub_study'),
      Markup.button.callback('💼 Робота', 'hub_work')
    ],
    [
      Markup.button.callback('🧳 Поїздка', 'hub_trip'),
      Markup.button.callback('🧠 Мозок', 'hub_brain'),
      Markup.button.callback('💰 Фінанси', 'hub_fin')
    ]
  ]);

  if (isEdit) {
    try {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    } catch (e) {
      // Якщо текст не змінився, Telegram кидає помилку — просто ігноруємо її
    }
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
  }
}

// Команда /start
bot.start(async (ctx) => {
  await sendHubMenu(ctx, 'all', false);
});

// Обробники натискань на кнопки категорій
bot.action('hub_all', (ctx) => { ctx.answerCbQuery(); return sendHubMenu(ctx, 'all', true); });
bot.action('hub_study', (ctx) => { ctx.answerCbQuery(); return sendHubMenu(ctx, 'study', true); });
bot.action('hub_work', (ctx) => { ctx.answerCbQuery(); return sendHubMenu(ctx, 'work', true); });
bot.action('hub_trip', (ctx) => { ctx.answerCbQuery(); return sendHubMenu(ctx, 'trip', true); });
bot.action('hub_brain', (ctx) => { ctx.answerCbQuery(); return sendHubMenu(ctx, 'brain', true); });
bot.action('hub_fin', (ctx) => { ctx.answerCbQuery(); return sendHubMenu(ctx, 'fin', true); });

// Обробник звичайного тексту (коли ти пишеш у чат нотатку або завдання)
bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();

  // Зберігаємо нотатку в базу даних
  try {
    await prisma.quickNote.create({
      data: { content: text }
    });
  } catch (err) {
    console.error('Помилка збереження:', err);
  }

  // Видаляємо твоє вхідне повідомлення, щоб чат був чистим
  try {
    await ctx.deleteMessage();
  } catch (e) {}

  // Надсилаємо коротке сповіщення або оновлюємо хаб
  await ctx.reply(`✅ Збережено у «Другий мозок»!`);
  await sendHubMenu(ctx, 'all', false);
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