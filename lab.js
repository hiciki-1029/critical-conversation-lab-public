"use strict";

const scenes = [
  {
    title: "交付延期",
    context: "你和同事约好的初稿晚了两天。你想弄清原因，也需要重新确定交付时间。",
    opening: "抱歉，我知道你在等。前几天临时来了别的事，我还没整理完。",
    replies: ["你希望我先把已有的内容发你，还是等我整理成一份？", "我今天能整理完第一部分，剩下的要明天下午。"],
  },
  {
    title: "当面给反馈",
    context: "会议上，你的一位搭档几次打断别人。你想聊清楚影响，也想听听对方的感受。",
    opening: "你说刚才的会吗？我当时是怕话题越聊越远。",
    replies: ["我当时有点着急。你觉得我的哪个反应影响最大？", "下次我可以先记下来，等对方讲完再提。你觉得这样行吗？"],
  },
  {
    title: "回应临时加活",
    context: "搭档希望你今天再接一项工作，你手里的任务也有明确期限。",
    opening: "这件事今天必须有人接，你能不能帮我先扛一下？",
    replies: ["我最需要的是一份能先讨论的草稿。你手头的事大概什么时候能做完？", "那我们先确认哪一项今天一定得完成，我也去问问有没有别的人能分担。"],
  },
];

const storageKey = "ciki-conversation-lab.action.v1";
const maxTurns = 8;
const get = (id) => document.getElementById(id);
let session;
let ai = false;
let pending = false;
let savedAction = "";
try { savedAction = localStorage.getItem(storageKey) || ""; } catch {}

function notice(message = "") {
  get("notice").textContent = message;
  get("notice").hidden = !message;
}

function show(stage, focus) {
  for (const name of ["prepare", "practice", "review"]) get(name).hidden = name !== stage;
  document.querySelectorAll(".steps li").forEach((step, index) => {
    if (["prepare", "practice", "review"][index] === stage) step.setAttribute("aria-current", "step");
    else step.removeAttribute("aria-current");
  });
  notice();
  get(focus)?.focus();
}

function displaySavedAction() {
  get("previous").hidden = !savedAction;
  get("previous").textContent = savedAction ? "上次选的动作 · " + savedAction : "";
  get("clear").hidden = !savedAction;
}

function saveAction(action) {
  try {
    if (action) localStorage.setItem(storageKey, action);
    else localStorage.removeItem(storageKey);
  } catch {
    notice("当前浏览器无法保存动作。");
    return false;
  }
  savedAction = action;
  displaySavedAction();
  return true;
}

function makeSceneOptions() {
  scenes.forEach((scene, index) => {
    const label = document.createElement("label");
    label.className = "scenario";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "scene";
    radio.value = String(index);
    radio.checked = index === 0;
    const text = document.createElement("span");
    text.textContent = scene.title;
    const context = document.createElement("small");
    context.textContent = scene.context;
    text.append(context);
    label.append(radio, text);
    get("scenarios").append(label);
  });
}

function appendMessage(role, content) {
  session.messages.push({ role, content });
  const message = document.createElement("p");
  message.className = role === "user" ? "message mine" : "message";
  const speaker = document.createElement("strong");
  speaker.textContent = role === "user" ? "你" : "练习对象";
  message.append(speaker, document.createTextNode(content));
  get("messages").append(message);
}

function lock(locked) {
  pending = locked;
  const turns = session.messages.filter((entry) => entry.role === "user").length;
  get("send").disabled = locked || turns >= maxTurns;
  get("reply").disabled = locked || turns >= maxTurns;
  get("finish").disabled = locked || turns === 0;
  get("cancel").disabled = locked;
  get("reply-form").setAttribute("aria-busy", String(locked));
}

async function model(operation, messages) {
  const response = await fetch("api/" + operation, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scene: session.scene.context, goal: session.goal, messages }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error("Model unavailable");
  return response.json();
}

