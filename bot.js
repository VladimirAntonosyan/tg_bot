const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const http = require('http');

const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
    } else {
        res.writeHead(404);
        res.end();
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Health check server running on port ${PORT}`);
});

require('dotenv').config();

// Конфигурация
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
    console.error('❌ Укажи TELEGRAM_BOT_TOKEN в файле .env');
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });
const TEAMS_FILE = path.join(__dirname, 'teams.json');
const NATIONAL_TEAMS_FILE = path.join(__dirname, 'national_teams.json');
const GLOBAL_STATS_FILE = path.join(__dirname, 'global_stats.json');

// Хранилище состояний
const userStates = new Map();
const selectedParticipants = new Map();
const tournamentMode = new Map(); // 'club' или 'world_cup'

// Текущий активный турнир
let currentTournament = null;

// Хранилище ID сообщений турнира
let tournamentMessages = [];

// Список известных участников
const KNOWN_PARTICIPANTS = [
    { id: 'vladimir', name: 'Владимир', username: 'antsn21' },
    { id: 'nuriman', name: 'Нуриман', username: 'bnm11' },
    { id: 'nikita', name: 'Никита', username: 'NadezhinN' },
    { id: 'stanislav', name: 'Станислав', username: 'stas_0297' },
    { id: 'denis', name: 'Денис', username: 'DenisMosman' }
];

// Загрузка списка клубов
function loadTeams() {
    try {
        const data = fs.readFileSync(TEAMS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Ошибка загрузки команд:', error);
        return [];
    }
}

// Сохранение списка клубов
function saveTeams(teams) {
    fs.writeFileSync(TEAMS_FILE, JSON.stringify(teams, null, 2));
}

// Загрузка списка сборных
function loadNationalTeams() {
    try {
        const data = fs.readFileSync(NATIONAL_TEAMS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Ошибка загрузки сборных:', error);
        return [];
    }
}

// Загрузка глобальной статистики
function loadGlobalStats() {
    try {
        const data = fs.readFileSync(GLOBAL_STATS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

// Сохранение глобальной статистики
function saveGlobalStats(stats) {
    fs.writeFileSync(GLOBAL_STATS_FILE, JSON.stringify(stats, null, 2));
}

// Запись результата матча в глобальную статистику
function recordMatchToGlobalStats(match, participants, tournamentType) {
    const stats = loadGlobalStats();
    
    const player1Data = participants.find(p => p.name === match.player1);
    const player2Data = participants.find(p => p.name === match.player2);
    
    const record = {
        date: new Date().toISOString(),
        tournamentType: tournamentType, // 'club' или 'world_cup'
        player1: match.player1,
        player2: match.player2,
        team1: player1Data ? player1Data.team : null,
        team2: player2Data ? player2Data.team : null,
        score1: match.score1,
        score2: match.score2,
        penalties: match.penalties
    };
    
    stats.push(record);
    saveGlobalStats(stats);
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

// Сохранение ID сообщения
function saveMessageId(chatId, messageId) {
    tournamentMessages.push({ chatId, messageId });
}

// Удаление всех сообщений турнира
async function deleteTournamentMessages() {
    for (const msg of tournamentMessages) {
        try {
            await bot.deleteMessage(msg.chatId, msg.messageId);
        } catch (error) {
            // Игнорируем ошибки
        }
    }
    tournamentMessages = [];
}

// Генерация расписания матчей (каждый с каждым)
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

// Подсчет статистики участников турнира
function calculateStats(participants, matches) {
    const stats = {};
    
    participants.forEach(p => {
        stats[p.name] = {
            name: p.name,
            team: p.team,
            goalsFor: 0,
            goalsAgainst: 0,
            wins: 0,
            penaltyWins: 0,
            penaltyLosses: 0,
            draws: 0,
            losses: 0,
            points: 0,
            matchesPlayed: 0
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
                p1.penaltyWins++;
                p2.penaltyLosses++;
                p1.points += 2;
                p2.points += 1;
            } else {
                p1.penaltyLosses++;
                p2.penaltyWins++;
                p1.points += 1;
                p2.points += 2;
            }
        } else if (match.score1 > match.score2) {
            p1.wins++;
            p2.losses++;
            p1.points += 2;
        } else if (match.score2 > match.score1) {
            p2.wins++;
            p1.losses++;
            p2.points += 2;
        } else {
            p1.draws++;
            p2.draws++;
            p1.points += 1;
            p2.points += 1;
        }
    });
    
    return Object.values(stats);
}

// Подсчет глобального рейтинга всех игроков
function calculateGlobalStats() {
    const records = loadGlobalStats();
    const playerStats = {};
    
    // Инициализация всех известных игроков
    KNOWN_PARTICIPANTS.forEach(p => {
        playerStats[p.name] = {
            name: p.name,
            matchesPlayed: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            penaltyWins: 0,
            penaltyLosses: 0,
            points: 0,
            goalsFor: 0,
            goalsAgainst: 0
        };
    });
    
    records.forEach(record => {
        // Игрок 1
        if (!playerStats[record.player1]) {
            playerStats[record.player1] = {
                name: record.player1, matchesPlayed: 0, wins: 0, losses: 0,
                draws: 0, penaltyWins: 0, penaltyLosses: 0, points: 0,
                goalsFor: 0, goalsAgainst: 0
            };
        }
        // Игрок 2
        if (!playerStats[record.player2]) {
            playerStats[record.player2] = {
                name: record.player2, matchesPlayed: 0, wins: 0, losses: 0,
                draws: 0, penaltyWins: 0, penaltyLosses: 0, points: 0,
                goalsFor: 0, goalsAgainst: 0
            };
        }
        
        const p1 = playerStats[record.player1];
        const p2 = playerStats[record.player2];
        
        p1.matchesPlayed++;
        p2.matchesPlayed++;
        
        p1.goalsFor += record.score1;
        p1.goalsAgainst += record.score2;
        p2.goalsFor += record.score2;
        p2.goalsAgainst += record.score1;
        
        if (record.penalties) {
            if (record.penalties === record.player1) {
                p1.penaltyWins++;
                p2.penaltyLosses++;
                p1.points += 2;
                p2.points += 1;
            } else {
                p1.penaltyLosses++;
                p2.penaltyWins++;
                p1.points += 1;
                p2.points += 2;
            }
        } else if (record.score1 > record.score2) {
            p1.wins++;
            p2.losses++;
            p1.points += 2;
        } else if (record.score2 > record.score1) {
            p2.wins++;
            p1.losses++;
            p2.points += 2;
        } else {
            p1.draws++;
            p2.draws++;
            p1.points += 1;
            p2.points += 1;
        }
    });
    
    return Object.values(playerStats);
}

// Получение таблицы турнира
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

// Получение общего рейтинга игроков
function getGlobalRatingTable() {
    const stats = calculateGlobalStats();
    
    // Сортировка по очкам, затем по победам, затем по разнице голов
    const sorted = [...stats].sort((a, b) => {
        if (a.points !== b.points) return b.points - a.points;
        if (a.wins !== b.wins) return b.wins - a.wins;
        const diffA = a.goalsFor - a.goalsAgainst;
        const diffB = b.goalsFor - b.goalsAgainst;
        return diffB - diffA;
    });
    
    let table = '<b>📈 ОБЩИЙ РЕЙТИНГ ИГРОКОВ</b>\n\n';
    
    sorted.forEach((s, idx) => {
        const medal = idx === 0 ? '🥇 ' : idx === 1 ? '🥈 ' : idx === 2 ? '🥉 ' : `${idx + 1}. `;
        table += `${medal}<b>${s.name}</b> — ${s.points} очков\n`;
        table += `   🎮 Матчей: ${s.matchesPlayed}\n`;
        table += `   ✅ Побед: ${s.wins} | ❌ Поражений: ${s.losses} | 🤝 Ничьих: ${s.draws}\n`;
        table += `   🥅 Пенальти: ${s.penaltyWins} побед / ${s.penaltyLosses} поражений\n`;
        table += `   ⚽️ Голы: ${s.goalsFor}:${s.goalsAgainst} (${s.goalsFor - s.goalsAgainst >= 0 ? '+' : ''}${s.goalsFor - s.goalsAgainst})\n\n`;
    });
    
    return table;
}

// Live-статус турнира
function getLiveStatus(matches) {
    const completed = matches.filter(m => m.completed).length;
    const total = matches.length;
    const remaining = matches.filter(m => !m.completed);
    
    let status = `<b>🏟 LIVE СТАТУС ТУРНИРА</b>\n\n`;
    status += `📊 Сыграно матчей: ${completed} из ${total}\n`;
    
    if (remaining.length > 0) {
        status += `\n<b>📅 Осталось матчей (${remaining.length}):</b>\n`;
        remaining.forEach(m => {
            status += `• ${m.player1} vs ${m.player2}\n`;
        });
    } else {
        status += `\n✅ Все матчи сыграны! Нажми "🏆 Завершить" для подведения итогов.\n`;
    }
    
    return status;
}

// Главное меню
function getMainKeyboard(isAdminUser = false, isTournamentActive = false) {
    if (isTournamentActive) {
        const keyboard = [
            [{ text: '✏️ Записать результат' }, { text: '📊 Таблица' }],
            [{ text: '✏️ Редактировать' }, { text: '🏆 Завершить' }],
            [{ text: '⚠️ Прервать турнир' }, { text: '❓ Помощь' }]
        ];
        return { reply_markup: { keyboard: keyboard, resize_keyboard: true, persistent: true } };
    }
    
    const keyboard = [
        [{ text: '🏆 Новый турнир' }, { text: '📋 Список команд' }],
        [{ text: '📈 Общий рейтинг' }, { text: '❓ Помощь' }]
    ];
    
    if (isAdminUser) {
        keyboard.push([{ text: '➕ Добавить команду' }, { text: '❌ Удалить команду' }]);
    }
    
    return { reply_markup: { keyboard: keyboard, resize_keyboard: true, persistent: true } };
}

// Клавиатура выбора участников турнира (с чекбоксом ЧЕМПИОНАТ МИРА)
function createTournamentSelectionKeyboard(selectedIds = [], worldCupMode = false) {
    const inlineKeyboard = [];
    let row = [];
    
    for (const participant of KNOWN_PARTICIPANTS) {
        const isSelected = selectedIds.includes(participant.id);
        const buttonText = isSelected ? `✅ ${participant.name}` : `⬜️ ${participant.name}`;
        const callbackData = `tournament_toggle_${participant.id}`;
        
        row.push({ text: buttonText, callback_data: callbackData });
        
        if (row.length === 2) {
            inlineKeyboard.push(row);
            row = [];
        }
    }
    
    if (row.length > 0) {
        inlineKeyboard.push(row);
    }
    
    // Чекбокс ЧЕМПИОНАТ МИРА
    const worldCupButton = worldCupMode 
        ? '✅ ЧЕМПИОНАТ МИРА (сборные)' 
        : '⬜️ ЧЕМПИОНАТ МИРА (сборные)';
    inlineKeyboard.push([{ text: worldCupButton, callback_data: 'toggle_world_cup' }]);
    
    inlineKeyboard.push([{ text: '🎲 Начать турнир', callback_data: 'tournament_start' }]);
    inlineKeyboard.push([{ text: '❌ Отмена', callback_data: 'tournament_cancel' }]);
    
    return { reply_markup: { inline_keyboard: inlineKeyboard } };
}

// Клавиатура выбора матча для записи результата
function createMatchSelectionKeyboard(matches) {
    const inlineKeyboard = [];
    const incompleteMatches = matches.filter(m => !m.completed);
    
    incompleteMatches.forEach(match => {
        inlineKeyboard.push([{ 
            text: `${match.player1} vs ${match.player2}`, 
            callback_data: `record_match_${match.id}` 
        }]);
    });
    
    inlineKeyboard.push([{ text: '❌ Отмена', callback_data: 'cancel_record' }]);
    
    return { reply_markup: { inline_keyboard: inlineKeyboard } };
}

// Клавиатура выбора матча для редактирования
function createEditMatchSelectionKeyboard(matches) {
    const inlineKeyboard = [];
    const completedMatches = matches.filter(m => m.completed);
    
    if (completedMatches.length === 0) return null;
    
    completedMatches.forEach(match => {
        const scoreText = `${match.player1} ${match.score1}:${match.score2} ${match.player2}`;
        inlineKeyboard.push([{ 
            text: scoreText, 
            callback_data: `edit_match_${match.id}` 
        }]);
    });
    
    inlineKeyboard.push([{ text: '❌ Отмена', callback_data: 'cancel_edit' }]);
    
    return { reply_markup: { inline_keyboard: inlineKeyboard } };
}

// Команда /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    isAdmin(chatId, userId).then(isAdminUser => {
        bot.sendMessage(chatId, 
            '🎯 *Добро пожаловать в Турнирного бота!*\n\nИспользуй кнопки ниже для управления.\n\nИзвестные участники: Владимир, Нуриман, Никита, Станислав, Денис',
            { parse_mode: 'Markdown', ...getMainKeyboard(isAdminUser, !!currentTournament) }
        );
    });
});

// Обработка callback-запросов
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;
    const messageId = callbackQuery.message.message_id;
    
    if (data.startsWith('tournament_toggle_')) {
        const participantId = data.replace('tournament_toggle_', '');
        const selectionKey = `tournament_${chatId}`;
        let selected = selectedParticipants.get(selectionKey) || [];
        const participant = KNOWN_PARTICIPANTS.find(p => p.id === participantId);
        
        if (selected.includes(participantId)) {
            selected = selected.filter(id => id !== participantId);
            await bot.answerCallbackQuery(callbackQuery.id, { text: `❌ Убран: ${participant.name}` });
        } else {
            if (selected.length >= 5) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: '⚠️ Максимум 5 участников!' });
                return;
            }
            selected.push(participantId);
            await bot.answerCallbackQuery(callbackQuery.id, { text: `✅ Добавлен: ${participant.name}` });
        }
        
        selectedParticipants.set(selectionKey, selected);
        const worldCup = tournamentMode.get(chatId) || false;
        
        const selectedNames = selected.map(id => {
            const p = KNOWN_PARTICIPANTS.find(part => part.id === id);
            return p ? p.name : id;
        });
        
        let statusText = selected.length > 0 
            ? `👥 Выбрано участников: ${selected.length}\n\n✅ ${selectedNames.join(', ')}\n\n` 
            : `👥 Выбери участников турнира (от 2 до 5 человек):\n\n`;
        
        statusText += `Режим: ${worldCup ? '🌍 ЧЕМПИОНАТ МИРА (сборные)' : '⚽ Клубный турнир'}\n\n`;
        statusText += `━━━━━━━━━━━━━━━━━\nНажми "🎲 Начать турнир" для жеребьевки команд и создания расписания.`;
        
        await bot.editMessageText(statusText, {
            chat_id: chatId,
            message_id: messageId,
            ...createTournamentSelectionKeyboard(selected, worldCup)
        });
        saveMessageId(chatId, messageId);
        
    } else if (data === 'toggle_world_cup') {
        const currentMode = tournamentMode.get(chatId) || false;
        tournamentMode.set(chatId, !currentMode);
        
        await bot.answerCallbackQuery(callbackQuery.id, { 
            text: !currentMode ? '🌍 Режим ЧЕМПИОНАТ МИРА включен' : '⚽ Режим клубного турнира' 
        });
        
        const selectionKey = `tournament_${chatId}`;
        const selected = selectedParticipants.get(selectionKey) || [];
        
        const selectedNames = selected.map(id => {
            const p = KNOWN_PARTICIPANTS.find(part => part.id === id);
            return p ? p.name : id;
        });
        
        let statusText = selected.length > 0 
            ? `👥 Выбрано участников: ${selected.length}\n\n✅ ${selectedNames.join(', ')}\n\n` 
            : `👥 Выбери участников турнира (от 2 до 5 человек):\n\n`;
        
        statusText += `Режим: ${!currentMode ? '🌍 ЧЕМПИОНАТ МИРА (сборные)' : '⚽ Клубный турнир'}\n\n`;
        statusText += `━━━━━━━━━━━━━━━━━\nНажми "🎲 Начать турнир" для жеребьевки команд и создания расписания.`;
        
        await bot.editMessageText(statusText, {
            chat_id: chatId,
            message_id: messageId,
            ...createTournamentSelectionKeyboard(selected, !currentMode)
        });
        saveMessageId(chatId, messageId);
        
    } else if (data === 'tournament_start') {
        const selectionKey = `tournament_${chatId}`;
        const selected = selectedParticipants.get(selectionKey) || [];
        const worldCup = tournamentMode.get(chatId) || false;
        
        if (selected.length < 2) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: '⚠️ Выбери минимум 2 участника!' });
            return;
        }
        
        // Выбираем источник команд в зависимости от режима
        const teams = worldCup ? loadNationalTeams() : loadTeams();
        
        if (teams.length < selected.length) {
            await bot.editMessageText(`❌ Недостаточно ${worldCup ? 'сборных' : 'команд'}! Нужно: ${selected.length}, доступно: ${teams.length}.`, {
                chat_id: chatId,
                message_id: messageId
            });
            saveMessageId(chatId, messageId);
            selectedParticipants.delete(selectionKey);
            tournamentMode.delete(chatId);
            return;
        }
        
        const shuffledTeams = shuffleArray(teams);
        const participants = selected.map((id, idx) => {
            const participant = KNOWN_PARTICIPANTS.find(p => p.id === id);
            return {
                name: participant.name,
                team: shuffledTeams[idx % shuffledTeams.length]
            };
        });
        
        const matches = generateSchedule(participants);
        
        currentTournament = {
            active: true,
            type: worldCup ? 'world_cup' : 'club',
            participants: participants,
            matches: matches,
            createdAt: new Date().toISOString()
        };
        
        const modeEmoji = worldCup ? '🌍' : '⚽';
        const modeText = worldCup ? 'ЧЕМПИОНАТ МИРА' : 'КЛУБНЫЙ ТУРНИР';
        
        let drawMessage = `<b>${modeEmoji} ${modeText}</b>\n\n`;
        drawMessage += '<b>🎲 Жеребьевка команд:</b>\n\n';
        participants.forEach(p => {
            drawMessage += `${p.name} → ${p.team}\n`;
        });
        
        drawMessage += '\n<b>🏆 РАСПИСАНИЕ МАТЧЕЙ:</b>\n\n';
        matches.forEach(match => {
            drawMessage += `${match.player1} vs ${match.player2}\n`;
        });
        
        drawMessage += `\n<b>🏟 Статус:</b> Сыграно 0 из ${matches.length} матчей\n`;
        drawMessage += `\nИспользуй кнопки ниже для записи результатов!`;
        
        await bot.editMessageText(drawMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML'
        });
        saveMessageId(chatId, messageId);
        
        selectedParticipants.delete(selectionKey);
        tournamentMode.delete(chatId);
        
        const isAdminUser = await isAdmin(chatId, userId);
        const confirmMsg = await bot.sendMessage(chatId, `✅ Турнир (${modeText.toLowerCase()}) создан!`, 
            getMainKeyboard(isAdminUser, true));
        saveMessageId(chatId, confirmMsg.message_id);
        
    } else if (data === 'tournament_cancel') {
        const selectionKey = `tournament_${chatId}`;
        selectedParticipants.delete(selectionKey);
        tournamentMode.delete(chatId);
        
        await bot.editMessageText('❌ Создание турнира отменено', {
            chat_id: chatId,
            message_id: messageId
        });
        
        const isAdminUser = await isAdmin(chatId, userId);
        bot.sendMessage(chatId, 'Возврат в главное меню', getMainKeyboard(isAdminUser, false));
        
    } else if (data.startsWith('record_match_')) {
        const matchId = parseInt(data.replace('record_match_', ''));
        
        if (!currentTournament || !currentTournament.active) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Нет активного турнира!' });
            return;
        }
        
        const match = currentTournament.matches.find(m => m.id === matchId);
        if (!match || match.completed) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Матч уже завершен!' });
            return;
        }
        
        userStates.set(userId, { action: 'waiting_for_score', matchId: matchId });
        await bot.editMessageText(`📝 Введи счет основного времени для матча:\n${match.player1} vs ${match.player2}\n\nПример: 2:1 или 0:0`, {
            chat_id: chatId,
            message_id: messageId
        });
        saveMessageId(chatId, messageId);
        
    } else if (data.startsWith('edit_match_')) {
        const matchId = parseInt(data.replace('edit_match_', ''));
        
        if (!currentTournament || !currentTournament.active) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Нет активного турнира!' });
            return;
        }
        
        const match = currentTournament.matches.find(m => m.id === matchId);
        if (!match || !match.completed) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Матч еще не завершен!' });
            return;
        }
        
        userStates.set(userId, { action: 'editing_score', matchId: matchId });
        await bot.editMessageText(`✏️ Введи новый счет для матча:\n${match.player1} vs ${match.player2}\n\nТекущий: ${match.score1}:${match.score2}`, {
            chat_id: chatId,
            message_id: messageId
        });
        saveMessageId(chatId, messageId);
        
    } else if (data === 'cancel_record' || data === 'cancel_edit') {
        userStates.delete(userId);
        await bot.editMessageText('❌ Операция отменена', {
            chat_id: chatId,
            message_id: messageId
        });
    }
    
    await bot.answerCallbackQuery(callbackQuery.id);
});

// Обработка текстовых сообщений
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const userId = msg.from.id;
    
    const userState = userStates.get(userId);
    
    // Ввод счета
    if (userState && (userState.action === 'waiting_for_score' || userState.action === 'editing_score')) {
        const scoreRegex = /^(\d+)[:\s\-](\d+)$/;
        const match = scoreRegex.exec(text);
        
        if (!match) {
            const errorMsg = await bot.sendMessage(chatId, '❌ Неверный формат! Примеры: 2:1, 2 1, 2-1');
            saveMessageId(chatId, errorMsg.message_id);
            return;
        }
        
        const score1 = parseInt(match[1]);
        const score2 = parseInt(match[2]);
        
        const tournamentMatch = currentTournament.matches.find(m => m.id === userState.matchId);
        if (!tournamentMatch) {
            bot.sendMessage(chatId, '❌ Матч не найден!');
            userStates.delete(userId);
            return;
        }
        
        if (score1 === score2) {
            userStates.set(userId, { 
                action: 'waiting_for_penalty', 
                matchId: userState.matchId, 
                score1: score1, 
                score2: score2
            });
            
            const keyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: tournamentMatch.player1, callback_data: `penalty_${tournamentMatch.player1}` }],
                        [{ text: tournamentMatch.player2, callback_data: `penalty_${tournamentMatch.player2}` }]
                    ]
                }
            };
            
            const penaltyMsg = await bot.sendMessage(chatId, `⚽️ Ничья ${score1}:${score2}!\n\nКто победил по пенальти?`, keyboard);
            saveMessageId(chatId, penaltyMsg.message_id);
        } else {
            tournamentMatch.score1 = score1;
            tournamentMatch.score2 = score2;
            tournamentMatch.penalties = null;
            tournamentMatch.completed = true;
            
            // Записываем в глобальную статистику
            recordMatchToGlobalStats(tournamentMatch, currentTournament.participants, currentTournament.type);
            
            const resultMsg = await bot.sendMessage(chatId, `✅ Результат записан!\n\n${tournamentMatch.player1} ${score1}:${score2} ${tournamentMatch.player2}\n🏆 Победа в основное время`);
            saveMessageId(chatId, resultMsg.message_id);
            
            const stats = calculateStats(currentTournament.participants, currentTournament.matches);
            const standings = getStandingsTable(stats);
            const liveStatus = getLiveStatus(currentTournament.matches);
            
            const standingsMsg = await bot.sendMessage(chatId, standings, { parse_mode: 'HTML' });
            const statusMsg = await bot.sendMessage(chatId, liveStatus, { parse_mode: 'HTML' });
            saveMessageId(chatId, standingsMsg.message_id);
            saveMessageId(chatId, statusMsg.message_id);
            
            userStates.delete(userId);
            
            const allCompleted = currentTournament.matches.every(m => m.completed);
            if (allCompleted) {
                const completeMsg = await bot.sendMessage(chatId, '🏆 Все матчи сыграны! Нажми "🏆 Завершить".');
                saveMessageId(chatId, completeMsg.message_id);
            }
        }
        return;
    }
    
    // Добавление команды
    const userDialogState = userStates.get(userId);
    if (userDialogState && userDialogState.action === 'waiting_for_team_name') {
        if (text === '🔙 Отмена') {
            userStates.delete(userId);
            const isAdminUser = await isAdmin(chatId, userId);
            const cancelMsg = await bot.sendMessage(chatId, '❌ Отменено.', getMainKeyboard(isAdminUser, !!currentTournament));
            saveMessageId(chatId, cancelMsg.message_id);
            return;
        }
        
        const teams = loadTeams();
        if (teams.includes(text)) {
            const warnMsg = await bot.sendMessage(chatId, `⚠️ Команда "${text}" уже существует!`);
            saveMessageId(chatId, warnMsg.message_id);
            return;
        }
        
        teams.push(text);
        saveTeams(teams);
        userStates.delete(userId);
        const isAdminUser = await isAdmin(chatId, userId);
        const successMsg = await bot.sendMessage(chatId, `✅ Команда "${text}" добавлена!`, getMainKeyboard(isAdminUser, !!currentTournament));
        saveMessageId(chatId, successMsg.message_id);
        return;
    }
    
    // Удаление команды
    if (userDialogState && userDialogState.action === 'waiting_for_team_remove') {
        if (text === '🔙 Отмена') {
            userStates.delete(userId);
            const isAdminUser = await isAdmin(chatId, userId);
            const cancelMsg = await bot.sendMessage(chatId, '❌ Отменено.', getMainKeyboard(isAdminUser, !!currentTournament));
            saveMessageId(chatId, cancelMsg.message_id);
            return;
        }
        
        const teams = loadTeams();
        const index = teams.indexOf(text);
        
        if (index === -1) {
            const errorMsg = await bot.sendMessage(chatId, `❌ Команда "${text}" не найдена!`);
            saveMessageId(chatId, errorMsg.message_id);
            return;
        }
        
        teams.splice(index, 1);
        saveTeams(teams);
        userStates.delete(userId);
        const isAdminUser = await isAdmin(chatId, userId);
        const successMsg = await bot.sendMessage(chatId, `✅ Команда "${text}" удалена!`, getMainKeyboard(isAdminUser, !!currentTournament));
        saveMessageId(chatId, successMsg.message_id);
        return;
    }
    
    // Главное меню
    const isAdminUser = await isAdmin(chatId, userId);
    
    switch (text) {
        case '🏆 Новый турнир':
            if (currentTournament) {
                const warnMsg = await bot.sendMessage(chatId, '⚠️ Активный турнир уже идет!');
                saveMessageId(chatId, warnMsg.message_id);
                break;
            }
            tournamentMode.set(chatId, false);
            const tournamentMsg = await bot.sendMessage(chatId, 
                `👥 Выбери участников турнира (от 2 до 5 человек):\n\nРежим: ⚽ Клубный турнир\n\n(нажимай на имена для выбора)`,
                createTournamentSelectionKeyboard([], false)
            );
            saveMessageId(chatId, tournamentMsg.message_id);
            break;
            
        case '📋 Список команд':
            const teams = loadTeams();
            const nationalTeams = loadNationalTeams();
            
            let teamList = '<b>⚽ КЛУБЫ:</b>\n\n';
            if (teams.length === 0) {
                teamList += 'Список пуст.\n';
            } else {
                teams.forEach((team, index) => {
                    teamList += `${index + 1}. ${team}\n`;
                });
            }
            
            teamList += `\n<b>🌍 СБОРНЫЕ:</b>\n\n`;
            if (nationalTeams.length === 0) {
                teamList += 'Список пуст.\n';
            } else {
                nationalTeams.forEach((team, index) => {
                    teamList += `${index + 1}. ${team}\n`;
                });
            }
            
            const listMsg = await bot.sendMessage(chatId, teamList, { parse_mode: 'HTML' });
            saveMessageId(chatId, listMsg.message_id);
            break;
            
        case '📈 Общий рейтинг':
            const ratingTable = getGlobalRatingTable();
            const ratingMsg = await bot.sendMessage(chatId, ratingTable, { parse_mode: 'HTML' });
            saveMessageId(chatId, ratingMsg.message_id);
            break;
            
        case '✏️ Записать результат':
            if (!currentTournament) {
                const errorMsg = await bot.sendMessage(chatId, '❌ Нет активного турнира!');
                saveMessageId(chatId, errorMsg.message_id);
                break;
            }
            const incompleteMatches = currentTournament.matches.filter(m => !m.completed);
            if (incompleteMatches.length === 0) {
                const completeMsg = await bot.sendMessage(chatId, '✅ Все матчи уже сыграны!');
                saveMessageId(chatId, completeMsg.message_id);
                break;
            }
            const selectMatchMsg = await bot.sendMessage(chatId, '📝 Выбери матч:', 
                createMatchSelectionKeyboard(currentTournament.matches));
            saveMessageId(chatId, selectMatchMsg.message_id);
            break;
            
        case '📊 Таблица':
            if (!currentTournament) {
                const errorMsg = await bot.sendMessage(chatId, '❌ Нет активного турнира!');
                saveMessageId(chatId, errorMsg.message_id);
                break;
            }
            const stats = calculateStats(currentTournament.participants, currentTournament.matches);
            const standings = getStandingsTable(stats);
            const standingsMsg = await bot.sendMessage(chatId, standings, { parse_mode: 'HTML' });
            saveMessageId(chatId, standingsMsg.message_id);
            break;
            
        case '✏️ Редактировать':
            if (!currentTournament) {
                const errorMsg = await bot.sendMessage(chatId, '❌ Нет активного турнира!');
                saveMessageId(chatId, errorMsg.message_id);
                break;
            }
            const completedMatches = currentTournament.matches.filter(m => m.completed);
            if (completedMatches.length === 0) {
                const noMatchesMsg = await bot.sendMessage(chatId, '❌ Нет завершенных матчей!');
                saveMessageId(chatId, noMatchesMsg.message_id);
                break;
            }
            const editKeyboard = createEditMatchSelectionKeyboard(currentTournament.matches);
            if (editKeyboard) {
                const editMsg = await bot.sendMessage(chatId, '✏️ Выбери матч:', editKeyboard);
                saveMessageId(chatId, editMsg.message_id);
            }
            break;
            
        case '🏆 Завершить':
            if (!currentTournament) {
                const errorMsg = await bot.sendMessage(chatId, '❌ Нет активного турнира!');
                saveMessageId(chatId, errorMsg.message_id);
                break;
            }
            const allCompleted = currentTournament.matches.every(m => m.completed);
            if (!allCompleted) {
                const remaining = currentTournament.matches.filter(m => !m.completed).length;
                const warnMsg = await bot.sendMessage(chatId, `⚠️ Не все матчи сыграны! Осталось ${remaining}.`);
                saveMessageId(chatId, warnMsg.message_id);
                break;
            }
            
            await deleteTournamentMessages();
            
            const finalStats = calculateStats(currentTournament.participants, currentTournament.matches);
            const sorted = [...finalStats].sort((a, b) => {
                if (a.points !== b.points) return b.points - a.points;
                const diffA = a.goalsFor - a.goalsAgainst;
                const diffB = b.goalsFor - b.goalsAgainst;
                return diffB - diffA;
            });
            const winner = sorted[0];
            
            let finalMessage = `<b>🏆 ТУРНИР ЗАВЕРШЕН!</b>\n\n`;
            finalMessage += `<b>ПОБЕДИТЕЛЬ:</b> ${winner.name} (${winner.team}) — ${winner.points} очков\n\n`;
            finalMessage += `<b>ИТОГОВАЯ ТАБЛИЦА:</b>\n`;
            sorted.forEach((s, idx) => {
                const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '  ';
                finalMessage += `${medal} ${s.name} (${s.team}) — ${s.points} очков (голы: ${s.goalsFor}:${s.goalsAgainst})\n`;
            });
            
            finalMessage += `\n<b>📜 ВСЕ МАТЧИ:</b>\n`;
            currentTournament.matches.forEach(m => {
                if (m.penalties) {
                    finalMessage += `${m.player1} ${m.score1}:${m.score2} ${m.player2} — пен. поб. ${m.penalties}\n`;
                } else {
                    finalMessage += `${m.player1} ${m.score1}:${m.score2} ${m.player2}\n`;
                }
            });
            
            await bot.sendMessage(chatId, finalMessage, { parse_mode: 'HTML' });
            
            currentTournament = null;
            const endMsg = await bot.sendMessage(chatId, '✅ Турнир завершен!', getMainKeyboard(isAdminUser, false));
            saveMessageId(chatId, endMsg.message_id);
            break;
            
        case '⚠️ Прервать турнир':
            if (!currentTournament) {
                const errorMsg = await bot.sendMessage(chatId, '❌ Нет активного турнира!');
                saveMessageId(chatId, errorMsg.message_id);
                break;
            }
            
            await deleteTournamentMessages();
            
            currentTournament = null;
            const cancelMsg = await bot.sendMessage(chatId, '⚠️ Турнир прерван!', getMainKeyboard(isAdminUser, false));
            saveMessageId(chatId, cancelMsg.message_id);
            break;
            
        case '➕ Добавить команду':
            if (!isAdminUser) {
                const errorMsg = await bot.sendMessage(chatId, '⛔️ Только для админов!');
                saveMessageId(chatId, errorMsg.message_id);
                break;
            }
            const addMsg = await bot.sendMessage(chatId, '✏️ Введи название команды:\n\n(нажми "🔙 Отмена")',
                { reply_markup: { keyboard: [['🔙 Отмена']], resize_keyboard: true } }
            );
            saveMessageId(chatId, addMsg.message_id);
            userStates.set(userId, { action: 'waiting_for_team_name' });
            break;
            
        case '❌ Удалить команду':
            if (!isAdminUser) {
                const errorMsg = await bot.sendMessage(chatId, '⛔️ Только для админов!');
                saveMessageId(chatId, errorMsg.message_id);
                break;
            }
            const teamsList = loadTeams();
            if (teamsList.length === 0) {
                const emptyMsg = await bot.sendMessage(chatId, '📋 Список пуст.');
                saveMessageId(chatId, emptyMsg.message_id);
                break;
            }
            
            const teamButtons = teamsList.map(team => [{ text: team }]);
            teamButtons.push([{ text: '🔙 Отмена' }]);
            
            const deleteMsg = await bot.sendMessage(chatId, '❌ Выбери команду:', {
                reply_markup: {
                    keyboard: teamButtons,
                    resize_keyboard: true
                }
            });
            saveMessageId(chatId, deleteMsg.message_id);
            userStates.set(userId, { action: 'waiting_for_team_remove' });
            break;
            
        case '❓ Помощь':
            const helpMessage = currentTournament ?
                `<b>🎯 ТУРНИРНЫЙ РЕЖИМ (активен)</b>\n\n
<b>✏️ Записать результат</b> — ввести счет матча\n
<b>📊 Таблица</b> — турнирная таблица\n
<b>✏️ Редактировать</b> — изменить результат\n
<b>🏆 Завершить</b> — подвести итоги\n
<b>⚠️ Прервать турнир</b> — отменить турнир\n\n
<b>Система очков:</b>\n
• Победа в основное время — 2 очка\n
• Победа по пенальти — 2 очка победителю, 1 очко проигравшему\n
• Ничья — 1 очко каждому` :
                `<b>🎯 Турнирный бот</b>\n\n
<b>Основные команды:</b>\n
• 🏆 Новый турнир — создать турнир с жеребьевкой\n
• 📋 Список команд — все клубы и сборные\n
• 📈 Общий рейтинг — статистика всех игроков за всё время\n\n
<b>Для админов:</b>\n
• ➕ Добавить команду\n
• ❌ Удалить команду\n\n
<b>Режимы:</b>\n
• ⚽ Клубный турнир\n
• 🌍 ЧЕМПИОНАТ МИРА (сборные)`;
            
            const helpMsg = await bot.sendMessage(chatId, helpMessage, { parse_mode: 'HTML', ...getMainKeyboard(isAdminUser, !!currentTournament) });
            saveMessageId(chatId, helpMsg.message_id);
            break;
            
        case '🔙 Отмена':
            userStates.delete(userId);
            const backMsg = await bot.sendMessage(chatId, '⬅️ Главное меню', getMainKeyboard(isAdminUser, !!currentTournament));
            saveMessageId(chatId, backMsg.message_id);
            break;

        default:
            if (text && !text.startsWith('/')) {}
            break;
    }
});

// Обработка callback для пенальти
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;
    
    if (data.startsWith('penalty_')) {
        const winner = data.replace('penalty_', '');
        
        const userState = userStates.get(userId);
        if (!userState || userState.action !== 'waiting_for_penalty') {
            await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Сессия истекла!' });
            return;
        }
        
        const match = currentTournament.matches.find(m => m.id === userState.matchId);
        if (!match) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Матч не найден!' });
            return;
        }
        
        match.score1 = userState.score1;
        match.score2 = userState.score2;
        match.penalties = winner;
        match.completed = true;
        
        // Записываем в глобальную статистику
        recordMatchToGlobalStats(match, currentTournament.participants, currentTournament.type);
        
        await bot.editMessageText(`✅ Результат записан!\n\n${match.player1} ${userState.score1}:${userState.score2} ${match.player2}\n⚽️ Ничья!\n🏆 Победа по пенальти: ${winner}`, {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id
        });
        
        const stats = calculateStats(currentTournament.participants, currentTournament.matches);
        const standings = getStandingsTable(stats);
        const liveStatus = getLiveStatus(currentTournament.matches);
        
        const standingsMsg = await bot.sendMessage(chatId, standings, { parse_mode: 'HTML' });
        const statusMsg = await bot.sendMessage(chatId, liveStatus, { parse_mode: 'HTML' });
        saveMessageId(chatId, standingsMsg.message_id);
        saveMessageId(chatId, statusMsg.message_id);
        
        userStates.delete(userId);
        
        const allCompleted = currentTournament.matches.every(m => m.completed);
        if (allCompleted) {
            const completeMsg = await bot.sendMessage(chatId, '🏆 Все матчи сыграны! Нажми "🏆 Завершить".');
            saveMessageId(chatId, completeMsg.message_id);
        }
        
        await bot.answerCallbackQuery(callbackQuery.id);
    }
});

// Обработка команды /list_teams
bot.onText(/\/list_teams/, async (msg) => {
    const chatId = msg.chat.id;
    const teams = loadTeams();
    const nationalTeams = loadNationalTeams();
    
    let teamList = '<b>⚽ КЛУБЫ:</b>\n\n';
    teams.forEach((team, index) => {
        teamList += `${index + 1}. ${team}\n`;
    });
    
    teamList += `\n<b>🌍 СБОРНЫЕ:</b>\n\n`;
    nationalTeams.forEach((team, index) => {
        teamList += `${index + 1}. ${team}\n`;
    });
    
    const listMsg = await bot.sendMessage(chatId, teamList, { parse_mode: 'HTML' });
    saveMessageId(chatId, listMsg.message_id);
});

// Обработка ошибок
bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

console.log('🤖 Бот запущен!');
