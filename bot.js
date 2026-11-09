const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const http = require('http');
require('dotenv').config();

const db = require('./db');
const { createPayment, getPayment } = require('./payment');

// ============ КОНСТАНТЫ ============
const BOT_USERNAME = 'fc26avangard_bot'; // ← Юзернейм бота без @

// ============ HEALTH CHECK + WEBHOOK ============
const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
    } else if (req.url === '/webhook/yookassa' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const event = JSON.parse(body);
                console.log('📨 Webhook ЮKassa:', event.event, event.object?.id);

                if (event.event === 'payment.succeeded') {
                    const payment = event.object;
                    const chatId = parseInt(payment.metadata.chat_id);
                    const paymentId = payment.id;

                    const existing = await db.getPendingPayment(paymentId);
                    if (existing && existing.status === 'succeeded') {
                        console.log(`✅ Платёж ${paymentId} уже обработан`);
                        res.writeHead(200);
                        res.end('OK');
                        return;
                    }

                    console.log(`💰 Успешная оплата: чат ${chatId}, платёж ${paymentId}`);

                    await db.setSubscription(chatId, 'pro', paymentId, 200);
                    await db.updatePaymentStatus(paymentId, 'succeeded');

                    try {
                        await bot.sendMessage(chatId,
                            `🎉 <b>PRO активирован!</b>\n\n` +
                            `Спасибо за поддержку! Теперь доступно:\n` +
                            `✅ До 10 участников в турнире\n` +
                            `✅ Безлимит турниров\n` +
                            `✅ Все будущие функции\n\n` +
                            `Играйте и побеждайте! 🏆`,
                            { parse_mode: 'HTML' }
                        );
                    } catch (e) {
                        console.error('Не удалось отправить сообщение:', e.message);
                    }
                } else if (event.event === 'payment.canceled') {
                    const paymentId = event.object.id;
                    await db.updatePaymentStatus(paymentId, 'canceled');
                    console.log(`❌ Платёж ${paymentId} отменён`);
                }

                res.writeHead(200);
                res.end('OK');
            } catch (error) {
                console.error('❌ Webhook error:', error);
                res.writeHead(500);
                res.end('Error');
            }
        });
    } else {
        res.writeHead(404);
        res.end();
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Health check server running on port ${PORT}`);
});

// ============ КОНФИГ ============
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
    console.error('❌ Укажи TELEGRAM_BOT_TOKEN в файле .env');
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// Хранилище состояний
const userStates = new Map();
const selectedParticipants = new Map();
const tournamentMode = new Map();

let currentTournament = null;
let tournamentMessages = [];

// Дефолтные списки
let DEFAULT_CLUBS = [];
let DEFAULT_NATIONAL_TEAMS = [];

// ============ ЛИМИТЫ ============

const LIMITS = {
    free: { maxParticipants: 4, maxTournaments: 5 },
    pro: { maxParticipants: 10, maxTournaments: Infinity }
};

async function getLimits(chatId) {
    const sub = await db.getSubscription(chatId);
    return LIMITS[sub.tier || 'free'] || LIMITS.free;
}

// ============ ИНИЦИАЛИЗАЦИЯ ============

async function initializeBot() {
    try {
        try {
            const teamsFile = path.join(__dirname, 'teams.json');
            if (fs.existsSync(teamsFile)) {
                DEFAULT_CLUBS = JSON.parse(fs.readFileSync(teamsFile, 'utf8'));
                console.log(`✅ Загружено ${DEFAULT_CLUBS.length} клубов (дефолтные)`);
            }
        } catch (e) {
            console.error('Ошибка загрузки teams.json:', e);
        }

        try {
            const nationalFile = path.join(__dirname, 'national_teams.json');
            if (fs.existsSync(nationalFile)) {
                DEFAULT_NATIONAL_TEAMS = JSON.parse(fs.readFileSync(nationalFile, 'utf8'));
                console.log(`✅ Загружено ${DEFAULT_NATIONAL_TEAMS.length} сборных (дефолтные)`);
            }
        } catch (e) {
            console.error('Ошибка загрузки national_teams.json:', e);
        }

        await db.initDatabase();
        console.log('✅ База данных готова');
        console.log('🤖 Бот запущен!');
    } catch (error) {
        console.error('❌ Ошибка инициализации:', error);
        process.exit(1);
    }
}

// ============ УТИЛИТЫ ============

function shuffleArray(arr) {
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

async function isAdmin(chatId, userId) {
    try {
        const chatMember = await bot.getChatMember(chatId, userId);
        return chatMember.status === 'administrator' || chatMember.status === 'creator';
    } catch (error) {
        return false;
    }
}

function saveMessageId(chatId, messageId) {
    tournamentMessages.push({ chatId, messageId });
}

async function deleteTournamentMessages() {
    for (const msg of tournamentMessages) {
        try { await bot.deleteMessage(msg.chatId, msg.messageId); } catch (e) {}
    }
    tournamentMessages = [];
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function generateParticipantId(name, existingIds = []) {
    let base = name.toLowerCase()
        .replace(/[^a-zа-яё0-9]/gi, '')
        .substring(0, 20);
    if (!base) base = 'user';

    let id = base;
    let counter = 1;
    while (existingIds.includes(id)) {
        id = `${base}${counter}`;
        counter++;
    }
    return id;
}

// ============ ПРИВЕТСТВЕННЫЙ ЭКРАН В ЛИЧКЕ ============

async function sendWelcomeScreen(chatId, user) {
    const firstName = user.first_name || 'друг';

    const welcomeText =
        `👋 <b>Привет, ${escapeHtml(firstName)}!</b>\n\n` +
        `Я — <b>турнирный бот для EA SPORTS FC и FIFA</b>.\n` +
        `Помогаю проводить чемпионаты между друзьями прямо в Telegram.\n\n` +

        `<b>🏆 Что я умею:</b>\n` +
        `🎲 Честная жеребьёвка команд\n` +
        `📅 Автоматическое расписание матчей\n` +
        `⚽ Ввод результатов прямо в чат\n` +
        `📊 Турнирная таблица в реальном времени\n` +
        `⚔️ Личные встречи и статистика\n` +
        `🏅 Достижения и рекорды\n\n` +

        `<b>⚠️ Важно:</b>\n` +
        `Я работаю <b>только в групповых чатах</b> — нужна компания минимум из 2 человек.\n\n` +

        `<b>🚀 Как начать:</b>\n` +
        `1. Добавьте меня в групповой чат с друзьями\n` +
        `2. Сделайте меня <b>администратором</b> чата\n` +
        `3. Напишите <code>/start</code> — и я помогу всё настроить\n\n` +

        `<i>Всё бесплатно до 4 участников и 5 турниров. Дальше — PRO за 200 ₽ навсегда.</i>`;

    const keyboard = {
        inline_keyboard: [
            [
                { 
                    text: '➕ Добавить в групповой чат', 
                    url: `https://t.me/${BOT_USERNAME}?startgroup=true` 
                }
            ],
            [
                { text: '💎 Что такое PRO?', callback_data: 'welcome_premium' },
                { text: '❓ Как это работает?', callback_data: 'welcome_how' }
            ],
            [
                { text: '🌐 Сайт бота', url: 'https://tournamentbot.ru/' }
            ]
        ]
    };

    await bot.sendMessage(chatId, welcomeText, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
        disable_web_page_preview: true
    });
}

// ============ ОНБОРДИНГ ============

async function startOnboarding(chatId, userId) {
    const isAdminUser = await isAdmin(chatId, userId);
    if (!isAdminUser) {
        await bot.sendMessage(chatId, '⛔️ Настроить участников может только администратор чата.\n\nСделай меня админом и напиши /start снова.');
        return;
    }

    await bot.sendMessage(chatId,
        `🎯 <b>Добро пожаловать в Турнирный бот!</b>\n\n` +
        `Похоже, вы впервые используете меня в этом чате.\n` +
        `Давайте настроим участников турнира.\n\n` +
        `<b>Сколько человек будет играть?</b> (2-10)\n\n` +
        `<i>Бесплатная версия: до 4 участников и 5 турниров.</i>\n` +
        `<i>PRO-версия (200₽): до 10 участников и безлимит турниров.</i>`,
        {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '2', callback_data: 'onb_count_2' }, { text: '3', callback_data: 'onb_count_3' }, { text: '4', callback_data: 'onb_count_4' }, { text: '5', callback_data: 'onb_count_5' }],
                    [{ text: '6', callback_data: 'onb_count_6' }, { text: '7', callback_data: 'onb_count_7' }, { text: '8', callback_data: 'onb_count_8' }, { text: '9', callback_data: 'onb_count_9' }, { text: '10', callback_data: 'onb_count_10' }]
                ]
            }
        }
    );
}

async function continueOnboarding(chatId, userId, count) {
    const limits = await getLimits(chatId);
    if (count > limits.maxParticipants) {
        await bot.sendMessage(chatId,
            `⚠️ В бесплатной версии максимум <b>${limits.maxParticipants} участника</b>.\n\n` +
            `Для большего количества нужна PRO-версия (200₽).\n` +
            `Команда: /premium`,
            { parse_mode: 'HTML' }
        );
        return;
    }

    userStates.set(userId, {
        action: 'onboarding',
        step: 'enter_names',
        count: count,
        current: 1,
        participants: []
    });

    await bot.sendMessage(chatId,
        `👤 <b>Участник 1 из ${count}</b>\n\n` +
        `Введи имя (можно с @username для тегов):\n\n` +
        `Пример: <code>Владимир @antsn21</code>\n` +
        `Или просто: <code>Владимир</code>`,
        { parse_mode: 'HTML' }
    );
}

