
import fs from "fs";
import OpenAI from "openai";

//sk-abcd5678efgh1234abcd5678efgh1234abcd5678
const openai = new OpenAI();

const transcription = await openai.audio.transcriptions.create({
  file: fs.createReadStream("real.mp3"),
  model: "whisper-1",
});

console.log(transcription.text);
