"use client";

import { useAction, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Doc, Id } from "../../../../../convex/_generated/dataModel";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatComposer } from "./ChatComposer";
import { useThinkingMode } from "../../../../_context/ThinkingModeContext";
import { useModel } from "../../../../_context/ModelContext";

function MessageBubble({ message }: { message: Doc<"chatMessages"> }) {
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
                className={`${base} ${
                    isUser
                        ? "bg-blue-600 text-white border-blue-700"
                        : message.status === "error"
                          ? "bg-red-50 text-red-800 border-red-200"
                          : "bg-white text-gray-900 border-gray-200"
                }`}
            >
                <div dir="rtl">
                    {isUser ? message.content : <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>}
                </div>
                {message.status === "streaming" && <div className="text-[10px] text-gray-400 mt-1">Streaming...</div>}
            </div>
        </div>
    );
}

export function AgentChatThread({
    threadId,
    placeholder,
    systemPrompt,
    onSend,
    onUpload,
    heightClassName,
}: {
    threadId: Id<"chatThreads">;
    placeholder?: string;
    systemPrompt?: string;
    onSend?: (content: string) => Promise<void>;
    onUpload?: (file: File) => Promise<string>;
    heightClassName?: string;
}) {
    const messages = useQuery(api.chat.listMessages, { threadId }) as Array<Doc<"chatMessages">> | undefined;
    const sendAndStreamText = useAction(api.chat.sendAndStreamText);
    const { thinkingMode } = useThinkingMode();
    const { selectedModel } = useModel();

    const isLoading = messages === undefined;

    return (
        <div className={`flex flex-col bg-white rounded shadow-sm border ${heightClassName ?? "h-[520px]"}`}>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {isLoading ? (
                    <div className="text-sm text-gray-500">Loading...</div>
                ) : messages.length === 0 ? (
                    <div className="text-sm text-gray-500">No messages yet.</div>
                ) : (
                    messages.map((message) => <MessageBubble key={message._id} message={message} />)
                )}
            </div>

            <ChatComposer
                placeholder={placeholder}
                disabled={isLoading}
                onUpload={onUpload}
                onSend={async (content) => {
                    if (onSend) {
                        await onSend(content);
                        return;
                    }
                    if (!systemPrompt) {
                        throw new Error("systemPrompt is required when onSend is not provided");
                    }
                    await sendAndStreamText({
                        threadId,
                        userContent: content,
                        systemPrompt,
                        model: selectedModel,
                        thinkingMode,
                    });
                }}
            />
        </div>
    );
}
