import express from 'express';
import cors from 'cors';
import fs from 'fs';
import http from 'http';
import { join } from 'path';
import { MHTMLProcessor } from './mhtmlParser.js';


const PORT = 51235;

const app = express();
app.use(cors());
app.use(express.json());

// const __dirname = dirname(fileURLToPath(import.meta.url));
// app.use(express.static(join(__dirname, 'public')));

const tempDir = join(process.cwd(), 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

app.post('/upload-chunk', async (req, res) => {
    const fileId = req.headers['x-file-id'];
    const chunkIndex = req.headers['x-chunk-index'];

    const chunkPath = join(tempDir, `${fileId}_${chunkIndex}`);
    const writeStream = fs.createWriteStream(chunkPath);

    req.pipe(writeStream);

    // ждать окончания
    writeStream.on('finish', () => {
        res.sendStatus(200);
    });

    writeStream.on('error', (err) => {
        console.error(err);
        res.sendStatus(500);
    });
});

app.post('/merge-chunks', async (req, res) => {
    const { fileId } = req.body;
    const folder = tempDir; // если файлы лежат в temp
    const files = fs.readdirSync(folder)
                    .filter(f => f.startsWith(fileId))
                    .sort((a, b) => {
                        const aIndex = parseInt(a.split('_')[1]);
                        const bIndex = parseInt(b.split('_')[1]);
                        return aIndex - bIndex;
                    });

    const buffers = files.map(f => fs.readFileSync(join(folder, f)));
    const arrayBuffer = Buffer.concat(buffers);

    const processor = new MHTMLProcessor();
    const { images } = await processor.getResult(arrayBuffer);

    res.json({ images });

    // почистить временные чанки
    files.forEach(f => fs.unlinkSync(join(folder, f)));
});
 
// // HTTPS
// const https = require('https');

// // сертификаты
// const certPath = join(process.cwd(), 'cert');
// let httpsOptions = {};
// try {
//     const privateKey = fs.readFileSync(join(certPath, 'localhost-key.pem'), 'utf8');
//     const certificate = fs.readFileSync(join(certPath, 'localhost.pem'), 'utf8');
//     httpsOptions = { key: privateKey, cert: certificate };
// } catch (err) {
//     console.warn('HTTPS сертификаты не найдены. HTTPS сервер не будет запущен.');
// }

// if (httpsOptions.key && httpsOptions.cert) {
//     https.createServer(httpsOptions, app).listen(PORT, '0.0.0.0', () => {
//         console.log(`HTTPS Server running on port ${PORT}`);
//     });
// }


// HTTP
http.createServer(app).listen(PORT, '0.0.0.0', () => {
  console.log(`HTTP Server running on port ${PORT}`);
});

