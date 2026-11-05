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
// HERO ANIMATION — сценарий турнира
// ============================================================
(function() {
    const chatBody = document.getElementById('heroChatBody');
    const keyboard = document.querySelector('.bot-keyboard');
    const newTournamentBtn = document.querySelector('[data-action="new-tournament"]');
    
    if (!chatBody) return;
    
    // Уважаем prefers-reduced-motion — показываем сразу финальный экран
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    
    let animationStarted = false;
    let timeouts = [];
    
    // Очистить все таймауты
    function clearTimeouts() {
        timeouts.forEach(t => clearTimeout(t));
        timeouts = [];
    }
    
    // Хелпер: setTimeout с сохранением
    function delay(fn, ms) {
        const t = setTimeout(fn, ms);
        timeouts.push(t);
        return t;
    }
    
    // Создать сообщение
    function createMsg({ type = 'bot', name = '', text = '', html = '', inline = null }) {
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
        
        if (html) {
            const htmlEl = document.createElement('div');
            htmlEl.className = 'msg-text';
            htmlEl.innerHTML = html;
            msg.appendChild(htmlEl);
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
        
        // Автоскролл вниз
        chatBody.scrollTop = chatBody.scrollHeight;
        
        return msg;
    }
    
    // Нажать кнопку клавиатуры (визуальный эффект)
    function pressKeyboardBtn(btn) {
        if (!btn) return;
        btn.classList.add('pressed');
        delay(() => btn.classList.remove('pressed'), 200);
    }
    
    // Обновить inline-кнопку (selected)
    function selectInlineBtn(msgEl, btnId, newText) {
        const btn = msgEl.querySelector(`[data-id="${btnId}"]`);
        if (btn) {
            btn.classList.add('selected');
            btn.textContent = newText;
        }
    }
    
    // ============================================================
    // СЦЕНАРИЙ
    // ============================================================
    
    function playScenario() {
        if (animationStarted) return;
        animationStarted = true;
        
        chatBody.innerHTML = '';
        clearTimeouts();
        
        // Если reduced motion — сразу финальный экран
        if (prefersReducedMotion) {
            showFinalScreen();
            return;
        }
        
        // Шаг 1: 300ms — пусто
        delay(() => {
            // Шаг 2: 500ms — нажимаем «🏆 Новый турнир»
            pressKeyboardBtn(newTournamentBtn);
        }, 300);
        
        delay(() => {
            // Шаг 3: появляется сообщение «Выбери участников» с inline-кнопками
            createMsg({
                type: 'bot',
                name: '👥 Выбери участников',
                text: 'Турнир «каждый с каждым». Нажми на имена:',
                inline: [
                    { id: 'p1', text: '⬜️ Владимир' },
                    { id: 'p2', text: '⬜️ Нуриман' },
                    { id: 'p3', text: '⬜️ Никита' }
                ]
            });
        }, 900);
        
        // Шаг 4: тап по Владимиру
        delay(() => {
            const lastMsg = chatBody.lastElementChild;
            if (lastMsg) selectInlineBtn(lastMsg, 'p1', '✅ Владимир');
        }, 1800);
        
        // Шаг 5: тап по Нуриману
        delay(() => {
            const lastMsg = chatBody.lastElementChild;
            if (lastMsg) selectInlineBtn(lastMsg, 'p2', '✅ Нуриман');
        }, 2300);
        
        // Шаг 6: тап по Никите
        delay(() => {
            const lastMsg = chatBody.lastElementChild;
            if (lastMsg) selectInlineBtn(lastMsg, 'p3', '✅ Никита');
        }, 2800);
        
        // Шаг 7: нажимаем «🎲 Начать турнир» (inline)
        delay(() => {
            const lastMsg = chatBody.lastElementChild;
            if (lastMsg) {
                const btn = lastMsg.querySelector('.inline-kb-btn[data-id="p3"]');
                // Добавляем кнопку «Начать турнир» в конец
                const kb = lastMsg.querySelector('.inline-kb');
                if (kb) {
                    const startBtn = document.createElement('button');
                    startBtn.className = 'inline-kb-btn primary';
                    startBtn.textContent = '🎲 Начать турнир';
                    kb.appendChild(startBtn);
                    // Подсвечиваем
                    startBtn.style.background = 'rgba(167, 139, 250, 0.35)';
                    delay(() => { startBtn.style.background = ''; }, 300);
                }
            }
        }, 3400);
        
        // Шаг 8: жеребьёвка + расписание
        delay(() => {
            createMsg({
                type: 'bot',
                name: '🎲 Жеребьёвка команд',
                text: 'Владимир → 🇪🇸 Реал Мадрид<br>Нуриман → 🏴󠁧󠁢󠁥󠁮󠁧󠁿 Манчестер Сити<br>Никита → 🇩🇪 Бавария'
            });
            delay(() => {
                createMsg({
                    type: 'bot',
                    name: '🏆 Расписание',
                    text: 'Владимир vs Нуриман<br>Владимир vs Никита<br>Нуриман vs Никита'
                });
            }, 400);
        }, 4200);
        
        // Шаг 9: юзер вводит счёт
        delay(() => {
            createMsg({ type: 'user', text: '3:1' });
        }, 6200);
        
        // Шаг 10: бот записывает результат
        delay(() => {
            createMsg({
                type: 'bot',
                name: '✅ Результат записан',
                text: 'Владимир <strong>3:1</strong> Нуриман<br>🏆 Победа в основное время'
            });
        }, 7000);
        
        // Шаг 11: таблица
        delay(() => {
            createMsg({
                type: 'bot',
                name: '📊 ТУРНИРНАЯ ТАБЛИЦА',
                text: '🥇 Владимир (Реал)<br>2 игр · 4 очка · 5:2 (+3)<br><br>🥈 Нуриман (Ман Сити)<br>2 игр · 2 очка · 3:3 (0)<br><br>🥉 Никита (Бавария)<br>2 игр · 0 очков · 1:4 (−3)'
            });
        }, 8500);
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
            name: '📊 ТУРНИРНАЯ ТАБЛИЦА',
            text: '🥇 Владимир (Реал)<br>2 игр · 4 очка · 5:2 (+3)<br><br>🥈 Нуриман (Ман Сити)<br>2 игр · 2 очка · 3:3 (0)<br><br>🥉 Никита (Бавария)<br>2 игр · 0 очков · 1:4 (−3)'
        });
    }
    
    // ============================================================
    // ЗАПУСК
    // ============================================================
    
    // Автозапуск при загрузке
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', playScenario);
    } else {
        playScenario();
    }
    
    // Клик по любой кнопке клавиатуры — запускает анимацию заново
    if (keyboard) {
        keyboard.addEventListener('click', (e) => {
            const btn = e.target.closest('.bot-keyboard-btn');
            if (!btn) return;
            
            // Сбрасываем и запускаем заново
            clearTimeouts();
            animationStarted = false;
            playScenario();
        });
    }
})();