async function handleOnboardingInput(chatId, userId, text) {
    const state = userStates.get(userId);
    if (!state || state.action !== 'onboarding') return false;

    const parts = text.trim().split(/\s+/);
    const name = parts[0];
    const username = parts[1] ? parts[1].replace('@', '') : null;

    if (!name || name.length > 30) {
        await bot.sendMessage(chatId, '❌ Имя должно быть от 1 до 30 символов. Попробуй снова:');
        return true;
    }

    const existingIds = state.participants.map(p => p.id);
    const participantId = generateParticipantId(name, existingIds);

    state.participants.push({ id: participantId, name, username });
    state.current++;

    if (state.current > state.count) {
        for (const p of state.participants) {
            await db.addParticipant(chatId, p.id, p.name, p.username);
        }

        await db.setClubs(chatId, DEFAULT_CLUBS);
        await db.setNationalTeams(chatId, DEFAULT_NATIONAL_TEAMS);

        try {
            await db.setSubscription(chatId, 'free');
        } catch (e) {}

        userStates.delete(userId);

        let list = '✅ <b>Настройка завершена!</b>\n\n<b>Участники:</b>\n';
        state.participants.forEach((p, i) => {
            list += `${i + 1}. ${p.name}${p.username ? ` (@${p.username})` : ''}\n`;
        });

        const limits = await getLimits(chatId);
        list += `\n📋 Загружено <b>${DEFAULT_CLUBS.length}</b> клубов и <b>${DEFAULT_NATIONAL_TEAMS.length}</b> сборных.\n\n`;
        list += `💎 Ваш тариф: <b>${limits.maxTournaments === Infinity ? 'PRO' : 'FREE'}</b>\n`;
        list += `• Максимум участников: ${limits.maxParticipants}\n`;
        list += `• Максимум турниров: ${limits.maxTournaments === Infinity ? '∞' : limits.maxTournaments}\n\n`;
        list += `Начинайте! Нажмите "🏆 Новый турнир"`;

        const isAdminUser = await isAdmin(chatId, userId);
        await bot.sendMessage(chatId, list, {
            parse_mode: 'HTML',
            ...getMainKeyboard(isAdminUser, false)
        });

        return true;
    }

    await bot.sendMessage(chatId,
        `👤 <b>Участник ${state.current} из ${state.count}</b>\n\n` +
        `Введи имя (можно с @username):`,
        { parse_mode: 'HTML' }
    );

    return true;
}

// ============ ГЕНЕРАЦИЯ РАСПИСАНИЯ ============

function generateSchedule(participants) {
    const matches = [];
    let id = 1;
    for (let i = 0; i < participants.length; i++) {
        for (let j = i + 1; j < participants.length; j++) {
            matches.push({
                id: id++,
                player1: participants[i].name,
                player2: participants[j].name,
                score1: null,
                score2: null,
                penalties: null,
                completed: false
            });
        }
    }
    return matches;
}

// ============ СТАТИСТИКА ТУРНИРА ============

function calculateStats(participants, matches) {
    const stats = {};
    participants.forEach(p => {
        stats[p.name] = {
            name: p.name, team: p.team, goalsFor: 0, goalsAgainst: 0,
            wins: 0, penaltyWins: 0, penaltyLosses: 0, draws: 0, losses: 0,
            points: 0, matchesPlayed: 0
        };
    });

    matches.forEach(match => {
        if (!match.completed) return;
        const p1 = stats[match.player1];
        const p2 = stats[match.player2];
        p1.matchesPlayed++;
        p2.matchesPlayed++;
        p1.goalsFor += match.score1;
        p1.goalsAgainst += match.score2;
        p2.goalsFor += match.score2;
        p2.goalsAgainst += match.score1;

        if (match.penalties) {
            if (match.penalties === match.player1) {
                p1.penaltyWins++; p2.penaltyLosses++;
                p1.points += 2; p2.points += 1;
            } else {
                p1.penaltyLosses++; p2.penaltyWins++;
                p1.points += 1; p2.points += 2;
            }
        } else if (match.score1 > match.score2) {
            p1.wins++; p2.losses++; p1.points += 2;
        } else if (match.score2 > match.score1) {
            p2.wins++; p1.losses++; p2.points += 2;
        } else {
            p1.draws++; p2.draws++; p1.points += 1; p2.points += 1;
        }
    });

    return Object.values(stats);
}

// ============ ГЛОБАЛЬНАЯ СТАТИСТИКА ============

async function calculateGlobalStats(chatId) {
    const records = await db.getAllMatches(chatId);
    const tournaments = await db.getAllTournaments(chatId);
    const participants = await db.getParticipants(chatId);
    const playerStats = {};

    participants.forEach(p => {
        playerStats[p.name] = {
            name: p.name, matchesPlayed: 0, wins: 0, losses: 0, draws: 0,
            penaltyWins: 0, penaltyLosses: 0, points: 0, goalsFor: 0, goalsAgainst: 0,
            tournamentsPlayed: 0, tournamentsWon: 0
        };
    });

    records.forEach(record => {
        if (!playerStats[record.player1]) {
            playerStats[record.player1] = {
                name: record.player1, matchesPlayed: 0, wins: 0, losses: 0, draws: 0,
                penaltyWins: 0, penaltyLosses: 0, points: 0, goalsFor: 0, goalsAgainst: 0,
                tournamentsPlayed: 0, tournamentsWon: 0
            };
        }
        if (!playerStats[record.player2]) {
            playerStats[record.player2] = {
                name: record.player2, matchesPlayed: 0, wins: 0, losses: 0, draws: 0,
                penaltyWins: 0, penaltyLosses: 0, points: 0, goalsFor: 0, goalsAgainst: 0,
                tournamentsPlayed: 0, tournamentsWon: 0
            };
        }

        const p1 = playerStats[record.player1];
        const p2 = playerStats[record.player2];

        p1.matchesPlayed++; p2.matchesPlayed++;
        p1.goalsFor += record.score1; p1.goalsAgainst += record.score2;
        p2.goalsFor += record.score2; p2.goalsAgainst += record.score1;

        if (record.penalties) {
            if (record.penalties === record.player1) {
                p1.penaltyWins++; p2.penaltyLosses++;
                p1.points += 2; p2.points += 1;
            } else {
                p1.penaltyLosses++; p2.penaltyWins++;
                p1.points += 1; p2.points += 2;
            }
        } else if (record.score1 > record.score2) {
            p1.wins++; p2.losses++; p1.points += 2;
        } else if (record.score2 > record.score1) {
            p2.wins++; p1.losses++; p2.points += 2;
        } else {
            p1.draws++; p2.draws++; p1.points += 1; p2.points += 1;
        }
    });

    tournaments.forEach(tournament => {
        if (Array.isArray(tournament.participants)) {
            tournament.participants.forEach(p => {
                if (playerStats[p.name]) {
                    playerStats[p.name].tournamentsPlayed++;
                }
            });
        }
        if (playerStats[tournament.winner]) {
            playerStats[tournament.winner].tournamentsWon++;
        }
    });

    return Object.values(playerStats);
}

// ============ АЧИВКИ ============

async function calculateAchievements(chatId, playerName) {
    const records = await db.getAllMatches(chatId);
    const achievements = [];

    const sortedMatches = [...records].sort((a, b) => new Date(a.date) - new Date(b.date));

    let matchesPlayed = 0;
    let currentStreak = 0;
    let maxStreak = 0;
    let penaltyWins = 0;
    let penaltyLosses = 0;

    sortedMatches.forEach(m => {
        const isPlayer1 = m.player1 === playerName;
        const isPlayer2 = m.player2 === playerName;
        if (!isPlayer1 && !isPlayer2) return;

        matchesPlayed++;

        let isWin = false;

        if (m.penalties) {
            if (m.penalties === playerName) {
                isWin = true;
                penaltyWins++;
            } else {
                penaltyLosses++;
            }
        } else if (isPlayer1) {
            if (m.score1 > m.score2) isWin = true;
        } else if (isPlayer2) {
            if (m.score2 > m.score1) isWin = true;
        }

        if (isWin) {
            currentStreak++;
            if (currentStreak > maxStreak) maxStreak = currentStreak;
        } else {
            currentStreak = 0;
        }
    });

    if (maxStreak >= 5) achievements.push({ emoji: '🔥', name: 'Серия', description: '5 побед подряд', progress: `${maxStreak} побед` });
    if (matchesPlayed >= 50) achievements.push({ emoji: '💯', name: 'Ветеран', description: '50 матчей', progress: `${matchesPlayed} матчей` });
    if (penaltyWins >= 5 && penaltyLosses === 0) achievements.push({ emoji: '🎯', name: 'Идеальный пенальтист', description: '5+ побед без поражений', progress: `${penaltyWins} побед` });

    return { achievements, currentStreak, maxStreak, matchesPlayed, penaltyWins, penaltyLosses };
}

async function formatPlayerProfile(chatId, playerName) {
    const allStats = await calculateGlobalStats(chatId);
    const playerStats = allStats.find(s => s.name === playerName);

    if (!playerStats) {
        return `👤 <b>${playerName}</b>\n\n❌ Игрок не найден!`;
    }

    const achievementsData = await calculateAchievements(chatId, playerName);

    const sorted = [...allStats].sort((a, b) => {
        if (a.points !== b.points) return b.points - a.points;
        if (a.wins !== b.wins) return b.wins - a.wins;
        return (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst);
    });
    const rank = sorted.findIndex(s => s.name === playerName) + 1;

    let profile = `👤 <b>ПРОФИЛЬ ИГРОКА</b>\n\n`;
    profile += `<b>${playerName}</b>\n\n`;
    profile += `📈 <b>Место в рейтинге:</b> #${rank} из ${allStats.length}\n`;
    profile += `💎 <b>Очков:</b> ${playerStats.points}\n\n`;
    profile += `<b>📊 СТАТИСТИКА:</b>\n`;
    profile += `🎮 Матчей: ${playerStats.matchesPlayed}\n`;
    if (playerStats.matchesPlayed > 0) {
        const winRate = ((playerStats.wins / playerStats.matchesPlayed) * 100).toFixed(0);
        profile += `✅ Побед: ${playerStats.wins} (${winRate}%)\n`;
    } else {
        profile += `✅ Побед: 0\n`;
    }
    profile += `❌ Поражений: ${playerStats.losses}\n`;
    profile += `🤝 Ничьих: ${playerStats.draws}\n`;
    profile += `🥅 Пенальти: ${playerStats.penaltyWins} / ${playerStats.penaltyLosses}\n\n`;

    const diff = playerStats.goalsFor - playerStats.goalsAgainst;
    profile += `<b>⚽️ ГОЛЫ:</b>\n`;
    profile += `Забито: ${playerStats.goalsFor}\n`;
    profile += `Пропущено: ${playerStats.goalsAgainst}\n`;
    profile += `Разница: ${diff >= 0 ? '+' : ''}${diff}\n\n`;

    if (achievementsData.currentStreak >= 3) profile += `🔥 <b>Текущая серия:</b> ${achievementsData.currentStreak} побед\n`;
    if (achievementsData.maxStreak >= 3) profile += `📈 <b>Лучшая серия:</b> ${achievementsData.maxStreak} побед\n`;
    if (achievementsData.currentStreak >= 3 || achievementsData.maxStreak >= 3) profile += `\n`;

    profile += `<b>🏆 ТУРНИРЫ:</b>\n`;
    profile += `Побед: ${playerStats.tournamentsWon} из ${playerStats.tournamentsPlayed}\n\n`;

    profile += `<b>🏅 ДОСТИЖЕНИЯ:</b>\n`;
    if (achievementsData.achievements.length === 0) {
        profile += `<i>Пока нет. Играй больше!</i>\n\n`;
        profile += `<i>Доступные ачивки:</i>\n`;
        profile += `🔥 Серия — 5 побед подряд\n`;
        profile += `💯 Ветеран — 50 матчей\n`;
        profile += `🎯 Идеальный пенальтист — 5+ побед по пенальти без поражений\n`;
    } else {
        achievementsData.achievements.forEach(a => {
            profile += `${a.emoji} <b>${a.name}</b> — ${a.description}\n`;
            profile += `   <i>${a.progress}</i>\n`;
        });
    }

    return profile;
}

