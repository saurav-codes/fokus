var fakeIdToId = {};

onmessage = function (event) {
  var data = event.data;
  var name = data.name;
  var fakeId = data.fakeId;
  var time;

  if (Object.prototype.hasOwnProperty.call(data, "time")) {
    time = data.time;
  }

  switch (name) {
    case "setInterval":
      fakeIdToId[fakeId] = setInterval(function () {
        postMessage({ fakeId: fakeId });
      }, time);
      break;
    case "clearInterval":
      if (Object.prototype.hasOwnProperty.call(fakeIdToId, fakeId)) {
        clearInterval(fakeIdToId[fakeId]);
        delete fakeIdToId[fakeId];
      }
      break;
    case "setTimeout":
      fakeIdToId[fakeId] = setTimeout(function () {
        postMessage({ fakeId: fakeId });
        if (Object.prototype.hasOwnProperty.call(fakeIdToId, fakeId)) {
          delete fakeIdToId[fakeId];
        }
      }, time);
      break;
    case "clearTimeout":
      if (Object.prototype.hasOwnProperty.call(fakeIdToId, fakeId)) {
        clearTimeout(fakeIdToId[fakeId]);
        delete fakeIdToId[fakeId];
      }
      break;
  }
};
