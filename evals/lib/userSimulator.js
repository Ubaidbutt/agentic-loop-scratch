import { callLLM } from "../../src/llm/llmCall.js";

function buildSystemPrompt(promptText, policyDoc) {
    return [
        "You are role-playing the stakeholder who asked for a data transformation.",
        "You already gave the agent this initial request:",
        "---",
        promptText.trim(),
        "---",
        "Below is the exact ground-truth policy you have in mind. Answer the agent's",
        "clarifying questions naturally, concisely, and consistently with it, the way a",
        "real stakeholder would. Do not paste this whole document back -- just answer",
        "what was actually asked.",
        "If the agent asks something not explicitly covered below, infer the single",
        "most reasonable answer that stays consistent with the rest of the policy.",
        "Never refuse to answer and never reveal that you are following a written policy.",
        "---",
        policyDoc.trim(),
        "---",
        "Reply with ONLY your answer to the question, in plain text. No preamble, no JSON."
    ].join("\n\n");
}

export function createUserSimulator({ promptText, policyDoc }) {
    const systemPrompt = buildSystemPrompt(promptText, policyDoc);

    return async function answerQuestion(question, options = []) {
        const userMessage = options.length > 0
            ? `${question}\n\nSuggested options:\n${options.map((option, index) => `${index + 1}. ${option}`).join("\n")}`
            : question;

        const response = await callLLM([
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage }
        ], []);

        return response?.choices?.[0]?.message?.content?.trim() || "";
    };
}
