// static/js/focus_session.js
class FocusSessionManager {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.remainingTime = 0;
    this.timerInterval = null;
    this.originalTitle = document.title;
    this.lastSyncTime = Date.now();
    this.pendingActions = [];
    this.isConnecting = false;
    this.connectSocket();
  }

  // *****************************************
  // ********* WebSocket Handlers **********
  // *****************************************

  handleMessage(data) {
    if (data.type === "timer_update") {
      console.log("got timer update from server");
      this.display_updated_timer_data(data);
      // since we got this time from server
      // it is synced with server time
      // so we can update our last sync time
      this.lastSyncTime = Date.now();
    } else if (data.type === "followers_update") {
      this.update_session_followers_list(data);
    } else if (data.type === "will_finish_at_update") {
      this.update_will_finish_at_display(data);
    }
  }

  transitionToNextCycle() {
    console.log("transitioning to next cycle");
    this.send_action_to_server(
      { "action": "transition_to_next_cycle" }
    )
  }

  toggleTimer() {
    // since we are toggling the timer
    // this will send request to backend to toggle the timer
    // and backend will send updated timer details
    // so here we can't stop the client side timer
    this.stopClientSideTimer();
    this.send_action_to_server(
      { "action": "toggle_timer" }
    )
  }

  stopTimer() {
    this.stopClientSideTimer();
    this.send_action_to_server(
      { "action": "stop_timer" }
    )
  }

  sync_inactive_timer() {
    this.send_action_to_server(
      { "action": "sync_inactive_timer" }
    )
  }


  // *****************************************
  // ********** Helper Functions **********
  // *****************************************


  join_session() {
    const joinSessionButton = document.getElementById('join-session-button');
    if (joinSessionButton) {
      // delete the join session button
      // since we are already in the session
      joinSessionButton.remove();
    }
    this.send_action_to_server(
      { "action": "join_session"}
    )
  }

  send_action_to_server(event_type) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(event_type));
      return;
    }
    this.pendingActions.push(event_type);
    this.connectSocket();
  }

  connectSocket() {
    if (this.isConnecting || (this.socket && this.socket.readyState === WebSocket.OPEN)) {
      return;
    }
    this.isConnecting = true;
    const websocketProtocol = window.location.protocol === "https:" ? "wss" : "ws";
    this.socket = new WebSocket(
      `${websocketProtocol}://${window.location.host}/ws/focus_session/${this.sessionId}/`,
    );
    this.socket.onopen = () => {
      this.isConnecting = false;
      this.setConnectionState("connected");
      while (this.pendingActions.length && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify(this.pendingActions.shift()));
      }
    };
    this.socket.onmessage = (e) => this.handleMessage(JSON.parse(e.data));
    this.socket.onclose = () => {
      this.isConnecting = false;
      this.stopClientSideTimer();
      this.setConnectionState("disconnected");
    };
    this.socket.onerror = () => {
      this.setConnectionState("disconnected");
    };
  }

  display_updated_timer_data(data) {
    const timerDisplayData = data.timer_display_data;
    this.stopClientSideTimer(); // Clear any existing interval
    this.resetPageTitle();  // reset page title incase it was changed

    if (timerDisplayData.timer_state != "completed") {
      // only show the timer if the timer is not completed
      this.updateRemainingTimeDisplay(timerDisplayData.remaining_time);

      if (timerDisplayData.timer_state == "running") {
        this.startClientSideTimer(timerDisplayData);
        this.update_timer_toggle_icon_to_play();
      } else {
        this.update_timer_toggle_icon_to_pause();
      }

      // Update current cycle information
      const currentCycleElement = document.getElementById('current-cycle');
      currentCycleElement.textContent = `${timerDisplayData.current_cycle.type} cycle - ${this.formatTime(timerDisplayData.current_cycle.duration_seconds)}`;

      // Update focus cycles list
      this.update_focus_cycles_list(timerDisplayData);

    } else {
      document.getElementById("focus-session-container").innerHTML = `
        <div class="session-complete">
          <h1>Session complete</h1>
          <p>The focus room is finished.</p>
        </div>`;
    }
  }

  formatTime(seconds) {
    const totalMinutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60; // remainder of seconds after dividing by 60
    return `${totalMinutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  startClientSideTimer(timerDisplayData) {
    this.stopClientSideTimer(); // Clear any existing interval
    const endTime = Date.now() + timerDisplayData.remaining_time * 1000;
    this.remainingTime = timerDisplayData.remaining_time;
    this.updateRemainingTimeDisplay(this.remainingTime);

    this.timerInterval = setInterval(() => {
      if (this.remainingTime <= 0) {
        // if current focus cycle is completed
        // then we need to transition to next cycle
        // and also stop the current cycle timer
        this.stopClientSideTimer();
        this.transitionToNextCycle();
        return;
      }
      const currentTime = Date.now();
      this.remainingTime = Math.round((endTime - currentTime) / 1000);
      this.updateRemainingTimeDisplay(this.remainingTime);
      this.updatePageTitleToCurrentCycle(this.remainingTime, timerDisplayData.current_cycle.type);

    }, 1000);
  }

  stopClientSideTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
      console.log("stopped client side timer");
    }
  }


  // *****************************************
  // ********** UI Update Functions *********
  // *****************************************

  updateRemainingTimeDisplay(seconds) {
    const remainingTimeElement = document.getElementById('remaining-time');
    if (remainingTimeElement) {
      let formattedTime = this.formatTime(seconds);
      remainingTimeElement.textContent = formattedTime;
    }
  }

  updatePageTitleToCurrentCycle(seconds, current_cycle_type) {
    let formattedTime = this.formatTime(seconds);
    document.title = `${formattedTime} - ${current_cycle_type}`;
  }

  resetPageTitle() {
    document.title = this.originalTitle;
  }

  setConnectionState(state) {
    const currentCycleElement = document.getElementById('current-cycle');
    if (currentCycleElement && state === "disconnected") {
      currentCycleElement.textContent = "Connection paused. Controls will retry.";
    }
  }

  update_will_finish_at_display(data) {
    const willFinishAtElement = document.getElementById('will-finish-at');
    if (willFinishAtElement) {
      willFinishAtElement.textContent = `Session will finish at: ${this.formatUtcDateTime(data.will_finish_at_timestamp)}`;
    }
  }

  formatUtcDateTime(value) {
    if (window.FocusTimerDateTime) {
      return window.FocusTimerDateTime.formatUtcDateTime(value);
    }
    return new Date(value).toLocaleString();
  }

  update_focus_cycles_list(timerDisplayData) {
    const focusCyclesListElement = document.getElementById('focus-cycles-list');
    focusCyclesListElement.innerHTML = ''; // Clear existing content
    Object.entries(timerDisplayData.focus_cycles).forEach(([order, cycle]) => {
      const cycleElement = document.createElement('div');
      cycleElement.className = "timer-cycle-row upcoming";
      let statusText = "UP";
      if (cycle.is_completed) {
        cycleElement.className = "timer-cycle-row completed";
        statusText = "OK";
      } else if (cycle.order == timerDisplayData.current_cycle.order) {
        cycleElement.className = "timer-cycle-row current";
        statusText = "NOW";
      }
      const statusElement = document.createElement('span');
      statusElement.className = "timer-cycle-row__status";
      statusElement.textContent = statusText;

      const copyElement = document.createElement('div');
      const titleElement = document.createElement('strong');
      titleElement.textContent = `Cycle ${order}`;
      const metaElement = document.createElement('span');
      metaElement.textContent = `${cycle.type} - ${this.formatTime(cycle.duration_seconds)}`;
      copyElement.appendChild(titleElement);
      copyElement.appendChild(metaElement);

      const durationElement = document.createElement('span');
      durationElement.textContent = this.formatTime(cycle.duration_seconds);

      cycleElement.appendChild(statusElement);
      cycleElement.appendChild(copyElement);
      cycleElement.appendChild(durationElement);
      focusCyclesListElement.appendChild(cycleElement);
    });
  }

  update_timer_toggle_icon_to_play() {
    let timerToggleIcon = document.getElementById("timer-toggle-icon")
    // we are using conditional check here as for a follower
    // the timer toggle icon and text is not present
    if (timerToggleIcon) {
      timerToggleIcon.className = "fa-regular fa-circle-pause";
    }
    let timerToggleText = document.getElementById("timer-toggle-text")
    if (timerToggleText) {
      timerToggleText.textContent = "Pause";
    }
  }

  update_timer_toggle_icon_to_pause() {
    // we are using conditional check here as for a follower
    // the timer toggle icon and text is not present
    let timerToggleIcon = document.getElementById("timer-toggle-icon")
    if (timerToggleIcon) {
      timerToggleIcon.className = "fa-regular fa-circle-play";
    }
    let timerToggleText = document.getElementById("timer-toggle-text")
    if (timerToggleText) {
      timerToggleText.textContent = "Resume";
    }
  }

  update_session_followers_list(data) {
    const followersContainer = document.getElementById('session-followers-container');
    if (followersContainer) {
      followersContainer.innerHTML = '';
      const headerElement = document.createElement('div');
      headerElement.className = 'side-panel__head';
      const titleElement = document.createElement('h2');
      titleElement.textContent = 'Followers';
      const countElement = document.createElement('span');
      countElement.textContent = data.followers.length.toString();
      headerElement.appendChild(titleElement);
      headerElement.appendChild(countElement);

      const listElement = document.createElement('ul');
      listElement.className = 'followers-list';
      data.followers.forEach(follower => {
        const joinedDate = this.formatUtcDateTime(follower.joined_at);
        const itemElement = document.createElement('li');
        const nameElement = document.createElement('strong');
        nameElement.textContent = follower.username;
        const dateElement = document.createElement('span');
        dateElement.textContent = `Joined ${joinedDate}`;
        itemElement.appendChild(nameElement);
        itemElement.appendChild(dateElement);
        listElement.appendChild(itemElement);
      });
      if (!data.followers.length) {
        const emptyElement = document.createElement('li');
        emptyElement.className = 'empty-state';
        emptyElement.textContent = 'No followers yet.';
        listElement.appendChild(emptyElement);
      }
      followersContainer.appendChild(headerElement);
      followersContainer.appendChild(listElement);
    }
  }

}

// Initialize the FocusSessionManager when the page loads
let focusSessionManager;
document.addEventListener("DOMContentLoaded", (event) => {
  const sessionId = document.getElementById("session-id").dataset.sessionId;
  focusSessionManager = new FocusSessionManager(sessionId);
  window.focusSessionManager = focusSessionManager;
  setupSessionShareButton();

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      const currentTime = Date.now();
      // Convert to seconds
      const timeSinceLastSync = (currentTime - focusSessionManager.lastSyncTime) / 1000;
      if (timeSinceLastSync > 300) {  // 300 seconds = 5 minutes
        console.log("since timer last synced", timeSinceLastSync, "seconds");
        console.log("syncing inactive timer");
        focusSessionManager.sync_inactive_timer();
      }
    }
  });

});

function setupSessionShareButton() {
  const shareButton = document.getElementById("share-session-button");
  const shareLabel = document.getElementById("share-session-label");
  const shareFeedback = document.getElementById("share-session-feedback");
  if (!shareButton || !shareFeedback) {
    return;
  }

  shareButton.addEventListener("click", async () => {
    if (await copySessionUrl()) {
      if (shareLabel) {
        shareLabel.textContent = "Copied";
      }
      shareFeedback.textContent = "Session link copied.";
      shareButton.classList.add("is-copied");
      window.setTimeout(() => {
        if (shareLabel) {
          shareLabel.textContent = "Share session";
        }
        shareFeedback.textContent = "";
        shareButton.classList.remove("is-copied");
      }, 2200);
    } else {
      shareFeedback.textContent = "Copy failed. Select the address bar instead.";
    }
  });
}

async function copySessionUrl() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    return true;
  } catch (_error) {
    const textarea = document.createElement("textarea");
    textarea.value = window.location.href;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    textarea.style.left = "-1000px";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}
