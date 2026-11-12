const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

class Element {
  constructor() {
    this.listeners = {};
    this.children = [];
    this.value = "";
    this.attributes = {};
  }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren() { this.children = []; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  focus() {}
  trigger(type) { return this.listeners[type]({ preventDefault() {}, currentTarget: this }); }
}

function boot(storage) {
  const elements = new Map();
  const steps = [new Element(), new Element(), new Element()];
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../lab.js"), "utf8"), {
    document: {
      getElementById: get,
      createElement: () => new Element(),
      createTextNode: (text) => text,
      querySelectorAll: () => steps,
    },
    localStorage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    location: { hostname: "example.test" },
    FormData: class { get() { return "1"; } },
    fetch: () => assert.fail("The public demo must stay offline"),
  });
  return get;
}

test("offline rehearsal quotes the actual reply and carries the chosen action forward", async () => {
  const storage = new Map();
  const get = boot(storage);
  assert.equal(get("scenarios").children.length, 3);
  get("goal").value = "先听对方怎么想";
  get("prepare-form").trigger("submit");
  assert.equal(get("practice").hidden, false);
  assert.equal(get("scene-title").textContent, "当面给反馈");
  assert.equal(get("finish").disabled, true);
  get("reply").value = "你当时是怎么想的？";
  await get("reply-form").trigger("submit");
  assert.equal(get("messages").children.length, 3);
  await get("finish").trigger("click");
  assert.equal(get("evidence").textContent, "「你当时是怎么想的？」");
  get("next-action").value = "先问一个问题，再等对方答完";
  get("action-form").trigger("submit");
  assert.equal(get("prepare").hidden, false);
  assert.deepEqual([...storage.values()], ["先问一个问题，再等对方答完"]);
  const reopened = boot(storage);
  assert.match(reopened("previous").textContent, /先问一个问题/);
  reopened("clear").trigger("click");
  assert.equal(reopened("previous").hidden, true);
  assert.equal(storage.size, 0);
});
