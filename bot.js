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

// Хранилище состояний
const userStates = new Map();
const selectedParticipants = new Map();

// Текущий активный турнир
let currentTournament = null;

// Список известных участников
const KNOWN_PARTICIPANTS = [
    { id: 'vladimir', name: 'Владимир', username: 'antsn21' },
    { id: 'nuriman', name: 'Нуриман', username: 'bnm11' },
    { id: 'nikita', name: 'Никита', username: 'NadezhinN' },
    { id: 'stanislav', name: 'Станислав', username: 'stas_0297' }
];

// Загрузка списка команд
function loadTeams() {
    try {
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

// Подсчет статистики участников на основе завершенных матчей
function calculateStats(participants, matches) {
    const stats = {};
    
    // Инициализация статистики
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
    
    // Подсчет по матчам
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
            // Победа/поражение по пенальти
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
            // Победа в основное время
            p1.wins++;
            p2.losses++;
            p1.points += 2;
            p2.points += 0;
        } else if (match.score2 > match.score1) {
            p2.wins++;
            p1.losses++;
            p2.points += 2;
            p1.points += 0;
        } else {
            // Ничья без пенальти
            p1.draws++;
            p2.draws++;
            p1.points += 1;
            p2.points += 1;
        }
    });
    
    return Object.values(stats);
}

// Получение турнирной таблицы
function getStandingsTable(stats) {
    // Сортировка: по очкам, затем по разнице голов, затем по забитым
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

// Получение Live-статуса
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

// Главное меню (убрана кнопка Жеребьевка)
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
        [{ text: '❓ Помощь' }]
    ];
    
    if (isAdminUser) {
        keyboard.push([{ text: '➕ Добавить команду' }, { text: '❌ Удалить команду' }]);
    }
    
    return { reply_markup: { keyboard: keyboard, resize_keyboard: true, persistent: true } };
}

// Клавиатура выбора участников турнира
function createTournamentSelectionKeyboard(userId, selectedIds = []) {
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
    
    if (completedMatches.length === 0) {
        return null;
    }
    
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
            '🎯 *Добро пожаловать в Турнирного бота!*\n\nИспользуй кнопки ниже для управления.\n\nИзвестные участники: Владимир, Нуриман, Никита, Станислав',
            { parse_mode: 'Markdown', ...getMainKeyboard(isAdminUser, !!currentTournament) }
        );
    });
});

