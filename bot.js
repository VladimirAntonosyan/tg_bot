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

// Хранилище временных состояний для диалогов
const userStates = new Map();
// Хранилище выбранных участников
const selectedParticipants = new Map();

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

// Список заранее известных участников (можно редактировать)
const KNOWN_PARTICIPANTS = [
    { id: 'vladimir', name: 'Владимир', username: 'antsn21' },
    { id: 'nuriman', name: 'Нуриман', username: 'bnm11' },
    { id: 'nikita', name: 'Никита', username: 'NadezhinN' },
    { id: 'stanislav', name: 'Станислав', username: 'stas_0297' }
];

// Главное меню с кнопками
function getMainKeyboard(isAdminUser = false) {
    const keyboard = [
        [{ text: '🎲 Жеребьевка' }, { text: '📋 Список команд' }]
    ];
    
    if (isAdminUser) {
        keyboard.push([{ text: '➕ Добавить команду' }, { text: '❌ Удалить команду' }]);
    }
    
    keyboard.push([{ text: '❓ Помощь' }]);
    
    return {
        reply_markup: {
            keyboard: keyboard,
            resize_keyboard: true,
            persistent: true
        }
    };
}

// Функция для создания inline-кнопок выбора участников из известного списка
function createParticipantsSelectionKeyboard(userId, selectedIds = []) {
    const inlineKeyboard = [];
    let row = [];
    
    for (const participant of KNOWN_PARTICIPANTS) {
        const isSelected = selectedIds.includes(participant.id);
        const buttonText = isSelected ? `✅ ${participant.name}` : `⬜️ ${participant.name}`;
        const callbackData = `toggle_${participant.id}_${userId}`;
        
        row.push({ text: buttonText, callback_data: callbackData });
        
        if (row.length === 2) {
            inlineKeyboard.push(row);
            row = [];
        }
    }
    
    if (row.length > 0) {
        inlineKeyboard.push(row);
    }
    
    // Добавляем кнопки управления
    inlineKeyboard.push([{ text: '🎲 Провести жеребьевку', callback_data: `perform_draw_${userId}` }]);
    inlineKeyboard.push([{ text: '❌ Отмена', callback_data: `cancel_draw_${userId}` }]);
    
    return {
        reply_markup: {
            inline_keyboard: inlineKeyboard
        }
    };
}

// Команда /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    isAdmin(chatId, userId).then(isAdminUser => {
        bot.sendMessage(chatId, 
            '🎯 *Добро пожаловать в Турнирного бота!*\n\nИспользуй кнопки ниже для управления.\n\nИзвестные участники: Владимир, Нуриман, Никита, Станислав',
            { parse_mode: 'Markdown', ...getMainKeyboard(isAdminUser) }
        );
    });
});

