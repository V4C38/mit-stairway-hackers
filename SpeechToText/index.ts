import fs from 'fs';
import mic from 'mic';
import express from 'express';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import ffmpeg from 'fluent-ffmpeg';
import { generate3DModel } from './modelGenerator';

const app = express();
const port = 3000;

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

let micInstance = null;
let micInputStream = null;
let outputFileStream = null;
let wavFilePath = '';
let tempWavPath = '';
let isRecording = false;

function createMicInstance() {
  micInstance = mic({
    rate: '16000',
    channels: '1',
    debug: false,
    fileType: 'wav',
  });
  micInputStream = micInstance.getAudioStream();
}

function startRecording() {
  return new Promise((resolve, reject) => {
    if (isRecording) return reject('Already recording');

    // Cleanup any existing streams
    if (micInputStream) {
      micInputStream.removeAllListeners();
      micInputStream.destroy();
    }

    if (outputFileStream) {
      outputFileStream.end();
    }

    // Create new mic instance
    createMicInstance();

    console.log('Recording started...');

    const timestamp = new Date().getTime();
    wavFilePath = `temp_${timestamp}.wav`;
    tempWavPath = `temp_converted_${timestamp}.wav`;

    outputFileStream = fs.createWriteStream(wavFilePath);
    micInputStream.pipe(outputFileStream);

    micInstance.start();
    isRecording = true;

    const timeout = setTimeout(() => {
      console.log('Recording timeout');
      stopRecording();
    }, 10000); // 10-second max recording time

    outputFileStream.on('finish', () => {
      clearTimeout(timeout);
      console.log('File stream finished writing');
      resolve();
    });

    micInputStream.on('error', (err) => {
      clearTimeout(timeout);
      console.error('Mic input stream error:', err);
      reject(err);
    });
  });
}

async function stopRecording() {
  if (!isRecording) return;

  console.log('Recording stopped...');

  // Stop mic and end streams
  if (micInstance) {
    micInstance.stop();
  }

  if (micInputStream) {
    micInputStream.destroy();
  }

  if (outputFileStream) {
    outputFileStream.end();
  }

  isRecording = false;

  try {
    await new Promise(resolve => setTimeout(resolve, 500));

    if (fs.existsSync(wavFilePath) && fs.statSync(wavFilePath).size > 0) {
      console.log(`WAV file found, converting to correct format...`);
      await convertToCorrectWavFormat(wavFilePath, tempWavPath);

      if (fs.existsSync(tempWavPath) && fs.statSync(tempWavPath).size > 0) {
        await transcribeAudio(tempWavPath);
      } else {
        console.error('Converted WAV file is empty');
      }
    } else {
      console.error('WAV file is empty');
    }
  } catch (error) {
    console.error('Error during stop recording:', error);
  }
}

function convertToCorrectWavFormat(inputFilePath, outputFilePath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputFilePath)
      .audioCodec('pcm_s16le')
      .audioChannels(1)
      .audioFrequency(16000)
      .format('wav')
      .save(outputFilePath)
      .on('end', resolve)
      .on('error', reject);
  });
}

async function transcribeAudio(filePath) {
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-1',
    });

    console.log('Transcription:', transcription.text);
    //generate3DModel(transcription.text);
  } catch (error) {
    console.error('Error during transcription:', error);
  }
}

app.use(express.static('public'));

app.post('/start', (req, res) => {
  startRecording()
    .then(() => res.send('Recording started'))
    .catch(err => res.status(500).send('Error starting recording: ' + err.message));
});

app.post('/stop', (req, res) => {
  stopRecording()
    .then(() => res.send('Recording stopped'))
    .catch(err => res.status(500).send('Error stopping recording: ' + err.message));
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
