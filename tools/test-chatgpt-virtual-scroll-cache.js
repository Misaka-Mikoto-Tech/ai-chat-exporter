const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

class FakeElement {
  constructor(tagName, attrs = {}, text = "", children = []) {
    this.tagName = tagName.toUpperCase();
    this.attrs = attrs;
    this._text = text;
    this.children = children;
    this.style = {};
    this.dataset = {};
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  getAttribute(name) {
    return this.attrs[name] || null;
  }

  get innerText() {
    const childText = this.children.map((child) => child.innerText).join("");
    return this._text + childText;
  }

  cloneNode(deep) {
    return new FakeElement(
      this.tagName,
      { ...this.attrs },
      this._text,
      deep ? this.children.map((child) => child.cloneNode(true)) : []
    );
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      if (matchesSelector(node, selector)) matches.push(node);
      node.children.forEach(visit);
    };
    this.children.forEach(visit);
    return matches;
  }
}

function matchesSelector(node, selector) {
  if (selector === ".markdown, .whitespace-pre-wrap") {
    return Boolean(node.attrs.class && /\b(markdown|whitespace-pre-wrap)\b/.test(node.attrs.class));
  }
  if (selector === "section[data-testid^='conversation-turn-']") {
    return (
      node.tagName === "SECTION" &&
      typeof node.attrs["data-testid"] === "string" &&
      node.attrs["data-testid"].startsWith("conversation-turn-")
    );
  }
  if (selector === "main") return node.tagName === "MAIN";
  return false;
}

function makeTurn(index, turn, text) {
  const children = text
    ? [new FakeElement("div", { class: turn === "assistant" ? "markdown" : "whitespace-pre-wrap" }, text)]
    : [];
  return new FakeElement(
    "section",
    { "data-testid": `conversation-turn-${index}`, "data-turn": turn },
    "",
    children
  );
}

function makeDocument(turns) {
  const main = new FakeElement("main", {}, "", turns);
  return {
    title: "Virtual Scroll Chat - ChatGPT",
    head: new FakeElement("head"),
    body: new FakeElement("body", {}, "", [main]),
    documentElement: new FakeElement("html"),
    readyState: "complete",
    addEventListener: () => {},
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: () => null,
    querySelector: (selector) => main.querySelector(selector),
    querySelectorAll: (selector) => main.querySelectorAll(selector),
  };
}

function loadExporter(initialDocument) {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "ai-chat-exporter.user.js"),
    "utf8"
  );
  const sandbox = {
    console,
    window: {
      location: { hostname: "chatgpt.com", origin: "https://chatgpt.com", pathname: "/c/test" },
      __AI_CHAT_EXPORTER_TEST__: {},
      addEventListener: () => {},
    },
    document: initialDocument,
    localStorage: { getItem: () => null, setItem: () => {} },
    GM_getValue: (_key, fallback) => fallback,
    GM_setValue: () => {},
    GM_registerMenuCommand: () => {},
    MutationObserver: class {
      observe() {}
    },
    TurndownService: class {},
    setTimeout: () => 0,
    alert: () => {},
    prompt: () => null,
  };
  sandbox.window.document = sandbox.document;
  vm.runInNewContext(source, sandbox, { filename: "ai-chat-exporter.user.js" });
  return sandbox;
}

const sandbox = loadExporter(
  makeDocument([
    makeTurn(1, "user", "first question"),
    makeTurn(2, "assistant", "first answer"),
    makeTurn(3, "user", ""),
    makeTurn(4, "assistant", ""),
  ])
);

assert.ok(
  sandbox.window.__AI_CHAT_EXPORTER_TEST__.ChatExporter,
  "expected test hook to expose ChatExporter"
);

const { ChatExporter } = sandbox.window.__AI_CHAT_EXPORTER_TEST__;
let firstScan = ChatExporter.extractChatGPTChatData(sandbox.document);
assert.strictEqual(
  JSON.stringify(firstScan.messages.map((message) => message.contentText)),
  JSON.stringify(["first question", "first answer"])
);

sandbox.document = makeDocument([
  makeTurn(1, "user", ""),
  makeTurn(2, "assistant", ""),
  makeTurn(3, "user", "second question"),
  makeTurn(4, "assistant", "second answer"),
]);
sandbox.window.document = sandbox.document;

let secondScan = ChatExporter.extractChatGPTChatData(sandbox.document);
assert.strictEqual(
  JSON.stringify(secondScan.messages.map((message) => message.contentText)),
  JSON.stringify(["first question", "first answer", "second question", "second answer"])
);
assert.strictEqual(secondScan.messageCount, 2);

console.log("chatgpt virtual scroll cache test passed");
