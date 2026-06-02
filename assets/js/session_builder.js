(function () {
  function getCycleTable() {
    return document.getElementById("focus_cycles_table");
  }

  function getCycleRows(table) {
    return Array.from((table || getCycleTable())?.querySelectorAll(".cycle-item") || []);
  }

  function normalizeCycleRow(row) {
    const select = row.querySelector('select[name="focus_cycle_type"]');
    const type = select?.value || "FOCUS";
    row.dataset.cycleType = type.toLowerCase();
  }

  function nextCycleTypeAfter(row) {
    const select = row.querySelector('select[name="focus_cycle_type"]');
    return select?.value === "FOCUS" ? "BREAK" : "FOCUS";
  }

  function defaultDurationFor(type) {
    return type === "BREAK" ? 5 : 25;
  }

  function createCycleRow(type, duration) {
    const row = document.createElement("div");
    row.className = "cycle-item";
    row.dataset.cycleType = type.toLowerCase();
    row.innerHTML = `
      <button class="handle" type="button" title="Drag cycle" aria-label="Drag cycle">
        <i class="fa-solid fa-grip-vertical" aria-hidden="true"></i>
      </button>
      <select name="focus_cycle_type">
        <option value="FOCUS">Focus</option>
        <option value="BREAK">Break</option>
      </select>
      <input type="number" max="600" min="1" name="focus_cycle_duration" value="${duration}">
      <span class="cycle-item__unit">minutes</span>
      <div class="cycle-controls">
        <button title="Add Cycle below this one"
                type="button"
                class="cycle-action add-cycle"
                data-cycle-action="add"
                aria-label="Add cycle below this one">
          <i class="fa-solid fa-plus" aria-hidden="true"></i>
        </button>
        <button title="Delete this Cycle"
                type="button"
                class="cycle-action cycle-action--delete delete-cycle"
                data-cycle-action="delete"
                aria-label="Delete this cycle">
          <i class="fa-solid fa-minus" aria-hidden="true"></i>
        </button>
      </div>
    `;
    row.querySelector('select[name="focus_cycle_type"]').value = type;
    return row;
  }

  function readCycle(row) {
    const type = row.querySelector('select[name="focus_cycle_type"]')?.value || "FOCUS";
    const durationInput = row.querySelector('input[name="focus_cycle_duration"]');
    const duration = Math.max(1, Math.min(600, Number.parseInt(durationInput?.value || "1", 10) || 1));
    if (durationInput) {
      durationInput.value = duration.toString();
    }
    return { type, duration };
  }

  function updateCycleSummary(table) {
    const rows = getCycleRows(table);
    const cycles = rows.map(readCycle);
    const totalMinutesValue = cycles.reduce((sum, cycle) => sum + cycle.duration, 0);
    const totalCycles = document.getElementById("total_cycles");
    const totalMinutes = document.getElementById("total_minutes_distributed");
    if (totalCycles) {
      totalCycles.textContent = rows.length.toString();
    }
    if (totalMinutes) {
      totalMinutes.textContent = totalMinutesValue.toString();
    }
    updateFinishTime(table, totalMinutesValue);
    updatePatternPreview(cycles);
  }

  function updateFinishTime(table, totalMinutes) {
    const container = table?.closest(".cycle-workbench") || document;
    const finishTime = container.querySelector("[data-cycle-finish-time]");
    if (!finishTime) {
      return;
    }
    finishTime.dataset.utcDatetime = new Date(Date.now() + totalMinutes * 60 * 1000).toISOString();
    if (window.FocusTimerDateTime?.formatUtcDateTime) {
      finishTime.textContent = window.FocusTimerDateTime.formatUtcDateTime(finishTime.dataset.utcDatetime);
    }
  }

  function updatePatternPreview(cycles) {
    const preview = document.getElementById("pattern-preview-list");
    if (!preview || !cycles.length) {
      return;
    }
    const maxDuration = Math.max(...cycles.map((cycle) => cycle.duration), 1);
    preview.innerHTML = "";
    cycles.forEach((cycle) => {
      const row = document.createElement("div");
      row.className = "focus-map__row";
      row.dataset.cycleType = cycle.type.toLowerCase();
      row.innerHTML = `
        <span>${cycle.type}</span>
        <span class="focus-map__bar">
          <span style="width: ${Math.max(5, Math.round((cycle.duration / maxDuration) * 100))}%;"></span>
        </span>
        <span class="focus-map__duration">${cycle.duration} min</span>
      `;
      preview.appendChild(row);
    });
  }

  function initSortable(root) {
    const table = (root || document).querySelector?.("#focus_cycles_table");
    if (!table || table.dataset.sortableReady || !window.Sortable) {
      return;
    }
    window.Sortable.create(table, {
      animation: 150,
      ghostClass: "blue-background-class",
      handle: ".handle",
      onEnd: () => updateCycleSummary(table),
    });
    table.dataset.sortableReady = "true";
  }

  function initBuilder(root) {
    const table = (root || document).querySelector?.("#focus_cycles_table");
    if (!table) {
      return;
    }
    getCycleRows(table).forEach(normalizeCycleRow);
    initSortable(root || document);
    updateCycleSummary(table);
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cycle-action]");
    if (!button) {
      return;
    }
    const row = button.closest(".cycle-item");
    const table = row?.closest("#focus_cycles_table");
    if (!row || !table) {
      return;
    }
    const action = button.dataset.cycleAction;
    if (action === "add") {
      const type = nextCycleTypeAfter(row);
      row.insertAdjacentElement("afterend", createCycleRow(type, defaultDurationFor(type)));
    }
    if (action === "delete" && getCycleRows(table).length > 1) {
      row.remove();
    }
    updateCycleSummary(table);
  });

  document.addEventListener("change", (event) => {
    if (!event.target.matches('select[name="focus_cycle_type"]')) {
      return;
    }
    const row = event.target.closest(".cycle-item");
    normalizeCycleRow(row);
    updateCycleSummary(row.closest("#focus_cycles_table"));
  });

  document.addEventListener("input", (event) => {
    if (event.target.matches('input[name="focus_cycle_duration"]')) {
      updateCycleSummary(event.target.closest("#focus_cycles_table"));
    }
  });

  document.addEventListener("DOMContentLoaded", () => initBuilder(document));
  document.body.addEventListener("htmx:afterSwap", () => initBuilder(document));
})();