function demoFeedback(quote) {
  const isQuestion = /[？?]|能不能|怎么样|怎么想/.test(quote);
  return {
    feedback: isQuestion
      ? "这句给了对方回答的空间。回想一下，对方能从你的提问里知道你想了解哪一件事吗？"
      : "回看这句，你已经说出了自己的想法。试试在这句之后停一下，问对方怎么看这件事。",
    action: isQuestion ? "提问后停一下，再用一句话确认我听到了什么。" : "说完我的观察后，问一句对方怎么看。",
  };
}

function returnToPrepare() {
  session = undefined;
  get("mode").textContent = ai ? "AI 演练" : "离线演练";
  get("reply").value = "";
  show("prepare", "goal");
}

get("prepare-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const goal = get("goal").value.trim();
  if (!goal) return notice("先写一个你想练的具体目标。");
  const index = Number(new FormData(event.currentTarget).get("scene"));
  session = { scene: scenes[index], goal, messages: [], ai };
  get("mode").textContent = session.ai ? "AI 演练" : "离线演练";
  get("scene-title").textContent = session.scene.title;
  get("practice-goal").textContent = "本次目标 · " + goal;
  get("messages").replaceChildren();
  appendMessage("assistant", session.scene.opening);
  lock(false);
  show("practice", "scene-title");
});

get("reply-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const content = get("reply").value.trim();
  if (!content || pending || get("send").disabled) return;
  const turns = session.messages.filter((entry) => entry.role === "user").length;
  let reply = session.scene.replies[turns % session.scene.replies.length];
  notice();
  lock(true);
  try {
    if (session.ai) {
      const data = await model("reply", [...session.messages, { role: "user", content }]);
      reply = data.reply;
    }
    appendMessage("user", content);
    appendMessage("assistant", reply);
    get("reply").value = "";
  } catch {
    notice("模型暂时不可用。输入已保留，可以再试一次。");
  } finally {
    lock(false);
    (get("reply").disabled ? get("finish") : get("reply")).focus();
  }
});

get("finish").addEventListener("click", async () => {
  if (pending) return;
  const userMessages = session.messages.filter((entry) => entry.role === "user");
  let quote = userMessages.at(-1).content;
  let result = demoFeedback(quote);
  let fallback = false;
  lock(true);
  if (session.ai) {
    try {
      const data = await model("review", session.messages);
      if (!Number.isInteger(data.turn) || !userMessages[data.turn - 1]) throw new Error("Invalid turn");
      quote = userMessages[data.turn - 1].content;
      result = data;
    } catch { fallback = true; }
  }
  get("review-goal").textContent = "本次目标 · " + session.goal;
  get("evidence").textContent = "「" + quote + "」";
  get("feedback").textContent = result.feedback;
  get("next-action").value = result.action;
  lock(false);
  show("review", "review-title");
  if (fallback) notice("模型复盘暂时不可用，当前展示离线复盘。");
});

get("cancel").addEventListener("click", returnToPrepare);
get("skip").addEventListener("click", returnToPrepare);
get("clear").addEventListener("click", () => saveAction(""));
get("action-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const action = get("next-action").value.trim();
  if (!action) return notice("请写下一个你愿意尝试的动作。");
  if (saveAction(action)) returnToPrepare();
});

async function detectModel() {
  if (!["localhost", "127.0.0.1"].includes(location.hostname)) return;
  try {
    const response = await fetch("api/status", { signal: AbortSignal.timeout(2000) });
    const status = response.ok ? await response.json() : {};
    if (status.ai !== true) return;
    ai = true;
    if (!session) get("mode").textContent = "AI 演练";
    document.querySelector("#prepare .intro").textContent =
      "挑一个场景，带着一个具体目标开始。AI 模式会把场景、目标和练习对话发送给配置的模型服务。请使用虚构信息。";
  } catch {}
}

makeSceneOptions();
displaySavedAction();
detectModel();
