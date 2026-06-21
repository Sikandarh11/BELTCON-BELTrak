import { createStart, createMiddleware } from "@tanstack/react-start";

import frontPageHtml from "./front-page.html?raw";
import { renderErrorPage } from "./lib/error-page";
import { authMiddleware } from "./middleware/authMiddleware";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

const frontpageMiddleware = createMiddleware().server(async ({ next, request }) => {
  try {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(frontPageHtml, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  } catch (e) {
    // If reading fails, fall through to normal request handling
    console.error("frontpage middleware error:", e);
  }

  return await next();
});

export const startInstance = createStart(() => ({
  requestMiddleware: [frontpageMiddleware, authMiddleware, errorMiddleware],
}));

