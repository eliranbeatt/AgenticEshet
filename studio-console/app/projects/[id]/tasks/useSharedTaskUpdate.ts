import { useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";

export type SharedTaskUpdateInput = {
    taskId: Id<"tasks">;
    status?: Doc<"tasks">["status"];
    startDate?: number;
    endDate?: number;
};

export function useSharedTaskUpdateAction() {
    const updateTask = useMutation(api.tasks.updateTask);

    return useCallback(
        async (input: SharedTaskUpdateInput) => {
            await updateTask(input);
        },
        [updateTask]
    );
}
