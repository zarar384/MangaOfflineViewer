// Дополнительная логика для сакуры

let sakuraAnimationEnabled = false;
let sakuraInterval;

// Функция для создания лепестков сакуры
export function createSakura() {
    if (!sakuraAnimationEnabled) return;

    const sakura = document.createElement('div');
    sakura.className = 'sakura';

    // Случайная позиция по горизонтали
    sakura.style.left = Math.random() * window.innerWidth + 'px';

    // Случайный размер
    const size = Math.random() * 15 + 10;
    sakura.style.width = size + 'px';
    sakura.style.height = size + 'px';

    // Случайная прозрачность
    sakura.style.opacity = Math.random() * 0.5 + 0.3;

    // Случайная скорость падения (2-5s)
    const duration = Math.random() * 3 + 2;
    sakura.style.animationDuration = duration + 's';

    document.body.appendChild(sakura);

    // Удаляем элемент после завершения анимации
    setTimeout(() => {
        sakura.remove();
    }, duration * 1000);
}

// Включение/выключение анимации
export function setSakuraEnabled(enabled) {
    sakuraAnimationEnabled = enabled;
    toggleSakuraAnimation();
}

// Функция для управления анимацией сакуры
export function toggleSakuraAnimation() {
    if (sakuraAnimationEnabled) {
        // Включаем анимацию
        sakuraInterval = setInterval(createSakura, 300);
        // Создаем несколько лепестков сразу
        for (let i = 0; i < 15; i++) {
            setTimeout(createSakura, i * 100);
        }
    } else {
        // Выключаем анимацию
        clearInterval(sakuraInterval);
        // Удаляем все лепестки сакуры
        document.querySelectorAll('.sakura').forEach(el => el.remove());
    }
}
