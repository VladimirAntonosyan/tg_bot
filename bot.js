const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Конфигурация
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
    console.error('❌ Укажи TELEGRAM_BOT_TOKEN в файле .env');
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });
const TEAMS_FILE = path.join(__dirname, 'teams.json');

// Загрузка списка команд
function loadTeams() {
    try {
        if (!fs.existsSync(TEAMS_FILE)) {
            // Если файла нет, создаем с дефолтным списком
            const defaultTeams = [
                "Real Madrid",
                "Manchester City",
                "FC Bayern München",
                "Arsenal",
                "Liverpool",
                "Bayer 04 Leverkusen",
                "FC Barcelona",
                "Paris Saint-Germain",
                "Atlético de Madrid",
                "Inter Milan",
                "Manchester United",
                "Tottenham Hotspur",
                "Borussia Dortmund",
                "Napoli",
                "Juventus",
                "Newcastle United",
                "Milano FC (AC Milan)",
                "Chelsea",
                "RB Leipzig",
                "Latium",
                "Aston Villa",
                "Roma (AS Roma)"
            ];
            saveTeams(defaultTeams);
            return defaultTeams;
        }
        const data = fs.readFileSync(TEAMS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Ошибка загрузки команд:', error);
        return [];
    }
}

// Сохранение списка команд
function saveTeams(teams) {
    fs.writeFileSync(TEAMS_FILE, JSON.stringify(teams, null, 2));
}

// Перемешивание массива
function shuffleArray(arr) {
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// Проверка, является ли пользователь администратором чата
async function isAdmin(chatId, userId) {
    try {
        const chatMember = await bot.getChatMember(chatId, userId);
        return chatMember.status === 'administrator' || chatMember.status === 'creator';
    } catch (error) {
        return false;
    }
}

// Безопасная отправка сообщения (без Markdown)
function sendSafeMessage(chatId, text) {
    bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
}

// Команда /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = `
🎯 <b>Турнирный бот</b>

Доступные команды:

/draw @участник1 @участник2 ... - распределить команды

<b>Управление командами (только админ чата):</b>
/add_team Название - добавить команду
/remove_team Название - удалить команду
/list_teams - показать список команд

<b>Пример:</b> 
/draw @Владимир @Нурик @Никита @Станислав
    `;
    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'HTML' });
});

// Команда /draw - основная логика
bot.onText(/\/draw(@\w+)?(\s+@\w+)*/, async (msg) => {
    const chatId = msg.chat.id;
    const messageText = msg.text;

    // Извлекаем упомянутых пользователей
    const mentionRegex = /@(\w+)/g;
    const mentions = [];
    let mentionMatch;

    while ((mentionMatch = mentionRegex.exec(messageText)) !== null) {
        mentions.push(mentionMatch[1]);
    }

    if (mentions.length === 0) {
        bot.sendMessage(chatId, '❌ Укажи участников после команды. Пример: /draw @Владимир @Нурик');
        return;
    }

    // Загружаем команды
    const teams = loadTeams();
    if (teams.length < mentions.length) {
        bot.sendMessage(chatId, `❌ Недостаточно команд! Нужно: ${mentions.length}, доступно: ${teams.length}. Добавь команды через /add_team`);
        return;
    }

    // Перемешиваем команды и назначаем участникам
    const shuffledTeams = shuffleArray(teams);
    const assignments = mentions.map((username, index) => ({
        username,
        team: shuffledTeams[index % shuffledTeams.length]
    }));

    // Формируем сообщение (используем HTML вместо Markdown)
    let resultMessage = '<b>🎲 Результаты жеребьевки:</b>\n\n';
    assignments.forEach(assignment => {
        resultMessage += `👤 @${assignment.username}\n⚽️ <b>${assignment.team}</b>\n\n`;
    });

    bot.sendMessage(chatId, resultMessage, { parse_mode: 'HTML' });
});

// Команда /list_teams
bot.onText(/\/list_teams/, async (msg) => {
    const chatId = msg.chat.id;
    const teams = loadTeams();

    if (teams.length === 0) {
        bot.sendMessage(chatId, '📋 Список команд пуст. Добавь команды через /add_team');
        return;
    }

    let teamList = '<b>📋 Список команд:</b>\n\n';
    teams.forEach((team, index) => {
        teamList += `${index + 1}. ${team}\n`;
    });

    bot.sendMessage(chatId, teamList, { parse_mode: 'HTML' });
});

// Команда /add_team (только для админов)
bot.onText(/\/add_team (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const teamName = match[1].trim();

    // Проверяем права админа
    if (!await isAdmin(chatId, userId)) {
        bot.sendMessage(chatId, '⛔️ Только администраторы чата могут добавлять команды');
        return;
    }

    if (!teamName) {
        bot.sendMessage(chatId, '❌ Укажи название команды. Пример: /add_team Chelsea');
        return;
    }

    const teams = loadTeams();
    if (teams.includes(teamName)) {
        bot.sendMessage(chatId, `⚠️ Команда "${teamName}" уже существует`);
        return;
    }

    teams.push(teamName);
    saveTeams(teams);
    bot.sendMessage(chatId, `✅ Команда "${teamName}" добавлена!`);
});

// Команда /remove_team (только для админов)
bot.onText(/\/remove_team (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const teamName = match[1].trim();

    // Проверяем права админа
    if (!await isAdmin(chatId, userId)) {
        bot.sendMessage(chatId, '⛔️ Только администраторы чата могут удалять команды');
        return;
    }

    const teams = loadTeams();
    const index = teams.indexOf(teamName);

    if (index === -1) {
        bot.sendMessage(chatId, `❌ Команда "${teamName}" не найдена`);
        return;
    }

    teams.splice(index, 1);
    saveTeams(teams);
    bot.sendMessage(chatId, `✅ Команда "${teamName}" удалена`);
});

// Обработка ошибок
bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

console.log('🤖 Бот запущен!');