"use client";

import { useState } from "react";

export function ChatComposer({
    placeholder,
    disabled,
    onSend,
    onUpload,
}: {
    placeholder?: string;
    disabled?: boolean;
    onSend: (content: string) => Promise<void>;
    onUpload?: (file: File) => Promise<string>;
}) {
    const [input, setInput] = useState("");
    const [isSending, setIsSending] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

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

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !onUpload) return;
        setIsUploading(true);
        try {
            const markdown = await onUpload(file);
            setInput((prev) => (prev ? prev + "\n" + markdown : markdown));
        } catch (error) {
            console.error(error);
            alert("Upload failed");
        } finally {
            setIsUploading(false);
            e.target.value = "";
        }
    };

    return (
        <div className="border-t bg-white p-3">
            <div className="flex gap-2 items-end">
                {onUpload && (
                    <label className={`cursor-pointer p-2 text-gray-500 hover:text-gray-700 ${isUploading ? "opacity-50 pointer-events-none" : ""}`}>
                        <input type="file" className="hidden" onChange={handleFileChange} disabled={isUploading || disabled} />
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
                        </svg>
                    </label>
                )}
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