// Обработка inline-кнопок (выбор участников и жеребьевка)
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;
    const messageId = callbackQuery.message.message_id;
    
    if (data.startsWith('toggle_')) {
        const parts = data.split('_');
        const participantId = parts[1];
        const requesterId = parseInt(parts[2]);
        
        // Проверяем, что выбор делает тот же пользователь
        if (userId !== requesterId) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Только инициатор жеребьевки может выбирать участников!' });
            return;
        }
        
        // Получаем текущий список выбранных
        const selectionKey = `draw_${requesterId}`;
        let selected = selectedParticipants.get(selectionKey) || [];
        
        // Находим имя участника
        const participant = KNOWN_PARTICIPANTS.find(p => p.id === participantId);
        
        if (selected.includes(participantId)) {
            // Убираем из выбранных
            selected = selected.filter(id => id !== participantId);
            await bot.answerCallbackQuery(callbackQuery.id, { text: `❌ Убран: ${participant.name}` });
        } else {
            // Добавляем
            selected.push(participantId);
            await bot.answerCallbackQuery(callbackQuery.id, { text: `✅ Добавлен: ${participant.name}` });
        }
        
        selectedParticipants.set(selectionKey, selected);
        
        // Обновляем сообщение с выбранными
        const selectedNames = selected.map(id => {
            const p = KNOWN_PARTICIPANTS.find(part => part.id === id);
            return p ? p.name : id;
        });
        
        const statusText = selected.length > 0 
            ? `👥 Выбрано участников: ${selected.length}\n\n✅ Выбранные: ${selectedNames.join(', ')}\n\n━━━━━━━━━━━━━━━━━\nНажми на имя еще раз, чтобы отменить выбор.\n\nКогда готов(а) — нажми "🎲 Провести жеребьевку"` 
            : `👥 Выбери участников для жеребьевки (от 1 до 4):\n\n(просто нажимай на имена, чтобы выбрать/отменить)`;
        
        await bot.editMessageText(statusText, {
            chat_id: chatId,
            message_id: messageId,
            ...createParticipantsSelectionKeyboard(requesterId, selected)
        });
        
    } else if (data.startsWith('perform_draw_')) {
        const requesterId = parseInt(data.split('_')[2]);
        
        if (userId !== requesterId) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Только инициатор может провести жеребьевку!' });
            return;
        }
        
        const selectionKey = `draw_${requesterId}`;
        const selected = selectedParticipants.get(selectionKey) || [];
        
        if (selected.length === 0) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: '⚠️ Выбери хотя бы одного участника для жеребьевки!' });
            return;
        }
        
        if (selected.length > 4) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: '⚠️ Можно выбрать не более 4 участников!' });
            return;
        }
        
        // Получаем имена выбранных участников
        const participantNames = selected.map(id => {
            const p = KNOWN_PARTICIPANTS.find(part => part.id === id);
            return p ? p.name : id;
        });
        
        // Проводим жеребьевку
        const teams = loadTeams();
        if (teams.length < participantNames.length) {
            await bot.editMessageText(`❌ Недостаточно команд! Нужно: ${participantNames.length}, доступно: ${teams.length}. Добавь команды через меню админа.`, {
                chat_id: chatId,
                message_id: messageId
            });
            selectedParticipants.delete(selectionKey);
            return;
        }
        
        const shuffledTeams = shuffleArray(teams);
        const assignments = participantNames.map((name, index) => ({
            name,
            team: shuffledTeams[index % shuffledTeams.length]
        }));
        
        let resultMessage = '<b>🎲 Результаты жеребьевки:</b>\n\n';
        assignments.forEach(assignment => {
            resultMessage += `👤 ${assignment.name}\n⚽️ <b>${assignment.team}</b>\n\n`;
        });
        
        await bot.editMessageText(resultMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML'
        });
        
        // Очищаем состояние
        selectedParticipants.delete(selectionKey);
        
        // Возвращаем главное меню
        const isAdminUser = await isAdmin(chatId, requesterId);
        bot.sendMessage(chatId, '✅ Жеребьевка завершена!', getMainKeyboard(isAdminUser));
        
    } else if (data.startsWith('cancel_draw_')) {
        const requesterId = parseInt(data.split('_')[2]);
        
        if (userId !== requesterId) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Только инициатор может отменить жеребьевку!' });
            return;
        }
        
        const selectionKey = `draw_${requesterId}`;
        selectedParticipants.delete(selectionKey);
        
        await bot.editMessageText('❌ Жеребьевка отменена', {
            chat_id: chatId,
            message_id: messageId
        });
        
        const isAdminUser = await isAdmin(chatId, requesterId);
        bot.sendMessage(chatId, 'Возврат в главное меню', getMainKeyboard(isAdminUser));
    }
    
    await bot.answerCallbackQuery(callbackQuery.id);
});

