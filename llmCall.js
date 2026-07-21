import dotenv from "dotenv";
dotenv.config({ path: ".env" });

const LLM_URL = process.env.LLM_URL || "https://api.openai.com/v1/chat/completions";
const API_KEY = process.env.OPENAI_API_KEY;

export async function callLLM(messages, tools=[]) {
    console.info("Calling LLM with messages:", messages);

    const response = await fetch(LLM_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: messages,
            tools: tools
        })
    });
    const data = await response.json();
    return data;
}