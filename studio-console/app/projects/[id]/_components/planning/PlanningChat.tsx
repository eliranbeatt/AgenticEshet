"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useItemsContext } from "../items/ItemsContext";
import { ChatComposer } from "../chat/ChatComposer";
import { useModel } from "@/app/_context/ModelContext";
import { useThinkingMode } from "@/app/_context/ThinkingModeContext";

function MessageBubble({ message }: { message: Doc<"conversationMessages"> }) {
    const isUser = message.role === "user";
    const isSystem = message.role === "system";
    const base = "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap border shadow-sm";

    if (isSystem) {
        return (
            <div className="flex justify-center">
                <div className="max-w-[90%] rounded border border-red-200 bg-red-50 text-red-800 px-3 py-2 text-xs">
                    {message.content}
                </div>
            </div>
        );
    }

    return (
        <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
            <div
                className={`${base} ${isUser ? "bg-blue-600 text-white border-blue-700" : "bg-white text-gray-900 border-gray-200"
                    }`}
            >
                <div dir="rtl">
                    {isUser ? message.content : <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>}
                </div>
            </div>
        </div>
    );
}

export function PlanningChat() {
    const { projectId, selectedItemIds, selectedAllProject } = useItemsContext();
    const { selectedModel } = useModel();
    const { thinkingMode } = useThinkingMode();
    const [conversationId, setConversationId] = useState<Id<"projectConversations"> | null>(null);

    // List conversations to find the active planning one
    const conversations = useQuery(api.projectConversations.list, {
        projectId,
        stageTag: "planning",
        includeArchived: false,
    });

    const createConversation = useMutation(api.projectConversations.create);
    const setContext = useMutation(api.projectConversations.setContext);
    const sendMessage = useAction(api.projectConversations.sendMessage);

    const creationAttempted = useRef(false);

    // Initialize or select conversation
    useEffect(() => {
        if (conversations === undefined) return; // Loading
        
        if (conversationId) return; // Already selected

        if (conversations.length > 0) {
            // Pick the most recent one
            setTimeout(() => setConversationId(conversations[0]._id), 0);
        } else if (!creationAttempted.current) {
            // Create one if none exist
            creationAttempted.current = true;
            const createFn = async () => {
                 try {
                     const result = await createConversation({
                        projectId,
                        stageTag: "planning",
                        defaultChannel: "free",
                        title: "Planning Chat",
                     });
                     setConversationId(result.conversationId);
                 } catch (e) {
                     console.error("Failed to auto-create conversation", e);
                     creationAttempted.current = false; // Retry on next render if failed
                 }
            };
            void createFn();
        }
    }, [conversations, conversationId, projectId, createConversation]);

    const messages = useQuery(
        api.projectConversations.listMessages,
        conversationId ? { projectId, conversationId } : "skip"
    );

    // Sync Context Selection
    useEffect(() => {
        if (!conversationId) return;

        const syncContext = async () => {
            let mode: "all" | "selected" | "none" = "none";
            if (selectedAllProject) mode = "all";
            else if (selectedItemIds.length > 0) mode = "selected";

            // We should probably check if update is needed to avoid redundant calls, 
            // but we don't have the current conversation object loaded here easily without another query.
            // For now, we trust Convex deduping or just call it. 
            // Optimally: fetch conversation and check contextElementIds match.
            
            await setContext({
                conversationId,
                contextMode: mode,
                contextElementIds: selectedItemIds,
            });
        };

        const timeout = setTimeout(syncContext, 500); // Debounce
        return () => clearTimeout(timeout);
    }, [conversationId, selectedAllProject, selectedItemIds, setContext]);


    return (
        <div className="flex flex-col h-full bg-white border rounded-lg shadow-sm overflow-hidden">
             {/* Header */}
             <div className="p-3 border-b bg-gray-50/50">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Planning Chat
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {!messages ? (
                    <div className="text-sm text-gray-500 text-center mt-10">Loading chat...</div>
                ) : messages.length === 0 ? (
                    <div className="text-sm text-gray-400 text-center mt-10">
                        Start planning by typing a message or selecting elements.
                    </div>
                ) : (
                    messages.map((message) => <MessageBubble key={message._id} message={message} />)
                )}
            </div>

            {/* Input */}
            <div className="p-0">
                <ChatComposer
                    placeholder="Ask about the plan, budget, or timeline..."
                    disabled={!conversationId}
                    onSend={async (content) => {
                        if (!conversationId) return;
                        await sendMessage({
                            projectId,
                            conversationId,
                            userContent: content,
                            model: selectedModel,
                            thinkingMode,
                        });
                    }}
                />
            </div>
        </div>
    );
}
