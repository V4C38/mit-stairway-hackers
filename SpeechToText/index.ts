import fs from 'fs';
import mic from 'mic';
import express from 'express';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import ffmpeg from 'fluent-ffmpeg';
import { generate3DModel } from './modelGenerator';


const app = express();
const port = 3000; // Port for the server
let wavFilePath = 'temp.wav';  // Default path
let tempWavPath = 'temp_converted.wav';  // Temporary path for converted WAV

dotenv.config(); // Load environment variables

// Initialize OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Store your key in an .env file
});

// Create a new mic instance
const micInstance = mic({
  rate: '16000', // Required rate for Whisper
  channels: '1',
  debug: false,
  fileType: 'wav', // Record directly in WAV format
});

const micInputStream = micInstance.getAudioStream();
let isRecording = false;  // Flag to prevent overlapping start/stop actions
let fileStreamFinished = false;  // Flag to track file stream completion

// Start recording when called
function startRecording() {
  return new Promise((resolve, reject) => {
    if (isRecording) return reject('Already recording'); // Prevent starting if already recording
    console.log('Recording started...');

    // Reset fileStreamFinished flag before starting
    fileStreamFinished = false;

    const timestamp = new Date().getTime();
    wavFilePath = `temp_${timestamp}.wav`;
    tempWavPath = `temp_converted_${timestamp}.wav`;  // Unique file names to avoid overwriting

    const outputFileStream = fs.createWriteStream(wavFilePath);
    micInputStream.pipe(outputFileStream);

    micInstance.start();
    isRecording = true;

    micInputStream.on('error', (err) => {
      console.error('Mic error:', err);
      reject(err);
    });

    // Wait for the file stream to finish writing
    outputFileStream.on('finish', () => {
      console.log('File stream finished writing');
      fileStreamFinished = true;  // Mark the file as fully written
      resolve();  // Resolve the promise when the file stream is finished
    });

    outputFileStream.on('error', (err) => {
      console.error('Error during file write:', err);
      reject(err);  // Reject the promise if there's an error
    });
  });
}

// Stop recording and send the WAV file for transcription
async function stopRecording() {
  if (!isRecording) return; // Prevent stopping if not recording
  console.log('Recording stopped...');
  micInstance.stop();
  isRecording = false;

  try {
    // Wait until file stream has finished before proceeding
    await new Promise((resolve) => {
      if (fileStreamFinished) {
        resolve();
      } else {
        setTimeout(() => {
          resolve();
        }, 1000); // Wait a second to allow file write to complete
      }
    });

    console.log(`WAV file saved to ${wavFilePath}`);

    // Check if the file exists and has content before converting
    if (fs.existsSync(wavFilePath) && fs.statSync(wavFilePath).size > 0) {
      console.log(`WAV file found, converting to correct format...`);
      // Re-encode the WAV file to the correct format (16-bit, mono, 16000 Hz)
      await convertToCorrectWavFormat(wavFilePath, tempWavPath);

      // Check if the converted file exists and has content
      if (fs.existsSync(tempWavPath) && fs.statSync(tempWavPath).size > 0) {
        // Transcribe the corrected WAV file
        await transcribeAudio(tempWavPath);
      } else {
        console.error('Error: Converted WAV file is empty or does not exist.');
      }
    } else {
      console.error('Error: WAV file is empty or does not exist.');
    }
  } catch (error) {
    console.error('Error during stop recording:', error);
  }
}

// Convert the WAV file to the required format (16-bit, mono, 16000 Hz)
function convertToCorrectWavFormat(inputFilePath, outputFilePath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputFilePath)
      .audioCodec('pcm_s16le') // Ensure 16-bit PCM encoding
      .audioChannels(1) // Mono audio
      .audioFrequency(16000) // 16kHz sample rate
      .format('wav') // Output WAV format
      .save(outputFilePath)
      .on('end', () => {
        console.log(`WAV file converted to correct format: ${outputFilePath}`);
        resolve();
      })
      .on('error', (err) => {
        console.error('Error during WAV conversion:', err);
        reject(err);
      });
  });
}

// Function to send the WAV file to OpenAI API for transcription
async function transcribeAudio(filePath: string) {
  try {
    console.log('Sending audio file for transcription...');
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-1', // Specify the model
    });

    console.log('Transcription:', transcription.text);
    generate3DModel(transcription.text);
  } catch (error) {
    console.error('Error during transcription:', error);
  }
}

// Setup Express routes for start/stop actions
app.use(express.static('public')); // Serve static files from 'public' folder

app.post('/start', (req, res) => {
  startRecording().then(() => {
    res.send('Recording started');
  }).catch(err => {
    res.status(500).send('Error starting recording: ' + err.message);
  });
});

app.post('/stop', (req, res) => {
  stopRecording().then(() => {
    res.send('Recording stopped');
  }).catch(err => {
    res.status(500).send('Error stopping recording: ' + err.message);
  });
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
