import { askUserQuestionTool } from "../tools/askUserQuestion.js";
import { executePythonScriptTool } from "../tools/executePythonScript.js";
import { readFileTool } from "../tools/readFile.js";
import { writeFileTool } from "../tools/writeFile.js";

export const toolRegistry = {
    readFile: readFileTool,
    writeFile: writeFileTool,
    executePythonScript: executePythonScriptTool,
    askUserQuestion: askUserQuestionTool
};
