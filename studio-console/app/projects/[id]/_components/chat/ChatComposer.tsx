"use client";

import { useState } from "react";

export function ChatComposer({
    placeholder,
    disabled,
    onSend,
}: {
    placeholder?: string;
    disabled?: boolean;
    onSend: (content: string) => Promise<void>;
}) {
    const [input, setInput] = useState("");
    const [isSending, setIsSending] = useState(false);

    const send = async () => {
        const trimmed = input.trim();
        if (!trimmed || disabled || isSending) return;
        setIsSending(true);
        try {
            await onSend(trimmed);
            setInput("");
        } finally {
            setIsSending(false);
        }
    };

    return (
        <div className="border-t bg-white p-3">
            <div className="flex gap-2 items-end">
                <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder={placeholder ?? "Write a message…"}
                    className="flex-1 border rounded px-3 py-2 text-sm min-h-[44px] max-h-40 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={disabled || isSending}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            void send();
                        }
                    }}
                />
                <button
                    type="button"
                    onClick={() => void send()}
                    disabled={disabled || isSending || !input.trim()}
                    className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
                >
                    {isSending ? "Sending…" : "Send"}
                </button>
            </div>
            <div className="text-[11px] text-gray-500 mt-2">Enter to send, Shift+Enter for newline.</div>
        </div>
    );
}

