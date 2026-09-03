/**
 * `beforeinstallprompt` 的捕获仓。
 *
 * 为什么需要它：Chrome/Edge 在页面加载后很快就发这个事件，而且**只发一次**。
 * 原来的监听器注册在 PwaInstallPrompt 的 useEffect 里，而那个组件只在
 * 登录之后才挂载 —— 等它挂上来，事件早就过去了，于是"Chrome/Edge 没装过
 * 也不弹窗"。manifest 一直是合规的，问题从头到尾是监听时机。
 *
 * 这个模块在 main.jsx 顶部被导入，副作用在 React 渲染之前就装好监听器。
 * 事件存下来，组件挂载后自己来取。
 */

let captured = null;
let installed = false;
const listeners = new Set();

const emit = () => {
  for (const listener of [...listeners]) listener();
};

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // 必须 preventDefault：否则 Chrome 用自己的迷你信息栏，
    // 我们后面就调不出 prompt() 了。
    event.preventDefault();
    captured = event;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    captured = null;
    emit();
  });
}

export const installPromptStore = {
  get event() {
    return captured;
  },
  get installed() {
    return installed;
  },
  /** 用掉这个事件。一个 beforeinstallprompt 只能 prompt() 一次。 */
  consume() {
    const event = captured;
    captured = null;
    emit();
    return event;
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