// Обработка callback-запросов (inline кнопки)
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;
    const messageId = callbackQuery.message.message_id;
    
    // Создание турнира - выбор участников
    if (data.startsWith('tournament_toggle_')) {
        const participantId = data.replace('tournament_toggle_', '');
        
        const selectionKey = `tournament_${chatId}`;
        let selected = selectedParticipants.get(selectionKey) || [];
        
        const participant = KNOWN_PARTICIPANTS.find(p => p.id === participantId);
        
        if (selected.includes(participantId)) {
            selected = selected.filter(id => id !== participantId);
            await bot.answerCallbackQuery(callbackQuery.id, { text: `❌ Убран: ${participant.name}` });
        } else {
            if (selected.length >= 4) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: '⚠️ Максимум 4 участника в турнире!' });
                return;
            }
            selected.push(participantId);
            await bot.answerCallbackQuery(callbackQuery.id, { text: `✅ Добавлен: ${participant.name}` });
        }
        
        selectedParticipants.set(selectionKey, selected);
        
        const selectedNames = selected.map(id => {
            const p = KNOWN_PARTICIPANTS.find(part => part.id === id);
            return p ? p.name : id;
        });
        
        const statusText = selected.length > 0 
            ? `👥 Выбрано участников: ${selected.length}\n\n✅ ${selectedNames.join(', ')}\n\n━━━━━━━━━━━━━━━━━\nНажми "🎲 Начать турнир" для жеребьевки команд и создания расписания.` 
            : `👥 Выбери участников турнира (от 2 до 4 человек):\n\n(просто нажимай на имена, чтобы выбрать/отменить)`;
        
        await bot.editMessageText(statusText, {
            chat_id: chatId,
            message_id: messageId,
            ...createTournamentSelectionKeyboard(userId, selected)
        });
        
    } else if (data === 'tournament_start') {
        const selectionKey = `tournament_${chatId}`;
        const selected = selectedParticipants.get(selectionKey) || [];
        
        if (selected.length < 2) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: '⚠️ Выбери минимум 2 участника для турнира!' });
            return;
        }
        
        // Загружаем команды и проводим жеребьевку
        const teams = loadTeams();
        if (teams.length < selected.length) {
            await bot.editMessageText(`❌ Недостаточно команд! Нужно: ${selected.length}, доступно: ${teams.length}. Добавь команды через меню админа.`, {
                chat_id: chatId,
                message_id: messageId
            });
            selectedParticipants.delete(selectionKey);
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
        
        // Генерируем расписание
        const matches = generateSchedule(participants);
        
        // Сохраняем турнир
        currentTournament = {
            active: true,
            participants: participants,
            matches: matches,
            createdAt: new Date().toISOString()
        };
        
        // Формируем сообщение о старте турнира
        let drawMessage = '<b>🎲 Жеребьевка команд для турнира:</b>\n\n';
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
        
        selectedParticipants.delete(selectionKey);
        
        const isAdminUser = await isAdmin(chatId, userId);
        bot.sendMessage(chatId, '✅ Турнир создан! Используй кнопки для управления.', 
            getMainKeyboard(isAdminUser, true));
        
    } else if (data === 'tournament_cancel') {
        const selectionKey = `tournament_${chatId}`;
        selectedParticipants.delete(selectionKey);
        
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
            await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Этот матч уже завершен!' });
            return;
        }
        
        userStates.set(userId, { action: 'waiting_for_score', matchId: matchId });
        await bot.editMessageText(`📝 Введи счет основного времени для матча:\n${match.player1} vs ${match.player2}\n\nПример: 2:1 или 0:0`, {
            chat_id: chatId,
            message_id: messageId
        });
        
    } else if (data.startsWith('edit_match_')) {
        const matchId = parseInt(data.replace('edit_match_', ''));
        
        if (!currentTournament || !currentTournament.active) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Нет активного турнира!' });
            return;
        }
        
        const match = currentTournament.matches.find(m => m.id === matchId);
        if (!match || !match.completed) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Этот матч еще не завершен!' });
            return;
        }
        
        userStates.set(userId, { action: 'editing_score', matchId: matchId });
        await bot.editMessageText(`✏️ Введи новый счет основного времени для матча:\n${match.player1} vs ${match.player2}\n\nТекущий счет: ${match.score1}:${match.score2}\n\nПример: 2:1 или 0:0`, {
            chat_id: chatId,
            message_id: messageId
        });
        
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
    
    // Обработка ввода счета для матча
    if (userState && (userState.action === 'waiting_for_score' || userState.action === 'editing_score')) {
        const scoreRegex = /^(\d+):(\d+)$/;
        const match = scoreRegex.exec(text);
        
        if (!match) {
            bot.sendMessage(chatId, '❌ Неверный формат! Введи счет как ЧИСЛО:ЧИСЛО, например 2:1 или 0:0');
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
            // Ничья - спрашиваем победителя пенальти
            userStates.set(userId, { 
                action: 'waiting_for_penalty', 
                matchId: userState.matchId, 
                score1: score1, 
                score2: score2,
                isEditing: userState.action === 'editing_score'
            });
            
            const keyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: tournamentMatch.player1, callback_data: `penalty_${tournamentMatch.player1}` }],
                        [{ text: tournamentMatch.player2, callback_data: `penalty_${tournamentMatch.player2}` }]
                    ]
                }
            };
            
            bot.sendMessage(chatId, `⚽️ Ничья ${score1}:${score2} в основное время!\n\nКто победил по пенальти?`, keyboard);
        } else {
            // Победа в основное время
            tournamentMatch.score1 = score1;
            tournamentMatch.score2 = score2;
            tournamentMatch.penalties = null;
            tournamentMatch.completed = true;
            
            bot.sendMessage(chatId, `✅ Результат записан!\n\n${tournamentMatch.player1} ${score1}:${score2} ${tournamentMatch.player2}\n🏆 Победа в основное время`);
            
            // Показываем обновленную таблицу
            const stats = calculateStats(currentTournament.participants, currentTournament.matches);
            const standings = getStandingsTable(stats);
            const liveStatus = getLiveStatus(currentTournament.matches);
            
            bot.sendMessage(chatId, standings, { parse_mode: 'HTML' });
            bot.sendMessage(chatId, liveStatus, { parse_mode: 'HTML' });
            
            userStates.delete(userId);
            
            // Проверяем, завершен ли турнир
            const allCompleted = currentTournament.matches.every(m => m.completed);
            if (allCompleted) {
                bot.sendMessage(chatId, '🏆 Все матчи сыграны! Нажми "🏆 Завершить" для подведения итогов.');
            }
        }
        return;
    }
    
    // Обработка диалога добавления команды
    const userDialogState = userStates.get(userId);
    if (userDialogState && userDialogState.action === 'waiting_for_team_name') {
        if (text === '🔙 Отмена') {
            userStates.delete(userId);
            const isAdminUser = await isAdmin(chatId, userId);
            bot.sendMessage(chatId, '❌ Добавление команды отменено.', getMainKeyboard(isAdminUser, !!currentTournament));
            return;
        }
        
        const teams = loadTeams();
        if (teams.includes(text)) {
            bot.sendMessage(chatId, `⚠️ Команда "${text}" уже существует!`);
            return;
        }
        
        teams.push(text);
        saveTeams(teams);
        userStates.delete(userId);
        const isAdminUser = await isAdmin(chatId, userId);
        bot.sendMessage(chatId, `✅ Команда "${text}" успешно добавлена!`, getMainKeyboard(isAdminUser, !!currentTournament));
        return;
    }
    
    // Обработка диалога удаления команды
    if (userDialogState && userDialogState.action === 'waiting_for_team_remove') {
        if (text === '🔙 Отмена') {
            userStates.delete(userId);
            const isAdminUser = await isAdmin(chatId, userId);
            bot.sendMessage(chatId, '❌ Удаление команды отменено.', getMainKeyboard(isAdminUser, !!currentTournament));
            return;
        }
        
        const teams = loadTeams();
        const index = teams.indexOf(text);
        
        if (index === -1) {
            bot.sendMessage(chatId, `❌ Команда "${text}" не найдена в списке!`);
            return;
        }
        
        teams.splice(index, 1);
        saveTeams(teams);
        userStates.delete(userId);
        const isAdminUser = await isAdmin(chatId, userId);
        bot.sendMessage(chatId, `✅ Команда "${text}" успешно удалена!`, getMainKeyboard(isAdminUser, !!currentTournament));
        return;
    }
    
    // Обработка кнопок главного меню
    const isAdminUser = await isAdmin(chatId, userId);
    
    switch (text) {
        case '🏆 Новый турнир':
            if (currentTournament) {
                bot.sendMessage(chatId, '⚠️ Активный турнир уже идет! Сначала заверши или прерви его.');
                break;
            }
            bot.sendMessage(chatId, 
                `👥 Выбери участников турнира (от 2 до 4 человек):\n\n(просто нажимай на имена, чтобы выбрать/отменить)`,
                createTournamentSelectionKeyboard(userId, [])
            );
            break;
            
        case '📋 Список команд':
            const teams = loadTeams();
            if (teams.length === 0) {
                bot.sendMessage(chatId, '📋 Список команд пуст. Добавь команды через меню админа.');
            } else {
                let teamList = '<b>📋 Список команд:</b>\n\n';
                teams.forEach((team, index) => {
                    teamList += `${index + 1}. ${team}\n`;
                });
                bot.sendMessage(chatId, teamList, { parse_mode: 'HTML' });
            }
            break;
            
        case '✏️ Записать результат':
            if (!currentTournament) {
                bot.sendMessage(chatId, '❌ Нет активного турнира! Начни новый через "🏆 Новый турнир"');
                break;
            }
            const incompleteMatches = currentTournament.matches.filter(m => !m.completed);
            if (incompleteMatches.length === 0) {
                bot.sendMessage(chatId, '✅ Все матчи уже сыграны! Нажми "🏆 Завершить" для подведения итогов.');
                break;
            }
            bot.sendMessage(chatId, '📝 Выбери матч для записи результата:', 
                createMatchSelectionKeyboard(currentTournament.matches));
            break;
            
        case '📊 Таблица':
            if (!currentTournament) {
                bot.sendMessage(chatId, '❌ Нет активного турнира! Начни новый через "🏆 Новый турнир"');
                break;
            }
            const stats = calculateStats(currentTournament.participants, currentTournament.matches);
            const standings = getStandingsTable(stats);
            bot.sendMessage(chatId, standings, { parse_mode: 'HTML' });
            break;
            
        case '✏️ Редактировать':
            if (!currentTournament) {
                bot.sendMessage(chatId, '❌ Нет активного турнира!');
                break;
            }
            const completedMatches = currentTournament.matches.filter(m => m.completed);
            if (completedMatches.length === 0) {
                bot.sendMessage(chatId, '❌ Нет завершенных матчей для редактирования!');
                break;
            }
            const editKeyboard = createEditMatchSelectionKeyboard(currentTournament.matches);
            if (editKeyboard) {
                bot.sendMessage(chatId, '✏️ Выбери матч для редактирования:', editKeyboard);
            }
            break;
            
        case '🏆 Завершить':
            if (!currentTournament) {
                bot.sendMessage(chatId, '❌ Нет активного турнира!');
                break;
            }
            const allCompleted = currentTournament.matches.every(m => m.completed);
            if (!allCompleted) {
                const remaining = currentTournament.matches.filter(m => !m.completed).length;
                bot.sendMessage(chatId, `⚠️ Не все матчи сыграны! Осталось ${remaining} матчей. Запиши результаты или прерви турнир.`);
                break;
            }
            
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
            
            bot.sendMessage(chatId, finalMessage, { parse_mode: 'HTML' });
            
            currentTournament = null;
            bot.sendMessage(chatId, '✅ Турнир завершен! Можешь начать новый.', getMainKeyboard(isAdminUser, false));
            break;
            
        case '⚠️ Прервать турнир':
            if (!currentTournament) {
                bot.sendMessage(chatId, '❌ Нет активного турнира!');
                break;
            }
            currentTournament = null;
            bot.sendMessage(chatId, '⚠️ Турнир прерван! Все данные потеряны.', getMainKeyboard(isAdminUser, false));
            break;
            
        case '➕ Добавить команду':
            if (!isAdminUser) {
                bot.sendMessage(chatId, '⛔️ Только администраторы чата могут добавлять команды');
                break;
            }
            bot.sendMessage(chatId, '✏️ Введи название команды для добавления:\n\n(нажми "🔙 Отмена" для отмены)',
                { reply_markup: { keyboard: [['🔙 Отмена']], resize_keyboard: true } }
            );
            userStates.set(userId, { action: 'waiting_for_team_name' });
            break;
            
        case '❌ Удалить команду':
            if (!isAdminUser) {
                bot.sendMessage(chatId, '⛔️ Только администраторы чата могут удалять команды');
                break;
            }
            const teamsList = loadTeams();
            if (teamsList.length === 0) {
                bot.sendMessage(chatId, '📋 Список команд пуст. Нечего удалять.');
                break;
            }
            
            const teamButtons = teamsList.map(team => [{ text: team }]);
            teamButtons.push([{ text: '🔙 Отмена' }]);
            
            bot.sendMessage(chatId, '❌ Выбери команду для удаления:', {
                reply_markup: {
                    keyboard: teamButtons,
                    resize_keyboard: true
                }
            });
            userStates.set(userId, { action: 'waiting_for_team_remove' });
            break;
            
        case '❓ Помощь':
            const helpMessage = currentTournament ?
                `<b>🎯 ТУРНИРНЫЙ РЕЖИМ (активен)</b>\n\n
<b>✏️ Записать результат</b> — ввести счет сыгранного матча\n
<b>📊 Таблица</b> — текущая турнирная таблица\n
<b>✏️ Редактировать</b> — изменить результат матча\n
<b>🏆 Завершить</b> — подвести итоги и завершить турнир\n
<b>⚠️ Прервать турнир</b> — отменить турнир без сохранения\n\n
<b>Система очков:</b>\n
• Победа в основное время — 2 очка\n
• Победа по пенальти — 2 очка победителю, 1 очко проигравшему\n
• Ничья — 1 очко каждому` :
                `<b>🎯 Турнирный бот</b>\n\n
<b>Основные команды:</b>\n
• 🏆 Новый турнир — создать турнир "каждый с каждым" с автоматической жеребьевкой команд\n
• 📋 Список команд — показать все доступные команды\n\n
<b>Для админов чата:</b>\n
• ➕ Добавить команду\n
• ❌ Удалить команду\n\n
<b>В турнире:</b>\n
• Каждый играет с каждым 1 раз\n
• За победу — 2 очка, за ничью — 1\n
• При ничьей в основное время — серия пенальти (победитель получает 2, проигравший 1)`;
            
            bot.sendMessage(chatId, helpMessage, { parse_mode: 'HTML', ...getMainKeyboard(isAdminUser, !!currentTournament) });
            break;
            
        case '🔙 Отмена':
            userStates.delete(userId);
            bot.sendMessage(chatId, '⬅️ Возврат в главное меню', getMainKeyboard(isAdminUser, !!currentTournament));
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
            await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Сессия истекла, начни заново!' });
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
        
        await bot.editMessageText(`✅ Результат записан!\n\n${match.player1} ${userState.score1}:${userState.score2} ${match.player2}\n⚽️ Ничья в основное время!\n🏆 Победа по пенальти: ${winner}`, {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id
        });
        
        // Показываем обновленную таблицу
        const stats = calculateStats(currentTournament.participants, currentTournament.matches);
        const standings = getStandingsTable(stats);
        const liveStatus = getLiveStatus(currentTournament.matches);
        
        bot.sendMessage(chatId, standings, { parse_mode: 'HTML' });
        bot.sendMessage(chatId, liveStatus, { parse_mode: 'HTML' });
        
        userStates.delete(userId);
        
        // Проверяем, завершен ли турнир
        const allCompleted = currentTournament.matches.every(m => m.completed);
        if (allCompleted) {
            bot.sendMessage(chatId, '🏆 Все матчи сыграны! Нажми "🏆 Завершить" для подведения итогов.');
        }
        
        await bot.answerCallbackQuery(callbackQuery.id);
    }
});

// Обработка команды /list_teams для обратной совместимости
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

// Обработка ошибок
bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

console.log('🤖 Бот запущен!');
