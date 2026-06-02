import pytest
from django.core.exceptions import ValidationError
from django.urls import reverse
from django.utils import timezone

from apps.realtime_timer.admin import UserAdmin
from apps.realtime_timer.models import FocusCycle, FocusSession


@pytest.mark.django_db
@pytest.mark.parametrize(
    "url_name",
    [
        "realtime_timer:temporary-focus-cycles-generator-view",
        "realtime_timer:focus-cycles-and-session-create-view",
    ],
)
def test_htmx_session_builder_posts_require_login(client, url_name):
    response = client.post(reverse(url_name), {})

    assert response.status_code == 302
    assert "/accounts/login/" in response["Location"]


@pytest.mark.django_db
def test_custom_cycle_payload_rejects_excessive_cycle_count(client, user):
    client.force_login(user)
    response = client.post(
        reverse("realtime_timer:focus-cycles-and-session-create-view"),
        {
            "technique": FocusSession.CAMEL_TECHNIQUE,
            "duration_hours": "1",
            "duration_minutes": "0",
            "focus_cycle_type": ["FOCUS"] * 251,
            "focus_cycle_duration": ["1"] * 251,
        },
    )

    assert response.status_code == 400


@pytest.mark.django_db
def test_custom_cycle_payload_rejects_excessive_duration(client, user):
    client.force_login(user)
    response = client.post(
        reverse("realtime_timer:focus-cycles-and-session-create-view"),
        {
            "technique": FocusSession.CAMEL_TECHNIQUE,
            "duration_hours": "1",
            "duration_minutes": "0",
            "focus_cycle_type": ["FOCUS"],
            "focus_cycle_duration": ["601"],
        },
    )

    assert response.status_code == 400


@pytest.mark.django_db
def test_add_cycle_rejects_invalid_index(client, user):
    client.force_login(user)
    response = client.get(reverse("realtime_timer:add-cycle-to-cycle-table-view"), {"index": "nope"})

    assert response.status_code == 400


@pytest.mark.django_db
def test_focus_cycle_model_rejects_out_of_bounds_duration(user):
    session = FocusSession.objects.create(owner=user, technique=FocusSession.CAMEL_TECHNIQUE)
    cycle = FocusCycle(session=session, cycle_type=FocusCycle.FOCUS, duration=timezone.timedelta(minutes=601), order=1)

    with pytest.raises(ValidationError):
        cycle.save()


@pytest.mark.django_db
def test_focus_session_rejects_current_cycle_from_another_session(user):
    first_session = FocusSession.objects.create(owner=user, technique=FocusSession.CAMEL_TECHNIQUE)
    second_session = FocusSession.objects.create(owner=user, technique=FocusSession.CAMEL_TECHNIQUE)
    foreign_cycle = FocusCycle.objects.create(
        session=second_session,
        cycle_type=FocusCycle.FOCUS,
        duration=timezone.timedelta(minutes=25),
        order=1,
    )
    first_session.current_cycle = foreign_cycle

    with pytest.raises(ValidationError):
        first_session.save()


def test_user_admin_does_not_render_password_hash_field():
    field_names = []
    for _label, options in UserAdmin.fieldsets:
        field_names.extend(options["fields"])

    assert "password" not in field_names
