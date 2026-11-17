// ==UserScript==
// @name               AI Chat 全部对话导出 / grok fix  Export All Chats (Kimi, Gemini, Notebook, Grok, DeepSeek & ChatGPT)
// @name:zh-CN         AI Chat 全部对话导出（Kimi、Gemini、Notebook、Grok、DeepSeek & ChatGPT）
// @namespace          https://github.com/wanda1416/ai-chat-exporter
// @version            0.1.12-local
// @author             wanda1416
// @description        Batch-export your Kimi, Gemini, NotebookLM, Grok, DeepSeek & ChatGPT conversations to Markdown + JSON, zipped. Pick a range, one click — runs entirely in your browser, no data sent anywhere.
// @description:zh-CN  一键批量导出 Kimi / Gemini / NotebookLM / Grok / DeepSeek / ChatGPT 全部对话为 Markdown + JSON 并打包 zip。支持导出区间选择，纯本地运行，数据不离开浏览器。
// @license            MIT
// @homepageURL        https://github.com/wanda1416/ai-chat-exporter
// @supportURL         https://github.com/wanda1416/ai-chat-exporter/issues
// @match              https://www.kimi.com/*
// @match              https://gemini.google.com/*
// @match              https://notebook.google.com/*
// @match              https://notebooklm.google.com/*
// @match              https://grok.com/*
// @match              https://chat.deepseek.com/*
// @match              https://chatgpt.com/*
// @grant              none
// @run-at             document-idle
// ==/UserScript==

/* eslint-disable */

