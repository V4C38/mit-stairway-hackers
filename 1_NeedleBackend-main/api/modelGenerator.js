import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import dotenv from "dotenv";

dotenv.config(); // Load environment variables

const __dirname = dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------------------------------------
// Retrieve API keys from gitIgnored apiKeys.json to allow safe GIT pushing
// ------------------------------------------------------------------------------------------
// const apiKeysPath = path.resolve(__dirname, "src/apiKeys.json");
// const apiKeys = JSON.parse(fs.readFileSync(apiKeysPath, "utf8"));

const stabilityAIKey = process.env.StabilityAI;
const openAIKey = process.env.OPENAI_API_KEY;

// Example usage
console.log("StabilityAI Key:", stabilityAIKey);
console.log("OpenAI Key:", openAIKey);
// ------------------------------------------------------------------------------------------

const promptModifierImagePath = path.resolve(
    __dirname,
    "../src/promptModifier_ImageGenerator.txt"
);
const promptModifierImage = fs.readFileSync(promptModifierImagePath, "utf8");

// Function to sanitize file name
function sanitizeFileName(input) {
    return input.trim().replace(/[^a-zA-Z0-9]/g, "_").substring(0, 20);
}

// Function to optimize prompt using OpenAI API
async function optimizePrompt(inputPrompt, modifier) {
    const apiUrl = "https://api.openai.com/v1/chat/completions";
    try {
        const response = await axios.post(
            apiUrl,
            {
                model: "gpt-4",
                messages: [
                    { role: "system", content: modifier },
                    { role: "user", content: inputPrompt },
                ],
                max_tokens: 100,
                temperature: 0.7,
            },
            {
                headers: {
                    Authorization: `Bearer ${openAIKey}`,
                    "Content-Type": "application/json",
                },
            }
        );

        if (response.status === 200) {
            const optimizedPrompt = response.data.choices[0].message.content.trim();
            console.log(`Optimized Prompt: ${optimizedPrompt}`);
            return optimizedPrompt;
        } else {
            console.error(`OpenAI API call failed with status: ${response.status}`);
            throw new Error(response.data.error.message || "Unknown error occurred");
        }
    } catch (error) {
        console.error("Error optimizing prompt:", error);
        throw error;
    }
}

// Function to generate an image (now .png instead of .webp)
async function generateImage(prompt) {
    const apiUrl = "https://api.stability.ai/v2beta/stable-image/generate/core";

    // Optimize the prompt using OpenAI API
    const optimizedPrompt = await optimizePrompt(prompt, promptModifierImage);

    const startTime = Date.now();
    try {
        // Prepare form data
        const payload = {
            prompt: optimizedPrompt,
            output_format: "png",
        };
        const formData = new FormData();
        for (const [key, value] of Object.entries(payload)) {
            formData.append(key, value);
        }

        // Post to Stability AI using multipart/form-data
        const response = await axios.post(apiUrl, formData, {
            headers: {
                Authorization: `Bearer ${stabilityAIKey}`,
                Accept: "image/*",
                ...formData.getHeaders(),
            },
            responseType: "arraybuffer",
        });

        if (response.status === 200) {
            const sanitizedFileName = `gen_${sanitizeFileName(prompt)}.png`;
            const imagePath = path.resolve(__dirname, sanitizedFileName);
            fs.writeFileSync(imagePath, Buffer.from(response.data));

            const elapsedTime = (Date.now() - startTime) / 1000;
            console.log(
                `Image generated successfully at: ${imagePath} (Elapsed Time: ${elapsedTime}s)`
            );
            return imagePath;
        } else {
            throw new Error(
                `Image generation failed: ${response.status} - ${response.data.toString()}`
            );
        }
    } catch (error) {
        console.error("Error generating image:", error);
        throw error;
    }
}

// Function to generate a 3D model from an image (new endpoint + debug logs)
async function generate3DModel(prompt) {
    const apiUrl = "https://api.stability.ai/v2beta/3d/stable-fast-3d";

    const startTime = Date.now();
    try {
        // Generate the image first
        const inputImageStartTime = Date.now();
        const inputImagePath = await generateImage(prompt);
        const inputImageElapsedTime = (Date.now() - inputImageStartTime) / 1000;

        // Ensure the image path is correct
        console.log(`Using generated image: ${inputImagePath}`);

        // Set up the form data for the 3D model generation request
        const formData = new FormData();
        formData.append("image", fs.createReadStream(inputImagePath));
        formData.append("texture_resolution", "512");
        formData.append("foreground_ratio", "0.7");

        const modelStartTime = Date.now();

        // Make the POST request to the Stability AI 3D model generation API
        const response = await axios.post(apiUrl, formData, {
            headers: {
                Authorization: `Bearer ${stabilityAIKey}`,
                ...formData.getHeaders(),
            },
            responseType: "arraybuffer", // Expect a binary blob response
        });

        // Check if the response is successful
        if (response.status === 200) {
            const sanitizedFileName = `gen_${sanitizeFileName(prompt)}.glb`;
            const outputPath = path.resolve(__dirname, "models", sanitizedFileName);
            fs.writeFileSync(outputPath, Buffer.from(response.data));
            const modelElapsedTime = (Date.now() - modelStartTime) / 1000;
            const totalElapsedTime = (Date.now() - startTime) / 1000;

            console.log(`3D model generated successfully at: ${outputPath}`);
            console.log(
                `Elapsed Time - Image Generation: ${inputImageElapsedTime}s, Model Generation: ${modelElapsedTime}s, Total: ${totalElapsedTime}s`
            );

            return outputPath; // Return the path to the generated model
        } else {
            throw new Error(
                `3D model generation failed: ${response.status} - ${response.data.toString()}`
            );
        }
    } catch (error) {
        console.error("Error generating 3D model:", error);
        throw error;
    }
}

// Export the generate3DModel function
export { generate3DModel };