// Обработка текстовых сообщений (кнопок)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const userId = msg.from.id;
    
    // Проверяем, находится ли пользователь в диалоге
    const userState = userStates.get(userId);
    
    // Обработка диалога добавления команды
    if (userState && userState.action === 'waiting_for_team_name') {
        if (text === '🔙 Отмена') {
            userStates.delete(userId);
            const isAdminUser = await isAdmin(chatId, userId);
            bot.sendMessage(chatId, '❌ Добавление команды отменено.', getMainKeyboard(isAdminUser));
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
        bot.sendMessage(chatId, `✅ Команда "${text}" успешно добавлена!`, getMainKeyboard(isAdminUser));
        return;
    }
    
    // Обработка диалога удаления команды
    if (userState && userState.action === 'waiting_for_team_remove') {
        if (text === '🔙 Отмена') {
            userStates.delete(userId);
            const isAdminUser = await isAdmin(chatId, userId);
            bot.sendMessage(chatId, '❌ Удаление команды отменено.', getMainKeyboard(isAdminUser));
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
        bot.sendMessage(chatId, `✅ Команда "${text}" успешно удалена!`, getMainKeyboard(isAdminUser));
        return;
    }
    
    // Обработка кнопок главного меню
    const isAdminUser = await isAdmin(chatId, userId);
    
    switch (text) {
        case '🎲 Жеребьевка':
            // Показываем inline-кнопки для выбора участников
            bot.sendMessage(chatId, 
                `👥 Выбери участников для жеребьевки:\n\n(просто нажимай на имена, чтобы выбрать/отменить)\n\nМожно выбрать от 1 до 4 участников.`,
                createParticipantsSelectionKeyboard(userId, [])
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
            const helpMessage = `
🎯 <b>Турнирный бот</b>

<b>Основные команды:</b>
• 🎲 Жеребьевка - выбрать участников и распределить команды
• 📋 Список команд - показать все доступные команды

<b>Как работает жеребьевка:</b>
1. Нажми "🎲 Жеребьевка"
2. Выбери участников из списка
3. Нажми "🎲 Провести жеребьевку"
4. Бот распределит команды!

<b>Известные участники:</b>
Владимир, Нуриман, Никита, Станислав
            `;
            bot.sendMessage(chatId, helpMessage, { parse_mode: 'HTML', ...getMainKeyboard(isAdminUser) });
            break;
            
        case '🔙 Отмена':
            userStates.delete(userId);
            bot.sendMessage(chatId, '⬅️ Возврат в главное меню', getMainKeyboard(isAdminUser));
            break;
            
        default:
            if (!text.startsWith('/')) {
                // Игнорируем обычные сообщения
            }
            break;
    }
});

// Обработка команды /draw через текстовый ввод (оставляем для обратной совместимости)
bot.onText(/\/draw(@\w+)?(\s+@\w+)*/, async (msg) => {
    const chatId = msg.chat.id;
    const messageText = msg.text;
    
    const mentionRegex = /@(\w+)/g;
    const mentions = [];
    let mentionMatch;
    
    while ((mentionMatch = mentionRegex.exec(messageText)) !== null) {
        mentions.push(mentionMatch[1]);
    }
    
    if (mentions.length === 0) {
        bot.sendMessage(chatId, '❌ Укажи участников после команды. Пример: /draw @vladimir @nuriman');
        return;
    }
    
    const teams = loadTeams();
    if (teams.length < mentions.length) {
        bot.sendMessage(chatId, `❌ Недостаточно команд! Нужно: ${mentions.length}, доступно: ${teams.length}. Добавь команды через /add_team`);
        return;
    }
    
    const shuffledTeams = shuffleArray(teams);
    const assignments = mentions.map((username, index) => ({
        username,
        team: shuffledTeams[index % shuffledTeams.length]
    }));
    
    let resultMessage = '<b>🎲 Результаты жеребьевки:</b>\n\n';
    assignments.forEach(assignment => {
        resultMessage += `👤 @${assignment.username}\n⚽️ <b>${assignment.team}</b>\n\n`;
    });
    
    bot.sendMessage(chatId, resultMessage, { parse_mode: 'HTML' });
});

// Команда /list_teams (оставляем для обратной совместимости)
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
