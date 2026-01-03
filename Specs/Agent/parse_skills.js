const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, 'magnetic_studio_skills_prompts_v2_with_images.md');
const OUTPUT_FILE = path.join(__dirname, '../../studio-console/convex/skills/agentSkills.generated.json');

function parseMarkdown(content) {
    // Split by "## " at start of line
    const parts = content.split(/^## /gm);
    const skills = [];

    // Skip first part if it's just frontmatter/title
    const startIdx = parts[0].includes("skillKey") ? 0 : 1;

    for (let i = startIdx; i < parts.length; i++) {
        let block = parts[i];
        
        // 1. Skill Key & Name
        // Format: "skillKey — Name"
        const headerMatch = block.match(/^([\w\.]+)\s+[—–-]\s+(.*)$/m);
        if (!headerMatch) {
            // console.log("Skipping block without valid header:", block.substring(0, 50));
            continue;
        }
        const skillKey = headerMatch[1].trim();
        const name = headerMatch[2].trim();

        // 2. Metadata
        const stageMatch = block.match(/- \*\*Stage:\*\*\s+(.*)$/m);
        const channelMatch = block.match(/- \*\*Channel:\*\*\s+(.*)$/m);
        const toolsMatch = block.match(/- \*\*Allowed tools:\*\*\s+(.*)$/m);

        const stage = stageMatch ? stageMatch[1].trim() : "";
        const channel = channelMatch ? channelMatch[1].trim() : "";
        const allowedTools = toolsMatch ? toolsMatch[1].split(',').map(s => s.trim()).filter(Boolean) : [];

        // 3. Schemas
        // Robust match for code blocks
        const inputSchemaMatch = block.match(/### Input Schema[\s\S]*?```json\s*([\s\S]*?)```/);
        const outputSchemaMatch = block.match(/### Output Schema[\s\S]*?```json\s*([\s\S]*?)```/);

        const inputSchema = inputSchemaMatch ? inputSchemaMatch[1].trim() : "";
        const outputSchema = outputSchemaMatch ? outputSchemaMatch[1].trim() : "";

        // 4. Prompt
        // Prompt is between "### Prompt Template" or "### Prompt (FULL)" and "### Guidelines"
        const promptMatch = block.match(/### Prompt(?: \(FULL\)| Template)?\s*([\s\S]*?)(?=\r?\n### Guidelines|\r?\n---|$)/);
        let prompt = promptMatch ? promptMatch[1].trim() : "";

        // 5. Guidelines
        const guidelinesMatch = block.match(/### Guidelines\s*([\s\S]*?)(?=\r?\n---|$)/);
        let guidelines = guidelinesMatch ? guidelinesMatch[1].trim() : "";

        skills.push({
            skillKey,
            // name, 
            stage,
            channel,
            allowedTools,
            inputSchema,
            outputSchema,
            prompt,
            guidelines
        });
    }

    return skills;
}

const content = fs.readFileSync(INPUT_FILE, 'utf8');
const skills = parseMarkdown(content);

console.log(`Parsed ${skills.length} skills.`);
// Check first skill to ensure it parsed correctly
if (skills.length > 0) {
    console.log("First skill:", skills[0].skillKey);
    console.log("Has Prompt?", !!skills[0].prompt);
    console.log("Has Input Schema?", !!skills[0].inputSchema);
    console.log("Has Output Schema?", !!skills[0].outputSchema);
}

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(skills, null, 2));
console.log(`Wrote to ${OUTPUT_FILE}`);
