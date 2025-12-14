import { httpRouter } from "convex/server";
import { webhook as whatsappWebhook } from "./whatsapp";

const http = httpRouter();

http.route({
  path: "/whatsapp",
  method: "POST",
  handler: whatsappWebhook,
});

// We can also add the email webhook here if we wanted to handle it purely in Convex,
// but we implemented it as a Next.js API route which is also fine.
// Next.js API route is better if we need to use Node.js specific libraries for parsing.

export default http;
