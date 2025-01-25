import axios from "axios";
import FormData from "form-data";
import * as fs from "fs";
import * as path from "path";

// ------------------------------------------------------------------------------------------
// Retrieve API keys from gitIgnored apiKeys.json to allow safe GIT pushing
// ------------------------------------------------------------------------------------------
const apiKeysPath = path.resolve(__dirname, '../src/apiKeys.json');
const apiKeys = JSON.parse(fs.readFileSync(apiKeysPath, 'utf8'));

const stabilityAIKey: string = apiKeys.StabilityAI;
const openAIKey: string = apiKeys.OpenAI;
const githubToken: string = apiKeys.GitHub;

// Debug prints
console.log('StabilityAI Key:', stabilityAIKey);
console.log('OpenAI Key:', openAIKey);
// ------------------------------------------------------------------------------------------

const promptModifierImagePath = path.resolve(__dirname, '../src/promptModifier_ImageGenerator.txt');
const promptModifierImage = fs.readFileSync(promptModifierImagePath, 'utf8');

// Function to sanitize file name
function sanitizeFileName(input: string): string {
    console.log(`Sanitizing file name for: ${input}`);
    return input.trim().replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
}

// Function to optimize prompt using OpenAI API
async function optimizePrompt(inputPrompt: string, modifier: string): Promise<string> {
    console.log(`Optimizing prompt: ${inputPrompt}`);
    const apiUrl = "https://api.openai.com/v1/chat/completions";
    try {
        const response = await axios.post(
            apiUrl,
            {
                model: "gpt-4",
                messages: [
                    { role: "system", content: modifier },
                    { role: "user", content: inputPrompt }
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
async function generateImage(prompt: string): Promise<string> {
    console.log(`Generating image for prompt: ${prompt}`);
    const apiUrl = "https://api.stability.ai/v2beta/stable-image/generate/core";

    // Optimize the prompt using OpenAI API
    const optimizedPrompt = await optimizePrompt(prompt, promptModifierImage);

    const startTime = Date.now();
    try {
        const payload = { prompt: optimizedPrompt, output_format: "png" };
        const formData = new FormData();
        for (const [key, value] of Object.entries(payload)) {
            formData.append(key, value);
        }

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
            console.log(`Image generated successfully at: ${imagePath} (Elapsed Time: ${elapsedTime}s)`);
            return imagePath;
        } else {
            throw new Error(`Image generation failed: ${response.status} - ${response.data.toString()}`);
        }
    } catch (error) {
        console.error("Error generating image:", error);
        throw error;
    }
}

// Function to retrieve file SHA from GitHub
async function getFileSha(): Promise<string | null> {
    console.log("Retrieving file SHA from GitHub...");
    try {
        const url = "https://api.github.com/repos/V4C38/mit-stairway-hackers-models/contents/docs/generated_model.glb";
        const response = await axios.get(url, {
            headers: { Authorization: `Bearer ${githubToken}` },
        });
        console.log(`File SHA retrieved: ${response.data.sha}`);
        return response.data.sha || null;
    } catch (error) {
        if (axios.isAxiosError(error) && error.response && error.response.status === 404) {
            console.log("File not found on GitHub (404). Returning null.");
            return null;
        }
        console.error("Failed to retrieve file SHA:", error);
        throw error;
    }
}

// Function to upload generated model to GitHub
async function uploadToGitHub(filePath: string) {
    console.log(`Uploading ${filePath} to GitHub...`);
    const content = fs.readFileSync(filePath).toString("base64");
    const sha = await getFileSha();

    const payload: Record<string, any> = {
        message: "Update Model",
        content, // base64-encoded
        branch: "main"
    };

    if (sha) {
        payload.sha = sha;
        console.log(`Using existing SHA: ${sha}`);
    } else {
        console.log("No existing file found; creating new.");
    }

    try {
        await axios.put(
            "https://api.github.com/repos/V4C38/mit-stairway-hackers-models/contents/docs/generated_model.glb",
            payload,
            {
                headers: {
                    Authorization: `Bearer ${githubToken}`,
                    "Content-Type": "application/json",
                },
            }
        );
        console.log("Model successfully uploaded to GitHub.");
    } catch (error) {
        console.error("Failed to upload model to GitHub:", error);
        throw error;
    }
}

// Function to generate a 3D model
export async function generate3DModel(prompt: string): Promise<string> {
    console.log(`Generating 3D model for prompt: ${prompt}`);
    const apiUrl = "https://api.stability.ai/v2beta/3d/stable-fast-3d";

    const startTime = Date.now();
    try {
        const inputImagePath = await generateImage(prompt);
        console.log(`Using generated image: ${inputImagePath}`);

        const formData = new FormData();
        formData.append("image", fs.createReadStream(inputImagePath));
        formData.append("texture_resolution", "512");
        formData.append("foreground_ratio", "0.7");

        const response = await axios.post(apiUrl, formData, {
            headers: {
                Authorization: `Bearer ${stabilityAIKey}`,
                ...formData.getHeaders(),
            },
            responseType: "arraybuffer",
        });

        if (response.status === 200) {
            const sanitizedFileName = `gen_${sanitizeFileName(prompt)}.glb`;
            const outputPath = path.resolve(__dirname, sanitizedFileName);
            fs.writeFileSync(outputPath, Buffer.from(response.data));
            fs.renameSync(outputPath, "generated_model.glb");

            console.log(`3D model generated successfully at: generated_model.glb`);
            await uploadToGitHub("generated_model.glb");

            const elapsedTime = (Date.now() - startTime) / 1000;
            console.log(`Total Elapsed Time: ${elapsedTime}s`);
            return "generated_model.glb";
        } else {
            throw new Error(`3D model generation failed: ${response.status} - ${response.data.toString()}`);
        }
    } catch (error) {
        console.error("Error generating 3D model:", error);
        throw error;
    }
}

// TESTING - Auto Generate Model
(async () => {
    const inputPrompt = process.argv[2] || "a friendly squirrel with a yellow hat and red sunglasses. it smiles nicely and is very (!!!) cute.";
    try {
        const modelPath = await generate3DModel(inputPrompt);
        console.log(`3D Model saved at: ${modelPath}`);
    } catch (error) {
        console.error("Failed to generate 3D model:", error);
    }
})();