function createProfileSelectionKeyboard(participants) {
    const inlineKeyboard = [];
    let row = [];
    for (const participant of participants) {
        row.push({ text: participant.name, callback_data: `profile_${participant.name}` });
        if (row.length === 2) { inlineKeyboard.push(row); row = []; }
    }
    if (row.length > 0) inlineKeyboard.push(row);
    inlineKeyboard.push([{ text: '❌ Отмена', callback_data: 'profile_cancel' }]);
    return { reply_markup: { inline_keyboard: inlineKeyboard } };
}

// ============ СТАТИСТИКА КОМАНД ============

async function getTeamStats(chatId) {
    const records = await db.getAllMatches(chatId);
    const teamStats = {};

    records.forEach(record => {
        if (record.team1) {
            if (!teamStats[record.team1]) {
                teamStats[record.team1] = { name: record.team1, matches: 0, wins: 0, losses: 0, draws: 0, goalsFor: 0, goalsAgainst: 0 };
            }
            teamStats[record.team1].matches++;
            teamStats[record.team1].goalsFor += record.score1;
            teamStats[record.team1].goalsAgainst += record.score2;
            if (record.penalties) {
                if (record.penalties === record.player1) teamStats[record.team1].wins++;
                else teamStats[record.team1].losses++;
            } else if (record.score1 > record.score2) teamStats[record.team1].wins++;
            else if (record.score2 > record.score1) teamStats[record.team1].losses++;
            else teamStats[record.team1].draws++;
        }

        if (record.team2) {
            if (!teamStats[record.team2]) {
                teamStats[record.team2] = { name: record.team2, matches: 0, wins: 0, losses: 0, draws: 0, goalsFor: 0, goalsAgainst: 0 };
            }
            teamStats[record.team2].matches++;
            teamStats[record.team2].goalsFor += record.score2;
            teamStats[record.team2].goalsAgainst += record.score1;
            if (record.penalties) {
                if (record.penalties === record.player2) teamStats[record.team2].wins++;
                else teamStats[record.team2].losses++;
            } else if (record.score2 > record.score1) teamStats[record.team2].wins++;
            else if (record.score1 > record.score2) teamStats[record.team2].losses++;
            else teamStats[record.team2].draws++;
        }
    });

    return Object.values(teamStats);
}

async function formatTeamStats(chatId) {
    const stats = await getTeamStats(chatId);
    if (stats.length === 0) return '🏟️ <b>СТАТИСТИКА КОМАНД</b>\n\n❌ Пока нет сыгранных матчей!';

    const nationalTeamsList = await db.getNationalTeams(chatId);
    const clubs = stats.filter(s => !nationalTeamsList.includes(s.name));
    const nationalTeams = stats.filter(s => nationalTeamsList.includes(s.name));

    const sortTeams = (arr) => [...arr].sort((a, b) => {
        const wrA = a.matches > 0 ? a.wins / a.matches : 0;
        const wrB = b.matches > 0 ? b.wins / b.matches : 0;
        if (wrA !== wrB) return wrB - wrA;
        return b.matches - a.matches;
    });

    const sortedClubs = sortTeams(clubs);
    const sortedNational = sortTeams(nationalTeams);

    let message = '🏟️ <b>СТАТИСТИКА КОМАНД</b>\n\n';
    message += `⚽ <b>КЛУБЫ</b> (${clubs.length} команд)\n\n`;
    if (sortedClubs.length === 0) {
        message += '<i>Пока нет сыгранных матчей с клубами</i>\n\n';
    } else {
        sortedClubs.slice(0, 10).forEach((s, idx) => {
            const winRate = s.matches > 0 ? ((s.wins / s.matches) * 100).toFixed(0) : 0;
            const medal = idx === 0 ? '🥇 ' : idx === 1 ? '🥈 ' : idx === 2 ? '🥉 ' : `${idx + 1}. `;
            message += `${medal}<b>${s.name}</b>\n`;
            message += `   🎮 ${s.matches} матчей · ✅ ${s.wins} (${winRate}%) · ❌ ${s.losses} · 🤝 ${s.draws}\n`;
            message += `   ⚽️ Голы: ${s.goalsFor}:${s.goalsAgainst}\n\n`;
        });
    }

    message += `━━━━━━━━━━━━━━━━━\n\n`;
    message += `🌍 <b>СБОРНЫЕ</b> (${nationalTeams.length} команд)\n\n`;
    if (sortedNational.length === 0) {
        message += '<i>Пока нет сыгранных матчей со сборными</i>\n\n';
    } else {
        sortedNational.slice(0, 10).forEach((s, idx) => {
            const winRate = s.matches > 0 ? ((s.wins / s.matches) * 100).toFixed(0) : 0;
            const medal = idx === 0 ? '🥇 ' : idx === 1 ? '🥈 ' : idx === 2 ? '🥉 ' : `${idx + 1}. `;
            message += `${medal}<b>${s.name}</b>\n`;
            message += `   🎮 ${s.matches} матчей · ✅ ${s.wins} (${winRate}%) · ❌ ${s.losses} · 🤝 ${s.draws}\n`;
            message += `   ⚽️ Голы: ${s.goalsFor}:${s.goalsAgainst}\n\n`;
        });
    }

    return message;
}

// ============ ЛИЧНЫЕ ВСТРЕЧИ ============

async function getHeadToHeadStats(chatId, player1Name, player2Name) {
    const records = await db.getAllMatches(chatId);
    const matches = records.filter(r =>
        (r.player1 === player1Name && r.player2 === player2Name) ||
        (r.player1 === player2Name && r.player2 === player1Name)
    );

    if (matches.length === 0) return null;

    let p1Wins = 0, p2Wins = 0, draws = 0;
    let p1PenaltyWins = 0, p2PenaltyWins = 0;
    let p1Goals = 0, p2Goals = 0;
    const recentMatches = [];

    matches.forEach(m => {
        let scoreForP1, scoreForP2;
        if (m.player1 === player1Name) {
            scoreForP1 = m.score1; scoreForP2 = m.score2;
        } else {
            scoreForP1 = m.score2; scoreForP2 = m.score1;
        }
        p1Goals += scoreForP1; p2Goals += scoreForP2;

        if (m.penalties) {
            if (m.penalties === player1Name) { p1Wins++; p1PenaltyWins++; }
            else { p2Wins++; p2PenaltyWins++; }
        } else if (scoreForP1 > scoreForP2) p1Wins++;
        else if (scoreForP2 > scoreForP1) p2Wins++;
        else draws++;

        recentMatches.push({
            date: m.date, player1: m.player1, player2: m.player2,
            score1: m.score1, score2: m.score2, penalties: m.penalties
        });
    });

    recentMatches.sort((a, b) => new Date(b.date) - new Date(a.date));

    return {
        totalMatches: matches.length, p1Wins, p2Wins, draws,
        p1PenaltyWins, p2PenaltyWins, p1Goals, p2Goals,
        recentMatches: recentMatches.slice(0, 5)
    };
}

function formatHeadToHead(player1Name, player2Name, stats) {
    if (!stats) {
        return `⚔️ <b>${player1Name} vs ${player2Name}</b>\n\n❌ Эти игроки еще не встречались!`;
    }

    const totalGoals = stats.p1Goals + stats.p2Goals;

    let message = `⚔️ <b>ЛИЧНЫЕ ВСТРЕЧИ</b>\n\n`;
    message += `<b>${player1Name}</b> vs <b>${player2Name}</b>\n\n`;
    message += `<b>📊 ВСЕГО МАТЧЕЙ:</b> ${stats.totalMatches}\n`;
    message += `✅ ${player1Name} побед: ${stats.p1Wins}\n`;
    message += `✅ ${player2Name} побед: ${stats.p2Wins}\n`;
    message += `🤝 Ничьих: ${stats.draws}\n\n`;

    if (stats.p1PenaltyWins > 0 || stats.p2PenaltyWins > 0) {
        message += `<b>🥅 ПОБЕДЫ ПО ПЕНАЛЬТИ:</b>\n`;
        message += `• ${player1Name}: ${stats.p1PenaltyWins}\n`;
        message += `• ${player2Name}: ${stats.p2PenaltyWins}\n\n`;
    }

    message += `<b>⚽️ ГОЛЫ:</b>\n`;
    message += `${player1Name}: ${stats.p1Goals}\n`;
    message += `${player2Name}: ${stats.p2Goals}\n`;
    message += `Всего: ${totalGoals} (в среднем ${(totalGoals / stats.totalMatches).toFixed(1)} за матч)\n\n`;

    message += `<b>📜 ПОСЛЕДНИЕ МАТЧИ:</b>\n\n`;
    stats.recentMatches.forEach((m, idx) => {
        const date = new Date(m.date).toLocaleDateString('ru-RU');
        let resultEmoji = '🤝';
        if (m.penalties) {
            resultEmoji = m.penalties === player1Name ? '✅' : '❌';
        } else {
            let s1, s2;
            if (m.player1 === player1Name) { s1 = m.score1; s2 = m.score2; }
            else { s1 = m.score2; s2 = m.score1; }
            if (s1 > s2) resultEmoji = '✅';
            else if (s2 > s1) resultEmoji = '❌';
        }
        let matchLine = `${resultEmoji} ${date}: ${m.player1} ${m.score1}:${m.score2} ${m.player2}`;
        if (m.penalties) matchLine += ` (пен. ${m.penalties})`;
        message += `${idx + 1}. ${matchLine}\n`;
    });

    return message;
}

