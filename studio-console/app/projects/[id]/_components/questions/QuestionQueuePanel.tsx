"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function QuestionQueuePanel({ projectId }: { projectId: Id<"projects"> }) {
    const questions = useQuery(api.questionQueue.listQuestions, { projectId, status: "open" });
    const answerQuestion = useMutation(api.questionQueue.answerQuestion);
    const dismissQuestion = useMutation(api.questionQueue.dismissQuestion);

    const [drafts, setDrafts] = useState<Record<string, string>>({});

    if (!questions) {
        return <div className="text-xs text-gray-500">Loading questions...</div>;
    }

    if (questions.length === 0) {
        return <div className="text-xs text-gray-400 text-center py-4">No open questions.</div>;
    }

    return (
        <div className="p-3 space-y-3">
            {questions.map((question) => {
                const draftValue = drafts[question._id] ?? "";
                const isSelect = question.answerType === "select" || question.answerType === "multiselect";
                const isYesNo = question.answerType === "yesno";
                const inputType = question.answerType === "number" ? "number" : question.answerType === "date" ? "date" : "text";

                return (
                    <div key={question._id} className="border rounded p-3 text-xs bg-white">
                        <div className="font-semibold text-gray-900">{question.questionTextHe}</div>
                        <div className="text-[10px] text-gray-500 mt-1">{question.categoryHe}</div>

                        <div className="mt-2">
                            {isYesNo ? (
                                <div className="flex gap-2">
                                    {["??", "??"].map((label) => (
                                        <button
                                            key={label}
                                            type="button"
                                            onClick={() => setDrafts((prev) => ({ ...prev, [question._id]: label }))}
                                            className={`px-2 py-1 rounded border text-[10px] ${
                                                draftValue === label ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600"
                                            }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            ) : isSelect ? (
                                <select
                                    className="border rounded p-1 text-[10px] w-full"
                                    value={draftValue}
                                    onChange={(event) => setDrafts((prev) => ({ ...prev, [question._id]: event.target.value }))}
                                >
                                    <option value="">Select...</option>
                                    {(question.optionsHe ?? []).map((option) => (
                                        <option key={option} value={option}>
                                            {option}
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                <input
                                    type={inputType}
                                    className="border rounded p-1 text-[10px] w-full"
                                    value={draftValue}
                                    onChange={(event) => setDrafts((prev) => ({ ...prev, [question._id]: event.target.value }))}
                                />
                            )}
                        </div>

                        <div className="flex justify-end gap-2 mt-2">
                            <button
                                type="button"
                                onClick={() => dismissQuestion({ questionId: question._id })}
                                className="px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                            >
                                Dismiss
                            </button>
                            <button
                                type="button"
                                disabled={!draftValue}
                                onClick={() =>
                                    answerQuestion({
                                        questionId: question._id,
                                        answer: isYesNo ? draftValue === "??" : draftValue,
                                    })
                                }
                                className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                            >
                                Answer
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
