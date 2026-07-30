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

test("clipboard failures distinguish insecure, blocked, and unsupported contexts", () => {
  const render = loadBundle().plugin.__render;

  assert.equal(render.photoCopyFailureStatus(new Error("failed"), { isSecureContext: false }), "insecure");
  assert.equal(
    render.photoCopyFailureStatus({ name: "NotAllowedError" }, { isSecureContext: true }),
    "blocked",
  );
  assert.equal(
    render.photoCopyFailureStatus({ name: "NotSupportedError" }, { isSecureContext: true }),
    "unsupported",
  );
  assert.equal(render.photoCopyFailureStatus(new Error("failed"), { isSecureContext: true }), "error");
});

test("widget includes accessible dialog Photo Booth entry while hover card stays action-free", () => {
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
  const tooltipButton = findNode(
    tooltip,
    (node) => node.type === "button" && node.props["aria-label"] === "Open Kandy Photo Booth",
  );

  assert.ok(dialogEntry, "dialog positions Photo Booth at the top right");
  assert.ok(dialogButton, "dialog exposes the picture control");
  assert.equal(tooltipButton, null, "hover preview remains unchanged");

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