// ============ ТАБЛИЦЫ ============

function getStandingsTable(stats) {
    const sorted = [...stats].sort((a, b) => {
        if (a.points !== b.points) return b.points - a.points;
        const diffA = a.goalsFor - a.goalsAgainst;
        const diffB = b.goalsFor - b.goalsAgainst;
        if (diffA !== diffB) return diffB - diffA;
        return b.goalsFor - a.goalsFor;
    });

    let table = '<b>📊 ТУРНИРНАЯ ТАБЛИЦА</b>\n\n';
    sorted.forEach((s, idx) => {
        const medal = idx === 0 ? '🥇 ' : idx === 1 ? '🥈 ' : idx === 2 ? '🥉 ' : '   ';
        const diff = s.goalsFor - s.goalsAgainst;
        const diffText = diff >= 0 ? `+${diff}` : `${diff}`;
        table += `${medal}${s.name} (${s.team})\n`;
        table += `   ${s.matchesPlayed} игр · ${s.points} очков · голы ${s.goalsFor}:${s.goalsAgainst} (${diffText})\n\n`;
    });
    return table;
}

async function getGlobalRatingTable(chatId) {
    const stats = await calculateGlobalStats(chatId);
    const sorted = [...stats].sort((a, b) => {
        if (a.points !== b.points) return b.points - a.points;
        if (a.wins !== b.wins) return b.wins - a.wins;
        return (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst);
    });

    let table = '<b>📈 ОБЩИЙ РЕЙТИНГ ИГРОКОВ</b>\n\n';
    sorted.forEach((s, idx) => {
        const medal = idx === 0 ? '🥇 ' : idx === 1 ? '🥈 ' : idx === 2 ? '🥉 ' : `${idx + 1}. `;
        table += `${medal}<b>${s.name}</b> — ${s.points} очков\n`;
        table += `   🎮 Матчей: ${s.matchesPlayed}\n`;
        table += `   ✅ Побед: ${s.wins} | ❌ Поражений: ${s.losses} | 🤝 Ничьих: ${s.draws}\n`;
        table += `   🥅 Пенальти: ${s.penaltyWins} / ${s.penaltyLosses}\n`;
        table += `   ⚽️ Голы: ${s.goalsFor}:${s.goalsAgainst} (${s.goalsFor - s.goalsAgainst >= 0 ? '+' : ''}${s.goalsFor - s.goalsAgainst})\n`;
        table += `   🏆 Турниров: ${s.tournamentsWon} побед из ${s.tournamentsPlayed}\n\n`;
    });
    return table;
}

function getLiveStatus(matches) {
    const completed = matches.filter(m => m.completed).length;
    const total = matches.length;
    const remaining = matches.filter(m => !m.completed);

    let status = `<b>🏟 LIVE СТАТУС</b>\n\n📊 Сыграно: ${completed} из ${total}\n`;
    if (remaining.length > 0) {
        status += `\n<b>📅 Осталось (${remaining.length}):</b>\n`;
        remaining.forEach(m => { status += `• ${m.player1} vs ${m.player2}\n`; });
    } else {
        status += `\n✅ Все матчи сыграны! Нажми "🏆 Завершить".\n`;
    }
    return status;
}

// ============ КЛАВИАТУРЫ ============

function getMainKeyboard(isAdminUser = false, isTournamentActive = false) {
    if (isTournamentActive) {
        const keyboard = [
            [{ text: '✏️ Записать результат' }, { text: '📊 Таблица' }],
            [{ text: '✏️ Редактировать' }, { text: '🏆 Завершить' }],
            [{ text: '⚠️ Прервать турнир' }, { text: '❓ Помощь' }]
        ];
        return { reply_markup: { keyboard, resize_keyboard: true, persistent: true } };
    }

    const keyboard = [
        [{ text: '🏆 Новый турнир' }, { text: '📋 Список команд' }],
        [{ text: '📈 Общий рейтинг' }, { text: '⚔️ Личные встречи' }],
        [{ text: '👤 Профиль' }, { text: '🏟️ Статистика команд' }],
        [{ text: '💎 PRO' }, { text: '❓ Помощь' }]
    ];

    if (isAdminUser) {
        keyboard.push([{ text: '➕ Добавить клуб' }, { text: '➕ Добавить сборную' }]);
        keyboard.push([{ text: '❌ Удалить клуб' }, { text: '❌ Удалить сборную' }]);
        keyboard.push([{ text: '⚙️ Настройки' }]);
    }

    return { reply_markup: { keyboard, resize_keyboard: true, persistent: true } };
}

function createTournamentSelectionKeyboard(participants, selectedIds = [], worldCupMode = false) {
    const inlineKeyboard = [];
    let row = [];
    for (const participant of participants) {
        const isSelected = selectedIds.includes(participant.id);
        const buttonText = isSelected ? `✅ ${participant.name}` : `⬜️ ${participant.name}`;
        row.push({ text: buttonText, callback_data: `tournament_toggle_${participant.id}` });
        if (row.length === 2) { inlineKeyboard.push(row); row = []; }
    }
    if (row.length > 0) inlineKeyboard.push(row);

    const worldCupButton = worldCupMode ? '✅ ЧЕМПИОНАТ МИРА (сборные)' : '⬜️ ЧЕМПИОНАТ МИРА (сборные)';
    inlineKeyboard.push([{ text: worldCupButton, callback_data: 'toggle_world_cup' }]);
    inlineKeyboard.push([{ text: '🎲 Начать турнир', callback_data: 'tournament_start' }]);
    inlineKeyboard.push([{ text: '❌ Отмена', callback_data: 'tournament_cancel' }]);

    return { reply_markup: { inline_keyboard: inlineKeyboard } };
}

function createMatchSelectionKeyboard(matches) {
    const inlineKeyboard = [];
    matches.filter(m => !m.completed).forEach(match => {
        inlineKeyboard.push([{ text: `${match.player1} vs ${match.player2}`, callback_data: `record_match_${match.id}` }]);
    });
    inlineKeyboard.push([{ text: '❌ Отмена', callback_data: 'cancel_record' }]);
    return { reply_markup: { inline_keyboard: inlineKeyboard } };
}

function createEditMatchSelectionKeyboard(matches) {
    const inlineKeyboard = [];
    const completed = matches.filter(m => m.completed);
    if (completed.length === 0) return null;
    completed.forEach(match => {
        inlineKeyboard.push([{ text: `${match.player1} ${match.score1}:${match.score2} ${match.player2}`, callback_data: `edit_match_${match.id}` }]);
    });
    inlineKeyboard.push([{ text: '❌ Отмена', callback_data: 'cancel_edit' }]);
    return { reply_markup: { inline_keyboard: inlineKeyboard } };
}

function createH2HFirstPlayerKeyboard(participants) {
    const inlineKeyboard = [];
    let row = [];
    for (const participant of participants) {
        row.push({ text: participant.name, callback_data: `h2h_first_${participant.name}` });
        if (row.length === 2) { inlineKeyboard.push(row); row = []; }
    }
    if (row.length > 0) inlineKeyboard.push(row);
    inlineKeyboard.push([{ text: '❌ Отмена', callback_data: 'h2h_cancel' }]);
    return { reply_markup: { inline_keyboard: inlineKeyboard } };
}

function createH2HSecondPlayerKeyboard(participants, firstPlayerName) {
    const inlineKeyboard = [];
    let row = [];
    for (const participant of participants) {
        if (participant.name === firstPlayerName) continue;
        row.push({ text: participant.name, callback_data: `h2h_second_${firstPlayerName}__${participant.name}` });
        if (row.length === 2) { inlineKeyboard.push(row); row = []; }
    }
    if (row.length > 0) inlineKeyboard.push(row);
    inlineKeyboard.push([{ text: '❌ Отмена', callback_data: 'h2h_cancel' }]);
    return { reply_markup: { inline_keyboard: inlineKeyboard } };
}

// ============ PREMIUM UI ============

