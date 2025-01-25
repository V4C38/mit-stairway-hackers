import fs from 'fs';
import mic from 'mic';
import { spawn } from 'child_process';
import OpenAI from 'openai';
import dotenv from "dotenv"; // Ensure you have the openai package installed

const durationInSeconds = 10; // Set to 10 seconds
const wavFilePath = 'temp.wav';
const pcmWavFilePath = 'temp_pcm.wav'; // This will be the PCM-encoded WAV
const mp3FilePath = 'temp.mp3';



dotenv.config(); // Load environment variables

// Initialize OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Store your key in an .env file
});

// Create a new mic instance
const micInstance = mic({
  rate: '16000',
  channels: '1',
  debug: false,
  exitOnSilence: 6,
});

const micInputStream = micInstance.getAudioStream();

// Store the raw audio data as it comes in
let rawAudioData: Buffer[] = [];

// Start recording when called
function startRecording() {
  console.log('Recording started...');
  micInstance.start();

  micInputStream.on('data', (data: Buffer) => {
    rawAudioData.push(data);
  });

  // Stop recording after the specified duration
  setTimeout(stopRecording, durationInSeconds * 1000);
}

// Stop recording, save raw audio, and encode to MP3
async function stopRecording() {
  console.log('Recording stopped...');
  micInstance.stop();

  // Combine the audio chunks
  const audioBuffer = Buffer.concat(rawAudioData);

  // Save raw audio data to a .wav file
  fs.writeFileSync(wavFilePath, audioBuffer);
  console.log(`Raw audio saved to ${wavFilePath}`);

  // Check if the WAV file was saved and has content
  if (fs.existsSync(wavFilePath) && audioBuffer.length > 0) {
    console.log('WAV file exists and has content.');
    await convertToPcm(wavFilePath, pcmWavFilePath);
  } else {
    console.error('Error: WAV file is empty or does not exist.');
  }
}

// Convert the WAV file to PCM format using sox
async function convertToPcm(inputWav: string, outputPcmWav: string) {
  try {
    console.log('Converting WAV to PCM format...');
    const sox = spawn('sox', [inputWav, '--encoding', 'signed-integer', '--bits', '16', '--rate', '16000', '--channels', '1', outputPcmWav]);

    sox.stdout.on('data', (data) => {
      console.log(`sox stdout: ${data}`);
    });

    sox.stderr.on('data', (data) => {
      console.error(`sox stderr: ${data}`);
    });

    sox.on('close', (code) => {
      if (code === 0) {
        console.log(`Conversion successful. PCM WAV saved to ${outputPcmWav}`);
        encodeMp3(outputPcmWav, mp3FilePath); // Start MP3 encoding after conversion
      } else {
        console.error(`sox process exited with code ${code}`);
      }
    });

    sox.on('error', (err) => {
      console.error('Error during sox conversion:', err);
    });
  } catch (error) {
    console.error('Error during PCM conversion:', error);
  }
}

// Encode a .wav file to .mp3 using the lame command-line tool
async function encodeMp3(inputWav: string, outputMp3: string) {
  try {
    console.log('Encoding PCM WAV to MP3...');
    const lame = spawn('lame', ['-b', '128', inputWav, outputMp3]);

    lame.stdout.on('data', (data) => {
      console.log(`LAME stdout: ${data}`);
    });

    lame.stderr.on('data', (data) => {
      console.error(`LAME stderr: ${data}`);
    });

    lame.on('close', (code) => {
      if (code === 0) {
        console.log(`MP3 saved to ${outputMp3}`);
        // Call OpenAI transcription after MP3 file is saved
        transcribeAudio(outputMp3);
      } else {
        console.error(`LAME process exited with code ${code}`);
      }
    });

    lame.on('error', (err) => {
      console.error('Error during MP3 encoding:', err);
    });
  } catch (error) {
    console.error('Error during MP3 encoding:', error);
  }
}

// Function to send the MP3 file to OpenAI API for transcription
async function transcribeAudio(filePath: string) {
  try {
    console.log('Sending audio file for transcription...');
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-1', // Specify the model
    });

    console.log('Transcription:', transcription.text);
  } catch (error) {
    console.error('Error during transcription:', error);
  }
}

// Start recording
startRecording();
