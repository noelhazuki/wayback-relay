const VERSION = "page-test-1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "no-store",
};

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: cors,
  });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    if (request.method !== "GET") {
      return json({ error: "GETのみ利用できます" }, 405);
    }

    const incoming = new URL(request.url);

    if (incoming.pathname !== "/test-page") {
      return json({
        version: VERSION,
        message: "保存ページ取得テスト用Workerです",
        testPath: "/test-page",
      });
    }

    // ブラウザで保存記録を確認できた投稿を1件だけテスト。
    const original =
      "https://twitter.com/atelier_kazuna/status/1398605647386529797";

    const timestamp = "20211018151840";

    // id_ はWaybackのツールバー等を付けない取得形式。
    const archiveUrl =
      `https://web.archive.org/web/${timestamp}id_/${original}`;

    try {
      const response = await fetch(archiveUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(40000),
      });

      const contentType =
        response.headers.get("content-type") || "";

      // 転送先を確認するだけにして、元サイトへ自動移動しない。
      if (response.status >= 300 && response.status < 400) {
        return json({
          version: VERSION,
          result: "redirect",
          upstreamStatus: response.status,
          location: response.headers.get("location"),
          archiveUrl,
        });
      }

      if (!response.ok) {
        const detail = await response.text();

        return json({
          version: VERSION,
          result: "upstream-error",
          upstreamStatus: response.status,
          detail: detail.slice(0, 2000),
          archiveUrl,
        }, 502);
      }

      if (!/html/i.test(contentType)) {
        return json({
          version: VERSION,
          result: "unexpected-content-type",
          upstreamStatus: response.status,
          contentType,
          archiveUrl,
        }, 502);
      }

      let title = "";
      let description = "";
      let twitterDescription = "";

      // 保存HTML内のスクリプトは実行せず、
      // タイトルと説明用メタデータだけを読む。
      const transformed = new HTMLRewriter()
        .on("title", {
          text(chunk) {
            title += chunk.text;
          },
        })
        .on("meta", {
          element(element) {
            const key = (
              element.getAttribute("property") ||
              element.getAttribute("name") ||
              ""
            ).toLowerCase();

            const content =
              element.getAttribute("content") || "";

            if (key === "og:description") {
              description = content;
            }

            if (key === "twitter:description") {
              twitterDescription = content;
            }
          },
        })
        .transform(response);

      // 読み終えることでHTMLRewriterの処理を完了させる。
      const html = await transformed.text();

      return json({
        version: VERSION,
        result: "html-received",
        upstreamStatus: response.status,
        contentType,
        htmlLength: html.length,
        title: title.trim(),
        description,
        twitterDescription,
        note: "説明文は省略されている場合があります。投稿全文の取得を保証するものではありません。",
        archiveUrl,
      });
    } catch (e) {
      return json({
        version: VERSION,
        result: "connection-error",
        error: String(e.message || e),
        archiveUrl,
      }, 504);
    }
  },
};