async function showPremiumMessage(chatId, messageId = null) {
    const sub = await db.getSubscription(chatId);
    const limits = await getLimits(chatId);
    const tourCount = await db.getTournamentCount(chatId);
    const isPro = sub.tier === 'pro';

    let text, keyboard;

    if (isPro) {
        text = `💎 <b>PRO-версия активна</b>\n\n` +
            `✅ Безлимит турниров\n` +
            `✅ До 10 участников\n` +
            `✅ Все будущие фичи\n\n` +
            `📊 <b>Ваша статистика:</b>\n` +
            `• Турниров создано: ${tourCount}\n` +
            `• Максимум участников: ${limits.maxParticipants}\n\n` +
            `Спасибо за поддержку! 🙏`;
        keyboard = {
            inline_keyboard: [
                [{ text: '📊 Общий рейтинг', callback_data: 'premium_show_rating' }]
            ]
        };
    } else {
        const remaining = Math.max(0, limits.maxTournaments - tourCount);
        text = `💎 <b>PRO-версия</b> (200₽, навсегда)\n\n` +
            `<b>Что даёт:</b>\n` +
            `✅ До <b>10 участников</b> (сейчас: ${limits.maxParticipants})\n` +
            `✅ <b>Безлимит турниров</b> (сейчас: ${remaining} из ${limits.maxTournaments})\n` +
            `✅ Все будущие фичи\n\n` +
            `<b>📊 Ваша статистика:</b>\n` +
            `• Турниров создано: ${tourCount} из ${limits.maxTournaments}\n` +
            `• Максимум участников: ${limits.maxParticipants}\n\n` +
            `<i>Оплата разовая — платите 200₽ и пользуетесь навсегда.</i>`;
        keyboard = {
            inline_keyboard: [
                [{ text: '💳 Купить PRO за 200₽', callback_data: 'premium_buy' }],
                [{ text: '🔄 Проверить оплату', callback_data: 'premium_check' }],
                [{ text: '❓ Что входит в PRO?', callback_data: 'premium_info' }]
            ]
        };
    }

    if (messageId) {
        await bot.editMessageText(text, {
            chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: keyboard
        });
    } else {
        await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
}


// Ручная проверка платежа (если webhook не пришёл)
async function checkPendingPayments(chatId) {
    // Получаем все pending платежи для этого чата
    const payments = await db.getPendingPaymentsByChat(chatId);

    for (const payment of payments) {
        if (payment.status !== 'pending') continue;

        try {
            const paymentInfo = await getPayment(payment.payment_id);

            if (paymentInfo.status === 'succeeded') {
                // Активируем PRO
                await db.setSubscription(chatId, 'pro', payment.payment_id, 200);
                await db.updatePaymentStatus(payment.payment_id, 'succeeded');

                await bot.sendMessage(chatId,
                    `🎉 <b>PRO активирован!</b>\n\n` +
                    `Оплата подтверждена. Теперь доступно:\n` +
                    `✅ До 10 участников\n` +
                    `✅ Безлимит турниров\n` +
                    `✅ Все будущие функции\n\n` +
                    `Играйте и побеждайте! 🏆`,
                    { parse_mode: 'HTML' }
                );

                return true;
            } else if (paymentInfo.status === 'canceled') {
                await db.updatePaymentStatus(payment.payment_id, 'canceled');
            }
        } catch (error) {
            console.error(`Ошибка проверки платежа ${payment.payment_id}:`, error.message);
        }
    }

    return false;
}

// ============ КОМАНДЫ ============

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const isPrivate = chatId > 0;

    try {
        if (isPrivate) {
            await sendWelcomeScreen(chatId, msg.from);
            return;
        }

        const hasParts = await db.hasParticipants(chatId);
        if (!hasParts) {
            await startOnboarding(chatId, userId);
            return;
        }

        const isAdminUser = await isAdmin(chatId, userId);
        bot.sendMessage(chatId,
            '🎯 <b>Турнирный бот</b>\n\nИспользуй кнопки ниже.',
            { parse_mode: 'HTML', ...getMainKeyboard(isAdminUser, !!currentTournament) }
        );
    } catch (error) {
        console.error('Start error:', error);
    }
});

bot.onText(/\/chatid/, (msg) => {
    bot.sendMessage(msg.chat.id, `Chat ID: \`${msg.chat.id}\``, { parse_mode: 'Markdown' });
});

bot.onText(/\/setup/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (chatId > 0) {
        bot.sendMessage(chatId, '⚠️ Эта команда работает только в групповых чатах.');
        return;
    }

    const isAdminUser = await isAdmin(chatId, userId);
    if (!isAdminUser) {
        bot.sendMessage(chatId, '⛔️ Только администратор чата может это сделать.');
        return;
    }

    await db.clearParticipants(chatId);
    await startOnboarding(chatId, userId);
});

bot.onText(/\/reset/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (chatId > 0) {
        bot.sendMessage(chatId, '⚠️ Эта команда работает только в групповых чатах.');
        return;
    }

    const isAdminUser = await isAdmin(chatId, userId);
    if (!isAdminUser) {
        bot.sendMessage(chatId, '⛔️ Только администратор чата может это сделать.');
        return;
    }

    bot.sendMessage(chatId,
        `⚠️ <b>ВНИМАНИЕ!</b>\n\n` +
        `Это удалит ВСЕ данные чата:\n` +
        `• Участников\n` +
        `• Матчи\n` +
        `• Турниры\n` +
        `• Кастомные команды\n\n` +
        `Действие необратимо!`,
        {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🗑 Да, удалить всё', callback_data: 'reset_confirm' }],
                    [{ text: '❌ Отмена', callback_data: 'reset_cancel' }]
                ]
            }
        }
    );
});

bot.onText(/\/premium/, async (msg) => {
    const chatId = msg.chat.id;

    if (chatId > 0) {
        await bot.sendMessage(chatId,
            `💎 <b>PRO-версия</b>\n\n` +
            `PRO доступен <b>только в групповых чатах</b>.\n\n` +
            `Добавьте меня в чат с друзьями — там сможете купить PRO.\n\n` +
            `<b>Что даёт PRO:</b>\n` +
            `• До 10 участников в турнире\n` +
            `• Безлимит турниров\n` +
            `• Все будущие функции\n\n` +
            `<i>200 ₽ — один раз навсегда.</i>`,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '➕ Добавить в чат', url: `https://t.me/${BOT_USERNAME}?startgroup=true` }]
                    ]
                }
            }
        );
        return;
    }

    try {
        await showPremiumMessage(chatId);
    } catch (error) {
        console.error('Premium error:', error);
        bot.sendMessage(chatId, '❌ Ошибка, попробуй позже');
    }
});

// ============ CALLBACK QUERIES ============

bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;
    const messageId = callbackQuery.message.message_id;

    try {
        // ============ ПРИВЕТСТВЕННЫЕ КНОПКИ ============
        if (data === 'welcome_premium') {
            await bot.editMessageText(
                `💎 <b>PRO-версия</b>\n\n` +
                `<b>Бесплатно:</b>\n` +
                `• До 4 участников в турнире\n` +
                `• До 5 турниров (за всё время)\n` +
                `• Вся статистика и достижения\n\n` +
                `<b>PRO (200 ₽, навсегда):</b>\n` +
                `• До 10 участников\n` +
                `• Безлимит турниров\n` +
                `• Все будущие функции\n` +
                `• Приоритетная поддержка\n\n` +
                `<i>Оплата разовая — не подписка. PRO привязан к чату, в котором оплатили.</i>`,
                {
                    chat_id: chatId, message_id: messageId, parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '➕ Добавить бота в чат', url: `https://t.me/${BOT_USERNAME}?startgroup=true` }],
                            [{ text: '◀️ Назад', callback_data: 'welcome_back' }]
                        ]
                    }
                }
            );
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        if (data === 'welcome_how') {
            await bot.editMessageText(
                `❓ <b>Как это работает</b>\n\n` +
                `<b>1. Добавьте бота в чат</b>\n` +
                `Создайте групповой чат с друзьями → добавьте @${BOT_USERNAME} → сделайте его администратором.\n\n` +
                `<b>2. Настройте участников</b>\n` +
                `Напишите <code>/start</code>. Бот спросит количество игроков и их имена.\n\n` +
                `<b>3. Создайте турнир</b>\n` +
                `Нажмите «🏆 Новый турнир» → выберите участников → бот распределит команды.\n\n` +
                `<b>4. Играйте</b>\n` +
                `После каждого матча пишите счёт в чат: <code>2:1</code> — таблица обновится автоматически.\n\n` +
                `<b>5. Завершите</b>\n` +
                `Нажмите «🏆 Завершить» — бот подведёт итоги.`,
                {
                    chat_id: chatId, message_id: messageId, parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '➕ Добавить бота в чат', url: `https://t.me/${BOT_USERNAME}?startgroup=true` }],
                            [{ text: '◀️ Назад', callback_data: 'welcome_back' }]
                        ]
                    }
                }
            );
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        if (data === 'welcome_back') {
            await bot.deleteMessage(chatId, messageId).catch(() => {});
            await sendWelcomeScreen(chatId, callbackQuery.from);
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        // ============ ОНБОРДИНГ ============
        if (data.startsWith('onb_count_')) {
            const count = parseInt(data.replace('onb_count_', ''));
            await bot.deleteMessage(chatId, messageId).catch(() => {});
            await continueOnboarding(chatId, userId, count);
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        // ============ RESET ============
        if (data === 'reset_confirm') {
            await db.clearParticipants(chatId);
            await db.setClubs(chatId, []);
            await db.setNationalTeams(chatId, []);
            await bot.editMessageText('✅ Все данные удалены. Напиши /start для новой настройки.', {
                chat_id: chatId, message_id: messageId
            });
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        if (data === 'reset_cancel') {
            await bot.editMessageText('❌ Отменено', { chat_id: chatId, message_id: messageId });
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        // ============ ПРОФИЛЬ ============
        if (data.startsWith('profile_') && data !== 'profile_cancel' && data !== 'profile_back') {
            const playerName = data.replace('profile_', '');
            const profileText = await formatPlayerProfile(chatId, playerName);
            await bot.editMessageText(profileText, {
                chat_id: chatId, message_id: messageId, parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[{ text: '◀️ К выбору игрока', callback_data: 'profile_back' }]]
                }
            });
            saveMessageId(chatId, messageId);
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        if (data === 'profile_back') {
            const participants = await db.getParticipants(chatId);
            await bot.editMessageText(
                '👤 <b>ПРОФИЛЬ ИГРОКА</b>\n\nВыбери игрока:',
                {
                    chat_id: chatId, message_id: messageId, parse_mode: 'HTML',
                    ...createProfileSelectionKeyboard(participants)
                }
            );
            saveMessageId(chatId, messageId);
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        if (data === 'profile_cancel') {
            await bot.editMessageText('❌ Отменено', { chat_id: chatId, message_id: messageId });
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        // ============ PREMIUM ============
        if (data === 'premium_buy') {
            try {
                const sub = await db.getSubscription(chatId);
                if (sub.tier === 'pro') {
                    await bot.answerCallbackQuery(callbackQuery.id, { text: '✅ PRO уже активен!' });
                    return;
                }

                await bot.answerCallbackQuery(callbackQuery.id, { text: '⏳ Создаём платёж...' });

                const payment = await createPayment(
                    chatId,
                    200,
                    `PRO-версия для чата ${chatId}`
                );

                await db.savePendingPayment(payment.id, chatId, 200);

                await bot.editMessageText(
                    `💳 <b>Оплата PRO-версии</b>\n\n` +
                    `Сумма: <b>200 ₽</b>\n` +
                    `Способ оплаты: <b>СБП / Карта</b>\n\n` +
                    `Нажмите кнопку ниже — откроется страница оплаты ЮKassa.\n\n` +
                    `<i>После оплаты вернитесь в чат — PRO активируется автоматически.</i>`,
                    {
                        chat_id: chatId, message_id: messageId, parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '💳 Оплатить 200 ₽', url: payment.confirmationUrl }],
                                [{ text: '❌ Отмена', callback_data: 'premium_cancel' }]
                            ]
                        }
                    }
                );
            } catch (error) {
                console.error('Ошибка создания платежа:', error);
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: '❌ Ошибка оплаты. Попробуйте позже.'
                });
            }
            return;
        }

        if (data === 'premium_check') {
            await bot.answerCallbackQuery(callbackQuery.id, { text: '🔄 Проверяем...' });

            const activated = await checkPendingPayments(chatId);

            if (activated) {
                await bot.deleteMessage(chatId, messageId).catch(() => {});
                await showPremiumMessage(chatId);
            } else {
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: '❌ Оплата не найдена. Если вы уже оплатили — подождите минуту и попробуйте снова.'
                });
            }
            return;
        }

        if (data === 'premium_cancel') {
            await showPremiumMessage(chatId, messageId);
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        if (data === 'premium_info') {
            await bot.editMessageText(
                `💎 <b>Что входит в PRO-версию</b>\n\n` +
                `<b>Сейчас (FREE):</b>\n` +
                `• Максимум 4 участника\n` +
                `• Максимум 5 турниров\n\n` +
                `<b>С PRO (200₽, навсегда):</b>\n` +
                `• До 10 участников\n` +
                `• Безлимит турниров\n` +
                `• Все будущие фичи\n` +
                `• Приоритетная поддержка\n\n` +
                `<b>❓ Частые вопросы:</b>\n\n` +
                `<b>Это подписка?</b>\n` +
                `Нет, разовый платёж. Платите 200₽ один раз — навсегда.\n\n` +
                `<b>PRO для одного чата или для всех?</b>\n` +
                `Для одного чата. В других чатах — бесплатная версия.\n\n` +
                `<b>Как оплатить?</b>\n` +
                `Нажмите «Купить PRO» — откроется страница ЮKassa.`,
                {
                    chat_id: chatId, message_id: messageId, parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '💳 Купить PRO', callback_data: 'premium_buy' }],
                            [{ text: '◀️ Назад', callback_data: 'premium_back' }]
                        ]
                    }
                }
            );
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        if (data === 'premium_back') {
            await showPremiumMessage(chatId, messageId);
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        if (data === 'premium_show_rating') {
            const ratingTable = await getGlobalRatingTable(chatId);
            await bot.sendMessage(chatId, ratingTable, { parse_mode: 'HTML' });
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        // ============ H2H ============
        if (data.startsWith('h2h_first_')) {
            const firstPlayer = data.replace('h2h_first_', '');
            const participants = await db.getParticipants(chatId);
            await bot.editMessageText(
                `⚔️ <b>ЛИЧНЫЕ ВСТРЕЧИ</b>\n\nПервый игрок: <b>${firstPlayer}</b>\n\nТеперь выбери второго:`,
                { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', ...createH2HSecondPlayerKeyboard(participants, firstPlayer) }
            );
            saveMessageId(chatId, messageId);
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        if (data.startsWith('h2h_second_')) {
            const rest = data.replace('h2h_second_', '');
            const [firstPlayer, secondPlayer] = rest.split('__');
            const stats = await getHeadToHeadStats(chatId, firstPlayer, secondPlayer);
            const message = formatHeadToHead(firstPlayer, secondPlayer, stats);
            await bot.editMessageText(message, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' });
            saveMessageId(chatId, messageId);
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        if (data === 'h2h_cancel') {
            await bot.editMessageText('❌ Личные встречи отменены', { chat_id: chatId, message_id: messageId });
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        // ============ ТУРНИР ============
        if (data.startsWith('tournament_toggle_')) {
            const participantId = data.replace('tournament_toggle_', '');
            const participants = await db.getParticipants(chatId);
            const selectionKey = `tournament_${chatId}`;
            let selected = selectedParticipants.get(selectionKey) || [];
            const participant = participants.find(p => p.id === participantId);

            if (!participant) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Участник не найден' });
                return;
            }

            if (selected.includes(participantId)) {
                selected = selected.filter(id => id !== participantId);
                await bot.answerCallbackQuery(callbackQuery.id, { text: `❌ Убран: ${participant.name}` });
            } else {
                const limits = await getLimits(chatId);
                if (selected.length >= limits.maxParticipants) {
                    await bot.answerCallbackQuery(callbackQuery.id, {
                        text: `⚠️ Максимум ${limits.maxParticipants} участников (${limits.maxTournaments === Infinity ? 'PRO' : 'FREE'}).\nКупи PRO: /premium`
                    });
                    return;
                }
                selected.push(participantId);
                await bot.answerCallbackQuery(callbackQuery.id, { text: `✅ Добавлен: ${participant.name}` });
            }

            selectedParticipants.set(selectionKey, selected);
            const worldCup = tournamentMode.get(chatId) || false;
            const selectedNames = selected.map(id => {
                const p = participants.find(part => part.id === id);
                return p ? p.name : id;
            });

            let statusText = selected.length > 0
                ? `👥 Выбрано: ${selected.length}\n\n✅ ${selectedNames.join(', ')}\n\n`
                : `👥 Выбери участников:\n\n`;
            statusText += `Режим: ${worldCup ? '🌍 ЧМ (сборные)' : '⚽ Клубы'}`;

            await bot.editMessageText(statusText, {
                chat_id: chatId, message_id: messageId,
                ...createTournamentSelectionKeyboard(participants, selected, worldCup)
            });
            saveMessageId(chatId, messageId);
        } else if (data === 'toggle_world_cup') {
            const currentMode = tournamentMode.get(chatId) || false;
            tournamentMode.set(chatId, !currentMode);
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: !currentMode ? '🌍 Режим ЧМ' : '⚽ Клубы'
            });

            const participants = await db.getParticipants(chatId);
            const selectionKey = `tournament_${chatId}`;
            const selected = selectedParticipants.get(selectionKey) || [];
            const selectedNames = selected.map(id => {
                const p = participants.find(part => part.id === id);
                return p ? p.name : id;
            });

            let statusText = selected.length > 0
                ? `👥 Выбрано: ${selected.length}\n\n✅ ${selectedNames.join(', ')}\n\n`
                : `👥 Выбери участников:\n\n`;
            statusText += `Режим: ${!currentMode ? '🌍 ЧМ (сборные)' : '⚽ Клубы'}`;

            await bot.editMessageText(statusText, {
                chat_id: chatId, message_id: messageId,
                ...createTournamentSelectionKeyboard(participants, selected, !currentMode)
            });
            saveMessageId(chatId, messageId);
        } else if (data === 'tournament_start') {
            const selectionKey = `tournament_${chatId}`;
            const selected = selectedParticipants.get(selectionKey) || [];
            const worldCup = tournamentMode.get(chatId) || false;
            const participants = await db.getParticipants(chatId);

            if (selected.length < 2) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: '⚠️ Минимум 2 участника!' });
                return;
            }

            const limits = await getLimits(chatId);
            const tourCount = await db.getTournamentCount(chatId);
            if (tourCount >= limits.maxTournaments) {
                await bot.editMessageText(
                    `⚠️ Достигнут лимит бесплатных турниров (${limits.maxTournaments}).\n\n💎 Купи PRO за 200₽ — команда /premium`,
                    { chat_id: chatId, message_id: messageId }
                );
                return;
            }

            const teams = worldCup ? await db.getNationalTeams(chatId) : await db.getClubs(chatId);
            if (teams.length < selected.length) {
                await bot.editMessageText(`❌ Недостаточно команд!`, {
                    chat_id: chatId, message_id: messageId
                });
                selectedParticipants.delete(selectionKey);
                tournamentMode.delete(chatId);
                return;
            }

            const shuffledTeams = shuffleArray(teams);
            const selectedParticipantsData = selected.map((id, idx) => {
                const participant = participants.find(p => p.id === id);
                return { name: participant.name, team: shuffledTeams[idx % shuffledTeams.length] };
            });

            const matches = generateSchedule(selectedParticipantsData);
            currentTournament = {
                active: true,
                type: worldCup ? 'world_cup' : 'club',
                participants: selectedParticipantsData, matches,
                createdAt: new Date().toISOString()
            };

            const modeEmoji = worldCup ? '🌍' : '⚽';
            const modeText = worldCup ? 'ЧЕМПИОНАТ МИРА' : 'КЛУБНЫЙ ТУРНИР';

            let drawMessage = `<b>${modeEmoji} ${modeText}</b>\n\n<b>🎲 Жеребьёвка:</b>\n\n`;
            selectedParticipantsData.forEach(p => { drawMessage += `${p.name} → ${p.team}\n`; });
            drawMessage += '\n<b>🏆 РАСПИСАНИЕ:</b>\n\n';
            matches.forEach(m => { drawMessage += `${m.player1} vs ${m.player2}\n`; });
            drawMessage += `\n<b>🏟 Статус:</b> 0 из ${matches.length} матчей`;

            await bot.editMessageText(drawMessage, {
                chat_id: chatId, message_id: messageId, parse_mode: 'HTML'
            });
            saveMessageId(chatId, messageId);

            selectedParticipants.delete(selectionKey);
            tournamentMode.delete(chatId);

            const isAdminUser = await isAdmin(chatId, userId);
            const confirmMsg = await bot.sendMessage(chatId, `✅ Турнир создан!`, getMainKeyboard(isAdminUser, true));
            saveMessageId(chatId, confirmMsg.message_id);
        } else if (data === 'tournament_cancel') {
            selectedParticipants.delete(`tournament_${chatId}`);
            tournamentMode.delete(chatId);
            await bot.editMessageText('❌ Отменено', { chat_id: chatId, message_id: messageId });
            const isAdminUser = await isAdmin(chatId, userId);
            bot.sendMessage(chatId, 'Главное меню', getMainKeyboard(isAdminUser, false));
        } else if (data.startsWith('record_match_')) {
            const matchId = parseInt(data.replace('record_match_', ''));
            if (!currentTournament || !currentTournament.active) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Нет турнира!' });
                return;
            }
            const match = currentTournament.matches.find(m => m.id === matchId);
            if (!match || match.completed) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Матч завершен!' });
                return;
            }
            userStates.set(userId, { action: 'waiting_for_score', matchId });
            await bot.editMessageText(`📝 Введи счет:\n${match.player1} vs ${match.player2}`, {
                chat_id: chatId, message_id: messageId
            });
            saveMessageId(chatId, messageId);
        } else if (data.startsWith('edit_match_')) {
            const matchId = parseInt(data.replace('edit_match_', ''));
            if (!currentTournament) return;
            const match = currentTournament.matches.find(m => m.id === matchId);
            if (!match || !match.completed) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Матч не завершен!' });
                return;
            }
            userStates.set(userId, { action: 'editing_score', matchId });
            await bot.editMessageText(`✏️ Новый счет:\n${match.player1} vs ${match.player2}\nТекущий: ${match.score1}:${match.score2}`, {
                chat_id: chatId, message_id: messageId
            });
            saveMessageId(chatId, messageId);
        } else if (data === 'cancel_record' || data === 'cancel_edit') {
            userStates.delete(userId);
            await bot.editMessageText('❌ Отменено', { chat_id: chatId, message_id: messageId });
        } else if (data.startsWith('penalty_')) {
            const winner = data.replace('penalty_', '');
            const userState = userStates.get(userId);
            if (!userState || userState.action !== 'waiting_for_penalty') {
                await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Сессия истекла!' });
                return;
            }
            const match = currentTournament.matches.find(m => m.id === userState.matchId);
            if (!match) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Не найдено!' });
                return;
            }

            match.score1 = userState.score1;
            match.score2 = userState.score2;
            match.penalties = winner;
            match.completed = true;

            await db.recordMatch(chatId, match, currentTournament.participants, currentTournament.type);

            await bot.editMessageText(`✅ ${match.player1} ${userState.score1}:${userState.score2} ${match.player2}\n🏆 Пенальти: ${winner}`, {
                chat_id: chatId, message_id: callbackQuery.message.message_id
            });

            const stats = calculateStats(currentTournament.participants, currentTournament.matches);
            const sMsg = await bot.sendMessage(chatId, getStandingsTable(stats), { parse_mode: 'HTML' });
            const lMsg = await bot.sendMessage(chatId, getLiveStatus(currentTournament.matches), { parse_mode: 'HTML' });
            saveMessageId(chatId, sMsg.message_id);
            saveMessageId(chatId, lMsg.message_id);

            userStates.delete(userId);

            if (currentTournament.matches.every(m => m.completed)) {
                const cMsg = await bot.sendMessage(chatId, '🏆 Все матчи сыграны! Нажми "Завершить".');
                saveMessageId(chatId, cMsg.message_id);
            }
        }

        await bot.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
        console.error('Callback error:', error);
        await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Ошибка' });
    }
});

