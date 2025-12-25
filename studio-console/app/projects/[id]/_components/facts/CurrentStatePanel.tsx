"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import ReactMarkdown from "react-markdown";

export function CurrentStatePanel({ projectId }: { projectId: Id<"projects"> }) {
  const blocks = useQuery(api.facts.listBlocks, { projectId });

  if (!blocks) return <div className="text-xs text-gray-500">Loading state...</div>;

  // Group blocks by scope (Project vs Items)
  const projectBlocks = blocks.filter((b) => b.scopeType === "project");
  const itemBlocks = blocks.filter((b) => b.scopeType === "item");

  // Sort blocks by key for stability
  projectBlocks.sort((a, b) => a.blockKey.localeCompare(b.blockKey));
  itemBlocks.sort((a, b) => {
    if (a.itemId !== b.itemId) return (a.itemId || "").localeCompare(b.itemId || "");
    return a.blockKey.localeCompare(b.blockKey);
  });

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="p-3 border-b bg-gray-50">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">Current State</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {projectBlocks.length > 0 && (
          <div>
            <h4 className="text-sm font-bold text-gray-900 mb-2 border-b pb-1">Project Level</h4>
            <div className="space-y-4">
              {projectBlocks.map((block) => (
                <div key={block._id} className="prose prose-sm max-w-none">
                  <ReactMarkdown>{block.renderedMarkdown}</ReactMarkdown>
                  <div className="text-[10px] text-gray-400 mt-1 text-right">
                    Rev {block.revision} • {new Date(block.updatedAt).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {itemBlocks.length > 0 && (
          <div>
            <h4 className="text-sm font-bold text-gray-900 mb-2 border-b pb-1 mt-6">Items</h4>
            <div className="space-y-4">
              {itemBlocks.map((block) => (
                <div key={block._id} className="prose prose-sm max-w-none">
                  <div className="text-xs font-mono text-gray-500 mb-1">Item: {block.itemId}</div>
                  <ReactMarkdown>{block.renderedMarkdown}</ReactMarkdown>
                  <div className="text-[10px] text-gray-400 mt-1 text-right">
                    Rev {block.revision} • {new Date(block.updatedAt).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {blocks.length === 0 && (
          <div className="text-xs text-gray-400 text-center py-8">
            No knowledge blocks yet. Start chatting or answering questions to generate facts.
          </div>
        )}
      </div>
    </div>
  );
}
