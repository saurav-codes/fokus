from pathlib import Path

import pytest
from asgiref.sync import async_to_sync
from django.contrib.auth.models import AnonymousUser
from django.urls import reverse
from django.utils import timezone

from apps.realtime_timer.business_logic import selectors
from apps.realtime_timer.business_logic.services import AsyncTimerService
from apps.realtime_timer.models import FocusCycle, FocusPeriod, FocusSession, SessionFollower


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


def _create_one_minute_focus_break_session(owner):
    session = FocusSession.objects.create(owner=owner, technique=FocusSession.CUSTOM_TECHNIQUE)
    focus_cycle = FocusCycle.objects.create(
        session=session,
        cycle_type=FocusCycle.FOCUS,
        duration=timezone.timedelta(minutes=1),
        order=1,
    )
    break_cycle = FocusCycle.objects.create(
        session=session,
        cycle_type=FocusCycle.BREAK,
        duration=timezone.timedelta(minutes=1),
        order=2,
    )
    session.current_cycle = focus_cycle
    session.save()
    FocusPeriod.objects.create(session=session, cycle=focus_cycle, user=owner)
    return session, focus_cycle, break_cycle


def _age_open_periods(*, session, cycle, elapsed):
    FocusPeriod.objects.filter(session=session, cycle=cycle, ended_at__isnull=True).update(
        started_at=timezone.now() - elapsed
    )


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
def test_anonymous_shared_session_requires_name_before_websocket(client, user):
    session = _create_running_session(user)

    response = client.get(reverse("realtime_timer:session-detail-view", args=[session.session_id]))

    content = response.content.decode()
    assert 'id="guest-name-modal"' in content
    assert 'data-can-connect="false"' in content


@pytest.mark.django_db
def test_anonymous_guest_name_is_saved_for_shared_session(client, user):
    session = _create_running_session(user)
    url = reverse("realtime_timer:session-detail-view", args=[session.session_id])

    response = client.post(url, {"guest_name": "Maya"})

    assert response.status_code == 302
    response = client.get(url)
    content = response.content.decode()
    assert 'id="guest-name-modal"' not in content
    assert 'data-guest-name="Maya"' in content
    assert 'data-auto-join="true"' in content


@pytest.mark.django_db
def test_guest_follower_name_renders_in_shared_followers_list(client, user):
    session = _create_running_session(user)
    SessionFollower.objects.create(session=session, username="Maya", user_type=SessionFollower.GUEST)

    response = client.get(reverse("realtime_timer:session-detail-view", args=[session.session_id]))

    assert "Maya" in response.content.decode()


@pytest.mark.django_db
def test_guest_join_creates_display_only_session_follower(user):
    session = _create_running_session(user)
    service = AsyncTimerService(session=session, user=AnonymousUser())

    async_to_sync(service.join_session)(AnonymousUser(), guest_name="Maya")

    follower = SessionFollower.objects.get(session=session, username="Maya")
    assert follower.user_type == SessionFollower.GUEST
    assert follower.follower is None


@pytest.mark.django_db
def test_authenticated_join_creates_countable_focus_period(user):
    owner = user
    participant = type(user).objects.create_user(username="participant", password="12345")
    session = _create_running_session(owner)
    service = AsyncTimerService(session=session, user=participant)

    async_to_sync(service.join_session)(participant)
    async_to_sync(service.leave_session)(participant)

    period = FocusPeriod.objects.get(session=session, user=participant)
    assert period.ended_at is not None
    assert period.duration >= timezone.timedelta(0)


@pytest.mark.django_db
def test_one_minute_focus_break_shared_session_logs_join_leave_and_focus_totals(user):
    participants = [
        type(user).objects.create_user(username=f"participant-{index}", password="12345") for index in range(5)
    ]
    guest_names = [f"Guest {index}" for index in range(4)]
    session, focus_cycle, break_cycle = _create_one_minute_focus_break_session(user)
    service = AsyncTimerService(session=session, user=user)

    for participant in participants:
        async_to_sync(service.join_session)(participant)
    for guest_name in guest_names:
        async_to_sync(service.join_session)(AnonymousUser(), guest_name=guest_name)

    assert SessionFollower.objects.filter(session=session).count() == 9
    assert FocusPeriod.objects.filter(session=session, cycle=focus_cycle, ended_at__isnull=True).count() == 6

    _age_open_periods(session=session, cycle=focus_cycle, elapsed=timezone.timedelta(minutes=3))
    assert async_to_sync(service.transition_to_next_cycle)() is True

    assert FocusPeriod.objects.filter(session=session, cycle=focus_cycle, ended_at__isnull=True).count() == 0
    assert FocusPeriod.objects.filter(session=session, cycle=break_cycle, ended_at__isnull=True).count() == 6
    assert FocusPeriod.objects.filter(session=session, cycle=focus_cycle, user=participants[0]).get().duration == (
        timezone.timedelta(minutes=1)
    )

    async_to_sync(service.leave_session)(participants[0])
    async_to_sync(service.leave_session)(AnonymousUser(), guest_name=guest_names[0])

    assert SessionFollower.objects.filter(session=session).count() == 7
    assert not SessionFollower.objects.filter(session=session, follower=participants[0]).exists()
    assert not SessionFollower.objects.filter(session=session, username=guest_names[0]).exists()

    _age_open_periods(session=session, cycle=break_cycle, elapsed=timezone.timedelta(minutes=3))
    assert async_to_sync(service.transition_to_next_cycle)() is False

    session.refresh_from_db()
    assert session.timer_state == FocusSession.TIMER_COMPLETED
    assert session.total_focus_completed == timezone.timedelta(minutes=1)
    assert FocusPeriod.objects.filter(session=session, ended_at__isnull=True).count() == 0


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
