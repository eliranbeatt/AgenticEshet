const { z } = require("zod");
try {
    console.log("z.toJSONSchema type:", typeof z.toJSONSchema);
} catch (e) {
    console.error(e);
}
