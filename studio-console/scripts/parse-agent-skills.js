const fs = require("fs");
const path = require("path");

const sourcePath = path.resolve(
    __dirname,
    "../../Specs/Agent/magnetic_studio_skills_prompts_v2_with_images.md"
);
const outputPath = path.resolve(__dirname, "../convex/skills/agentSkills.generated.json");

function parseSection(sectionText) {
    const [headingLine, ...rest] = sectionText.split("\n");
    const body = rest.join("\n");
    const skillKey = headingLine.trim().split(/\s+/)[0];
    if (!skillKey) return null;

    const stageMatch = body.match(/- \*\*Stage:\*\*\s*([^\n]+)/);
    const channelMatch = body.match(/- \*\*Channel:\*\*\s*([^\n]+)/);
    const toolsMatch = body.match(/- \*\*Allowed tools:\*\*\s*([^\n]+)/);

    const inputMatch = body.match(/### Input Schema[^\n]*\n```json\s*([\s\S]*?)\s*```/);
    const outputMatch = body.match(/### Output Schema[^\n]*\n```json\s*([\s\S]*?)\s*```/);
    const promptMatch = body.match(/### Prompt \(FULL\)\s*\n```text\s*([\s\S]*?)\s*```/);
    const guidelinesMatch = body.match(/### Guidelines\s*\n([\s\S]*?)(?:\n---|\n##|$)/);

    const allowedToolsRaw = toolsMatch ? toolsMatch[1].trim() : "";
    const allowedTools =
        !allowedToolsRaw || allowedToolsRaw.toLowerCase() === "none"
            ? []
            : allowedToolsRaw.split(",").map((item) => item.trim()).filter(Boolean);

    return {
        skillKey,
        stage: stageMatch ? stageMatch[1].trim() : "",
        channel: channelMatch ? channelMatch[1].trim() : "",
        allowedTools,
        inputSchema: inputMatch ? inputMatch[1].trim() : "",
        outputSchema: outputMatch ? outputMatch[1].trim() : "",
        prompt: promptMatch ? promptMatch[1].trim() : "",
        guidelines: guidelinesMatch ? guidelinesMatch[1].trim() : "",
    };
}

const raw = fs.readFileSync(sourcePath, "utf8");
const sections = raw.split(/^##\s+/m).slice(1);
const skills = sections
    .map((section) => parseSection(section))
    .filter(Boolean);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(skills, null, 2));

console.log(`Wrote ${skills.length} skills to ${outputPath}`);
