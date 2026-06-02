(function (workerScript) {
  if (!/MSIE 10/i.test(navigator.userAgent)) {
    try {
      var blob = new Blob([
        "var fakeIdToId = {};" +
          "onmessage = function (event) {" +
          "var data = event.data," +
          "name = data.name," +
          "fakeId = data.fakeId," +
          "time;" +
          "if(data.hasOwnProperty('time')) {" +
          "time = data.time;" +
          "}" +
          "switch (name) {" +
          "case 'setInterval':" +
          "fakeIdToId[fakeId] = setInterval(function () {" +
          "postMessage({fakeId: fakeId});" +
          "}, time);" +
          "break;" +
          "case 'clearInterval':" +
          "if (fakeIdToId.hasOwnProperty(fakeId)) {" +
          "clearInterval(fakeIdToId[fakeId]);" +
          "delete fakeIdToId[fakeId];" +
          "}" +
          "break;" +
          "case 'setTimeout':" +
          "fakeIdToId[fakeId] = setTimeout(function () {" +
          "postMessage({fakeId: fakeId});" +
          "if (fakeIdToId.hasOwnProperty(fakeId)) {" +
          "delete fakeIdToId[fakeId];" +
          "}" +
          "}, time);" +
          "break;" +
          "case 'clearTimeout':" +
          "if (fakeIdToId.hasOwnProperty(fakeId)) {" +
          "clearTimeout(fakeIdToId[fakeId]);" +
          "delete fakeIdToId[fakeId];" +
          "}" +
          "break;" +
          "}" +
          "};",
      ]);
      workerScript = window.URL.createObjectURL(blob);
    } catch (error) {
      // Fall back to the static worker file when Blob workers are blocked.
    }
  }

  var worker;
  var fakeIdToCallback = {};
  var lastFakeId = 0;
  var maxFakeId = 0x7fffffff;
  var logPrefix = "HackTimer: ";

  if (typeof Worker !== "undefined") {
    function getFakeId() {
      do {
        if (lastFakeId === maxFakeId) {
          lastFakeId = 0;
        } else {
          lastFakeId += 1;
        }
      } while (Object.prototype.hasOwnProperty.call(fakeIdToCallback, lastFakeId));
      return lastFakeId;
    }

    try {
      worker = new Worker(workerScript);

      window.setInterval = function (callback, time) {
        var fakeId = getFakeId();
        fakeIdToCallback[fakeId] = {
          callback: callback,
          parameters: Array.prototype.slice.call(arguments, 2),
        };
        worker.postMessage({
          name: "setInterval",
          fakeId: fakeId,
          time: time,
        });
        return fakeId;
      };

      window.clearInterval = function (fakeId) {
        if (Object.prototype.hasOwnProperty.call(fakeIdToCallback, fakeId)) {
          delete fakeIdToCallback[fakeId];
          worker.postMessage({
            name: "clearInterval",
            fakeId: fakeId,
          });
        }
      };

      window.setTimeout = function (callback, time) {
        var fakeId = getFakeId();
        fakeIdToCallback[fakeId] = {
          callback: callback,
          parameters: Array.prototype.slice.call(arguments, 2),
          isTimeout: true,
        };
        worker.postMessage({
          name: "setTimeout",
          fakeId: fakeId,
          time: time,
        });
        return fakeId;
      };

      window.clearTimeout = function (fakeId) {
        if (Object.prototype.hasOwnProperty.call(fakeIdToCallback, fakeId)) {
          delete fakeIdToCallback[fakeId];
          worker.postMessage({
            name: "clearTimeout",
            fakeId: fakeId,
          });
        }
      };

      worker.onmessage = function (event) {
        var data = event.data;
        var fakeId = data.fakeId;
        var request;
        var parameters;
        var callback;

        if (Object.prototype.hasOwnProperty.call(fakeIdToCallback, fakeId)) {
          request = fakeIdToCallback[fakeId];
          callback = request.callback;
          parameters = request.parameters;

          if (Object.prototype.hasOwnProperty.call(request, "isTimeout") && request.isTimeout) {
            delete fakeIdToCallback[fakeId];
          }
        }

        if (typeof callback === "string") {
          try {
            callback = new Function(callback);
          } catch (error) {
            console.log(logPrefix + "error parsing callback string", error);
          }
        }

        if (typeof callback === "function") {
          callback.apply(window, parameters);
        }
      };

      worker.onerror = function (event) {
        console.log(logPrefix + "worker error", event);
      };
    } catch (error) {
      console.log(logPrefix + "initialization failed");
      console.error(error);
    }
  } else {
    console.log(logPrefix + "worker not supported");
  }
})(window.HACK_TIMER_WORKER_URL || "hack_timer_worker.js");