(function () {
  'use strict';

  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  const BASE_URL$3 = "https://chatgpt.com";
  const DEFAULT_PAGE_SIZE$3 = 28;
  class ChatGPTClient {
    constructor(options = {}) {
      __publicField(this, "fetchImpl");
      __publicField(this, "pageSize");
      __publicField(this, "explicitToken");
      __publicField(this, "cachedToken");
      this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
      this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE$3;
      this.explicitToken = options.token;
    }
    /** Resolves the Bearer token from the override or the session endpoint. */
    async token() {
      if (this.explicitToken) return this.explicitToken;
      if (this.cachedToken) return this.cachedToken;
      try {
        const response = await this.fetchImpl(`${BASE_URL$3}/api/auth/session`, {
          method: "GET",
          credentials: "include",
          headers: { accept: "application/json" }
        });
        if (!response.ok) return void 0;
        const session = await response.json();
        this.cachedToken = session.accessToken || void 0;
        return this.cachedToken;
      } catch {
        return void 0;
      }
    }
    async get(path) {
      const token = await this.token();
      const headers = { accept: "application/json" };
      if (token) headers.authorization = `Bearer ${token}`;
      const response = await this.fetchImpl(`${BASE_URL$3}${path}`, {
        method: "GET",
        credentials: "include",
        headers
      });
      if (!response.ok) {
        throw new Error(`ChatGPT GET ${path} failed: ${response.status} ${response.statusText}`);
      }
      return await response.json();
    }
    /** One page of the sidebar history, starting at `offset`. */
    listPage(offset) {
      const params = new URLSearchParams({
        offset: String(offset),
        limit: String(this.pageSize),
        order: "updated"
      });
      return this.get(`/backend-api/conversations?${params.toString()}`);
    }
    /** The full mapping tree for a conversation (all branches, one round-trip). */
    conversationDetail(id) {
      return this.get(`/backend-api/conversation/${encodeURIComponent(id)}`);
    }
    /**
     * Downloads one file (user upload `file-…` or generated image, whose
     * `sediment://file_…` pointer is stripped to the bare id) by resolving the
     * signed URL from the files download endpoint, then fetching it. Best
     * effort: returns null on any failure so a dead file never aborts a batch.
     */
    async downloadFile(fileId) {
      const clean = fileId.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
      try {
        const data = await this.get(
          `/backend-api/files/${encodeURIComponent(clean)}/download`
        );
        if (!data.download_url) return null;
        const response = await this.fetchImpl(data.download_url);
        if (!response.ok) return null;
        const file = { bytes: new Uint8Array(await response.arrayBuffer()) };
        const mime = response.headers.get("content-type");
        if (mime) file.mimeType = mime;
        if (data.file_name) file.name = data.file_name;
        return file;
      } catch {
        return null;
      }
    }
  }
  const PLATFORM$4 = "chatgpt";
  const VISIBLE_CONTENT_TYPES = /* @__PURE__ */ new Set(["text", "multimodal_text"]);
  function toRole$3(role) {
    if (role === "assistant" || role === "tool") return "assistant";
    if (role === "system") return "system";
    return "user";
  }
  function toIso$1(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return new Date(Math.round(value * 1e3)).toISOString();
    }
    if (typeof value === "string" && value) {
      const ms = Date.parse(value);
      if (!Number.isNaN(ms)) return new Date(ms).toISOString();
    }
    return void 0;
  }
  function isVisible(raw) {
    var _a2, _b2, _c;
    const role = (_a2 = raw.author) == null ? void 0 : _a2.role;
    if (role !== "user" && role !== "assistant" && role !== "tool") return false;
    if (raw.recipient && raw.recipient !== "all") return false;
    if ((_b2 = raw.metadata) == null ? void 0 : _b2.is_visually_hidden_from_conversation) return false;
    const contentType = (_c = raw.content) == null ? void 0 : _c.content_type;
    return Boolean(contentType && VISIBLE_CONTENT_TYPES.has(contentType));
  }
  function imageAttachment(part) {
    const attachment = { id: part.asset_pointer };
    if (typeof part.size_bytes === "number" && Number.isFinite(part.size_bytes)) {
      attachment.sizeBytes = part.size_bytes;
    }
    return attachment;
  }
  function parseContent(content, attachments, seen) {
    const parts = [];
    for (const part of (content == null ? void 0 : content.parts) ?? []) {
      if (typeof part === "string") {
        if (part.trim()) parts.push({ type: "text", text: part });
        continue;
      }
      if ((part == null ? void 0 : part.content_type) === "image_asset_pointer" && part.asset_pointer) {
        const id = part.asset_pointer;
        if (!seen.has(id)) {
          seen.add(id);
          attachments.push(imageAttachment(part));
        }
        parts.push({ type: "image", attachmentId: id });
      }
    }
    return parts;
  }
  function parseCitations$2(refs) {
    const citations = [];
    const seen = /* @__PURE__ */ new Set();
    for (const ref of refs ?? []) {
      if (ref.type !== "grouped_webpages") continue;
      for (const item of ref.items ?? []) {
        const key = item.url ?? item.title ?? "";
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const citation = {};
        if (item.title) citation.title = item.title;
        if (item.url) citation.url = item.url;
        if (item.snippet) citation.snippet = item.snippet;
        citations.push(citation);
      }
    }
    return citations;
  }
  function parseAttachments$3(raw, attachments, seen) {
    const ids = [];
    for (const [index, file] of (raw ?? []).entries()) {
      const id = file.id || file.name || `attachment-${index}`;
      ids.push(id);
      if (seen.has(id)) continue;
      seen.add(id);
      const attachment = { id };
      if (file.name) attachment.name = file.name;
      if (typeof file.size === "number" && Number.isFinite(file.size)) {
        attachment.sizeBytes = file.size;
      }
      if (file.mime_type) attachment.mimeType = file.mime_type;
      attachments.push(attachment);
    }
    return ids;
  }
  function parseMessage$2(raw, attachments, seen) {
    var _a2;
    const content = parseContent(raw.content, attachments, seen);
    if (!content.length) return null;
    const message = {
      id: String(raw.id ?? ""),
      role: toRole$3((_a2 = raw.author) == null ? void 0 : _a2.role),
      content
    };
    const timestamp = toIso$1(raw.create_time);
    if (timestamp) message.timestamp = timestamp;
    const metadata = raw.metadata ?? {};
    if (metadata.model_slug && message.role === "assistant") {
      message.model = metadata.model_slug;
    }
    const citations = parseCitations$2(metadata.content_references);
    if (citations.length) message.citations = citations;
    const attachmentIds = parseAttachments$3(metadata.attachments, attachments, seen);
    if (attachmentIds.length) message.attachments = attachmentIds;
    return message;
  }
  function activePath$1(mapping, currentNode) {
    if (currentNode && mapping[currentNode]) {
      const chain = [];
      const guard = /* @__PURE__ */ new Set();
      let cursor = currentNode;
      while (typeof cursor === "string" && mapping[cursor] && !guard.has(cursor)) {
        guard.add(cursor);
        const node = mapping[cursor];
        if (node.message) chain.push(node.message);
        cursor = node.parent ?? null;
      }
      return chain.reverse();
    }
    return Object.values(mapping).map((node) => node.message).filter((message) => Boolean(message)).sort((a, b) => (a.create_time ?? 0) - (b.create_time ?? 0));
  }
  function linkChildren$3(messages) {
    const childrenOf = /* @__PURE__ */ new Map();
    for (const m of messages) {
      if (m.parentId) {
        const list = childrenOf.get(m.parentId) ?? [];
        list.push(m.id);
        childrenOf.set(m.parentId, list);
      }
    }
    for (const m of messages) {
      const children = childrenOf.get(m.id);
      if (children == null ? void 0 : children.length) m.childrenIds = children;
    }
  }
  function parseConversationList$3(page) {
    const metas = [];
    for (const item of page.items ?? []) {
      if (!item.id) continue;
      const meta = {
        id: item.id,
        platform: PLATFORM$4,
        title: item.title ?? ""
      };
      const createdAt = toIso$1(item.create_time);
      const updatedAt = toIso$1(item.update_time);
      if (createdAt) meta.createdAt = createdAt;
      if (updatedAt) meta.updatedAt = updatedAt;
      metas.push(meta);
    }
    return metas;
  }
  function nextOffset(page) {
    const items = page.items ?? [];
    if (!items.length) return void 0;
    const next = (page.offset ?? 0) + items.length;
    const total = page.total ?? 0;
    if (total && next >= total) return void 0;
    return next;
  }
  function toConversation$4(conversationId, detail, meta) {
    var _a2;
    const mapping = detail.mapping ?? {};
    const ordered = activePath$1(mapping, detail.current_node);
    const messages = [];
    const attachments = [];
    const seenAttachment = /* @__PURE__ */ new Set();
    for (const raw of ordered) {
      if (!isVisible(raw)) continue;
      const message = parseMessage$2(raw, attachments, seenAttachment);
      if (message) messages.push(message);
    }
    messages.forEach((message, index) => {
      message.parentId = index === 0 ? null : messages[index - 1].id;
    });
    linkChildren$3(messages);
    const firstUserPart = (_a2 = messages.find((m) => m.role === "user")) == null ? void 0 : _a2.content.find((c) => c.type === "text");
    const fallbackTitle = (firstUserPart == null ? void 0 : firstUserPart.type) === "text" ? firstUserPart.text : "";
    const conversation = {
      schemaVersion: "1",
      id: conversationId,
      platform: PLATFORM$4,
      title: detail.title || (meta == null ? void 0 : meta.title) || fallbackTitle,
      messages
    };
    if (detail.default_model_slug) conversation.model = detail.default_model_slug;
    const createdAt = (meta == null ? void 0 : meta.createdAt) ?? toIso$1(detail.create_time);
    const updatedAt = (meta == null ? void 0 : meta.updatedAt) ?? toIso$1(detail.update_time);
    if (createdAt) conversation.createdAt = createdAt;
    if (updatedAt) conversation.updatedAt = updatedAt;
    if (attachments.length) conversation.attachments = attachments;
    conversation.sourceUrl = `https://chatgpt.com/c/${conversationId}`;
    return conversation;
  }
  const MAX_PAGES$4 = 1e3;
  class ChatGPTAdapter {
    constructor(options = {}) {
      __publicField(this, "platform", PLATFORM$4);
      __publicField(this, "client");
      __publicField(this, "metaCache", /* @__PURE__ */ new Map());
      this.client = new ChatGPTClient(options);
    }
    detect() {
      if (typeof location === "undefined") return false;
      return /(^|\.)chatgpt\.com$/.test(location.hostname);
    }
    async *listConversations() {
      let offset = 0;
      for (let page = 0; page < MAX_PAGES$4; page++) {
        const data = await this.client.listPage(offset);
        const metas = parseConversationList$3(data);
        for (const meta of metas) {
          this.metaCache.set(meta.id, meta);
          yield meta;
        }
        const next = nextOffset(data);
        if (next === void 0) break;
        offset = next;
      }
    }
    async fetchConversation(id) {
      const data = await this.client.conversationDetail(id);
      const meta = this.metaCache.get(id);
      return toConversation$4(id, data, {
        title: meta == null ? void 0 : meta.title,
        createdAt: meta == null ? void 0 : meta.createdAt,
        updatedAt: meta == null ? void 0 : meta.updatedAt
      });
    }
    /**
     * Resolves attachment bytes via the files download endpoint — covers user
     * uploads (`file-…`) and generated images (`sediment://file_…` pointers),
     * neither of which carries a direct URL in the conversation payload.
     */
    async fetchAttachment(attachment) {
      return this.client.downloadFile(attachment.id);
    }
  }
  const BASE_URL$2 = "https://chat.deepseek.com/api/v0/";
  const DEFAULT_PAGE_SIZE$2 = 100;
  class DeepSeekClient {
    constructor(options = {}) {
      __publicField(this, "fetchImpl");
      __publicField(this, "pageSize");
      __publicField(this, "explicitToken");
      this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
      this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE$2;
      this.explicitToken = options.token;
    }
    /** Resolves the Bearer token from the override or localStorage. */
    token() {
      var _a2;
      if (this.explicitToken) return this.explicitToken;
      try {
        const raw = (_a2 = globalThis.localStorage) == null ? void 0 : _a2.getItem("userToken");
        if (!raw) return void 0;
        const parsed = JSON.parse(raw);
        return (parsed == null ? void 0 : parsed.value) || void 0;
      } catch {
        return void 0;
      }
    }
    async get(path) {
      var _a2, _b2, _c;
      const token = this.token();
      const headers = { accept: "application/json" };
      if (token) headers.authorization = `Bearer ${token}`;
      const response = await this.fetchImpl(`${BASE_URL$2}${path}`, {
        method: "GET",
        credentials: "include",
        headers
      });
      if (!response.ok) {
        throw new Error(`DeepSeek GET ${path} failed: ${response.status} ${response.statusText}`);
      }
      const envelope = await response.json();
      if (envelope.code !== 0 || ((_a2 = envelope.data) == null ? void 0 : _a2.biz_code) !== 0) {
        throw new Error(`DeepSeek GET ${path} error: ${envelope.msg || ((_b2 = envelope.data) == null ? void 0 : _b2.biz_msg) || "unknown"}`);
      }
      return ((_c = envelope.data) == null ? void 0 : _c.biz_data) ?? {};
    }
    /** One page of the sidebar history. `beforeSeqId` continues a previous page. */
    fetchPage(beforeSeqId) {
      const params = new URLSearchParams({ count: String(this.pageSize) });
      if (beforeSeqId !== void 0) params.set("before_seq_id", String(beforeSeqId));
      return this.get(`chat_session/fetch_page?${params.toString()}`);
    }
    /** The full message set for a conversation (all branches, one round-trip). */
    historyMessages(chatSessionId) {
      const params = new URLSearchParams({ chat_session_id: chatSessionId });
      return this.get(`chat/history_messages?${params.toString()}`);
    }
  }
  const PLATFORM$3 = "deepseek";
  function toRole$2(role) {
    const r = (role ?? "").toLowerCase();
    if (r === "assistant") return "assistant";
    if (r === "system") return "system";
    return "user";
  }
  function toIso(seconds) {
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) return void 0;
    return new Date(Math.round(seconds * 1e3)).toISOString();
  }
  function parseCitations$1(results) {
    const citations = [];
    const seen = /* @__PURE__ */ new Set();
    for (const result of results ?? []) {
      const key = result.url ?? result.title ?? "";
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const citation = {};
      if (result.title) citation.title = result.title;
      if (result.url) citation.url = result.url;
      if (result.snippet) citation.snippet = result.snippet;
      citations.push(citation);
    }
    return citations;
  }
  function parseAttachments$2(files) {
    const attachments = [];
    for (const [index, file] of (files ?? []).entries()) {
      const attachment = { id: file.id || file.file_name || `file-${index}` };
      if (file.file_name) attachment.name = file.file_name;
      if (typeof file.file_size === "number" && Number.isFinite(file.file_size)) {
        attachment.sizeBytes = file.file_size;
      }
      attachments.push(attachment);
    }
    return attachments;
  }
  function parseMessage$1(raw) {
    const id = String(raw.message_id ?? "");
    const message = {
      id,
      role: toRole$2(raw.role),
      content: raw.content ? [{ type: "text", text: raw.content }] : []
    };
    const timestamp = toIso(raw.inserted_at);
    if (timestamp) message.timestamp = timestamp;
    if (raw.model && message.role === "assistant") message.model = raw.model;
    if (raw.thinking_content) {
      const reasoning = { content: raw.thinking_content };
      if (typeof raw.thinking_elapsed_secs === "number" && raw.thinking_elapsed_secs > 0) {
        reasoning.summary = `Thought for ${Math.round(raw.thinking_elapsed_secs)}s`;
      }
      message.reasoning = reasoning;
    }
    const citations = parseCitations$1(raw.search_results);
    if (citations.length) message.citations = citations;
    const attachments = parseAttachments$2(raw.files);
    if (attachments.length) message.attachments = attachments.map((a) => a.id);
    if (raw.parent_id !== void 0) {
      message.parentId = raw.parent_id === null ? null : String(raw.parent_id);
    }
    return { message, attachments };
  }
  function activePath(messages, currentId) {
    const byId = /* @__PURE__ */ new Map();
    for (const m of messages) {
      if (typeof m.message_id === "number") byId.set(m.message_id, m);
    }
    if (currentId !== void 0 && byId.has(currentId)) {
      const chain = [];
      const guard = /* @__PURE__ */ new Set();
      let cursor = currentId;
      while (typeof cursor === "number" && byId.has(cursor) && !guard.has(cursor)) {
        guard.add(cursor);
        const node = byId.get(cursor);
        chain.push(node);
        cursor = node.parent_id ?? null;
      }
      return chain.reverse();
    }
    return [...messages].sort((a, b) => (a.message_id ?? 0) - (b.message_id ?? 0));
  }
  function linkChildren$2(messages) {
    const childrenOf = /* @__PURE__ */ new Map();
    for (const m of messages) {
      if (m.parentId) {
        const list = childrenOf.get(m.parentId) ?? [];
        list.push(m.id);
        childrenOf.set(m.parentId, list);
      }
    }
    for (const m of messages) {
      const children = childrenOf.get(m.id);
      if (children == null ? void 0 : children.length) m.childrenIds = children;
    }
  }
  function parseConversationList$2(data) {
    const metas = [];
    for (const session of data.chat_sessions ?? []) {
      if (!session.id) continue;
      const meta = {
        id: session.id,
        platform: PLATFORM$3,
        title: session.title ?? ""
      };
      const createdAt = toIso(session.inserted_at);
      const updatedAt = toIso(session.updated_at);
      if (createdAt) meta.createdAt = createdAt;
      if (updatedAt) meta.updatedAt = updatedAt;
      metas.push(meta);
    }
    return metas;
  }
  function hasMore(data) {
    return Boolean(data.has_more);
  }
  function lastSeqId(data) {
    var _a2;
    const sessions = data.chat_sessions;
    if (!(sessions == null ? void 0 : sessions.length)) return void 0;
    return (_a2 = sessions[sessions.length - 1]) == null ? void 0 : _a2.seq_id;
  }
  function toConversation$3(conversationId, data, meta) {
    var _a2;
    const session = data.chat_session ?? {};
    const ordered = activePath(data.chat_messages ?? [], session.current_message_id);
    const messages = [];
    const attachments = [];
    const seenAttachment = /* @__PURE__ */ new Set();
    for (const raw of ordered) {
      const parsed = parseMessage$1(raw);
      messages.push(parsed.message);
      for (const att of parsed.attachments) {
        if (seenAttachment.has(att.id)) continue;
        seenAttachment.add(att.id);
        attachments.push(att);
      }
    }
    linkChildren$2(messages);
    const firstUserPart = (_a2 = messages.find((m) => m.role === "user")) == null ? void 0 : _a2.content.find((c) => c.type === "text");
    const fallbackTitle = (firstUserPart == null ? void 0 : firstUserPart.type) === "text" ? firstUserPart.text : "";
    const conversation = {
      schemaVersion: "1",
      id: conversationId,
      platform: PLATFORM$3,
      title: session.title || (meta == null ? void 0 : meta.title) || fallbackTitle,
      messages
    };
    const createdAt = (meta == null ? void 0 : meta.createdAt) ?? toIso(session.inserted_at);
    const updatedAt = (meta == null ? void 0 : meta.updatedAt) ?? toIso(session.updated_at);
    if (createdAt) conversation.createdAt = createdAt;
    if (updatedAt) conversation.updatedAt = updatedAt;
    if (attachments.length) conversation.attachments = attachments;
    conversation.sourceUrl = `https://chat.deepseek.com/a/chat/s/${conversationId}`;
    return conversation;
  }
  const MAX_PAGES$3 = 1e3;
  class DeepSeekAdapter {
    constructor(options = {}) {
      __publicField(this, "platform", PLATFORM$3);
      __publicField(this, "client");
      __publicField(this, "metaCache", /* @__PURE__ */ new Map());
      this.client = new DeepSeekClient(options);
    }
    detect() {
      if (typeof location === "undefined") return false;
      return /(^|\.)chat\.deepseek\.com$/.test(location.hostname);
    }
    async *listConversations() {
      let beforeSeqId;
      for (let page = 0; page < MAX_PAGES$3; page++) {
        const data = await this.client.fetchPage(beforeSeqId);
        const metas = parseConversationList$2(data);
        for (const meta of metas) {
          this.metaCache.set(meta.id, meta);
          yield meta;
        }
        if (!hasMore(data) || metas.length === 0) break;
        const next = lastSeqId(data);
        if (next === void 0) break;
        beforeSeqId = next;
      }
    }
    async fetchConversation(id) {
      const data = await this.client.historyMessages(id);
      const meta = this.metaCache.get(id);
      return toConversation$3(id, data, {
        title: meta == null ? void 0 : meta.title,
        createdAt: meta == null ? void 0 : meta.createdAt,
        updatedAt: meta == null ? void 0 : meta.updatedAt
      });
    }
  }
  const PLATFORM$2 = "gemini";
  const asArray = (v) => Array.isArray(v) ? v : [];
  const asString = (v) => typeof v === "string" && v.length > 0 ? v : void 0;
  const at = (v, i) => Array.isArray(v) ? v[i] : void 0;
  function isoFromTuple(tuple) {
    const seconds = at(tuple, 0);
    if (typeof seconds !== "number") return void 0;
    return new Date(seconds * 1e3).toISOString();
  }
  function bareId(id) {
    return id.startsWith("c_") ? id.slice(2) : id;
  }
  function findModel(candidatesBlock) {
    const arr = asArray(candidatesBlock);
    for (let i = arr.length - 1; i >= 0; i--) {
      const s = asString(arr[i]);
      if (s && !/^(rc_|r_|c_|m_)/.test(s)) return s;
    }
    return void 0;
  }
  function extractRpcPayload(rawBody, rpcid) {
    const body = rawBody.replace(/^\)\]\}'\s*/, "");
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("[")) continue;
      let chunk;
      try {
        chunk = JSON.parse(trimmed);
      } catch {
        continue;
      }
      for (const entry of asArray(chunk)) {
        if (Array.isArray(entry) && entry[0] === "wrb.fr" && entry[1] === rpcid && typeof entry[2] === "string") {
          return JSON.parse(entry[2]);
        }
      }
    }
    throw new Error(`Gemini batchexecute response had no "${rpcid}" payload.`);
  }
  function parseConversationList$1(payload) {
    const items = asArray(at(payload, 2));
    const metas = [];
    for (const item of items) {
      const id = asString(at(item, 0));
      if (!id) continue;
      const meta = {
        id,
        platform: PLATFORM$2,
        title: asString(at(item, 1)) ?? ""
      };
      const createdAt = isoFromTuple(at(item, 5));
      if (createdAt) meta.createdAt = createdAt;
      metas.push(meta);
    }
    return metas;
  }
  function nextPageToken$1(payload) {
    return asString(at(payload, 1));
  }
  function detailTurns(payload) {
    return asArray(at(payload, 0));
  }
  function detailNextPageToken(payload) {
    return asString(at(payload, 1));
  }
  function turnResponseId(turn) {
    return asString(at(at(turn, 0), 1));
  }
  function turnTime(turn) {
    const seconds = at(at(turn, 4), 0);
    if (typeof seconds !== "number") return void 0;
    const nanos = at(at(turn, 4), 1);
    return seconds + (typeof nanos === "number" ? nanos / 1e9 : 0);
  }
  function selectedMarkdown(candidatesBlock) {
    const candidates = asArray(at(candidatesBlock, 0));
    const selectedId = asString(at(candidatesBlock, 3));
    const chosen = candidates.find((c) => asString(at(c, 0)) === selectedId) ?? candidates[0];
    return asString(at(at(chosen, 1), 0)) ?? "";
  }
  function parseTurn(turn) {
    const messages = [];
    const userText = asString(at(at(at(turn, 2), 0), 0));
    const userId = asString(at(at(turn, 2), 4));
    if (userText) {
      const content = [{ type: "text", text: userText }];
      messages.push({ id: userId ?? `${asString(at(at(turn, 0), 1)) ?? "turn"}-user`, role: "user", content });
    }
    const candidatesBlock = at(turn, 3);
    const markdown = selectedMarkdown(candidatesBlock);
    const assistantId = asString(at(candidatesBlock, 3));
    if (markdown || assistantId) {
      const content = markdown ? [{ type: "text", text: markdown }] : [];
      const message = {
        id: assistantId ?? `${asString(at(at(turn, 0), 1)) ?? "turn"}-assistant`,
        role: "assistant",
        content
      };
      const timestamp = isoFromTuple(at(turn, 4));
      if (timestamp) message.timestamp = timestamp;
      const model = findModel(candidatesBlock);
      if (model) message.model = model;
      messages.push(message);
    }
    return messages;
  }
  function toConversation$2(conversationId, payload, title) {
    var _a2, _b2, _c;
    const turns = [...detailTurns(payload)].sort((a, b) => {
      const ta = turnTime(a);
      const tb = turnTime(b);
      return ta !== void 0 && tb !== void 0 ? ta - tb : 0;
    });
    const messages = turns.flatMap(parseTurn);
    const firstUserText = (_b2 = (_a2 = messages.find((m) => m.role === "user")) == null ? void 0 : _a2.content.find(
      (part) => part.type === "text"
    )) == null ? void 0 : _b2.text;
    const derivedTitle = firstUserText ? firstUserText.slice(0, 40) + (firstUserText.length > 40 ? "…" : "") : "Gemini conversation";
    const conversation = {
      schemaVersion: "1",
      id: conversationId,
      platform: PLATFORM$2,
      title: title ?? derivedTitle,
      messages
    };
    const model = (_c = messages.find((m) => m.model)) == null ? void 0 : _c.model;
    if (model) conversation.model = model;
    const timestamps = messages.map((m) => m.timestamp).filter((t) => Boolean(t));
    if (timestamps.length) {
      conversation.createdAt = timestamps[0];
      conversation.updatedAt = timestamps[timestamps.length - 1];
    }
    conversation.sourceUrl = `https://gemini.google.com/app/${bareId(conversationId)}`;
    return conversation;
  }
  const RPC_LIST = "MaZiqc";
  const RPC_DETAIL = "hNvQHb";
  const BATCHEXECUTE_URL = "https://gemini.google.com/_/BardChatUi/data/batchexecute";
  const LIST_PAGE_SIZE = 20;
  const DETAIL_PAGE_SIZE = 100;
  class GeminiClient {
    constructor(options = {}) {
      __publicField(this, "fetchImpl");
      __publicField(this, "language");
      __publicField(this, "explicitAt");
      __publicField(this, "explicitBl");
      __publicField(this, "explicitSid");
      __publicField(this, "reqId");
      this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
      this.language = options.language ?? "en";
      this.explicitAt = options.atToken;
      this.explicitBl = options.blVersion;
      this.explicitSid = options.fSid;
      this.reqId = Math.floor(Math.random() * 9e4) + 1e4;
    }
    get wiz() {
      return globalThis.WIZ_global_data ?? {};
    }
    resolveAt() {
      const at2 = this.explicitAt ?? this.wiz.SNlM0e;
      if (!at2) {
        throw new Error(
          "Gemini `at` token not found. Provide `atToken` or run where window.WIZ_global_data is set."
        );
      }
      return at2;
    }
    async call(rpcid, innerPayload) {
      const url = new URL(BATCHEXECUTE_URL);
      url.searchParams.set("rpcids", rpcid);
      url.searchParams.set("source-path", "/app");
      const bl = this.explicitBl ?? this.wiz.cfb2h;
      const sid = this.explicitSid ?? this.wiz.FdrFJe;
      if (bl) url.searchParams.set("bl", bl);
      if (sid) url.searchParams.set("f.sid", sid);
      url.searchParams.set("hl", this.language);
      url.searchParams.set("_reqid", String(this.reqId += 1e5));
      url.searchParams.set("rt", "c");
      const envelope = [[[rpcid, JSON.stringify(innerPayload), null, "generic"]]];
      const body = `f.req=${encodeURIComponent(JSON.stringify(envelope))}&at=${encodeURIComponent(this.resolveAt())}&`;
      const response = await this.fetchImpl(url.toString(), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body
      });
      if (!response.ok) {
        throw new Error(`Gemini ${rpcid} failed: ${response.status} ${response.statusText}`);
      }
      return extractRpcPayload(await response.text(), rpcid);
    }
    /** One page of the sidebar history. `pageToken` continues a previous page. */
    listConversations(pageToken) {
      return this.call(RPC_LIST, [LIST_PAGE_SIZE, pageToken ?? null, [0, null, 1]]);
    }
    /**
     * One page of a conversation's turns, newest-first. Accepts ids with or
     * without `c_`. `pageToken` continues into older turns (same continuation
     * mechanism as the list RPC; token surfaces at payload[1]).
     */
    getConversation(conversationId, pageToken) {
      const cid = conversationId.startsWith("c_") ? conversationId : `c_${conversationId}`;
      return this.call(RPC_DETAIL, [cid, DETAIL_PAGE_SIZE, pageToken ?? null, 1, [0], [4], null, 1]);
    }
  }
  const MAX_PAGES$2 = 1e3;
  class GeminiAdapter {
    constructor(options = {}) {
      __publicField(this, "platform", PLATFORM$2);
      __publicField(this, "client");
      __publicField(this, "titles", /* @__PURE__ */ new Map());
      this.client = new GeminiClient(options);
    }
    detect() {
      if (typeof location === "undefined") return false;
      return /(^|\.)gemini\.google\.com$/.test(location.hostname);
    }
    async *listConversations() {
      let pageToken;
      for (let page = 0; page < MAX_PAGES$2; page++) {
        const payload = await this.client.listConversations(pageToken);
        const metas = parseConversationList$1(payload);
        for (const meta of metas) {
          this.titles.set(meta.id, meta.title);
          yield meta;
        }
        pageToken = nextPageToken$1(payload);
        if (!pageToken || metas.length === 0) break;
      }
    }
    async fetchConversation(id) {
      const allTurns = [];
      const seen = /* @__PURE__ */ new Set();
      let pageToken;
      for (let page = 0; page < MAX_PAGES$2; page++) {
        const payload = await this.client.getConversation(id, pageToken);
        const turns = detailTurns(payload);
        for (const turn of turns) {
          const key = turnResponseId(turn);
          if (key && seen.has(key)) continue;
          if (key) seen.add(key);
          allTurns.push(turn);
        }
        pageToken = detailNextPageToken(payload);
        if (!pageToken || turns.length === 0) break;
      }
      const combined = [allTurns, null, null, []];
      return toConversation$2(id, combined, this.titles.get(id));
    }
  }
  const BASE_URL$1 = "https://grok.com/rest/";
  const DEFAULT_PAGE_SIZE$1 = 30;
  class GrokClient {
    constructor(options = {}) {
      __publicField(this, "fetchImpl");
      __publicField(this, "pageSize");
      this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
      this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE$1;
    }
    async get(path) {
      const response = await this.fetchImpl(`${BASE_URL$1}${path}`, {
        method: "GET",
        credentials: "include",
        headers: { accept: "application/json" }
      });
      if (!response.ok) {
        throw new Error(`Grok GET ${path} failed: ${response.status} ${response.statusText}`);
      }
      return await response.json();
    }
    async post(path, body) {
      const response = await this.fetchImpl(`${BASE_URL$1}${path}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body ?? {})
      });
      if (!response.ok) {
        throw new Error(`Grok POST ${path} failed: ${response.status} ${response.statusText}`);
      }
      return await response.json();
    }
    /** One page of the sidebar history. `pageToken` continues a previous page. */
    listConversations(pageToken) {
      const params = new URLSearchParams({ pageSize: String(this.pageSize) });
      if (pageToken) params.set("pageToken", pageToken);
      return this.get(`app-chat/conversations?${params.toString()}`);
    }
    /** The ordered message-tree skeleton (ids + sender + parent, no content). */
    responseNodes(conversationId) {
      return this.get(
        `app-chat/conversations/${conversationId}/response-node`
      );
    }
    /** The full content for the given response ids (order is NOT preserved). */
    loadResponses(conversationId, responseIds) {
      return this.post(
        `app-chat/conversations/${conversationId}/load-responses`,
        { responseIds }
      );
    }
  }
  const PLATFORM$1 = "grok";
  function toRole$1(sender) {
    return (sender ?? "").toLowerCase() === "assistant" ? "assistant" : "user";
  }
  function parseCitations(results) {
    const citations = [];
    const seen = /* @__PURE__ */ new Set();
    for (const result of results ?? []) {
      const key = result.url ?? result.title ?? "";
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const citation = {};
      if (result.title) citation.title = result.title;
      if (result.url) citation.url = result.url;
      if (result.preview) citation.snippet = result.preview;
      citations.push(citation);
    }
    return citations;
  }
  function parseAttachments$1(assets) {
    const attachments = [];
    for (const [index, asset] of (assets ?? []).entries()) {
      const size = typeof asset.sizeBytes === "string" ? Number(asset.sizeBytes) : asset.sizeBytes;
      const attachment = { id: asset.assetId || asset.name || `file-${index}` };
      if (asset.name) attachment.name = asset.name;
      if (asset.mimeType) attachment.mimeType = asset.mimeType;
      if (typeof size === "number" && Number.isFinite(size)) attachment.sizeBytes = size;
      attachments.push(attachment);
    }
    return attachments;
  }
  function parseResponse(raw) {
    var _a2;
    const id = raw.responseId ?? "";
    const message = {
      id,
      role: toRole$1(raw.sender),
      content: raw.message ? [{ type: "text", text: raw.message }] : []
    };
    if (raw.createTime) message.timestamp = raw.createTime;
    if (raw.model && message.role === "assistant") message.model = raw.model;
    const citations = parseCitations(((_a2 = raw.citedWebSearchResults) == null ? void 0 : _a2.length) ? raw.citedWebSearchResults : raw.webSearchResults);
    if (citations.length) message.citations = citations;
    const attachments = parseAttachments$1(raw.fileAttachmentAssetMetadata);
    if (attachments.length) message.attachments = attachments.map((a) => a.id);
    if (raw.parentResponseId !== void 0) message.parentId = raw.parentResponseId || null;
    return { message, attachments };
  }
  function sortChronologically$1(messages) {
    const originalIndex = /* @__PURE__ */ new Map();
    messages.forEach((m, i) => originalIndex.set(m, i));
    messages.sort((a, b) => {
      const ta = a.timestamp ?? "";
      const tb = b.timestamp ?? "";
      if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
      return (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0);
    });
  }
  function linkChildren$1(messages) {
    const childrenOf = /* @__PURE__ */ new Map();
    for (const m of messages) {
      if (m.parentId) {
        const list = childrenOf.get(m.parentId) ?? [];
        list.push(m.id);
        childrenOf.set(m.parentId, list);
      }
    }
    for (const m of messages) {
      const children = childrenOf.get(m.id);
      if (children == null ? void 0 : children.length) m.childrenIds = children;
    }
  }
  function parseConversationList(response) {
    const metas = [];
    for (const conv of response.conversations ?? []) {
      if (!conv.conversationId) continue;
      const meta = {
        id: conv.conversationId,
        platform: PLATFORM$1,
        title: conv.title ?? ""
      };
      if (conv.createTime) meta.createdAt = conv.createTime;
      if (conv.modifyTime) meta.updatedAt = conv.modifyTime;
      metas.push(meta);
    }
    return metas;
  }
  function nextPageToken(response) {
    return response.nextPageToken || void 0;
  }
  function toConversation$1(conversationId, nodes, loaded, meta) {
    var _a2, _b2;
    const byId = /* @__PURE__ */ new Map();
    for (const r of loaded.responses ?? []) {
      if (r.responseId) byId.set(r.responseId, r);
    }
    const ordered = [];
    const seen = /* @__PURE__ */ new Set();
    for (const node of nodes.responseNodes ?? []) {
      const id = node.responseId;
      if (!id || seen.has(id)) continue;
      const raw = byId.get(id) ?? { responseId: id, sender: node.sender, parentResponseId: node.parentResponseId };
      seen.add(id);
      ordered.push(raw);
    }
    for (const r of loaded.responses ?? []) {
      if (r.responseId && !seen.has(r.responseId)) {
        seen.add(r.responseId);
        ordered.push(r);
      }
    }
    const messages = [];
    const attachments = [];
    const seenAttachment = /* @__PURE__ */ new Set();
    for (const raw of ordered) {
      const parsed = parseResponse(raw);
      messages.push(parsed.message);
      for (const att of parsed.attachments) {
        if (seenAttachment.has(att.id)) continue;
        seenAttachment.add(att.id);
        attachments.push(att);
      }
    }
    sortChronologically$1(messages);
    linkChildren$1(messages);
    const model = (_a2 = [...messages].reverse().find((m) => m.model)) == null ? void 0 : _a2.model;
    const firstUserPart = (_b2 = messages.find((m) => m.role === "user")) == null ? void 0 : _b2.content.find((c) => c.type === "text");
    const fallbackTitle = (firstUserPart == null ? void 0 : firstUserPart.type) === "text" ? firstUserPart.text : "";
    const conversation = {
      schemaVersion: "1",
      id: conversationId,
      platform: PLATFORM$1,
      title: (meta == null ? void 0 : meta.title) || fallbackTitle,
      messages
    };
    if (meta == null ? void 0 : meta.createdAt) conversation.createdAt = meta.createdAt;
    if (meta == null ? void 0 : meta.updatedAt) conversation.updatedAt = meta.updatedAt;
    if (model) conversation.model = model;
    if (attachments.length) conversation.attachments = attachments;
    conversation.sourceUrl = `https://grok.com/c/${conversationId}`;
    return conversation;
  }
  const MAX_PAGES$1 = 1e3;
  class GrokAdapter {
    constructor(options = {}) {
      __publicField(this, "platform", PLATFORM$1);
      __publicField(this, "client");
      __publicField(this, "metaCache", /* @__PURE__ */ new Map());
      this.client = new GrokClient(options);
    }
    detect() {
      if (typeof location === "undefined") return false;
      return /(^|\.)grok\.com$/.test(location.hostname);
    }
    async *listConversations() {
      let pageToken;
      for (let page = 0; page < MAX_PAGES$1; page++) {
        const response = await this.client.listConversations(pageToken);
        const metas = parseConversationList(response);
        for (const meta of metas) {
          this.metaCache.set(meta.id, meta);
          yield meta;
        }
        pageToken = nextPageToken(response);
        if (!pageToken || metas.length === 0) break;
      }
    }
    async fetchConversation(id) {
      const nodes = await this.client.responseNodes(id);
      const responseIds = (nodes.responseNodes ?? []).map((n) => n.responseId).filter((rid) => Boolean(rid));
      const loaded = responseIds.length ? await this.client.loadResponses(id, responseIds) : { responses: [] };
      const meta = this.metaCache.get(id);
      return toConversation$1(id, nodes, loaded, {
        title: meta == null ? void 0 : meta.title,
        createdAt: meta == null ? void 0 : meta.createdAt,
        updatedAt: meta == null ? void 0 : meta.updatedAt
      });
    }
  }
  const BASE_URL = "https://www.kimi.com/apiv2/";
  const FEED_SERVICE = "kimi.gateway.feed.v1.FeedService";
  const CHAT_SERVICE = "kimi.gateway.chat.v1.ChatService";
  class KimiClient {
    constructor(options = {}) {
      __publicField(this, "fetchImpl");
      __publicField(this, "language");
      __publicField(this, "explicitToken");
      this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
      this.language = options.language ?? "zh-CN";
      this.explicitToken = options.token;
    }
    resolveToken() {
      var _a2;
      const token = this.explicitToken ?? ((_a2 = globalThis.localStorage) == null ? void 0 : _a2.getItem("access_token")) ?? void 0;
      if (!token) {
        throw new Error(
          "Kimi access token not found. Provide `token` or run where localStorage.access_token is set."
        );
      }
      return token;
    }
    async call(service, method, body) {
      const response = await this.fetchImpl(`${BASE_URL}${service}/${method}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.resolveToken()}`,
          "x-msh-platform": "web",
          "x-language": this.language
        },
        body: JSON.stringify(body ?? {})
      });
      if (!response.ok) {
        throw new Error(`Kimi ${service}/${method} failed: ${response.status} ${response.statusText}`);
      }
      return await response.json();
    }
    listFeeds(request) {
      return this.call(FEED_SERVICE, "ListFeeds", request);
    }
    getChat(chatId) {
      return this.call(CHAT_SERVICE, "GetChat", { chat_id: chatId });
    }
    listMessages(chatId) {
      return this.call(CHAT_SERVICE, "ListMessages", { chat_id: chatId });
    }
  }
  const PLATFORM = "kimi";
  function toRole(raw) {
    const v = (raw ?? "").toLowerCase();
    if (v.includes("assistant")) return "assistant";
    if (v.includes("system")) return "system";
    return "user";
  }
  function parseBlocks(blocks) {
    var _a2;
    const content = [];
    const thoughts = [];
    const summaries = [];
    for (const block of blocks ?? []) {
      if ((_a2 = block.text) == null ? void 0 : _a2.content) {
        content.push({ type: "text", text: block.text.content });
      } else if (block.think) {
        if (block.think.content) thoughts.push(block.think.content);
        if (block.think.summary) summaries.push(block.think.summary);
      }
    }
    const reasoning = thoughts.length ? {
      content: thoughts.join("\n\n"),
      ...summaries.length ? { summary: summaries.join("\n\n") } : {}
    } : void 0;
    return { content, reasoning };
  }
  function parseReferences(references) {
    var _a2;
    const citations = [];
    const seen = /* @__PURE__ */ new Set();
    for (const ref of references ?? []) {
      for (const item of ref.items ?? []) {
        const base = (_a2 = item.search) == null ? void 0 : _a2.base;
        if (!base) continue;
        const key = base.url ?? base.title ?? "";
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const citation = {};
        if (base.title) citation.title = base.title;
        if (base.url) citation.url = base.url;
        if (base.snippet) citation.snippet = base.snippet;
        citations.push(citation);
      }
    }
    return citations;
  }
  function parseMessage(raw) {
    const { content, reasoning } = parseBlocks(raw.blocks);
    const citations = parseReferences(raw.references);
    const message = {
      id: raw.id ?? "",
      role: toRole(raw.role),
      content
    };
    if (raw.createTime) message.timestamp = raw.createTime;
    if (reasoning) message.reasoning = reasoning;
    if (citations.length) message.citations = citations;
    if (raw.parentId !== void 0) message.parentId = raw.parentId || null;
    return message;
  }
  function sortChronologically(messages) {
    const originalIndex = /* @__PURE__ */ new Map();
    messages.forEach((m, i) => originalIndex.set(m, i));
    messages.sort((a, b) => {
      const ta = a.timestamp ?? "";
      const tb = b.timestamp ?? "";
      if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
      return (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0);
    });
  }
  function linkChildren(messages) {
    const childrenOf = /* @__PURE__ */ new Map();
    for (const m of messages) {
      if (m.parentId) {
        const list = childrenOf.get(m.parentId) ?? [];
        list.push(m.id);
        childrenOf.set(m.parentId, list);
      }
    }
    for (const m of messages) {
      const children = childrenOf.get(m.id);
      if (children == null ? void 0 : children.length) m.childrenIds = children;
    }
  }
  function parseAttachments(chat) {
    return (chat.files ?? []).map((file, index) => {
      var _a2;
      const meta = file.meta ?? {};
      const size = typeof meta.sizeBytes === "string" ? Number(meta.sizeBytes) : meta.sizeBytes;
      const attachment = { id: meta.checksum || meta.name || `file-${index}` };
      if (meta.name) attachment.name = meta.name;
      if (meta.contentType) attachment.mimeType = meta.contentType;
      if (typeof size === "number" && Number.isFinite(size)) attachment.sizeBytes = size;
      if ((_a2 = file.blob) == null ? void 0 : _a2.signUrl) attachment.url = file.blob.signUrl;
      if (meta.checksum) attachment.checksum = meta.checksum;
      return attachment;
    });
  }
  function parseFeeds(response) {
    const metas = [];
    for (const item of response.items ?? []) {
      const chat = item.chat;
      if (!(chat == null ? void 0 : chat.id)) continue;
      const meta = { id: chat.id, platform: PLATFORM, title: chat.name ?? "" };
      if (chat.createTime) meta.createdAt = chat.createTime;
      if (chat.updateTime) meta.updatedAt = chat.updateTime;
      metas.push(meta);
    }
    return metas;
  }
  function toConversation(chatId, chat, messages) {
    const summary = chat.chat ?? {};
    const attachments = parseAttachments(chat);
    const parsedMessages = (messages.messages ?? []).map(parseMessage);
    sortChronologically(parsedMessages);
    linkChildren(parsedMessages);
    const conversation = {
      schemaVersion: "1",
      id: summary.id ?? chatId,
      platform: PLATFORM,
      title: summary.name ?? "",
      messages: parsedMessages
    };
    if (summary.createTime) conversation.createdAt = summary.createTime;
    if (summary.updateTime) conversation.updatedAt = summary.updateTime;
    if (attachments.length) conversation.attachments = attachments;
    conversation.sourceUrl = `https://www.kimi.com/chat/${conversation.id}`;
    return conversation;
  }
  const DEFAULT_PAGE_SIZE = 30;
  const MAX_PAGES = 1e3;
  class KimiAdapter {
    constructor(options = {}) {
      __publicField(this, "platform", PLATFORM);
      __publicField(this, "client");
      this.client = new KimiClient(options);
    }
    detect() {
      if (typeof location === "undefined") return false;
      return /(^|\.)kimi\.com$/.test(location.hostname);
    }
    async *listConversations() {
      let pageToken;
      for (let page = 0; page < MAX_PAGES; page++) {
        const response = await this.client.listFeeds({
          page_size: DEFAULT_PAGE_SIZE,
          filter_types: ["FEED_TYPE_CHAT", "FEED_TYPE_TASK"],
          include_pinned: true,
          ...pageToken ? { page_token: pageToken } : {}
        });
        const metas = parseFeeds(response);
        for (const meta of metas) yield meta;
        pageToken = response.nextPageToken;
        if (!pageToken || metas.length === 0) break;
      }
    }
    async fetchConversation(id) {
      const [chat, messages] = await Promise.all([
        this.client.getChat(id),
        this.client.listMessages(id)
      ]);
      return toConversation(id, chat, messages);
    }
  }
  function slugify(input, fallback = "untitled") {
    const slug = input.normalize("NFKC").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
    return slug || fallback;
  }
  let filenameAccountPrefix = "";
  function slugifyAccount(raw) {
    const slug = String(raw || "").trim().toLowerCase().replace(/@/g, "-at-").replace(/[\\/:*?"<>|]+/g, " ").replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
    return slug;
  }
  function conversationBaseName(conversation) {
    const date = (conversation.createdAt ?? conversation.updatedAt ?? "").slice(0, 10);
    const title = slugify(conversation.title, conversation.id);
    const prefix = filenameAccountPrefix ? `${filenameAccountPrefix}-` : "";
    const platform = conversation.platform ? `${conversation.platform}-` : "";
    return date ? `${prefix}${platform}${date}-${title}` : `${prefix}${platform}${title}`;
  }
  function proposedFileName(meta) {
    return `${conversationBaseName({
      id: meta.id,
      platform: meta.platform,
      title: meta.title || "",
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt
    })}.md`;
  }
  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  function findEmail(value, depth = 0) {
    if (depth > 5 || value == null) return "";
    if (typeof value === "string") {
      const match = value.match(EMAIL_RE);
      return match ? match[0] : "";
    }
    if (typeof value !== "object") return "";
    const keys = Object.keys(value);
    const preferred = keys.filter((key) => /email|mail/i.test(key) && !/token|secret|password/i.test(key));
    for (const key of preferred) {
      const hit = findEmail(value[key], depth + 1);
      if (hit) return hit;
    }
    for (const key of keys) {
      if (preferred.includes(key) || /token|secret|password|authorization/i.test(key)) continue;
      const hit = findEmail(value[key], depth + 1);
      if (hit) return hit;
    }
    return "";
  }
  function findDisplayName(value, depth = 0) {
    if (depth > 4 || value == null || typeof value !== "object") return "";
    for (const key of ["name", "displayName", "username", "userName", "handle", "screenName"]) {
      const v = value[key];
      if (typeof v === "string" && v.trim() && !EMAIL_RE.test(v) && v.length < 80) return v.trim();
    }
    for (const key of Object.keys(value)) {
      if (/token|secret|password/i.test(key)) continue;
      const hit = findDisplayName(value[key], depth + 1);
      if (hit) return hit;
    }
    return "";
  }
  async function probeChatGPTSession() {
    const response = await fetch("https://chatgpt.com/api/auth/session", {
      method: "GET",
      credentials: "include",
      headers: { accept: "application/json" }
    });
    if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };
    const session = await response.json();
    const user = session && session.user || {};
    const email = user.email || findEmail(session);
    const name = user.name || user.displayName || findDisplayName(user);
    const keys = session && typeof session === "object" ? Object.keys(session).join(", ") : "";
    const userKeys = user && typeof user === "object" ? Object.keys(user).join(", ") : "";
    return {
      ok: Boolean(email || name),
      label: email || name || "",
      detail: `session keys: ${keys || "(none)"}; user keys: ${userKeys || "(none)"}`
    };
  }
  function visibleCheckbox(checked) {
    const box = document.createElement("input");
    box.type = "checkbox";
    if (checked) box.checked = true;
    const important = {
      appearance: "auto",
      "-webkit-appearance": "auto",
      width: "16px",
      height: "16px",
      margin: "2px 0 0",
      opacity: "1",
      visibility: "visible",
      position: "static",
      "accent-color": "#111",
      flex: "0 0 16px",
      display: "inline-block",
      "pointer-events": "auto"
    };
    for (const [key, value] of Object.entries(important)) box.style.setProperty(key, value, "important");
    return box;
  }
  function textOf(node) {
    if (!node) return "";
    return (
      node.getAttribute?.("aria-label") ||
      node.getAttribute?.("title") ||
      node.getAttribute?.("alt") ||
      node.getAttribute?.("data-email") ||
      node.innerText ||
      ""
    ).trim().replace(/\s+/g, " ").slice(0, 140);
  }
  function nearbyNames(node) {
    const found = [];
    const push = (raw, where) => {
      const text = String(raw || "").trim().replace(/\s+/g, " ").slice(0, 140);
      if (text.length < 2 || found.some((item) => item.text === text)) return;
      found.push({ text, where });
    };
    push(textOf(node), "on control");
    const parent = node.parentElement;
    if (parent) {
      push(textOf(parent), "parent");
      for (const sib of parent.children) {
        if (sib === node) continue;
        push(textOf(sib), "beside button");
      }
    }
    const next = node.nextElementSibling;
    push(textOf(next), "next to button");
    return found;
  }
  function probeCornerAccount() {
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const nodes = document.querySelectorAll("button, a, [role='button'], img, [aria-label]");
    const hits = [];
    const seen = new Set();
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (rect.width < 12 || rect.height < 12 || rect.width > 360 || rect.height > 160) continue;
      if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) continue;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      if (cx > vw * 0.42) continue;
      const bottomLeft = cy > vh * 0.5;
      const topLeft = cy < vh * 0.28;
      if (!bottomLeft && !topLeft) continue;
      const corner = bottomLeft ? "bottom-left" : "top-left";
      const dist = bottomLeft ? cx + (vh - cy) : cx + cy;
      const names = nearbyNames(node);
      if (!names.length) continue;
      for (const item of names) {
        const email = (item.text.match(EMAIL_RE) || [])[0] || "";
        const label = email || item.text;
        const key = `${label}@${item.where}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({
          label,
          detail: `${item.where}, ${corner} x=${Math.round(rect.left)} y=${Math.round(rect.top)}`,
          dist,
          bottomLeft,
          beside: item.where === "beside button" || item.where === "next to button"
        });
      }
    }
    hits.sort((a, b) => Number(b.beside) - Number(a.beside) || Number(b.bottomLeft) - Number(a.bottomLeft) || a.dist - b.dist);
    const best = hits[0];
    return {
      ok: Boolean(best),
      label: best ? best.label : "",
      detail: best ? best.detail : "no name beside a left-corner control",
      candidates: hits.slice(0, 10).map((hit) => ({ label: hit.label, detail: hit.detail }))
    };
  }
  function probeGeminiAccount() {
    const wiz = globalThis.WIZ_global_data || {};
    const email = findEmail(wiz);
    const name = findDisplayName(wiz);
    const chip = document.querySelector("[data-email], [aria-label*='@'], [data-og-email]");
    const chipText = chip ? (chip.getAttribute("data-email") || chip.getAttribute("aria-label") || chip.textContent || "") : "";
    const chipEmail = (chipText.match(EMAIL_RE) || [])[0] || "";
    const label = email || chipEmail || name || chipText.trim().slice(0, 80);
    const wizKeys = Object.keys(wiz).slice(0, 12).join(", ");
    return {
      ok: Boolean(label),
      label,
      detail: `WIZ keys: ${wizKeys || "(none)"}; chip: ${chipText ? "found" : "not found"}`
    };
  }
  async function probeGrokUser() {
    const paths = ["auth/user", "user", "app-chat/user", "app-chat/me", "me", "users/me", "app-chat/settings"];
    const notes = [];
    for (const path of paths) {
      try {
        const response = await fetch(`https://grok.com/rest/${path}`, {
          method: "GET",
          credentials: "include",
          headers: { accept: "application/json" }
        });
        if (!response.ok) {
          notes.push(`${path} ${response.status}`);
          continue;
        }
        const data = await response.json();
        const email = findEmail(data);
        const name = findDisplayName(data);
        const keys = data && typeof data === "object" ? Object.keys(data).slice(0, 8).join(", ") : typeof data;
        if (email || name) {
          return { ok: true, label: email || name, detail: `${path} keys: ${keys}; also tried: ${notes.join("; ") || "none"}` };
        }
        notes.push(`${path} 200 but no email/name (keys: ${keys})`);
      } catch (error) {
        notes.push(`${path} error`);
      }
    }
    return { ok: false, label: "", detail: notes.join("; ") || "no path tried" };
  }
  function probeLocalStorage() {
    const storage = globalThis.localStorage;
    if (!storage) return { ok: false, detail: "localStorage unavailable" };
    const notes = [];
    let label = "";
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || /token|secret|password|authorization/i.test(key)) {
        notes.push(`${key}: skipped (token-like key)`);
        continue;
      }
      let raw = "";
      try { raw = storage.getItem(key) || ""; } catch { continue; }
      if (raw.length > 20000) {
        notes.push(`${key}: skipped (too long)`);
        continue;
      }
      const direct = (raw.match(EMAIL_RE) || [])[0] || "";
      if (direct) {
        label = label || direct;
        notes.push(`${key}: email-shaped string`);
        continue;
      }
      try {
        const parsed = JSON.parse(raw);
        const email = findEmail(parsed);
        const name = findDisplayName(parsed);
        if (email || name) {
          label = label || email || name;
          notes.push(`${key}: ${email ? "email" : "name"} field`);
        } else {
          notes.push(`${key}: no email/name`);
        }
      } catch {
        notes.push(`${key}: not json`);
      }
    }
    return { ok: Boolean(label), label, detail: notes.slice(0, 12).join("; ") || "empty storage" };
  }
  const ACCOUNT_PROBES = [
    { id: "chatgpt-session", label: "ChatGPT session email (/api/auth/session)", run: probeChatGPTSession },
    { id: "gemini-chip", label: "Gemini WIZ / account chip", run: probeGeminiAccount },
    { id: "grok-user", label: "Grok /rest user guesses", run: probeGrokUser },
    { id: "local-storage", label: "localStorage email/name scan (skips token keys)", run: probeLocalStorage },
    { id: "corner-account", label: "Corner account button (bottom-left, then top-left)", run: probeCornerAccount }
  ];
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function throttled(fn, minMs) {
    let last = 0;
    return async (...args) => {
      const wait = last + minMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      return fn(...args);
    };
  }
  const DEFAULT_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;
  const EXTENSION_BY_MIME = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "application/pdf": "pdf",
    "application/zip": "zip",
    "text/plain": "txt",
    "text/markdown": "md",
    "text/csv": "csv"
  };
  async function readCapped(response, maxBytes) {
    var _a2, _b2;
    const declared = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > maxBytes) return null;
    const reader = (_b2 = (_a2 = response.body) == null ? void 0 : _a2.getReader) == null ? void 0 : _b2.call(_a2);
    if (!reader) {
      const bytes2 = new Uint8Array(await response.arrayBuffer());
      return bytes2.byteLength > maxBytes ? null : bytes2;
    }
    const chunks = [];
    let total = 0;
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }
  function attachmentFileName(attachment, mimeType, index, used) {
    const raw = (attachment.name || attachment.id || `attachment-${index}`).replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^.*[\\/]/, "");
    const dot = raw.lastIndexOf(".");
    const base = slugify(dot > 0 ? raw.slice(0, dot) : raw, `attachment-${index}`);
    const namedExt = dot > 0 ? raw.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
    const mime = (mimeType ?? attachment.mimeType ?? "").split(";")[0].trim();
    const ext = namedExt || EXTENSION_BY_MIME[mime] || "bin";
    let name = `${base}.${ext}`;
    for (let n = 2; used.has(name); n++) name = `${base}-${n}.${ext}`;
    used.add(name);
    return name;
  }
  async function downloadAttachments(conversation, adapter, options = {}) {
    var _a2;
    const maxBytes = options.maxBytes ?? DEFAULT_ATTACHMENT_MAX_BYTES;
    const throttleMs = options.throttleMs ?? 500;
    const fetchImpl = options.fetchImpl ?? ((_a2 = globalThis.fetch) == null ? void 0 : _a2.bind(globalThis));
    const files = [];
    const used = /* @__PURE__ */ new Set();
    const baseDir = `${conversation.platform}/attachments/${conversationBaseName(conversation)}`;
    let saved = 0;
    let skipped = 0;
    let first = true;
    for (const [index, attachment] of (conversation.attachments ?? []).entries()) {
      if (typeof attachment.sizeBytes === "number" && attachment.sizeBytes > maxBytes) {
        skipped++;
        continue;
      }
      if (!first) await sleep(throttleMs);
      first = false;
      let payload = null;
      try {
        if (adapter.fetchAttachment) {
          payload = await adapter.fetchAttachment(attachment, conversation);
        }
        if (!payload && attachment.url && fetchImpl) {
          const response = await fetchImpl(attachment.url);
          if (response.ok) {
            const bytes = await readCapped(response, maxBytes);
            if (bytes) {
              payload = { bytes };
              const mime = response.headers.get("content-type");
              if (mime) payload.mimeType = mime;
            }
          }
        }
      } catch {
        payload = null;
      }
      if (!payload || payload.bytes.byteLength > maxBytes) {
        skipped++;
        continue;
      }
      const mimeType = payload.mimeType ?? attachment.mimeType;
      const name = attachmentFileName(
        payload.name ? { ...attachment, name: payload.name } : attachment,
        mimeType,
        index,
        used
      );
      const path = `${baseDir}/${name}`;
      attachment.localPath = path;
      if (!attachment.mimeType && mimeType) attachment.mimeType = mimeType.split(";")[0].trim();
      if (attachment.sizeBytes === void 0) attachment.sizeBytes = payload.bytes.byteLength;
      files.push({ path, content: payload.bytes, mimeType: mimeType ?? "application/octet-stream" });
      saved++;
    }
    return { files, saved, skipped };
  }
  async function exportConversations(options) {
    var _a2;
    const {
      adapter,
      exporters,
      ids,
      range,
      throttleMs = 500,
      includeAttachments = false,
      attachmentMaxBytes,
      onFile,
      onProgress,
      onError
    } = options;
    const metas = [];
    const wanted = ids ? new Set(ids) : null;
    const from = Math.max(1, Math.floor((range == null ? void 0 : range.from) ?? 1));
    const to = Math.floor((range == null ? void 0 : range.to) ?? Infinity);
    let position = 0;
    onProgress == null ? void 0 : onProgress({ phase: "list", completed: 0, total: 0 });
    for await (const meta of adapter.listConversations()) {
      if (wanted && !wanted.has(meta.id)) continue;
      position += 1;
      if (position < from) continue;
      metas.push(meta);
      onProgress == null ? void 0 : onProgress({ phase: "list", completed: 0, total: metas.length });
      if (position >= to) break;
      if (wanted && metas.length >= wanted.size) break;
    }
    const fetchOne = throttled((id) => adapter.fetchConversation(id), throttleMs);
    const files = [];
    const conversations = [];
    const failed = [];
    let attachmentsSaved = 0;
    let attachmentsSkipped = 0;
    const emit = onFile ?? ((file) => files.push(file));
    for (const meta of metas) {
      onProgress == null ? void 0 : onProgress({ phase: "fetch", meta, completed: conversations.length, total: metas.length });
      try {
        const conversation = await fetchOne(meta.id);
        if (includeAttachments && ((_a2 = conversation.attachments) == null ? void 0 : _a2.length)) {
          onProgress == null ? void 0 : onProgress({ phase: "attachments", meta, completed: conversations.length, total: metas.length });
          const downloaded = await downloadAttachments(conversation, adapter, {
            maxBytes: attachmentMaxBytes,
            throttleMs
          });
          for (const file of downloaded.files) emit(file);
          attachmentsSaved += downloaded.saved;
          attachmentsSkipped += downloaded.skipped;
        }
        conversations.push(conversation);
        onProgress == null ? void 0 : onProgress({ phase: "export", meta, completed: conversations.length, total: metas.length });
        for (const exporter of exporters) {
          emit(exporter.export(conversation));
        }
      } catch (error) {
        failed.push(meta.id);
        onError == null ? void 0 : onError(meta.id, error);
      }
    }
    onProgress == null ? void 0 : onProgress({ phase: "done", completed: conversations.length, total: metas.length });
    return { files, conversations, failed, attachmentsSaved, attachmentsSkipped };
  }
  function jsonExporter() {
    return {
      id: "json",
      extension: "json",
      export(conversation) {
        return {
          path: `${conversation.platform}/json/${conversationBaseName(conversation)}.json`,
          content: JSON.stringify(conversation, null, 2) + "\n",
          mimeType: "application/json"
        };
      }
    };
  }
  const ROLE_HEADING = {
    user: "?? User",
    assistant: "?? Assistant",
    system: "?? System"
  };
  function localHref(attachment, platform) {
    const localPath = attachment == null ? void 0 : attachment.localPath;
    if (!localPath) return void 0;
    const prefix = `${platform}/`;
    return localPath.startsWith(prefix) ? `../${localPath.slice(prefix.length)}` : localPath;
  }
  function renderPart(part, context) {
    switch (part.type) {
      case "text":
        return part.text;
      case "code":
        return "```" + (part.language ?? "") + "\n" + part.code + "\n```";
      case "table": {
        const header = `| ${part.headers.join(" | ")} |`;
        const divider = `| ${part.headers.map(() => "---").join(" | ")} |`;
        const rows = part.rows.map((row) => `| ${row.join(" | ")} |`);
        return [header, divider, ...rows].join("\n");
      }
      case "image": {
        const attachment = part.attachmentId ? context.attachments.get(part.attachmentId) : void 0;
        const href = localHref(attachment, context.platform) ?? part.url ?? (attachment == null ? void 0 : attachment.url) ?? part.attachmentId ?? "";
        return `![${part.alt ?? ""}](${href})`;
      }
      case "file": {
        const attachment = context.attachments.get(part.attachmentId);
        const href = localHref(attachment, context.platform) ?? (attachment == null ? void 0 : attachment.url) ?? part.attachmentId;
        return `?? [${part.name ?? (attachment == null ? void 0 : attachment.name) ?? part.attachmentId}](${href})`;
      }
    }
  }
  function formatAt(iso, gtzHours) {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return null;
    const d = new Date(ms + gtzHours * 3600000);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }
  function atLine(message, gtzHours) {
    if (!message.timestamp) return null;
    const stamp = formatAt(message.timestamp, gtzHours);
    if (!stamp) return null;
    const label = message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : "System";
    return `${label} A.T.: ${stamp}`;
  }
  function renderMessage(message, context) {
    var _a2;
    const blocks = [];
    if (message.reasoning) {
      blocks.push(
        "<details><summary>?? Reasoning</summary>\n\n" + message.reasoning.content + "\n\n</details>"
      );
    }
    const body = message.content.map((part) => renderPart(part, context)).join("\n\n");
    if (body) blocks.push(body);
    if ((_a2 = message.citations) == null ? void 0 : _a2.length) {
      const items = message.citations.map((c, i) => {
        const label = c.title ?? c.url ?? `Source ${i + 1}`;
        return c.url ? `${i + 1}. [${label}](${c.url})` : `${i + 1}. ${label}`;
      });
      blocks.push("**Sources**\n\n" + items.join("\n"));
    }
    if (!blocks.length) return null;
    const heading = `## ${ROLE_HEADING[message.role]}`;
    const atStamp = atLine(message, Number.isFinite(context.gtzHours) ? context.gtzHours : 8);
    return atStamp ? [heading, atStamp, ...blocks].join("\n\n") : [heading, ...blocks].join("\n\n");
  }
  function renderMarkdown(conversation, gtzHours) {
    var _a2;
    const metaBits = [
      `Platform: ${conversation.platform}`,
      conversation.model ? `Model: ${conversation.model}` : null,
      conversation.updatedAt ? `Updated: ${conversation.updatedAt}` : null
    ].filter(Boolean);
    const parts = [`# ${conversation.title || conversation.id}`];
    if (metaBits.length) parts.push(`> ${metaBits.join(" · ")}`);
    const context = {
      platform: conversation.platform,
      attachments: new Map((conversation.attachments ?? []).map((a) => [a.id, a])),
      gtzHours: Number.isFinite(gtzHours) ? gtzHours : 8
    };
    for (const message of conversation.messages) {
      const rendered = renderMessage(message, context);
      if (rendered) parts.push(rendered);
    }
    if ((_a2 = conversation.attachments) == null ? void 0 : _a2.length) {
      const items = conversation.attachments.map((a) => {
        const label = a.name ?? a.id;
        const href = localHref(a, conversation.platform) ?? a.url;
        return href ? `- [${label}](${href})` : `- ${label}`;
      });
      parts.push("## Attachments\n\n" + items.join("\n"));
    }
    return parts.join("\n\n") + "\n";
  }
  function markdownExporter(gtzHours) {
    const offset = Number.isFinite(gtzHours) ? gtzHours : 8;
    return {
      id: "markdown",
      extension: "md",
      export(conversation) {
        return {
          path: `${conversation.platform}/markdown/${conversationBaseName(conversation)}.md`,
          content: renderMarkdown(conversation, offset),
          mimeType: "text/markdown"
        };
      }
    };
  }
  var u8 = Uint8Array, u16 = Uint16Array, i32 = Int32Array;
  var fleb = new u8([
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    1,
    1,
    1,
    2,
    2,
    2,
    2,
    3,
    3,
    3,
    3,
    4,
    4,
    4,
    4,
    5,
    5,
    5,
    5,
    0,
    /* unused */
    0,
    0,
    /* impossible */
    0
  ]);
  var fdeb = new u8([
    0,
    0,
    0,
    0,
    1,
    1,
    2,
    2,
    3,
    3,
    4,
    4,
    5,
    5,
    6,
    6,
    7,
    7,
    8,
    8,
    9,
    9,
    10,
    10,
    11,
    11,
    12,
    12,
    13,
    13,
    /* unused */
    0,
    0
  ]);
  var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
  var freb = function(eb, start) {
    var b = new u16(31);
    for (var i = 0; i < 31; ++i) {
      b[i] = start += 1 << eb[i - 1];
    }
    var r = new i32(b[30]);
    for (var i = 1; i < 30; ++i) {
      for (var j = b[i]; j < b[i + 1]; ++j) {
        r[j] = j - b[i] << 5 | i;
      }
    }
    return { b, r };
  };
  var _a = freb(fleb, 2), fl = _a.b, revfl = _a.r;
  fl[28] = 258, revfl[258] = 28;
  var _b = freb(fdeb, 0), revfd = _b.r;
  var rev = new u16(32768);
  for (var i = 0; i < 32768; ++i) {
    var x = (i & 43690) >> 1 | (i & 21845) << 1;
    x = (x & 52428) >> 2 | (x & 13107) << 2;
    x = (x & 61680) >> 4 | (x & 3855) << 4;
    rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
  }
  var hMap = function(cd, mb, r) {
    var s = cd.length;
    var i = 0;
    var l = new u16(mb);
    for (; i < s; ++i) {
      if (cd[i])
        ++l[cd[i] - 1];
    }
    var le = new u16(mb);
    for (i = 1; i < mb; ++i) {
      le[i] = le[i - 1] + l[i - 1] << 1;
    }
    var co;
    {
      co = new u16(s);
      for (i = 0; i < s; ++i) {
        if (cd[i]) {
          co[i] = rev[le[cd[i] - 1]++] >> 15 - cd[i];
        }
      }
    }
    return co;
  };
  var flt = new u8(288);
  for (var i = 0; i < 144; ++i)
    flt[i] = 8;
  for (var i = 144; i < 256; ++i)
    flt[i] = 9;
  for (var i = 256; i < 280; ++i)
    flt[i] = 7;
  for (var i = 280; i < 288; ++i)
    flt[i] = 8;
  var fdt = new u8(32);
  for (var i = 0; i < 32; ++i)
    fdt[i] = 5;
  var flm = /* @__PURE__ */ hMap(flt, 9);
  var fdm = /* @__PURE__ */ hMap(fdt, 5);
  var shft = function(p) {
    return (p + 7) / 8 | 0;
  };
  var slc = function(v, s, e) {
    if (e == null || e > v.length)
      e = v.length;
    return new u8(v.subarray(s, e));
  };
  var ec = [
    "unexpected EOF",
    "invalid block type",
    "invalid length/literal",
    "invalid distance",
    "stream finished",
    "no stream handler",
    ,
    // determined by compression function
    "no callback",
    "invalid UTF-8 data",
    "extra field too long",
    "date not in range 1980-2099",
    "filename too long",
    "stream finishing",
    "invalid zip data"
    // determined by unknown compression method
  ];
  var err = function(ind, msg, nt) {
    var e = new Error(msg || ec[ind]);
    e.code = ind;
    if (Error.captureStackTrace)
      Error.captureStackTrace(e, err);
    if (!nt)
      throw e;
    return e;
  };
  var wbits = function(d, p, v) {
    v <<= p & 7;
    var o = p / 8 | 0;
    d[o] |= v;
    d[o + 1] |= v >> 8;
  };
  var wbits16 = function(d, p, v) {
    v <<= p & 7;
    var o = p / 8 | 0;
    d[o] |= v;
    d[o + 1] |= v >> 8;
    d[o + 2] |= v >> 16;
  };
  var hTree = function(d, mb) {
    var t = [];
    for (var i = 0; i < d.length; ++i) {
      if (d[i])
        t.push({ s: i, f: d[i] });
    }
    var s = t.length;
    var t2 = t.slice();
    if (!s)
      return { t: et, l: 0 };
    if (s == 1) {
      var v = new u8(t[0].s + 1);
      v[t[0].s] = 1;
      return { t: v, l: 1 };
    }
    t.sort(function(a, b) {
      return a.f - b.f;
    });
    t.push({ s: -1, f: 25001 });
    var l = t[0], r = t[1], i0 = 0, i1 = 1, i2 = 2;
    t[0] = { s: -1, f: l.f + r.f, l, r };
    while (i1 != s - 1) {
      l = t[t[i0].f < t[i2].f ? i0++ : i2++];
      r = t[i0 != i1 && t[i0].f < t[i2].f ? i0++ : i2++];
      t[i1++] = { s: -1, f: l.f + r.f, l, r };
    }
    var maxSym = t2[0].s;
    for (var i = 1; i < s; ++i) {
      if (t2[i].s > maxSym)
        maxSym = t2[i].s;
    }
    var tr = new u16(maxSym + 1);
    var mbt = ln(t[i1 - 1], tr, 0);
    if (mbt > mb) {
      var i = 0, dt = 0;
      var lft = mbt - mb, cst = 1 << lft;
      t2.sort(function(a, b) {
        return tr[b.s] - tr[a.s] || a.f - b.f;
      });
      for (; i < s; ++i) {
        var i2_1 = t2[i].s;
        if (tr[i2_1] > mb) {
          dt += cst - (1 << mbt - tr[i2_1]);
          tr[i2_1] = mb;
        } else
          break;
      }
      dt >>= lft;
      while (dt > 0) {
        var i2_2 = t2[i].s;
        if (tr[i2_2] < mb)
          dt -= 1 << mb - tr[i2_2]++ - 1;
        else
          ++i;
      }
      for (; i >= 0 && dt; --i) {
        var i2_3 = t2[i].s;
        if (tr[i2_3] == mb) {
          --tr[i2_3];
          ++dt;
        }
      }
      mbt = mb;
    }
    return { t: new u8(tr), l: mbt };
  };
  var ln = function(n, l, d) {
    return n.s == -1 ? Math.max(ln(n.l, l, d + 1), ln(n.r, l, d + 1)) : l[n.s] = d;
  };
  var lc = function(c) {
    var s = c.length;
    while (s && !c[--s])
      ;
    var cl = new u16(++s);
    var cli = 0, cln = c[0], cls = 1;
    var w = function(v) {
      cl[cli++] = v;
    };
    for (var i = 1; i <= s; ++i) {
      if (c[i] == cln && i != s)
        ++cls;
      else {
        if (!cln && cls > 2) {
          for (; cls > 138; cls -= 138)
            w(32754);
          if (cls > 2) {
            w(cls > 10 ? cls - 11 << 5 | 28690 : cls - 3 << 5 | 12305);
            cls = 0;
          }
        } else if (cls > 3) {
          w(cln), --cls;
          for (; cls > 6; cls -= 6)
            w(8304);
          if (cls > 2)
            w(cls - 3 << 5 | 8208), cls = 0;
        }
        while (cls--)
          w(cln);
        cls = 1;
        cln = c[i];
      }
    }
    return { c: cl.subarray(0, cli), n: s };
  };
  var clen = function(cf, cl) {
    var l = 0;
    for (var i = 0; i < cl.length; ++i)
      l += cf[i] * cl[i];
    return l;
  };
  var wfblk = function(out, pos, dat) {
    var s = dat.length;
    var o = shft(pos + 2);
    out[o] = s & 255;
    out[o + 1] = s >> 8;
    out[o + 2] = out[o] ^ 255;
    out[o + 3] = out[o + 1] ^ 255;
    for (var i = 0; i < s; ++i)
      out[o + i + 4] = dat[i];
    return (o + 4 + s) * 8;
  };
  var wblk = function(dat, out, final, syms, lf, df, eb, li, bs, bl, p) {
    wbits(out, p++, final);
    ++lf[256];
    var _a2 = hTree(lf, 15), dlt = _a2.t, mlb = _a2.l;
    var _b2 = hTree(df, 15), ddt = _b2.t, mdb = _b2.l;
    var _c = lc(dlt), lclt = _c.c, nlc = _c.n;
    var _d = lc(ddt), lcdt = _d.c, ndc = _d.n;
    var lcfreq = new u16(19);
    for (var i = 0; i < lclt.length; ++i)
      ++lcfreq[lclt[i] & 31];
    for (var i = 0; i < lcdt.length; ++i)
      ++lcfreq[lcdt[i] & 31];
    var _e = hTree(lcfreq, 7), lct = _e.t, mlcb = _e.l;
    var nlcc = 19;
    for (; nlcc > 4 && !lct[clim[nlcc - 1]]; --nlcc)
      ;
    var flen = bl + 5 << 3;
    var ftlen = clen(lf, flt) + clen(df, fdt) + eb;
    var dtlen = clen(lf, dlt) + clen(df, ddt) + eb + 14 + 3 * nlcc + clen(lcfreq, lct) + 2 * lcfreq[16] + 3 * lcfreq[17] + 7 * lcfreq[18];
    if (bs >= 0 && flen <= ftlen && flen <= dtlen)
      return wfblk(out, p, dat.subarray(bs, bs + bl));
    var lm, ll, dm, dl;
    wbits(out, p, 1 + (dtlen < ftlen)), p += 2;
    if (dtlen < ftlen) {
      lm = hMap(dlt, mlb), ll = dlt, dm = hMap(ddt, mdb), dl = ddt;
      var llm = hMap(lct, mlcb);
      wbits(out, p, nlc - 257);
      wbits(out, p + 5, ndc - 1);
      wbits(out, p + 10, nlcc - 4);
      p += 14;
      for (var i = 0; i < nlcc; ++i)
        wbits(out, p + 3 * i, lct[clim[i]]);
      p += 3 * nlcc;
      var lcts = [lclt, lcdt];
      for (var it = 0; it < 2; ++it) {
        var clct = lcts[it];
        for (var i = 0; i < clct.length; ++i) {
          var len = clct[i] & 31;
          wbits(out, p, llm[len]), p += lct[len];
          if (len > 15)
            wbits(out, p, clct[i] >> 5 & 127), p += clct[i] >> 12;
        }
      }
    } else {
      lm = flm, ll = flt, dm = fdm, dl = fdt;
    }
    for (var i = 0; i < li; ++i) {
      var sym = syms[i];
      if (sym > 255) {
        var len = sym >> 18 & 31;
        wbits16(out, p, lm[len + 257]), p += ll[len + 257];
        if (len > 7)
          wbits(out, p, sym >> 23 & 31), p += fleb[len];
        var dst = sym & 31;
        wbits16(out, p, dm[dst]), p += dl[dst];
        if (dst > 3)
          wbits16(out, p, sym >> 5 & 8191), p += fdeb[dst];
      } else {
        wbits16(out, p, lm[sym]), p += ll[sym];
      }
    }
    wbits16(out, p, lm[256]);
    return p + ll[256];
  };
  var deo = /* @__PURE__ */ new i32([65540, 131080, 131088, 131104, 262176, 1048704, 1048832, 2114560, 2117632]);
  var et = /* @__PURE__ */ new u8(0);
  var dflt = function(dat, lvl, plvl, pre, post, st) {
    var s = st.z || dat.length;
    var o = new u8(pre + s + 5 * (1 + Math.ceil(s / 7e3)) + post);
    var w = o.subarray(pre, o.length - post);
    var lst = st.l;
    var pos = (st.r || 0) & 7;
    if (lvl) {
      if (pos)
        w[0] = st.r >> 3;
      var opt = deo[lvl - 1];
      var n = opt >> 13, c = opt & 8191;
      var msk_1 = (1 << plvl) - 1;
      var prev = st.p || new u16(32768), head = st.h || new u16(msk_1 + 1);
      var bs1_1 = Math.ceil(plvl / 3), bs2_1 = 2 * bs1_1;
      var hsh = function(i2) {
        return (dat[i2] ^ dat[i2 + 1] << bs1_1 ^ dat[i2 + 2] << bs2_1) & msk_1;
      };
      var syms = new i32(25e3);
      var lf = new u16(288), df = new u16(32);
      var lc_1 = 0, eb = 0, i = st.i || 0, li = 0, wi = st.w || 0, bs = 0;
      for (; i + 2 < s; ++i) {
        var hv = hsh(i);
        var imod = i & 32767, pimod = head[hv];
        prev[imod] = pimod;
        head[hv] = imod;
        if (wi <= i) {
          var rem = s - i;
          if ((lc_1 > 7e3 || li > 24576) && (rem > 423 || !lst)) {
            pos = wblk(dat, w, 0, syms, lf, df, eb, li, bs, i - bs, pos);
            li = lc_1 = eb = 0, bs = i;
            for (var j = 0; j < 286; ++j)
              lf[j] = 0;
            for (var j = 0; j < 30; ++j)
              df[j] = 0;
          }
          var l = 2, d = 0, ch_1 = c, dif = imod - pimod & 32767;
          if (rem > 2 && hv == hsh(i - dif)) {
            var maxn = Math.min(n, rem) - 1;
            var maxd = Math.min(32767, i);
            var ml = Math.min(258, rem);
            while (dif <= maxd && --ch_1 && imod != pimod) {
              if (dat[i + l] == dat[i + l - dif]) {
                var nl = 0;
                for (; nl < ml && dat[i + nl] == dat[i + nl - dif]; ++nl)
                  ;
                if (nl > l) {
                  l = nl, d = dif;
                  if (nl > maxn)
                    break;
                  var mmd = Math.min(dif, nl - 2);
                  var md = 0;
                  for (var j = 0; j < mmd; ++j) {
                    var ti = i - dif + j & 32767;
                    var pti = prev[ti];
                    var cd = ti - pti & 32767;
                    if (cd > md)
                      md = cd, pimod = ti;
                  }
                }
              }
              imod = pimod, pimod = prev[imod];
              dif += imod - pimod & 32767;
            }
          }
          if (d) {
            syms[li++] = 268435456 | revfl[l] << 18 | revfd[d];
            var lin = revfl[l] & 31, din = revfd[d] & 31;
            eb += fleb[lin] + fdeb[din];
            ++lf[257 + lin];
            ++df[din];
            wi = i + l;
            ++lc_1;
          } else {
            syms[li++] = dat[i];
            ++lf[dat[i]];
          }
        }
      }
      for (i = Math.max(i, wi); i < s; ++i) {
        syms[li++] = dat[i];
        ++lf[dat[i]];
      }
      pos = wblk(dat, w, lst, syms, lf, df, eb, li, bs, i - bs, pos);
      if (!lst) {
        st.r = pos & 7 | w[pos / 8 | 0] << 3;
        pos -= 7;
        st.h = head, st.p = prev, st.i = i, st.w = wi;
      }
    } else {
      for (var i = st.w || 0; i < s + lst; i += 65535) {
        var e = i + 65535;
        if (e >= s) {
          w[pos / 8 | 0] = lst;
          e = s;
        }
        pos = wfblk(w, pos + 1, dat.subarray(i, e));
      }
      st.i = s;
    }
    return slc(o, 0, pre + shft(pos) + post);
  };
  var crct = /* @__PURE__ */ function() {
    var t = new Int32Array(256);
    for (var i = 0; i < 256; ++i) {
      var c = i, k = 9;
      while (--k)
        c = (c & 1 && -306674912) ^ c >>> 1;
      t[i] = c;
    }
    return t;
  }();
  var crc = function() {
    var c = -1;
    return {
      p: function(d) {
        var cr = c;
        for (var i = 0; i < d.length; ++i)
          cr = crct[cr & 255 ^ d[i]] ^ cr >>> 8;
        c = cr;
      },
      d: function() {
        return ~c;
      }
    };
  };
  var dopt = function(dat, opt, pre, post, st) {
    if (!st) {
      st = { l: 1 };
      if (opt.dictionary) {
        var dict = opt.dictionary.subarray(-32768);
        var newDat = new u8(dict.length + dat.length);
        newDat.set(dict);
        newDat.set(dat, dict.length);
        dat = newDat;
        st.w = dict.length;
      }
    }
    return dflt(dat, opt.level == null ? 6 : opt.level, opt.mem == null ? st.l ? Math.ceil(Math.max(8, Math.min(13, Math.log(dat.length))) * 1.5) : 20 : 12 + opt.mem, pre, post, st);
  };
  var mrg = function(a, b) {
    var o = {};
    for (var k in a)
      o[k] = a[k];
    for (var k in b)
      o[k] = b[k];
    return o;
  };
  var wbytes = function(d, b, v) {
    for (; v; ++b)
      d[b] = v, v >>>= 8;
  };
  var Deflate = /* @__PURE__ */ function() {
    function Deflate2(opts, cb) {
      if (typeof opts == "function")
        cb = opts, opts = {};
      this.ondata = cb;
      this.o = opts || {};
      this.s = { l: 0, i: 32768, w: 32768, z: 32768 };
      this.b = new u8(98304);
      if (this.o.dictionary) {
        var dict = this.o.dictionary.subarray(-32768);
        this.b.set(dict, 32768 - dict.length);
        this.s.i = 32768 - dict.length;
      }
    }
    Deflate2.prototype.p = function(c, f) {
      this.ondata(dopt(c, this.o, 0, 0, this.s), f);
    };
    Deflate2.prototype.push = function(chunk, final) {
      if (!this.ondata)
        err(5);
      if (this.s.l)
        err(4);
      var endLen = chunk.length + this.s.z;
      if (endLen > this.b.length) {
        if (endLen > 2 * this.b.length - 32768) {
          var newBuf = new u8(endLen & -32768);
          newBuf.set(this.b.subarray(0, this.s.z));
          this.b = newBuf;
        }
        var split = this.b.length - this.s.z;
        this.b.set(chunk.subarray(0, split), this.s.z);
        this.s.z = this.b.length;
        this.p(this.b, false);
        this.b.set(this.b.subarray(-32768));
        this.b.set(chunk.subarray(split), 32768);
        this.s.z = chunk.length - split + 32768;
        this.s.i = 32766, this.s.w = 32768;
      } else {
        this.b.set(chunk, this.s.z);
        this.s.z += chunk.length;
      }
      this.s.l = final & 1;
      if (this.s.z > this.s.w + 8191 || final) {
        this.p(this.b, final || false);
        this.s.w = this.s.i, this.s.i -= 2;
      }
      if (final) {
        this.s = this.o = {};
        this.b = et;
      }
    };
    Deflate2.prototype.flush = function(sync) {
      if (!this.ondata)
        err(5);
      if (this.s.l)
        err(4);
      this.p(this.b, false);
      this.s.w = this.s.i, this.s.i -= 2;
      if (sync) {
        var c = new u8(6);
        c[0] = this.s.r >> 3;
        var ep = wfblk(c, this.s.r, et);
        this.s.r = 0;
        this.ondata(c.subarray(0, ep >> 3), false);
      }
    };
    return Deflate2;
  }();
  var te = typeof TextEncoder != "undefined" && /* @__PURE__ */ new TextEncoder();
  var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder();
  var tds = 0;
  try {
    td.decode(et, { stream: true });
    tds = 1;
  } catch (e) {
  }
  function strToU8(str, latin1) {
    var i;
    if (te)
      return te.encode(str);
    var l = str.length;
    var ar = new u8(str.length + (str.length >> 1));
    var ai = 0;
    var w = function(v) {
      ar[ai++] = v;
    };
    for (var i = 0; i < l; ++i) {
      if (ai + 5 > ar.length) {
        var n = new u8(ai + 8 + (l - i << 1));
        n.set(ar);
        ar = n;
      }
      var c = str.charCodeAt(i);
      if (c < 128 || latin1)
        w(c);
      else if (c < 2048)
        w(192 | c >> 6), w(128 | c & 63);
      else if (c > 55295 && c < 57344)
        c = 65536 + (c & 1023 << 10) | str.charCodeAt(++i) & 1023, w(240 | c >> 18), w(128 | c >> 12 & 63), w(128 | c >> 6 & 63), w(128 | c & 63);
      else
        w(224 | c >> 12), w(128 | c >> 6 & 63), w(128 | c & 63);
    }
    return slc(ar, 0, ai);
  }
  var dbf = function(l) {
    return l == 1 ? 3 : l < 6 ? 2 : l == 9 ? 1 : 0;
  };
  var exfl = function(ex) {
    var le = 0;
    if (ex) {
      for (var k in ex) {
        var l = ex[k].length;
        if (l > 65535)
          err(9);
        le += l + 4;
      }
    }
    return le;
  };
  var wzh = function(d, b, f, fn, u, c, ce, co) {
    var fl2 = fn.length, ex = f.extra, col = co && co.length;
    var exl = exfl(ex);
    wbytes(d, b, ce != null ? 33639248 : 67324752), b += 4;
    if (ce != null)
      d[b++] = 20, d[b++] = f.os;
    d[b] = 20, b += 2;
    d[b++] = f.flag << 1 | (c < 0 && 8), d[b++] = u && 8;
    d[b++] = f.compression & 255, d[b++] = f.compression >> 8;
    var dt = new Date(f.mtime == null ? Date.now() : f.mtime), y = dt.getFullYear() - 1980;
    if (y < 0 || y > 119)
      err(10);
    wbytes(d, b, y << 25 | dt.getMonth() + 1 << 21 | dt.getDate() << 16 | dt.getHours() << 11 | dt.getMinutes() << 5 | dt.getSeconds() >> 1), b += 4;
    if (c != -1) {
      wbytes(d, b, f.crc);
      wbytes(d, b + 4, c < 0 ? -c - 2 : c);
      wbytes(d, b + 8, f.size);
    }
    wbytes(d, b + 12, fl2);
    wbytes(d, b + 14, exl), b += 16;
    if (ce != null) {
      wbytes(d, b, col);
      wbytes(d, b + 6, f.attrs);
      wbytes(d, b + 10, ce), b += 14;
    }
    d.set(fn, b);
    b += fl2;
    if (exl) {
      for (var k in ex) {
        var exf = ex[k], l = exf.length;
        wbytes(d, b, +k);
        wbytes(d, b + 2, l);
        d.set(exf, b + 4), b += 4 + l;
      }
    }
    if (col)
      d.set(co, b), b += col;
    return b;
  };
  var wzf = function(o, b, c, d, e) {
    wbytes(o, b, 101010256);
    wbytes(o, b + 8, c);
    wbytes(o, b + 10, c);
    wbytes(o, b + 12, d);
    wbytes(o, b + 16, e);
  };
  var ZipPassThrough = /* @__PURE__ */ function() {
    function ZipPassThrough2(filename) {
      this.filename = filename;
      this.c = crc();
      this.size = 0;
      this.compression = 0;
    }
    ZipPassThrough2.prototype.process = function(chunk, final) {
      this.ondata(null, chunk, final);
    };
    ZipPassThrough2.prototype.push = function(chunk, final) {
      if (!this.ondata)
        err(5);
      this.c.p(chunk);
      this.size += chunk.length;
      if (final)
        this.crc = this.c.d();
      this.process(chunk, final || false);
    };
    return ZipPassThrough2;
  }();
  var ZipDeflate = /* @__PURE__ */ function() {
    function ZipDeflate2(filename, opts) {
      var _this = this;
      if (!opts)
        opts = {};
      ZipPassThrough.call(this, filename);
      this.d = new Deflate(opts, function(dat, final) {
        _this.ondata(null, dat, final);
      });
      this.compression = 8;
      this.flag = dbf(opts.level);
    }
    ZipDeflate2.prototype.process = function(chunk, final) {
      try {
        this.d.push(chunk, final);
      } catch (e) {
        this.ondata(e, null, final);
      }
    };
    ZipDeflate2.prototype.push = function(chunk, final) {
      ZipPassThrough.prototype.push.call(this, chunk, final);
    };
    return ZipDeflate2;
  }();
  var Zip = /* @__PURE__ */ function() {
    function Zip2(cb) {
      this.ondata = cb;
      this.u = [];
      this.d = 1;
    }
    Zip2.prototype.add = function(file) {
      var _this = this;
      if (!this.ondata)
        err(5);
      if (this.d & 2)
        this.ondata(err(4 + (this.d & 1) * 8, 0, 1), null, false);
      else {
        var f = strToU8(file.filename), fl_1 = f.length;
        var com = file.comment, o = com && strToU8(com);
        var u = fl_1 != file.filename.length || o && com.length != o.length;
        var hl_1 = fl_1 + exfl(file.extra) + 30;
        if (fl_1 > 65535)
          this.ondata(err(11, 0, 1), null, false);
        var header = new u8(hl_1);
        wzh(header, 0, file, f, u, -1);
        var chks_1 = [header];
        var pAll_1 = function() {
          for (var _i = 0, chks_2 = chks_1; _i < chks_2.length; _i++) {
            var chk = chks_2[_i];
            _this.ondata(null, chk, false);
          }
          chks_1 = [];
        };
        var tr_1 = this.d;
        this.d = 0;
        var ind_1 = this.u.length;
        var uf_1 = mrg(file, {
          f,
          u,
          o,
          t: function() {
            if (file.terminate)
              file.terminate();
          },
          r: function() {
            pAll_1();
            if (tr_1) {
              var nxt = _this.u[ind_1 + 1];
              if (nxt)
                nxt.r();
              else
                _this.d = 1;
            }
            tr_1 = 1;
          }
        });
        var cl_1 = 0;
        file.ondata = function(err2, dat, final) {
          if (err2) {
            _this.ondata(err2, dat, final);
            _this.terminate();
          } else {
            cl_1 += dat.length;
            chks_1.push(dat);
            if (final) {
              var dd = new u8(16);
              wbytes(dd, 0, 134695760);
              wbytes(dd, 4, file.crc);
              wbytes(dd, 8, cl_1);
              wbytes(dd, 12, file.size);
              chks_1.push(dd);
              uf_1.c = cl_1, uf_1.b = hl_1 + cl_1 + 16, uf_1.crc = file.crc, uf_1.size = file.size;
              if (tr_1)
                uf_1.r();
              tr_1 = 1;
            } else if (tr_1)
              pAll_1();
          }
        };
        this.u.push(uf_1);
      }
    };
    Zip2.prototype.end = function() {
      var _this = this;
      if (this.d & 2) {
        this.ondata(err(4 + (this.d & 1) * 8, 0, 1), null, true);
        return;
      }
      if (this.d)
        this.e();
      else
        this.u.push({
          r: function() {
            if (!(_this.d & 1))
              return;
            _this.u.splice(-1, 1);
            _this.e();
          },
          t: function() {
          }
        });
      this.d = 3;
    };
    Zip2.prototype.e = function() {
      var bt = 0, l = 0, tl = 0;
      for (var _i = 0, _a2 = this.u; _i < _a2.length; _i++) {
        var f = _a2[_i];
        tl += 46 + f.f.length + exfl(f.extra) + (f.o ? f.o.length : 0);
      }
      var out = new u8(tl + 22);
      for (var _b2 = 0, _c = this.u; _b2 < _c.length; _b2++) {
        var f = _c[_b2];
        wzh(out, bt, f, f.f, f.u, -f.c - 2, l, f.o);
        bt += 46 + f.f.length + exfl(f.extra) + (f.o ? f.o.length : 0), l += f.b;
      }
      wzf(out, bt, this.u.length, tl, l);
      this.ondata(null, out, true);
      this.d = 2;
    };
    Zip2.prototype.terminate = function() {
      for (var _i = 0, _a2 = this.u; _i < _a2.length; _i++) {
        var f = _a2[_i];
        f.t();
      }
      this.d = 2;
    };
    return Zip2;
  }();
  const STORED_MIME = /^(?:image|video|audio)\/|\/(?:zip|gzip|x-7z-compressed)$/;
  const DEFAULT_SPILL_BYTES = 32 * 1024 * 1024;
  class ZipSink {
    constructor(options = {}) {
      __publicField(this, "zip");
      __publicField(this, "spillBytes");
      __publicField(this, "parts", []);
      __publicField(this, "chunks", []);
      __publicField(this, "chunkBytes", 0);
      __publicField(this, "error", null);
      __publicField(this, "finished");
      __publicField(this, "resolveFinished");
      this.spillBytes = options.spillBytes ?? DEFAULT_SPILL_BYTES;
      this.finished = new Promise((resolve) => {
        this.resolveFinished = resolve;
      });
      this.zip = new Zip((err2, data, final) => {
        if (err2) {
          this.error = err2;
          this.resolveFinished();
          return;
        }
        if (data.length) {
          this.chunks.push(data);
          this.chunkBytes += data.length;
          if (this.chunkBytes >= this.spillBytes) this.spill();
        }
        if (final) this.resolveFinished();
      });
    }
    spill() {
      if (!this.chunkBytes) return;
      this.parts.push(new Blob(this.chunks));
      this.chunks = [];
      this.chunkBytes = 0;
    }
    /** Adds one file; its bytes are compressed (or stored) immediately. */
    add(file) {
      if (this.error) throw this.error;
      const bytes = typeof file.content === "string" ? strToU8(file.content) : file.content;
      const entry = STORED_MIME.test(file.mimeType) ? new ZipPassThrough(file.path) : new ZipDeflate(file.path, { level: 6 });
      this.zip.add(entry);
      entry.push(bytes, true);
    }
    /** Finalizes the archive and returns it as a single Blob. */
    async finish() {
      this.zip.end();
      await this.finished;
      if (this.error) throw this.error;
      this.spill();
      return new Blob(this.parts, { type: "application/zip" });
    }
  }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  }
  function describeProgress(p) {
    var _a2;
    switch (p.phase) {
      case "list":
        return `Listing conversations… (${p.total})`;
      case "fetch":
        return `Fetching ${p.completed + 1}/${p.total}: ${((_a2 = p.meta) == null ? void 0 : _a2.title) ?? ""}`;
      case "attachments":
        return `Downloading files ${p.completed + 1}/${p.total}…`;
      case "export":
        return `Exporting ${p.completed}/${p.total}…`;
      case "done":
        return `Done — ${p.completed} conversations.`;
    }
  }

  const PLATFORM_NB = "notebook";
  const NOTEBOOK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const RPC_NB_LIST = "wXbhsf";
  const RPC_NB_GET = "rLM1Ne";
  const RPC_NB_LAST = "hPTbtc";
  const RPC_NB_TURNS = "khqZz";
  const NB_TURN_LIMIT = 200;
  function notebookHost() {
    if (typeof location === "undefined") return "";
    return /(^|\.)notebook\.google\.com$/.test(location.hostname) || /(^|\.)notebooklm\.google\.com$/.test(location.hostname);
  }
  function pageNotebookId() {
    if (typeof location === "undefined") return "";
    const match = location.pathname.match(/\/notebook\/([0-9a-f-]{36})/i);
    return match ? match[1] : "";
  }
  function collectNotebookRows(payload) {
    const rows = [];
    const seen = new Set();
    const visit = (node, depth) => {
      if (!Array.isArray(node) || depth > 5) return;
      const id = asString(at(node, 2));
      const title = asString(at(node, 0));
      if (id && NOTEBOOK_ID_RE.test(id) && title && !NOTEBOOK_ID_RE.test(title)) {
        if (!seen.has(id)) {
          seen.add(id);
          rows.push({ id, title: title.replace(/^thought\n/, "").trim() });
        }
        return;
      }
      for (const child of node) visit(child, depth + 1);
    };
    visit(payload, 0);
    return rows;
  }
  function firstUuid(payload, skip) {
    let found = "";
    const visit = (node, depth) => {
      if (found || depth > 6) return;
      if (typeof node === "string" && NOTEBOOK_ID_RE.test(node) && node !== skip) {
        found = node;
        return;
      }
      if (!Array.isArray(node)) return;
      for (const child of node) visit(child, depth + 1);
    };
    visit(payload, 0);
    return found;
  }
  function collectTurns(payload) {
    const turns = [];
    const visit = (node, depth) => {
      if (!Array.isArray(node) || depth > 6) return;
      const role = at(node, 2);
      const question = at(node, 3);
      const answer = at(node, 4);
      if ((role === 1 && typeof question === "string") || (role === 2 && Array.isArray(answer))) {
        turns.push(node);
        return;
      }
      for (const child of node) if (Array.isArray(child)) visit(child, depth + 1);
    };
    visit(payload, 0);
    return turns;
  }
  function answerText(block) {
    const direct = asString(at(at(block, 0), 0));
    if (direct) return direct;
    let found = "";
    const visit = (node, depth) => {
      if (found || depth > 5) return;
      if (typeof node === "string" && node.trim().length > 1 && !NOTEBOOK_ID_RE.test(node)) {
        found = node;
        return;
      }
      if (!Array.isArray(node)) return;
      for (const child of node) visit(child, depth + 1);
    };
    visit(block, 0);
    return found;
  }
  class NotebookClient {
    constructor(options = {}) {
      __publicField(this, "fetchImpl");
      __publicField(this, "explicitAt");
      __publicField(this, "explicitBl");
      __publicField(this, "explicitSid");
      __publicField(this, "reqId");
      this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
      this.explicitAt = options.atToken;
      this.explicitBl = options.blVersion;
      this.explicitSid = options.fSid;
      this.reqId = Math.floor(Math.random() * 9e4) + 1e4;
    }
    get wiz() {
      return globalThis.WIZ_global_data ?? {};
    }
    resolveAt() {
      const token = this.explicitAt ?? this.wiz.SNlM0e;
      if (!token) {
        throw new Error("Notebook `at` token not found. Open a logged-in notebook.google.com page.");
      }
      return token;
    }
    async call(rpcid, innerPayload, sourcePath) {
      const origin = typeof location !== "undefined" ? location.origin : "https://notebook.google.com";
      const url = new URL(`${origin}/_/LabsTailwindUi/data/batchexecute`);
      url.searchParams.set("rpcids", rpcid);
      url.searchParams.set("source-path", sourcePath || "/");
      const bl = this.explicitBl ?? this.wiz.cfb2h;
      const sid = this.explicitSid ?? this.wiz.FdrFJe;
      if (bl) url.searchParams.set("bl", bl);
      if (sid) url.searchParams.set("f.sid", sid);
      url.searchParams.set("hl", "en");
      url.searchParams.set("_reqid", String(this.reqId += 1e5));
      url.searchParams.set("rt", "c");
      if (typeof location !== "undefined") {
        const authuser = new URLSearchParams(location.search).get("authuser");
        if (authuser) url.searchParams.set("authuser", authuser);
      }
      const envelope = [[[rpcid, JSON.stringify(innerPayload), null, "generic"]]];
      const body = `f.req=${encodeURIComponent(JSON.stringify(envelope))}&at=${encodeURIComponent(this.resolveAt())}&`;
      const response = await this.fetchImpl(url.toString(), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body
      });
      if (!response.ok) {
        throw new Error(`Notebook ${rpcid} failed: ${response.status} ${response.statusText}`);
      }
      return extractRpcPayload(await response.text(), rpcid);
    }
    listNotebooks() {
      return this.call(RPC_NB_LIST, [null, 1, null, [2]], "/");
    }
    getNotebook(id) {
      return this.call(RPC_NB_GET, [id, null, [2], null, 0], `/notebook/${id}`);
    }
    lastConversation(id) {
      return this.call(RPC_NB_LAST, [[], null, id, 1], `/notebook/${id}`);
    }
    conversationTurns(notebookId, conversationId) {
      return this.call(RPC_NB_TURNS, [[], null, null, conversationId, NB_TURN_LIMIT], `/notebook/${notebookId}`);
    }
  }
  class NotebookAdapter {
    constructor(options = {}) {
      __publicField(this, "platform", PLATFORM_NB);
      __publicField(this, "client");
      __publicField(this, "titles", new Map());
      this.client = new NotebookClient(options);
    }
    detect() {
      return notebookHost();
    }
    async *listConversations() {
      const seen = new Set();
      const current = pageNotebookId();
      if (current) {
        let title = current;
        try {
          const detail = await this.client.getNotebook(current);
          const row = collectNotebookRows(detail)[0];
          if (row && row.title) title = row.title;
        } catch (error) {
          console.warn("[ai-chat-exporter] notebook title lookup failed", error);
        }
        this.titles.set(current, title);
        seen.add(current);
        yield { id: current, platform: PLATFORM_NB, title };
      }
      try {
        const payload = await this.client.listNotebooks();
        for (const row of collectNotebookRows(payload)) {
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          this.titles.set(row.id, row.title);
          yield { id: row.id, platform: PLATFORM_NB, title: row.title };
        }
      } catch (error) {
        if (!seen.size) throw error;
        console.warn("[ai-chat-exporter] notebook list failed; exporting the open notebook only", error);
      }
    }
    async fetchConversation(id) {
      const title = this.titles.get(id) || id;
      let conversationId = "";
      try {
        conversationId = firstUuid(await this.client.lastConversation(id), id);
      } catch (error) {
        console.warn("[ai-chat-exporter] notebook conversation id failed", error);
      }
      const messages = [];
      if (conversationId) {
        const turns = collectTurns(await this.client.conversationTurns(id, conversationId)).reverse();
        let n = 0;
        for (const turn of turns) {
          const role = at(turn, 2);
          const text = role === 1 ? asString(at(turn, 3)) || "" : answerText(at(turn, 4));
          if (!text) continue;
          n += 1;
          messages.push({
            id: `${conversationId}-${n}`,
            role: role === 1 ? "user" : "assistant",
            content: [{ type: "text", text }]
          });
        }
      }
      if (!messages.length) {
        messages.push({
          id: `${id}-empty`,
          role: "system",
          content: [{ type: "text", text: "No notebook chat turns were returned. Sources and Studio artifacts are not included in this export." }]
        });
      }
      return {
        schemaVersion: "1",
        id,
        platform: PLATFORM_NB,
        title,
        messages,
        sourceUrl: `https://notebook.google.com/notebook/${id}`
      };
    }
  }

  function resolveAdapter() {
    const adapters = [
      new NotebookAdapter(),
      new KimiAdapter(),
      new GeminiAdapter(),
      new GrokAdapter(),
      new DeepSeekAdapter(),
      new ChatGPTAdapter()
    ];
    return adapters.find((adapter) => adapter.detect()) ?? null;
  }
  async function runExport(adapter, setStatus, choices, hooks) {
    filenameAccountPrefix = slugifyAccount(choices.accountLabel || "");
    const sink = new ZipSink();
    const { conversations, failed, attachmentsSaved, attachmentsSkipped } = await exportConversations({
      adapter,
      exporters: [markdownExporter(Number(choices.gtz)), jsonExporter()],
      range: choices.range,
      ids: choices.ids,
      includeAttachments: choices.includeAttachments,
      throttleMs: 500,
      onFile: (file) => sink.add(file),
      onProgress: (p) => {
        var _a2;
        setStatus(describeProgress(p));
        (_a2 = hooks == null ? void 0 : hooks.onProgress) == null ? void 0 : _a2.call(hooks, p);
      },
      onError: (id, error) => {
        var _a2;
        console.error("[ai-chat-exporter] failed", id, error);
        (_a2 = hooks == null ? void 0 : hooks.onError) == null ? void 0 : _a2.call(hooks, id, error);
      }
    });
    if (!conversations.length) {
      setStatus("No conversations exported.");
      return;
    }
    const zip = await sink.finish();
    const who = filenameAccountPrefix ? `${filenameAccountPrefix}-` : "";
      //const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");  --- this is the UTC time
const firstTitle = slugify(
  (conversations[0] && conversations[0].title) || conversations[0].id || "untitled",
  "untitled"
).slice(0, 90);

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
download(
  zip,
  `${who}${adapter.platform}-export-${stamp}-${firstTitle}--etc.zip`
);
    //download(zip, `${who}${adapter.platform}-export-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.zip`);
    const bits = [`Saved ${conversations.length} conversations`];
    if (attachmentsSaved) bits.push(`+${attachmentsSaved} files`);
    if (attachmentsSkipped) bits.push(`${attachmentsSkipped} files skipped`);
    if (failed.length) bits.push(`${failed.length} failed`);
    setStatus(`${bits[0]}${bits.length > 1 ? ` (${bits.slice(1).join(", ")})` : ""}.`);
  }
  const countCache = /* @__PURE__ */ new Map();
  async function countConversations(adapter, onTick) {
    const cached = countCache.get(adapter.platform);
    if (cached !== void 0) {
      onTick(cached);
      return cached;
    }
    let n = 0;
    for await (const _meta of adapter.listConversations()) {
      n += 1;
      onTick(n);
    }
    countCache.set(adapter.platform, n);
    return n;
  }
  async function listRange(adapter, range, onTick) {
    const from = Math.max(1, Math.floor(range.from ?? 1));
    const to = Math.floor(range.to ?? Infinity);
    const metas = [];
    let position = 0;
    for await (const meta of adapter.listConversations()) {
      position += 1;
      if (position < from) continue;
      metas.push(meta);
      onTick == null ? void 0 : onTick(metas.length);
      if (position >= to) break;
    }
    return metas;
  }
  const dialogPanelStyle = {
    background: "#fff",
    color: "#111",
    // Host pages (e.g. Gemini dark mode) set `color-scheme: dark`, which
    // flips UA defaults for form controls — buttons/inputs without explicit
    // colors would render white-on-white. Pin the dialog to light.
    colorScheme: "light",
    borderRadius: "12px",
    padding: "20px",
    fontSize: "13px",
    fontFamily: "system-ui, sans-serif",
    boxShadow: "0 8px 30px rgba(0,0,0,.35)"
  };
  function styleOverlay(overlay) {
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483646",
      background: "rgba(0,0,0,.4)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    });
  }
  function el(tag, styles, attrs) {
    const node = document.createElement(tag);
    if (styles) Object.assign(node.style, styles);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (key === "text") node.textContent = value;
        else node.setAttribute(key, value);
      }
    }
    return node;
  }
  function ghostBtn(label) {
    const b = el("button", {
      padding: "7px 14px",
      borderRadius: "8px",
      border: "1px solid #ccc",
      background: "#fff",
      color: "#111",
      cursor: "pointer"
    });
    b.type = "button";
    b.textContent = label;
    return b;
  }
  function primaryBtn(label) {
    const b = el("button", {
      padding: "7px 14px",
      borderRadius: "8px",
      border: "none",
      background: "#111",
      color: "#fff",
      cursor: "pointer"
    });
    b.type = "button";
    b.textContent = label;
    return b;
  }
  function fieldInput(role, extra = {}) {
    const input = el("input", {
      width: "0",
      flex: "1",
      padding: "6px 8px",
      border: "1px solid #ccc",
      borderRadius: "6px",
      background: "#fff",
      color: "#111"
    }, { "data-role": role, ...extra });
    return input;
  }
  function openAccountFinder() {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      styleOverlay(overlay);
      const panel = document.createElement("div");
      Object.assign(panel.style, { ...dialogPanelStyle, width: "min(920px, calc(100vw - 24px))", maxHeight: "min(88vh, 820px)", overflow: "auto" });
      panel.append(el("div", { fontSize: "15px", fontWeight: "600", marginBottom: "4px" }, { text: "Find account" }));
      panel.append(el("div", { color: "#666", marginBottom: "10px" }, { text: "Test only. A click copies that label back to the export prefix. It does not export." }));
      const split = el("div", { display: "flex", gap: "12px", alignItems: "stretch" });
      const left = el("div", { flex: "1", minWidth: "240px" });
      const right = el("div", { flex: "1.2", minWidth: "280px", background: "#f6f6f6", borderRadius: "8px", padding: "8px", maxHeight: "320px", overflow: "auto" });
      right.append(el("div", { color: "#666", fontSize: "12px" }, { text: "Results show here." }));
      const checks = new Map();
      for (const probe of ACCOUNT_PROBES) {
        const label = el("label", { display: "flex", gap: "8px", alignItems: "flex-start", marginBottom: "6px", cursor: "pointer", color: "#111" });
        const box = visibleCheckbox(probe.id === "corner-account");
        label.append(box, el("span", void 0, { text: probe.label }));
        left.append(label);
        checks.set(probe.id, box);
      }
      const tryBtn = ghostBtn("Try checked");
      tryBtn.style.padding = "4px 10px";
      tryBtn.style.fontSize = "12px";
      left.append(tryBtn);
      split.append(left, right);
      panel.append(split);
      const picked = el("div", { marginTop: "10px", color: "#111" }, { text: "Picked: (none)" });
      panel.append(picked);
      const actions = el("div", { display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "12px" });
      const closeBtn = ghostBtn("Close");
      const useBtn = primaryBtn("Use picked");
      useBtn.disabled = true;
      actions.append(closeBtn, useBtn);
      panel.append(actions);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
      let chosen = "";
      const close = (value) => {
        overlay.remove();
        resolve(value);
      };
      closeBtn.addEventListener("click", () => close(null));
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) close(null);
      });
      useBtn.addEventListener("click", () => close(chosen));
      const resultBoxes = [];
      const fillFrom = (raw, sourceBox) => {
        chosen = raw || "";
        picked.textContent = chosen ? `Picked: ${chosen}` : "Picked: (none)";
        useBtn.disabled = !chosen;
        for (const box of resultBoxes) box.checked = box === sourceBox;
      };
      tryBtn.addEventListener("click", async () => {
        const selected = ACCOUNT_PROBES.filter((probe) => checks.get(probe.id).checked);
        right.replaceChildren();
        resultBoxes.length = 0;
        if (!selected.length) {
          right.append(el("div", { color: "#c00", fontSize: "12px" }, { text: "Check at least one method." }));
          return;
        }
        tryBtn.disabled = true;
        for (const probe of selected) {
          right.append(el("div", { fontSize: "12px", fontWeight: "600", margin: "6px 0 4px" }, { text: probe.label }));
          try {
            const result = await probe.run();
            const candidates = (result.candidates && result.candidates.length) ? result.candidates : (result.label ? [{ label: result.label, detail: result.detail || "" }] : []);
            if (!candidates.length) {
              right.append(el("div", { color: "#888", fontSize: "12px", marginBottom: "6px" }, { text: result.detail || "no label" }));
              continue;
            }
            for (const candidate of candidates) {
              const row = el("label", { display: "flex", gap: "8px", alignItems: "flex-start", padding: "4px", borderRadius: "6px", cursor: "pointer", background: "#fff", marginBottom: "4px" });
              const box = visibleCheckbox(false);
              resultBoxes.push(box);
              const text = el("span", { fontSize: "12px", wordBreak: "break-word" });
              text.append(document.createTextNode(candidate.label));
              if (candidate.detail) text.append(el("div", { color: "#777" }, { text: candidate.detail }));
              row.append(box, text);
              const choose = () => fillFrom(candidate.label, box);
              box.addEventListener("change", choose);
              row.addEventListener("click", (event) => {
                if (event.target === box) return;
                box.checked = true;
                choose();
              });
              right.append(row);
            }
          } catch (error) {
            right.append(el("div", { color: "#c00", fontSize: "12px" }, { text: error && error.message ? error.message : String(error) }));
          }
        }
        tryBtn.disabled = false;
      });
    });
  }
  function askChoices(adapter) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      styleOverlay(overlay);
      const panel = document.createElement("div");
      Object.assign(panel.style, { ...dialogPanelStyle, width: "min(920px, calc(100vw - 24px))", maxHeight: "min(88vh, 820px)", overflow: "auto" });
      const title = el("div", { fontSize: "15px", fontWeight: "600", marginBottom: "8px" }, { text: "Export conversations" });
      const hint = el("div", { color: "#666", marginBottom: "12px" }, {
        text: "Range is 1-based and inclusive. Leave “to” empty to export to the end."
      });
      const rangeRow = el("div", { display: "flex", gap: "8px", alignItems: "center", marginBottom: "16px" });
      const fromInput = fieldInput("from", { type: "number", min: "1", step: "1", value: "1" });
      const toInput = fieldInput("to", { type: "number", min: "1", step: "1", placeholder: "end" });
      rangeRow.append(fromInput, el("span", void 0, { text: "–" }), toInput);
      const errorBox = el("div", { color: "#c00", marginBottom: "8px", display: "none" });
      const attachLabel = el("label", { display: "flex", gap: "8px", alignItems: "center", marginBottom: "12px", cursor: "pointer" });
      const attachmentsInput = el("input", { margin: "0" }, { type: "checkbox" });
      attachLabel.append(attachmentsInput, el("span", void 0, { text: "Include attachments (images & files)" }));
      const countRow = el("div", { display: "flex", gap: "8px", alignItems: "center", marginBottom: "16px" });
      const totalLabel = el("span", { color: "#666" }, { text: "Total: unknown" });
      const countButton = el("button", {
        padding: "3px 10px",
        borderRadius: "6px",
        border: "1px solid #ccc",
        background: "#fff",
        color: "#333",
        cursor: "pointer",
        fontSize: "12px"
      });
      countButton.type = "button";
      countButton.textContent = "Load count";
      countRow.append(totalLabel, countButton);
      const NAMES_KEY = "ai-chat-exporter-known-names";
      const namesBox = el("div", { marginBottom: "10px" });
      namesBox.append(el("div", { fontWeight: "600", marginBottom: "4px" }, { text: "Known names" }));
      namesBox.append(el("div", { color: "#666", marginBottom: "6px" }, { text: "One rule per line, saved in this browser. Use Name : prefix. If the page contains the name, the prefix is copied below. A line with no colon uses the whole line." }));
      const namesInput = document.createElement("textarea");
      Object.assign(namesInput.style, {
        width: "100%",
        minHeight: "88px",
        boxSizing: "border-box",
        padding: "6px 8px",
        border: "1px solid #ccc",
        borderRadius: "6px",
        background: "#fff",
        color: "#111",
        font: "13px system-ui, sans-serif",
        resize: "vertical"
      });
      try { namesInput.value = localStorage.getItem(NAMES_KEY) || ""; } catch { namesInput.value = ""; }
      namesBox.append(namesInput);
      const detectLabel = el("div", { color: "#666", marginTop: "4px" }, { text: "Page match: not checked" });
      namesBox.append(detectLabel);
      const prefixRow = el("div", { display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" });
      const prefixInput = fieldInput("account", { type: "text", placeholder: "gmail or account name" });
      const findBtn = ghostBtn("Find account");
      findBtn.style.padding = "4px 10px";
      prefixRow.append(prefixInput, findBtn);
      const prefixLabel = el("div", { color: "#111", marginBottom: "12px" }, { text: "Filename prefix: (none)" });
      const gtzRow = el("div", { display: "flex", gap: "8px", alignItems: "center", marginBottom: "12px" });
      const gtzInput = fieldInput("gtz", { type: "text", value: "+8", placeholder: "+8" });
      gtzInput.style.width = "88px";
      gtzInput.style.flex = "0 0 88px";
      gtzRow.append(el("span", { minWidth: "36px", fontWeight: "600" }, { text: "GTZ" }), gtzInput);
      let accountLabel = "";
      const applyLabel = (raw) => {
        accountLabel = slugifyAccount(raw);
        prefixLabel.textContent = accountLabel ? `Filename prefix: ${accountLabel}-` : "Filename prefix: (none)";
      };
      const pageHaystack = () => {
        const parts = [];
        const walk = (node) => {
          if (!node || node === overlay || overlay.contains(node)) return;
          if (node.nodeType === 3) {
            parts.push(node.nodeValue || "");
            return;
          }
          if (node.nodeType !== 1) return;
          const tag = node.tagName;
          if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return;
          if (node.shadowRoot) walk(node.shadowRoot);
          for (const child of node.childNodes) walk(child);
        };
        walk(document.body);
        return parts.join(" ").toLowerCase();
      };
      const parseNameRule = (line) => {
        const splitAt = line.indexOf(":");
        if (splitAt < 0) return { needle: line, prefix: line };
        const needle = line.slice(0, splitAt).trim();
        const prefix = line.slice(splitAt + 1).trim();
        if (!needle) return null;
        return { needle, prefix: prefix || needle };
      };
      const detectKnownName = () => {
        try { localStorage.setItem(NAMES_KEY, namesInput.value); } catch {}
        const rules = namesInput.value.split(/\n/).map((line) => line.trim()).filter((line) => line.length >= 2).map(parseNameRule).filter(Boolean);
        const hay = pageHaystack();
        const found = rules.find((rule) => hay.includes(rule.needle.toLowerCase()));
        if (found) {
          prefixInput.value = found.prefix;
          applyLabel(found.prefix);
          detectLabel.textContent = `Page match: ${found.needle} -> ${found.prefix}`;
          detectLabel.style.color = "#0a7";
        } else {
          detectLabel.textContent = rules.length ? "Page match: none of these names are on the page" : "Page match: add Name : prefix";
          detectLabel.style.color = "#666";
        }
      };
      namesInput.addEventListener("input", detectKnownName);
      prefixInput.addEventListener("input", () => applyLabel(prefixInput.value));
      findBtn.addEventListener("click", async () => {
        const found = await openAccountFinder();
        if (!found) return;
        prefixInput.value = found;
        applyLabel(found);
      });
      const actions = el("div", { display: "flex", gap: "8px", justifyContent: "flex-end" });
      const cancelBtn = ghostBtn("Cancel");
      const okBtn = primaryBtn("Next");
      actions.append(cancelBtn, okBtn);
      panel.append(title, hint, rangeRow, errorBox, attachLabel, countRow, namesBox, prefixRow, prefixLabel, gtzRow, actions);
      overlay.appendChild(panel);
      countButton.addEventListener("click", async () => {
        countButton.disabled = true;
        countButton.textContent = "Counting…";
        try {
          const total = await countConversations(adapter, (n) => {
            totalLabel.textContent = `Total: ${n}…`;
          });
          totalLabel.textContent = `Total: ${total}`;
          toInput.placeholder = String(total);
          countButton.remove();
        } catch (error) {
          console.error("[ai-chat-exporter] count failed", error);
          totalLabel.textContent = "Total: failed — see console";
          countButton.disabled = false;
          countButton.textContent = "Retry";
        }
      });
      const close = (result) => {
        overlay.remove();
        resolve(result);
      };
      const submit = () => {
        const from = Number.parseInt(fromInput.value, 10);
        const to = toInput.value.trim() === "" ? void 0 : Number.parseInt(toInput.value, 10);
        if (!Number.isInteger(from) || from < 1 || to !== void 0 && (!Number.isInteger(to) || to < from)) {
          errorBox.textContent = "Invalid range: “from” must be ≥ 1 and “to” must be ≥ “from”.";
          errorBox.style.display = "block";
          return;
        }
        const gtz = Number.parseFloat(String(gtzInput.value).trim());
        close({ range: { from, to }, includeAttachments: attachmentsInput.checked, accountLabel: slugifyAccount(prefixInput.value), gtz: Number.isFinite(gtz) ? gtz : 8 });
      };
      okBtn.addEventListener("click", submit);
      cancelBtn.addEventListener("click", () => close(null));
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) close(null);
      });
      panel.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          const tag = event.target && event.target.tagName;
          if (tag === "TEXTAREA" || tag === "INPUT") return;
          submit();
        }
        if (event.key === "Escape") close(null);
      });
      document.body.appendChild(overlay);
      detectKnownName();
      fromInput.focus();
    });
  }
  function statusLabel(status) {
    switch (status) {
      case "pending":
        return "";
      case "fetching":
        return "fetching";
      case "attachments":
        return "files";
      case "exporting":
        return "exporting";
      case "done":
        return "done";
      case "failed":
        return "failed";
      case "skipped":
        return "skipped";
    }
  }
  function openSessionPicker(adapter, choices, setButtonStatus) {
    const overlay = document.createElement("div");
    styleOverlay(overlay);
    const panel = document.createElement("div");
    Object.assign(panel.style, {
      ...dialogPanelStyle,
      width: "min(520px, calc(100vw - 32px))",
      maxHeight: "min(80vh, 640px)",
      display: "flex",
      flexDirection: "column",
      gap: "10px"
    });
    const header = el("div", { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" });
    const headerText = el("div");
    const title = el("div", { fontSize: "15px", fontWeight: "600" }, { text: "Select sessions to export" });
    const subtitle = el("div", { color: "#666", marginTop: "4px" }, { text: "Loading titles for range…" });
    headerText.append(title, subtitle);
    const closeBtn = ghostBtn("Close");
    closeBtn.style.padding = "4px 10px";
    header.append(headerText, closeBtn);
    const tools = el("div", { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" });
    const masterLabel = el("label", { display: "flex", gap: "6px", alignItems: "center", cursor: "pointer", fontSize: "12px" });
    const masterBox = el("input", { margin: "0" }, { type: "checkbox" });
    masterBox.checked = true;
    masterLabel.append(masterBox, el("span", void 0, { text: "Select all" }));
    const allBtn = ghostBtn("Select all");
    const noneBtn = ghostBtn("Select none");
    allBtn.style.padding = noneBtn.style.padding = "4px 10px";
    allBtn.style.fontSize = noneBtn.style.fontSize = "12px";
    tools.append(masterLabel, allBtn, noneBtn);
    filenameAccountPrefix = slugifyAccount(choices.accountLabel || "");
    const prefixRow = el("div", { display: "flex", gap: "8px", alignItems: "center" });
    const prefixInput = fieldInput("prefix", { type: "text", placeholder: "account prefix (optional)" });
    prefixInput.value = filenameAccountPrefix;
    const applyPrefixBtn = ghostBtn("Apply prefix");
    applyPrefixBtn.style.padding = "4px 10px";
    applyPrefixBtn.style.fontSize = "12px";
    prefixRow.append(prefixInput, applyPrefixBtn);
    const listEl = el("div", {
      overflow: "auto",
      border: "1px solid #e5e5e5",
      borderRadius: "8px",
      padding: "6px",
      minHeight: "120px",
      maxHeight: "360px",
      background: "#fafafa"
    });
    const summary = el("div", { color: "#666", minHeight: "16px" });
    const footer = el("div", { display: "flex", gap: "8px", justifyContent: "flex-end" });
    const exportBtn = primaryBtn("Export selected");
    footer.append(exportBtn);
    panel.append(header, tools, prefixRow, listEl, summary, footer);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    const rows = /* @__PURE__ */ new Map();
    let metas = [];
    let exporting = false;
    const close = () => overlay.remove();
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay && !exporting) close();
    });
    const setRowStatus = (id, status) => {
      const row = rows.get(id);
      if (!row) return;
      row.statusEl.textContent = statusLabel(status);
      row.statusEl.style.color = status === "failed" ? "#c00" : status === "done" ? "#0a7" : "#666";
    };
    const selectedIds = () => [...rows.entries()].filter(([, r]) => r.checkbox.checked).map(([id]) => id);
    const syncMaster = () => {
      const boxes = [...rows.values()].map((row) => row.checkbox).filter((box) => !box.disabled);
      const checked = boxes.filter((box) => box.checked).length;
      masterBox.checked = boxes.length > 0 && checked === boxes.length;
      masterBox.indeterminate = checked > 0 && checked < boxes.length;
    };
    const setChecks = (value) => {
      for (const { checkbox } of rows.values()) {
        if (!checkbox.disabled) checkbox.checked = value;
      }
      syncMaster();
    };
    allBtn.addEventListener("click", () => setChecks(true));
    noneBtn.addEventListener("click", () => setChecks(false));
    masterBox.addEventListener("change", () => setChecks(masterBox.checked));
    const renderRows = (items) => {
      listEl.replaceChildren();
      rows.clear();
      items.forEach((meta, index) => {
        const row = document.createElement("label");
        Object.assign(row.style, {
          display: "flex",
          alignItems: "flex-start",
          gap: "8px",
          padding: "6px 8px",
          borderRadius: "6px",
          cursor: "pointer"
        });
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = true;
        checkbox.style.marginTop = "2px";
        const title2 = document.createElement("span");
        title2.style.flex = "1";
        title2.style.wordBreak = "break-word";
        const textWrap = document.createElement("span");
        textWrap.style.flex = "1";
        textWrap.style.wordBreak = "break-word";
        title2.textContent = `${index + 1}. ${meta.title || meta.id}`;
        const fileEl = document.createElement("div");
        fileEl.style.fontSize = "11px";
        fileEl.style.color = "#888";
        fileEl.style.marginTop = "2px";
        fileEl.textContent = proposedFileName(meta);
        textWrap.append(title2, fileEl);
        const statusEl = document.createElement("span");
        statusEl.style.fontSize = "11px";
        statusEl.style.color = "#666";
        statusEl.style.whiteSpace = "nowrap";
        checkbox.addEventListener("change", syncMaster);
        row.append(checkbox, textWrap, statusEl);
        listEl.appendChild(row);
        rows.set(meta.id, { checkbox, statusEl, fileEl });
      });
      syncMaster();
    };
    applyPrefixBtn.addEventListener("click", () => {
      filenameAccountPrefix = slugifyAccount(prefixInput.value);
      prefixInput.value = filenameAccountPrefix;
      choices.accountLabel = filenameAccountPrefix;
      for (const [id, row] of rows) {
        const meta = metas.find((item) => item.id === id);
        if (meta && row.fileEl) row.fileEl.textContent = proposedFileName(meta);
      }
    });
    exportBtn.addEventListener("click", async () => {
      const ids = selectedIds();
      if (!ids.length) {
        summary.textContent = "Select at least one session.";
        return;
      }
      exporting = true;
      exportBtn.disabled = true;
      allBtn.disabled = true;
      noneBtn.disabled = true;
      for (const [id, row] of rows) {
        row.checkbox.disabled = true;
        if (!row.checkbox.checked) setRowStatus(id, "skipped");
        else setRowStatus(id, "pending");
      }
      const selected = new Set(ids);
      try {
        await runExport(
          adapter,
          (text) => {
            setButtonStatus(text);
            summary.textContent = text;
          },
          { ...choices, ids, accountLabel: filenameAccountPrefix },
          {
            onProgress: (p) => {
              if (p.meta && selected.has(p.meta.id)) {
                if (p.phase === "fetch") setRowStatus(p.meta.id, "fetching");
                else if (p.phase === "attachments") setRowStatus(p.meta.id, "attachments");
                else if (p.phase === "export") setRowStatus(p.meta.id, "done");
              }
              if (p.phase === "done") {
                for (const id of selected) {
                  const row = rows.get(id);
                  if (row && row.statusEl.textContent !== "failed") setRowStatus(id, "done");
                }
              }
            },
            onError: (id) => setRowStatus(id, "failed")
          }
        );
      } catch (error) {
        console.error("[ai-chat-exporter]", error);
        summary.textContent = "Export failed — see console.";
      } finally {
        exporting = false;
        exportBtn.disabled = false;
      }
    });
    void (async () => {
      try {
        const from = choices.range.from ?? 1;
        const to = choices.range.to;
        subtitle.textContent = `Listing newest sessions ${from}${to ? `–${to}` : "+"}…`;
        metas = await listRange(adapter, choices.range, (n) => {
          subtitle.textContent = `Found ${n} session${n === 1 ? "" : "s"}…`;
        });
        if (!metas.length) {
          subtitle.textContent = "No sessions found in that range.";
          exportBtn.disabled = true;
          return;
        }
        subtitle.textContent = `${metas.length} session${metas.length === 1 ? "" : "s"} in range ${from}${to ? `–${to}` : "+"} (newest first). Uncheck any you do not want in the zip.`;
        renderRows(metas);
      } catch (error) {
        console.error("[ai-chat-exporter] list failed", error);
        subtitle.textContent = "Failed to list sessions — see console.";
        exportBtn.disabled = true;
      }
    })();
  }
  function mountButton() {
    const button = document.createElement("button");
    button.textContent = "Export all chats";
    Object.assign(button.style, {
      position: "fixed",
      right: "20px",
      bottom: "20px",
      zIndex: "2147483645",
      padding: "10px 16px",
      borderRadius: "10px",
      border: "none",
      background: "#111",
      color: "#fff",
      fontSize: "13px",
      cursor: "pointer",
      boxShadow: "0 2px 10px rgba(0,0,0,.25)"
    });
    const setStatus = (text) => {
      button.textContent = text;
    };
    button.addEventListener("click", async () => {
      try {
        const adapter = resolveAdapter();
        if (!adapter) {
          setStatus("Unsupported page.");
          return;
        }
        const choices = await askChoices(adapter);
        if (!choices) return;
        openSessionPicker(adapter, choices, setStatus);
      } catch (error) {
        console.error("[ai-chat-exporter] wizard failed", error);
        setStatus("Wizard failed — see console.");
      }
    });
    document.body.appendChild(button);
  }
  function bootstrap() {
    mountButton();
  }
  bootstrap();

})();