(() => {
  "use strict";

  const API_NAME = "__BillfishCaptureCompat";
  const existing = globalThis[API_NAME];
  if (existing && String(existing.version || "").startsWith("14.")) return;

  const LAZY_ATTRS = [
    "eagle-src", "data-original", "data-actualsrc", "data-ks-lazyload",
    "data-lazy-src", "data-src", "data-src-large", "data-zoom-image",
    "data-large", "data-large-src", "data-high-res-src", "data-origin-src",
    "data-image", "data-url", "data-full", "data-full-src", "data-original-src",
    "data-poster", "data-video", "data-video-src", "data-video-url"
  ];

  const TRACKING_PATTERNS = [
    /(?:^|\.)google-analytics\.com\//i, /doubleclick\.net/i, /facebook\.com\/tr/i,
    /connect\.facebook\.net.*pixel/i, /bat\.bing\.com/i, /analytics\.twitter\.com/i,
    /linkedin\.com\/(?:px|insight)/i, /clarity\.ms\/(?:collect|tag)/i,
    /hm\.baidu\.com\/hm\.gif/i, /googleadservices\.com/i, /stats\.g\./i,
    /pixel(?:\.gif|\.png|\?|\/)/i, /tracking(?:\.gif|\.png|\?|\/)/i,
    /beacon(?:\.gif|\.png|\?|\/)/i, /collect\?(?:[^#]*&)?(?:tid|cid|event)=/i
  ];

  const PLACEHOLDER_PATTERNS = [
    /(?:^|\/)(?:blank|spacer|transparent|placeholder|loading|lazy|default)(?:[-_.@/]|$)/i,
    /1x1(?:\.|_|-)/i, /pixel\.gif/i
  ];

  const BOARD_RULES = [
    { id: "huaban", host: /(^|\.)huaban\.com$/i, image: ".pin img, .pin-view img, [data-pin-id] img", box: ".pin, .pin-view, [data-pin-id]", link: "a[href*='/pins/'], a[href*='/pin/']", title: ".description, p.description, [data-title]" },
    { id: "pinterest", host: /(^|\.)pinterest\./i, image: "[data-grid-item] img, [data-test-id='pin'] img, a[href*='/pin/'] img", box: "[data-grid-item], [data-test-id='pin'], a[href*='/pin/']", link: "a[href*='/pin/']", title: "[data-test-id='pinrep-footer'], [data-test-id='closeup-title'], h1" },
    { id: "xiaohongshu", host: /(^|\.)xiaohongshu\.com$/i, image: "section.note-item img, .note-item img, #noteContainer img", box: "section.note-item, .note-item, #noteContainer", link: "a[href*='/explore/'], a[href*='/search_result/'], a.cover", title: ".title, a.title, .desc, .author, a.author" },
    { id: "dribbble", host: /(^|\.)dribbble\.com$/i, image: "[data-thumbnail-id] img, .shot-thumbnail img", box: "[data-thumbnail-id], .shot-thumbnail", link: "a.shot-thumbnail-link, a[href*='/shots/']", title: ".shot-title, [data-title], h1" },
    { id: "twitter", host: /(^|\.)(?:twitter|x)\.com$/i, image: "article a[href*='/photo/'] img, article img", box: "article", link: "a[href*='/status/']", title: "[data-testid='tweetText'], div[dir='auto']" },
    { id: "weibo", host: /(^|\.)weibo\.com$/i, image: "article img, [class*='woo-box-item'] img", box: "article, [class*='woo-box-item']", link: "a[href*='/status/'], a[class*='time']", title: "[class*='detail_wbtext'], [class*='text'], article" },
    { id: "midjourney", host: /(^|\.)(?:midjourney|nijijourney)\.com$/i, image: "img[src*='midjourney'], [class*='imageWrapper'] img", box: "[class*='imageWrapper'], [class*='grid'] > div", link: "a[href*='/jobs/'], a[href*='jobId']", title: "#lightboxPrompt, [class*='prompt']" },
    { id: "youtube", host: /(^|\.)youtube\.com$/i, image: "ytd-thumbnail img, #thumbnail img, img.yt-core-image", box: "ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer", link: "a#thumbnail, a#video-title", title: "#video-title, yt-formatted-string#video-title" },
    { id: "taobao", host: /(^|\.)(?:taobao|tmall)\.com$/i, image: "a[href*='item.htm'] img, [class*='Card'] img, .item img", box: "a[href*='item.htm'], [class*='Card'], .item", link: "a[href*='item.htm']", title: "[class*='Title'], .item-title, .item-name" },
    { id: "1688", host: /(^|\.)1688\.com$/i, image: "a[href*='offer'] img, [class*='offer'] img, .detail-content img, img", box: "a[href*='offer'], [class*='offer'], .detail-content", link: "a[href*='offer']", title: "[class*='title'], .title, h1" },
    { id: "behance", host: /(^|\.)behance\.net$/i, image: "[class*='Project-cover'] img, [class*='Project-module'] img, figure img", box: "[class*='Project-cover'], [class*='Project-module'], figure", link: "a[href*='/gallery/']", title: "[class*='Project-title'], figcaption, h1" }
  ];

  function getDoc(node) {
    return (node && node.ownerDocument) || document;
  }

  function normalizeUrl(value, doc) {
    if (!value || typeof value !== "string") return "";
    let url = value.trim();
    if (!url) return "";
    const cssMatch = url.match(/^url\(\s*(["']?)(.*?)\1\s*\)$/i);
    if (cssMatch) url = cssMatch[2].trim();
    url = url.replace(/^(?:["'])|(?:["'])$/g, "").trim();
    if (!url || /^(?:none|about:blank|javascript:|#)$/i.test(url)) return "";
    if (/^(?:chrome|edge|moz)-extension:/i.test(url)) return "";
    if (url.startsWith("//")) return ((doc && doc.location && doc.location.protocol) || location.protocol) + url;
    if (/^(?:data:|blob:|filesystem:)/i.test(url)) return url;
    try {
      return new URL(url, (doc && doc.baseURI) || location.href).href;
    } catch (_) {
      return url;
    }
  }

  function unique(values) {
    const seen = new Set();
    return values.filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }

  function parseSrcset(srcset, doc) {
    if (!srcset || typeof srcset !== "string") return [];
    const parts = [];
    let current = "";
    let parenDepth = 0;
    let inData = false;
    for (let i = 0; i < srcset.length; i += 1) {
      const ch = srcset[i];
      if (current.trim().startsWith("data:")) inData = true;
      if (ch === "(") parenDepth += 1;
      if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
      if (ch === "," && parenDepth === 0 && !inData) {
        parts.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
      if (/\s\d+(?:\.\d+)?[wx]\s*$/i.test(current)) inData = false;
    }
    if (current.trim()) parts.push(current.trim());
    const parsed = [];
    for (const part of parts) {
      const match = part.match(/^(.*?)(?:\s+(\d+(?:\.\d+)?)(w|x))?$/i);
      if (!match) continue;
      const url = normalizeUrl(match[1], doc);
      if (!url) continue;
      const amount = Number(match[2] || 1);
      const score = match[3] === "x" ? amount * 100000 : amount;
      parsed.push({ url, score });
    }
    return parsed.sort((a, b) => b.score - a.score).map((item) => item.url);
  }

  function parseCssImages(value, doc) {
    if (!value || value === "none" || /gradient\s*\(/i.test(value)) return [];
    const urls = [];
    const urlRe = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
    let match;
    while ((match = urlRe.exec(value))) {
      const url = normalizeUrl(match[2], doc);
      if (url) urls.push(url);
    }
    return unique(urls);
  }

  function isTinyDataPlaceholder(url) {
    return /^data:image\/gif;base64,/i.test(url || "") && String(url).length < 220;
  }

  function elementRect(element) {
    try {
      return element.getBoundingClientRect();
    } catch (_) {
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    }
  }

  function isVisible(element) {
    if (!element || element.nodeType !== 1) return false;
    try {
      const style = getComputedStyle(element);
      const rect = elementRect(element);
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
    } catch (_) {
      return true;
    }
  }

  function isExtensionNode(element) {
    if (!element || element.nodeType !== 1) return false;
    try {
      if (element.closest("#bf-v14-collector-host,[data-bf-v14],#billfishActionTips,[class*='billfish-top-right']")) return true;
      const id = String(element.id || "");
      const cls = String(element.className || "");
      return /^bf-v14/i.test(id) || /(?:^|\s)bf-v14/i.test(cls);
    } catch (_) {
      return false;
    }
  }

  function sanitizeText(value, limit = 240) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  // Inline navigation icons frequently sit above product images (carousel arrows,
  // zoom controls, badges). They are valid SVG resources for batch scanning, but
  // must not replace the image the user intended to save from the context menu.
  function isDecorativeContextSvg(element) {
    if (!element || element.nodeType !== 1) return false;
    const svg = element instanceof SVGElement
      ? (String(element.tagName || "").toLowerCase() === "svg" ? element : element.closest?.("svg"))
      : null;
    if (!svg) return false;
    const rect = elementRect(svg);
    const widthAttr = String(svg.getAttribute?.("width") || "").toLowerCase();
    const heightAttr = String(svg.getAttribute?.("height") || "").toLowerCase();
    const marker = [
      svg.id,
      svg.getAttribute?.("class"),
      svg.getAttribute?.("data-icon"),
      svg.getAttribute?.("aria-label"),
      svg.getAttribute?.("role"),
      svg.parentElement?.id,
      svg.parentElement?.getAttribute?.("class"),
      svg.parentElement?.getAttribute?.("aria-label")
    ].filter(Boolean).join(" ").toLowerCase();
    const insideControl = !!svg.closest?.("button,[role='button'],[class*='arrow'],[class*='prev'],[class*='next'],[class*='control'],[class*='switch']");
    const iconSized = (rect.width > 0 && rect.height > 0 && rect.width <= 96 && rect.height <= 96)
      || widthAttr === "1em" || heightAttr === "1em";
    const iconMarked = /(?:^|[\s_-])(left|right|up|down|prev|next|arrow|icon|chevron|close|zoom)(?:$|[\s_-])/i.test(marker)
      || svg.hasAttribute?.("data-icon") || svg.getAttribute?.("aria-hidden") === "true";
    return iconSized && (insideControl || iconMarked);
  }

  function fileTitle(src) {
    try {
      const pathname = new URL(src, location.href).pathname;
      const name = decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "");
      return sanitizeText(name.replace(/\.[a-z0-9]{1,8}$/i, "")) || "未命名素材";
    } catch (_) {
      return "未命名素材";
    }
  }

  function nearestText(element, selectors) {
    for (const selector of selectors || []) {
      try {
        const root = element.closest(selector) || element.parentElement?.querySelector(selector);
        const text = sanitizeText(root && (root.getAttribute("aria-label") || root.getAttribute("title") || root.textContent));
        if (text) return text;
      } catch (_) {}
    }
    return "";
  }

  function nearestLink(element) {
    try {
      const anchor = element.closest("a[href]") || element.parentElement?.querySelector("a[href]");
      return anchor ? normalizeUrl(anchor.getAttribute("href") || anchor.href, getDoc(element)) : "";
    } catch (_) {
      return "";
    }
  }

  function getSiteMeta(element, src, type) {
    const doc = getDoc(element);
    const host = String(doc.location?.hostname || location.hostname).toLowerCase();
    const result = {
      sourceLink: nearestLink(element) || doc.location?.href || location.href,
      pageUrl: doc.location?.href || location.href,
      pageTitle: sanitizeText(doc.title, 300),
      title: "",
      tags: [],
      annotation: "",
      adapter: "generic"
    };

    const genericTitle = sanitizeText(
      element?.getAttribute?.("eagle-title") || element?.getAttribute?.("data-title") ||
      element?.getAttribute?.("alt") || element?.getAttribute?.("title") || ""
    );
    result.title = genericTitle;

    function setAdapter(name) {
      result.adapter = name;
      result.tags.push(name);
    }

    if (/(^|\.)1688\.com$/.test(host)) {
      setAdapter("1688");
      result.title = result.title || nearestText(element, ["a[href*='offer']", "[class*='offer']", ".detail-content", "h1"]);
      // Walk only up to the nearest card with one unique product, never use the shop navigation link.
      const productUrl = value => {
        try { const u = new URL(value, doc.baseURI || doc.location.href); return /(^|\.)1688\.com$/i.test(u.hostname) && /\/offer\/\d+\.html/.test(u.pathname) ? u.href : ""; } catch (_) { return ""; }
      };
      let card = element, match = null;
      for (let depth = 0; card && depth < 7; depth++, card = card.parentElement) {
        const links = [...(card.querySelectorAll?.("a[href]") || [])];
        if (card.tagName?.toLowerCase() === "a") links.unshift(card);
        const offers = links.map(link => ({ link, url: productUrl(link.href || link.getAttribute?.("href")) })).filter(value => value.url);
        const ids = new Set(offers.map(value => new URL(value.url).pathname));
        if (ids.size > 1) break;
        if (ids.size === 1) {
          match = offers[0];
          const titleLink = offers.find(value => sanitizeText(value.link.getAttribute?.("title") || value.link.textContent));
          const titleNode = card.querySelector?.("[class*='title'],[class*='Title'],[class*='subject'],[class*='Subject']");
          const title = sanitizeText(titleLink?.link.getAttribute?.("title") || titleNode?.getAttribute?.("title") || titleNode?.textContent || titleLink?.link.textContent || element.getAttribute?.("alt"));
          if (title) { result.title = title; break; }
        }
      }
      if (match) result.sourceLink = match.url;
    } else if (/(^|\.)(?:taobao|tmall)\.com$/.test(host)) {
      setAdapter("淘宝天猫");
      const card = element.closest("a[href*='item.htm'],[class*='Card'],.item");
      result.title = result.title || sanitizeText(card?.querySelector("[class*='Title'],.item-title,.item-name")?.textContent);
      if (card?.href) result.sourceLink = card.href;
    } else if (/(^|\.)huaban\.com$/.test(host)) {
      setAdapter("花瓣");
      const pin = element.closest(".pin,.pin-view,[data-pin-id]");
      result.title = result.title || sanitizeText(pin?.querySelector(".description,p.description,[data-title]")?.textContent || pin?.getAttribute("data-title"));
      const link = pin?.querySelector("a[href*='/pins/'],a[href*='/pin/']");
      if (link?.href) result.sourceLink = link.href;
    } else if (/(^|\.)xiaohongshu\.com$/.test(host)) {
      setAdapter("小红书");
      const note = element.closest("section.note-item,.note-item,#noteContainer,.note-container");
      const title = sanitizeText(note?.querySelector("a.title,.title,.desc")?.textContent);
      const author = sanitizeText(note?.querySelector("a.author,.author,.name")?.textContent);
      result.title = result.title || [title, author].filter(Boolean).join(" - ");
      const link = note?.querySelector("a[href*='/explore/'],a[href*='/search_result/'],a.cover");
      if (link?.href) result.sourceLink = link.href;
    } else if (/(^|\.)pinterest\./.test(host)) {
      setAdapter("Pinterest");
      const pin = element.closest("[data-grid-item],[data-test-id='pin'],[data-test-pin-id]") || element.closest("a[href*='/pin/']");
      result.title = result.title || sanitizeText(pin?.querySelector("[data-test-id='pinrep-footer'],[data-test-id='closeup-title']")?.textContent);
      const link = pin?.querySelector?.("a[href*='/pin/']") || element.closest("a[href*='/pin/']");
      if (link?.href) result.sourceLink = link.href;
    } else if (/(^|\.)weibo\.com$/.test(host)) {
      setAdapter("微博");
      const article = element.closest("article,[class*='woo-box-item']");
      result.title = result.title || sanitizeText(article?.querySelector("[class*='detail_wbtext'],[class*='text']")?.textContent);
      const link = article?.querySelector("a[href*='/status/'],a[class*='time']");
      if (link?.href) result.sourceLink = link.href;
    } else if (/(^|\.)(?:twitter|x)\.com$/.test(host)) {
      setAdapter("Twitter-X");
      const article = element.closest("article");
      const author = sanitizeText(article?.querySelector("[data-testid='User-Name']")?.textContent);
      const text = sanitizeText(article?.querySelector("[data-testid='tweetText'],div[dir='auto']")?.textContent);
      result.title = result.title || [author, text].filter(Boolean).join(" ");
      const link = article?.querySelector("a[href*='/status/']");
      if (link?.href) result.sourceLink = link.href;
    } else if (/(^|\.)(?:midjourney|nijijourney)\.com$/.test(host)) {
      setAdapter("Midjourney");
      const card = element.closest("div:has(#lightboxPrompt),[class*='imageWrapper'],[class*='job']");
      const prompt = sanitizeText(card?.querySelector("#lightboxPrompt,[class*='prompt']")?.textContent, 1000);
      const author = sanitizeText(card?.querySelector("a[href*='user_id'],span.block.truncate")?.textContent);
      if (prompt) {
        result.annotation = prompt;
        result.title = result.title || `${prompt.slice(0, 70)}${author ? ` @${author}` : ""}`;
      }
    } else if (/(^|\.)dribbble\.com$/.test(host)) {
      setAdapter("Dribbble");
      const shot = element.closest("[data-thumbnail-id],.shot-thumbnail,[data-video-teaser-original]");
      result.title = result.title || sanitizeText(shot?.querySelector(".shot-title,[data-title]")?.textContent);
      const link = shot?.querySelector("a[href*='/shots/']") || element.closest("a[href*='/shots/']");
      if (link?.href) result.sourceLink = link.href;
      if (type === "video") {
        const original = shot?.getAttribute("data-video-teaser-original");
        if (original) result.overrideSrc = normalizeUrl(original, doc);
      }
    } else if (/(^|\.)youtube\.com$/.test(host)) {
      setAdapter("YouTube");
      const card = element.closest("ytd-rich-item-renderer,ytd-video-renderer,ytd-compact-video-renderer");
      result.title = result.title || sanitizeText(card?.querySelector("#video-title")?.textContent);
      const link = card?.querySelector("a#thumbnail,a#video-title");
      if (link?.href) result.sourceLink = link.href;
    } else if (/(^|\.)behance\.net$/.test(host)) {
      setAdapter("Behance");
      const card = element.closest("[class*='Project-cover'],[class*='Project-module'],figure");
      result.title = result.title || sanitizeText(card?.querySelector("[class*='Project-title'],figcaption")?.textContent);
      const link = card?.querySelector("a[href*='/gallery/']") || element.closest("a[href*='/gallery/']");
      if (link?.href) result.sourceLink = link.href;
    }

    result.title = sanitizeText(result.title || result.pageTitle || fileTitle(src), 240);
    result.tags = unique(result.tags);
    return result;
  }

  function tryUrl(input, fn) {
    try {
      const value = fn(input);
      return typeof value === "string" && value ? value : input;
    } catch (_) {
      return input;
    }
  }

  // 56 groups, reimplemented from the architecture of the supplied reference extension.
  function original1688Url(value) {
    try {
      const url = new URL(value);
      if (!/^(?:cbu\d+|img)\.alicdn\.com$/i.test(url.hostname) || !url.pathname.startsWith("/img/ibank/")) return value;
      // Strip CDN transforms after the real extension; do not turn foo.jpg_300x300.jpg into foo.jpg.jpg.
      url.pathname = url.pathname
        .replace(/(\.(?:jpe?g|png|gif|webp|avif))_(?:\d+x\d+[^/]*|q\d+[^/]*|sum\.[^/]+|\.(?:webp|avif))$/i, "$1")
        .replace(/\.\d+x\d+(?:xz)?(?:q\d+)?\.(jpe?g|png|gif|webp|avif)$/i, ".$1")
        .replace(/_\d+x\d+(?:xz)?(?:q\d+)?\.(jpe?g|png|gif|webp|avif)$/i, ".$1");
      return url.href;
    } catch (_) { return value; }
  }

  const URL_RULES = [
    ["Reddit", /preview\.redd\.it\//i, (u) => u.split("?")[0].replace("preview.redd.it", "i.redd.it")],
    ["deviantArt", /images\S+\.wixmp\.com\/f\//i, (u) => { try { const token = new URL(u).searchParams.get("token"); if (!token) return u; const b = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/"); const json = JSON.parse(decodeURIComponent(atob(b).split("").map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""))); const size = json?.obj?.[0]?.[0]; if (!size?.height || !size?.width) return u; return u.replace(/\/w_\d+,h_\d+,q_\d+/, `/w_${String(size.width).replace("<=", "")},h_${String(size.height).replace("<=", "")},q_100`); } catch (_) { return u; } }],
    ["behance", /behance\.net\/(?:project_modules|projects)\//i, (u) => u.replace(/\/max_1200\//, "/source/").replace(/max_\d+/, "source").replace(/\/(?:2800|1400)_opt_1\//, "/source/").replace("/disp/", "/source/").replace(/project_modules\/\d+\//, "project_modules/source/").replace(/projects\/\d+\//, "projects/source/")],
    ["imgur", /i\.imgur\.com\//i, (u) => `${u.split("?")[0]}?maxwidth=99999`],
    ["twitter", /twimg\.com.*[?&]name=/i, (u) => u.replace(/([?&])name=[^&]+/, "$1name=orig")],
    ["Bluesky", /cdn\.bsky\.app\/img\/feed_thumbnail\//i, (u) => u.replace("feed_thumbnail", "feed_fullsize")],
    ["midjourney", /cdn\.midjourney\.com\//i, (u) => u.replace(/_\d+_N/, "").replace(/\.webp(?:\?.*)?$/i, ".png")],
    ["花瓣网-v4", /gd-hbimg-edge\.huaban(?:img)?\.com/i, (u) => u.replace(/_\/fw[^?]*(?=\?|$)/, "").replace(/_sq\d+\/format[^?]*(?=\?|$)/, "").replace(/\/format\/[^?]*(?=\?|$)/, "").replace(/_sq\d+\w*(?=\?|$)/, "").replace(/_fw\d+\w*(?=\?|$)/, "").replace(/\/small\//, "/")],
    ["花瓣网-v3", /gd-hbimg\.huaban(?:img)?\.com/i, (u) => u.replace(/_\/fw.*/, "").replace(/_sq\d+\/format.*/, "").split("/format/")[0].replace(/_sq\d+$/, "").replace(/_fw\d+w?$/, "").split("_fw")[0].split("/fw/")[0].replace(/\/small\//, "/")],
    ["花瓣网-v2", /hbimg\.huaban\.com/i, (u) => u.replace(/_\/fw.*/, "").replace(/_sq\d+\/format.*/, "").split("/format/")[0].replace(/_sq\d+$/, "").replace(/_fw\d+w?$/, "").split("_fw")[0].split("/fw/")[0]],
    ["花瓣网-v1", /\/\/hbimg/i, (u) => u.split("/format/")[0].replace(/_sq\d+$/, "").replace(/_fw\d+w?$/, "").split("_fw")[0].split("/fw/")[0]],
    ["大作", /bigurl/i, (u) => u.replace("pc_236_webp_2x", "pc_680_webp").replace("pc_236_webp", "pc_680_webp")],
    ["Lapa.ninja", /cdn\.lapaninja\.com/i, (u) => u.replace(/-thumb\.jpg(?:\?.*)?$/i, ".jpg")],
    ["Dribbble", /cdn\.dribbble\.com/i, (u) => u.includes("userupload") || (u.includes("screenshots") && u.includes("media")) ? u.split("?")[0] : u.includes("/videos/") ? u.replace("_large_preview", "") : u.includes("/attachments/") ? u : u.replace(/_1x/g, "").replace(/_teaser/g, "").replace(/_4x(?=\.gif)/, "")],
    ["Pexels", /images\.pexels\.com/i, (u) => `${u.split("?")[0]}?auto=compress`],
    ["Tenor", /media\.tenor\.com/i, (u) => u.replace(/\/(?:d|M)\//, "/C/")],
    ["新浪微博", /\.sinaimg\.cn\/[a-z]*\d*\//i, (u) => u.includes(".mp4") ? u : u.replace(/\.cn\/[a-z]*\d*\//i, ".cn/large/")],
    ["百度贴吧", /tiebapic\.baidu\.com\/forum/i, (u) => u.replace(/\/sys\/portrait(?!l)/, "/sys/portraitl").replace(/\/forum\/ab(pic\/item\/)/, "/forum/$1").replace(/\/sign=\w+\/([\w.]+)$/i, "/forum/pic/item/$1")],
    ["豆瓣相册", /img\d*\.doubanio\.com/i, (u) => u.replace(/\/(?:s|m|l|sqs)\//, "/orginal/")],
    ["pixAI.Art", /images-ng\.pixai\.art\/images\/thumb\//i, (u) => u.replace("/thumb/", "/orig/")],
    ["Flickr", /staticflickr\.com/i, (u) => u.replace(/_[nms]\.jpg(?:\?.*)?$/i, "_b.jpg")],
    ["Poco旧版", /pocoimg/i, (u) => u.replace(/_\d{3}\.jpg(?:\?.*)?$/i, ".jpg")],
    ["Poco新版", /\.pocoimg\.cn/i, (u) => u.replace(/_H\d+\./, ".")],
    ["蘑菇街", /mogucdn\.com.*\.jpg/i, (u) => `${u.replace(/_\d{3}x\d+\.jpg.*$/i, ".jpg").split(".jpg")[0]}.jpg`],
    ["Pinterest", /\.pinimg\.com\//i, (u) => u.replace(/\/\d+x\//g, "/originals/").replace(/\/(?:enabled|enabled_lo|enabled_hi|control)\//g, "/")],
    ["pixiv", /\/\/i\.pximg\.net\//i, (u) => u.replace(/c\/\d+x\d+_\d+(?:_[A-Za-z0-9]{2})?\//, "").replace(/img-master|custom-thumb/, "img-original").replace(/_(?:master|square|custom)1200/, "")],
    ["1688", /(?:cbu\d+|img)\.alicdn\.com\/img\/ibank\//i, original1688Url],
    ["淘宝", /(?:taobao|tb|ali)cdn/i, (u) => u.replace(/_\d+x\d+\.jpg(?:_\.webp)?/i, ".jpg").replace(/_\d+x\d+\.(png|webp)/i, ".$1")],
    ["天猫", /(?:taobao|tb|ali)cdn/i, (u) => u.replace(/_\d+x\d+[^.]*\.jpg(?:_\.webp)?/i, ".jpg")],
    ["Amazon", /(?:images-na\.ssl-images|images-fe\.ssl-images|m\.media)-amazon\.com\/images/i, (u) => u.replace(/\.\_[A-Z0-9_,]+\_\./i, ".")],
    ["京东", /360buyimg\.com/i, (u) => u.replace(/\/n\d+\//, "/n0/").replace(/s\d+x\d+_?/i, "").split("!cc")[0].split("!q")[0].replace(/\.jpg\.avif/i, ".jpg")],
    ["Houzz", /st\.hzcdn\.com\/fimgs/i, (u) => u.replace("/fimgs/", "/simgs/").replace(/_(?!14-)/, "_14-").replace(/-w\d+-h\d+-b0-p0/, "")],
    ["HouseBeautiful", /hips\.hearstapps\.com/i, (u) => u.replace(/\.jpg.+$/i, ".jpg").split("&resize=")[0]],
    ["Officesnapshots", /officesnapshots\.com/i, (u) => u.replace(/-\d{3,4}x\d{3,4}(?=\.)/, "")],
    ["Archilovers", /cdn\.archilovers\.com/i, (u) => u.replace(/(?:\S_\d+_|thumb\d_)/, "")],
    ["AD", /media\.architecturaldigest\.com/i, (u) => u.replace(/w_\d+/, "w_5000").replace(/,h_\d+/, "")],
    ["Archdaily中文版", /images\.adsttc\.com\.qtlcn\.com/i, (u) => u.replace(/thumb_jpg|medium_jpg|newsletter/g, "large_jpg")],
    ["ArchDaily国际版", /images\.adsttc\.com/i, (u) => u.replace(/slideshow|thumb_jpg|medium_jpg|newsletter/g, "large_jpg")],
    ["Dezeen", /static\.dezeen\.com/i, (u) => u.replace(/slideshow|thumb_jpg/g, "large_jpg").replace(/-\d+x\d+(?=\.jpg)/i, "")],
    ["Archiproducts", /img\.edilportale\.com/i, (u) => u.replace(/-thumbs.*?\.[a-z]_/i, "s/").replace(/news.*?\.[a-z]_/i, "news/")],
    ["officesnapshots-wordpress", /officesnapshots\.com\/wp-content\/uploads/i, (u) => u.replace(/-\d+x\d+-(.*?)\./, ".").split("?w=")[0]],
    ["wordpress通用", /\/wp-content\/uploads\//i, (u) => u.replace(/-\d+x\d+(?=\.[a-z]{2,5}(?:\?|$))/i, "").split("?w=")[0]],
    ["Squarespace", /static\d\.squarespace\.com/i, (u) => u.replace(/format=\d{3,4}w/i, "format=3000w")],
    ["bilibili专栏", /\.hdslb\.com\/.*@.*\.(?:webp|avif)/i, (u) => u.split("@")[0]],
    ["AliyunOSS", /[?&]x-oss-process=/i, (u) => { const x = new URL(u); x.searchParams.delete("x-oss-process"); return x.toString(); }],
    ["小红书", /xhscdn\.com/i, (u) => u.replace(/:\/\/[^/]+(\.xhscdn\.com\/+)[0-9]+\/+[0-9a-f]{10,}\/+([^/.?#!]+)(?:[?#!].*)?/i, "://sns-img-al$1$2").split("!")[0]],
    ["Medium", /cdn-images-\d\.medium\.com/i, (u) => u.replace(/\/max\/\d{2,4}/, "")],
    ["Medium新版", /miro\.medium\.com\/v2\//i, (u) => u.replace(/\/[^/]*:[^/]*\//g, "/")],
    ["Artstation", /cdn.*\.artstation\.com/i, (u) => u.replace(/\/\d{14}\//, "/").replace(/\/(?:micro_square|smaller_square|small_square)\//, "/large/")],
    ["GameUI", /image\.gameuiux\.cn/i, (u) => u.replace(/_list/, "_detail")],
    ["GameUI2", /img\.gameui\.net/i, (u) => u.replace(/(?:-1)?@\d+x\d+(?=\.webp)/g, "")],
    ["interiordesign", /d4qwptktddc5f\.cloudfront\.net/i, (u) => u.replace(/easy_thumbnails\/thumbs_/, "").replace(/\.jpg.*/i, ".jpg")],
    ["meiye", /image\.meiye\.art/i, (u) => u.split("?imageMogr2")[0].split("?vframe")[0]],
    ["即刻", /cdn.*\.ruguoapp\.com/i, (u) => u.split("?imageMogr2")[0]],
    ["腾讯云-imageMogr2", /[?&]imageMogr2/i, (u) => u.includes("sign-algorithm=") ? u : u.split("?imageMogr2")[0]],
    ["腾讯云-imageView2", /[?&]imageView2/i, (u) => u.includes("q-sign-algorithm=") ? u : u.split("?imageView2")[0]]
  ];

  const URL_RULE_RESULT_CACHE = new Map();
  const URL_RULE_RESULT_CACHE_MAX = 1200;

  function cacheUrlRuleResult(key, value) {
    URL_RULE_RESULT_CACHE.set(key, value);
    if (URL_RULE_RESULT_CACHE.size > URL_RULE_RESULT_CACHE_MAX) {
      const removeCount = Math.ceil(URL_RULE_RESULT_CACHE_MAX * 0.2);
      const iterator = URL_RULE_RESULT_CACHE.keys();
      for (let i = 0; i < removeCount; i += 1) {
        const next = iterator.next();
        if (next.done) break;
        URL_RULE_RESULT_CACHE.delete(next.value);
      }
    }
    return value;
  }

  function applyUrlRules(url) {
    if (!url || /^(?:data:|blob:)/i.test(url)) return { url, largeUrl: "", rule: "", candidates: [url] };
    const cached = URL_RULE_RESULT_CACHE.get(url);
    if (cached) return { ...cached, candidates: cached.candidates.slice() };
    let current = url;
    let matchedRule = "";
    for (const [name, test, convert] of URL_RULES) {
      if (!test.test(current)) continue;
      const next = tryUrl(current, convert);
      if (next && next !== current) {
        current = next;
        matchedRule = name;
      }
    }
    const candidates = [current];
    if (/\.pinimg\.com/i.test(current)) {
      const ext = (current.match(/\.(jpg|jpeg|png|webp|gif)(?:\?|$)/i) || [])[1];
      if (ext) for (const alt of ["jpg", "png", "webp", "gif"]) candidates.push(current.replace(new RegExp(`\\.${ext}(?=\\?|$)`, "i"), `.${alt}`));
    }
    if (/i\.pximg\.net/i.test(current)) {
      candidates.push(current.replace(/\.jpg(?=\?|$)/i, ".png"));
      candidates.push(current.replace(/\.png(?=\?|$)/i, ".jpg"));
    }
    if (/artstation\.com/i.test(current)) {
      candidates.unshift(current.replace("/large/", "/4k/"));
      candidates.push(current.replace("/4k/", "/large/"));
    }
    if (/pbs\.twimg\.com/i.test(current)) {
      candidates.push(current.replace(/format=webp/i, "format=jpg"));
      candidates.push(current.replace(/format=jpg/i, "format=webp"));
    }
    return cacheUrlRuleResult(url, { url, largeUrl: current !== url ? current : "", rule: matchedRule, candidates: unique(candidates.concat(url)) });
  }

  function collectSourceCandidates(element) {
    const doc = getDoc(element);
    const tag = String(element?.tagName || "").toLowerCase();
    const urls = [];
    for (const attr of LAZY_ATTRS) {
      const value = element?.getAttribute?.(attr);
      if (value) {
        if (/srcset/i.test(attr)) urls.push(...parseSrcset(value, doc));
        else urls.push(normalizeUrl(value, doc));
      }
    }
    const srcset = element?.getAttribute?.("srcset") || element?.getAttribute?.("data-srcset");
    if (srcset) urls.push(...parseSrcset(srcset, doc));
    if (tag === "img") {
      urls.push(normalizeUrl(element.currentSrc || "", doc));
      urls.push(normalizeUrl(element.getAttribute("src") || "", doc));
      urls.push(normalizeUrl(element.src || "", doc));
      if (element.parentElement?.tagName?.toLowerCase() === "picture") {
        for (const source of Array.from(element.parentElement.children || [])) {
          if (source.tagName?.toLowerCase() !== "source") continue;
          urls.push(...parseSrcset(source.getAttribute("srcset") || source.getAttribute("data-srcset") || "", doc));
          urls.push(normalizeUrl(source.getAttribute("src") || "", doc));
        }
      }
    } else if (tag === "picture") {
      const image = element.querySelector("img");
      if (image) urls.push(...collectSourceCandidates(image));
      for (const source of Array.from(element.querySelectorAll(":scope > source"))) {
        urls.push(...parseSrcset(source.getAttribute("srcset") || "", doc));
        urls.push(normalizeUrl(source.getAttribute("src") || "", doc));
      }
    } else if (tag === "video" || tag === "audio") {
      urls.push(normalizeUrl(element.currentSrc || "", doc));
      urls.push(normalizeUrl(element.getAttribute("src") || "", doc));
      for (const source of Array.from(element.querySelectorAll(":scope > source"))) {
        urls.push(...parseSrcset(source.getAttribute("srcset") || "", doc));
        urls.push(normalizeUrl(source.getAttribute("src") || source.src || "", doc));
      }
      if (tag === "video") urls.push(normalizeUrl(element.poster || element.getAttribute("poster") || "", doc));
    }
    try {
      urls.push(...parseCssImages(getComputedStyle(element).backgroundImage, doc));
      urls.push(...parseCssImages(getComputedStyle(element, "::before").backgroundImage, doc));
      urls.push(...parseCssImages(getComputedStyle(element, "::after").backgroundImage, doc));
    } catch (_) {}
    return unique(urls.filter((url) => url && !isTinyDataPlaceholder(url)));
  }

  function serializeSvg(svg) {
    try {
      let text = new XMLSerializer().serializeToString(svg);
      if (!/^<svg[^>]+xmlns=/.test(text)) text = text.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
      return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`;
    } catch (_) {
      return "";
    }
  }

  function resolveDirect(element) {
    if (!element || element.nodeType !== 1 || isExtensionNode(element)) return null;
    const tag = String(element.tagName || "").toLowerCase();
    const doc = getDoc(element);
    let type = "image";
    let urls = [];
    if (tag === "canvas") {
      try { urls = [element.toDataURL("image/png")]; } catch (_) { urls = []; }
    } else if (tag === "svg" || element instanceof SVGElement) {
      const svg = tag === "svg" ? element : element.closest?.("svg");
      if (svg) urls = [serializeSvg(svg)];
    } else {
      urls = collectSourceCandidates(element);
      if (tag === "video") type = "video";
      else if (tag === "audio") type = "audio";
      else if (!urls.length && element.closest) {
        const media = element.closest("video,audio,img,picture,svg,canvas");
        if (media && media !== element) return resolveDirect(media);
      }
    }
    if (!urls.length) return null;
    let src = urls[0];
    const site = getSiteMeta(element, src, type);
    if (site.overrideSrc) src = site.overrideSrc;
    const enlarged = applyUrlRules(src);
    return {
      src: enlarged.largeUrl || src,
      originalSrc: src,
      candidates: unique((enlarged.candidates || []).concat(urls)),
      enhanceRule: enlarged.rule,
      type,
      title: site.title,
      sourceLink: site.sourceLink,
      pageUrl: site.pageUrl,
      pageTitle: site.pageTitle,
      tags: site.tags,
      annotation: site.annotation,
      adapter: site.adapter,
      element
    };
  }

  function pointInside(element, point) {
    if (!point) return true;
    const rect = elementRect(element);
    return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
  }

  function descendantsByPoint(element, point) {
    if (!element?.querySelectorAll) return [];
    const nodes = Array.from(element.querySelectorAll("img,picture,video,audio,canvas,svg,[style*='background-image'],[data-src],[data-original],[data-actualsrc]"));
    const visible = nodes.filter((node) => isVisible(node) && !isExtensionNode(node));
    const underPoint = visible.filter((node) => pointInside(node, point));
    return (underPoint.length ? underPoint : visible).sort((a, b) => {
      const ar = elementRect(a), br = elementRect(b);
      return br.width * br.height - ar.width * ar.height;
    });
  }

  function resolve(element, point) {
    if (!element) return null;
    if (element instanceof SVGElement && element.tagName?.toLowerCase() !== "svg") element = element.closest?.("svg") || element;
    let current = element;
    for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
      const direct = resolveDirect(current);
      if (direct) return direct;
    }
    for (const child of descendantsByPoint(element, point)) {
      const direct = resolveDirect(child);
      if (direct) return direct;
    }
    return null;
  }

  function elementsFromPointDeep(x, y, root, seenRoots) {
    const results = [];
    if (!root || seenRoots.has(root)) return results;
    seenRoots.add(root);
    let elements = [];
    try { elements = root.elementsFromPoint ? root.elementsFromPoint(x, y) : []; } catch (_) {}
    for (const element of elements) {
      if (element.shadowRoot) results.push(...elementsFromPointDeep(x, y, element.shadowRoot, seenRoots));
      results.push(element);
    }
    return unique(results);
  }

  function findTarget(event) {
    if (!event) return null;
    const point = { x: event.clientX, y: event.clientY };
    const doc = getDoc(event.target);
    for (const element of elementsFromPointDeep(point.x, point.y, doc, new WeakSet())) {
      if (!isVisible(element) || isExtensionNode(element) || isDecorativeContextSvg(element)) continue;
      const direct = resolveDirect(element);
      if (direct && !(/^data:image\/svg/i.test(String(direct.src || "")) && isDecorativeContextSvg(element))) return element;
      const descendants = descendantsByPoint(element, point).filter((node) => !isDecorativeContextSvg(node));
      for (const descendant of descendants) {
        const child = resolveDirect(descendant);
        if (child && !(/^data:image\/svg/i.test(String(child.src || "")) && isDecorativeContextSvg(descendant))) return descendant;
      }
    }
    if (event.target && !isDecorativeContextSvg(event.target) && resolve(event.target, point)) return event.target;
    return null;
  }

  function isTrackingPixel(element, src) {
    const width = Number(element?.naturalWidth || element?.videoWidth || element?.width || element?.clientWidth || 0);
    const height = Number(element?.naturalHeight || element?.videoHeight || element?.height || element?.clientHeight || 0);
    const idClass = `${element?.id || ""} ${element?.className || ""} ${element?.getAttribute?.("role") || ""}`;
    if ((width <= 3 && height <= 3) || (width && height && width * height <= 9)) return true;
    if (/tracking|analytics|beacon|pixel/i.test(idClass) && width <= 20 && height <= 20) return true;
    if (TRACKING_PATTERNS.some((pattern) => pattern.test(src || ""))) return true;
    if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(src || "")) && width <= 64 && height <= 64) return true;
    return false;
  }

  function collectOpenRoots(doc) {
    const roots = [];
    const visited = new WeakSet();
    function walk(root) {
      if (!root || visited.has(root)) return;
      visited.add(root);
      roots.push(root);
      let all = [];
      try { all = Array.from(root.querySelectorAll("*")); } catch (_) {}
      for (const element of all) {
        if (element.shadowRoot) walk(element.shadowRoot);
      }
    }
    walk(doc || document);
    return roots;
  }

  function loadedImageDimensions(doc, initialRoots) {
    const sizes = new Map(), visited = new Set();
    function walk(current, depth = 0) {
      if (!current || visited.has(current) || depth > 8 || visited.size >= 40) return;
      visited.add(current);
      for (const root of (current === doc && initialRoots ? initialRoots : collectOpenRoots(current))) {
        for (const image of Array.from(root.querySelectorAll("img"))) {
          if (!image.naturalWidth || !image.naturalHeight) continue;
          const src = normalizeUrl(image.currentSrc || image.src, current);
          const previous = sizes.get(src);
          if (!previous || previous.width * previous.height < image.naturalWidth * image.naturalHeight) sizes.set(src, { width: image.naturalWidth, height: image.naturalHeight });
        }
        for (const frame of Array.from(root.querySelectorAll("iframe"))) {
          try { walk(frame.contentDocument, depth + 1); } catch (_) {}
        }
      }
    }
    walk(doc);
    return sizes;
  }

  function dimensionsFor(node, meta, sizes) {
    const loaded = sizes?.get(meta.src);
    if (loaded) return { ...loaded, dimensionsResolved: true, dimensionsFromLayout: false };
    const rect = elementRect(node);
    let width = Math.round(node.naturalWidth || node.videoWidth || node.width || rect.width || 0);
    let height = Math.round(node.naturalHeight || node.videoHeight || node.height || rect.height || 0);
    if ((!width || !height) && /^data:image\/svg/i.test(meta.src)) {
      width = Math.round(rect.width || 0);
      height = Math.round(rect.height || 0);
    }
    return { width, height, dimensionsResolved: !!node.naturalWidth && normalizeUrl(node.currentSrc || node.src, getDoc(node)) === meta.src, dimensionsFromLayout: !node.naturalWidth && !node.videoWidth && !/^(canvas|svg)$/i.test(node.tagName || "") };
  }

  function resourceKey(item) {
    const type = item.type || item.contentType || "image";
    const source = item.identitySrc || item.src || item.originalSrc || item.data || "";
    const url = type === "image" ? (applyUrlRules(source).largeUrl || source) : source;
    return `${type}|${url}`;
  }

  function itemFromMeta(meta, node, frameInfo, sizes) {
    const { width, height, dimensionsResolved, dimensionsFromLayout } = dimensionsFor(node, meta, sizes);
    return {
      src: meta.src,
      originalSrc: meta.originalSrc || meta.src,
      identitySrc: meta.src,
      candidates: meta.candidates || [meta.src],
      type: meta.type || "image",
      contentType: meta.type || "image",
      title: meta.title || fileTitle(meta.src),
      width,
      height,
      dimensionsResolved,
      dimensionsFromLayout,
      sourceLink: meta.sourceLink || meta.pageUrl || location.href,
      pageUrl: meta.pageUrl || location.href,
      pageTitle: meta.pageTitle || document.title,
      tags: meta.tags || [],
      annotation: meta.annotation || "",
      adapter: meta.adapter || "generic",
      enhanceRule: meta.enhanceRule || "",
      frameUrl: frameInfo?.url || location.href,
      frameTitle: frameInfo?.title || document.title,
      isTopFrame: window.top === window,
      data: /^data:/i.test(meta.src) ? meta.src : ""
    };
  }

  function getBoardRule(doc) {
    const host = String(doc?.location?.hostname || location.hostname);
    return BOARD_RULES.find((rule) => rule.host.test(host)) || null;
  }

  async function scanBoard(doc) {
    const rule = getBoardRule(doc || document);
    if (!rule) return [];
    const output = [];
    const seen = new Set();
    const sizes = loadedImageDimensions(doc || document);
    let nodes = [];
    try { nodes = Array.from((doc || document).querySelectorAll(rule.image)); } catch (_) {}
    for (const node of nodes) {
      if (!isVisible(node) || isExtensionNode(node)) continue;
      const meta = resolveDirect(node) || resolve(node, null);
      if (!meta?.src || isTrackingPixel(node, meta.src)) continue;
      const box = node.closest(rule.box) || node.parentElement;
      const link = box?.querySelector?.(rule.link) || node.closest?.(rule.link);
      const titleNode = box?.querySelector?.(rule.title);
      if (link?.href) meta.sourceLink = link.href;
      const title = sanitizeText(titleNode?.getAttribute?.("title") || titleNode?.textContent);
      if (title) meta.title = title;
      const item = itemFromMeta(meta, node, { url: (doc || document).location.href, title: (doc || document).title }, sizes);
      item.boardRule = rule.id;
      const key = resourceKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(item);
    }
    return output;
  }

  async function scanDocument(doc, options = {}) {
    const targetDoc = doc || document;
    if (options.boardMode) {
      const board = await scanBoard(targetDoc);
      if (board.length) return board;
    }
    const output = [];
    const seen = new Set();
    const roots = collectOpenRoots(targetDoc);
    const sizes = loadedImageDimensions(targetDoc, roots);
    const selector = [
      "img", "picture", "video", "audio", "canvas", "svg",
      "[data-original]", "[data-actualsrc]", "[data-ks-lazyload]",
      "[data-lazy-src]", "[data-src]", "[data-zoom-image]",
      "[data-high-res-src]", "[style*='background-image']"
    ].join(",");
    for (const root of roots) {
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll(selector)); } catch (_) {}
      for (const node of nodes) {
        if (output.length >= (options.limit || 7000)) return output;
        if (!isVisible(node) || isExtensionNode(node)) continue;
        const meta = resolveDirect(node) || resolve(node, null);
        if (!meta?.src || isTrackingPixel(node, meta.src)) continue;
        const item = itemFromMeta(meta, node, { url: targetDoc.location?.href, title: targetDoc.title }, sizes);
        if (item.type === "image" && !item.dimensionsFromLayout && item.width && item.height && (item.width < (options.minWidth || 24) || item.height < (options.minHeight || 24)) && !/^data:image\/svg/i.test(item.src)) continue;
        const key = resourceKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(item);
      }
    }
    return output;
  }

  function findScrollable(doc) {
    const rule = getBoardRule(doc || document);
    if (rule?.scrollEle) {
      const selected = (doc || document).querySelector(rule.scrollEle);
      if (selected) return selected;
    }
    let best = (doc || document).scrollingElement || (doc || document).documentElement;
    let bestDelta = (best.scrollHeight || 0) - (best.clientHeight || 0);
    for (const element of Array.from((doc || document).querySelectorAll("main,section,div"))) {
      try {
        const style = getComputedStyle(element);
        const delta = element.scrollHeight - element.clientHeight;
        if (delta > bestDelta && delta > 600 && /(auto|scroll)/.test(style.overflowY)) {
          best = element;
          bestDelta = delta;
        }
      } catch (_) {}
    }
    return best;
  }

  globalThis[API_NAME] = {
    version: "14.22.0",
    lazyAttributes: LAZY_ATTRS.slice(),
    urlRuleCount: URL_RULES.length,
    boardRuleCount: BOARD_RULES.length,
    findTarget,
    resolve,
    resolveDirect,
    scanDocument,
    scanBoard,
    parseSrcset,
    normalizeUrl,
    applyUrlRules,
    resourceKey,
    getSiteMeta,
    isTrackingPixel,
    collectOpenRoots,
    findScrollable
  };
})();
