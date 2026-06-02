from pathlib import Path

import pytest
from django.contrib.auth.models import AnonymousUser
from django.urls import reverse
from django.utils import timezone

from apps.realtime_timer.business_logic import selectors
from apps.realtime_timer.models import FocusCycle, FocusSession


def _create_running_session(owner):
    session = FocusSession.objects.create(owner=owner, technique=FocusSession.POMODORO_TECHNIQUE)
    cycle = FocusCycle.objects.create(
        session=session,
        cycle_type=FocusCycle.FOCUS,
        duration=timezone.timedelta(minutes=25),
        order=1,
    )
    session.current_cycle = cycle
    session.save()
    return session


@pytest.mark.django_db
def test_shared_session_link_does_not_require_login(client, user):
    session = _create_running_session(user)

    response = client.get(reverse("realtime_timer:session-detail-view", args=[session.session_id]))

    assert response.status_code == 200
    content = response.content.decode()
    assert "Shared session" in content
    assert 'id="join-session-button"' not in content
    assert "Log out" not in content


@pytest.mark.django_db
def test_session_page_has_share_button_without_large_focus_timer_title(client, user):
    session = _create_running_session(user)
    client.force_login(user)

    response = client.get(reverse("realtime_timer:session-detail-view", args=[session.session_id]))

    assert response.status_code == 200
    content = response.content.decode()
    assert 'id="share-session-button"' in content
    assert "Share session" in content
    assert 'id="timer-title"' not in content
    assert ">Focus timer</h1>" not in content


@pytest.mark.django_db
def test_anonymous_user_is_not_session_follower(user):
    session = _create_running_session(user)

    assert selectors.is_user_a_session_follower(session=session, user=AnonymousUser()) is False


def test_session_share_button_copies_current_url():
    script = Path("assets/js/focus_session.js").read_text()

    assert "share-session-button" in script
    assert "navigator.clipboard.writeText(window.location.href)" in script
    assert 'document.execCommand("copy")' in script
