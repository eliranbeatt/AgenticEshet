import { MutationCtx } from "../../_generated/server";
import { Id } from "../../_generated/dataModel";
import { FACT_KEY_REGISTRY } from "../facts/registry";

export async function patchBlocks(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  facts: { key: string; value: any; scopeType: "project" | "item"; itemId?: Id<"projectItems"> | null; _id: Id<"facts"> }[]
) {
  const updatesByBlock = new Map<string, any[]>();

  for (const fact of facts) {
    const def = FACT_KEY_REGISTRY[fact.key];
    if (!def) continue;

    const blockKey = def.blockKey;
    const scopeKey = fact.scopeType === "project" ? "project" : `item:${fact.itemId}`;
    const uniqueBlockId = `${scopeKey}|${blockKey}`;

    if (!updatesByBlock.has(uniqueBlockId)) {
      updatesByBlock.set(uniqueBlockId, []);
    }
    updatesByBlock.get(uniqueBlockId)!.push(fact);
  }

  for (const [uniqueBlockId, blockFacts] of updatesByBlock) {
    const [scopeKey, blockKey] = uniqueBlockId.split("|");
    const isProject = scopeKey === "project";
    const itemId = isProject ? null : (scopeKey.split(":")[1] as Id<"projectItems">);

    let block = null;
    if (isProject) {
        block = await ctx.db
            .query("knowledgeBlocks")
            .withIndex("by_scope_block", (q) => 
                q.eq("projectId", projectId)
                 .eq("scopeType", "project")
                 .eq("itemId", null)
                 .eq("blockKey", blockKey)
            )
            .first();
    } else {
        block = await ctx.db
            .query("knowledgeBlocks")
            .withIndex("by_scope_block", (q) => 
                q.eq("projectId", projectId)
                 .eq("scopeType", "item")
                 .eq("itemId", itemId as Id<"projectItems">)
                 .eq("blockKey", blockKey)
            )
            .first();
    }

    let json = block ? block.json : {};
    
    for (const fact of blockFacts) {
        const fieldName = fact.key.split(".").pop();
        if (fieldName) {
            json[fieldName] = {
                value: fact.value,
                factId: fact._id
            };
        }
    }

    const markdown = renderMarkdown(blockKey, json);

    if (block) {
        await ctx.db.patch(block._id, {
            json,
            renderedMarkdown: markdown,
            revision: block.revision + 1,
            updatedAt: Date.now(),
            updatedBy: { type: "system" }
        });
    } else {
        await ctx.db.insert("knowledgeBlocks", {
            projectId,
            scopeType: isProject ? "project" : "item",
            itemId: itemId || null,
            blockKey,
            json,
            renderedMarkdown: markdown,
            revision: 1,
            updatedAt: Date.now(),
            updatedBy: { type: "system" }
        });
    }
  }
}

function renderMarkdown(blockKey: string, json: any): string {
    let md = `### ${blockKey}\n\n`;
    for (const [key, val] of Object.entries(json)) {
        const v = (val as any).value;
        if (v !== null && v !== undefined) {
            let displayValue = v;
            if (typeof v === "object") {
                if ("value" in v && "unit" in v) {
                    displayValue = `${v.value} ${v.unit}`;
                } else if ("min" in v && "max" in v) {
                    displayValue = `${v.min}-${v.max}`;
                } else if ("iso" in v) {
                    displayValue = v.iso;
                } else {
                    displayValue = JSON.stringify(v);
                }
            }
            md += `- **${key}**: ${displayValue}\n`;
        }
    }
    return md;
}
