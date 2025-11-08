// логи записывать в файл logs/

// лог веб ошибок
export function initErrorLogger() {
    window.addEventListener('error', (event) => {
        console.error('[GLOBAL ERROR]', event.message, event.filename, event.lineno, event.colno);
        if (typeof logToServer === 'function') {
            logToServer(event.message, event.filename, event.lineno);
        }
    });

    window.addEventListener('unhandledrejection', (event) => {
        console.error('[UNHANDLED PROMISE REJECTION]', event.reason);
        if (typeof logToServer === 'function') {
            logToServer(event.reason?.message || event.reason, null, null);
        }
    });
}

// на сервер, для записи в файл
function logToServer(message, file, line) {
    const HOST = (import.meta.env && import.meta.env.VITE_HOST) || 'localhost';
    const PORT = (import.meta.env && import.meta.env.VITE_PORT) || '51234';
    const BASE_URL = `http://${HOST}:${PORT}`;
    fetch(`${BASE_URL}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, file, line, time: new Date().toISOString() })
    }).catch(console.error);
}
