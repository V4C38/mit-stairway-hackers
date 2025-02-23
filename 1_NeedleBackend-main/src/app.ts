import fs from 'fs';
import mic from 'mic';
import express from 'express';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import ffmpeg from 'fluent-ffmpeg';
import { generate3DModel } from './modelGenerator';
import path from 'path';
import cors from 'cors';
import { WebSocketServer } from 'ws';

const port = process.env.PORT || 3333; // Use environment variable PORT for deployment

// Initialize Express app
const app = express();

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Explicitly set the path to the .env file
dotenv.config({ path: path.resolve(__dirname, 'src/.env') });

// Serve generated models
const modelDirectory = path.resolve(__dirname);
app.use('/models', express.static(modelDirectory));

// Initialize OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Store your key in an .env file
});

// Create WebSocket server and attach it to the HTTP server
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket connections
wss.on('connection', (ws) => {
  console.log('WebSocket connection established');
  ws.on('close', () => console.log('WebSocket connection closed'));
});

// Notify all connected clients about a new event
function notifyClients(event: string, data: any) {
  const message = JSON.stringify({ event, ...data });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

// Variables for recording
let micInstance: any = null;
let micInputStream: any = null;
let isRecording = false;
let fileStreamFinished = false;
let wavFilePath = '';
let tempWavPath = '';

// Start recording
function startRecording() {
  return new Promise((resolve, reject) => {
    if (isRecording) return reject('Already recording');
    console.log('Recording started...');

    fileStreamFinished = false;

    const timestamp = new Date().getTime();
    wavFilePath = `temp_${timestamp}.wav`;
    tempWavPath = `temp_converted_${timestamp}.wav`;

    if (micInstance) {
      micInstance.stop();
      micInstance = null;
      micInputStream = null;
    }

    micInstance = mic({
      rate: '16000',
      channels: '1',
      debug: false,
      fileType: 'wav',
    });

    micInputStream = micInstance.getAudioStream();
    const outputFileStream = fs.createWriteStream(wavFilePath);
    micInputStream.pipe(outputFileStream);

    micInstance.start();
    isRecording = true;

    micInputStream.on('error', (err) => {
      console.error('Mic error:', err);
      reject(err);
    });

    outputFileStream.on('finish', () => {
      console.log('File stream finished writing');
      fileStreamFinished = true;
      resolve();
    });

    outputFileStream.on('error', (err) => {
      console.error('Error during file write:', err);
      reject(err);
    });
  });
}

// Stop recording
async function stopRecording() {
  if (!isRecording) return;
  console.log('Recording stopped...');

  try {
    if (micInstance) {
      micInstance.stop();
      micInstance = null;
    }
    isRecording = false;

    await new Promise((resolve) => {
      if (fileStreamFinished) {
        resolve();
      } else {
        setTimeout(resolve, 1000);
      }
    });

    if (fs.existsSync(wavFilePath) && fs.statSync(wavFilePath).size > 0) {
      console.log('Converting WAV file...');
      await convertToCorrectWavFormat(wavFilePath, tempWavPath);

      if (fs.existsSync(tempWavPath) && fs.statSync(tempWavPath).size > 0) {
        await transcribeAudio(tempWavPath);
      } else {
        console.error('Converted WAV file is empty.');
      }
    } else {
      console.error('Original WAV file is empty.');
    }
  } catch (error) {
    console.error('Error stopping recording:', error);
  }
}

// Convert WAV file format
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

// Transcribe audio and generate model
async function transcribeAudio(filePath: string) {
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-1',
    });

    const modelPath = await generate3DModel(transcription.text);
    notifyClients('modelReady', { url: `/models/${path.basename(modelPath)}` });
  } catch (error) {
    console.error('Error transcribing audio:', error);
  }
}

// Express routes
app.get('/', (_req, res) => {
  res.send('Server is running!');
});

app.post('/start', (_req, res) => {
  startRecording()
      .then(() => res.send('Recording started'))
      .catch((err) => res.status(500).send(`Error starting recording: ${err}`));
});

app.post('/stop', (_req, res) => {
  stopRecording()
      .then(() => res.send('Recording stopped'))
      .catch((err) => res.status(500).send(`Error stopping recording: ${err}`));
});

// Upgrade HTTP server for WebSocket connections
app.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

// Start HTTP server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});