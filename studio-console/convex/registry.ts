import { query } from "./_generated/server";
import { ELEMENT_TYPES_V1, COMMON_FIELDS_V1, FREE_TEXT_BUCKETS_V1 } from "./lib/elementRegistry";

export const getElementRegistry = query({
    args: {},
    handler: async () => {
        return {
            elementTypes: ELEMENT_TYPES_V1,
            fields: COMMON_FIELDS_V1,
            buckets: FREE_TEXT_BUCKETS_V1,
        };
    },
});
