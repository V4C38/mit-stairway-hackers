import fs from 'fs';
import express from 'express';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { generate3DModel } from './modelGenerator.js';
import multer from 'multer';

// Derive __dirname in ESM:
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const port = process.env.PORT || 10000; // Render uses internal ports like 10000

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Serve generated models (any .glb, .png, etc. files created)
// Serve generated models from 'models' directory
const modelDirectory = path.join(__dirname, 'models');
if (!fs.existsSync(modelDirectory)) {
    fs.mkdirSync(modelDirectory, { recursive: true });
    console.log(`Created models directory at ${modelDirectory}`);
}
app.use('/models', express.static(modelDirectory));

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Create the HTTP server *from* the Express app
const server = http.createServer(app);

// Create WebSocket server with noServer mode
const wss = new WebSocketServer({ noServer: true });

// Handle the 'upgrade' event *on the server*, not on `app`
server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
    });
});

// WebSocket logic
wss.on('connection', (ws) => {
    console.log('WebSocket connection established');
    ws.on('close', () => console.log('WebSocket connection closed'));
});

// Notify all connected clients about a new event
function notifyClients(event, data) {
    const message = JSON.stringify({ event, ...data });
    wss.clients.forEach((client) => {
        if (client.readyState === 1) {
            client.send(message);
        }
    });
}

// Set up multer storage with absolute path
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, 'uploads');
        // Create 'uploads' directory if it doesn't exist
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
            console.log(`Created uploads directory at ${uploadPath}`);
        }
        cb(null, uploadPath); // Use absolute path
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${uniqueSuffix}-${file.originalname}`);
    }
});
const upload = multer({ storage: storage });

// Route to test server
app.get('/test', (req, res) => {
    res.send('Server is running!');
});

// Route to handle audio uploads
// Route to handle audio uploads
app.post('/upload', upload.single('audio'), async (req, res) => {
    if (!req.file) {
        console.warn('No file uploaded.');
        return res.status(400).send('No file uploaded.');
    }

    // Construct absolute paths using destination and filename
    const uploadedFilePath = path.join(req.file.destination, req.file.filename);
    const convertedFilePath = path.join(req.file.destination, `converted-${req.file.filename}`);

    try {
        console.log(`Received file: ${uploadedFilePath}`);

        // Convert audio file if necessary
        await convertToCorrectWavFormat(uploadedFilePath, convertedFilePath);
        console.log(`Converted file: ${convertedFilePath}`);

        // Transcribe audio using OpenAI Whisper
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(convertedFilePath),
            model: 'whisper-1',
            response_format: "text",
        });

        console.log(`Transcription: ${transcription}`);

        // Generate 3D model based on transcription
        const modelPath = await generate3DModel(transcription);
        console.log(`Generated 3D model at: ${modelPath}`);

        // Notify all connected clients that the model is ready
        notifyClients('modelReady', { url: `/models/${path.basename(modelPath)}` });
        console.log('Notified clients about the new model.');

        res.status(200).send('Audio processed and model generated.');
    } catch (error) {
        console.error('Error processing audio:', error);

        // Send more detailed error information to the client (optional, be cautious in production)
        res.status(500).send(`Error processing audio: ${error.message}`);
    } finally {
        // Optionally, clean up uploaded files
        // fs.unlinkSync(uploadedFilePath);
        // fs.unlinkSync(convertedFilePath);
    }
});

// Function to convert WAV file format using ffmpeg
function convertToCorrectWavFormat(inputFilePath, outputFilePath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputFilePath)
            .audioCodec('pcm_s16le')
            .audioChannels(1)
            .audioFrequency(16000)
            .format('wav')
            .save(outputFilePath)
            .on('end', () => {
                console.log(`Converted WAV file: ${outputFilePath}`);
                resolve();
            })
            .on('error', (err) => {
                console.error('Error converting WAV:', err);
                reject(err);
            });
    });
}

// Now start the HTTP + WS server
server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});