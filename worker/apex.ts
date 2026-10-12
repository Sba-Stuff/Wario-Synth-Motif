// wario.style -> www.wario.style, keeping path and query. Vercel did the same
// with a 307. Separate Worker so the main one only runs for API routes.
export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    url.hostname = 'www.wario.style';
    return Response.redirect(url.href, 307);
  },
} satisfies ExportedHandler;
