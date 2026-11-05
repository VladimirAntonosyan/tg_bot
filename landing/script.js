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
// HERO ANIMATION — полный сценарий турнира
// ============================================================
(function() {
    const chatBody = document.getElementById('heroChatBody');
    const keyboard = document.querySelector('.bot-keyboard');
    const newTournamentBtn = document.querySelector('[data-action="new-tournament"]');
    
    if (!chatBody) return;
    
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    
    let animationStarted = false;
    let timeouts = [];
    
    function clearTimeouts() {
        timeouts.forEach(t => clearTimeout(t));
        timeouts = [];
    }
    
    function delay(fn, ms) {
        const t = setTimeout(fn, ms);
        timeouts.push(t);
        return t;
    }
    
    function createMsg({ type = 'bot', name = '', text = '', inline = null, extraClass = '' }) {
        const msg = document.createElement('div');
        msg.className = `msg ${type} msg-anim ${extraClass}`;
        
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
        chatBody.scrollTop = chatBody.scrollHeight;
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
        chatBody.scrollTop = chatBody.scrollHeight;
        return b;
    }
    
    // ============================================================
    // СЦЕНАРИЙ
    // ============================================================
    
    function playScenario() {
        if (animationStarted) return;
        animationStarted = true;
        
        chatBody.innerHTML = '';
        clearTimeouts();
        
        if (prefersReducedMotion) {
            showFinalScreen();
            return;
        }
        
        // ===== ФАЗА 1: СОЗДАНИЕ ТУРНИРА =====
        
        delay(() => pressKeyboardBtn(newTournamentBtn), 400);
        
        // «Выбери участников»
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
        
        // Тап по Владимиру
        delay(() => { if (participantsMsg) tapInlineBtn(participantsMsg, 'p1'); }, 1900);
        delay(() => { if (participantsMsg) markSelected(participantsMsg, 'p1', '✅ Владимир'); }, 2100);
        
        // Тап по Нуриману
        delay(() => { if (participantsMsg) tapInlineBtn(participantsMsg, 'p2'); }, 2600);
        delay(() => { if (participantsMsg) markSelected(participantsMsg, 'p2', '✅ Нуриман'); }, 2800);
        
        // Тап по Никите
        delay(() => { if (participantsMsg) tapInlineBtn(participantsMsg, 'p3'); }, 3300);
        delay(() => { if (participantsMsg) markSelected(participantsMsg, 'p3', '✅ Никита'); }, 3500);
        
        // Тап по «Начать турнир»
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
        
        // ===== ФАЗА 2: ЖЕРЕБЬЁВКА =====
        
        delay(() => {
            createMsg({
                type: 'bot',
                name: '🎲 Жеребьёвка команд',
                text: 'Владимир → 🇪🇸 Реал Мадрид<br>Нуриман → 🏴󠁧󠁢󠁥󠁮󠁧󠁿 Манчестер Сити<br>Никита → 🇩🇪 Бавария'
            });
        }, 4900);
        
        delay(() => {
            createMsg({
                type: 'bot',
                name: '🏆 РАСПИСАНИЕ',
                text: 'Владимир vs Нуриман<br>Владимир vs Никита<br>Нуриман vs Никита'
            });
        }, 5400);
        
        // ===== ФАЗА 3: ПЕРВЫЙ МАТЧ =====
        
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
        
        // Тап по первому матчу
        delay(() => { if (matchSelect1) tapInlineBtn(matchSelect1, 'm1'); }, 6800);
        delay(() => {
            if (matchSelect1) {
                const btn = matchSelect1.querySelector('[data-id="m1"]');
                if (btn) {
                    btn.classList.add('selected');
                    btn.textContent = '✅ Владимир vs Нуриман';
                }
            }
        }, 7000);
        
        // Бот просит счёт
        delay(() => {
            createMsg({
                type: 'bot',
                name: '📝 Введи счёт',
                text: 'Владимир vs Нуриман<br>Пример: 2:1 или 0:0'
            });
        }, 7600);
        
        // Юзер вводит 3:1
        delay(() => createMsg({ type: 'user', text: '3:1' }), 8300);
        
        // Бот записывает
        delay(() => {
            createMsg({
                type: 'bot',
                name: '✅ Результат записан',
                text: 'Владимир <strong>3:1</strong> Нуриман<br>🏆 Победа в основное время'
            });
        }, 8900);
        
        // Таблица после 1-го матча
        delay(() => {
            createMsg({
                type: 'bot',
                name: '📊 ТУРНИРНАЯ ТАБЛИЦА',
                text: '🥇 Владимир (Реал)<br>1 игр · 2 очка · 3:1 (+2)<br><br>🥈 Нуриман (Ман Сити)<br>1 игр · 0 очков · 1:3 (−2)<br><br>🥉 Никита (Бавария)<br>0 игр · 0 очков'
            });
        }, 9600);
        
        // Live-статус
        delay(() => {
            createMsg({
                type: 'bot',
                name: '🏟 LIVE СТАТУС',
                text: 'Сыграно: 1 из 3<br><br><strong>Осталось:</strong><br>• Владимир vs Никита<br>• Нуриман vs Никита'
            });
        }, 10200);
        
        // ===== ФАЗА 4: ВТОРОЙ МАТЧ (НИЧЬЯ + ПЕНАЛЬТИ) =====
        
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
                if (btn) {
                    btn.classList.add('selected');
                    btn.textContent = '✅ Владимир vs Никита';
                }
            }
        }, 11900);
        
        delay(() => {
            createMsg({
                type: 'bot',
                name: '📝 Введи счёт',
                text: 'Владимир vs Никита<br>Пример: 2:1 или 0:0'
            });
        }, 12500);
        
        // Юзер вводит 1:1
        delay(() => createMsg({ type: 'user', text: '1:1' }), 13200);
        
        // Бот спрашивает про пенальти
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
        
        // Бот записывает
        delay(() => {
            createMsg({
                type: 'bot',
                name: '✅ Результат записан',
                text: 'Владимир <strong>1:1</strong> Никита<br>🏆 Пенальти: Владимир'
            });
        }, 15300);
        
        // Таблица после 2-го матча
        delay(() => {
            createMsg({
                type: 'bot',
                name: '📊 ТУРНИРНАЯ ТАБЛИЦА',
                text: '🥇 Владимир (Реал)<br>2 игр · 4 очка · 4:2 (+2)<br><br>🥈 Никита (Бавария)<br>1 игр · 1 очко · 1:1 (0)<br><br>🥉 Нуриман (Ман Сити)<br>1 игр · 0 очков · 1:3 (−2)'
            });
        }, 16100);
        
        // Live-статус
        delay(() => {
            createMsg({
                type: 'bot',
                name: '🏟 LIVE СТАТУС',
                text: 'Сыграно: 2 из 3<br><br><strong>Осталось:</strong><br>• Нуриман vs Никита'
            });
        }, 16800);
        
        // ===== ФАЗА 5: ТРЕТИЙ МАТЧ =====
        
        let matchSelect3;
        delay(() => {
            matchSelect3 = createMsg({
                type: 'bot',
                name: '📝 Выбери матч',
                text: 'Какой матч записываем?',
                inline: [
                    { id: 'm3', text: 'Нуриман vs Никита' }
                ]
            });
        }, 17600);
        
        delay(() => { if (matchSelect3) tapInlineBtn(matchSelect3, 'm3'); }, 18300);
        delay(() => {
            if (matchSelect3) {
                const btn = matchSelect3.querySelector('[data-id="m3"]');
                if (btn) {
                    btn.classList.add('selected');
                    btn.textContent = '✅ Нуриман vs Никита';
                }
            }
        }, 18500);
        
        delay(() => {
            createMsg({
                type: 'bot',
                name: '📝 Введи счёт',
                text: 'Нуриман vs Никита<br>Пример: 2:1 или 0:0'
            });
        }, 19100);
        
        delay(() => createMsg({ type: 'user', text: '2:0' }), 19800);
        
        delay(() => {
            createMsg({
                type: 'bot',
                name: '✅ Результат записан',
                text: 'Нуриман <strong>2:0</strong> Никита<br>🏆 Победа в основное время'
            });
        }, 20400);
        
        // Таблица после 3-го матча
        delay(() => {
            createMsg({
                type: 'bot',
                name: '📊 ТУРНИРНАЯ ТАБЛИЦА',
                text: '🥇 Владимир (Реал)<br>2 игр · 4 очка · 4:2 (+2)<br><br>🥈 Нуриман (Ман Сити)<br>2 игр · 2 очка · 3:3 (0)<br><br>🥉 Никита (Бавария)<br>2 игр · 1 очко · 1:3 (−2)'
            });
        }, 21200);
        
        // Бот: все матчи сыграны + кнопка «Завершить»
        let finishMsg;
        delay(() => {
            finishMsg = createMsg({
                type: 'bot',
                name: '🏆 Все матчи сыграны!',
                text: 'Осталось подвести итоги. Нажми «Завершить турнир».',
                inline: [
                    { id: 'finish', text: '🏆 Завершить турнир', primary: true }
                ]
            });
        }, 22000);
        
        // Тап по «Завершить»
        delay(() => { if (finishMsg) tapInlineBtn(finishMsg, 'finish'); }, 22800);
        
        // ===== ФАЗА 6: ФИНАЛ =====
        
        delay(() => {
            createMsg({
                type: 'bot',
                name: '🏆 ТУРНИР ЗАВЕРШЁН!',
                text: '<strong>Победитель:</strong> Владимир (🇪🇸 Реал Мадрид) — 4 очка<br><br><strong>Итоговая таблица:</strong><br>🥇 Владимир (Реал) — 4 очка<br>🥈 Нуриман (Ман Сити) — 2 очка<br>🥉 Никита (Бавария) — 1 очко<br><br><strong>Все матчи:</strong><br>Владимир 3:1 Нуриман<br>Владимир 1:1 Никита (пен. Владимир)<br>Нуриман 2:0 Никита'
            });
        }, 23600);
    }
    
    // Финальный экран для reduced-motion
    function showFinalScreen() {
        chatBody.innerHTML = '';
        createMsg({
            type: 'bot',
            name: '🎲 Жеребьёвка команд',
            text: 'Владимир → 🇪🇸 Реал Мадрид<br>Нуриман → 🏴󠁧󠁢󠁥󠁮󠁧󠁿 Манчестер Сити<br>Никита → 🇩🇪 Бавария'
        });
        createMsg({
            type: 'bot',
            name: '✅ Результат записан',
            text: 'Владимир <strong>3:1</strong> Нуриман'
        });
        createMsg({
            type: 'bot',
            name: '🏆 ТУРНИР ЗАВЕРШЁН!',
            text: '<strong>Победитель:</strong> Владимир (Реал Мадрид) — 4 очка<br><br>🥇 Владимир — 4 очка<br>🥈 Нуриман — 2 очка<br>🥉 Никита — 1 очко'
        });
    }
    
    // ============================================================
    // ЗАПУСК
    // ============================================================
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', playScenario);
    } else {
        playScenario();
    }
    
    // Клик по кнопке клавиатуры — перезапуск
    if (keyboard) {
        keyboard.addEventListener('click', (e) => {
            const btn = e.target.closest('.bot-keyboard-btn');
            if (!btn) return;
            
            clearTimeouts();
            animationStarted = false;
            playScenario();
        });
    }
})();
