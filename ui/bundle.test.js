"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const bundleSource = fs.readFileSync(path.join(__dirname, "bundle.js"), "utf8");

function makeDocument() {
  const elements = new Map();
  const head = {
    children: [],
    appendChild(element) {
      element.parentNode = head;
      head.children.push(element);
      if (element.id) elements.set(element.id, element);
    },
    removeChild(element) {
      const index = head.children.indexOf(element);
      if (index >= 0) head.children.splice(index, 1);
      if (element.id) elements.delete(element.id);
      element.parentNode = null;
    },
  };
  return {
    head,
    documentElement: { classList: { contains: () => false } },
    createElement(tagName) {
      return { tagName, id: "", textContent: "", parentNode: null };
    },
    getElementById(id) {
      return elements.get(id) || null;
    },
  };
}

function loadBundle(options = {}) {
  let plugin = null;
  const document = options.document || makeDocument();
  const context = {
    Blob,
    Date,
    Math,
    clearInterval() {},
    clearTimeout() {},
    console,
    document,
    isFinite,
    setInterval() {
      return 1;
    },
    setTimeout(fn) {
      if (options.runTimeouts) fn();
      return 1;
    },
    window: {
      registerKandevPlugin(id, definition) {
        assert.equal(id, "kandev-plugin-kandy");
        plugin = definition;
      },
    },
  };
  vm.runInNewContext(bundleSource, context, { filename: "ui/bundle.js" });
  assert.ok(plugin, "bundle registered the plugin");
  return { context, document, plugin };
}

function jsx(type, props, ...children) {
  return {
    type,
    props: Object.assign({}, props || {}, {
      children: children.length <= 1 ? children[0] : children,
    }),
  };
}

function visit(node, callback) {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    node.forEach((child) => visit(child, callback));
    return;
  }
  if (typeof node !== "object") return;
  callback(node);
  if (node.props) visit(node.props.children, callback);
}

function textContent(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node === "object" && node.props) return textContent(node.props.children);
  return "";
}

function findNode(root, predicate) {
  let found = null;
  visit(root, (node) => {
    if (!found && predicate(node)) found = node;
  });
  return found;
}

function sampleKandy(overrides = {}) {
  return Object.assign(
    {
      level: 12,
      stage: 2,
      archetype: 3,
      family: 4,
      biome: 2,
      lineage_seed: 99,
      appearance_seed: 1234,
      stage_name: "Drowsy Sporeling",
      progress_pct: 64.5,
      mood: "gloomy",
      temperament_band: "wary",
      scarred: true,
      flavor: "Visible in the ordinary card only.",
      award_seq: 8,
    },
    overrides,
  );
}

test("photo model allowlists visible presentation fields and categorical temperament", () => {
  const render = loadBundle().plugin.__render;
  const model = render.photoModelFor(
    sampleKandy({
      xp: "XP-SECRET",
      temperament: "RAW-TEMPERAMENT-SECRET",
      task_title: "TASK-DATA-SECRET",
    }),
    1,
  );

  assert.deepEqual(Object.keys(model).sort(), [
    "archetype",
    "biome",
    "counterfeit",
    "dayPhase",
    "family",
    "habitat",
    "level",
    "lineageSeed",
    "mood",
    "scarred",
    "sleepState",
    "stageName",
    "temperamentBand",
  ]);
  assert.equal(model.stageName, "Drowsy Sporeling");
  assert.equal(model.habitat, "Alpine");
  assert.equal(model.dayPhase, "night");
  assert.equal(model.sleepState, "asleep");
  assert.equal(model.temperamentBand, "wary");
  assert.equal(JSON.stringify(model).includes("SECRET"), false);
});

test("token vault model allowlists and sorts aggregate usage only", () => {
  const render = loadBundle().plugin.__render;
  assert.equal(typeof render.tokenVaultModelFor, "function");
  const model = render.tokenVaultModelFor(
    sampleKandy({
      token_vault: {
        status: "partial",
        observed_since: "2026-07-28T12:00:00Z",
        total_tokens: "162",
        task_id: "TASK-SECRET",
        prompt: "PROMPT-SECRET",
        rooms: [
          {
            agent_type: "codex-acp",
            label: "Codex",
            tokens: "42",
            session_id: "SESSION-SECRET",
            models: [
              { name: "small", tokens: "2", response: "RESPONSE-SECRET" },
              { name: "large", tokens: "40" },
            ],
          },
          {
            agent_type: "claude-acp",
            label: "Claude",
            tokens: "120",
            models: [{ name: "sonnet", tokens: "120" }],
          },
        ],
      },
    }),
  );

  assert.deepEqual(JSON.parse(JSON.stringify(model)), {
    status: "partial",
    observedSince: "2026-07-28T12:00:00Z",
    totalTokens: "162",
    rooms: [
      {
        agentType: "claude-acp",
        label: "Claude",
        tokens: "120",
        models: [{ name: "sonnet", tokens: "120" }],
      },
      {
        agentType: "codex-acp",
        label: "Codex",
        tokens: "42",
        models: [
          { name: "large", tokens: "40" },
          { name: "small", tokens: "2" },
        ],
      },
    ],
  });
  assert.equal(JSON.stringify(model).includes("SECRET"), false);
});

test("token vault model never fabricates zero for unavailable counts", () => {
  const render = loadBundle().plugin.__render;
  const missing = render.tokenVaultModelFor(sampleKandy());
  const malformed = render.tokenVaultModelFor(
    sampleKandy({
      token_vault: {
        status: "partial",
        total_tokens: "not-a-number",
        rooms: [{ agent_type: "codex-acp", label: "Codex", models: [{ name: "gpt", tokens: -1 }] }],
      },
    }),
  );

  assert.equal(missing.totalTokens, null);
  assert.equal(malformed.totalTokens, null);
  assert.equal(malformed.rooms[0].tokens, null);
  assert.equal(malformed.rooms[0].models[0].tokens, null);
});

test("token vault formats large decimal strings without precision loss", () => {
  const render = loadBundle().plugin.__render;
  assert.equal(typeof render.formatTokenExact, "function");
  assert.equal(render.formatTokenExact("9007199254740993", "en-US"), "9,007,199,254,740,993");
  assert.equal(render.formatTokenExact(null, "en-US"), "Unavailable");
  assert.match(render.formatTokenCompact("9007199254740993", "en-US"), /^[\d,.]+[A-Z]+$/);
});

test("token vault hub and chamber render accessible doors and model piles", () => {
  const render = loadBundle().plugin.__render;
  assert.equal(typeof render.tokenVaultHub, "function");
  assert.equal(typeof render.tokenVaultRoom, "function");
  const model = render.tokenVaultModelFor(
    sampleKandy({
      token_vault: {
        status: "partial",
        observed_since: "2026-07-28T12:00:00Z",
        total_tokens: "9007199254741113",
        rooms: [
          {
            agent_type: "claude-acp",
            label: "Claude",
            tokens: "9007199254740993",
            models: [{ name: "claude-sonnet-4-5", tokens: "9007199254740993" }],
          },
          {
            agent_type: "codex-acp",
            label: "Codex",
            tokens: "120",
            models: [
              { name: "gpt-5.6-codex", tokens: "100" },
              { name: "gpt-5.6-mini-with-a-very-long-model-name", tokens: "20" },
            ],
          },
        ],
      },
    }),
  );
  let opened = null;
  const hub = render.tokenVaultHub(jsx, "DialogTitle", model, { type: "kandy" }, { current: null }, (agentType) => {
    opened = agentType;
  }, () => {}, () => {});
  const doors = [];
  visit(hub, (node) => {
    if (node.type === "button" && node.props["data-vault-agent"]) doors.push(node);
  });

  assert.equal(hub.props.role, "region");
  assert.equal(hub.props["aria-label"], "Kandy token vault");
  assert.equal(doors.length, 2);
  assert.match(doors[0].props["aria-label"], /Claude, 9,007,199,254,740,993 tokens, open chamber/);
  doors[1].props.onClick();
  assert.equal(opened, "codex-acp");
  assert.match(textContent(hub), /Some usage is estimated or incomplete/);
  assert.doesNotMatch(textContent(hub), /next page|page 1/i);

  let revealed = null;
  const room = render.tokenVaultRoom(
    jsx,
    "DialogTitle",
    model,
    "codex-acp",
    "codex-acp\u0000gpt-5.6-codex",
    { current: null },
    () => {},
    () => {},
    (key) => {
      revealed = key;
    },
  );
  const piles = [];
  visit(room, (node) => {
    if (node.type === "button" && node.props["data-vault-model"]) piles.push(node);
  });

  assert.equal(piles.length, 2);
  assert.equal(piles[0].props["aria-pressed"], true);
  assert.equal(piles[1].props["aria-pressed"], false);
  assert.match(piles[0].props["aria-label"], /gpt-5\.6-codex, 100 tokens in Codex chamber/);
  assert.match(textContent(room), /gpt-5\.6-mini-with-a-very-long-model-name/);
  piles[1].props.onClick();
  assert.equal(revealed, "codex-acp\u0000gpt-5.6-mini-with-a-very-long-model-name");
  assert.ok(render.tokenPileScale("100", "100") > render.tokenPileScale("20", "100"));
});

test("chat topbar control uses desktop and phone geometry", () => {
  const { document, plugin } = loadBundle();
  plugin.initialize(
    {
      registerComponent() {},
      registerWsHandler() {},
    },
    { jsx, ui: {} },
  );

  const style = document.getElementById("kandev-kandy-style");
  assert.ok(style);
  assert.match(style.textContent, /#kandev-kandy-widget[^}]*width:28px[^}]*height:28px/);
  assert.match(
    style.textContent,
    /@media \(max-width:639px\)\{#kandev-kandy-widget[^}]*width:44px[^}]*height:44px/,
  );
});

test("token vault CSS uses vertical responsive grids without paging tracks", () => {
  const { document, plugin } = loadBundle();
  plugin.initialize(
    { registerComponent() {}, registerWsHandler() {} },
    { jsx, ui: {} },
  );
  const css = document.getElementById("kandev-kandy-style").textContent;

  assert.match(css, /\.kandev-kandy-vault-panel\{[^}]*max-height:calc\(100vh - 32px\)[^}]*overflow:hidden/);
  assert.match(css, /\.kandev-kandy-vault-bar\{[^}]*position:sticky[^}]*top:0/);
  assert.match(css, /\.kandev-kandy-vault-scroll\{[^}]*overflow-y:auto[^}]*overflow-x:hidden/);
  assert.match(css, /\.kandev-kandy-vault-grid,.kandev-kandy-token-grid\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(140px,1fr\)\)/);
  assert.match(css, /@media \(max-width:480px\)\{\.kandev-kandy-vault-grid,.kandev-kandy-token-grid\{grid-template-columns:1fr\}/);
  assert.match(css, /\.kandev-kandy-token-pile:hover \.kandev-kandy-vault-exact/);
  assert.match(css, /\.kandev-kandy-token-pile:focus-visible \.kandev-kandy-vault-exact/);
  assert.match(css, /\.kandev-kandy-token-pile\.is-revealed \.kandev-kandy-vault-exact/);
  assert.doesNotMatch(css, /vault-(?:carousel|pager|track)/);
});

