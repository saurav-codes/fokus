from datetime import UTC

from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from django.db.models import QuerySet, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone

from ..models import FocusPeriod, FocusSession, SessionFollower

User = get_user_model()


def get_focus_session_by_id(*, session_id) -> FocusSession:
    return get_object_or_404(FocusSession, session_id=session_id)


@database_sync_to_async
def get_session_by_id_async(session_id) -> FocusSession | None:
    try:
        return FocusSession.objects.select_related("owner", "current_cycle").get(session_id=session_id)
    except FocusSession.DoesNotExist:
        return None


@database_sync_to_async
def get_session_owner_async(session: FocusSession):
    if session is None:
        return None
    return session.owner


def is_user_a_session_follower(*, session: FocusSession, user) -> bool:
    """Is this user a follower of the given session?"""
    if not getattr(user, "is_authenticated", False):
        return False
    return session.followers.filter(follower=user).exists()  # type: ignore


def get_session_followers(*, session: FocusSession) -> QuerySet[SessionFollower]:
    return SessionFollower.objects.filter(session=session)


def format_utc_datetime(value):
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def get_session_will_finish_at(*, request_user, session: FocusSession):
    now = timezone.now()
    # total time user will spend on this session
    all_cycles_total_duration = session.focus_cycles.all().only("duration").aggregate(  # type: ignore
        total_duration=Sum("duration")
    )["total_duration"] or timezone.timedelta(0)
    # now find out how much user has already spent on this session
    total_finished_fp = session.focus_periods.filter(ended_at__isnull=False).only("duration").aggregate(  # type: ignore
        total_time_focused=Sum("duration")
    )["total_time_focused"] or timezone.timedelta(0)
    timer_started_at_for_unfinished_fp = (
        session.focus_periods.filter(  # type: ignore
            ended_at__isnull=True,  # the current focus period
        )
        .only("started_at")
        .first()
    )
    # time user has spent on the current focus period
    if timer_started_at_for_unfinished_fp:
        duration_for_unfinished_fp = now - timer_started_at_for_unfinished_fp.started_at
    else:
        duration_for_unfinished_fp = timezone.timedelta(0)
    total_time_focused = total_finished_fp + duration_for_unfinished_fp
    # time user has left to focus on this session
    total_time_left_to_focus = all_cycles_total_duration - total_time_focused
    # time user will finish the session at
    time_user_will_finish_at = now + total_time_left_to_focus
    return format_utc_datetime(time_user_will_finish_at)


def get_dashboard_data_for_user(user):
    sessions = (
        FocusSession.objects.filter(owner=user)
        .select_related("current_cycle")
        .prefetch_related("focus_cycles")
        .order_by("-created_at")
    )
    total_sessions = sessions.count()
    total_focus_time = (
        FocusPeriod.objects.filter(session__owner=user, ended_at__isnull=False).aggregate(total=Sum("duration"))[
            "total"
        ]
        or timezone.timedelta(0)
    )
    avg_session_duration = total_focus_time / total_sessions if total_sessions else timezone.timedelta(0)

    return {
        "sessions": sessions,
        "total_sessions": total_sessions,
        "total_focus_time": total_focus_time,
        "total_focus_time_label": _format_duration(total_focus_time),
        "avg_session_duration": avg_session_duration,
        "avg_session_duration_label": _format_duration(avg_session_duration),
    }


def _format_duration(duration):
    total_seconds = int(duration.total_seconds())
    hours, remainder = divmod(total_seconds, 3600)
    minutes = remainder // 60
    if hours:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"
