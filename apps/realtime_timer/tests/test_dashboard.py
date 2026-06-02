from datetime import UTC, datetime, timedelta

import pytest
from django.conf import settings
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone

from apps.realtime_timer.business_logic import selectors
from apps.realtime_timer.models import FocusCycle, FocusPeriod, FocusSession


def _create_session(
    owner,
    *,
    technique=FocusSession.POMODORO_TECHNIQUE,
    minutes=25,
    state=FocusSession.TIMER_COMPLETED,
):
    session = FocusSession.objects.create(owner=owner, technique=technique, timer_state=state)
    cycle = FocusCycle.objects.create(
        session=session,
        cycle_type=FocusCycle.FOCUS,
        duration=timezone.timedelta(minutes=minutes),
        order=1,
        is_completed=state == FocusSession.TIMER_COMPLETED,
    )
    session.current_cycle = cycle
    session.save()
    FocusPeriod.objects.create(
        session=session,
        cycle=cycle,
        ended_at=timezone.now(),
        duration=timezone.timedelta(minutes=minutes),
    )
    return session


@pytest.mark.django_db
def test_dashboard_lists_all_sessions_for_current_user(client, user):
    other_user = get_user_model().objects.create_user(username="other", password="12345")
    first_session = _create_session(user, minutes=25)
    second_session = _create_session(user, technique=FocusSession.CAMEL_TECHNIQUE, minutes=50)
    other_session = _create_session(other_user, minutes=90)

    client.force_login(user)
    response = client.get(reverse("realtime_timer:dashboard-view"))

    assert response.status_code == 200
    assert first_session in response.context["sessions"]
    assert second_session in response.context["sessions"]
    assert other_session not in response.context["sessions"]
    assert response.context["total_sessions"] == 2
    assert response.context["total_focus_time"] == timedelta(minutes=75)


@pytest.mark.django_db
def test_dashboard_selector_orders_newest_session_first(user):
    older_session = _create_session(user, minutes=25)
    newer_session = _create_session(user, minutes=50)

    dashboard_data = selectors.get_dashboard_data_for_user(user)

    assert list(dashboard_data["sessions"]) == [newer_session, older_session]


def test_server_timezone_is_utc():
    assert settings.TIME_ZONE == "UTC"


@pytest.mark.django_db
def test_session_will_finish_at_returns_utc_iso_timestamp(user):
    user.timezone = "America/Los_Angeles"
    user.save()
    session = FocusSession.objects.create(owner=user, technique=FocusSession.POMODORO_TECHNIQUE)
    cycle = FocusCycle.objects.create(
        session=session,
        cycle_type=FocusCycle.FOCUS,
        duration=timezone.timedelta(minutes=25),
        order=1,
    )
    session.current_cycle = cycle
    session.save()

    will_finish_at = selectors.get_session_will_finish_at(request_user=user, session=session)

    assert will_finish_at.endswith("Z")
    parsed = datetime.fromisoformat(will_finish_at.replace("Z", "+00:00"))
    assert parsed.tzinfo == UTC