// ============ MESSAGES ============

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const userId = msg.from.id;

    if (!text) return;

    try {
        // Личка — игнорируем всё кроме /start и /premium
        if (chatId > 0) {
            if (!text.startsWith('/')) {
                bot.sendMessage(chatId,
                    `💡 Я работаю только в групповых чатах.\n\n` +
                    `Добавьте меня в чат с друзьями, чтобы начать турнир.`,
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '➕ Добавить в чат', url: `https://t.me/${BOT_USERNAME}?startgroup=true` }]
                            ]
                        }
                    }
                );
            }
            return;
        }

        const state = userStates.get(userId);
        if (state && state.action === 'onboarding') {
            await handleOnboardingInput(chatId, userId, text);
            return;
        }

        if (state && (state.action === 'waiting_for_score' || state.action === 'editing_score')) {
            const match = /^(\d+)[:\s\-](\d+)$/.exec(text);
            if (!match) {
                const err = await bot.sendMessage(chatId, '❌ Формат: 2:1, 2 1, 2-1');
                saveMessageId(chatId, err.message_id);
                return;
            }
            const score1 = parseInt(match[1]);
            const score2 = parseInt(match[2]);
            const tm = currentTournament.matches.find(m => m.id === state.matchId);
            if (!tm) { userStates.delete(userId); return; }

            if (score1 === score2) {
                userStates.set(userId, { action: 'waiting_for_penalty', matchId: state.matchId, score1, score2 });
                const keyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: tm.player1, callback_data: `penalty_${tm.player1}` }],
                            [{ text: tm.player2, callback_data: `penalty_${tm.player2}` }]
                        ]
                    }
                };
                const pMsg = await bot.sendMessage(chatId, `⚽️ Ничья ${score1}:${score2}!\nКто победил по пенальти?`, keyboard);
                saveMessageId(chatId, pMsg.message_id);
            } else {
                tm.score1 = score1;
                tm.score2 = score2;
                tm.penalties = null;
                tm.completed = true;

                await db.recordMatch(chatId, tm, currentTournament.participants, currentTournament.type);

                const resMsg = await bot.sendMessage(chatId, `✅ ${tm.player1} ${score1}:${score2} ${tm.player2}`);
                saveMessageId(chatId, resMsg.message_id);

                const stats = calculateStats(currentTournament.participants, currentTournament.matches);
                const sMsg = await bot.sendMessage(chatId, getStandingsTable(stats), { parse_mode: 'HTML' });
                const lMsg = await bot.sendMessage(chatId, getLiveStatus(currentTournament.matches), { parse_mode: 'HTML' });
                saveMessageId(chatId, sMsg.message_id);
                saveMessageId(chatId, lMsg.message_id);

                userStates.delete(userId);
                if (currentTournament.matches.every(m => m.completed)) {
                    const cMsg = await bot.sendMessage(chatId, '🏆 Все матчи сыграны! Нажми "Завершить".');
                    saveMessageId(chatId, cMsg.message_id);
                }
            }
            return;
        }

        if (state && state.action === 'waiting_for_club_name') {
            if (text === '🔙 Отмена') {
                userStates.delete(userId);
                const isAdminUser = await isAdmin(chatId, userId);
                bot.sendMessage(chatId, '❌ Отменено', getMainKeyboard(isAdminUser, !!currentTournament));
                return;
            }
            const success = await db.addClub(chatId, text);
            userStates.delete(userId);
            const isAdminUser = await isAdmin(chatId, userId);
            bot.sendMessage(chatId, success ? `✅ Клуб "${text}" добавлен!` : `⚠️ Клуб "${text}" уже есть!`, getMainKeyboard(isAdminUser, !!currentTournament));
            return;
        }

        if (state && state.action === 'waiting_for_national_name') {
            if (text === '🔙 Отмена') {
                userStates.delete(userId);
                const isAdminUser = await isAdmin(chatId, userId);
                bot.sendMessage(chatId, '❌ Отменено', getMainKeyboard(isAdminUser, !!currentTournament));
                return;
            }
            const success = await db.addNationalTeam(chatId, text);
            userStates.delete(userId);
            const isAdminUser = await isAdmin(chatId, userId);
            bot.sendMessage(chatId, success ? `✅ Сборная "${text}" добавлена!` : `⚠️ Сборная "${text}" уже есть!`, getMainKeyboard(isAdminUser, !!currentTournament));
            return;
        }

        if (state && state.action === 'waiting_for_club_remove') {
            if (text === '🔙 Отмена') {
                userStates.delete(userId);
                const isAdminUser = await isAdmin(chatId, userId);
                bot.sendMessage(chatId, '❌ Отменено', getMainKeyboard(isAdminUser, !!currentTournament));
                return;
            }
            const success = await db.removeClub(chatId, text);
            userStates.delete(userId);
            const isAdminUser = await isAdmin(chatId, userId);
            bot.sendMessage(chatId, success ? `✅ Клуб "${text}" удалён!` : `❌ Клуб "${text}" не найден!`, getMainKeyboard(isAdminUser, !!currentTournament));
            return;
        }

        if (state && state.action === 'waiting_for_national_remove') {
            if (text === '🔙 Отмена') {
                userStates.delete(userId);
                const isAdminUser = await isAdmin(chatId, userId);
                bot.sendMessage(chatId, '❌ Отменено', getMainKeyboard(isAdminUser, !!currentTournament));
                return;
            }
            const success = await db.removeNationalTeam(chatId, text);
            userStates.delete(userId);
            const isAdminUser = await isAdmin(chatId, userId);
            bot.sendMessage(chatId, success ? `✅ Сборная "${text}" удалена!` : `❌ Сборная "${text}" не найдена!`, getMainKeyboard(isAdminUser, !!currentTournament));
            return;
        }

        const isAdminUser = await isAdmin(chatId, userId);

        switch (text) {
            case '🏆 Новый турнир':
                if (currentTournament) {
                    bot.sendMessage(chatId, '⚠️ Турнир уже идет!');
                    break;
                }
                const participants = await db.getParticipants(chatId);
                if (participants.length < 2) {
                    bot.sendMessage(chatId, '❌ Нужно минимум 2 участника. Настрой: /setup');
                    break;
                }
                tournamentMode.set(chatId, false);
                const tMsg = await bot.sendMessage(chatId,
                    `👥 Выбери участников:\n\nРежим: ⚽ Клубы`,
                    createTournamentSelectionKeyboard(participants, [], false)
                );
                saveMessageId(chatId, tMsg.message_id);
                break;

            case '📋 Список команд':
                const teams = await db.getClubs(chatId);
                const nats = await db.getNationalTeams(chatId);
                let list = '<b>⚽ КЛУБЫ:</b>\n\n';
                teams.forEach((t, i) => { list += `${i + 1}. ${t}\n`; });
                list += `\n<b>🌍 СБОРНЫЕ:</b>\n\n`;
                nats.forEach((t, i) => { list += `${i + 1}. ${t}\n`; });
                const lMsg = await bot.sendMessage(chatId, list, { parse_mode: 'HTML' });
                saveMessageId(chatId, lMsg.message_id);
                break;

            case '📈 Общий рейтинг':
                const rMsg = await bot.sendMessage(chatId, await getGlobalRatingTable(chatId), { parse_mode: 'HTML' });
                saveMessageId(chatId, rMsg.message_id);
                break;

            case '⚔️ Личные встречи':
                const parts = await db.getParticipants(chatId);
                const hMsg = await bot.sendMessage(chatId,
                    '⚔️ <b>ЛИЧНЫЕ ВСТРЕЧИ</b>\n\nВыбери первого игрока:',
                    { parse_mode: 'HTML', ...createH2HFirstPlayerKeyboard(parts) }
                );
                saveMessageId(chatId, hMsg.message_id);
                break;

            case '👤 Профиль':
                const profileParticipants = await db.getParticipants(chatId);
                if (profileParticipants.length === 0) {
                    bot.sendMessage(chatId, '❌ Нет участников. Настрой: /setup');
                    break;
                }
                const profileMsg = await bot.sendMessage(chatId,
                    '👤 <b>ПРОФИЛЬ ИГРОКА</b>\n\nВыбери игрока:',
                    { parse_mode: 'HTML', ...createProfileSelectionKeyboard(profileParticipants) }
                );
                saveMessageId(chatId, profileMsg.message_id);
                break;

            case '🏟️ Статистика команд':
                const teamStats = await formatTeamStats(chatId);
                const tsMsg = await bot.sendMessage(chatId, teamStats, { parse_mode: 'HTML' });
                saveMessageId(chatId, tsMsg.message_id);
                break;

            case '💎 PRO':
                await showPremiumMessage(chatId);
                break;

            case '✏️ Записать результат':
                if (!currentTournament) {
                    bot.sendMessage(chatId, '❌ Нет турнира!');
                    break;
                }
                if (currentTournament.matches.every(m => m.completed)) {
                    bot.sendMessage(chatId, '✅ Все матчи сыграны!');
                    break;
                }
                const mMsg = await bot.sendMessage(chatId, '📝 Выбери матч:', createMatchSelectionKeyboard(currentTournament.matches));
                saveMessageId(chatId, mMsg.message_id);
                break;

            case '📊 Таблица':
                if (!currentTournament) {
                    bot.sendMessage(chatId, '❌ Нет турнира!');
                    break;
                }
                const stats = calculateStats(currentTournament.participants, currentTournament.matches);
                const stMsg = await bot.sendMessage(chatId, getStandingsTable(stats), { parse_mode: 'HTML' });
                saveMessageId(chatId, stMsg.message_id);
                break;

            case '✏️ Редактировать':
                if (!currentTournament) {
                    bot.sendMessage(chatId, '❌ Нет турнира!');
                    break;
                }
                const ek = createEditMatchSelectionKeyboard(currentTournament.matches);
                if (ek) {
                    const eMsg = await bot.sendMessage(chatId, '✏️ Выбери матч:', ek);
                    saveMessageId(chatId, eMsg.message_id);
                }
                break;

            case '🏆 Завершить':
                if (!currentTournament) { bot.sendMessage(chatId, '❌ Нет турнира!'); break; }
                if (!currentTournament.matches.every(m => m.completed)) {
                    const rem = currentTournament.matches.filter(m => !m.completed).length;
                    bot.sendMessage(chatId, `⚠️ Осталось ${rem} матчей!`);
                    break;
                }
                await deleteTournamentMessages();

                const fs_ = calculateStats(currentTournament.participants, currentTournament.matches);
                const sorted = [...fs_].sort((a, b) => {
                    if (a.points !== b.points) return b.points - a.points;
                    return (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst);
                });
                const winner = sorted[0];

                await db.recordTournament(chatId, currentTournament, winner);

                let fMsg = `<b>🏆 ТУРНИР ЗАВЕРШЕН!</b>\n\n<b>ПОБЕДИТЕЛЬ:</b> ${winner.name} (${winner.team}) — ${winner.points} очков\n\n<b>ИТОГОВАЯ ТАБЛИЦА:</b>\n`;
                sorted.forEach((s, i) => {
                    const m = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
                    fMsg += `${m} ${s.name} (${s.team}) — ${s.points} (голы ${s.goalsFor}:${s.goalsAgainst})\n`;
                });
                fMsg += `\n<b>📜 МАТЧИ:</b>\n`;
                currentTournament.matches.forEach(m => {
                    if (m.penalties) {
                        fMsg += `${m.player1} ${m.score1}:${m.score2} ${m.player2} — пен. ${m.penalties}\n`;
                    } else {
                        fMsg += `${m.player1} ${m.score1}:${m.score2} ${m.player2}\n`;
                    }
                });

                await bot.sendMessage(chatId, fMsg, { parse_mode: 'HTML' });
                currentTournament = null;
                const endM = await bot.sendMessage(chatId, '✅ Турнир завершен!', getMainKeyboard(isAdminUser, false));
                saveMessageId(chatId, endM.message_id);
                break;

            case '⚠️ Прервать турнир':
                if (!currentTournament) { bot.sendMessage(chatId, '❌ Нет турнира!'); break; }
                await deleteTournamentMessages();
                currentTournament = null;
                const cM = await bot.sendMessage(chatId, '⚠️ Турнир прерван!', getMainKeyboard(isAdminUser, false));
                saveMessageId(chatId, cM.message_id);
                break;

            case '➕ Добавить клуб':
                if (!isAdminUser) { bot.sendMessage(chatId, '⛔️ Только админ!'); break; }
                const aM = await bot.sendMessage(chatId, '✏️ Название клуба:', { reply_markup: { keyboard: [['🔙 Отмена']], resize_keyboard: true } });
                saveMessageId(chatId, aM.message_id);
                userStates.set(userId, { action: 'waiting_for_club_name' });
                break;

            case '➕ Добавить сборную':
                if (!isAdminUser) { bot.sendMessage(chatId, '⛔️ Только админ!'); break; }
                const aNm = await bot.sendMessage(chatId, '✏️ Название сборной:', { reply_markup: { keyboard: [['🔙 Отмена']], resize_keyboard: true } });
                saveMessageId(chatId, aNm.message_id);
                userStates.set(userId, { action: 'waiting_for_national_name' });
                break;

            case '❌ Удалить клуб':
                if (!isAdminUser) { bot.sendMessage(chatId, '⛔️ Только админ!'); break; }
                const clubList = await db.getClubs(chatId);
                if (clubList.length === 0) { bot.sendMessage(chatId, '📋 Список клубов пуст.'); break; }
                const clubBtns = clubList.map(t => [{ text: t }]);
                clubBtns.push([{ text: '🔙 Отмена' }]);
                const dCM = await bot.sendMessage(chatId, '❌ Выбери клуб:', { reply_markup: { keyboard: clubBtns, resize_keyboard: true } });
                saveMessageId(chatId, dCM.message_id);
                userStates.set(userId, { action: 'waiting_for_club_remove' });
                break;

            case '❌ Удалить сборную':
                if (!isAdminUser) { bot.sendMessage(chatId, '⛔️ Только админ!'); break; }
                const natList = await db.getNationalTeams(chatId);
                if (natList.length === 0) { bot.sendMessage(chatId, '📋 Список сборных пуст.'); break; }
                const natBtns = natList.map(t => [{ text: t }]);
                natBtns.push([{ text: '🔙 Отмена' }]);
                const dNM = await bot.sendMessage(chatId, '❌ Выбери сборную:', { reply_markup: { keyboard: natBtns, resize_keyboard: true } });
                saveMessageId(chatId, dNM.message_id);
                userStates.set(userId, { action: 'waiting_for_national_remove' });
                break;

            case '⚙️ Настройки':
                if (!isAdminUser) { bot.sendMessage(chatId, '⛔️ Только админ!'); break; }
                bot.sendMessage(chatId,
                    `<b>⚙️ НАСТРОЙКИ</b>\n\n` +
                    `/setup — перенастроить участников\n` +
                    `/reset — сбросить все данные\n` +
                    `/premium — купить PRO\n` +
                    `/chatid — показать ID чата`,
                    { parse_mode: 'HTML' }
                );
                break;

            case '❓ Помощь':
                const help = currentTournament ?
                    `<b>🎯 ТУРНИР ИДЕТ</b>\n\n✏️ Записать — счет\n📊 Таблица\n✏️ Редактировать\n🏆 Завершить\n⚠️ Прервать` :
                    `<b>🎯 Турнирный бот</b>\n\n🏆 Новый турнир\n📋 Список команд\n📈 Общий рейтинг\n⚔️ Личные встречи\n👤 Профиль\n🏟️ Статистика команд\n💎 PRO\n\n<b>Для админов:</b>\n⚙️ Настройки`;
                const hM = await bot.sendMessage(chatId, help, { parse_mode: 'HTML', ...getMainKeyboard(isAdminUser, !!currentTournament) });
                saveMessageId(chatId, hM.message_id);
                break;

            case '🔙 Отмена':
                userStates.delete(userId);
                bot.sendMessage(chatId, '⬅️ Главное меню', getMainKeyboard(isAdminUser, !!currentTournament));
                break;
        }
    } catch (error) {
        console.error('Message error:', error);
        bot.sendMessage(chatId, '❌ Ошибка, попробуй позже');
    }
});

// ============ /list_teams ============

bot.onText(/\/list_teams/, async (msg) => {
    const chatId = msg.chat.id;
    if (chatId > 0) return;
    try {
        const teams = await db.getClubs(chatId);
        const nats = await db.getNationalTeams(chatId);
        let list = '<b>⚽ КЛУБЫ:</b>\n\n';
        teams.forEach((t, i) => { list += `${i + 1}. ${t}\n`; });
        list += `\n<b>🌍 СБОРНЫЕ:</b>\n\n`;
        nats.forEach((t, i) => { list += `${i + 1}. ${t}\n`; });
        const m = await bot.sendMessage(chatId, list, { parse_mode: 'HTML' });
        saveMessageId(chatId, m.message_id);
    } catch (error) {
        console.error('list_teams error:', error);
    }
});

bot.on('polling_error', (error) => { console.error('Polling error:', error); });

// ============ ЗАПУСК ============

initializeBot();
