from pathlib import Path

import pytest
from django.conf import settings
from django.urls import reverse

from apps.realtime_timer.models import FocusSession


@pytest.mark.django_db
def test_builder_form_auto_regenerates_when_technique_or_duration_changes(client, user):
    client.force_login(user)

    response = client.get(reverse("realtime_timer:main-session-view"))

    assert response.status_code == 200
    assert b'hx-trigger="change from:#id_technique' in response.content
    assert b"input changed delay:350ms from:#id_duration_hours" in response.content
    assert b"input changed delay:350ms from:#id_duration_minutes" in response.content


@pytest.mark.django_db
def test_pattern_preview_uses_generated_cycle_data(client, user):
    client.force_login(user)

    response = client.post(
        reverse("realtime_timer:temporary-focus-cycles-generator-view"),
        {
            "technique": FocusSession.POMODORO_TECHNIQUE,
            "duration_hours": "0",
            "duration_minutes": "30",
        },
    )

    assert response.status_code == 200
    assert b'data-pattern-preview="true"' in response.content
    assert b"Pomodoro" in response.content
    assert b"25 min" in response.content
    assert b"5 min" in response.content


def test_timer_javascript_does_not_reload_page_on_socket_close():
    script = open("assets/js/focus_session.js").read()

    assert "location.reload" not in script
    assert "window.focusSessionManager" in script


def test_cycle_buttons_are_plain_client_side_controls():
    template = open("templates/realtime_timer/partials/_focus_session_form.html").read()

    assert 'data-cycle-action="add"' in template
    assert 'data-cycle-action="delete"' in template
    assert "hx-get" not in template


def test_dev_runserver_uses_asgi_for_websockets():
    assert "daphne" in settings.INSTALLED_APPS
    assert settings.INSTALLED_APPS.index("daphne") < settings.INSTALLED_APPS.index("django.contrib.staticfiles")


def test_datetime_display_uses_browser_timezone_api():
    local_datetime_path = Path("assets/js/local_datetime.js")
    focus_session_script = open("assets/js/focus_session.js").read()
    main_session_template = open("templates/realtime_timer/main_session.html").read()
    dashboard_template = open("templates/realtime_timer/dashboard.html").read()
    session_template = open("templates/realtime_timer/session_detail.html").read()
    form_template = open("templates/realtime_timer/partials/_focus_session_form.html").read()

    assert local_datetime_path.exists()
    local_datetime_script = local_datetime_path.read_text()
    assert "Intl.DateTimeFormat().resolvedOptions().timeZone" in local_datetime_script
    assert "htmx:afterSettle" in local_datetime_script
    assert "data-utc-datetime" in form_template
    assert "data-utc-datetime" in dashboard_template
    assert "data-utc-datetime" in session_template
    assert "js/local_datetime.js" in main_session_template
    assert "js/local_datetime.js" in dashboard_template
    assert "js/local_datetime.js" in session_template
    assert "formatUtcDateTime" in focus_session_script
    assert "request.user.timezone" not in form_template
    assert '|date:"M j, Y g:i A"' not in dashboard_template
    assert '|date:"F d, Y H:i"' not in session_template


def test_redis_socket_timeout_allows_channels_blocking_receive():
    redis_host = settings.CHANNEL_LAYERS["default"]["CONFIG"]["hosts"][0]

    assert redis_host["socket_timeout"] > 5
    assert settings.REDIS_CLIENT_KWARGS["socket_timeout"] == redis_host["socket_timeout"]
