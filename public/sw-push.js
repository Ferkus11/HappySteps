/* Happy Steps — Web Push handlers for the service worker.
 * Imported by the PWA worker (`importScripts('/sw-push.js')` in /sw.js); also works as a worker on its own.
 * Payload (lib/push.ts): { id, title, body, url, tag } — `url` goes through /notifications/<id>/open, which
 * marks the notification read and switches to its garden before opening the page.
 */
(function () {
  "use strict";

  var ICON = "/icons/icon-192.png";
  // Android shows the badge as a white silhouette in the status bar: a monochrome transparent mark.
  var BADGE = "/icons/badge-96.png";

  /** A same-origin app path only: no `//host`, no `/\\host` (browsers treat a backslash as a slash). Mirrors safeAppPath. */
  function safePath(url) {
    if (typeof url !== "string" || url.charAt(0) !== "/") return null;
    var second = url.charAt(1);
    return second === "/" || second === "\\" ? null : url;
  }
  self.hsSafePushPath = safePath;

  function parse(event) {
    if (!event.data) return null;
    try {
      return event.data.json();
    } catch (e) {
      try {
        return { title: event.data.text() };
      } catch (e2) {
        return null;
      }
    }
  }

  self.addEventListener("push", function (event) {
    var data = parse(event) || {};
    var title = typeof data.title === "string" && data.title ? data.title : "Happy Steps";
    var options = {
      body: typeof data.body === "string" ? data.body : "",
      icon: ICON,
      badge: BADGE,
      tag: typeof data.tag === "string" && data.tag ? data.tag : undefined,
      // A newer message of the same chat replaces the old one and still alerts.
      renotify: typeof data.tag === "string" && data.tag.indexOf("chat:") === 0,
      data: { url: safePath(data.url) || "/notifications", id: data.id || null },
    };
    event.waitUntil(self.registration.showNotification(title, options));
  });

  self.addEventListener("notificationclick", function (event) {
    event.notification.close();
    var path = (event.notification.data && event.notification.data.url) || "/notifications";
    var target = new URL(path, self.location.origin).href;
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
        for (var i = 0; i < list.length; i++) {
          var client = list[i];
          if (new URL(client.url).origin !== self.location.origin) continue;
          return client.focus().then(function (focused) {
            var w = focused || client;
            if (!w.navigate) return self.clients.openWindow(target);
            // navigate() fails for a window this worker does not control yet — open a new one then.
            return w.navigate(target).catch(function () {
              return self.clients.openWindow(target);
            });
          });
        }
        return self.clients.openWindow(target);
      }),
    );
  });
})();
