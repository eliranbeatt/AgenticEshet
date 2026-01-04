import json
import re

file_path = r'c:\Users\elira\Downloads\agentSkills.emilyStudio.v2.generated.json'
output_path = r'c:\Users\elira\Downloads\agentSkills.emilyStudio.v2.generated.json'
project_file_path = r'c:\Users\elira\Dev\AgenticEshet\studio-console\convex\skills\agentSkills.generated.json'

try:
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
except FileNotFoundError:
    # If the download file is not found (maybe moved?), try reading from the project file if it has the original content?
    # But usually the user said they provided the file.
    # Let's assume it exists as I just read it.
    print(f"File not found: {file_path}")
    exit(1)

# Check if already processed (is it a dict with 'globalPrompt'?)
if isinstance(data, dict) and 'globalPrompt' in data:
    print("File already seems processed. Retrying from source or exiting.")
    # If it is already processed, we can't strip again easily unless we reconstruct.
    # But wait, the user said "file NOT changed", implying it is NOT processed in their view.
    # If I read it and it IS processed, I should just copy it to the project file.
    
    # Let's just write this data to the project file and be done.
    with open(project_file_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Copied existing processed data to {project_file_path}")
    exit(0)

# Identify Global Prompt from the first item
first_prompt = data[0]['prompt']
global_end_marker = "If a schema requires options arrays, always include them (use [] when not relevant).\n\n"
global_split = first_prompt.find(global_end_marker)

if global_split == -1:
    print("Could not find global prompt split point in first item.")
    # Fallback: maybe it's just the top X lines?
    # But we need to be precise.
    exit(1)

global_prompt = first_prompt[:global_split + len(global_end_marker)]

category_prompts = {}
skills_processed = []

for item in data:
    original_prompt = item['prompt']
    
    # 1. Check/Remove Global Prompt
    # We use replace for safety, or slicing if we are sure.
    if original_prompt.startswith(global_prompt):
        remainder = original_prompt[len(global_prompt):]
    else:
        # fuzzy match or just keep as is?
        # If it doesn't match, we can't strip it safely.
        # But we must strip it.
        # Let's try to find the end marker.
        split_idx = original_prompt.find(global_end_marker)
        if split_idx != -1:
             remainder = original_prompt[split_idx + len(global_end_marker):]
        else:
             remainder = original_prompt

    # 2. Identify Stage Overlay
    # Pattern: Starts with "STAGE OVERLAY" and goes until "SKILL"
    skill_marker = "\nSKILL\n"
    skill_split = remainder.find(skill_marker)
    
    if skill_split == -1:
        category_prompt_text = ""
        specific_prompt_text = remainder
    else:
        category_prompt_text = remainder[:skill_split]
        specific_prompt_text = remainder[skill_split:] # Includes SKILL...
        
        if specific_prompt_text.startswith("\n"):
             specific_prompt_text = specific_prompt_text[1:]

    # Store Category Prompt
    stage = item.get('stage')
    if stage and category_prompt_text:
        if stage not in category_prompts:
            category_prompts[stage] = category_prompt_text

    item['prompt'] = specific_prompt_text
    skills_processed.append(item)


new_structure = {
    "globalPrompt": global_prompt,
    "categoryPrompts": category_prompts,
    "skills": skills_processed
}

# Write to both locations
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(new_structure, f, indent=2, ensure_ascii=False)

with open(project_file_path, 'w', encoding='utf-8') as f:
    json.dump(new_structure, f, indent=2, ensure_ascii=False)

print("Done processing and updated both files.")
