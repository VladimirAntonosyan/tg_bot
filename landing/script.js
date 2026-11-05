(function() {
    const carousel = document.getElementById('examplesCarousel');
    const prevBtn = document.getElementById('carouselPrev');
    const nextBtn = document.getElementById('carouselNext');
    
    if (!carousel || !prevBtn || !nextBtn) return;
    
    // Ширина одного слайда + gap
    function getSlideStep() {
        const firstSlide = carousel.querySelector('.example-phone');
        if (!firstSlide) return 284;
        return firstSlide.offsetWidth + 24; // 24 = gap
    }
    
    // Обновить состояние кнопок
    function updateButtons() {
        const { scrollLeft, scrollWidth, clientWidth } = carousel;
        const maxScroll = scrollWidth - clientWidth;
        
        prevBtn.disabled = scrollLeft <= 5;
        nextBtn.disabled = scrollLeft >= maxScroll - 5;
    }
    
    // Кнопка «Назад»
    prevBtn.addEventListener('click', () => {
        carousel.scrollBy({ left: -getSlideStep() * 2, behavior: 'smooth' });
    });
    
    // Кнопка «Вперёд»
    nextBtn.addEventListener('click', () => {
        carousel.scrollBy({ left: getSlideStep() * 2, behavior: 'smooth' });
    });
    
    // Обновление кнопок при скролле
    carousel.addEventListener('scroll', updateButtons, { passive: true });
    window.addEventListener('resize', updateButtons);
    
    // Инициализация
    updateButtons();
    
    // На мобильных скрываем кнопки (свайп работает нативно)
    function toggleControls() {
        if (window.innerWidth < 768) {
            prevBtn.style.display = 'none';
            nextBtn.style.display = 'none';
        } else {
            prevBtn.style.display = '';
            nextBtn.style.display = '';
        }
    }
    
    toggleControls();
    window.addEventListener('resize', toggleControls);

        // Принудительно скроллим в начало при загрузке
    // (иначе браузер может прыгнуть к последним слайдам)
    carousel.scrollLeft = 0;
    
    // На случай, если браузер восстанавливает позицию скролла
    if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
    }
    
    // Дополнительная страховка после загрузки всех ресурсов
    window.addEventListener('load', () => {
        carousel.scrollLeft = 0;
        updateButtons();
    });
})();
