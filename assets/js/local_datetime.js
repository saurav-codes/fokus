(function () {
  function getBrowserTimeZone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  function formatUtcDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value || "";
    }
    return date.toLocaleString(undefined, {
      timeZone: getBrowserTimeZone(),
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function localizeDateTimeElements(root) {
    const container = root || document;
    container.querySelectorAll("[data-utc-datetime]").forEach((element) => {
      const prefix = element.dataset.datetimePrefix || "";
      element.textContent = `${prefix}${formatUtcDateTime(element.dataset.utcDatetime)}`;
    });
  }

  window.FocusTimerDateTime = {
    getBrowserTimeZone,
    formatUtcDateTime,
    localizeDateTimeElements,
  };

  document.addEventListener("DOMContentLoaded", () => {
    localizeDateTimeElements(document);
  });

  document.addEventListener("htmx:afterSettle", (event) => {
    localizeDateTimeElements(event.target);
  });
})();