test("photo export uses fixed high-resolution PNG dimensions and explicit theme palettes", () => {
  const render = loadBundle().plugin.__render;
  const plan = render.photoExportPlan();
  const light = render.photoPaletteFor("light");
  const dark = render.photoPaletteFor("dark");

  assert.deepEqual(JSON.parse(JSON.stringify(plan)), {
    width: 1600,
    height: 2000,
    mimeType: "image/png",
  });
  assert.notEqual(light.background, dark.background);
  assert.notEqual(light.surface, dark.surface);
  assert.match(light.text, /^#[0-9a-f]{6}$/i);
  assert.match(dark.text, /^#[0-9a-f]{6}$/i);
});

test("photo portrait renders only shareable Kandy presentation", () => {
  const render = loadBundle().plugin.__render;
  render.setJsx(jsx);
  const model = render.photoModelFor(
    sampleKandy({
      xp: "XP-SECRET",
      temperament: "RAW-TEMPERAMENT-SECRET",
      task_title: "TASK-DATA-SECRET",
    }),
    1,
  );
  const portrait = render.photoPortraitSvg(jsx, model, "dark", { current: null });
  const words = textContent(portrait).replace(/\s+/g, " ");
  const serialized = JSON.stringify(portrait);

  assert.equal(portrait.type, "svg");
  assert.equal(portrait.props.viewBox, "0 0 800 1000");
  assert.equal(portrait.props.role, "img");
  assert.match(portrait.props.className, /kandev-kandy-static/);
  assert.match(portrait.props["aria-label"], /Drowsy Sporeling/);
  assert.match(words, /Drowsy Sporeling/);
  assert.match(words, /Lv 12/);
  assert.match(words, /Gloomy/);
  assert.match(words, /Bond/);
  assert.match(words, /Wary/);
  assert.match(words, /Alpine/);
  assert.match(words, /Night/);
  assert.match(words, /Raised in Kandev\./);
  assert.doesNotMatch(words, /Grown through work/);
  assert.equal(serialized.includes("SECRET"), false);
  assert.equal(serialized.includes("progress_pct"), false);
  assert.equal(serialized.includes("var(--"), false);
  assert.equal(serialized.includes("#090e1a"), true);
});

test("Photo Booth control isolates pointer, context-menu, and click events", () => {
  const render = loadBundle().plugin.__render;
  let opens = 0;
  let stopped = 0;
  const button = render.photoBoothButton(jsx, () => {
    opens++;
  });
  const event = {
    stopPropagation() {
      stopped++;
    },
  };

  button.props.onPointerDown(event);
  button.props.onContextMenu(event);
  button.props.onClick(event);

  assert.equal(button.type, "button");
  assert.equal(button.props.type, "button");
  assert.equal(button.props["aria-label"], "Open Kandy Photo Booth");
  assert.equal(opens, 1);
  assert.equal(stopped, 3);
});

test("Photo Booth entry is a camera control with a compact surface and 40px hit area", () => {
  const render = loadBundle().plugin.__render;
  const button = render.photoBoothButton(jsx, () => {});
  const icon = findNode(button, (node) => node.type === "svg");
  const surface = findNode(
    button,
    (node) => node.type === "span" && node.props.className === "kandev-kandy-photo-entry-surface",
  );

  assert.equal(button.props.style.width, "40px");
  assert.equal(button.props.style.height, "40px");
  assert.equal(button.props.style.minHeight, "40px");
  assert.equal(textContent(button).trim(), "");
  assert.equal(icon.props["aria-hidden"], "true");
  assert.equal(icon.props["data-icon"], "camera");
  assert.equal(surface.props.style.width, "32px");
  assert.equal(surface.props.style.height, "32px");
  assert.equal(surface.props.style.borderRadius, "8px");
});

test("Photo Booth view exposes a focus target and native keyboard controls", () => {
  const render = loadBundle().plugin.__render;
  render.setJsx(jsx);
  const focusRef = { current: null };
  const panel = render.photoBoothPanel(
    jsx,
    "DialogTitle",
    render.photoModelFor(sampleKandy(), 13),
    "light",
    { current: null },
    focusRef,
    "idle",
    () => {},
    () => {},
  );
  const back = findNode(panel, (node) => node.props && node.props["aria-label"] === "Back to Kandy");
  const copy = findNode(
    panel,
    (node) => node.props && node.props["aria-label"] === "Copy image to clipboard",
  );
  const copiedPanel = render.photoBoothPanel(
    jsx,
    "DialogTitle",
    render.photoModelFor(sampleKandy(), 13),
    "light",
    { current: null },
    { current: null },
    "copied",
    () => {},
    () => {},
  );
  const preparingPanel = render.photoBoothPanel(
    jsx,
    "DialogTitle",
    render.photoModelFor(sampleKandy(), 13),
    "light",
    { current: null },
    { current: null },
    "preparing",
    () => {},
    () => {},
  );
  const preparingCopy = findNode(
    preparingPanel,
    (node) => node.props && node.props["aria-label"] === "Copy image to clipboard",
  );
  const copyingPanel = render.photoBoothPanel(
    jsx,
    "DialogTitle",
    render.photoModelFor(sampleKandy(), 13),
    "light",
    { current: null },
    { current: null },
    "copying",
    () => {},
    () => {},
  );
  const copyingCopy = findNode(
    copyingPanel,
    (node) => node.props && node.props["aria-label"] === "Copy image to clipboard",
  );

  assert.equal(panel.props.ref, focusRef);
  assert.equal(panel.props.tabIndex, -1);
  assert.equal(back.type, "button");
  assert.equal(back.props.type, "button");
  assert.ok(copy, "Photo Booth exposes a clipboard action");
  assert.equal(copy.type, "button");
  assert.equal(copy.props.type, "button");
  assert.match(textContent(copy), /Copy image/);
  assert.match(textContent(copiedPanel), /Copied to clipboard\./);
  assert.equal(preparingCopy.props.disabled, true);
  assert.match(textContent(preparingCopy), /Preparing image/);
  assert.equal(copyingCopy.props.disabled, false);
  assert.equal(copyingCopy.props["aria-busy"], "true");
});

test("PNG rendering uses only the supplied portrait and revokes local URLs", async () => {
  const render = loadBundle().plugin.__render;
  const portrait = { nodeName: "svg", marker: "PORTRAIT-ONLY" };
  const createdUrls = [];
  const revokedUrls = [];
  const drawCalls = [];
  let serializedNode = null;
  let canvas = null;

  class FakeXMLSerializer {
    serializeToString(node) {
      serializedNode = node;
      return '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    }
  }

  class FakeBlob {
    constructor(parts, options) {
      this.parts = parts;
      this.type = options.type;
    }
  }

  class FakeImage {
    set src(value) {
      this.source = value;
      queueMicrotask(() => this.onload());
    }
  }

  const env = {
    Blob: FakeBlob,
    Image: FakeImage,
    XMLSerializer: FakeXMLSerializer,
    URL: {
      createObjectURL(blob) {
        const value = `blob:local-${createdUrls.length + 1}`;
        createdUrls.push({ value, blob });
        return value;
      },
      revokeObjectURL(value) {
        revokedUrls.push(value);
      },
    },
    document: {
      createElement(tagName) {
        if (tagName === "canvas") {
          canvas = {
            width: 0,
            height: 0,
            getContext(kind) {
              assert.equal(kind, "2d");
              return {
                drawImage(...args) {
                  drawCalls.push(args);
                },
              };
            },
            toBlob(callback, type) {
              assert.equal(type, "image/png");
              queueMicrotask(() => {
                callback(new FakeBlob(["png"], { type }));
              });
            },
          };
          return canvas;
        }
        throw new Error(`unexpected element: ${tagName}`);
      },
    },
  };

  assert.equal(typeof render.renderPhotoPng, "function");
  const png = await render.renderPhotoPng(portrait, env);

  assert.equal(serializedNode, portrait);
  assert.equal(canvas.width, 1600);
  assert.equal(canvas.height, 2000);
  assert.equal(drawCalls.length, 1);
  assert.deepEqual(drawCalls[0].slice(1), [0, 0, 1600, 2000]);
  assert.equal(png.type, "image/png");
  assert.deepEqual(revokedUrls, ["blob:local-1"]);
});

test("PNG copy writes a pre-rendered Blob during the initiating click", async () => {
  const render = loadBundle().plugin.__render;
  const png = new Blob(["png"], { type: "image/png" });
  const clipboardWrites = [];
  let clipboardItem = null;

  class FakeClipboardItem {
    constructor(items) {
      clipboardItem = this;
      this.items = items;
    }
  }

  const pending = render.copyPhotoBlob(png, {
    ClipboardItem: FakeClipboardItem,
    clipboard: {
      write(items) {
        clipboardWrites.push(items);
        return Promise.resolve();
      },
    },
  });

  assert.equal(clipboardWrites.length, 1, "clipboard write happens synchronously with the click");
  assert.equal(clipboardWrites[0][0], clipboardItem);
  assert.equal(clipboardItem.items["image/png"], png);
  assert.equal(typeof clipboardItem.items["image/png"].then, "undefined");
  await pending;
});

test("insecure HTTP prepares the PNG in an offscreen image document", async () => {
  const render = loadBundle().plugin.__render;
  const png = new Blob(["png"], { type: "image/png" });
  const attributes = {};
  const revokedUrls = [];
  let appendedFrame = null;
  let removedFrame = null;

  const frame = {
    style: {},
    contentDocument: { contentType: "text/html" },
    setAttribute(name, value) {
      attributes[name] = value;
    },
    set src(value) {
      this.source = value;
      queueMicrotask(() => {
        this.contentDocument.contentType = "image/png";
        if (this.onload) this.onload();
      });
    },
  };
  const env = {
    isSecureContext: false,
    document: {
      body: {
        appendChild(node) {
          appendedFrame = node;
          queueMicrotask(() => {
            if (node.onload) node.onload();
          });
        },
        removeChild(node) {
          removedFrame = node;
        },
      },
      createElement(tagName) {
        assert.equal(tagName, "iframe");
        return frame;
      },
    },
    URL: {
      createObjectURL(blob) {
        assert.equal(blob, png);
        return "blob:local-photo";
      },
      revokeObjectURL(value) {
        revokedUrls.push(value);
      },
    },
  };

  const prepared = await render.preparePhotoCopy(png, env);

  assert.equal(prepared.method, "image-document");
  assert.equal(appendedFrame, frame);
  assert.equal(frame.source, "blob:local-photo");
  assert.equal(frame.style.position, "fixed");
  assert.equal(frame.style.left, "-10000px");
  assert.equal(frame.style.opacity, "0");
  assert.equal(attributes["aria-hidden"], "true");
  assert.equal(attributes.tabindex, "-1");

  render.disposePreparedPhoto(prepared, env);
  assert.equal(removedFrame, frame);
  assert.deepEqual(revokedUrls, ["blob:local-photo"]);
});

test("insecure HTTP copy uses the image document and restores keyboard focus", async () => {
  const render = loadBundle().plugin.__render;
  let frameFocused = 0;
  let restoredFocus = 0;
  let copyCommands = 0;
  const activeElement = {
    focus(options) {
      restoredFocus++;
      assert.equal(options.preventScroll, true);
    },
  };
  const prepared = {
    method: "image-document",
    frame: {
      contentWindow: {
        focus() {
          frameFocused++;
        },
      },
      contentDocument: {
        contentType: "image/png",
        execCommand(command) {
          assert.equal(command, "copy");
          copyCommands++;
          return true;
        },
      },
    },
  };

  await render.copyPreparedPhoto(prepared, {
    document: { activeElement },
  });

  assert.equal(frameFocused, 1);
  assert.equal(copyCommands, 1);
  assert.equal(restoredFocus, 1);
});

test("clipboard failures distinguish blocked and unsupported copies", () => {
  const render = loadBundle().plugin.__render;

  assert.equal(
    render.photoCopyFailureStatus({ name: "NotAllowedError" }, { isSecureContext: true }),
    "blocked",
  );
  assert.equal(
    render.photoCopyFailureStatus({ name: "NotSupportedError" }, { isSecureContext: true }),
    "unsupported",
  );
  assert.equal(render.photoCopyFailureStatus(new Error("failed"), { isSecureContext: false }), "error");
  assert.equal(render.photoCopyFailureStatus(new Error("failed"), { isSecureContext: true }), "error");
});

test("widget includes dialog-only Photo Booth and token vault entries", () => {
  const cleanups = [];
  const React = {
    Fragment: "Fragment",
    useEffect(effect) {
      cleanups.push(effect());
    },
    useRef(value) {
      return { current: value };
    },
    useState(value) {
      return [typeof value === "function" ? value() : value, () => {}];
    },
  };
  let Widget = null;
  const runtime = loadBundle();
  runtime.plugin.initialize(
    {
      registerComponent(slot, component) {
        assert.equal(slot, "chat-top-bar");
        Widget = component;
      },
      registerWsHandler() {},
    },
    {
      React,
      api: {
        fetch() {
          return Promise.resolve({ json: () => Promise.resolve(sampleKandy()) });
        },
      },
      jsx,
      ui: {
        Dialog: "Dialog",
        DialogContent: "DialogContent",
        DialogTitle: "DialogTitle",
        Tooltip: "Tooltip",
        TooltipContent: "TooltipContent",
        TooltipTrigger: "TooltipTrigger",
      },
    },
  );

  const tree = Widget();
  const dialog = findNode(tree, (node) => node.type === "DialogContent");
  const tooltip = findNode(tree, (node) => node.type === "TooltipContent");
  const dialogEntry = findNode(
    dialog,
    (node) =>
      node.type === "div" &&
      node.props.style &&
      node.props.style.position === "absolute" &&
      node.props.style.top === "8px" &&
      node.props.style.right === "8px",
  );
  const dialogButton = findNode(
    dialogEntry,
    (node) => node.type === "button" && node.props["aria-label"] === "Open Kandy Photo Booth",
  );
  const zoomedCard = findNode(
    dialog,
    (node) => node.type === "div" && node.props.className === "kandev-kandy-dialogzoom",
  );
  const tooltipButton = findNode(
    tooltip,
    (node) => node.type === "button" && node.props["aria-label"] === "Open Kandy Photo Booth",
  );
  const vaultButton = findNode(
    dialog,
    (node) => node.type === "button" && node.props["aria-label"] === "Show me your token vault",
  );
  const tooltipVaultButton = findNode(
    tooltip,
    (node) => node.type === "button" && node.props["aria-label"] === "Show me your token vault",
  );

  assert.ok(dialogEntry, "dialog positions Photo Booth at the top right");
  assert.ok(dialogButton, "dialog exposes the camera control");
  assert.match(dialog.props.className, /max-w-none/, "dialog keeps current L-sized card layout");
  assert.ok(zoomedCard, "dialog keeps current L-sized card zoom");
  assert.equal(
    findNode(
      zoomedCard,
      (node) => node.type === "button" && node.props["aria-label"] === "Open Kandy Photo Booth",
    ),
    null,
    "camera hit target stays compact instead of inheriting card zoom",
  );
  assert.equal(tooltipButton, null, "hover preview remains unchanged");
  assert.ok(vaultButton, "full dialog exposes the token-vault entrance");
  assert.equal(vaultButton.props.type, "button");
  assert.equal(tooltipVaultButton, null, "hover preview remains action-free");

  cleanups.forEach((cleanup) => cleanup && cleanup());
  runtime.plugin.destroy();
});

test("initialize and destroy remain repeatable", () => {
  const runtime = loadBundle();
  const registry = {
    registerComponent() {},
    registerWsHandler() {},
  };
  const host = { React: {}, jsx, ui: {} };

  runtime.plugin.initialize(registry, host);
  runtime.plugin.initialize(registry, host);
  assert.equal(runtime.document.head.children.length, 1);
  assert.match(runtime.document.head.children[0].textContent, /prefers-reduced-motion/);
  assert.match(runtime.document.head.children[0].textContent, /kandev-kandy-control\{transition:none\}/);

  runtime.plugin.destroy();
  runtime.plugin.destroy();
  assert.equal(runtime.document.head.children.length, 0);

  runtime.plugin.initialize(registry, host);
  assert.equal(runtime.document.head.children.length, 1);
  runtime.plugin.destroy();
  assert.equal(runtime.document.head.children.length, 0);
});

test("dialog zoom clamps to [1.0, 2.2] and to viewport fit with runtime design dims", () => {
  const render = loadBundle().plugin.__render;
  // Plenty of viewport: only the [1.0, 2.2] band applies.
  assert.equal(render.clampDialogZoom(1.45, 248, 364, 1600, 1200), 1.45);
  assert.equal(render.clampDialogZoom(0.4, 248, 364, 1600, 1200), 1);
  assert.equal(render.clampDialogZoom(9, 248, 364, 1600, 1200), 2.2);
  // Viewport-fit bound: a 400px-wide viewport caps zoom at (400-48)/248.
  assert.ok(Math.abs(render.clampDialogZoom(9, 248, 364, 400, 2000) - 352 / 248) < 1e-9);
  // Height binds too, using the measured (not hardcoded) design height.
  assert.ok(Math.abs(render.clampDialogZoom(9, 248, 364, 2000, 500) - 452 / 364) < 1e-9);
  // A viewport too small even for zoom 1 still floors at 1 (card >= 248px).
  assert.equal(render.clampDialogZoom(2, 248, 364, 260, 300), 1);
});

test("dialog zoom drag mapping averages both axes and ignores degenerate dims", () => {
  const render = loadBundle().plugin.__render;
  // A full-design-width horizontal pull adds 0.5; matching both axes adds 1.
  assert.ok(Math.abs(render.dialogZoomFromDrag(1.45, 248, 0, 248, 364) - 1.95) < 1e-9);
  assert.ok(Math.abs(render.dialogZoomFromDrag(1.45, 248, 364, 248, 364) - 2.45) < 1e-9);
  // Dragging up-left shrinks.
  assert.ok(render.dialogZoomFromDrag(1.45, -80, -80, 248, 364) < 1.45);
  // Unmeasurable design dims leave the zoom untouched.
  assert.equal(render.dialogZoomFromDrag(1.45, 40, 40, 0, 0), 1.45);
});

test("dialog zoom persists via localStorage and reset clears the stored value", () => {
  const render = loadBundle().plugin.__render;
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
  // Absent or garbage values fall back to the 1.45 default.
  assert.equal(render.storedDialogZoom(storage), 1.45);
  storage.setItem("kandev-kandy-dialog-zoom", "not-a-number");
  assert.equal(render.storedDialogZoom(storage), 1.45);
  // Round trip; out-of-range stored values clamp on read.
  render.persistDialogZoom(1.8123456, storage);
  assert.equal(store.get("kandev-kandy-dialog-zoom"), "1.812");
  assert.equal(render.storedDialogZoom(storage), 1.812);
  storage.setItem("kandev-kandy-dialog-zoom", "99");
  assert.equal(render.storedDialogZoom(storage), 2.2);
  // Reset (double-click) removes the key entirely.
  render.persistDialogZoom(null, storage);
  assert.equal(store.has("kandev-kandy-dialog-zoom"), false);
  assert.equal(render.storedDialogZoom(storage), 1.45);
});

test("dialog renders an unscaled Resize grip and state-driven inline zoom", () => {
  const cleanups = [];
  const React = {
    Fragment: "Fragment",
    useEffect(effect) {
      cleanups.push(effect());
    },
    useRef(value) {
      return { current: value };
    },
    useState(value) {
      return [typeof value === "function" ? value() : value, () => {}];
    },
  };
  let Widget = null;
  const runtime = loadBundle();
  runtime.plugin.initialize(
    {
      registerComponent(slot, component) {
        Widget = component;
      },
      registerWsHandler() {},
    },
    {
      React,
      api: {
        fetch() {
          return Promise.resolve({ json: () => Promise.resolve(sampleKandy()) });
        },
      },
      jsx,
      ui: {
        Dialog: "Dialog",
        DialogContent: "DialogContent",
        DialogTitle: "DialogTitle",
        Tooltip: "Tooltip",
        TooltipContent: "TooltipContent",
        TooltipTrigger: "TooltipTrigger",
      },
    },
  );

  const tree = Widget();
  const dialog = findNode(tree, (node) => node.type === "DialogContent");
  const frame = findNode(
    dialog,
    (node) => node.type === "div" && node.props.className === "kandev-kandy-dialogframe",
  );
  const zoomed = findNode(
    frame,
    (node) => node.type === "div" && node.props.className === "kandev-kandy-dialogzoom",
  );
  const grip = findNode(
    frame,
    (node) => node.type === "button" && node.props["aria-label"] === "Resize",
  );

  // Default zoom 1.45 arrives as inline styles (no localStorage in this
  // harness), with the frame width tracking 248 x zoom.
  assert.ok(frame, "dialog renders the card frame");
  assert.equal(zoomed.props.style.zoom, 1.45);
  assert.equal(frame.props.style.width, 248 * 1.45 + "px");
  // The grip is a sibling of the zoomed wrapper (its hit area never
  // scales) and wires the full pointer-capture drag + double-click reset.
  assert.ok(grip, "dialog exposes the resize grip");
  // Regression: the host DialogContent base carries sm:max-w-lg (512px);
  // without the sm-tier override the card clips past zoom ~2.06 and the
  // grip's corner falls onto the overlay, dismissing the dialog mid-drag.
  assert.match(dialog.props.className, /sm:max-w-none/);
  assert.equal(
    findNode(zoomed, (node) => node.type === "button" && node.props["aria-label"] === "Resize"),
    null,
    "grip lives outside the zoomed wrapper",
  );
  assert.equal(typeof grip.props.onPointerDown, "function");
  assert.equal(typeof grip.props.onPointerMove, "function");
  assert.equal(typeof grip.props.onPointerUp, "function");
  assert.equal(typeof grip.props.onPointerCancel, "function");
  assert.equal(typeof grip.props.onDoubleClick, "function");
  // The injected stylesheet hides the grip and pins zoom 1 on phones.
  const css = runtime.document.head.children[0].textContent;
  assert.match(css, /max-width: 480px.*kandev-kandy-resizegrip\{display:none\}/);
  assert.match(css, /kandev-kandy-dialogzoom\{zoom:1!important\}/);

  cleanups.forEach((cleanup) => cleanup && cleanup());
  runtime.plugin.destroy();
});

test("hold-to-tip overlay renders tilt, cancel, and reduced-motion static buckets", () => {
  const render = loadBundle().plugin.__render;
  const data = sampleKandy();

  const tilt = render.holdTipOverlay(jsx, { seq: 1, mode: "tilt" }, data);
  const tiltBucket = findNode(tilt, (node) => node.type === "svg");
  assert.equal(tiltBucket.props.className, "kandev-kandy-holdtip");
  // Duration inline so the CSS stays a single linear ramp the JS can map
  // elapsed time back onto.
  assert.equal(tiltBucket.props.style.animationDuration, "700ms");
  assert.equal(tiltBucket.props.viewBox, "0 0 44 44");

  const cancel = render.holdTipOverlay(jsx, { seq: 2, mode: "cancel", rot: -52.34 }, data);
  const cancelBucket = findNode(cancel, (node) => node.type === "svg");
  assert.equal(cancelBucket.props.className, "kandev-kandy-holdcancel");
  assert.equal(cancelBucket.props.style["--kandy-holdrot"], "-52.3deg");

  const still = render.holdTipOverlay(jsx, { seq: 3, mode: "static" }, data);
  const stillBucket = findNode(still, (node) => node.type === "svg");
  assert.equal(stillBucket.props.className, "kandev-kandy-holdtip-static");
  assert.equal(stillBucket.props.style.animationDuration, undefined);

  // All three hover above the same creature contact point.
  const c = render.bonkContactFor(data);
  assert.equal(tiltBucket.props.style.left, c.x - 15 + "px");
  assert.equal(tiltBucket.props.style.top, c.y - 36 - 15 + "px");
});

test("care hint text is pointer-aware", () => {
  const render = loadBundle().plugin.__render;
  assert.equal(render.careHintText(false), "psst — click your kandy");
  assert.equal(render.careHintText(true), "tap to treat · hold to douse");
});

test("Kandy card explains care and growth from the info icon beside mood", () => {
  const render = loadBundle().plugin.__render;
  render.setJsx(jsx);
  const card = render.kandyCard(jsx, sampleKandy(), null, null, 13);
  const infoButton = findNode(
    card,
    (node) => node.type === "button" && node.props["aria-label"] === "How Kandy works",
  );
  const help = findNode(
    card,
    (node) => node.props && node.props.className === "kandev-kandy-helpcontent",
  );
  const helpText = textContent(help).replace(/\s+/g, " ");

  assert.ok(infoButton, "the card exposes a keyboard-focusable info control");
  assert.equal(infoButton.props.type, "button");
  assert.equal(infoButton.props["aria-describedby"], "kandev-kandy-help-text");
  assert.equal(help.props.role, "tooltip");
  assert.match(helpText, /Click or tap Kandy to give it candy/);
  assert.match(helpText, /Right-click to add water; on touch, press and hold/);
  assert.match(helpText, /Messages and completed agent turns and runs help it grow/);
  assert.match(helpText, /Candy and water change mood and bond, not growth/);
  assert.match(helpText, /One Kandy is shared across this Kandev instance/);
});

test("Kandy help opens on hover and keyboard focus within the card", () => {
  const { document, plugin } = loadBundle();
  plugin.initialize(
    {
      registerComponent() {},
      registerWsHandler() {},
    },
    { jsx, ui: {} },
  );

  const css = document.getElementById("kandev-kandy-style").textContent;
  assert.match(css, /\.kandev-kandy-help:hover \.kandev-kandy-helpcontent/);
  assert.match(css, /\.kandev-kandy-help:focus-within \.kandev-kandy-helpcontent/);
  assert.match(css, /\.kandev-kandy-helpcontent\{[^}]*width:214px/);
  assert.match(
    css,
    /\.kandev-kandy-tooltip:has\(\.kandev-kandy-help:hover\).*overflow:visible!important/,
    "hover preview releases its clipping while the help panel is open",
  );
  assert.match(
    css,
    /#kandev-kandy-dialog:has\(\.kandev-kandy-help:focus-within\).*overflow:visible!important/,
    "dialog releases its clipping for keyboard users",
  );

  plugin.destroy();
});

test("pet zone wires the coarse-pointer hold and blocks gesture stealing", () => {
  const cleanups = [];
  const React = {
    Fragment: "Fragment",
    useEffect(effect) {
      cleanups.push(effect());
    },
    useRef(value) {
      return { current: value };
    },
    useState(value) {
      return [typeof value === "function" ? value() : value, () => {}];
    },
  };
  let Widget = null;
  const runtime = loadBundle();
  runtime.plugin.initialize(
    {
      registerComponent(slot, component) {
        Widget = component;
      },
      registerWsHandler() {},
    },
    {
      React,
      api: {
        fetch() {
          return Promise.resolve({ json: () => Promise.resolve(sampleKandy()) });
        },
      },
      jsx,
      ui: {
        Dialog: "Dialog",
        DialogContent: "DialogContent",
        DialogTitle: "DialogTitle",
        Tooltip: "Tooltip",
        TooltipContent: "TooltipContent",
        TooltipTrigger: "TooltipTrigger",
      },
    },
  );

  const tree = Widget();
  const dialog = findNode(tree, (node) => node.type === "DialogContent");
  const petZone = findNode(
    dialog,
    (node) => node.type === "button" && node.props.id === "kandev-kandy-pet-zone",
  );
  assert.ok(petZone, "dialog renders the pet zone");
  // The hold lifecycle: down starts (coarse only), up/cancel disambiguate.
  assert.equal(typeof petZone.props.onPointerDown, "function");
  assert.equal(typeof petZone.props.onPointerUp, "function");
  assert.equal(typeof petZone.props.onPointerCancel, "function");
  assert.equal(typeof petZone.props.onClick, "function");
  assert.equal(typeof petZone.props.onContextMenu, "function");
  // touch-action none: a mid-hold press must never turn into a scroll.
  assert.equal(petZone.props.style.touchAction, "none");
  assert.equal(petZone.props.style.userSelect, "none");

  // The stylesheet carries the hold keyframes and suppresses the tilt and
  // cancel animations (never the static signal) under reduced motion.
  const css = runtime.document.head.children[0].textContent;
  assert.match(css, /@keyframes kandev-kandy-holdtip\{0%\{opacity:0;transform:rotate\(0deg\)\}/);
  assert.match(css, /@keyframes kandev-kandy-holdcancel\{0%\{opacity:0\.95;transform:rotate\(var\(--kandy-holdrot,-52deg\)\)\}/);
  assert.match(css, /kandev-kandy-holdtip-static\{position:absolute;opacity:0\.95/);
  const reduced = css.slice(css.indexOf("(prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\.kandev-kandy-holdtip,\.kandev-kandy-holdcancel/);
  assert.ok(!/holdtip-static/.test(reduced), "static bucket survives reduced motion");

  cleanups.forEach((cleanup) => cleanup && cleanup());
  runtime.plugin.destroy();
});

// ---------------------------------------------------------------------------
// v0.7.0 — seasons, speech bubbles, arrival greetings.
// ---------------------------------------------------------------------------

test("season mapping covers all twelve months (northern-hemisphere)", () => {
  const render = loadBundle().plugin.__render;
  const expected = [
    "winter", "winter", "spring", "spring", "spring", "summer",
    "summer", "summer", "autumn", "autumn", "autumn", "winter",
  ];
  for (let m = 0; m < 12; m++) {
    assert.equal(render.seasonForMonth(m), expected[m], `month ${m}`);
  }
  // Out-of-range months wrap instead of crashing.
  assert.equal(render.seasonForMonth(-1), "winter");
  assert.equal(render.seasonForMonth(12), "winter");
});

test("sceneFor without a season stays byte-identical; seasons compose on top", () => {
  const render = loadBundle().plugin.__render;
  render.setJsx(jsx);
  const plain = render.sceneFor(0, 24, 5150, 13);
  // Unset, undefined, and unknown season names all render the old scene.
  assert.equal(JSON.stringify(render.sceneFor(0, 24, 5150, 13, undefined)), JSON.stringify(plain));
  assert.equal(JSON.stringify(render.sceneFor(0, 24, 5150, 13, "monsoon")), JSON.stringify(plain));
  // Deterministic: the same seasonal call twice is identical.
  assert.equal(
    JSON.stringify(render.sceneFor(0, 24, 5150, 13, "winter")),
    JSON.stringify(render.sceneFor(0, 24, 5150, 13, "winter")),
  );

  // Winter: cool tint prepended + 12 drifting snowflakes + 3 ground drifts.
  const winter = render.sceneFor(0, 24, 5150, 13, "winter");
  assert.ok(winter.bg.startsWith("linear-gradient"), "season tint leads the background");
  assert.notEqual(winter.bg, plain.bg);
  assert.ok(winter.bg.endsWith(plain.bg), "the base scene background is preserved under the tint");
  const snow = winter.props.filter((n) => n && n.props && n.props.className === "kandev-kandy-snow");
  assert.equal(snow.length, 12);
  assert.equal(winter.props.length, plain.props.length + 15);
  snow.forEach((n) => {
    assert.match(n.props.style.animationDuration, /s$/);
    assert.equal(n.props.fill, "#ffffff");
  });

  // Spring petals and autumn leaves drift on their own classes.
  const spring = render.sceneFor(0, 24, 5150, 13, "spring");
  assert.equal(
    spring.props.filter((n) => n && n.props && n.props.className === "kandev-kandy-petal").length,
    9,
  );
  const autumn = render.sceneFor(0, 24, 5150, 13, "autumn");
  assert.equal(
    autumn.props.filter((n) => n && n.props && n.props.className === "kandev-kandy-leaf").length,
    9,
  );

  // Summer: tint only by day; fireflies appear at night.
  const summerDay = render.sceneFor(0, 24, 5150, 13, "summer");
  assert.equal(summerDay.props.length, plain.props.length);
  assert.notEqual(summerDay.bg, plain.bg);
  const summerNight = render.sceneFor(0, 24, 5150, 23, "summer");
  assert.equal(
    summerNight.props.filter((n) => n && n.props && n.props.className === "kandev-kandy-firefly").length,
    6,
  );

  // Celestial phases (4-5): space has no weather — the subtlest tint, no
  // particles at all.
  const celestialPlain = render.sceneFor(0, 60, 5150, 13);
  const celestialWinter = render.sceneFor(0, 60, 5150, 13, "winter");
  assert.equal(celestialWinter.props.length, celestialPlain.props.length);
  assert.notEqual(celestialWinter.bg, celestialPlain.bg);
  assert.ok(celestialWinter.bg.includes("0.05"), "celestial tint is dimmer than the regular wash");
});

test("speech pool is ~250 disciplined lines across bands and contexts", () => {
  const render = loadBundle().plugin.__render;
  const lines = render.speechLines;
  assert.ok(lines.length >= 240 && lines.length <= 320, `pool size ${lines.length}`);

  const bands = ["beloved", "content", "neutral", "wary", "fearful", "any"];
  const ctxs = [
    "generic", "greeting", "morning", "latenight", "dusk", "bored", "gloomy",
    "refusing", "winter", "spring", "summer", "autumn", "scarred", "counterfeit", "sleep",
  ];
  const ids = new Set();
  for (const line of lines) {
    assert.ok(!ids.has(line.id), `duplicate id ${line.id}`);
    ids.add(line.id);
    assert.ok(bands.includes(line.band), `${line.id}: band ${line.band}`);
    assert.ok(ctxs.includes(line.ctx), `${line.id}: ctx ${line.ctx}`);
    assert.ok(line.text.length > 0 && line.text.length <= 48, `${line.id}: ${line.text.length} chars`);
    assert.doesNotMatch(line.text, /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u, `${line.id}: no emoji`);
  }
  // Every band has a DEEP generic voice (the old 6-per-band pools made a
  // fearful kandy cycle the same four sentences) and its own greetings.
  for (const band of ["beloved", "content", "neutral", "wary", "fearful"]) {
    const generics = lines.filter((l) => l.band === band && l.ctx === "generic").length;
    assert.ok(generics >= 18 && generics <= 24, `${band} generics: ${generics}`);
    assert.ok(lines.filter((l) => l.band === band && l.ctx === "greeting").length >= 3, `${band} greeting`);
  }
  // Context sub-pools are deep enough that the 30min cadence never loops
  // visibly: seasons 8+, time-of-day 10+/6+, moods 8+, refusal 8+,
  // scarred 12+, sleep-talk 8+.
  for (const ctx of ["winter", "spring", "summer", "autumn"]) {
    assert.ok(lines.filter((l) => l.ctx === ctx).length >= 8, `${ctx} pool`);
  }
  assert.ok(lines.filter((l) => l.ctx === "morning").length >= 10);
  assert.ok(lines.filter((l) => l.ctx === "latenight").length >= 10);
  assert.ok(lines.filter((l) => l.ctx === "dusk").length >= 6);
  assert.ok(lines.filter((l) => l.ctx === "bored").length >= 8);
  assert.ok(lines.filter((l) => l.ctx === "gloomy").length >= 8);
  assert.ok(lines.filter((l) => l.ctx === "refusing").length >= 8);
  assert.ok(lines.filter((l) => l.ctx === "scarred").length >= 12);
  assert.ok(lines.filter((l) => l.ctx === "counterfeit").length >= 8);
  const sleep = lines.filter((l) => l.ctx === "sleep");
  assert.ok(sleep.length >= 8);
  sleep.forEach((l) => assert.match(l.text, /zzz/));
});

test("speech gate is deterministic and fires at the designed cadence", () => {
  const render = loadBundle().plugin.__render;
  let awake = 0;
  let asleep = 0;
  for (let tick = 0; tick < 3000; tick++) {
    if (render.speechGate(5150, tick, false)) awake++;
    if (render.speechGate(5150, tick, true)) asleep++;
    assert.equal(render.speechGate(5150, tick, false), render.speechGate(5150, tick, false));
  }
  // Awake ~25% of minute ticks (a bubble every ~4 min); sleep-talk ~10%.
  assert.ok(awake / 3000 > 0.2 && awake / 3000 < 0.3, `awake rate ${awake / 3000}`);
  assert.ok(asleep / 3000 > 0.06 && asleep / 3000 < 0.15, `sleep rate ${asleep / 3000}`);
});

test("speech picker is deterministic and filters band + context first", () => {
  const render = loadBundle().plugin.__render;
  const at = (data, ctx) => render.pickSpeech(data, ctx);

  // Deterministic: identical inputs, identical line.
  const d1 = { temperament_band: "neutral", mood: "content", lineage_seed: 42, level: 12 };
  const ctx1 = { timeOfDay: 2, tick: 5, trigger: "tick", recentIds: [] };
  assert.deepEqual(at(d1, ctx1), at(d1, ctx1));

  // 2am: the late-night pool wins.
  assert.equal(at(d1, ctx1).ctx, "latenight");

  // Refusal midday: the distrust lines speak.
  const refusing = { temperament_band: "wary", mood: "content", refusing_pets: true, lineage_seed: 7 };
  for (let t = 0; t < 30; t++) {
    assert.equal(at(refusing, { timeOfDay: 13, tick: t }).ctx, "refusing");
  }

  // Nothing contextual midday: the band's generic pool is the fallback.
  const fearful = { temperament_band: "fearful", mood: "content", lineage_seed: 9 };
  for (let t = 0; t < 30; t++) {
    const line = at(fearful, { timeOfDay: 13, tick: t });
    assert.equal(line.ctx, "generic");
    assert.equal(line.band, "fearful");
  }

  // On the degraded (no-storage) path a beloved kandy never borrows
  // another band's voice — borrowing is a bag feature.
  const beloved = { temperament_band: "beloved", mood: "content", lineage_seed: 5150 };
  for (let t = 0; t < 200; t++) {
    const line = at(beloved, { timeOfDay: 2, tick: t });
    assert.ok(line.band === "beloved" || line.band === "any", `${line.id} at tick ${t}`);
  }

  // The scar no longer monopolizes the pool: a scarred kandy speaks its
  // band's lines with scarred dark humor mixed in as ~15% bag spice.
  const scarred = { temperament_band: "content", mood: "content", scarred: true, lineage_seed: 3 };
  {
    const resolved = render.speechPoolFor(scarred, { timeOfDay: 13 });
    const size = resolved.pool.length + render.speechBagExtras(scarred, resolved, render.speechSliceSeed(3, resolved.slice), 0).length;
    let scarCount = 0;
    for (let p = 0; p < size; p++) {
      if (at(scarred, { timeOfDay: 13, bagPos: p }).ctx === "scarred") scarCount++;
    }
    const frac = scarCount / size;
    assert.ok(frac > 0.1 && frac < 0.2, `scarred spice ${frac}`);
  }

  // Seasons contribute a pool when passed explicitly.
  const seasonal = at(d1, { timeOfDay: 13, tick: 2, season: "winter" });
  assert.equal(seasonal.ctx, "winter");

  // Greetings are time-appropriate ("morning!" family in the morning).
  for (let t = 0; t < 40; t++) {
    const hello = at(d1, { timeOfDay: 9, tick: t, trigger: "greeting" });
    assert.ok(hello.ctx === "greeting" || hello.ctx === "morning", `${hello.id}`);
  }

  // Asleep: sleep-talk only.
  const murmur = at(d1, { timeOfDay: 23.9, tick: 3, asleep: true });
  assert.equal(murmur.ctx, "sleep");
  assert.match(murmur.text, /zzz/);

  // The no-immediate-repeat guard skips just-said lines.
  const first = at(d1, { timeOfDay: 2, tick: 8 });
  const second = at(d1, { timeOfDay: 2, tick: 8, recentIds: [first.id] });
  assert.notEqual(second.id, first.id);
});

test("speech shuffle bag covers every line before any repeat, then reshuffles", () => {
  const render = loadBundle().plugin.__render;
  const fearful = { temperament_band: "fearful", mood: "content", scarred: true, lineage_seed: 5150 };
  const ctx = (p) => ({ timeOfDay: 13, bagPos: p });
  const resolved = render.speechPoolFor(fearful, { timeOfDay: 13 });
  assert.equal(resolved.slice, "generic:fearful");
  const size =
    resolved.pool.length +
    render.speechBagExtras(fearful, resolved, render.speechSliceSeed(5150, resolved.slice), 0).length;
  // One full pass: every position yields a distinct line, and every base
  // generic plays before anything repeats.
  const firstPass = [];
  for (let p = 0; p < size; p++) firstPass.push(render.pickSpeech(fearful, ctx(p)));
  assert.equal(new Set(firstPass.map((l) => l.id)).size, size);
  for (const l of resolved.pool) assert.ok(firstPass.some((x) => x.id === l.id), `${l.id} missed`);
  // Deterministic: the same positions replay the same walk.
  for (let p = 0; p < size; p++) assert.equal(render.pickSpeech(fearful, ctx(p)).id, firstPass[p].id);
  // Reshuffle on exhaustion: pass 2 is a full distinct pass in a new
  // order and never opens on pass 1's closing line.
  const secondPass = [];
  for (let p = size; p < 2 * size; p++) secondPass.push(render.pickSpeech(fearful, ctx(p)));
  assert.equal(new Set(secondPass.map((l) => l.id)).size, size);
  assert.notEqual(secondPass[0].id, firstPass[size - 1].id);
  assert.notDeepEqual(secondPass.map((l) => l.id), firstPass.map((l) => l.id));
  for (const l of resolved.pool) assert.ok(secondPass.some((x) => x.id === l.id), `${l.id} missed in pass 2`);
});

test("generic bags borrow ~25% from adjacent bands, deterministically", () => {
  const render = loadBundle().plugin.__render;
  const fearful = { temperament_band: "fearful", mood: "content", lineage_seed: 777 };
  const resolved = render.speechPoolFor(fearful, { timeOfDay: 13 });
  const size =
    resolved.pool.length +
    render.speechBagExtras(fearful, resolved, render.speechSliceSeed(777, resolved.slice), 0).length;
  const walk = [];
  for (let p = 0; p < size; p++) walk.push(render.pickSpeech(fearful, { timeOfDay: 13, bagPos: p }));
  const frac = walk.filter((l) => l.band === "wary").length / size;
  assert.ok(frac > 0.18 && frac < 0.3, `borrow fraction ${frac}`);
  // Only the ladder-adjacent band is borrowed from, never a farther one.
  for (const l of walk) assert.ok(["fearful", "wary"].includes(l.band), l.id);
  // Deterministic from the counter: same positions, same lines.
  for (let p = 0; p < size; p++) {
    assert.equal(render.pickSpeech(fearful, { timeOfDay: 13, bagPos: p }).id, walk[p].id);
  }
  // A middle band borrows from both sides — and only from its sides.
  const neutral = { temperament_band: "neutral", mood: "content", lineage_seed: 42 };
  const nRes = render.speechPoolFor(neutral, { timeOfDay: 13 });
  const nSize =
    nRes.pool.length +
    render.speechBagExtras(neutral, nRes, render.speechSliceSeed(42, nRes.slice), 0).length;
  const nBands = new Set();
  for (let p = 0; p < nSize; p++) {
    const line = render.pickSpeech(neutral, { timeOfDay: 13, bagPos: p });
    assert.ok(["neutral", "content", "wary"].includes(line.band), line.id);
    nBands.add(line.band);
  }
  assert.ok(nBands.has("content") && nBands.has("wary"), "both neighbors show up");
});

test("speech bag walks a persistent per-slice localStorage counter", () => {
  const render = loadBundle().plugin.__render;
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  const fearful = { temperament_band: "fearful", mood: "content", scarred: true, lineage_seed: 5150 };
  const seen = [];
  for (let i = 0; i < 12; i++) seen.push(render.pickSpeech(fearful, { timeOfDay: 13, storage }));
  assert.equal(store.get("kandev-kandy-speech-bag:generic:fearful"), "12");
  assert.equal(new Set(seen.map((l) => l.id)).size, 12, "no repeats inside the first pass");
  // The storage walk IS the explicit-position walk.
  for (let i = 0; i < 12; i++) {
    assert.equal(seen[i].id, render.pickSpeech(fearful, { timeOfDay: 13, bagPos: i }).id);
  }
  // Sleep-talk has its own slice and counter.
  const murmur = render.pickSpeech(fearful, { asleep: true, storage });
  assert.match(murmur.text, /zzz/);
  assert.equal(store.get("kandev-kandy-speech-bag:sleep"), "1");
  // Broken storage degrades to the deterministic hash pick, not a crash.
  const broken = {
    getItem() {
      throw new Error("nope");
    },
    setItem() {
      throw new Error("nope");
    },
  };
  const a = render.pickSpeech(fearful, { timeOfDay: 13, tick: 9, storage: broken });
  assert.deepEqual(a, render.pickSpeech(fearful, { timeOfDay: 13, tick: 9, storage: broken }));
});

test("bubbles obey a shared 30min cooldown; arrival greetings bypass it", () => {
  const render = loadBundle().plugin.__render;
  const MIN = 60 * 1000;
  const now = 1_700_000_000_000;
  // Fresh install (no stamp): ready. Within 30min: blocked. At 30min: ready.
  assert.equal(render.bubbleCooldownReady(0, now), true);
  assert.equal(render.bubbleCooldownReady(now - 29 * MIN, now), false);
  assert.equal(render.bubbleCooldownReady(now - 30 * MIN, now), true);
  // Dialog open: a plain open respects the cooldown; an arrival always
  // speaks (it just re-stamps via showSpeech like every other bubble).
  assert.equal(render.openGreetingAllowed(false, now - 5 * MIN, now), false);
  assert.equal(render.openGreetingAllowed(false, now - 31 * MIN, now), true);
  assert.equal(render.openGreetingAllowed(true, now - 5 * MIN, now), true);
  // The stamp round-trips through storage and moves on every write.
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  assert.equal(render.readLastBubble(storage), 0);
  render.writeLastBubble(now, storage);
  assert.equal(store.get("kandev-kandy-last-bubble"), String(now));
  assert.equal(render.readLastBubble(storage), now);
  render.writeLastBubble(now + MIN, storage);
  assert.equal(render.readLastBubble(storage), now + MIN);
  assert.equal(render.bubbleCooldownReady(render.readLastBubble(storage), now + 10 * MIN), false);
  assert.equal(render.bubbleCooldownReady(render.readLastBubble(storage), now + 32 * MIN), true);
  // Broken storage: the cooldown never blocks and never crashes.
  assert.equal(
    render.readLastBubble({
      getItem() {
        throw new Error("nope");
      },
    }),
    0,
  );
  render.writeLastBubble(now, {
    setItem() {
      throw new Error("nope");
    },
  });
});

test("arrival gap logic and last-seen storage round-trip", () => {
  const render = loadBundle().plugin.__render;
  const H = 60 * 60 * 1000;
  const now = 1_700_000_000_000;
  // A fresh install (no stamp) never greets; 6h is the threshold.
  assert.equal(render.arrivalDue(0, now), false);
  assert.equal(render.arrivalDue(now - 6 * H + 1, now), false);
  assert.equal(render.arrivalDue(now - 6 * H, now), true);
  assert.equal(render.arrivalDue(now - 48 * H, now), true);

  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
  };
  assert.equal(render.readLastSeen(storage), 0);
  storage.setItem("kandev-kandy-last-seen", "garbage");
  assert.equal(render.readLastSeen(storage), 0);
  render.writeLastSeen(now, storage);
  assert.equal(store.get("kandev-kandy-last-seen"), String(now));
  assert.equal(render.readLastSeen(storage), now);
  // Broken storage degrades to "never greet", not a crash.
  assert.equal(render.readLastSeen({ getItem() { throw new Error("nope"); } }), 0);
  render.writeLastSeen(now, { setItem() { throw new Error("nope"); } });
});

test("speech bubble is an app-styled comic bubble anchored to the head", () => {
  const render = loadBundle().plugin.__render;
  const blob = sampleKandy({ archetype: 0, mood: "content", scarred: false });
  const serpent = sampleKandy({ archetype: 3, mood: "content", scarred: false });
  const line = { id: "neu-g5", text: "don't mind me. I'm ambience.", seq: 4 };

  const bubble = render.speechBubble(jsx, line, blob);
  assert.equal(bubble.props.className, "kandev-kandy-bubble");
  assert.equal(bubble.props["aria-hidden"], "true");
  assert.match(textContent(bubble), /ambience/);
  assert.equal(bubble.props.style.animationDuration, "7200ms");
  const tail = findNode(bubble, (n) => n.props && n.props.className === "kandev-kandy-bubbletail");
  assert.ok(tail, "bubble has a tail toward the creature");

  // A centered blob grows the bubble rightward; a serpent's raised head
  // (right of center) grows it leftward so the text stays on the card.
  assert.ok(bubble.props.style.left, "blob bubble anchors from the left");
  const serpentBubble = render.speechBubble(jsx, line, serpent);
  assert.ok(serpentBubble.props.style.right, "serpent bubble anchors from the right");
  assert.equal(serpentBubble.props.style.left, undefined);

  // Two-axis clamping (scene is 248x124): the bottom offset caps at
  // h-46 so even a two-line bubble stays inside the top edge on tall
  // creatures, and each side's maxWidth caps to the room it has left.
  for (const data of [blob, serpent, sampleKandy({ archetype: 3, level: 60, mood: "content" })]) {
    const b = render.speechBubble(jsx, line, data);
    assert.ok(parseFloat(b.props.style.bottom) <= 124 - 46, `bottom ${b.props.style.bottom}`);
    const width = parseFloat(b.props.style.maxWidth);
    assert.ok(width <= 158, `maxWidth ${b.props.style.maxWidth}`);
    const inset = parseFloat(b.props.style.right || b.props.style.left);
    assert.ok(inset + width <= 248 - 8, `bubble fits: inset ${inset} + width ${width}`);
  }
});

test("kandyCard renders the bubble as content but never over reactions", () => {
  const render = loadBundle().plugin.__render;
  render.setJsx(jsx);
  const data = sampleKandy({ mood: "content", scarred: false });
  const line = { id: "neu-g1", text: "so we just level forever? cool. cool cool.", seq: 1 };
  const hasBubble = (card) =>
    !!findNode(card, (n) => n.props && n.props.className === "kandev-kandy-bubble");

  assert.equal(hasBubble(render.kandyCard(jsx, data, null, null, 13, undefined, line)), true);
  assert.equal(hasBubble(render.kandyCard(jsx, data, null, null, 13)), false);
  // Celebrations and care reactions own the pixels while they play.
  assert.equal(hasBubble(render.kandyCard(jsx, data, { kind: "gain" }, null, 13, undefined, line)), false);
  assert.equal(
    hasBubble(render.kandyCard(jsx, data, null, { onPet() {}, fx: 1 }, 13, undefined, line)),
    false,
  );
  assert.equal(
    hasBubble(render.kandyCard(jsx, data, null, { onPet() {}, bonkFx: 1 }, 13, undefined, line)),
    false,
  );
  // Sleep-talk murmurs still render while asleep (selection guards the
  // pool; 23.8 is past every seeded bedtime).
  assert.equal(
    hasBubble(render.kandyCard(jsx, data, null, null, 23.8, undefined, { id: "slp-a1", text: "…zzz… merge conflict…", seq: 2 })),
    true,
  );
});

test("legacy kandyCard and creature calls stay byte-identical without new params", () => {
  const render = loadBundle().plugin.__render;
  render.setJsx(jsx);
  for (const data of [
    sampleKandy(),
    sampleKandy({ level: 1, archetype: 0, stage_name: "Egg" }),
    sampleKandy({ level: 60, archetype: 8, biome: 1, mood: "elated", temperament_band: "beloved" }),
  ]) {
    assert.equal(
      JSON.stringify(render.kandyCard(jsx, data, null, null, 13)),
      JSON.stringify(render.kandyCard(jsx, data, null, null, 13, undefined, null)),
    );
    assert.equal(
      JSON.stringify(render.kandyCard(jsx, data, null, { onPet() {}, fx: 1, hint: true }, 13)),
      JSON.stringify(render.kandyCard(jsx, data, null, { onPet() {}, fx: 1, hint: true }, 13, undefined, null)),
    );
  }
});

test("arrival greeting hops on the safe wrapper with motion arcs beside it", () => {
  const render = loadBundle().plugin.__render;
  render.setJsx(jsx);
  const data = sampleKandy({ mood: "content", scarred: false });

  const card = render.kandyCard(jsx, data, null, { onPet() {}, greetFx: 7 }, 13);
  const zone = findNode(card, (n) => n.type === "button" && n.props.id === "kandev-kandy-pet-zone");
  assert.match(zone.props.className, /kandev-kandy-cardhop/);
  assert.match(zone.props.className, /kandev-kandy-wiggle/);
  const arcs = findNode(card, (n) => n.props && n.props.className === "kandev-kandy-greetarc");
  assert.ok(arcs, "motion arcs render beside the creature");

  // Never while asleep: no hop, no arcs (23.8 is past every bedtime).
  const asleepCard = render.kandyCard(jsx, data, null, { onPet() {}, greetFx: 7 }, 23.8);
  const asleepZone = findNode(
    asleepCard,
    (n) => n.type === "button" && n.props.id === "kandev-kandy-pet-zone",
  );
  assert.doesNotMatch(asleepZone.props.className || "", /cardhop/);
  assert.equal(
    findNode(asleepCard, (n) => n.props && n.props.className === "kandev-kandy-greetarc"),
    null,
  );

  // greetArcsOverlay itself hugs the contact point.
  const overlay = render.greetArcsOverlay(jsx, 7, data);
  const c = render.bonkContactFor(data);
  assert.equal(overlay.props.style.left, c.x - 40 + "px");
});

test("v0.7.0 visuals respect reduced motion (bubble stays, frills freeze)", () => {
  const runtime = loadBundle();
  runtime.plugin.initialize(
    { registerComponent() {}, registerWsHandler() {} },
    { React: {}, jsx, ui: {} },
  );
  const css = runtime.document.head.children[0].textContent;
  // Season particles drift via transform-only loops; the bubble's life is
  // opacity with base 1 (content shows statically when animations are off).
  assert.match(css, /@keyframes kandev-kandy-snowdrift/);
  assert.match(css, /@keyframes kandev-kandy-bubblelife/);
  // The bubble is always white with dark text — it lives inside the
  // illustrated scene, not the theme-colored UI chrome.
  assert.match(css, /kandev-kandy-bubble\{position:absolute[^}]*background:#ffffff[^}]*color:#414b5c[^}]*font-style:italic/);
  assert.match(css, /kandev-kandy-bubbletail\{[^}]*background:#ffffff[^}]*transform:rotate\(45deg\)/);
  const reduced = css.slice(css.indexOf("(prefers-reduced-motion: reduce)"));
  for (const cls of ["snow", "petal", "leaf", "firefly", "bubble", "greetarc"]) {
    assert.ok(reduced.includes(`.kandev-kandy-${cls}`), `${cls} silenced under reduced motion`);
  }
  runtime.plugin.destroy();
});

// ---------------------------------------------------------------------------
// v0.8.0 — wander (walking) + crying spells
// ---------------------------------------------------------------------------

test("wander limit clamps to ±35 and keeps the body inside the scene edge", () => {
  const render = loadBundle().plugin.__render;
  const T = render.motionTuning;
  assert.equal(T.WANDER_MAX_PX, 35);
  // The invariant that matters: limit + widest-body-half + margin never
  // crosses the scene half-width, for every archetype at every stage.
  const SCENE_HALF = 248 / 2;
  for (let arch = 0; arch < 10; arch++) {
    for (const level of [2, 12, 30, 55, 80, 100]) {
      const data = sampleKandy({ archetype: arch, level });
      const limit = render.wanderLimitFor(data);
      assert.ok(limit > 0 && limit <= 35, `limit ${limit} in (0,35] (arch ${arch} lv ${level})`);
      // Reconstruct the body clamp: even at the extreme target the widest
      // body extent (any archetype is < 36 viewBox units ≈ 33 scene px)
      // stays clear of the edge.
      assert.ok(limit + 36 * 0.92 + 2 <= SCENE_HALF, `body inside edge (arch ${arch})`);
    }
  }
  // The egg / unknown fallback still yields a sane limit.
  assert.ok(render.wanderLimitFor(null) > 0);
});

test("wander targets stay inside the limit and at least a stride away", () => {
  const render = loadBundle().plugin.__render;
  const seed = 3061213989 >>> 0;
  for (const from of [-35, -20, 0, 20, 35]) {
    for (let bucket = 0; bucket < 300; bucket++) {
      const t = render.wanderTargetFor(seed, bucket, from, 35);
      assert.ok(t >= -35 && t <= 35, `target ${t} clamped`);
      assert.ok(Math.abs(t - from) >= 14 - 1e-9, `stride ${Math.abs(t - from)} >= 14`);
    }
  }
  // Deterministic: the same (seed, bucket) always lands the same target.
  assert.equal(
    render.wanderTargetFor(seed, 42, 0, 35),
    render.wanderTargetFor(seed, 42, 0, 35),
  );
});

test("wander and cry gates are deterministic with mood-shaped cadence", () => {
  const render = loadBundle().plugin.__render;
  const seed = 424242;
  const count = (fn) => {
    let n = 0;
    for (let b = 0; b < 4000; b++) if (fn(b)) n++;
    return n / 4000;
  };
  // Determinism.
  for (let b = 0; b < 50; b++) {
    assert.equal(render.wanderGate(seed, b, "happy"), render.wanderGate(seed, b, "happy"));
    assert.equal(render.cryGate(seed, b, "sad"), render.cryGate(seed, b, "sad"));
  }
  // Mood modulation: elated/happy stroll often, content normal, bored
  // rare, sad/gloomy almost never (10s buckets).
  const pHappy = count((b) => render.wanderGate(seed, b, "happy"));
  const pContent = count((b) => render.wanderGate(seed, b, "content"));
  const pBored = count((b) => render.wanderGate(seed, b, "bored"));
  const pSad = count((b) => render.wanderGate(seed, b, "sad"));
  // v0.8.1 livelier gates: happy 0.75, content 0.55, bored 0.25, sad 0.08.
  assert.ok(Math.abs(pHappy - 0.75) < 0.05, `happy ~0.75 (${pHappy})`);
  assert.ok(Math.abs(pContent - 0.55) < 0.05, `content ~0.55 (${pContent})`);
  assert.ok(Math.abs(pBored - 0.25) < 0.05, `bored ~0.25 (${pBored})`);
  assert.ok(pSad < 0.12, `sad rarely (${pSad})`);
  assert.ok(pHappy > pContent && pContent > pBored && pBored > pSad, "ordering holds");
  // Cry: sad ~1/16 of 15s buckets (~4min), gloomy roughly double, and a
  // fed kandy never cries.
  const cSad = count((b) => render.cryGate(seed, b, "sad"));
  const cGloomy = count((b) => render.cryGate(seed, b, "gloomy"));
  assert.ok(Math.abs(cSad - 0.0625) < 0.02, `sad cry ~1/16 (${cSad})`);
  assert.ok(cGloomy / cSad > 1.5 && cGloomy / cSad < 2.6, `gloomy ~2x (${cGloomy / cSad})`);
  for (const mood of ["elated", "happy", "content", "bored"]) {
    assert.equal(count((b) => render.cryGate(seed, b, mood)), 0, `${mood} never cries`);
  }
});

test("each archetype walks in character (gait table)", () => {
  const render = loadBundle().plugin.__render;
  const gait = (a) => render.gaitFor(a);
  assert.equal(gait(0).cls, "kandev-kandy-gait-waddle"); // blob
  assert.equal(gait(2).cls, "kandev-kandy-gait-waddle"); // chonk
  assert.equal(gait(1).cls, "kandev-kandy-gait-stride"); // willow
  assert.equal(gait(3).cls, "kandev-kandy-gait-slither"); // noodle
  assert.equal(gait(4).cls, "kandev-kandy-gait-shuffle"); // sporeling
  assert.equal(gait(5).cls, "kandev-kandy-gait-drift"); // wisp
  assert.equal(gait(6).cls, "kandev-kandy-gait-hopskip"); // shardling
  assert.equal(gait(8).cls, "kandev-kandy-gait-glide"); // gazer
  assert.equal(gait(9).cls, "kandev-kandy-gait-glide"); // flitter
  // The cogling is the only stepped mover (its steps ARE the gait).
  for (let a = 0; a < 10; a++) assert.equal(gait(a).stepped, a === 7, `arch ${a} stepped`);
  // Floaty archetypes keep the idle bob (their glide rides on it);
  // grounded steppers hand vertical motion to the gait keyframes.
  for (let a = 0; a < 10; a++) {
    assert.equal(gait(a).keepBob, a === 5 || a === 8 || a === 9, `arch ${a} keepBob`);
  }
  assert.equal(gait(13).cls, gait(3).cls, "index wraps like BODY_BUILDERS");
});

test("wander legs ease with smoothstep; the cogling steps 3px on linear time", () => {
  const render = loadBundle().plugin.__render;
  const leg = { from: -10, to: 20, durMs: 1500, stepped: false };
  assert.equal(render.wanderXAt(leg, -50), -10);
  assert.equal(render.wanderXAt(leg, 0), -10);
  assert.equal(render.wanderXAt(leg, 1500), 20);
  assert.equal(render.wanderXAt(leg, 99999), 20);
  // Smoothstep: exact midpoint at half time, slow start (< linear early).
  assert.equal(render.wanderXAt(leg, 750), 5);
  const quarter = render.wanderXAt(leg, 375);
  assert.ok(quarter - -10 < 30 * 0.25, "eased start is slower than linear");
  let prev = -10;
  for (let t = 0; t <= 1500; t += 50) {
    const x = render.wanderXAt(leg, t);
    assert.ok(x >= prev - 1e-9, "monotonic");
    prev = x;
  }
  // Cogling: discrete 3px increments, LINEAR time (no easing).
  const cog = { from: 0, to: 21, durMs: 1400, stepped: true };
  const seen = new Set();
  for (let t = 0; t <= 1400; t += 20) {
    const x = render.wanderXAt(cog, t);
    assert.ok(x === 21 || x % 3 === 0, `stepped x ${x} is a 3px multiple`);
    seen.add(x);
  }
  assert.ok(seen.size >= 7, "walk passes through the intermediate steps");
  // Linear: at half time it has covered ~half the distance (floor to 3px),
  // NOT the smoothstepped value.
  assert.equal(render.wanderXAt(cog, 700), Math.floor((21 * 0.5) / 3) * 3);
  // Direction works both ways.
  const back = { from: 6, to: -12, durMs: 900, stepped: true };
  assert.equal(render.wanderXAt(back, 900), -12);
  assert.ok(render.wanderXAt(back, 450) <= 6);
});

test("motionDecide encodes mood, sleep, egg, reduced-motion, and yield rules", () => {
  const render = loadBundle().plugin.__render;
  const T = render.motionTuning;
  const seed = 777001;
  const happy = sampleKandy({ mood: "happy", lineage_seed: seed, archetype: 0 });
  const sad = sampleKandy({ mood: "sad", lineage_seed: seed, archetype: 0 });
  const idleState = {
    x: 0, leg: null, cryUntil: 0, cryPending: false, lastWanderBucket: -1, lastCryBucket: -1,
  };
  const baseInp = { data: happy, asleep: false, reducedMotion: false, fxActive: false };
  // Find gate-passing buckets deterministically.
  let walkBucket = -1;
  for (let b = 0; b < 500 && walkBucket < 0; b++) if (render.wanderGate(seed, b, "happy")) walkBucket = b;
  let cryBucket = -1;
  for (let b = 0; b < 500 && cryBucket < 0; b++) if (render.cryGate(seed, b, "sad")) cryBucket = b;
  assert.ok(walkBucket >= 0 && cryBucket >= 0, "found gate-passing buckets");
  const walkNow = walkBucket * T.WANDER_BUCKET_MS + 1;
  const cryNow = cryBucket * T.CRY_BUCKET_MS + 1;

  // A stroll starts when the gate passes...
  const start = render.motionDecide(idleState, { ...baseInp, now: walkNow });
  assert.equal(start.type, "start-leg");
  assert.ok(Math.abs(start.leg.to - start.leg.from) >= 14 - 1e-9);
  assert.equal(start.facing, start.leg.to >= start.leg.from ? 1 : -1);
  // v0.8.1: strolls carry a deterministic 0-2 leg chain.
  assert.ok(Number.isInteger(start.chain) && start.chain >= 0 && start.chain <= 2, `chain 0-2 (${start.chain})`);
  assert.equal(render.motionDecide(idleState, { ...baseInp, now: walkNow }).chain, start.chain);
  // v0.8.1: a bucket where the wander gate misses can yield an idle
  // look-flip instead — scan behaviorally for one and assert it repeats
  // deterministically.
  {
    let look = null;
    for (let b = 0; b < 4000 && !look; b++) {
      if (render.wanderGate(seed, b, "happy")) continue;
      const a = render.motionDecide(idleState, { ...baseInp, now: b * T.WANDER_BUCKET_MS + 1 });
      if (a.type === "look") {
        look = a;
        assert.equal(
          render.motionDecide(idleState, { ...baseInp, now: b * T.WANDER_BUCKET_MS + 1 }).type,
          "look",
        );
      }
    }
    assert.ok(look, "found a look bucket");
  }
  // ...but the same bucket never votes twice...
  assert.equal(
    render.motionDecide({ ...idleState, lastWanderBucket: walkBucket }, { ...baseInp, now: walkNow }).type,
    "none",
  );
  // ...and never while a leg is already playing, or mid-interaction, or
  // asleep, or reduced-motion, or for an egg.
  const leg = { from: 0, to: 20, durMs: 1000, stepped: false, startedAt: walkNow };
  assert.notEqual(render.motionDecide({ ...idleState, leg }, { ...baseInp, now: walkNow }).type, "start-leg");
  assert.equal(render.motionDecide(idleState, { ...baseInp, now: walkNow, fxActive: true }).type, "none");
  assert.equal(render.motionDecide(idleState, { ...baseInp, now: walkNow, asleep: true }).type, "none");
  assert.equal(render.motionDecide(idleState, { ...baseInp, now: walkNow, reducedMotion: true }).type, "none");
  assert.equal(
    render.motionDecide(idleState, { ...baseInp, now: walkNow, data: { ...happy, level: 1 } }).type,
    "none",
  );
  // Sleep/reduced-motion arriving mid-motion halts (freeze + cancel).
  assert.equal(render.motionDecide({ ...idleState, leg }, { ...baseInp, now: walkNow, asleep: true }).type, "halt");
  assert.equal(
    render.motionDecide({ ...idleState, cryUntil: walkNow + 5000 }, { ...baseInp, now: walkNow, reducedMotion: true }).type,
    "halt",
  );

  // Crying: a sad kandy starts a bout when stationary...
  const sadInp = { ...baseInp, data: sad };
  assert.equal(render.motionDecide(idleState, { ...sadInp, now: cryNow }).type, "start-cry");
  // ...a bout due mid-stroll WAITS (cry-pending), then starts once the
  // stroll is done...
  assert.equal(render.motionDecide({ ...idleState, leg }, { ...sadInp, now: cryNow }).type, "cry-pending");
  assert.equal(
    render.motionDecide({ ...idleState, cryPending: true, lastCryBucket: cryBucket }, { ...sadInp, now: cryNow }).type,
    "start-cry",
  );
  // ...and no stroll starts while crying (or while a bout is pending).
  const cryingState = { ...idleState, cryUntil: walkNow + 9999, lastCryBucket: Math.floor(walkNow / T.CRY_BUCKET_MS) };
  assert.equal(render.motionDecide(cryingState, { ...sadInp, now: walkNow }).type, "none");
  // A happy kandy never cries even on the sad kandy's cry bucket.
  const happyAtCryBucket = render.motionDecide(idleState, { ...baseInp, now: cryNow });
  assert.notEqual(happyAtCryBucket.type, "start-cry");
});

test("tear anchors come from the real face geometry across archetypes", () => {
  const render = loadBundle().plugin.__render;
  const SCENE_CX = 124;
  const FLOOR_Y = 119;
  // Egg: no eyes, no tears.
  assert.equal(render.eyeAnchorsFor(sampleKandy({ level: 1 })).length, 0);
  // Blob (head centered): exactly two eyes, symmetric about scene center.
  const blobEyes = render.eyeAnchorsFor(sampleKandy({ archetype: 0, level: 12 }));
  assert.equal(blobEyes.length, 2);
  assert.ok(Math.abs(blobEyes[0].x + blobEyes[1].x - 2 * SCENE_CX) < 0.01, "symmetric pair");
  assert.equal(blobEyes[0].y, blobEyes[1].y);
  assert.ok(blobEyes[0].y > 0 && blobEyes[0].y < FLOOR_Y - 8, "eyes float above the ground");
  // Serpent: the raised head sits right of center — so do its eyes.
  const serpentEyes = render.eyeAnchorsFor(sampleKandy({ archetype: 3, level: 12 }));
  assert.equal(serpentEyes.length, 2);
  assert.ok((serpentEyes[0].x + serpentEyes[1].x) / 2 > SCENE_CX, "serpent eyes right of center");
  // Gazer: EVERY eye weeps — 3-5 of them, seed-derived.
  const counts = new Set();
  for (const seed of [99, 424242, 90210, 777001, 3061213989, 1234567]) {
    const eyes = render.eyeAnchorsFor(sampleKandy({ archetype: 8, level: 30, lineage_seed: seed }));
    assert.ok(eyes.length >= 3 && eyes.length <= 5, `gazer has 3-5 eyes (${eyes.length})`);
    counts.add(eyes.length);
  }
  assert.ok(counts.size >= 2, "gazer eye count varies with the lineage seed");
  // Below stage 2 the gazer still has its plain pair.
  assert.equal(render.eyeAnchorsFor(sampleKandy({ archetype: 8, level: 5 })).length, 2);
  // The live wander offset shifts every anchor by exactly that much.
  const shifted = render.eyeAnchorsFor(sampleKandy({ archetype: 0, level: 12 }), 27);
  for (let i = 0; i < blobEyes.length; i++) {
    assert.ok(Math.abs(shifted[i].x - blobEyes[i].x - 27) < 1e-9);
    assert.equal(shifted[i].y, blobEyes[i].y);
  }
  // Stage growth moves the eyes (the geometry is live, not a constant).
  const young = render.eyeAnchorsFor(sampleKandy({ archetype: 0, level: 2 }));
  assert.notEqual(young[0].y, blobEyes[0].y);
});

test("cryOverlay rains phase-offset tears from each eye into a capped puddle", () => {
  const render = loadBundle().plugin.__render;
  const data = sampleKandy({ archetype: 0, level: 12, mood: "sad" });
  const overlay = render.cryOverlay(jsx, 7, data, 10);
  assert.ok(overlay, "overlay renders");
  const tears = [];
  visit(overlay, (n) => {
    if (n.props && n.props.className === "kandev-kandy-tear") tears.push(n);
  });
  const eyes = render.eyeAnchorsFor(data, 10);
  assert.equal(tears.length, Math.min(eyes.length * 2, 8));
  const delays = new Set();
  for (const tear of tears) {
    const fall = parseFloat(tear.props.style["--tearfall"]);
    assert.ok(fall > 0, "tears fall a real distance");
    assert.ok(parseFloat(tear.props.style.animationDelay) <= 0, "phase offsets via negative delay");
    delays.add(tear.props.style.animationDelay);
  }
  assert.ok(delays.size >= 3, "the eyes don't weep in lockstep");
  // Tears anchor at the (wandered) eye positions.
  assert.equal(tears[0].props.style.left, eyes[0].x - 2 + "px");
  // The puddle grows for exactly the bout duration and is capped small.
  const puddle = findNode(overlay, (n) => n.props && n.props.className === "kandev-kandy-puddle");
  assert.ok(puddle, "puddle present");
  assert.equal(puddle.props.style.animationDuration, render.motionTuning.CRY_BOUT_MS + "ms");
  assert.ok(parseFloat(puddle.props.style.width) <= 60, "puddle stays small");
  // Gazer bout: more eyes, still capped at 8 droplets.
  const gazer = sampleKandy({ archetype: 8, level: 30, lineage_seed: 424242 });
  const gazerTears = [];
  visit(render.cryOverlay(jsx, 1, gazer, 0), (n) => {
    if (n.props && n.props.className === "kandev-kandy-tear") gazerTears.push(n);
  });
  const gazerEyes = render.eyeAnchorsFor(gazer, 0);
  assert.equal(gazerTears.length, Math.min(gazerEyes.length * 2, 8));
  assert.ok(gazerTears.length > 4, "a many-eyed gazer sheds more tears");
});

test("kandyCard motion wiring: wander layer, facing flip, gait class, tracked hit zone", () => {
  const render = loadBundle().plugin.__render;
  render.setJsx(jsx);
  const data = sampleKandy({ archetype: 0, mood: "content", scarred: false });
  const care = { onPet() {}, hint: true };
  const findWander = (card) =>
    findNode(card, (n) => n.props && n.props.className === "kandev-kandy-wander");

  // No motion param: no wander layer at all (legacy tree, separately
  // byte-checked by the legacy test).
  assert.equal(findWander(render.kandyCard(jsx, data, null, care, 13)), null);

  // Neutral motion: the layer exists at translateX(0), facing untouched.
  const idle = render.kandyCard(jsx, data, null, care, 13, undefined, null, {
    x: 0, facing: 1, walking: false, cry: 0,
  });
  const idleWander = findWander(idle);
  assert.equal(idleWander.props.style.transform, "translateX(0px)");
  // The pet-zone BUTTON rides inside the wander layer: the hit target
  // tracks the creature wherever it strolls.
  assert.ok(
    findNode(idleWander, (n) => n.type === "button" && n.props.id === "kandev-kandy-pet-zone"),
    "pet zone lives inside the wander layer",
  );
  // Idle keeps today's mood-tempo bob and wiggle exactly.
  const idleZone = findNode(idle, (n) => n.type === "button");
  assert.match(idleZone.props.className, /kandev-kandy-wiggle/);
  assert.ok(findNode(idle, (n) => n.props && /kandev-kandy-bob/.test(n.props.className || "")));

  // Mid-stroll heading left: offset applied, facing flipped, gait class on
  // its own wrapper, wiggle yielded, grounded bob suppressed.
  const walking = render.kandyCard(jsx, data, null, care, 13, undefined, null, {
    x: -22, facing: -1, walking: true, cry: 0,
  });
  const wander = findWander(walking);
  assert.equal(wander.props.style.transform, "translateX(-22px)");
  const facing = findNode(wander, (n) => n.props && n.props.style && n.props.style.transform === "scaleX(-1)");
  assert.ok(facing, "facing flip on its own wrapper");
  assert.ok(
    findNode(wander, (n) => n.props && n.props.className === "kandev-kandy-gait-waddle"),
    "blob waddles",
  );
  const walkZone = findNode(walking, (n) => n.type === "button");
  assert.doesNotMatch(walkZone.props.className || "", /wiggle/);
  assert.equal(
    findNode(walking, (n) => n.props && /kandev-kandy-bob(\s|$|-)/.test(n.props.className || "")),
    null,
    "grounded gait suppresses the idle bob",
  );

  // A floaty gazer keeps its bob while gliding.
  const gazer = render.kandyCard(
    jsx,
    sampleKandy({ archetype: 8, level: 30, mood: "content", scarred: false }),
    null, care, 13, undefined, null,
    { x: 10, facing: 1, walking: true, cry: 0 },
  );
  assert.ok(
    findNode(gazer, (n) => n.props && n.props.className === "kandev-kandy-gait-glide"),
    "gazer glides",
  );
  assert.ok(
    findNode(gazer, (n) => n.props && /kandev-kandy-bob/.test(n.props.className || "")),
    "floaty glide keeps the bob",
  );

  // EVERY anchor consumer takes the live offset: treat, bubble, tears.
  const at = (m, c, s) => render.kandyCard(jsx, data, null, c, 13, undefined, s || null, m);
  const centered = at({ x: 0, facing: 1, walking: false, cry: 0 }, { onPet() {}, fx: 1 });
  const wandered = at({ x: 30, facing: 1, walking: false, cry: 0 }, { onPet() {}, fx: 1 });
  const treatLeft = (card) =>
    parseFloat(findNode(card, (n) => n.props && /kandev-kandy-treat/.test(n.props.className || "")).props.style.left);
  assert.equal(treatLeft(wandered) - treatLeft(centered), 30, "treat falls onto the wandered spot");
  const line = { id: "neu-g1", text: "so we just level forever? cool. cool cool.", seq: 1 };
  const bubbleAt = (x) =>
    findNode(at({ x, facing: 1, walking: false, cry: 0 }, null, line), (n) => n.props && n.props.className === "kandev-kandy-bubble");
  // A wander right of center flips the bubble to right-anchoring; both
  // sides track the wandered contact point exactly.
  const cRight = render.bonkContactFor(data, 30);
  assert.equal(parseFloat(bubbleAt(30).props.style.right), 248 - cRight.x - 26);
  const cLeft = render.bonkContactFor(data, -30);
  assert.equal(parseFloat(bubbleAt(-30).props.style.left), cLeft.x - 26);
});

test("kandyCard cry wiring: sob + tears only when stationary, awake, undisturbed", () => {
  const render = loadBundle().plugin.__render;
  render.setJsx(jsx);
  const sad = sampleKandy({ archetype: 0, mood: "sad", scarred: false });
  const care = { onPet() {}, hint: true };
  const cryMotion = { x: 0, facing: 1, walking: false, cry: 99 };
  const hasTears = (card) =>
    !!findNode(card, (n) => n.props && n.props.className === "kandev-kandy-tear");

  const crying = render.kandyCard(jsx, sad, null, care, 13, undefined, null, cryMotion);
  assert.ok(hasTears(crying), "bout renders tears");
  const zone = findNode(crying, (n) => n.type === "button");
  assert.match(zone.props.className, /kandev-kandy-sob/, "sob-shudder on the safe wrapper");
  // The static sad-face teardrop stays (compose, don't replace).
  assert.ok(findNode(crying, (n) => n.props && n.props.fill === "#7fd7ff" && n.type === "ellipse"));

  // Never while asleep (23.8 is past every bedtime), during celebrations,
  // or during care reactions.
  assert.equal(hasTears(render.kandyCard(jsx, sad, null, care, 23.8, undefined, null, cryMotion)), false);
  assert.equal(
    hasTears(render.kandyCard(jsx, sad, { kind: "gain" }, care, 13, undefined, null, cryMotion)),
    false,
  );
  assert.equal(
    hasTears(render.kandyCard(jsx, sad, null, { onPet() {}, fx: 1 }, 13, undefined, null, cryMotion)),
    false,
  );
  assert.equal(
    hasTears(render.kandyCard(jsx, sad, null, { onPet() {}, bonkFx: 1 }, 13, undefined, null, cryMotion)),
    false,
  );
  // No bout, no tears.
  assert.equal(
    hasTears(render.kandyCard(jsx, sad, null, care, 13, undefined, null, { x: 0, facing: 1, walking: false, cry: 0 })),
    false,
  );
});

test("v0.8.0 motion respects reduced motion in CSS (gaits, sob, tears silenced)", () => {
  const runtime = loadBundle();
  runtime.plugin.initialize(
    { registerComponent() {}, registerWsHandler() {} },
    { React: {}, jsx, ui: {} },
  );
  const css = runtime.document.head.children[0].textContent;
  assert.match(css, /@keyframes kandev-kandy-gaitwaddle/);
  assert.match(css, /@keyframes kandev-kandy-tearfall/);
  assert.match(css, /@keyframes kandev-kandy-sob/);
  // sob must be declared AFTER wiggle so its shorthand wins when both
  // classes share the inner wrapper during a bout.
  assert.ok(
    css.indexOf(".kandev-kandy-sob{animation") > css.indexOf(".kandev-kandy-wiggle{animation"),
    "sob declared after wiggle",
  );
  // Tears/puddle hide entirely without their animation (base opacity 0).
  assert.match(css, /kandev-kandy-tear\{position:absolute;opacity:0/);
  assert.match(css, /kandev-kandy-puddle\{position:absolute;opacity:0/);
  const reduced = css.slice(css.indexOf("(prefers-reduced-motion: reduce)"));
  for (const cls of [
    "sob", "tear", "puddle",
    "gait-waddle", "gait-stride", "gait-slither", "gait-shuffle", "gait-hopskip", "gait-glide",
  ]) {
    assert.ok(reduced.includes(`.kandev-kandy-${cls}`), `${cls} silenced under reduced motion`);
  }
  assert.ok(reduced.includes(".kandev-kandy-gait-drift{transform:none}"), "drift lean flattened");
  runtime.plugin.destroy();
});

test("facing flips mirror the contact point and eye anchors (asymmetric bodies)", () => {
  const render = loadBundle().plugin.__render;
  render.setJsx(jsx);
  const serpent = sampleKandy({ archetype: 3, mood: "content", scarred: false });
  const c = render.bonkContactFor(serpent);
  const flipped = render.bonkContactFor(serpent, 0, true);
  // Mirror about the creature center (scene center + wanderX).
  assert.ok(Math.abs(flipped.x - (2 * 124 - c.x)) < 1e-9);
  assert.equal(flipped.y, c.y);
  assert.notEqual(flipped.x, c.x, "the serpent's head is genuinely asymmetric");
  const cWander = render.bonkContactFor(serpent, -26, true);
  assert.ok(Math.abs(cWander.x - (2 * (124 - 26) - render.bonkContactFor(serpent, -26).x)) < 1e-9);
  // Eye anchors mirror the same way.
  const eyes = render.eyeAnchorsFor(serpent, 0, false);
  const eyesFlipped = render.eyeAnchorsFor(serpent, 0, true);
  for (let i = 0; i < eyes.length; i++) {
    assert.ok(Math.abs(eyesFlipped[i].x - (2 * 124 - eyes[i].x)) < 1e-9);
    assert.equal(eyesFlipped[i].y, eyes[i].y);
  }
  // Symmetric bodies (blob) are unaffected by the flip.
  const blob = sampleKandy({ archetype: 0, mood: "content", scarred: false });
  assert.ok(Math.abs(render.bonkContactFor(blob, 0, true).x - render.bonkContactFor(blob).x) < 1e-9);
  // kandyCard threads the mirror: a left-facing serpent's bonk pour lands
  // on the mirrored head.
  const card = render.kandyCard(jsx, serpent, null, { onPet() {}, bonkFx: 1 }, 13, undefined, null, {
    x: -26, facing: -1, walking: false, cry: 0,
  });
  const pour = findNode(card, (n) => n.props && n.props.className === "kandev-kandy-pour");
  const expected = render.bonkContactFor(serpent, -26, true);
  assert.equal(parseFloat(pour.props.style.left), expected.x - 2.5);
});

// ---------------------------------------------------------------------------
// Counterfeit mark (v0.9.0) — the permanent stitched patch and speech spice
// a tamper-detected rebirth carries forever.
// ---------------------------------------------------------------------------

const findPatch = (root) => findNode(root, (n) => n.props && n.props.key === "cftpatch");

test("counterfeit kandys wear the stitched patch at every level, portrait included", () => {
  const render = loadBundle().plugin.__render;
  const marked = sampleKandy({ counterfeit: true, scarred: false });

  // Grown body: patch in the ordinary card render AND the chip portrait.
  const grown = render.creatureParts(jsx, marked);
  const patch = findPatch(grown);
  assert.ok(patch, "patch renders on the body");
  assert.ok(findPatch(render.creatureParts(jsx, marked, true)), "patch in the chip portrait");

  // The patch is fabric with cross-stitches, distinct from the scar line.
  const fabric = findNode(patch, (n) => n.type === "rect" && n.props.key === "cftfabric");
  assert.ok(fabric, "off-color fabric square");
  assert.ok(fabric.props.strokeDasharray, "sewn-on dashed border");
  let stitches = 0;
  visit(patch, (n) => {
    if (n.type === "line") stitches++;
  });
  assert.equal(stitches, 8, "four cross-stitch x marks");

  // The counterfeit EGG is patched too — a rebirth is visibly marked from
  // day one, in card and portrait mode.
  const egg = sampleKandy({ level: 1, counterfeit: true, scarred: false });
  assert.ok(findPatch(render.creatureParts(jsx, egg)), "patched egg");
  assert.ok(findPatch(render.creatureParts(jsx, egg, true)), "patched egg portrait");

  // An honest kandy (and an honest egg) never shows one.
  assert.equal(findPatch(render.creatureParts(jsx, sampleKandy({ counterfeit: false }))), null);
  assert.equal(
    findPatch(render.creatureParts(jsx, sampleKandy({ level: 1, counterfeit: false }))),
    null,
  );
});

test("counterfeit patch placement is deterministic from the lineage seed", () => {
  const render = loadBundle().plugin.__render;
  const marked = sampleKandy({ counterfeit: true, scarred: false });
  const a = findPatch(render.creatureParts(jsx, marked));
  const b = findPatch(render.creatureParts(jsx, marked));
  assert.equal(JSON.stringify(a), JSON.stringify(b), "same lineage, same patch");
  const other = findPatch(
    render.creatureParts(jsx, sampleKandy({ counterfeit: true, scarred: false, lineage_seed: 5150 })),
  );
  assert.notEqual(a.props.transform, other.props.transform, "different lineage, different placement");
  // Patch and scar coexist without sharing geometry (different rand salt).
  const both = render.creatureParts(jsx, sampleKandy({ counterfeit: true, scarred: true }));
  assert.ok(findPatch(both));
  assert.ok(findNode(both, (n) => n.props && n.props.key === "scar"), "scar still renders");
});

test("photo booth model and portrait carry the counterfeit mark", () => {
  const render = loadBundle().plugin.__render;
  render.setJsx(jsx);
  const model = render.photoModelFor(sampleKandy({ counterfeit: true, scarred: false }), 13);
  assert.equal(model.counterfeit, true);
  const portrait = render.photoPortraitSvg(jsx, model, "light", { current: null });
  assert.ok(findPatch(portrait), "patch appears in the shareable portrait");
  const honest = render.photoModelFor(sampleKandy({ counterfeit: false }), 13);
  assert.equal(honest.counterfeit, false);
  assert.equal(findPatch(render.photoPortraitSvg(jsx, honest, "light", { current: null })), null);
});

test("counterfeit speech spice mixes in at ~15%, deterministically", () => {
  const render = loadBundle().plugin.__render;
  const at = (data, ctx) => render.pickSpeech(data, ctx);
  const marked = { temperament_band: "content", mood: "content", counterfeit: true, lineage_seed: 3 };

  const resolved = render.speechPoolFor(marked, { timeOfDay: 13 });
  const size =
    resolved.pool.length +
    render.speechBagExtras(marked, resolved, render.speechSliceSeed(3, resolved.slice), 0).length;
  let cftCount = 0;
  for (let p = 0; p < size; p++) {
    const line = at(marked, { timeOfDay: 13, bagPos: p });
    assert.deepEqual(line, at(marked, { timeOfDay: 13, bagPos: p }), "picks are deterministic");
    if (line.ctx === "counterfeit") cftCount++;
  }
  const frac = cftCount / size;
  assert.ok(frac > 0.1 && frac < 0.2, `counterfeit spice ${frac}`);

  // A counterfeit that is ALSO scarred speaks both dark pools.
  const both = { temperament_band: "wary", mood: "content", scarred: true, counterfeit: true, lineage_seed: 7 };
  const resolvedBoth = render.speechPoolFor(both, { timeOfDay: 13 });
  const sizeBoth =
    resolvedBoth.pool.length +
    render.speechBagExtras(both, resolvedBoth, render.speechSliceSeed(7, resolvedBoth.slice), 0).length;
  const ctxsSeen = new Set();
  for (let p = 0; p < sizeBoth; p++) ctxsSeen.add(at(both, { timeOfDay: 13, bagPos: p }).ctx);
  assert.ok(ctxsSeen.has("counterfeit"), "counterfeit lines present");
  assert.ok(ctxsSeen.has("scarred"), "scarred lines still present");

  // An honest kandy never draws a counterfeit line, storage or not.
  const honest = { temperament_band: "content", mood: "content", lineage_seed: 3 };
  for (let p = 0; p < 80; p++) {
    assert.notEqual(at(honest, { timeOfDay: 13, bagPos: p }).ctx, "counterfeit");
  }
  // Asleep, the marked kandy only sleep-talks — the mark stays quiet.
  const murmur = at(marked, { timeOfDay: 23.9, tick: 3, asleep: true });
  assert.equal(murmur.ctx, "sleep");
});

test("gaze: pupils track the pointer, scaled by how much it trusts you", () => {
  const render = loadBundle().plugin.__render;
  render.setJsx(jsx);
  // Amplitude is trust-shaped: a fearful kandy follows your hand hardest,
  // a beloved one only glances — the flavor text finally made literal.
  const amp = render.gazeAmpFor;
  assert.ok(amp("fearful") > amp("wary"), "fearful tracks harder than wary");
  assert.ok(amp("wary") > amp("neutral"), "wary tracks harder than neutral");
  assert.ok(amp("neutral") > amp("content"), "neutral tracks harder than content");
  assert.ok(amp("content") > amp("beloved"), "beloved only glances");
  assert.equal(amp("nonsense"), amp("neutral"), "unknown bands fall back to neutral");
  assert.ok(amp("fearful") <= 1 && amp("beloved") > 0, "amplitudes stay within (0,1]");

  // Every pupil opts into tracking and declares its own travel radius, so
  // each archetype and eye size — including a gazer's 3-5 eyes — moves in
  // proportion.
  const collectPupils = (card) => {
    const found = [];
    visit(card, (node) => {
      const cls = node.props && node.props.className;
      if (typeof cls === "string" && cls.indexOf("kandev-kandy-pupil") >= 0) found.push(node);
    });
    return found;
  };
  const gazer = render.kandyCard(jsx, sampleKandy({ archetype: 8, level: 40 }), null, null, 13);
  const pupils = collectPupils(gazer);
  assert.ok(pupils.length >= 2, `pupils render (${pupils.length})`);
  for (const p of pupils) {
    const gr = p.props.style && p.props.style["--kandy-gr"];
    assert.match(String(gr), /^[\d.]+px$/, "pupil declares its own travel radius");
  }

  // Closed eyes cannot follow anything: an asleep card renders no pupils.
  const asleep = render.kandyCard(jsx, sampleKandy({ archetype: 8, level: 40 }), null, null, 23.9);
  assert.equal(collectPupils(asleep).length, 0, "asleep: nothing to track with");
});
