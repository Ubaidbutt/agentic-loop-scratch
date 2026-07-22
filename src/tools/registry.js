import { askUserQuestionTool } from "./askUserQuestion.js";
import { executePythonScriptTool } from "./executePythonScript.js";
import { readFileTool } from "./readFile.js";
import { writeFileTool } from "./writeFile.js";

export const toolRegistry = {
    readFile: readFileTool,
    writeFile: writeFileTool,
    executePythonScript: executePythonScriptTool,
    askUserQuestion: askUserQuestionTool
};
