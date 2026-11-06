// Универсальная drag-карусель
function initDragCarousel(selector) {
    const carousel = document.querySelector(selector);
    if (!carousel) return;
    
    let isDown = false;
    let startX;
    let scrollLeft;
    
    carousel.addEventListener('mousedown', (e) => {
        isDown = true;
        carousel.style.cursor = 'grabbing';
        startX = e.pageX - carousel.offsetLeft;
        scrollLeft = carousel.scrollLeft;
    });
    
    carousel.addEventListener('mouseleave', () => {
        isDown = false;
        carousel.style.cursor = 'grab';
    });
    
    carousel.addEventListener('mouseup', () => {
        isDown = false;
        carousel.style.cursor = 'grab';
    });
    
    carousel.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - carousel.offsetLeft;
        const walk = (x - startX) * 1.5;
        carousel.scrollLeft = scrollLeft - walk;
    });
    
    carousel.style.cursor = 'grab';
}

// Инициализируем все карусели
initDragCarousel('.examples-carousel');
initDragCarousel('.features-carousel');




// ============================================================
// HERO ANIMATION — интерактивный тур по боту
// ============================================================
(function() {
    const chatBody = document.getElementById('heroChatBody');
    const keyboard = document.querySelector('.bot-keyboard');
    
    if (!chatBody) return;
    
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    
    let timeouts = [];
    let currentScenario = null;
    
    function clearTimeouts() {
        timeouts.forEach(t => clearTimeout(t));
        timeouts = [];
    }
    
    function delay(fn, ms) {
        const t = setTimeout(fn, ms);
        timeouts.push(t);
        return t;
    }
    
    // ============================================================
    // ХЕЛПЕРЫ
    // ============================================================
    
    function createMsg({ type = 'bot', name = '', text = '', inline = null }) {
        const msg = document.createElement('div');
        msg.className = `msg ${type} msg-anim`;
        
        if (name) {
            const nameEl = document.createElement('div');
            nameEl.className = 'msg-name';
            nameEl.textContent = name;
            msg.appendChild(nameEl);
        }
        
        if (text) {
            const textEl = document.createElement('div');
            textEl.className = 'msg-text';
            textEl.innerHTML = text;
            msg.appendChild(textEl);
        }
        
        if (inline) {
            const kb = document.createElement('div');
            kb.className = 'inline-kb';
            inline.forEach(btn => {
                const b = document.createElement('button');
                b.className = 'inline-kb-btn' + (btn.primary ? ' primary' : '') + (btn.selected ? ' selected' : '');
                b.textContent = btn.text;
                b.dataset.id = btn.id || '';
                kb.appendChild(b);
            });
            msg.appendChild(kb);
        }
        
        chatBody.appendChild(msg);
        
        requestAnimationFrame(() => {
            chatBody.scrollTo({ top: chatBody.scrollHeight, behavior: 'smooth' });
        });
        
        return msg;
    }
    
    function pressKeyboardBtn(btn) {
        if (!btn) return;
        btn.classList.add('pressed');
        delay(() => btn.classList.remove('pressed'), 250);
    }
    
    function tapInlineBtn(msgEl, btnId) {
        const btn = msgEl.querySelector(`[data-id="${btnId}"]`);
        if (!btn) return;
        btn.classList.add('tap');
        delay(() => btn.classList.remove('tap'), 250);
    }
    
    function markSelected(msgEl, btnId, newText) {
        const btn = msgEl.querySelector(`[data-id="${btnId}"]`);
        if (btn) {
            btn.classList.add('selected');
            btn.textContent = newText;
        }
    }
    
    function addInlineBtn(msgEl, text, id, primary = false) {
        const kb = msgEl.querySelector('.inline-kb');
        if (!kb) return null;
        const b = document.createElement('button');
        b.className = 'inline-kb-btn' + (primary ? ' primary' : '');
        b.textContent = text;
        b.dataset.id = id;
        kb.appendChild(b);
        
        requestAnimationFrame(() => {
            chatBody.scrollTo({ top: chatBody.scrollHeight, behavior: 'smooth' });
        });
        
        return b;
    }
    
    // ============================================================
    // ЧТО «ПИШЕТ» ПОЛЬЗОВАТЕЛЬ ПРИ КЛИКЕ НА КНОПКУ
    // ============================================================
    
    const COMMANDS = {
        'new-tournament': '🏆 Новый турнир',
        'teams-list': '📋 Список команд',
        'rating': '📈 Общий рейтинг',
        'h2h': '⚔️ Личные встречи',
        'profile': '👤 Профиль',
        'team-stats': '🏟️ Статистика команд'
    };
    
    // ============================================================
    // СЦЕНАРИИ
    // ============================================================
    
    const SCENARIOS = {
        
        // ========== НОВЫЙ ТУРНИР (полный цикл) ==========
        'new-tournament': function() {
            let participantsMsg;
            delay(() => {
                participantsMsg = createMsg({
                    type: 'bot',
                    name: '👥 Выбери участников',
                    text: 'Турнир «каждый с каждым». Нажми на имена:',
                    inline: [
                        { id: 'p1', text: '⬜️ Владимир' },
                        { id: 'p2', text: '⬜️ Нуриман' },
                        { id: 'p3', text: '⬜️ Никита' },
                        { id: 'p4', text: '⬜️ Денис' }
                    ]
                });
            }, 1100);
            
            delay(() => { if (participantsMsg) tapInlineBtn(participantsMsg, 'p1'); }, 1900);
            delay(() => { if (participantsMsg) markSelected(participantsMsg, 'p1', '✅ Владимир'); }, 2100);
            delay(() => { if (participantsMsg) tapInlineBtn(participantsMsg, 'p2'); }, 2600);
            delay(() => { if (participantsMsg) markSelected(participantsMsg, 'p2', '✅ Нуриман'); }, 2800);
            delay(() => { if (participantsMsg) tapInlineBtn(participantsMsg, 'p3'); }, 3300);
            delay(() => { if (participantsMsg) markSelected(participantsMsg, 'p3', '✅ Никита'); }, 3500);
            
            delay(() => {
                if (participantsMsg) {
                    const startBtn = addInlineBtn(participantsMsg, '🎲 Начать турнир', 'start', true);
                    if (startBtn) {
                        delay(() => {
                            startBtn.classList.add('tap');
                            delay(() => startBtn.classList.remove('tap'), 250);
                        }, 200);
                    }
                }
            }, 4100);
            
            delay(() => {
                createMsg({
                    type: 'bot',
                    name: '🎲 Жеребьёвка команд',
                    text: 'Владимир → 🇮🇹 Ювентус<br>Нуриман → 🏴󠁧󠁢󠁥󠁮󠁧󠁿 Манчестер Сити<br>Никита → 🇩🇪 Бавария'
                });
            }, 4900);
            
            delay(() => {
                createMsg({
                    type: 'bot',
                    name: '🏆 РАСПИСАНИЕ',
                    text: 'Владимир vs Нуриман<br>Владимир vs Никита<br>Нуриман vs Никита'
                });
            }, 5400);
            
            let matchSelect1;
            delay(() => {
                matchSelect1 = createMsg({
                    type: 'bot',
                    name: '📝 Выбери матч',
                    text: 'Какой матч записываем?',
                    inline: [
                        { id: 'm1', text: 'Владимир vs Нуриман' },
                        { id: 'm2', text: 'Владимир vs Никита' },
                        { id: 'm3', text: 'Нуриман vs Никита' }
                    ]
                });
            }, 6100);
            
            delay(() => { if (matchSelect1) tapInlineBtn(matchSelect1, 'm1'); }, 6800);
            delay(() => {
                if (matchSelect1) {
                    const btn = matchSelect1.querySelector('[data-id="m1"]');
                    if (btn) { btn.classList.add('selected'); btn.textContent = '✅ Владимир vs Нуриман'; }
                }
            }, 7000);
            
            delay(() => {
                createMsg({ type: 'bot', name: '📝 Введи счёт', text: 'Владимир vs Нуриман<br>Пример: 2:1 или 0:0' });
            }, 7600);
            
            delay(() => createMsg({ type: 'user', text: '3:1' }), 8300);
            
            delay(() => {
                createMsg({ type: 'bot', name: '✅ Результат записан', text: 'Владимир <strong>3:1</strong> Нуриман<br>🏆 Победа в основное время' });
            }, 8900);
            
            delay(() => {
                createMsg({ type: 'bot', name: '📊 ТУРНИРНАЯ ТАБЛИЦА', text: '🥇 Владимир (Юве)<br>1 игр · 2 очка · 3:1 (+2)<br><br>🥈 Нуриман (Ман Сити)<br>1 игр · 0 очков · 1:3 (−2)<br><br>🥉 Никита (Бавария)<br>0 игр · 0 очков' });
            }, 9600);
            
            delay(() => {
                createMsg({ type: 'bot', name: '🏟 LIVE СТАТУС', text: 'Сыграно: 1 из 3<br><br><strong>Осталось:</strong><br>• Владимир vs Никита<br>• Нуриман vs Никита' });
            }, 10200);
            
            let matchSelect2;
            delay(() => {
                matchSelect2 = createMsg({
                    type: 'bot',
                    name: '📝 Выбери матч',
                    text: 'Какой матч записываем?',
                    inline: [
                        { id: 'm2', text: 'Владимир vs Никита' },
                        { id: 'm3', text: 'Нуриман vs Никита' }
                    ]
                });
            }, 11000);
            
            delay(() => { if (matchSelect2) tapInlineBtn(matchSelect2, 'm2'); }, 11700);
            delay(() => {
                if (matchSelect2) {
                    const btn = matchSelect2.querySelector('[data-id="m2"]');
                    if (btn) { btn.classList.add('selected'); btn.textContent = '✅ Владимир vs Никита'; }
                }
            }, 11900);
            
            delay(() => {
                createMsg({ type: 'bot', name: '📝 Введи счёт', text: 'Владимир vs Никита<br>Пример: 2:1 или 0:0' });
            }, 12500);
            
            delay(() => createMsg({ type: 'user', text: '1:1' }), 13200);
            
            let penaltyMsg;
            delay(() => {
                penaltyMsg = createMsg({
                    type: 'bot',
                    name: '⚽️ Ничья 1:1!',
                    text: 'Кто победил по пенальти?',
                    inline: [
                        { id: 'pen1', text: 'Владимир' },
                        { id: 'pen2', text: 'Никита' }
                    ]
                });
            }, 13800);
            
            delay(() => { if (penaltyMsg) tapInlineBtn(penaltyMsg, 'pen1'); }, 14500);
            delay(() => { if (penaltyMsg) markSelected(penaltyMsg, 'pen1', '✅ Владимир'); }, 14700);
            
            delay(() => {
                createMsg({ type: 'bot', name: '✅ Результат записан', text: 'Владимир <strong>1:1</strong> Никита<br>🏆 Пенальти: Владимир' });
            }, 15300);
            
            delay(() => {
                createMsg({ type: 'bot', name: '📊 ТУРНИРНАЯ ТАБЛИЦА', text: '🥇 Владимир (Юве)<br>2 игр · 4 очка · 4:2 (+2)<br><br>🥈 Никита (Бавария)<br>1 игр · 1 очко · 1:1 (0)<br><br>🥉 Нуриман (Ман Сити)<br>1 игр · 0 очков · 1:3 (−2)' });
            }, 16100);
            
            delay(() => {
                createMsg({ type: 'bot', name: '🏟 LIVE СТАТУС', text: 'Сыграно: 2 из 3<br><br><strong>Осталось:</strong><br>• Нуриман vs Никита' });
            }, 16800);
            
            let matchSelect3;
            delay(() => {
                matchSelect3 = createMsg({
                    type: 'bot',
                    name: '📝 Выбери матч',
                    text: 'Какой матч записываем?',
                    inline: [{ id: 'm3', text: 'Нуриман vs Никита' }]
                });
            }, 17600);
            
            delay(() => { if (matchSelect3) tapInlineBtn(matchSelect3, 'm3'); }, 18300);
            delay(() => {
                if (matchSelect3) {
                    const btn = matchSelect3.querySelector('[data-id="m3"]');
                    if (btn) { btn.classList.add('selected'); btn.textContent = '✅ Нуриман vs Никита'; }
                }
            }, 18500);
            
            delay(() => {
                createMsg({ type: 'bot', name: '📝 Введи счёт', text: 'Нуриман vs Никита<br>Пример: 2:1 или 0:0' });
            }, 19100);
            
            delay(() => createMsg({ type: 'user', text: '2:0' }), 19800);
            
            delay(() => {
                createMsg({ type: 'bot', name: '✅ Результат записан', text: 'Нуриман <strong>2:0</strong> Никита<br>🏆 Победа в основное время' });
            }, 20400);
            
            delay(() => {
                createMsg({ type: 'bot', name: '📊 ТУРНИРНАЯ ТАБЛИЦА', text: '🥇 Владимир (Юве)<br>2 игр · 4 очка · 4:2 (+2)<br><br>🥈 Нуриман (Ман Сити)<br>2 игр · 2 очка · 3:3 (0)<br><br>🥉 Никита (Бавария)<br>2 игр · 1 очко · 1:3 (−2)' });
            }, 21200);
            
            let finishMsg;
            delay(() => {
                finishMsg = createMsg({
                    type: 'bot',
                    name: '🏆 Все матчи сыграны!',
                    text: 'Осталось подвести итоги. Нажми «Завершить турнир».',
                    inline: [{ id: 'finish', text: '🏆 Завершить турнир', primary: true }]
                });
            }, 22000);
            
            delay(() => { if (finishMsg) tapInlineBtn(finishMsg, 'finish'); }, 22800);
            
            delay(() => {
                createMsg({
                    type: 'bot',
                    name: '🏆 ТУРНИР ЗАВЕРШЁН!',
                    text: '<strong>Победитель:</strong> Владимир (🇮🇹 Ювентус) — 4 очка<br><br><strong>Итоговая таблица:</strong><br>🥇 Владимир (Юве) — 4 очка<br>🥈 Нуриман (Ман Сити) — 2 очка<br>🥉 Никита (Бавария) — 1 очко<br><br><strong>Все матчи:</strong><br>Владимир 3:1 Нуриман<br>Владимир 1:1 Никита (пен. Владимир)<br>Нуриман 2:0 Никита'
                });
            }, 23600);
        },
        
        // ========== СПИСОК КОМАНД ============
        'teams-list': function() {
            delay(() => {
                createMsg({
                    type: 'bot',
                    name: '📋 Список команд',
                    text: '<strong>⚽ КЛУБЫ (43):</strong><br>1. 🇮🇹 Ювентус<br>2. 🏴󠁧󠁢󠁥󠁮󠁧󠁿 Манчестер Сити<br>3. 🇩🇪 Бавария<br>4. 🏴󠁧󠁢󠁥󠁮󠁧󠁿 Арсенал<br>5. 🏴󠁧󠁢󠁥󠁮󠁧󠁿 Ливерпуль<br>... и ещё 38<br><br><strong>🌍 СБОРНЫЕ (10):</strong><br>1. 🇦🇷 Аргентина<br>2. 🇫🇷 Франция<br>3. 🇧🇷 Бразилия<br>4. 🇬🇧 Англия<br>... и ещё 6'
                });
            }, 900);
        },
        
        // ========== ОБЩИЙ РЕЙТИНГ ============
        'rating': function() {
            delay(() => {
                createMsg({
                    type: 'bot',
                    name: '📈 ОБЩИЙ РЕЙТИНГ ИГРОКОВ',
                    text: '🥇 <strong>Владимир</strong> — 42 очка<br>🎮 25 матчей · ✅ 18 (72%) · ❌ 4 · 🤝 3<br>🥅 Пенальти: 2 / 1<br>⚽️ Голы: 58:22 (+36)<br>🏆 Турниров: 5 из 12<br><br>🥈 <strong>Нуриман</strong> — 35 очков<br>🎮 24 матча · ✅ 15 (63%) · ❌ 6 · 🤝 3<br>🥅 Пенальти: 3 / 2<br>⚽️ Голы: 47:30 (+17)<br>🏆 Турниров: 3 из 12<br><br>🥉 <strong>Никита</strong> — 28 очков<br>🎮 22 матча · ✅ 12 (55%) · ❌ 7 · 🤝 3<br>⚽️ Голы: 40:28 (+12)<br>🏆 Турниров: 2 из 12'
                });
            }, 900);
        },
        
        // ========== ЛИЧНЫЕ ВСТРЕЧИ (два игрока) ============
        'h2h': function() {
            // Шаг 1: выбор первого игрока
            let pickMsg1;
            delay(() => {
                pickMsg1 = createMsg({
                    type: 'bot',
                    name: '⚔️ ЛИЧНЫЕ ВСТРЕЧИ',
                    text: 'Выбери первого игрока:',
                    inline: [
                        { id: 'h1', text: 'Владимир' },
                        { id: 'h2', text: 'Нуриман' },
                        { id: 'h3', text: 'Никита' }
                    ]
                });
            }, 900);
            
            delay(() => { if (pickMsg1) tapInlineBtn(pickMsg1, 'h1'); }, 1700);
            delay(() => { if (pickMsg1) markSelected(pickMsg1, 'h1', '✅ Владимир'); }, 1900);
            
            // Шаг 2: выбор второго игрока
            let pickMsg2;
            delay(() => {
                pickMsg2 = createMsg({
                    type: 'bot',
                    name: '⚔️ ЛИЧНЫЕ ВСТРЕЧИ',
                    text: 'Первый игрок: <strong>Владимир</strong><br><br>Теперь выбери второго:',
                    inline: [
                        { id: 'h2b', text: 'Нуриман' },
                        { id: 'h3b', text: 'Никита' }
                    ]
                });
            }, 2500);
            
            delay(() => { if (pickMsg2) tapInlineBtn(pickMsg2, 'h2b'); }, 3300);
            delay(() => { if (pickMsg2) markSelected(pickMsg2, 'h2b', '✅ Нуриман'); }, 3500);
            
            // Шаг 3: показываем статистику
            delay(() => {
                createMsg({
                    type: 'bot',
                    name: '⚔️ ЛИЧНЫЕ ВСТРЕЧИ',
                    text: '<strong>Владимир</strong> vs <strong>Нуриман</strong><br><br>📊 Всего матчей: <strong>8</strong><br>✅ Владимир побед: 5<br>✅ Нуриман побед: 2<br>🤝 Ничьих: 1<br><br>🥅 Пенальти:<br>• Владимир: 1<br>• Нуриман: 1<br><br>⚽️ Голы:<br>Владимир: 18<br>Нуриман: 12<br>Всего: 30 (в среднем 3.8 за матч)<br><br><strong>📜 Последние матчи:</strong><br>1. ✅ 05.11: Владимир 3:1 Нуриман<br>2. ❌ 03.11: Нуриман 2:1 Владимир<br>3. ✅ 01.11: Владимир 2:2 Нуриман (пен. Владимир)'
                });
            }, 4300);
        },
        
        // ========== ПРОФИЛЬ ============
        'profile': function() {
            let pickMsg;
            delay(() => {
                pickMsg = createMsg({
                    type: 'bot',
                    name: '👤 ПРОФИЛЬ ИГРОКА',
                    text: 'Выбери игрока:',
                    inline: [
                        { id: 'pr1', text: 'Владимир' },
                        { id: 'pr2', text: 'Нуриман' },
                        { id: 'pr3', text: 'Никита' }
                    ]
                });
            }, 900);
            
            delay(() => { if (pickMsg) tapInlineBtn(pickMsg, 'pr1'); }, 1700);
            delay(() => { if (pickMsg) markSelected(pickMsg, 'pr1', '✅ Владимир'); }, 1900);
            
            delay(() => {
                createMsg({
                    type: 'bot',
                    name: '👤 ПРОФИЛЬ: ВЛАДИМИР',
                    text: '📈 <strong>Место в рейтинге:</strong> #1 из 4<br>💎 <strong>Очков:</strong> 42<br><br><strong>📊 СТАТИСТИКА:</strong><br>🎮 Матчей: 25<br>✅ Побед: 18 (72%)<br>❌ Поражений: 4<br>🤝 Ничьих: 3<br>🥅 Пенальти: 2 / 1<br><br><strong>⚽️ ГОЛЫ:</strong><br>Забито: 58<br>Пропущено: 22<br>Разница: +36<br><br>🔥 <strong>Текущая серия:</strong> 5 побед<br>📈 <strong>Лучшая серия:</strong> 8 побед<br><br>🏆 <strong>Турниры:</strong> 5 побед из 12<br><br><strong>🏅 ДОСТИЖЕНИЯ:</strong><br>🔥 Серия — 5 побед<br>💯 Ветеран — 50 матчей'
                });
            }, 2700);
        },
        
        // ========== СТАТИСТИКА КОМАНД ============
        'team-stats': function() {
            delay(() => {
                createMsg({
                    type: 'bot',
                    name: '🏟️ СТАТИСТИКА КОМАНД',
                    text: '<strong>⚽ КЛУБЫ (топ-5):</strong><br><br>🥇 🇮🇹 Ювентус<br>🎮 8 матчей · ✅ 6 (75%) · ❌ 1 · 🤝 1<br>⚽️ Голы: 22:10<br><br>🥈 🏴󠁧󠁢󠁥󠁮󠁧󠁿 Манчестер Сити<br>🎮 12 матчей · ✅ 8 (67%) · ❌ 3 · 🤝 1<br>⚽️ Голы: 30:18<br><br>🥉 🇩🇪 Бавария<br>🎮 6 матчей · ✅ 4 (67%) · ❌ 2 · 🤝 0<br>⚽️ Голы: 15:9<br><br>━━━━━━━━━━━━━━━━━<br><br><strong>🌍 СБОРНЫЕ (топ-3):</strong><br><br>🥇 🇦🇷 Аргентина<br>🎮 5 матчей · ✅ 4 (80%) · ❌ 1 · 🤝 0<br>⚽️ Голы: 12:5<br><br>🥈 🇫🇷 Франция<br>🎮 5 матчей · ✅ 3 (60%) · ❌ 2 · 🤝 0<br>⚽️ Голы: 10:8<br><br>🥉 🇧🇷 Бразилия<br>🎮 4 матча · ✅ 2 (50%) · ❌ 2 · 🤝 0<br>⚽️ Голы: 8:7'
                });
            }, 900);
        }
    };
    
    // ============================================================
    // ФИНАЛЬНЫЙ ЭКРАН (для reduced-motion)
    // ============================================================
    
    function showFinalScreen() {
        chatBody.innerHTML = '';
        createMsg({
            type: 'bot',
            name: '🎲 Жеребьёвка команд',
            text: 'Владимир → 🇮🇹 Ювентус<br>Нуриман → 🏴󠁧󠁢󠁥󠁮󠁧󠁿 Манчестер Сити<br>Никита → 🇩🇪 Бавария'
        });
        createMsg({
            type: 'bot',
            name: '✅ Результат записан',
            text: 'Владимир <strong>3:1</strong> Нуриман'
        });
        createMsg({
            type: 'bot',
            name: '🏆 ТУРНИР ЗАВЕРШЁН!',
            text: '<strong>Победитель:</strong> Владимир (Ювентус) — 4 очка<br><br>🥇 Владимир — 4 очка<br>🥈 Нуриман — 2 очка<br>🥉 Никита — 1 очко'
        });
    }
    
    // ============================================================
    // ЗАПУСК СЦЕНАРИЯ
    // ============================================================
    
    function runScenario(action) {
        clearTimeouts();
        chatBody.innerHTML = '';
        currentScenario = action;
        
        if (prefersReducedMotion) {
            showFinalScreen();
            return;
        }
        
        // Сначала отправляем сообщение-команду от «пользователя»
        const commandText = COMMANDS[action];
        if (commandText) {
            delay(() => {
                createMsg({ type: 'user', text: commandText });
            }, 150);
        }
        
        // Потом запускаем сценарий
        const scenario = SCENARIOS[action];
        if (scenario) {
            scenario();
        }
    }
    
    // Автозапуск при загрузке
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => runScenario('new-tournament'));
    } else {
        runScenario('new-tournament');
    }
    
    // Клик по кнопкам клавиатуры → запуск соответствующего сценария
    if (keyboard) {
        keyboard.addEventListener('click', (e) => {
            const btn = e.target.closest('.bot-keyboard-btn');
            if (!btn) return;
            
            const action = btn.dataset.action;
            if (action && SCENARIOS[action]) {
                runScenario(action);
            }
        });
    }
})();
