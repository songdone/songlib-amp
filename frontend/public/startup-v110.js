(function () {
  var release = "1.1.0";
  var recoveryKey = "songlib-startup-recovery-" + release;
  var timer = null;

  function appStarted() {
    return document.documentElement.dataset.songlibStarted === release;
  }

  function clearOwnedCaches() {
    var jobs = [];
    if ("caches" in window) {
      jobs.push(
        caches.keys().then(function (keys) {
          return Promise.all(
            keys
              .filter(function (key) { return key.indexOf("songlib-amp-") === 0; })
              .map(function (key) { return caches.delete(key); }),
          );
        }),
      );
    }
    if ("serviceWorker" in navigator) {
      jobs.push(
        navigator.serviceWorker.getRegistrations().then(function (registrations) {
          return Promise.all(
            registrations.map(function (registration) {
              return registration.unregister();
            }),
          );
        }),
      );
    }
    return Promise.allSettled(jobs);
  }

  function reloadFresh() {
    clearOwnedCaches().finally(function () {
      var url = new URL(window.location.href);
      url.searchParams.set("startup-recovery", release);
      window.location.replace(url.toString());
    });
  }

  function showRecovery() {
    if (appStarted()) return;
    var root = document.getElementById("root");
    if (!root) return;
    root.innerHTML =
      '<main class="startup-recovery" role="alert">' +
      '<strong>SongLib Amp 暂时未能启动</strong>' +
      '<p>浏览器仍在使用旧版启动资源，或脚本加载被中断。</p>' +
      '<button type="button">清理本应用缓存并重新连接</button>' +
      '<small>不会删除账号、音乐、歌词或 NAS 数据</small>' +
      "</main>";
    root.querySelector("button").addEventListener("click", reloadFresh);
  }

  function recoverOnce() {
    if (appStarted()) return;
    if (sessionStorage.getItem(recoveryKey) !== "1") {
      sessionStorage.setItem(recoveryKey, "1");
      reloadFresh();
      return;
    }
    showRecovery();
  }

  window.addEventListener(
    "error",
    function (event) {
      var target = event.target;
      if (target && target.tagName === "SCRIPT") {
        window.setTimeout(recoverOnce, 250);
      }
    },
    true,
  );
  timer = window.setTimeout(recoverOnce, 12000);
  window.addEventListener("songlib:started", function () {
    if (timer) window.clearTimeout(timer);
    sessionStorage.removeItem(recoveryKey);
  }, { once: true });
})();
